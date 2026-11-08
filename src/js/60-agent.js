/* ═══════════════════════════ AGENT: runs · plan/act/auto · tools · diff capture · hooks ═══════════════════════════ */
const READ_GATES = ['read', 'none'];
const Agent = DS.agent = {
  active: new Map(), asks: new Map(),
  isRunning(t) { return !!(t && this.active.has(t.id)); },
  tools() { return DS.kernel.list('tool'); },
  tool(name) { return this.tools().find(t => t.name === name); },
  profile(id) { return DS.kernel.list('profile').find(p => p.id === id) || { id, system: '', label: id }; },
  model(profId) { const s = Store.settings(); return (this.profile(profId).model) || (s.models && s.models[profId]) || 'deepseek-chat'; },
  stop(thread) { const r = thread && this.active.get(thread.id); if (r) { r.ac.abort(); Guard.cancelPending(); for (const [id, res] of this.asks) { res('(cancelled)'); this.asks.delete(id); } } },
  recordChange(thread, path, before) { thread.changes = thread.changes || {}; if (!(path in thread.changes)) thread.changes[path] = { before, ts: now() }; DS.bus.emit('changes:update', thread); },
  async revert(thread, path) {
    const c = thread.changes && thread.changes[path]; if (!c) return; if (c.before === null) await DS.fs.remove(path); else await DS.fs.write(path, c.before);
    delete thread.changes[path]; Store.save(); DS.bus.emit('changes:update', thread);
  },
  accept(thread, path) { if (thread.changes) delete thread.changes[path]; Store.save(); DS.bus.emit('changes:update', thread); },
  answer(partId, text) { const r = this.asks.get(partId); if (r) { this.asks.delete(partId); r(text); } },

  async systemPrompt(thread, phase, profId) {
    const s = Store.settings(); const w = Store.ws(); const prof = this.profile(profId);
    let agentsMd = ''; try { if (await DS.fs.exists('/AGENTS.md')) agentsMd = (await DS.fs.read('/AGENTS.md')).content.slice(0, 6000); } catch (_) {}
    const skills = DS.kernel.list('skill');
    const parts = [
      'You are **Forge**, an agent working inside the user’s browser workspace (a Codex-style harness). You act through tools; you do not pretend to have done work you did not do.',
      'Workspace: “' + w.name + '” (' + (DS.fs.isBridge() ? 'local folder via bridge' : 'in-browser virtual filesystem') + '). Paths are absolute from "/".',
      'Principles: read before you edit; prefer fs_edit for changes to existing files; keep changes small; verify what you can; finish with a short plain summary of what changed and anything the user must do. Ask (ask_user) only when truly blocked.',
      prof.system ? ('Role — ' + prof.label + ': ' + prof.system) : '',
      phase === 'plan' ? 'PLAN MODE: do NOT modify anything. Explore with read-only tools, then call update_plan with concrete steps (and a one-sentence goal). Stop after that so the user can approve.' : (thread.mode === 'auto' ? 'For non-trivial work, call update_plan first with 3–7 steps, then execute them, updating step status as you go.' : ''),
      thread.plan && thread.plan.steps && thread.plan.steps.length ? 'Current plan:\n' + thread.plan.steps.map((st, i) => (i + 1) + '. [' + st.status + '] ' + st.text).join('\n') : '',
      thread._toolGuide || '',
      agentsMd ? '## AGENTS.md\n' + agentsMd : '',
      skills.length ? '## Skills (load with use_skill when relevant)\n' + skills.map(k => '- ' + k.id + ': ' + (k.description || k.title)).join('\n') : '',
      ...DS.kernel.list('systemPrompt').map(p => { try { return typeof p.build === 'function' ? p.build(thread) : p.text; } catch (_) { return ''; } })
    ];
    return parts.filter(Boolean).join('\n\n');
  },
  buildMessages(thread, sys, extra) {
    const out = [{ role: 'system', content: sys }]; const msgs = thread.messages; let budget = 140000; const picked = [];
    for (let i = msgs.length - 1; i >= 0; i--) { const m = msgs[i]; const sz = JSON.stringify(m.api || m.content || m.parts || '').length; if (budget - sz < 0 && picked.length) break; budget -= sz; picked.unshift(m); }
    for (const m of picked) {
      if (m.role === 'user') out.push({ role: 'user', content: (m.ctx ? m.ctx + '\n\n' : '') + m.content });
      else if (m.api && m.api.length) out.push(...m.api);
      else { const t = (m.parts || []).filter(p => p.type === 'text').map(p => p.text).join(''); if (t) out.push({ role: 'assistant', content: t }); }
    }
    if (extra) out.push(...extra); return out;
  },
  toolDefs(phase) {
    return this.tools().filter(t => phase !== 'plan' || READ_GATES.includes(t.gate || 'none') || t.name === 'update_plan').map(t => ({ name: t.name, description: t.description || '', parameters: t.parameters || { type: 'object', properties: {} } }));
  },
  async callTool(tc, thread, msg, part, signal) {
    const t0 = now();
    const fail = (status, text, hint) => { part.status = status; part.result = { error: text }; part.summary = text; part.dur = now() - t0; return hint ? { error: text, how_to_fix: hint } : { error: text }; };
    /* DS.toolkit repairs the common mistakes (wrapper names, near-miss names, string args, synonyms, types) */
    const rs = DS.toolkit.resolve(tc); if (rs.notes.length) { part.fixed = rs.notes.slice(); DS.kernel.log('info', 'toolkit', tc.name + ': ' + rs.notes.join('; ')); }
    if (rs.name !== tc.name) { tc.name = rs.name; part.name = rs.name; }
    tc.args = rs.args;
    const def = this.tool(tc.name);
    if (!def) return fail('err', 'unknown tool “' + tc.name + '”', DS.toolkit.errorHint(tc.name, 'unknown'));
    const vd = DS.toolkit.validate(def, tc.args || {}); tc.args = vd.args; if (vd.fixes.length) (part.fixed = part.fixed || []).push(...vd.fixes);
    if (vd.errors.length) return fail('err', vd.errors.join('; '), DS.toolkit.errorHint(tc.name, 'args', vd.errors.join('; ')));
    const hk = await DS.kernel.hooks('beforeTool', { name: tc.name, args: tc.args, thread }); if (hk && hk.block) return fail('denied', 'blocked by hook: ' + hk.block);
    const args = hk.args || tc.args || {}; part.args = args;
    const tctx = { thread, signal, msg, part, log: (l, m) => DS.kernel.log(l, 'tool:' + tc.name, m), update: () => DS.bus.emit('msg:update', { thread, msg }), fs: DS.fs };
    try {
      const gate = def.gate || 'none';
      if (gate !== 'none') {
        const detail = def.detail ? await def.detail(args, tctx) : { args };
        const g = await Guard.check(gate, detail, thread, tc.name);
        if (!g.allowed) return fail('denied', g.reason || 'not allowed');
      }
      part.status = 'running'; tctx.update();
      let result = await def.run(args, tctx);
      if (signal.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' });
      part.status = 'ok'; part.result = result; part.dur = now() - t0;
      try { part.summary = def.summarize ? def.summarize(args, result) : ''; } catch (_) { part.summary = ''; }
      if (['read', 'net'].includes(gate) && DS.store.state.settings.taintCheck) { const v = Guard.taint(typeof result === 'string' ? result : JSON.stringify(result).slice(0, 20000)); if (v.level !== 'low') { Guard.bump(thread, v.level); DS.kernel.log('warn', 'guard', 'tool “' + tc.name + '” returned suspicious content (' + v.hits.join(', ') + ') → taint ' + v.level); } }
      const ha = await DS.kernel.hooks('afterTool', { name: tc.name, args, result, thread, gate, part });
      /* hooks may return {result} to change what the MODEL sees (e.g. spotlighting); the UI keeps part.result */
      return (ha && ha.result !== undefined) ? ha.result : result;
    } catch (e) {
      if (e.name === 'AbortError') { part.status = 'aborted'; part.dur = now() - t0; throw e; }
      return fail('err', e.message || String(e));
    }
  },
  apiToolResult(r) { let s = typeof r === 'string' ? r : JSON.stringify(r); if (s == null) s = 'null'; return s.length > 9000 ? s.slice(0, 9000) + '\n…[truncated ' + (s.length - 9000) + ' chars]' : s; },

  async run(thread, text, opts = {}) {
    if (this.isRunning(thread)) throw new Error('this thread is already running');
    const s = Store.settings(); const ac = new AbortController(); const signal = ac.signal;
    const um = { id: uid('m'), role: 'user', content: text, ts: now(), attachments: opts.attachments || undefined, ctx: opts.ctx || undefined };
    if (!opts.silentUser) thread.messages.push(um);
    const msg = { id: uid('m'), role: 'assistant', parts: [], api: [], ts: now(), meta: { startedAt: now(), model: '', provider: '' } }; thread.messages.push(msg);
    const rec = { ac, msg }; this.active.set(thread.id, rec); thread.updated = now();
    const emit = () => DS.bus.emit('msg:update', { thread, msg });
    DS.bus.emit('run:start', { thread, msg }); Store.save();
    const mode = opts.mode || thread.mode || s.mode; const phase0 = mode === 'plan' ? 'plan' : 'act'; let phase = phase0; let stoppedForPlan = false;
    const lastPart = type => { const p = msg.parts[msg.parts.length - 1]; if (p && p.type === type) return p; const n = { type, text: '' }; msg.parts.push(n); return n; };
    try {
      /* user:message first so plugins can rewrite/redact the prompt ({text}) before anything (checkpoints, traces) records it */
      const hu = await DS.kernel.hooks('user:message', { thread, text }); if (hu && hu.block) throw new Error('blocked: ' + hu.block);
      if (hu && typeof hu.text === 'string' && hu.text !== text) { text = hu.text; if (!opts.silentUser) um.content = text; }
      const hs = await DS.kernel.hooks('run:start', { thread, text, mode }); if (hs && hs.block) throw new Error('blocked: ' + hs.block);
      if (!thread.titled && !opts.silentUser) { thread.title = text.replace(/\s+/g, ' ').slice(0, 48) || thread.title; thread.titled = true; DS.bus.emit('sidebar:refresh'); }
      let steps = 0, errorStreak = 0;
      while (steps++ < (s.maxSteps || 14)) {
        const profId = phase === 'plan' ? 'planner' : 'executor';
        const sc = DS.toolkit.scope(this.toolDefs(phase), thread, text); const defs = sc.defs; thread._toolGuide = DS.toolkit.guide(defs, { hidden: sc.hidden });
        const sys = await this.systemPrompt(thread, phase, profId); const messages = this.buildMessages(thread, sys); const provider = DS.providers.pick(); let model = provider.id === 'sim' ? 'sim' : this.model(profId);
        msg.meta.model = model; msg.meta.provider = provider.id;
        const pre = { messages, tools: defs, model, thread }; await DS.kernel.hooks('beforeModel', pre); if (provider.id !== 'sim' && pre.model) model = pre.model; msg.meta.model = model;
        let curText = null;
        const onDelta = d => {
          if (d.reasoning && s.showReasoning !== false) { lastPart('reasoning').text += d.reasoning; }
          if (d.content) { curText = lastPart('text'); curText.text += d.content; }
          if (d.toolDelta) { /* show "preparing tool" shimmer */ rec.preparing = d.toolDelta.name; }
          emit();
        };
        let res;
        try { res = await provider.stream({ messages: pre.messages || messages, tools: pre.tools || defs, model, signal, onDelta, temperature: s.temperature, thread, phase }); }
        catch (e) { if (e.name === 'AbortError') throw e; throw e; }
        if (res.usage) { thread.usage = thread.usage || { in: 0, out: 0 }; thread.usage.in += res.usage.prompt_tokens || 0; thread.usage.out += res.usage.completion_tokens || 0; }
        await DS.kernel.hooks('afterModel', { res, thread });
        const assistantApi = { role: 'assistant', content: res.content || '' };
        if (res.toolCalls.length) assistantApi.tool_calls = res.toolCalls.map(tc => ({ id: tc.id, type: 'function', function: { name: tc.name, arguments: tc.raw || JSON.stringify(tc.args || {}) } }));
        msg.api.push(assistantApi);
        if (!res.toolCalls.length) break;
        for (const tc of res.toolCalls) {
          const part = { type: 'tool', id: tc.id, name: tc.name, args: tc.args, status: 'pending', result: null, summary: '', startedAt: now() }; msg.parts.push(part); emit();
          const result = await this.callTool(tc, thread, msg, part, signal);
          if (part.status === 'err') errorStreak++; else errorStreak = 0;
          msg.api.push({ role: 'tool', tool_call_id: tc.id, content: this.apiToolResult(result) }); emit(); Store.save();
          if (tc.name === 'update_plan' && phase === 'plan') stoppedForPlan = true;
        }
        if (stoppedForPlan) break;
        if (errorStreak === 2) msg.api.push({ role: 'user', content: '[FORGE] The last two tool calls failed. Read each error’s how_to_fix, call tools by their exact names with JSON arguments (see the quick reference), or call tool_help {"name":"<tool>"} before retrying. If a tool cannot do this, answer in text instead.' });
        if (errorStreak >= 4) { lastPart('text').text += '\n\nStopping: four tool calls in a row failed. Each card above says why. Try again, ask in plain words, or pick a model with native tool support (model picker → “tools” badge).'; break; }
      }
      if (steps > (s.maxSteps || 14)) { lastPart('text').text += '\n\n_Reached the step limit (' + (s.maxSteps || 14) + '). Say “continue” to keep going._'; }
      if (stoppedForPlan) { thread.plan = thread.plan || { steps: [] }; thread.plan.status = 'proposed'; }
      else if (s.verify && !signal.aborted && msg.parts.some(p => p.type === 'tool')) {
        try { const crit = this.profile('critic'); const m2 = this.buildMessages(thread, 'CRITIC. ' + (crit.system || 'Review the work above against the request. Reply in 1–3 sentences: what is verified, what is risky.'), [{ role: 'user', content: 'Review the run above.' }]);
          const p = DS.providers.pick(); const cp = { type: 'critic', text: '' }; msg.parts.push(cp); const r = await p.stream({ messages: m2, tools: [], model: p.id === 'sim' ? 'sim' : this.model('critic'), signal, onDelta: d => { if (d.content) { cp.text += d.content; emit(); } }, temperature: 0.2 }); if (!cp.text.trim()) msg.parts.pop(); } catch (e) { if (e.name === 'AbortError') throw e; DS.kernel.log('warn', 'critic', e.message); }
      }
    } catch (e) {
      if (e.name === 'AbortError') { msg.parts.forEach(p => { if (p.type === 'tool' && (p.status === 'running' || p.status === 'pending')) p.status = 'aborted'; }); msg.meta.aborted = true; }
      else { msg.meta.error = e.message || String(e); DS.kernel.log('error', 'agent', msg.meta.error); }
    } finally {
      msg.parts = msg.parts.filter(p => !((p.type === 'text' || p.type === 'reasoning') && !p.text.trim()));
      msg.meta.endedAt = now(); this.active.delete(thread.id); thread.updated = now();
      await DS.kernel.hooks('run:end', { thread, msg });
      DS.bus.emit('run:end', { thread, msg }); DS.bus.emit('sidebar:refresh'); Store.save(); await Store.flush();
    }
    return msg;
  },
  /* approve a proposed plan → run in act mode */
  approvePlan(thread) { if (thread.plan) thread.plan.status = 'approved'; return this.run(thread, 'Plan approved. Execute it now.', { mode: 'act', silentUser: false }); }
};

/* ═══════════ core tools (registered by the builtin plugin “core.tools”) ═══════════ */
const clip = (s, n) => (s.length > n ? s.slice(0, n) + '\n…[truncated ' + (s.length - n) + ' chars]' : s);
DS.coreTools = [
  { name: 'fs_list', description: 'List files and folders at a path (use depth for a tree).', gate: 'read', icon: 'file', parameters: { type: 'object', properties: { path: { type: 'string', description: 'directory, default "/"' }, depth: { type: 'integer' } } },
    async run(a) { const p = a.path || '/'; const ents = await DS.fs.list(p); const tree = a.depth > 1 ? await DS.fs.tree(p, Math.min(a.depth, 5)) : null; return { path: DS.fs.norm(p), entries: ents.map(e => e.name + (e.type === 'dir' ? '/' : '')), tree }; },
    summarize: (a, r) => (r.entries ? r.entries.length + ' entries in ' + r.path : '') },
  { name: 'fs_read', description: 'Read a text file. Optional line range (1-based, inclusive).', gate: 'read', parameters: { type: 'object', properties: { path: { type: 'string' }, start: { type: 'integer' }, end: { type: 'integer' } }, required: ['path'] },
    async run(a) { const f = await DS.fs.read(a.path); if (DS.fs.isBinary(f.content)) return { path: f.path, binary: true, bytes: f.content.length }; let c = f.content; if (a.start || a.end) { const L = c.split('\n'); c = L.slice(Math.max(0, (a.start || 1) - 1), a.end || L.length).join('\n'); } return { path: f.path, content: clip(c, 24000), lines: f.content.split('\n').length }; },
    summarize: (a, r) => (r.lines ? r.lines + ' lines · ' + r.path : r.path) },
  { name: 'fs_write', description: 'Create or overwrite a file with the full contents. For small changes to existing files prefer fs_edit.', gate: 'write', parameters: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] },
    async detail(a) { let before = ''; try { before = (await DS.fs.read(a.path)).content; } catch (_) {} return { path: DS.fs.norm(a.path), preview: { kind: 'diff', before, after: a.content } }; },
    async run(a, t) { const p = DS.fs.norm(a.path); let before = null; try { before = (await DS.fs.read(p)).content; } catch (_) {} Agent.recordChange(t.thread, p, before); const r = await DS.fs.write(p, a.content); return { path: p, bytes: r.bytes, created: before === null }; },
    summarize: (a, r) => (r.created ? 'created ' : 'wrote ') + r.path + ' · ' + DS.fmtBytes(r.bytes) },
  { name: 'fs_edit', description: 'Replace an exact string in a file. `old` must match exactly once unless replace_all is true.', gate: 'write', parameters: { type: 'object', properties: { path: { type: 'string' }, old: { type: 'string' }, new: { type: 'string' }, replace_all: { type: 'boolean' } }, required: ['path', 'old', 'new'] },
    async detail(a) { const f = await DS.fs.read(a.path); const n = a.replace_all ? f.content.split(a.old).join(a.new) : f.content.replace(a.old, () => a.new); return { path: f.path, preview: { kind: 'diff', before: f.content, after: n } }; },
    async run(a, t) { const f = await DS.fs.read(a.path); const cnt = f.content.split(a.old).length - 1; if (!a.old) throw new Error('`old` is empty'); if (cnt === 0) throw new Error('`old` text not found in ' + f.path); if (cnt > 1 && !a.replace_all) throw new Error('`old` matches ' + cnt + ' places; add context or set replace_all'); Agent.recordChange(t.thread, f.path, f.content); const n = a.replace_all ? f.content.split(a.old).join(a.new) : f.content.replace(a.old, () => a.new); await DS.fs.write(f.path, n); return { path: f.path, replaced: cnt, delta: n.length - f.content.length }; },
    summarize: (a, r) => 'edited ' + r.path + ' (' + r.replaced + '×)' },
  { name: 'fs_delete', description: 'Delete a file or folder.', gate: 'write', parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
    async detail(a) { let before = ''; try { before = (await DS.fs.read(a.path)).content; } catch (_) {} return { path: DS.fs.norm(a.path), preview: { kind: 'diff', before, after: '' } }; },
    async run(a, t) { const p = DS.fs.norm(a.path); let before = null; try { before = (await DS.fs.read(p)).content; } catch (_) {} if (before !== null) Agent.recordChange(t.thread, p, before); const n = await DS.fs.remove(p); return { path: p, removed: n }; },
    summarize: (a, r) => 'deleted ' + r.path },
  { name: 'fs_search', description: 'Search file contents (substring or regex). Returns path:line matches.', gate: 'read', parameters: { type: 'object', properties: { query: { type: 'string' }, dir: { type: 'string' }, regex: { type: 'boolean' }, glob: { type: 'string' } }, required: ['query'] },
    async run(a) { const m = await DS.fs.search(a.query, { dir: a.dir || '/', regex: !!a.regex, glob: a.glob }); return { matches: m, count: m.length }; },
    summarize: (a, r) => r.count + ' match' + (r.count === 1 ? '' : 'es') },
  { name: 'shell_run', description: 'Run a shell command in the user’s local folder. Only works when the local bridge is connected.', gate: 'shell', parameters: { type: 'object', properties: { cmd: { type: 'string' }, cwd: { type: 'string' }, timeout: { type: 'integer', description: 'seconds' } }, required: ['cmd'] },
    async detail(a) { return { cmd: a.cmd, path: a.cwd || '/' }; },
    async run(a, t) { if (!DS.bridge.online) throw new Error('Shell needs the local bridge (Settings → Bridge). In-browser alternatives: run_js / the Terminal view.'); let out = ''; const r = await DS.bridge.call('shell', { cmd: a.cmd, cwd: a.cwd, timeout: a.timeout || 60 }, { timeout: ((a.timeout || 60) + 10) * 1000, onChunk: c => { out += c.data || ''; t.part.live = out.slice(-2000); t.update(); } }); return { code: r.code, stdout: clip(r.stdout || out, 12000), stderr: clip(r.stderr || '', 4000) }; },
    summarize: (a, r) => 'exit ' + r.code },
  { name: 'update_plan', description: 'Set or update the plan shown to the user. steps: [{text, status: pending|doing|done}]. Call again to tick items off.', gate: 'none', parameters: { type: 'object', properties: { goal: { type: 'string' }, steps: { type: 'array', items: { type: 'object', properties: { text: { type: 'string' }, status: { type: 'string', enum: ['pending', 'doing', 'done'] } }, required: ['text'] } } }, required: ['steps'] },
    async run(a, t) { const th = t.thread; th.plan = { goal: a.goal || (th.plan && th.plan.goal) || '', steps: (a.steps || []).map(s => ({ text: String(s.text || ''), status: ['pending', 'doing', 'done'].includes(s.status) ? s.status : 'pending' })), status: (th.plan && th.plan.status) || 'active', updated: now() }; DS.bus.emit('plan:update', th); return { ok: true, steps: th.plan.steps.length }; },
    summarize: (a, r) => r.steps + ' steps' },
  { name: 'ask_user', description: 'Ask the user a blocking question (optionally with choices). Use sparingly.', gate: 'none', parameters: { type: 'object', properties: { question: { type: 'string' }, options: { type: 'array', items: { type: 'string' } } }, required: ['question'] },
    async run(a, t) { const part = t.part; part.ask = { question: a.question, options: a.options || [], answer: null }; part.status = 'running'; t.update(); const ans = await new Promise((res, rej) => { Agent.asks.set(part.id, res); t.signal.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' })), { once: true }); }); part.ask.answer = ans; return { answer: ans }; },
    summarize: (a, r) => '“' + String(r.answer).slice(0, 40) + '”' },
  { name: 'use_skill', description: 'Load the full instructions of a skill listed in the system prompt.', gate: 'none', parameters: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
    async run(a) { const k = DS.kernel.list('skill').find(s => s.id === a.id); if (!k) throw new Error('no such skill: ' + a.id + ' (have: ' + DS.kernel.list('skill').map(s => s.id).join(', ') + ')'); return { id: k.id, instructions: k.instructions }; },
    summarize: (a, r) => r.id },
  { name: 'tool_help', description: 'Look up tools: {} lists every tool with its signature; {"name":"x"} gives one tool’s full schema and an example call. Use it when unsure which tool or arguments to use.', gate: 'none', parameters: { type: 'object', properties: { name: { type: 'string', description: 'tool name (optional)' }, query: { type: 'string', description: 'words to search tool descriptions (optional)' } } },
    async run(a) {
      if (a.name) return DS.toolkit.help(a.name);
      let ts = DS.agent.tools(); if (a.query) { const q = String(a.query).toLowerCase().split(/\s+/).filter(Boolean); ts = ts.filter(t => q.some(w => (t.name + ' ' + (t.description || '')).toLowerCase().includes(w))); }
      return { count: ts.length, tools: ts.map(t => DS.toolkit.signature(t) + ' — ' + String(t.description || '').replace(/\s+/g, ' ').slice(0, 110)), note: 'Call a tool by its exact name with a JSON object of arguments.' };
    },
    summarize: (a, r) => a.name ? String(a.name) : (r.count + ' tools') }
];

/* ═══════════ MCP client (HTTP JSON-RPC; stdio servers via the bridge) ═══════════ */
DS.mcp = {
  servers: new Map(), /* name → {cfg, status, tools, err} */
  async rpc(srv, method, params) {
    const cfg = srv.cfg;
    if (cfg.transport === 'stdio') return DS.bridge.call('mcp', { server: cfg.name, command: cfg.command, args: cfg.args || [], method, params }, { timeout: 60000 });
    const headers = Object.assign({ 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' }, cfg.headers || {}); if (srv.session) headers['Mcp-Session-Id'] = srv.session;
    const res = await fetch(cfg.url, { method: 'POST', headers, body: JSON.stringify({ jsonrpc: '2.0', id: uid('r'), method, params }) });
    const sid = res.headers.get('Mcp-Session-Id'); if (sid) srv.session = sid; if (!res.ok) throw new Error('MCP HTTP ' + res.status);
    const txt = await res.text(); let j; const ct = res.headers.get('content-type') || '';
    if (ct.includes('event-stream')) { const lines = txt.split('\n').filter(l => l.startsWith('data:')).map(l => l.slice(5).trim()); for (const l of lines) { try { const o = JSON.parse(l); if (o.result || o.error) j = o; } catch (_) {} } } else { try { j = JSON.parse(txt); } catch (_) {} }
    if (!j) throw new Error('empty MCP response'); if (j.error) throw new Error(j.error.message || 'MCP error'); return j.result;
  },
  /* remove a server AND the tools it registered */
  disconnect(name) { const srv = this.servers.get(name); if (!srv) return false; (srv.disposers || []).forEach(d => { try { d(); } catch (_) {} }); this.servers.delete(name); DS.bus.emit('mcp:change'); return true; },
  async connect(cfg, ownerCtx) {
    if (this.servers.has(cfg.name)) this.disconnect(cfg.name);
    const srv = { cfg, status: 'connecting', tools: [], err: null, disposers: [] }; this.servers.set(cfg.name, srv); DS.bus.emit('mcp:change');
    try {
      await this.rpc(srv, 'initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'forge', version: DS.version } });
      try { await this.rpc(srv, 'notifications/initialized', {}); } catch (_) {}
      const r = await this.rpc(srv, 'tools/list', {}); srv.tools = (r && r.tools) || [];
      const safe = s => String(s).replace(/[^a-zA-Z0-9_]/g, '_');
      for (const t of srv.tools) {
        const name = 'mcp_' + safe(cfg.name) + '_' + safe(t.name);
        srv.disposers.push(ownerCtx.tool({ id: name, name, description: '[MCP ' + cfg.name + '] ' + (t.description || t.name), gate: 'net', parameters: t.inputSchema || { type: 'object', properties: {} }, detail: a => ({ args: a, path: cfg.name + ' · ' + t.name }),
          async run(a) { const out = await DS.mcp.rpc(srv, 'tools/call', { name: t.name, arguments: a }); const txt = (out.content || []).map(c => c.text || '').join('\n'); if (out.isError) throw new Error(txt || 'tool error'); return txt || out; }, summarize: () => cfg.name }));
      }
      srv.status = 'ready';
    } catch (e) { srv.status = 'error'; srv.err = e.message; DS.kernel.log('error', 'mcp', cfg.name + ': ' + e.message); }
    DS.bus.emit('mcp:change'); return srv;
  }
};
