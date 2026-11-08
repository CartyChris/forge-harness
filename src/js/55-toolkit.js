/* ═══════════════════════════ TOOLKIT — reliable tool calling for every model ═══════════════════════════
   Models (especially free / small / reasoning models) get tool calls wrong in predictable ways:
   wrapper names ("tool_call", "function"), near-miss names ("create_app", "write_file"), arguments as a JSON
   string, missing required fields, numbers as strings, and many text formats in prompt mode.
   DS.toolkit fixes what can be fixed deterministically, explains the rest in the error the model sees,
   scopes the tool list to what the request needs (fewer tools → far better accuracy), and builds a short
   quick-reference guide that is put in every system prompt.                                              */
DS.toolkit = (() => {
  const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const WRAPPERS = new Set(['toolcall', 'tool', 'function', 'functioncall', 'calltool', 'usetool', 'invoke', 'call', 'action', 'tooluse']);
  /* common names other agents use → Forge names (only applied when the target exists) */
  const ALIASES = {
    readfile: 'fs_read', read: 'fs_read', cat: 'fs_read', openfile: 'fs_read', viewfile: 'fs_read',
    writefile: 'fs_write', write: 'fs_write', createfile: 'fs_write', savefile: 'fs_write', newfile: 'fs_write',
    editfile: 'fs_edit', edit: 'fs_edit', replace: 'fs_edit', strreplace: 'fs_edit', strreplaceeditor: 'fs_edit', applypatch: 'fs_edit', patch: 'fs_edit',
    listfiles: 'fs_list', ls: 'fs_list', listdir: 'fs_list', listdirectory: 'fs_list', glob: 'fs_list',
    deletefile: 'fs_delete', rm: 'fs_delete', remove: 'fs_delete', grep: 'fs_search', searchfiles: 'fs_search', findinfiles: 'fs_search',
    movefile: 'fs_move', mv: 'fs_move', rename: 'fs_move', copyfile: 'fs_copy', cp: 'fs_copy',
    bash: 'shell_run', shell: 'shell_run', runcommand: 'shell_run', exec: 'shell_run', terminal: 'shell_run', runshell: 'shell_run', executecommand: 'shell_run',
    createapp: 'app_create', makeapp: 'app_create', buildapp: 'app_create', newapp: 'app_create', createwebsite: 'app_create', creategame: 'app_create', appcreate: 'app_create', createhtml: 'app_create',
    previewapp: 'app_preview', preview: 'app_preview',
    search: 'web_search', websearch: 'web_search', googlesearch: 'web_search', internetsearch: 'web_search', browse: 'web_fetch', fetch: 'web_fetch', fetchurl: 'web_fetch', openurl: 'web_fetch', getwebpage: 'web_fetch', webfetch: 'web_fetch',
    runjavascript: 'run_js', javascript: 'run_js', js: 'run_js', node: 'run_js', runpython: 'run_py', python: 'run_py', py: 'run_py', codeinterpreter: 'run_py',
    image: 'generate_image', createimage: 'generate_image', generateimage: 'generate_image', drawimage: 'generate_image', texttoimage: 'generate_image',
    plan: 'update_plan', updateplan: 'update_plan', todo: 'update_plan', todowrite: 'update_plan', ask: 'ask_user', askuser: 'ask_user', question: 'ask_user',
    remember: 'brain_store', recall: 'brain_recall', skill: 'use_skill', loadskill: 'use_skill', help: 'tool_help', toolhelp: 'tool_help', listtools: 'tool_help',
    subagent: 'delegate', spawnagent: 'delegate', task: 'delegate', spawnsubagent: 'spawn_subagent'
  };
  function lev(a, b) { if (a === b) return 0; const m = a.length, n = b.length; if (!m || !n) return m || n; let prev = Array.from({ length: n + 1 }, (_, j) => j);
    for (let i = 1; i <= m; i++) { const cur = [i]; for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); prev = cur; } return prev[n]; }
  const allTools = () => DS.agent.tools();
  const byName = n => allTools().find(t => t.name === n);
  function asObj(v) {
    if (v == null) return {}; if (typeof v === 'object') return v;
    if (typeof v === 'string') { const j = DS.safeJSON(v); if (j && typeof j === 'object' && !j.__parseError) return j; return { __parseError: String(v).slice(0, 200) }; }
    return {};
  }
  /* best tool for a (possibly wrong) name; returns {name, how} or null */
  function matchName(raw) {
    const tools = allTools(); if (!raw) return null; const r = String(raw).trim();
    if (tools.some(t => t.name === r)) return { name: r, how: 'exact' };
    const n = norm(r.replace(/^(functions?|tools?)[.:]/i, ''));
    let t = tools.find(t => norm(t.name) === n); if (t) return { name: t.name, how: 'case/format' };
    if (ALIASES[n] && byName(ALIASES[n])) return { name: ALIASES[n], how: 'alias' };
    const scored = tools.map(t => ({ t, d: lev(n, norm(t.name)) })).sort((a, b) => a.d - b.d);
    if (scored[0] && scored[0].d <= Math.max(1, Math.floor(n.length / 5)) && (!scored[1] || scored[1].d > scored[0].d)) return { name: scored[0].t.name, how: 'closest spelling' };
    const sub = tools.filter(t => norm(t.name).includes(n) || (n.length > 4 && n.includes(norm(t.name)))); if (sub.length === 1) return { name: sub[0].name, how: 'partial name' };
    return null;
  }
  function suggestions(raw, k = 5) { const n = norm(raw); return allTools().map(t => ({ n: t.name, d: lev(n, norm(t.name)) })).sort((a, b) => a.d - b.d).slice(0, k).map(x => x.n); }
  /* resolve a call: unwrap wrappers, fix names, parse string args */
  function resolve(tc) {
    let name = tc.name, args = asObj(tc.args != null ? tc.args : tc.raw), notes = [];
    for (let i = 0; i < 2 && WRAPPERS.has(norm(name)); i++) {
      const inner = args.name || args.tool || args.tool_name || args.function || args.toolName;
      if (!inner || typeof inner !== 'string') break;
      notes.push('unwrapped “' + name + '” → “' + inner + '”');
      name = inner; args = asObj(args.arguments != null ? args.arguments : args.args != null ? args.args : args.parameters != null ? args.parameters : args.input != null ? args.input : (() => { const c = Object.assign({}, args); delete c.name; delete c.tool; delete c.tool_name; delete c.function; delete c.toolName; return c; })());
    }
    if (args && typeof args === 'object' && !Array.isArray(args) && Object.keys(args).length === 1 && (args.arguments || args.args || args.parameters) && typeof (args.arguments || args.args || args.parameters) === 'object') { args = args.arguments || args.args || args.parameters; notes.push('unwrapped nested arguments'); }
    const m = matchName(name);
    if (m && m.name !== name) notes.push('“' + name + '” → “' + m.name + '” (' + m.how + ')');
    return { name: m ? m.name : name, found: !!m, args, notes };
  }
  /* coerce + check arguments against the JSON schema; returns {args, errors[], fixes[]} */
  function validate(def, args) {
    const sch = def.parameters || {}; const props = sch.properties || {}; const out = Object.assign({}, args); const errors = [], fixes = [];
    if (out.__parseError) return { args: out, errors: ['arguments were not valid JSON: ' + out.__parseError], fixes };
    /* map obvious synonyms onto required props (file→path, filename→path, content→text …) */
    const SYN = { path: ['file', 'filename', 'file_path', 'filepath', 'target', 'name'], content: ['text', 'body', 'data', 'contents', 'code', 'html', 'source'], query: ['q', 'search', 'term', 'keywords', 'question'], url: ['link', 'href', 'uri', 'page'], cmd: ['command', 'cmdline', 'script'], code: ['source', 'script', 'js', 'python'], prompt: ['description', 'text', 'query'] };
    for (const k of Object.keys(props)) if (out[k] === undefined && SYN[k]) for (const s of SYN[k]) if (out[s] !== undefined && !props[s]) { out[k] = out[s]; delete out[s]; fixes.push(s + '→' + k); break; }
    for (const [k, p] of Object.entries(props)) {
      const v = out[k]; if (v === undefined || v === null) continue; const ty = p.type;
      if (ty === 'number' || ty === 'integer') { if (typeof v === 'string' && v.trim() !== '' && isFinite(+v)) { out[k] = ty === 'integer' ? Math.round(+v) : +v; fixes.push(k + ' as number'); } }
      else if (ty === 'boolean') { if (v === 'true' || v === 'false') { out[k] = v === 'true'; fixes.push(k + ' as boolean'); } }
      else if (ty === 'string') { if (typeof v !== 'string') { out[k] = typeof v === 'object' ? JSON.stringify(v, null, 2) : String(v); fixes.push(k + ' as string'); } }
      else if (ty === 'array') { if (typeof v === 'string') { const j = DS.safeJSON(v); if (Array.isArray(j)) { out[k] = j; fixes.push(k + ' parsed'); } else { out[k] = [v]; fixes.push(k + ' wrapped in array'); } } }
      else if (ty === 'object') { if (typeof v === 'string') { const j = DS.safeJSON(v); if (j && typeof j === 'object' && !j.__parseError) { out[k] = j; fixes.push(k + ' parsed'); } } }
      if (p.enum && !p.enum.includes(out[k])) { const hit = p.enum.find(e => norm(e) === norm(out[k])); if (hit !== undefined) { out[k] = hit; fixes.push(k + ' enum case'); } else errors.push('“' + k + '” must be one of ' + p.enum.map(e => JSON.stringify(e)).join(', ')); }
    }
    for (const r of (sch.required || [])) if (out[r] === undefined || out[r] === null || out[r] === '') errors.push('missing required “' + r + '”' + (props[r] && props[r].description ? ' (' + String(props[r].description).slice(0, 80) + ')' : ''));
    return { args: out, errors, fixes };
  }
  function example(t) {
    const p = (t.parameters && t.parameters.properties) || {}; const req = (t.parameters && t.parameters.required) || Object.keys(p).slice(0, 2); const ex = {};
    for (const k of req) { const q = p[k] || {}; ex[k] = q.enum ? q.enum[0] : q.type === 'number' || q.type === 'integer' ? 1 : q.type === 'boolean' ? true : q.type === 'array' ? [] : q.type === 'object' ? {} : /path/.test(k) ? '/notes/example.md' : /url/.test(k) ? 'https://example.com' : '…'; }
    return JSON.stringify({ name: t.name, arguments: ex });
  }
  function signature(t) { const p = (t.parameters && t.parameters.properties) || {}; const req = new Set((t.parameters && t.parameters.required) || []); return t.name + '(' + Object.keys(p).map(k => k + (req.has(k) ? '' : '?') + ':' + (p[k].type || 'any')).join(', ') + ')'; }
  function help(name) {
    const t = byName(name) || (matchName(name) && byName(matchName(name).name));
    if (!t) return { error: 'no tool “' + name + '”', closest: suggestions(name) };
    return { name: t.name, signature: signature(t), description: t.description, parameters: t.parameters, gate: t.gate || 'none', example_call: JSON.parse(example(t)) };
  }
  /* ---------- scoping: which tools to offer for this request ---------- */
  const GROUPS = [
    { id: 'core', always: true, test: n => /^(fs_(list|read|write|edit|search|delete|move|copy|stat)|shell_run|update_plan|ask_user|use_skill|tool_help|run_js|run_py|app_create|app_preview|web_fetch|web_search|ide_open)$/.test(n) },
    { id: 'web', re: /\b(https?:|www\.|web|browse|browser|site|url|link|page|search|look ?up|google|news|online|internet|wiki|hacker ?news|github|article|read (this|the)|open )/i, test: n => /^(computer_|cloud_fetch|cloud_status)/.test(n) },
    { id: 'media', re: /\b(image|picture|photo|draw|art|paint|logo|icon|video|clip|animation|audio|sound|music|song|voice|speech|tts|render|generative|wallpaper)/i, test: n => /^(generate_image|render_video|generate_audio|genart_create)$/.test(n) },
    { id: 'memory', re: /\b(remember|memory|memories|recall|forget|learn(ed)?|brain|notes? about me|insight|reflect)/i, test: n => /^(brain_|memory_)/.test(n) },
    { id: 'agents', re: /\b(sub-?agents?|delegate|orchestrat|parallel|team of|council|debate|arena|compare models|second opinion|swarm|superagent)/i, test: n => /^(delegate|spawn_subagent|agents_|council_convene|arena_battle)/.test(n) },
    { id: 'forge', re: /\b(plugin|theme|forge|shield|trace|router|diagnos|steer|local ai|on-device|skill|repo ?map|vercel|backend|mcp|hook)/i, test: n => /^(plugin_|theme_apply|forge_|shield_|trace_last|router_explain|localai_check|skill_import|repo_map|cloud_)/.test(n) }
  ];
  function scope(defs, thread, text) {
    const s = (DS.store && DS.store.settings && DS.store.settings()) || {};
    if (s.toolScope === 'all' || defs.length <= 24) return { defs, hidden: 0 };
    const recent = new Set(); const ms = (thread && thread.messages) || []; let userText = String(text || '');
    for (let i = ms.length - 1, seen = 0; i >= 0 && seen < 6; i--, seen++) { const m = ms[i]; if (m.role === 'user') userText += '\n' + (m.content || ''); for (const p of (m.parts || [])) if (p.type === 'tool') recent.add(p.name); }
    const on = new Set(GROUPS.filter(g => g.always || (g.re && g.re.test(userText))).map(g => g.id));
    const keep = defs.filter(d => { if (recent.has(d.name) || userText.includes(d.name)) return true; const g = GROUPS.find(g => g.test(d.name)); return g ? on.has(g.id) : on.size > 1 || /\b(tool|all tools)\b/i.test(userText); });
    return { defs: keep, hidden: defs.length - keep.length };
  }
  /* ---------- the quick-reference guide every model sees ---------- */
  function guide(defs, opts = {}) {
    const names = new Set(defs.map(d => d.name)); const has = n => names.has(n);
    const lines = ['## Tools — quick reference (use these exact names)'];
    const pick = [['Files', ['fs_list', 'fs_read', 'fs_write', 'fs_edit', 'fs_search']], ['Run', ['run_js', 'run_py', 'shell_run']], ['Apps & preview', ['app_create', 'app_preview', 'ide_open']], ['Web', ['web_search', 'web_fetch', 'computer_open', 'computer_read']], ['Media', ['generate_image', 'genart_create']], ['Work', ['update_plan', 'ask_user', 'use_skill', 'delegate', 'spawn_subagent']]];
    for (const [g, ns] of pick) { const xs = ns.filter(has); if (xs.length) lines.push('- ' + g + ': ' + xs.map(n => signature(defs.find(d => d.name === n))).join(' · ')); }
    lines.push('Rules: call a tool by its exact name with a JSON object of arguments (never wrap it in another tool such as "tool_call"); required arguments have no "?"; one step at a time — read results before the next call; to build a web app or game use app_create with the COMPLETE html; for files use fs_write (new) or fs_edit (change). Unsure about a tool? call tool_help {"name":"…"} (or {} for the full list).' + (opts.hidden ? ' More tools exist for other tasks (' + opts.hidden + ' hidden) — ask tool_help to see them.' : ''));
    return lines.join('\n');
  }
  /* ---------- prompt-mode parser: accepts every common format ---------- */
  function parse(text, opts = {}) {
    const calls = []; let clean = String(text || '');
    const push = (o, src) => {
      if (!o || typeof o !== 'object') return false;
      if (Array.isArray(o)) { let any = false; for (const x of o) any = push(x, src) || any; return any; }
      if (o.tool_calls && Array.isArray(o.tool_calls)) return push(o.tool_calls.map(x => x.function ? { name: x.function.name, arguments: x.function.arguments } : x), src);
      if (o.function && typeof o.function === 'object' && o.function.name) o = { name: o.function.name, arguments: o.function.arguments };
      const name = o.name || o.tool || o.tool_name || o.function || o.action; if (!name || typeof name !== 'string') return false;
      let args = o.arguments != null ? o.arguments : o.args != null ? o.args : o.parameters != null ? o.parameters : o.input != null ? o.input : o.action_input != null ? o.action_input : {};
      if (typeof args === 'string') { const j = DS.safeJSON(args); args = j && !j.__parseError ? j : { input: args }; }
      calls.push({ id: DS.util.uid('call'), name, args, raw: JSON.stringify(args), src }); return true;
    };
    const tryJSON = s => { const t = String(s).trim().replace(/^json\s*/i, ''); const j = DS.safeJSON(t); return j && typeof j === 'object' && !j.__parseError ? j : null; };
    /* fenced blocks: ```tool_call / ```json / ``` … — json/plain fences count only when the name is a real tool */
    clean = clean.replace(/```[ \t]*([\w-]*)[ \t]*\n?([\s\S]*?)```/g, (all, lang, body) => {
      const toolish = /^(tool_?call|tool_?use|tool|function_?call|function|action)$/i.test(lang || ''); if (!toolish && lang && !/^json$/i.test(lang)) return all;
      const j = tryJSON(body); if (!j) return all; const nm = j.name || j.tool || j.tool_name || (j.function && (j.function.name || j.function)) || (Array.isArray(j) && j[0] && (j[0].name || j[0].tool));
      if (!toolish && !(typeof nm === 'string' && matchName(nm)) && !j.tool_calls) return all;
      return push(j, 'fence') ? '' : all; });
    for (const re of [/<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/gi, /<function_call>\s*([\s\S]*?)\s*<\/function_call>/gi, /<\|tool_call\|>\s*([\s\S]*?)(?:<\|\/tool_call\|>|$)/gi]) clean = clean.replace(re, (all, body) => { const j = tryJSON(body); return j && push(j, 'xml') ? '' : all; });
    /* <function=name>{json}</function> (Llama style) */
    clean = clean.replace(/<function=([\w.-]+)>\s*([\s\S]*?)\s*<\/function>/gi, (all, n, body) => push({ name: n, arguments: tryJSON(body) || {} }, 'llama') ? '' : all);
    /* bare JSON object as the whole reply */
    if (!calls.length) { const t = clean.trim(); if (/^\{[\s\S]*\}$/.test(t)) { const j = tryJSON(t); if (j && (j.name || j.tool || j.tool_calls) && push(j, 'bare')) clean = ''; } }
    /* name({...}) single-call style, only for known tool names */
    if (!calls.length && opts.names) { const m = clean.match(/\b([a-z][a-z0-9_]{2,40})\s*\(\s*(\{[\s\S]*\})\s*\)\s*$/i); if (m && opts.names.includes(m[1])) { const j = tryJSON(m[2]); if (j && push({ name: m[1], arguments: j }, 'call')) clean = clean.slice(0, m.index); } }
    return { calls: calls.map(({ src, ...c }) => c), clean: clean.trim() };
  }
  /* what the model sees when a call fails: the error plus how to fix it */
  function errorHint(name, kind, extra) {
    if (kind === 'unknown') return 'Unknown tool “' + name + '”. Closest tools: ' + suggestions(name).join(', ') + '. Call tools by their exact name with JSON arguments; do not wrap calls in "tool_call". Use tool_help {} to list tools.';
    if (kind === 'args') { const t = byName(name); return 'Bad arguments for ' + name + ': ' + extra + (t ? '. Signature: ' + signature(t) + '. Example: ' + example(t) : ''); }
    return extra || '';
  }
  return { resolve, validate, matchName, suggestions, help, signature, example, scope, guide, parse, errorHint, GROUPS, norm };
})();
