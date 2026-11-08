/* forge.hooks — user-defined lifecycle hooks with the event names shared by Codex / Claude Code / Gemini CLI
   (SessionStart, UserPromptSubmit, PreToolUse, PostToolUse, Stop) and a JSON decision contract:
   return { decision: 'allow'|'deny'|'ask', reason, updatedInput, additionalContext }.
   Two hook kinds: "js" (a function body run in this page, same trust level as a plugin) and
   "command" (a shell command run through the local bridge with the event JSON in $FORGE_EVENT; only when the bridge is online). */
DS.plugin({
  name: 'forge.hooks', title: 'Hooks', version: '1.0.0', tags: ['governance', 'automation'],
  description: 'Your own lifecycle hooks (PreToolUse, PostToolUse, UserPromptSubmit, SessionStart, Stop) in JS or as bridge shell commands, with the Codex/Claude Code JSON decision contract.',
  apply(ctx) {
    const U = DS.util, esc = U.esc;
    const EVENTS = {
      SessionStart: { forge: 'run:start', desc: 'A run starts. additionalContext is added to the run as a note.' },
      UserPromptSubmit: { forge: 'user:message', desc: 'Before the prompt is processed. deny blocks the run.' },
      PreToolUse: { forge: 'beforeTool', desc: 'Before a tool runs. deny blocks it; ask forces an approval sheet; updatedInput replaces the arguments.' },
      PostToolUse: { forge: 'afterTool', desc: 'After a tool returns. additionalContext is appended to what the model sees.' },
      Stop: { forge: 'run:end', desc: 'The run finished. Good for logging / notifications.' }
    };
    const TEMPLATES = [
      { name: 'Block destructive shell', event: 'PreToolUse', matcher: 'shell|run_shell|bash|vsh', kind: 'js',
        code: "const cmd = JSON.stringify(event.tool_input || {});\nif (/rm\\s+-rf\\s+[\\/~]|mkfs|dd\\s+if=/.test(cmd)) return { decision: 'deny', reason: 'destructive command blocked by hook' };" },
      { name: 'Ask before any network tool', event: 'PreToolUse', matcher: '^(web_|computer_|cloud_)', kind: 'js',
        code: "return { decision: 'ask', reason: 'network tool — hook asks first' };" },
      { name: 'Log every tool call', event: 'PostToolUse', matcher: '.*', kind: 'js',
        code: "const line = new Date().toISOString() + ' ' + event.tool_name + ' ' + JSON.stringify(event.tool_input).slice(0, 200) + '\\n';\nconst p = '/notes/tool-log.md'; let old = '';\ntry { old = (await DS.fs.read(p)).content || ''; } catch (e) {}\nawait DS.fs.write(p, old + line);" },
      { name: 'Remind the model of house rules', event: 'UserPromptSubmit', matcher: '', kind: 'js',
        code: "return { additionalContext: 'House rules: answer concisely; cite files you changed.' };" }
    ];
    const list = () => ctx.data.get('hooks', []);
    const save = l => { ctx.data.set('hooks', l); rewire(); DS.bus.emit('hooks:change'); };
    const runs = []; const logRun = (h, ev, out, err) => { runs.unshift({ ts: Date.now(), name: h.name, event: ev, out: out ? JSON.stringify(out).slice(0, 300) : '', err: err ? String(err).slice(0, 300) : '' }); runs.length = Math.min(runs.length, 60); DS.bus.emit('hooks:ran'); };

    const AsyncFn = Object.getPrototypeOf(async function () {}).constructor;
    const compiled = new Map();
    function fnFor(h) { const k = h.id + ':' + h.code; if (!compiled.has(k)) compiled.set(k, new AsyncFn('event', 'DS', h.code)); return compiled.get(k); }
    async function exec(h, event) {
      if (h.kind === 'command') {
        if (!(DS.bridge && DS.bridge.online)) throw new Error('bridge offline — command hooks need the local bridge');
        const payload = JSON.stringify(event).replace(/'/g, "'\\''");
        const r = await DS.bridge.call('shell', { cmd: "FORGE_EVENT='" + payload + "' " + h.code }, { timeout: 20000 });
        const outTxt = String((r && (r.stdout || r.out || r.output)) || '').trim(); const code = r && (r.code ?? r.exitCode);
        if (code === 2) return { decision: 'deny', reason: String((r && r.stderr) || outTxt || 'blocked by command hook').slice(0, 300) };
        try { return outTxt ? JSON.parse(outTxt) : null; } catch (_) { return outTxt ? { additionalContext: outTxt.slice(0, 2000) } : null; }
      }
      return await fnFor(h)(event, DS);
    }
    const matches = (h, tool) => { if (!h.matcher) return true; try { return new RegExp(h.matcher).test(tool || ''); } catch (_) { return false; } };
    async function fire(evName, event, tool) {
      const out = { decision: 'allow', reasons: [], context: [], updatedInput: null };
      for (const h of list().filter(x => x.enabled !== false && x.event === evName && matches(x, tool))) {
        try {
          const r = await exec(h, Object.assign({ hook_event_name: evName }, event)); logRun(h, evName, r);
          if (!r || typeof r !== 'object') continue;
          if (r.decision === 'deny' || r.decision === 'block') { out.decision = 'deny'; out.reasons.push(r.reason || h.name); break; }
          if (r.decision === 'ask' && out.decision !== 'deny') { out.decision = 'ask'; out.reasons.push(r.reason || h.name); }
          if (r.updatedInput && typeof r.updatedInput === 'object') { out.updatedInput = r.updatedInput; event.tool_input = r.updatedInput; }
          if (r.additionalContext) out.context.push(String(r.additionalContext).slice(0, 4000));
        } catch (e) { logRun(h, evName, null, e.message || e); DS.kernel.log('error', 'hooks', h.name + ': ' + (e.message || e)); }
      }
      return out;
    }
    const has = ev => list().some(x => x.enabled !== false && x.event === ev);

    /* ---- wire Forge hooks (only events that have user hooks pay any cost) ---- */
    const askOnce = new Map(); // threadId:tool → pending approval for 'ask' decisions
    let disposers = [];
    function rewire() {
      disposers.forEach(d => { try { d(); } catch (_) {} }); disposers = [];
      if (has('SessionStart')) disposers.push(ctx.hook('run:start', async p => { const r = await fire('SessionStart', { thread_id: p.thread && p.thread.id, prompt: p.text, mode: p.mode }); if (r.context.length && p.thread) DS.kernel.log('info', 'hooks', 'SessionStart context: ' + r.context.join(' | ').slice(0, 200)); }));
      if (has('UserPromptSubmit')) {
        disposers.push(ctx.hook('user:message', async p => { const r = await fire('UserPromptSubmit', { thread_id: p.thread && p.thread.id, prompt: p.text }); if (r.decision === 'deny') return { block: r.reasons.join('; ') }; if (r.context.length && p.thread) { p.thread._hookCtx = r.context.join('\n'); } }));
        disposers.push(ctx.hook('beforeModel', p => { const c = p.thread && p.thread._hookCtx; if (c && p.messages && p.messages[0] && p.messages[0].role === 'system') p.messages[0] = Object.assign({}, p.messages[0], { content: p.messages[0].content + '\n\n[Hook context]\n' + c }); }));
        disposers.push(ctx.hook('run:end', p => { if (p.thread) delete p.thread._hookCtx; }));
      }
      if (has('PreToolUse')) disposers.push(ctx.hook('beforeTool', async p => {
        const r = await fire('PreToolUse', { thread_id: p.thread && p.thread.id, tool_name: p.name, tool_input: p.args }, p.name);
        if (r.decision === 'deny') return { block: r.reasons.join('; ') };
        if (r.decision === 'ask') { const ok = await DS.ui.confirm('Hook asks: allow “' + p.name + '”?\n' + r.reasons.join('; '), 'Allow'); if (!ok) return { block: 'denied after hook asked: ' + r.reasons.join('; ') }; }
        if (r.updatedInput) return { args: r.updatedInput };
      }));
      if (has('PostToolUse')) disposers.push(ctx.hook('afterTool', async p => {
        const r = await fire('PostToolUse', { thread_id: p.thread && p.thread.id, tool_name: p.name, tool_input: p.args, tool_response: p.result }, p.name);
        if (r.context.length) { const base = typeof p.result === 'string' ? p.result : JSON.stringify(p.result); return { result: base + '\n\n[Hook note] ' + r.context.join('\n') }; }
      }));
      if (has('Stop')) disposers.push(ctx.hook('run:end', async p => { const m = p.msg || {}; await fire('Stop', { thread_id: p.thread && p.thread.id, error: m.meta && m.meta.error || null, tools: (m.parts || []).filter(x => x.type === 'tool').map(x => ({ name: x.name, status: x.status })) }); }));
    }
    rewire();
    ctx.effect(() => () => disposers.forEach(d => { try { d(); } catch (_) {} }));

    /* ---- API ---- */
    function add(h) {
      if (!EVENTS[h.event]) throw new Error('unknown event ' + h.event + ' (use ' + Object.keys(EVENTS).join(', ') + ')');
      if (h.kind !== 'command') { try { new AsyncFn('event', 'DS', h.code || ''); } catch (e) { throw new Error('JS syntax error: ' + e.message); } }
      const it = { id: h.id || U.uid('hk'), name: String(h.name || h.event).slice(0, 80), event: h.event, matcher: h.matcher || '', kind: h.kind === 'command' ? 'command' : 'js', code: String(h.code || ''), enabled: h.enabled !== false };
      save(list().filter(x => x.id !== it.id).concat([it])); return it;
    }
    /* import Claude Code settings.json {hooks:{PreToolUse:[{matcher, hooks:[{type:'command',command}]}]}} or Forge export [] */
    function importJSON(txt) {
      const j = typeof txt === 'string' ? JSON.parse(txt) : txt; let n = 0;
      if (Array.isArray(j)) { j.forEach(h => { add(Object.assign({}, h, { id: undefined })); n++; }); return n; }
      const hk = j.hooks || j; for (const [ev, groups] of Object.entries(hk)) { if (!EVENTS[ev] || !Array.isArray(groups)) continue; for (const g of groups) for (const c of (g.hooks || [])) { if (c.type === 'command' && c.command) { add({ name: ev + ' · ' + c.command.slice(0, 40), event: ev, matcher: g.matcher || '', kind: 'command', code: c.command }); n++; } } }
      return n;
    }
    ctx.provide('forge.hooks', { list, add, remove: id => save(list().filter(x => x.id !== id)), toggle: (id, on) => save(list().map(x => x.id === id ? Object.assign({}, x, { enabled: on }) : x)), importJSON, events: () => Object.keys(EVENTS), runs: () => runs.slice(), templates: () => TEMPLATES.slice(), fire });

    /* ---- UI ---- */
    ctx.effect(() => { const s = document.createElement('style'); s.textContent = `
.hk-card{border:1px solid var(--line);border-radius:12px;padding:10px 12px;margin:0 0 8px;background:var(--card)}
.hk-card .hd{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.hk-card .hd b{flex:1;min-width:0}
.hk-card pre{background:var(--code-bg);border-radius:8px;padding:8px;margin:8px 0 0;font:12px/1.45 var(--mono);white-space:pre-wrap;word-break:break-word;max-height:160px;overflow:auto}
.hk-log{font:11px/1.5 var(--mono);color:var(--text-2);white-space:pre-wrap;word-break:break-word}
.hk-ed textarea{min-height:120px;font:12px/1.45 var(--mono)}`; document.head.appendChild(s); return () => s.remove(); });

    function editor(h, done) {
      h = h || { event: 'PreToolUse', matcher: '', kind: 'js', code: "// event: { hook_event_name, tool_name, tool_input, … }\n// return { decision: 'deny', reason: '…' } to block\n" };
      const body = U.el('div', { class: 'col hk-ed', style: 'gap:8px' });
      body.innerHTML = '<label class="field"><span>Name</span><input class="inp" data-k="name"></label>' +
        '<label class="field"><span>Event</span><select class="sel" data-k="event">' + Object.keys(EVENTS).map(e => '<option>' + e + '</option>').join('') + '</select></label>' +
        '<div class="xs muted" data-ev></div>' +
        '<label class="field"><span>Tool matcher (regex, tool events only; empty = all)</span><input class="inp mono" data-k="matcher" placeholder="^web_|fs_write"></label>' +
        '<div class="seg" data-kind><button data-v="js">JavaScript</button><button data-v="command">Bridge command</button></div>' +
        '<textarea class="inp" data-k="code" spellcheck="false"></textarea><div class="xs muted" data-hint></div>';
      const q = s => body.querySelector(s);
      q('[data-k=name]').value = h.name || ''; q('[data-k=event]').value = h.event; q('[data-k=matcher]').value = h.matcher || ''; q('[data-k=code]').value = h.code || '';
      let kind = h.kind || 'js';
      const sync = () => { q('[data-ev]').textContent = EVENTS[q('[data-k=event]').value].desc; body.querySelectorAll('[data-kind] button').forEach(b => b.classList.toggle('on', b.dataset.v === kind)); q('[data-hint]').textContent = kind === 'js' ? 'Async function body. Gets (event, DS). Return {decision, reason, updatedInput, additionalContext} or nothing.' : 'Runs via the local bridge with the event JSON in $FORGE_EVENT. Exit code 2 = deny (stderr is the reason); JSON on stdout is parsed as the decision.'; };
      q('[data-k=event]').onchange = sync; body.querySelectorAll('[data-kind] button').forEach(b => b.onclick = () => { kind = b.dataset.v; sync(); }); sync();
      DS.ui.sheet({ title: h.id ? 'Edit hook' : 'New hook', node: body, actions: [
        { label: 'Cancel', onClick: c => c() },
        { label: 'Save', primary: true, onClick: c => { try { add({ id: h.id, name: q('[data-k=name]').value, event: q('[data-k=event]').value, matcher: q('[data-k=matcher]').value.trim(), kind, code: q('[data-k=code]').value, enabled: h.enabled }); c(); done && done(); ctx.toast('Hook saved', 'ok'); } catch (e) { ctx.toast(e.message, 'err', 4000); } } }] });
    }

    function render(el) {
      const hs = list();
      el.innerHTML = '<div class="xs muted" style="margin:0 0 10px">Same event names as Codex / Claude Code / Gemini CLI. JS hooks run in this page with plugin-level trust — only add code you understand.</div>' +
        '<div class="row" style="gap:8px;flex-wrap:wrap;margin:0 0 10px"><button class="btn sm pri" data-a="new">New hook</button><button class="btn sm" data-a="tpl">From template</button><button class="btn sm" data-a="imp">Import JSON</button><button class="btn sm" data-a="exp">Export</button></div>' +
        (hs.length ? hs.map(h => '<div class="hk-card" data-id="' + esc(h.id) + '"><div class="hd"><b>' + esc(h.name) + '</b><span class="chip acc">' + esc(h.event) + '</span>' + (h.matcher ? '<span class="chip mono">' + esc(h.matcher) + '</span>' : '') + '<span class="chip">' + (h.kind === 'command' ? 'bridge cmd' : 'js') + '</span></div><pre>' + esc(h.code) + '</pre><div class="row" style="gap:6px;margin-top:8px"><button class="btn sm" data-h="tog">' + (h.enabled === false ? 'Enable' : 'Disable') + '</button><button class="btn sm" data-h="edit">Edit</button><button class="btn sm danger" data-h="del">Delete</button></div></div>').join('') : '<div class="muted sm" style="padding:8px 0">No hooks yet.</div>') +
        '<div class="sec-t" style="margin-top:12px">Recent hook runs</div><div class="hk-log" data-log>' + (runs.length ? runs.slice(0, 20).map(r => new Date(r.ts).toLocaleTimeString() + ' ' + esc(r.event) + ' · ' + esc(r.name) + (r.err ? ' ✕ ' + esc(r.err) : r.out ? ' → ' + esc(r.out) : ' → (no decision)')).join('\n') : 'none yet') + '</div>';
      const redraw = () => render(el);
      el.querySelector('[data-a=new]').onclick = () => editor(null, redraw);
      el.querySelector('[data-a=tpl]').onclick = () => DS.ui.menu(TEMPLATES.map(t => ({ label: t.name, run: () => { add(t); redraw(); ctx.toast('Added “' + t.name + '”', 'ok'); } })), 'Hook templates');
      el.querySelector('[data-a=imp]').onclick = async () => { const t = await DS.ui.promptText('Paste Forge hooks JSON or a Claude Code settings.json', ''); if (!t) return; try { const n = importJSON(t); ctx.toast('Imported ' + n + ' hook(s)', 'ok'); redraw(); } catch (e) { ctx.toast('Import failed: ' + e.message, 'err'); } };
      el.querySelector('[data-a=exp]').onclick = () => U.download('forge-hooks.json', JSON.stringify(list(), null, 2), 'application/json');
      el.querySelectorAll('.hk-card').forEach(c => { const id = c.dataset.id; const h = list().find(x => x.id === id);
        c.querySelector('[data-h=tog]').onclick = () => { save(list().map(x => x.id === id ? Object.assign({}, x, { enabled: x.enabled === false }) : x)); redraw(); };
        c.querySelector('[data-h=edit]').onclick = () => editor(h, redraw);
        c.querySelector('[data-h=del]').onclick = async () => { if (await DS.ui.confirm('Delete hook “' + h.name + '”?', 'Delete')) { save(list().filter(x => x.id !== id)); redraw(); } }; });
    }
    ctx.settings({ id: 'hooks', title: 'Hooks', order: 60, render });
    ctx.command({ name: 'hooks', desc: 'Manage lifecycle hooks (PreToolUse, PostToolUse, …)', run: () => DS.ui.panel({ title: 'Hooks', render: body => { const el = U.el('div'); body.appendChild(el); render(el); } }) });
    ctx.status({ id: 'hooks', align: 'right', order: 8, text: () => { const n = list().filter(x => x.enabled !== false).length; return n ? 'hooks ' + n : ''; }, onClick: () => DS.ui.panel({ title: 'Hooks', render: body => { const el = U.el('div'); body.appendChild(el); render(el); } }) });
    ctx.suggest({ id: 'hooks-demo', emoji: '🪝', title: 'Add a safety hook', sub: 'Block destructive commands before they run', run: () => { if (!list().some(h => h.name === TEMPLATES[0].name)) add(TEMPLATES[0]); ctx.toast('Hook “' + TEMPLATES[0].name + '” added — see /hooks', 'ok'); } });
  }
});
