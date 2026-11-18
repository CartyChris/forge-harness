/* ═══════════════════════════ BUILT-IN PLUGINS ═══════════════════════════
   Even the “core” is made of plugins using the exact same API as userland. */
const THEME_BASE = { '--bg': '#0a0c10', '--bg-2': '#0f1218', '--surface': '#0f1218', '--surface-2': '#141a23', '--card': '#141a23', '--card-2': '#1a222d', '--text': '#c9d1d9', '--text-2': '#aab4c0', '--muted': '#7d8590', '--line': '#1e2632', '--line-2': '#2a3442', '--accent': '#58a6ff', '--accent-2': '#7cb8ff', '--accent-soft': 'rgba(88,166,255,.12)', '--accent-line': 'rgba(88,166,255,.38)', '--violet': '#bc8cff', '--danger': '#f85149', '--ok': '#3fb950', '--warn': '#d29922', '--code-bg': '#0b0f15', '--code-head': '#10161f', '--think-line': '#2c3646', '--add': 'rgba(63,185,80,.14)', '--del': 'rgba(248,81,73,.14)' };
DS.THEME_BASE = THEME_BASE;
const slug = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24) || 'idea';

DS.plugin({ name: 'core.providers', title: 'Model providers', description: 'OpenRouter / any OpenAI-compatible streaming and the offline Sim.', locked: true, apply(ctx) { ctx.provider(DS.openaiProvider); ctx.provider(DS.simProvider); } });

DS.plugin({ name: 'core.profiles', title: 'Agent profiles', description: 'Planner, executor and critic personas.', apply(ctx) {
  ctx.profile({ id: 'planner', label: 'Planner', system: 'Think before acting. Explore read-only, then produce a short, concrete plan.' });
  ctx.profile({ id: 'executor', label: 'Executor', system: 'Carry out the plan with the fewest tool calls that are safe. Verify results when cheap.' });
  ctx.profile({ id: 'critic', label: 'Critic', system: 'Review the work as a skeptical senior engineer. Be brief and specific.' });
} });

DS.plugin({ name: 'core.tools', title: 'Core tools', description: 'Files, search, shell, plan, ask, skills — plus plugin_create so the agent can extend Forge itself.', locked: true, apply(ctx) {
  DS.coreTools.forEach(t => ctx.tool(Object.assign({}, t)));
  ctx.tool({ name: 'plugin_create', label: 'Create plugin', description: 'Install a Forge plugin from JavaScript source. Format: a header comment `/** @plugin {"name":"agent.xyz","title":"…","description":"…"} */` followed by a body using `ctx` (ctx.tool, ctx.command, ctx.view, ctx.fence, ctx.status, ctx.theme, ctx.intent, …). Load the `plugin-authoring` skill first for the API. The user reviews and approves the code.', gate: 'write',
    parameters: { type: 'object', properties: { source: { type: 'string', description: 'full plugin source' } }, required: ['source'] },
    async detail(a) { return { path: 'plugin (runs with full page privileges)', preview: { kind: 'diff', before: '', after: a.source } }; },
    async run(a) { const recs = await DS.plugins.install({ source: a.source, origin: 'agent' }); DS.bus.emit('plugin:change'); const bad = recs.filter(r => r.state === 'error'); if (bad.length) throw new Error(bad.map(b => b.name + ': ' + b.error.message).join('; ')); return { installed: recs.map(r => ({ name: r.name, state: r.state, contributes: DS.kernel.contributionsOf(r.name) })) }; },
    summarize: (a, r) => r.installed.map(x => x.name).join(', ') });
  ctx.tool({ name: 'plugin_list', label: 'List plugins', description: 'List loaded plugins and what they contribute.', gate: 'read', parameters: { type: 'object', properties: {} }, async run() { return DS.kernel.all().filter(p => !p.parent).map(p => ({ name: p.name, state: p.state, origin: p.origin, contributes: DS.kernel.contributionsOf(p.name) })); }, summarize: (a, r) => r.length + ' plugins' });
  ctx.guardRule({ id: 'plugin-install-review', check({ detail, tier, tool }) { if (tool === 'plugin_create' && tier.id !== 'unrestricted') { const sc = DS.scanSource((detail.preview && detail.preview.after) || ''); return { ask: 'installs code that runs with full page privileges' + (sc.length ? ' — scan: ' + sc.map(x => x.label).join('; ') : '') }; } } });
} });

DS.plugin({ name: 'core.skills', title: 'Built-in skills', description: 'plugin-authoring reference and AGENTS.md guidance.', apply(ctx) {
  const ref = Object.entries(DS.POINTS).map(([k, v]) => '### ctx.' + v.helper + '(spec)  → contribution point `' + k + '`\n' + v.summary + '\nShape: ' + v.shape).join('\n\n');
  ctx.skill({ id: 'plugin-authoring', title: 'Writing Forge plugins', description: 'How to write a plugin (formats, ctx API, every contribution point). Load before calling plugin_create.', instructions:
    'A plugin is JavaScript. Simplest format — header comment + body (the body is an async function body with `ctx`, `DS`):\n\n```js\n/** @plugin {"name":"agent.demo","title":"Demo","version":"0.1.0","description":"…"} */\nctx.tool({ name:"now", description:"Current time", gate:"none", parameters:{type:"object",properties:{}}, run:()=>({iso:new Date().toISOString()}) });\nctx.command({ name:"now", desc:"show time", run:(arg,c)=>c.reply(new Date().toString()) });\n```\n\nOther formats: ES module (`export default function(ctx){…}`) or `DS.plugin({name, apply(ctx){…}})`.\nRules: everything contributed is auto-removed when the plugin is disabled. Use ctx.setInterval/ctx.setTimeout (auto-cleared). ctx.data.get/set persists per-plugin data. ctx.fs is the workspace filesystem (async). Tools with gate "write|shell|net|exec" go through the permission guard. Never read API keys or localStorage.\nServices: ctx.provide(name,obj) / ctx.service(name). Plugin can `requires:["svc"]`.\n\n## Contribution points\n\n' + ref });
  ctx.skill({ id: 'agents-md', title: 'AGENTS.md conventions', description: 'How to write a good AGENTS.md for this workspace.', instructions: 'AGENTS.md lives at "/". Keep it short and operational: build/test/run commands, code style rules, directory map, things never to touch. Update it when you learn a convention the user cares about.' });
} });

DS.plugin({ name: 'core.themes', title: 'Themes', description: 'Obsidian (default), Paper and Ember.', apply(ctx) {
  ctx.theme({ id: 'obsidian', label: 'Obsidian', dark: true, vars: THEME_BASE });
  ctx.theme({ id: 'paper', label: 'Paper', dark: false, vars: Object.assign({}, THEME_BASE, { '--bg': '#f6f8fb', '--bg-2': '#eef2f7', '--surface': '#ffffff', '--surface-2': '#f1f4f8', '--card': '#f1f4f8', '--card-2': '#e8edf4', '--text': '#1c2430', '--text-2': '#3c4858', '--muted': '#6a7686', '--line': '#dde3ec', '--line-2': '#c8d0dc', '--accent': '#0969da', '--accent-2': '#2a7fe0', '--accent-soft': 'rgba(9,105,218,.10)', '--accent-line': 'rgba(9,105,218,.4)', '--code-bg': '#f4f6fa', '--code-head': '#e9edf3', '--think-line': '#c8d0dc', '--add': 'rgba(26,127,55,.13)', '--del': 'rgba(207,34,46,.12)', '--ok': '#1a7f37', '--warn': '#9a6700', '--danger': '#cf222e', '--violet': '#8250df' }) });
  ctx.theme({ id: 'ember', label: 'Ember', dark: true, vars: Object.assign({}, THEME_BASE, { '--bg': '#0e0a08', '--bg-2': '#15100c', '--surface': '#15100c', '--surface-2': '#1d1611', '--card': '#1d1611', '--card-2': '#271d16', '--text': '#e8dccf', '--text-2': '#c4b5a4', '--muted': '#8f7e6c', '--line': '#2a2019', '--line-2': '#3a2d22', '--accent': '#ff8a3d', '--accent-2': '#ffa468', '--accent-soft': 'rgba(255,138,61,.12)', '--accent-line': 'rgba(255,138,61,.4)', '--code-bg': '#120d0a', '--code-head': '#1a130e', '--think-line': '#3a2d22' }) });
} });

DS.plugin({ name: 'core.ui-views', title: 'Plugins · Settings views', locked: true, description: 'The plugin manager and settings.', apply(ctx) {
  ctx.view({ id: 'plugins', title: 'Plugins', icon: 'branch', order: 80, mount: V.mountPlugins, badge: () => String(DS.store.state.plugins.length || '') });
  ctx.view({ id: 'settings', title: 'Settings', icon: 'gear', order: 90, mount: V.mountSettings });
  ctx.command({ name: 'plugins', desc: 'Open the plugin manager', run: () => DS.shell.show('plugins') });
  ctx.command({ name: 'settings', desc: 'Open settings', run: () => DS.shell.show('settings') });
} });
DS.plugin({ name: 'core.changes', title: 'Changes view', description: 'Per-thread diff of file edits, with revert.', apply(ctx) { ctx.view({ id: 'changes', title: 'Changes', icon: 'branch', order: 20, mount: V.mountChanges, badge: () => { const t = Store.activeThread(); const n = t && t.changes ? Object.keys(t.changes).length : 0; return n ? String(n) : ''; } }); ctx.on('changes:update', () => { DS.shell.renderNav(); }); } });
DS.plugin({ name: 'core.trace', title: 'Trace view', description: 'Kernel and agent event log.', apply(ctx) { ctx.view({ id: 'trace', title: 'Kernel log', icon: 'terminal', order: 85, mount: V.mountTrace, onShow: el => el._redraw && el._redraw() }); } });

DS.plugin({ name: 'core.commands', title: 'Slash commands', description: '/help /init /new /clear /mode /tier /theme /plugin /bridge', apply(ctx) {
  ctx.command({ name: 'help', desc: 'What Forge can do', run(a, c) { c.reply('**Forge** — a plugin-first agent harness.\n\n**Slash commands**\n' + DS.kernel.list('command').map(x => '- `/' + x.name + '` ' + (x.args ? '`' + x.args + '` ' : '') + '— ' + (x.desc || '')).join('\n') + '\n\n**Modes** — *auto* plans then acts · *plan* waits for your approval · *act* just does it.\n**Permissions** — Read-only / Restricted / Supervised / Full access (header pill).\n**Anything can be a plugin** — tools, views, themes, commands, renderers, model providers. Open **Plugins** or run `/plugin <idea>`.\n**Context** — type `@` to attach files.'); } });
  ctx.command({ name: 'init', desc: 'Create AGENTS.md for this workspace', async run(a, c) { if (await DS.fs.exists('/AGENTS.md')) return c.reply('`/AGENTS.md` already exists — ask me to refine it.'); const tree = await DS.fs.tree('/', 2, 40); await DS.fs.write('/AGENTS.md', '# AGENTS.md\n\nInstructions for the agent in this workspace.\n\n## Layout\n```\n' + tree + '\n```\n\n## Conventions\n- Prefer small, focused edits.\n- Explain changes in one short paragraph.\n'); c.reply('Created `/AGENTS.md`. It is injected into every run.'); } });
  ctx.command({ name: 'new', desc: 'Start a new thread', run: () => { Store.newThread(); DS.shell.show('thread'); } });
  ctx.command({ name: 'clear', desc: 'Clear this thread', run: () => { const t = Store.activeThread(); if (t) { t.messages = []; t.plan = null; t.changes = {}; t.taint = 'low'; Store.save(); DS.threadView.renderAll(); } } });
  ctx.command({ name: 'mode', args: 'auto|plan|act', desc: 'Set agent mode', run(a, c) { const m = a.trim(); if (!['auto', 'plan', 'act'].includes(m)) return c.reply('Usage: `/mode auto|plan|act`'); const t = Store.activeThread() || Store.newThread(); t.mode = m; Store.settings().mode = m; Store.save(); DS.shell.renderHeader(); c.reply('Mode → **' + m + '**'); } });
  ctx.command({ name: 'tier', args: 'readonly|restricted|supervised|unrestricted', desc: 'Set permission tier', run(a, c) { const id = a.trim(); if (!Guard.tiers[id]) return DS.views.tierSheet(); Store.settings().permission = id; Store.save(); DS.shell.renderHeader(); c.reply('Tier → **' + Guard.tiers[id].label + '**'); } });
  ctx.command({ name: 'theme', args: 'name', desc: 'Switch theme', run(a, c) { const t = DS.kernel.list('theme').find(x => x.id === a.trim()); if (!t) return c.reply('Themes: ' + DS.kernel.list('theme').map(x => '`' + x.id + '`').join(', ')); Store.settings().theme = t.id; Store.save(); DS.shell.applyTheme(); c.reply('Theme → **' + t.label + '**'); } });
  ctx.command({ name: 'bridge', desc: 'Open the local bridge panel', run: () => DS.views.bridgeSheet() });
  ctx.command({ name: 'plugin', args: '<idea>', desc: 'Have the agent write a plugin for you', run(a, c) { if (!a.trim()) { DS.shell.show('plugins'); const m = DS.shell.mounted.get('plugins'); m && m.el._open && m.el._open('add'); return; } c.send('Write a Forge plugin: ' + a.trim() + '. Load the plugin-authoring skill first, then call plugin_create.'); } });
  ctx.command({ name: 'goal', args: '<text>', desc: 'Set a goal the agent keeps in mind', run(a, c) { const t = Store.activeThread() || Store.newThread(); t.goal = a.trim() || null; t.plan = t.plan || { steps: [], status: 'active' }; t.plan.goal = t.goal || ''; Store.save(); DS.threadView.renderPlan(); c.reply(t.goal ? 'Goal set: **' + t.goal + '**' : 'Goal cleared.'); } });
} });

DS.plugin({ name: 'core.composer', title: 'Composer extras', description: '@file mentions, upload, Think pill.', apply(ctx) {
  ctx.mention({ id: 'file', async search(q) { const files = await DS.fs.walk('/', 400); const lq = q.toLowerCase(); return files.filter(f => !lq || f.toLowerCase().includes(lq)).slice(0, 8).map(f => ({ label: f, desc: 'attach file', attach: { name: f, text: async () => (await DS.fs.read(f)).content } })); } });
  ctx.composerAction({ id: 'attach-ws', icon: 'file', label: 'Attach a workspace file', desc: 'type @ to search', run: c => c.insert('@') });
  ctx.composerAction({ id: 'upload', icon: 'clip', label: 'Upload text from device', run: c => { const f = el('input', { type: 'file', multiple: 'multiple' }); f.onchange = async () => { for (const file of f.files) { if (file.size > 400000) { ui.toast(file.name + ' is too large (400 KB max)', 'warn'); continue; } c.addContext(file.name, await file.text()); } }; f.click(); } });
  ctx.pill({ id: 'think', label: 'Think', icon: 'atom', title: 'Use the planner/reasoning model for every step' });
  /* Think: the core DeepSeek slot swaps to the planner model; catalog providers turn on their own thinking/reasoning switch instead (see forge.providers buildBody) — never send a DeepSeek model name to another provider */
  ctx.hook('beforeModel', p => { if (DS.store.state.toggles.think && DS.providers.pick(p.thread).id === 'openai') p.model = DS.agent.model('planner'); });
} });

DS.plugin({ name: 'core.threads', title: 'Thread actions', apply(ctx) {
  ctx.threadAction({ id: 'rename', icon: 'edit', label: 'Rename', async run(t) { const n = await ui.promptText('Rename thread', t.title); if (n && n.trim()) { t.title = n.trim(); t.titled = true; Store.save(); DS.shell.renderSide(); DS.shell.renderHeader(); } } });
  ctx.threadAction({ id: 'export', icon: 'download', label: 'Export as Markdown', run(t) { const md = '# ' + t.title + '\n\n' + t.messages.map(m => m.role === 'user' ? '**You:** ' + m.content : '**Forge:** ' + m.parts.map(p => p.type === 'text' ? p.text : p.type === 'tool' ? '`' + p.name + '` ' + (p.summary || '') : '').filter(Boolean).join('\n\n')).join('\n\n---\n\n'); util.download((slug(t.title) || 'thread') + '.md', md, 'text/markdown'); } });
  ctx.threadAction({ id: 'tier', icon: 'gear', label: 'Permission tier for this thread…', run(t) { DS.views.tierSheet(); } });
  ctx.threadAction({ id: 'delete', icon: 'trash', label: 'Delete thread', async run(t) { if (await ui.confirm('Delete this thread?', 'Delete')) Store.removeThread(t.id); } });
} });

DS.plugin({ name: 'core.status', title: 'Status bar', apply(ctx) {
  ctx.status({ id: 'model', align: 'left', order: 1, text: () => (DS.providers.isLive() ? '◆ ' + DS.agent.model('executor') : (DS.providers.pick().id === 'free-fallback' ? '⇄ free fallback' : '◇ offline sim')) });
  ctx.status({ id: 'tier', align: 'left', order: 2, text: () => 'tier: ' + Guard.tier(Store.activeThread()).label, onClick: () => DS.views.tierSheet() });
  ctx.status({ id: 'bridge', align: 'left', order: 3, text: () => 'bridge ' + (DS.bridge.online ? '●' : '○'), onClick: () => DS.views.bridgeSheet() });
  ctx.status({ id: 'taint', align: 'left', order: 4, text: () => { const t = Store.activeThread(); return t && t.taint && t.taint !== 'low' ? '⚠ taint ' + t.taint : ''; } });
  ctx.status({ id: 'tokens', align: 'right', order: 1, text: () => { const t = Store.activeThread(); return t && t.usage && (t.usage.in || t.usage.out) ? t.usage.in + ' in · ' + t.usage.out + ' out' : ''; } });
  ctx.status({ id: 'plugins', align: 'right', order: 2, text: () => DS.kernel.activeCount() + ' plugins', onClick: () => DS.shell.show('plugins') });
  ctx.status({ id: 'mcp', align: 'right', order: 3, text: () => { const n = [...DS.mcp.servers.values()].filter(s => s.status === 'ready').length; return n ? 'mcp ' + n : ''; } });
} });

DS.plugin({ name: 'core.shortcuts', title: 'Keyboard shortcuts', apply(ctx) {
  ctx.shortcut({ keys: 'mod+shift+o', desc: 'New thread', run: () => { Store.newThread(); DS.shell.show('thread'); } });
  ctx.shortcut({ keys: 'mod+b', desc: 'Toggle sidebar', run: () => DS.shell.side() });
  ctx.shortcut({ keys: 'mod+shift+p', desc: 'Plugins', run: () => DS.shell.show('plugins') });
  ctx.shortcut({ keys: 'mod+,', desc: 'Settings', run: () => DS.shell.show('settings') });
  ctx.shortcut({ keys: 'escape', desc: 'Stop the run', run: () => { const t = Store.activeThread(); if (t && DS.agent.isRunning(t)) DS.agent.stop(t); } });
} });

DS.plugin({ name: 'core.mcp-host', title: 'MCP servers', description: 'Connects the MCP servers from Settings and exposes their tools.', apply(ctx) {
  const list = Store.settings().mcp || []; list.forEach(cfg => { DS.mcp.connect(cfg, ctx); });
  return () => DS.mcp.servers.clear();
} });

/* ---- the offline Sim's built-in intents + starter cards ---- */
DS.plugin({ name: 'core.sim', title: 'Sim intents', description: 'Scripted behaviours so Forge is fully usable without an API key.', apply(ctx) {
  const lastTree = rs => { const r = rs.find(x => x && x.tree); return r ? r.tree : ''; };
  ctx.intent({ id: 'audit', match: t => /\b(audit|survey|map|explore|analy[sz]e)\b.*\b(workspace|repo|project|code)/i.test(t) || /^audit/i.test(t), script: () => [
    { say: 'I’ll start with a plan, then map the tree.\n\n', tool: { name: 'update_plan', args: { goal: 'Audit the workspace', steps: [{ text: 'Map the file tree', status: 'doing' }, { text: 'Read AGENTS.md and entry points', status: 'pending' }, { text: 'Write findings to /notes/audit.md', status: 'pending' }] } } },
    { tool: { name: 'fs_list', args: { path: '/', depth: 3 } } },
    { tool: { name: 'fs_read', args: { path: '/AGENTS.md' } } },
    { tool: rs => ({ name: 'fs_search', args: { query: 'export', dir: '/src' } }) },
    { tool: rs => ({ name: 'fs_write', args: { path: '/notes/audit.md', content: '# Workspace audit\n\n## Tree\n```\n' + lastTree(rs) + '\n```\n\n## Notes\n- AGENTS.md present: ' + (rs.some(r => r && r.content && /AGENTS/.test(r.content)) ? 'yes' : 'no') + '\n- `export` occurrences in /src: ' + ((rs.find(r => r && r.matches) || { count: 0 }).count) + '\n- Next: add tests, document entry points.\n' } }) },
    { tool: { name: 'update_plan', args: { goal: 'Audit the workspace', steps: [{ text: 'Map the file tree', status: 'done' }, { text: 'Read AGENTS.md and entry points', status: 'done' }, { text: 'Write findings to /notes/audit.md', status: 'done' }] } } },
    { final: 'Audit complete. I mapped the tree, read `AGENTS.md`, searched `/src`, and saved the findings to **/notes/audit.md** — open **Changes** to see the diff or revert it.' }] });
  ctx.intent({ id: 'list', match: t => /\b(list|show|what)\b.*\bfiles?\b/i.test(t) || /^ls\b/.test(t), script: () => [{ tool: { name: 'fs_list', args: { path: '/', depth: 3 } } }, { final: rs => 'Here is the workspace:\n\n```\n' + lastTree(rs) + '\n```' }] });
  ctx.intent({ id: 'read', match: t => /\b(read|open|cat)\s+\/?[\w./-]+\.\w+/i.test(t), script: t => { const m = t.match(/\b(?:read|open|cat)\s+(\/?[\w./-]+\.\w+)/i); return [{ tool: { name: 'fs_read', args: { path: m[1] } } }, { final: rs => { const r = rs[0]; return r && r.content ? 'Contents of `' + r.path + '`:\n\n```\n' + r.content.slice(0, 1800) + '\n```' : 'Could not read that file: ' + JSON.stringify(r); } }]; } });
  ctx.intent({ id: 'write-note', match: t => /\b(create|write|save)\b.*\b(note|file)\b.*\S+\.\w+/i.test(t), script: t => { const m = t.match(/(\/?[\w./-]+\.\w+)/); const path = m ? (m[1].startsWith('/') ? m[1] : '/notes/' + m[1]) : '/notes/note.md'; return [{ tool: { name: 'fs_write', args: { path, content: '# ' + path.split('/').pop() + '\n\nCreated by Forge (offline sim).\n\n> ' + t + '\n' } } }, { final: 'Wrote `' + path + '`.' }]; } });
  ctx.intent({ id: 'plugin-writer', match: t => /write a forge plugin/i.test(t), script: t => { const idea = (t.match(/plugin:\s*([^.]+)/i) || [])[1] || 'a tiny demo'; const id = slug(idea); return [
    { say: 'Loading the authoring reference first.\n\n', tool: { name: 'use_skill', args: { id: 'plugin-authoring' } } },
    { tool: { name: 'plugin_create', args: { source: '/** @plugin {"name":"agent.' + id + '","title":"' + idea.replace(/"/g, '').slice(0, 40) + '","version":"0.1.0","description":"Written by the offline sim from: ' + idea.replace(/"/g, '').slice(0, 80) + '"} */\nctx.command({ name: "' + id + '", desc: ' + JSON.stringify(idea.slice(0, 60)) + ', run: (arg, c) => c.reply("Plugin **' + id + '** is alive. (The offline sim can only scaffold; connect a model for real logic.)") });\nctx.status({ id: "' + id + '", align: "right", text: () => "◈ ' + id + '" });\n' } } },
    { final: 'Installed **agent.' + id + '** — it adds `/' + id + '` and a status-bar item. Open **Plugins** to disable, edit or remove it. With a live model I’d write the real logic.' }]; } });
  ctx.suggest({ id: 'audit', emoji: '🔍', title: 'Audit this workspace', sub: 'map files, write findings', prompt: 'audit the workspace and write a report' });
  ctx.suggest({ id: 'plugin', emoji: '🧩', title: 'Write me a plugin', sub: 'anything can be a plugin', prompt: '/plugin a pomodoro timer in the status bar' });
  ctx.suggest({ id: 'plan', emoji: '🗺️', title: 'Plan before acting', sub: 'switch to plan mode', run: () => { const t = Store.activeThread() || Store.newThread(); t.mode = 'plan'; Store.save(); DS.shell.renderHeader(); ui.toast('Plan mode on — ask for something.', 'ok'); DS.threadView.ta.focus(); } });
  ctx.suggest({ id: 'help', emoji: '✨', title: 'What can Forge do?', sub: '/help', prompt: '/help' });
} });
