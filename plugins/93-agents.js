/* forge.agents — orchestrator + subagents with per-role models.
   Roles map to {provider, model, prompt, tools(groups), maxSteps}. spawn_subagent runs a hidden child thread pinned via
   thread.route; agents_wait / agents_status collect results. Orchestrate pill turns the main model into a planner/merger. */
DS.plugin({
  name: 'forge.agents', title: 'Agents', version: '0.1.0',
  description: 'Orchestrator + subagents with per-role models (Coder, Researcher, Reviewer, Fast, custom), parallel spawn_subagent, live Agents view.',
  apply(ctx) {
    const U = DS.util, esc = U.esc;
    const GROUPS = ['files', 'web', 'run', 'apps', 'media', 'all'];
    const DEFAULT_ROLES = {
      orchestrator: { label: 'Orchestrator', provider: '', model: '', prompt: 'Plan, delegate independent parts, review and merge.', tools: ['all'], maxSteps: 14, builtin: true },
      coder: { label: 'Coder', provider: '', model: '', prompt: 'You write and edit code. Read before editing, keep diffs small, verify what you can.', tools: ['files', 'run', 'apps'], maxSteps: 10, builtin: true },
      researcher: { label: 'Researcher', provider: '', model: '', prompt: 'You gather facts (workspace files, web tools if available) and report them with sources. Do not modify files.', tools: ['files', 'web'], maxSteps: 8, builtin: true },
      reviewer: { label: 'Reviewer', provider: '', model: '', prompt: 'You review work for bugs, risks and gaps. Be specific and brief. Do not modify files.', tools: ['files'], maxSteps: 6, builtin: true },
      fast: { label: 'Fast (cheap)', provider: '', model: '', prompt: 'Answer quickly and tersely; use as few tool calls as possible.', tools: ['files'], maxSteps: 4, builtin: true }
    };
    const NO_CHILD = new Set(['spawn_subagent', 'agents_wait', 'agents_status', 'delegate', 'ask_user']);
    const ALWAYS = new Set(['tool_help', 'update_plan', 'use_skill']);
    const TIME_BUDGET = 5 * 60 * 1000;
    const groupOf = name => {
      const n = String(name || '');
      if (/^(fs_|repo_map|file_|zip_|read_|search_files)/.test(n)) return 'files';
      if (/(web_|fetch|http|browse|search|url|mcp_)/.test(n)) return 'web';
      if (/(shell|run_js|exec|terminal|python|eval|_run$|^run_)/.test(n)) return 'run';
      if (/^(app_|preview|ide_)/.test(n)) return 'apps';
      if (/(image|media|genart|voice|tts|audio|video|speak|draw)/.test(n)) return 'media';
      return 'other';
    };

    /* ---------- role store (persisted) ---------- */
    function roles() {
      const saved = ctx.data.get('roles', {}) || {}; const out = {};
      for (const [id, r] of Object.entries(DEFAULT_ROLES)) out[id] = Object.assign({}, r, saved[id] || {}, { builtin: true });
      for (const [id, r] of Object.entries(saved)) if (!out[id] && r && !r.deleted) out[id] = Object.assign({ label: id, provider: '', model: '', prompt: '', tools: ['files'], maxSteps: 6 }, r, { builtin: false });
      return out;
    }
    function role(id) { const rs = roles(); return rs[String(id || '').toLowerCase()] || rs[Object.keys(rs).find(k => rs[k].label.toLowerCase() === String(id || '').toLowerCase())] || null; }
    function setRole(id, patch) {
      id = String(id || '').toLowerCase().replace(/[^a-z0-9_-]/g, '-').slice(0, 32); if (!id) throw new Error('role id required');
      const saved = Object.assign({}, ctx.data.get('roles', {}) || {}); const cur = Object.assign({}, saved[id] || {});
      for (const k of ['label', 'provider', 'model', 'prompt', 'tools', 'maxSteps']) if (patch && k in patch) cur[k] = patch[k];
      if (cur.tools) cur.tools = [].concat(cur.tools).filter(g => GROUPS.includes(g));
      if (cur.maxSteps != null) cur.maxSteps = Math.max(1, Math.min(30, parseInt(cur.maxSteps, 10) || 6));
      saved[id] = cur; ctx.data.set('roles', saved); ctx.emit('agents:update', { kind: 'roles' }); return roles()[id];
    }
    function removeRole(id) { if (DEFAULT_ROLES[id]) { const s = Object.assign({}, ctx.data.get('roles', {})); delete s[id]; ctx.data.set('roles', s); } else { const s = Object.assign({}, ctx.data.get('roles', {})); delete s[id]; ctx.data.set('roles', s); } ctx.emit('agents:update', { kind: 'roles' }); }
    const concurrency = () => Math.max(1, Math.min(8, parseInt(ctx.data.get('concurrency', 3), 10) || 3));

    /* ---------- usable models (key / keyless / local / sim / plugin provider available) ---------- */
    function usableModels() {
      const M = ctx.service('forge.models'); const provs = DS.kernel.list('provider'); const avail = pid => { const p = provs.find(x => x.id === pid); try { return !!p && (!p.available || !!p.available()); } catch (_) { return false; } };
      const out = []; const seen = new Set();
      let cat = []; try { cat = M && M.catalog ? M.catalog() : []; } catch (_) { cat = []; }
      for (const m of cat) {
        const ok = m.provider === 'sim' || m.keyless || m.route === 'local' || (M.hasKey && M.hasKey(m.provider)) || avail(m.provider);
        if (!ok || !provs.some(p => p.id === m.provider)) continue; const k = m.provider + '::' + m.id; if (seen.has(k)) continue; seen.add(k);
        out.push({ provider: m.provider, id: m.id, label: m.label || m.id, tag: m.verified === false ? 'unverified' : (m.tag || '') });
      }
      for (const p of provs) { if (!avail(p.id)) continue; for (const mid of (p.models || [])) { const k = p.id + '::' + mid; if (seen.has(k)) continue; seen.add(k); out.push({ provider: p.id, id: mid, label: (p.label || p.id) + ' · ' + mid, tag: '' }); } }
      return out;
    }
    const provName = pid => { const p = DS.kernel.list('provider').find(x => x.id === pid); return p ? (p.label || p.id) : pid; };

    /* ---------- jobs ---------- */
    const jobs = new Map(); /* id → job */
    let running = 0; const queue = [];
    const emit = (j) => { ctx.emit('agents:update', { kind: 'job', id: j && j.id }); hideCss(); };
    const pub = j => ({ id: j.id, role: j.roleId, role_label: j.roleLabel, provider: j.provider, model: j.model, task: j.task, status: j.status, steps: j.steps, elapsed_ms: (j.ended || Date.now()) - (j.started || j.created), thread: j.threadId, parent: j.parentId });
    const result = j => ({ id: j.id, role: j.roleLabel, model: (j.provider ? j.provider + ' · ' : '') + (j.model || 'default'), status: j.status, answer: j.answer || '', tools_used: j.tools_used || [], files_changed: j.files_changed || [], steps: j.steps, error: j.error || undefined });
    function findThread(id) { return DS.store.threads().find(t => t.id === id) || null; }
    function slot() { return new Promise(res => { if (running < concurrency()) { running++; res(); } else queue.push(res); }); }
    function release() { running = Math.max(0, running - 1); while (queue.length && running < concurrency()) { running++; queue.shift()(); } }

    function makeChild(parent, r, roleId, task) {
      const st = DS.store; const now = Date.now();
      const route = r.provider ? { provider: r.provider, model: r.model || '' } : (parent && parent.route ? Object.assign({}, parent.route) : null);
      const t = { id: U.uid('t'), title: '↳ ' + r.label + ': ' + String(task).replace(/\s+/g, ' ').slice(0, 40), created: now, updated: now, mode: 'act', permission: (parent && parent.permission) || st.settings().permission || null, messages: [], plan: null, goal: null, taint: (parent && parent.taint) || 'low', changes: {}, allow: {}, usage: { in: 0, out: 0 }, titled: true,
        hidden: true, parentId: parent ? parent.id : null, agentRole: roleId, route: route || undefined, agent: { role: roleId, label: r.label, task: String(task), status: 'queued', created: now } };
      if (!route) delete t.route;
      st.threads().push(t); st.save(); return t;
    }

    function spawn(a, tctx) {
      const parent = (tctx && tctx.thread) || DS.store.activeThread();
      const rs = roles(); const roleId = String(a.role || 'coder').toLowerCase();
      const rid = rs[roleId] ? roleId : (Object.keys(rs).find(k => String(rs[k].label).toLowerCase() === roleId) || 'coder'); const r = rs[rid];
      const task = String(a.task || a.prompt || '').trim(); if (!task) throw new Error('spawn_subagent needs a task');
      const allowed = a.tools ? [].concat(a.tools).map(String).filter(g => GROUPS.includes(g)) : (r.tools || ['files']);
      const child = makeChild(parent, r, rid, task);
      const j = { id: U.uid('ag'), roleId: rid, roleLabel: r.label, provider: child.route ? child.route.provider : '', model: child.route ? child.route.model : '', task, status: 'queued', steps: 0, maxSteps: r.maxSteps || 6, groups: allowed.length ? allowed : ['files'], created: Date.now(), threadId: child.id, parentId: parent ? parent.id : null, thread: child, prompt: r.prompt || '' };
      jobs.set(j.id, j); simTasks.add(task); emit(j);
      const onAbort = () => stop(j.id, 'stopped');
      if (tctx && tctx.signal) { if (tctx.signal.aborted) onAbort(); else tctx.signal.addEventListener('abort', onAbort, { once: true }); }
      j.promise = (async () => {
        await slot();
        try {
          if (j.status !== 'queued') return result(j);
          j.status = 'running'; j.started = Date.now(); child.agent.status = 'running'; child.agent.started = j.started; emit(j);
          j.timer = setTimeout(() => stop(j.id, 'timeout'), TIME_BUDGET);
          let msg = null;
          try { msg = await DS.agent.run(child, task, { mode: 'act' }); } catch (e) { j.error = e.message || String(e); }
          clearTimeout(j.timer);
          const m = msg || child.messages.filter(x => x.role === 'assistant').pop();
          const parts = (m && m.parts) || [];
          j.answer = parts.filter(p => p.type === 'text').map(p => p.text).join('\n').trim();
          j.tools_used = parts.filter(p => p.type === 'tool').map(p => p.name);
          j.files_changed = Object.keys(child.changes || {});
          if (m && m.meta) { if (m.meta.provider) j.provider = m.meta.provider; if (m.meta.model) j.model = m.meta.model; if (m.meta.error) j.error = m.meta.error; }
          if (j.status === 'running') j.status = (m && m.meta && m.meta.aborted) ? 'stopped' : (j.error ? 'error' : 'done');
          if (!j.answer) j.answer = j.error ? 'subagent error: ' + j.error : (j.status === 'done' ? '(no text)' : '(' + j.status + ')');
          /* surface the child's file changes in the parent so they can be reviewed / reverted there */
          if (parent && j.files_changed.length) { parent.changes = parent.changes || {}; for (const p of j.files_changed) if (!(p in parent.changes)) parent.changes[p] = child.changes[p]; DS.bus.emit('changes:update', parent); }
        } finally {
          clearTimeout(j.timer); j.ended = Date.now(); release();
          if (tctx && tctx.signal) tctx.signal.removeEventListener('abort', onAbort);
          Object.assign(child.agent, { status: j.status, ended: j.ended, steps: j.steps, provider: j.provider, model: j.model, answer: String(j.answer || '').slice(0, 2000) });
          simTasks.delete(task); DS.store.save(); emit(j);
        }
        return result(j);
      })();
      return j;
    }
    function stop(id, why) {
      const j = jobs.get(id); if (!j) return false;
      if (j.status === 'queued') { j.status = why || 'stopped'; emit(j); return true; }
      if (j.status !== 'running') return false;
      j.status = why || 'stopped'; try { DS.agent.stop(j.thread); } catch (_) {} emit(j); return true;
    }
    async function wait(ids, signal, timeoutMs) {
      const list = ids.map(i => jobs.get(i)).filter(Boolean);
      const missing = ids.filter(i => !jobs.has(i));
      const all = Promise.all(list.map(j => j.promise));
      const races = [all];
      let onAbort = null, tm = null;
      if (signal) races.push(new Promise((_, rej) => { const ab = () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' })); if (signal.aborted) return ab(); onAbort = ab; signal.addEventListener('abort', ab, { once: true }); }));
      if (timeoutMs) races.push(new Promise(res => { tm = setTimeout(() => res(null), timeoutMs); }));
      let r; try { r = await Promise.race(races); } finally { if (tm) clearTimeout(tm); if (onAbort) signal.removeEventListener('abort', onAbort); }
      return { results: r || list.map(result), missing: missing.length ? missing : undefined, timed_out: r === null || undefined };
    }

    /* ---------- child-thread enforcement: tools by group, step cap, role prompt ---------- */
    const jobOf = t => { if (!t || !(t.hidden || t.agentRole || t.parentId)) return null; for (const j of jobs.values()) if (j.threadId === t.id) return j; return null; };  /* still enforced after “Un-hide & open” */
    ctx.hook('beforeModel', pre => {
      const j = jobOf(pre && pre.thread); if (!j) return;
      j.steps++; emit(j);
      const all = j.groups.includes('all');
      if (pre.tools) pre.tools = pre.tools.filter(t => !NO_CHILD.has(t.name) && (all || ALWAYS.has(t.name) || j.groups.includes(groupOf(t.name))));
      if (j.steps > j.maxSteps) { pre.tools = []; if (pre.messages) pre.messages.push({ role: 'user', content: '[FORGE] Subagent step budget (' + j.maxSteps + ') reached. Reply now with your final answer; no more tool calls.' }); }
      if (j.steps > j.maxSteps + 1) setTimeout(() => stop(j.id, 'stopped'), 0);
    }, { order: 5 });
    ctx.hook('beforeTool', p => {
      const j = jobOf(p && p.thread); if (!j) return;
      if (NO_CHILD.has(p.name)) return { block: p.name + ' is not available inside a subagent' };
      if (!j.groups.includes('all') && !ALWAYS.has(p.name) && !j.groups.includes(groupOf(p.name))) return { block: p.name + ' is outside this role’s tool groups (' + j.groups.join(', ') + ')' };
    });
    ctx.prompt({ id: 'agents-sub', build: t => {
      if (!t || !t.agentRole) return '';
      const r = role(t.agentRole) || {}; const j = jobOf(t);
      return '## SUBAGENT\nYou are a subagent (role: ' + (r.label || t.agentRole) + ') working for an orchestrator. ' + (r.prompt || '') + '\nWork only on your task, without asking the user anything. Budget: ' + ((j && j.maxSteps) || r.maxSteps || 6) + ' steps. Finish with a concise final answer: what you found or changed (file paths), and anything unverified.';
    } });

    /* ---------- orchestrate mode ---------- */
    const PILL = 'agents-orchestrate';
    const orchOn = () => !!(DS.store.state.toggles || {})[PILL];
    ctx.pill({ id: PILL, label: 'Orchestrate', icon: 'orgchart', title: 'Main model plans and spawns subagents per role, then merges their results' });
    ctx.prompt({ id: 'agents-orch', build: t => {
      if (!orchOn() || (t && (t.hidden || t.parentId))) return '';
      const rs = roles();
      return '## ORCHESTRATOR MODE\nYou are the ORCHESTRATOR. 1) Break the task into independent parts. 2) For each part call spawn_subagent {task, role} with the best role — pass wait:false to start several in parallel, then agents_wait {ids}. 3) Review and merge the results (check files_changed; re-spawn a Reviewer if risky). 4) Answer with the merged result. Do small, sequential steps yourself.\nRoles: ' + Object.entries(rs).filter(([k]) => k !== 'orchestrator').map(([k, r]) => k + ' (' + r.label + '; tools ' + (r.tools || []).join('/') + (r.provider ? '; ' + r.provider + ' · ' + (r.model || 'default') : '') + ')').join(', ') + '.';
    } });
    function applyOrchRoute(t) {
      if (!t || t.hidden || t.parentId) return;
      const o = role('orchestrator');
      if (orchOn() && o && o.provider) { if (!t._agentsRouted) { t._agentsPrevRoute = t.route || null; t._agentsRouted = true; } t.route = { provider: o.provider, model: o.model || '' }; }
      else if (t._agentsRouted) { if (t._agentsPrevRoute) t.route = t._agentsPrevRoute; else delete t.route; delete t._agentsPrevRoute; delete t._agentsRouted; }
    }
    ctx.hook('run:start', p => { applyOrchRoute(p && p.thread); });
    ctx.on('pill:toggle', e => { if (e && e.id === PILL) applyOrchRoute(DS.store.activeThread()); });

    /* ---------- tools ---------- */
    const roleIds = () => Object.keys(roles());
    ctx.tool({ name: 'spawn_subagent', gate: 'none', label: 'Subagent', icon: 'orgchart',
      description: 'Start a subagent on a self-contained task in its own hidden thread with the role’s model and tool groups (same permission tier). Several calls run in parallel (max ' + 3 + ' at once by default). wait:false returns a handle id at once — collect with agents_wait. Returns {role, model, answer, tools_used, files_changed}.',
      parameters: { type: 'object', properties: { task: { type: 'string', description: 'self-contained task with all needed context' }, role: { type: 'string', description: 'coder | researcher | reviewer | fast | orchestrator | a custom role id' }, tools: { type: 'array', items: { type: 'string', enum: GROUPS }, description: 'override tool groups' }, wait: { type: 'boolean', description: 'default true' } }, required: ['task'] },
      async run(a, tctx) {
        const j = spawn(a, tctx);
        if (a.wait === false) return { id: j.id, role: j.roleLabel, model: (j.provider ? j.provider + ' · ' : '') + (j.model || 'default'), status: j.status, thread: j.threadId, note: 'running in background — call agents_wait {"ids":["' + j.id + '"]}' };
        const onAbort = () => stop(j.id, 'stopped'); if (tctx && tctx.signal) tctx.signal.addEventListener('abort', onAbort, { once: true });
        try { return await j.promise; } finally { if (tctx && tctx.signal) tctx.signal.removeEventListener('abort', onAbort); }
      },
      summarize: (a, r) => r ? (r.role + ' · ' + (r.status || '') + (r.tools_used ? ' · ' + r.tools_used.length + ' tools' : '')) : '' });
    ctx.tool({ name: 'agents_wait', gate: 'none', label: 'Wait for subagents', icon: 'orgchart',
      description: 'Wait for background subagents (ids from spawn_subagent wait:false; omit ids = all of this thread’s running ones) and return their results.',
      parameters: { type: 'object', properties: { ids: { type: 'array', items: { type: 'string' } }, timeout_s: { type: 'integer', description: 'optional cap, seconds' } } },
      async run(a, tctx) {
        const pid = tctx && tctx.thread && tctx.thread.id;
        let ids = [].concat(a.ids || []).map(String).filter(Boolean);
        if (!ids.length) ids = [...jobs.values()].filter(j => j.parentId === pid && (j.status === 'running' || j.status === 'queued' || !j.collected)).map(j => j.id);
        const r = await wait(ids, tctx && tctx.signal, a.timeout_s ? a.timeout_s * 1000 : 0);
        ids.forEach(i => { const j = jobs.get(i); if (j) j.collected = true; }); return r;
      },
      summarize: (a, r) => r && r.results ? r.results.length + ' result' + (r.results.length === 1 ? '' : 's') : '' });
    ctx.tool({ name: 'agents_status', gate: 'none', label: 'Subagent status', icon: 'orgchart',
      description: 'List subagents (running and finished) with role, model, status, steps and elapsed time, plus the configured roles.',
      parameters: { type: 'object', properties: {} },
      async run() { return { jobs: [...jobs.values()].map(pub), roles: Object.fromEntries(Object.entries(roles()).map(([k, r]) => [k, { label: r.label, provider: r.provider || '(inherit)', model: r.model || '(default)', tools: r.tools, maxSteps: r.maxSteps }])), concurrency: concurrency() }; },
      summarize: (a, r) => r ? r.jobs.length + ' subagents' : '' });

    /* ---------- hide child threads in the sidebar (stopgap until core filters thread.hidden) ---------- */
    let styleEl = null;
    function hideCss() {
      try {
        if (!styleEl) { styleEl = document.createElement('style'); styleEl.id = 'agents-hide'; document.head.appendChild(styleEl); }
        const ids = DS.store.threads().filter(t => t.hidden).map(t => String(t.id).replace(/[^a-zA-Z0-9_-]/g, ''));
        styleEl.textContent = ids.length ? ids.map(i => '.th-i:has([data-t="' + i + '"])').join(',') + '{display:none!important}' : '';
      } catch (_) {}
    }
    ctx.effect(() => () => { if (styleEl) styleEl.remove(); });
    ctx.on('sidebar:refresh', () => hideCss()); ctx.on('workspace:switch', () => hideCss()); ctx.setTimeout(hideCss, 50);

    /* ---------- UI: role editor (Agents view + Settings) ---------- */
    if (!DS.icons.orgchart) DS.icons.orgchart = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="3" width="6" height="5" rx="1"/><rect x="3" y="16" width="6" height="5" rx="1"/><rect x="15" y="16" width="6" height="5" rx="1"/><path d="M12 8v4M6 16v-2h12v2"/></svg>';
    const CSS = '.ag{max-width:100%;overflow-x:hidden;box-sizing:border-box}.ag *{box-sizing:border-box}.ag .ag-r{border:1px solid var(--line);border-radius:12px;padding:10px;margin:8px 0;background:var(--card)}.ag .ag-h{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.ag .ag-h b{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis}.ag select,.ag input,.ag textarea{width:100%;max-width:100%;min-height:40px;font:inherit;color:var(--text);background:var(--bg-2);border:1px solid var(--line);border-radius:8px;padding:6px 8px}.ag textarea{min-height:56px;resize:vertical}.ag .ag-g{display:flex;flex-wrap:wrap;gap:6px;margin:6px 0}.ag .ag-g label{display:inline-flex;align-items:center;gap:4px;min-height:40px;padding:0 8px;border:1px solid var(--line);border-radius:999px;font-size:13px}.ag .ag-g input{width:auto;min-height:0}.ag .ag-row{display:flex;gap:8px;flex-wrap:wrap;align-items:center}.ag .ag-row>*{flex:1 1 140px;min-width:0}.ag .btn{min-height:40px}.ag .ag-t{font-size:12px;color:var(--muted);word-break:break-word}.ag .ag-j{border:1px solid var(--line);border-radius:10px;padding:8px 10px;margin:6px 0;background:var(--card)}.ag .ag-j .ag-task{word-break:break-word;margin:4px 0}.ag .st{font-size:11px;padding:2px 8px;border-radius:999px;border:1px solid var(--line)}.ag .st.running{color:var(--accent);border-color:var(--accent-line)}.ag .st.done{color:var(--ok)}.ag .st.error,.ag .st.timeout{color:var(--danger)}.ag .st.stopped{color:var(--warn)}.ag h3{margin:12px 0 4px;font-size:15px}';
    function ensureCss() { if (document.getElementById('agents-css')) return; const s = document.createElement('style'); s.id = 'agents-css'; s.textContent = CSS; document.head.appendChild(s); }
    ctx.effect(() => () => { const s = document.getElementById('agents-css'); if (s) s.remove(); });

    function modelOptions(r) {
      const ms = usableModels(); const cur = r.provider ? r.provider + '::' + (r.model || '') : '';
      let h = '<option value=""' + (cur ? '' : ' selected') + '>Inherit (current model)</option>'; let found = !cur;
      const byP = {}; ms.forEach(m => (byP[m.provider] = byP[m.provider] || []).push(m));
      for (const [pid, list] of Object.entries(byP)) { h += '<optgroup label="' + esc(provName(pid)) + '">'; for (const m of list) { const v = pid + '::' + m.id; if (v === cur) found = true; h += '<option value="' + esc(v) + '"' + (v === cur ? ' selected' : '') + '>' + esc(m.label + (m.tag === 'unverified' ? ' (unverified)' : '')) + '</option>'; } h += '</optgroup>'; }
      if (!found) h += '<option value="' + esc(cur) + '" selected>' + esc(r.provider + ' · ' + (r.model || 'default')) + ' (not usable now)</option>';
      return h;
    }
    async function testRole(id, out) {
      const r = role(id); out.textContent = 'testing…';
      const pid = r.provider || (DS.providers.pick(null) || {}).id; const p = DS.kernel.list('provider').find(x => x.id === pid);
      if (!p) { out.textContent = 'no provider “' + pid + '”'; return; }
      const ac = new AbortController(); const to = setTimeout(() => ac.abort(), 20000); const t0 = Date.now(); let txt = '';
      try {
        const model = p.id === 'sim' ? 'sim' : (r.model || (r.provider ? '' : DS.agent.model('executor')));
        const res = await p.stream({ messages: [{ role: 'system', content: 'Connectivity test. Reply with the single word OK.' }, { role: 'user', content: 'Reply with OK.' }], tools: [], model, forceModel: r.model || undefined, signal: ac.signal, onDelta: d => { if (d && d.content) txt += d.content; }, temperature: 0 });
        txt = (res && res.content) || txt; out.textContent = '✓ ' + provName(p.id) + ' · ' + (model || 'default') + ' replied in ' + ((Date.now() - t0) / 1000).toFixed(1) + 's: “' + String(txt).trim().slice(0, 60) + '”';
      } catch (e) { out.textContent = '✗ ' + (e.name === 'AbortError' ? 'timed out after 20s' : (e.message || String(e))).slice(0, 220); }
      finally { clearTimeout(to); }
    }
    function renderRoles(el) {
      ensureCss(); const rs = roles();
      let h = '<div class="ag-t">Models listed are the usable ones (key saved, keyless, local, plugin or Sim). “Inherit” follows the main model picker.</div>';
      for (const [id, r] of Object.entries(rs)) {
        h += '<div class="ag-r" data-role="' + esc(id) + '"><div class="ag-h"><b>' + esc(r.label) + '</b><span class="ag-t mono">' + esc(id) + '</span>' + (r.builtin ? '' : '<button class="btn sm" data-del>Delete</button>') + '<button class="btn sm" data-test>Test</button></div>' +
          '<select data-k="model" aria-label="Model for ' + esc(r.label) + '">' + modelOptions(r) + '</select>' +
          '<div class="ag-g">' + GROUPS.map(g => '<label><input type="checkbox" data-g="' + g + '"' + ((r.tools || []).includes(g) ? ' checked' : '') + '>' + g + '</label>').join('') + '</div>' +
          '<div class="ag-row"><label class="ag-t">Max steps <input type="number" min="1" max="30" data-k="maxSteps" value="' + esc(String(r.maxSteps || 6)) + '"></label></div>' +
          '<textarea data-k="prompt" placeholder="System prompt add-on" aria-label="Prompt add-on">' + esc(r.prompt || '') + '</textarea><div class="ag-t" data-out></div></div>';
      }
      h += '<div class="ag-row"><input data-new placeholder="New role name (e.g. Designer)" aria-label="New role name"><button class="btn" data-add>Add role</button></div>' +
        '<div class="ag-row"><label class="ag-t">Max parallel subagents <input type="number" min="1" max="8" data-conc value="' + concurrency() + '"></label></div>';
      el.innerHTML = h;
      el.querySelectorAll('.ag-r').forEach(box => {
        const id = box.dataset.role;
        box.querySelector('[data-k="model"]').onchange = e => { const v = e.target.value; const [pv, ...mv] = v.split('::'); setRole(id, { provider: v ? pv : '', model: v ? mv.join('::') : '' }); };
        box.querySelectorAll('[data-g]').forEach(c => { c.onchange = () => setRole(id, { tools: [...box.querySelectorAll('[data-g]:checked')].map(x => x.dataset.g) }); });
        box.querySelector('[data-k="maxSteps"]').onchange = e => setRole(id, { maxSteps: e.target.value });
        box.querySelector('[data-k="prompt"]').onchange = e => setRole(id, { prompt: e.target.value });
        box.querySelector('[data-test]').onclick = () => testRole(id, box.querySelector('[data-out]'));
        const d = box.querySelector('[data-del]'); if (d) d.onclick = () => { removeRole(id); renderRoles(el); };
      });
      el.querySelector('[data-add]').onclick = () => { const n = el.querySelector('[data-new]').value.trim(); if (!n) return; setRole(n, { label: n, tools: ['files'], maxSteps: 6 }); renderRoles(el); };
      el.querySelector('[data-conc]').onchange = e => { ctx.data.set('concurrency', Math.max(1, Math.min(8, parseInt(e.target.value, 10) || 3))); };
    }
    ctx.settings({ id: 'agents', title: 'Agents · roles & models', order: 45, render(el) { el.classList.add('ag'); renderRoles(el); } });

    /* ---------- Agents view: roles + live panel ---------- */
    const fmtMs = ms => { const s = Math.round(ms / 1000); return s < 60 ? s + 's' : Math.floor(s / 60) + 'm ' + (s % 60) + 's'; };
    function allJobs() {
      const out = [...jobs.values()].map(pub); const have = new Set(out.map(j => j.thread));
      for (const t of DS.store.threads()) if (t.agent && t.parentId && !have.has(t.id)) out.push({ id: '', role: t.agent.role, role_label: t.agent.label, provider: t.agent.provider || (t.route && t.route.provider) || '', model: t.agent.model || (t.route && t.route.model) || '', task: t.agent.task, status: t.agent.status === 'running' || t.agent.status === 'queued' ? 'interrupted' : t.agent.status, steps: t.agent.steps || 0, elapsed_ms: (t.agent.ended || t.updated) - (t.agent.started || t.created), thread: t.id, parent: t.parentId, past: true });
      return out.sort((a, b) => (b.status === 'running') - (a.status === 'running'));
    }
    function openThread(tid, unhide) {
      const t = findThread(tid); if (!t) { ctx.toast('Thread not found', 'err'); return; }
      if (unhide) { t.hidden = false; DS.store.save(); hideCss(); DS.store.setActive(t.id); DS.bus.emit('sidebar:refresh'); try { DS.shell.show('thread'); } catch (_) {} return; }
      const body = (t.messages || []).map(m => m.role === 'user' ? '<div class="ag-j"><b>Task</b><div class="ag-task">' + esc(m.content) + '</div></div>' : '<div class="ag-j"><b>' + esc((m.meta && (m.meta.provider + ' · ' + m.meta.model)) || 'assistant') + '</b>' + (m.parts || []).map(p => p.type === 'tool' ? '<div class="ag-t">⚙ ' + esc(p.name) + ' · ' + esc(p.status || '') + (p.summary ? ' · ' + esc(p.summary) : '') + '</div>' : (p.type === 'text' ? '<div class="ag-task">' + esc(p.text) + '</div>' : '')).join('') + (m.meta && m.meta.error ? '<div class="ag-t">error: ' + esc(m.meta.error) + '</div>' : '') + '</div>').join('');
      DS.ui.sheet({ title: t.title, html: '<div class="ag">' + (body || '<div class="ag-t">No messages yet.</div>') + '</div>', actions: [{ label: 'Un-hide & open', primary: true, onClick: c => { c(); openThread(tid, true); } }] });
    }
    ctx.view({ id: 'agents', title: 'Agents', icon: 'orgchart', order: 42,
      badge: () => { const n = [...jobs.values()].filter(j => j.status === 'running').length; return n ? String(n) : ''; },
      mount(el) {
        ensureCss(); el.classList.add('ag'); el.style.padding = '12px 16px'; el.style.overflowY = 'auto';
        el.innerHTML = '<h3>Subagents</h3><div data-live></div><h3>Roles</h3><div data-roles></div>';
        const live = el.querySelector('[data-live]'), rolesEl = el.querySelector('[data-roles]');
        const draw = () => {
          const js = allJobs();
          live.innerHTML = js.length ? js.map(j => '<div class="ag-j" data-j="' + esc(j.id) + '" data-th="' + esc(j.thread) + '"><div class="ag-h"><b>' + esc(j.role_label || j.role) + '</b><span class="st ' + esc(j.status) + '">' + esc(j.status) + '</span></div>' +
            '<div class="ag-t">' + esc((j.provider ? provName(j.provider) + ' · ' : 'inherit · ') + (j.model || 'default')) + ' · ' + j.steps + ' steps · ' + fmtMs(Math.max(0, j.elapsed_ms || 0)) + '</div><div class="ag-task">' + esc(String(j.task || '').slice(0, 240)) + '</div>' +
            '<div class="ag-row">' + (j.status === 'running' || j.status === 'queued' ? '<button class="btn sm" data-stop>Stop</button>' : '') + '<button class="btn sm" data-open>Open thread</button></div></div>').join('') : '<div class="ag-t">No subagents yet. Turn on the <b>Orchestrate</b> pill or ask the agent to use spawn_subagent.</div>';
          live.querySelectorAll('.ag-j').forEach(b => { const s = b.querySelector('[data-stop]'); if (s) s.onclick = () => stop(b.dataset.j, 'stopped'); b.querySelector('[data-open]').onclick = () => openThread(b.dataset.th, false); });
        };
        draw(); renderRoles(rolesEl);
        const offs = [DS.bus.on('agents:update', e => { if (e && e.kind === 'roles') { if (!rolesEl.contains(document.activeElement)) renderRoles(rolesEl); } else draw(); }), DS.bus.on('models:change', () => { if (!rolesEl.contains(document.activeElement)) renderRoles(rolesEl); })];
        const iv = setInterval(() => { if (!document.hidden && el.isConnected && [...jobs.values()].some(j => j.status === 'running')) draw(); }, 1000);
        return () => { offs.forEach(o => o()); clearInterval(iv); };
      } });

    /* ---------- offline Sim ---------- */
    const simTasks = new Set();
    ctx.intent({ id: 'agents-child', order: 1, match: t => simTasks.has(String(t).trim()),
      script: (t, s) => {
        const hasList = (s.tools || []).includes('fs_list');
        const steps = hasList ? [{ tool: { name: 'fs_list', args: { path: '/' } } }] : [];
        steps.__final = res => { const r = res && res[0]; const n = r && r.entries ? r.entries.length : 0; return 'Subagent (offline Sim) finished: “' + String(t).slice(0, 80) + '”.' + (hasList ? ' Looked at ' + n + ' workspace entries.' : '') + ' No model reviewed this — it is a scripted stand-in.'; };
        return steps;
      } });
    ctx.intent({ id: 'agents-orchestrate', order: 40, match: t => /^\s*(orchestrate|use subagents to|split (this|it) across subagents)\b/i.test(t),
      script: t => {
        const goal = t.replace(/^\s*(orchestrate|use subagents to|split (this|it) across subagents)\s*:?\s*/i, '').trim() || 'review the workspace';
        const s = [
          { say: 'Splitting this into two independent parts and running them in parallel.\n', tool: { name: 'spawn_subagent', args: { task: 'Research for: ' + goal, role: 'researcher', wait: false } } },
          { tool: { name: 'spawn_subagent', args: { task: 'Review risks for: ' + goal, role: 'reviewer', wait: false } } },
          { tool: res => ({ name: 'agents_wait', args: { ids: res.filter(r => r && r.id).map(r => r.id) } }) }
        ];
        s.__final = res => { const w = res[res.length - 1]; const rs = (w && w.results) || []; return '**Orchestrated ' + rs.length + ' subagents** for “' + goal + '”:\n\n' + rs.map(r => '- **' + r.role + '** (' + r.model + ', ' + r.status + ', ' + r.tools_used.length + ' tools): ' + String(r.answer).slice(0, 200)).join('\n') + '\n\nOpen the **Agents** view to inspect each child thread.'; };
        return s;
      } });
    ctx.suggest({ id: 'agents-split', emoji: '🧩', title: 'Split a task across subagents', sub: 'Researcher + Reviewer in parallel', prompt: 'orchestrate: audit this workspace' });

    ctx.provide('forge.agents', { roles, role, setRole, removeRole, usableModels, spawn: (a, tctx) => spawn(a, tctx || {}), stop, wait: (ids, ms) => wait(ids, null, ms), jobs: () => [...jobs.values()].map(pub), job: id => { const j = jobs.get(id); return j ? Object.assign(pub(j), { result: result(j) }) : null; }, thread: findThread, open: openThread, concurrency, setConcurrency: n => ctx.data.set('concurrency', n), groupOf, testRole });
  }
});
