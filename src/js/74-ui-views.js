/* ═══════════════════════════ VIEWS: sheets · Plugin manager · Settings · Changes · Trace ═══════════════════════════ */
const V = DS.views = {};
const field = (label, node, hint) => { const f = el('div', { class: 'field' }); f.appendChild(el('label', {}, esc(label))); f.appendChild(node); if (hint) f.appendChild(el('div', { class: 'hint' }, hint)); return f; };
const input = (val, on, attrs = {}) => { const i = el('input', Object.assign({ class: 'inp' }, attrs)); i.value = val == null ? '' : val; i.addEventListener('change', () => on(i.value)); return i; };
const toggle = (on, cb) => { const b = el('button', { class: 'sw' + (on ? ' on' : ''), role: 'switch', 'aria-checked': !!on }); b.onclick = () => { on = !on; b.classList.toggle('on', on); b.setAttribute('aria-checked', on); cb(on); }; return b; };
const swRow = (label, desc, on, cb) => { const r = el('div', { class: 'row', style: 'padding:8px 0;justify-content:space-between;gap:12px' }); r.appendChild(el('div', { class: 'grow' }, '<div>' + esc(label) + '</div>' + (desc ? '<div class="xs muted">' + esc(desc) + '</div>' : ''))); r.appendChild(toggle(on, cb)); return r; };
V.field = field; V.input = input; V.toggle = toggle; V.swRow = swRow;

/* ---------- small sheets ---------- */
V.tierSheet = () => {
  const s = Store.settings(); const th = Store.activeThread(); const cur = Guard.tier(th).id; const g = el('div', { class: 'tier-g' }); let sh;
  Object.values(Guard.tiers).forEach(t => { const b = el('button', { class: 'tier' + (t.id === cur ? ' on' : '') }, '<b>' + esc(t.label) + '</b><span>' + esc(t.blurb) + '</span><div class="row wrap" style="margin-top:6px;gap:4px">' + Object.entries(t.matrix).map(([k, v]) => '<span class="chip ' + (v === 'allow' ? 'ok' : v === 'ask' ? 'warn' : 'err') + '" style="height:20px;font-size:10.5px">' + k + ': ' + v + '</span>').join('') + '</div>'); b.onclick = () => { s.permission = t.id; if (th) th.permission = null; Store.save(); DS.shell.renderHeader(); sh.close(); ui.toast('Tier: ' + t.label, 'ok'); }; g.appendChild(b); });
  sh = ui.sheet({ title: 'Permission tier', node: g });
};
V.workspaceSheet = () => {
  const box = el('div', { class: 'col' }); let sh; const draw = () => {
    box.innerHTML = ''; Store.state.workspaces.forEach(w => { const r = el('div', { class: 'li', style: 'margin:0' }, '<div class="info"><div class="nm">' + esc(w.name) + (w.id === Store.state.activeWorkspace ? ' <span class="chip acc">active</span>' : '') + '</div><div class="ds">' + (w.backend.type === 'bridge' ? 'local folder via bridge' : 'in-browser · ' + Object.keys(Store.files[w.id] || {}).length + ' files') + '</div></div>'); const sw = el('button', { class: 'btn sm' }); sw.textContent = 'Open'; sw.onclick = () => { Store.switchWorkspace(w.id); sh.close(); }; r.appendChild(sw); if (Store.state.workspaces.length > 1) { const rm = el('button', { class: 'btn sm danger' }); rm.textContent = 'Remove'; rm.onclick = async () => { if (await ui.confirm('Remove workspace “' + w.name + '” and its threads?', 'Remove')) { Store.removeWorkspace(w.id); draw(); } }; r.appendChild(rm); } box.appendChild(r); });
    const add = el('div', { class: 'row' }); const nm = el('input', { class: 'inp', placeholder: 'New workspace name' }); const b1 = el('button', { class: 'btn' }); b1.textContent = 'In browser'; const b2 = el('button', { class: 'btn' }); b2.textContent = 'Local folder';
    b1.onclick = () => { if (!nm.value.trim()) return nm.focus(); const w = Store.addWorkspace(nm.value.trim()); Store.switchWorkspace(w.id); sh.close(); };
    b2.onclick = () => { if (!nm.value.trim()) return nm.focus(); if (!DS.bridge.online) return ui.toast('Connect the bridge first (header ● button)', 'warn'); const w = Store.addWorkspace(nm.value.trim(), { type: 'bridge' }); Store.switchWorkspace(w.id); sh.close(); };
    add.append(nm, b1, b2); box.appendChild(add);
  }; draw(); sh = ui.sheet({ title: 'Workspaces', node: box });
};
V.bridgeSheet = () => {
  const s = Store.settings(); const box = el('div'); let sh; const draw = () => {
    const b = DS.bridge; box.innerHTML = '<div class="row" style="margin-bottom:10px"><span class="dot' + (b.online ? ' ok' : '') + '"></span><b>' + (b.online ? 'Connected' : b.status === 'connecting' ? 'Connecting…' : 'Offline') + '</b>' + (b.info ? '<span class="muted xs mono">' + esc((b.info.name || 'bridge') + ' ' + (b.info.version || '') + ' · root ' + (b.info.root || '')) + '</span>' : '') + '</div>';
    box.appendChild(field('Endpoint', input(s.bridgeUrl, v => { s.bridgeUrl = v; Store.save(); }, { placeholder: 'ws://127.0.0.1:8787' }))); box.appendChild(field('Token', input(s.bridgeToken, v => { s.bridgeToken = v; Store.save(); }, { placeholder: 'printed by the bridge on start', type: 'password' })));
    const row = el('div', { class: 'row wrap' }); const c = el('button', { class: 'btn pri' }); c.textContent = b.online ? 'Reconnect' : 'Connect'; c.onclick = async () => { try { await b.connect(s.bridgeUrl, s.bridgeToken); ui.toast('Bridge connected', 'ok'); } catch (e) { ui.toast(e.message, 'err'); } draw(); };
    row.appendChild(c); if (b.online) { const d = el('button', { class: 'btn' }); d.textContent = 'Disconnect'; d.onclick = () => { b.disconnect(); draw(); }; row.appendChild(d); } box.appendChild(row);
    box.appendChild(el('div', { class: 'sec-t' }, 'Run the bridge on your computer'));
    box.appendChild(el('div', { class: 'sm muted' }, 'The bridge gives the agent a real folder and a shell. Download one script, run it, paste the token above.'));
    const dl = el('div', { class: 'row wrap', style: 'margin-top:8px' }); [['Node', 'node', 'dsh-bridge.js'], ['Python', 'python', 'dsh_bridge.py']].forEach(([l, k, f]) => { const x = el('button', { class: 'btn sm' }); x.textContent = '⬇ ' + l + ' bridge'; x.onclick = () => util.download(f, DS.bridge.script(k)); dl.appendChild(x); }); box.appendChild(dl);
    box.appendChild(el('pre', { class: 'appr-pre' }, esc('node dsh-bridge.js --root ~/my-project\n# or\npython3 dsh_bridge.py --root ~/my-project')));
  };
  draw(); sh = ui.sheet({ title: 'Local bridge', node: box }); const off = DS.bus.on('bridge:status', draw); const old = sh.close; sh.close = () => { off(); old(); };
};
V.confirmReview = ({ source, origin, url, title }) => new Promise(res => {
  const scan = DS.scanSource(source); const box = el('div'); const hi = scan.some(x => x.sev === 'high');
  let man = {}; try { man = parseManifest(source); } catch (_) {}
  box.innerHTML = '<div class="sm muted">Plugins run <b>with the same privileges as this page</b> — they can read your files, keys and threads. Only install code you trust' + (origin ? ' (source: ' + esc(origin) + (url ? ' · ' + esc(url) : '') + ')' : '') + '.</div>' +
    (scan.length ? '<div class="scanw' + (hi ? ' high' : '') + '"><b>Static scan found:</b><br>' + scan.map(x => '• ' + esc(x.label) + ' <span class="muted">(' + x.sev + ')</span>').join('<br>') + '</div>' : '<div class="scanw" style="border-color:rgba(63,185,80,.4);background:rgba(63,185,80,.07)">Static scan found nothing unusual (it is a heuristic, not a guarantee).</div>') +
    '<div class="sec-t">Manifest</div><div class="mono xs">' + esc(JSON.stringify(man, null, 1) === '{}' ? '(none — a name will be generated)' : JSON.stringify(man, null, 1)) + '</div><div class="sec-t">Source (' + DS.fmtBytes(source.length) + ')</div><pre class="appr-pre" style="max-height:260px">' + esc(source.slice(0, 6000)) + (source.length > 6000 ? '\n…' : '') + '</pre>';
  let done = false; const sh = ui.sheet({ title: title || 'Review plugin', node: box, full: true, actions: [{ label: 'Cancel', onClick: c => { done = true; res(false); c(); } }, { label: 'Install & enable', primary: true, onClick: c => { done = true; res(true); c(); } }], onClose: () => { if (!done) res(false); } });
});
V.installSource = async ({ source, origin, url, title }) => {
  if (!source || !source.trim()) return ui.toast('Nothing to install', 'warn');
  if (!(await V.confirmReview({ source, origin, url, title }))) return null;
  try { const recs = await DS.plugins.install({ source, origin, url }); const bad = recs.filter(r => r.state === 'error'); if (bad.length) ui.toast(bad[0].name + ' failed: ' + bad[0].error.message, 'err', 4500); else ui.toast('Installed ' + recs.map(r => r.title).join(', '), 'ok'); DS.bus.emit('plugin:change'); return recs; }
  catch (e) { ui.toast('Install failed: ' + e.message, 'err', 5000); DS.kernel.log('error', 'loader', 'install failed: ' + e.message); return null; }
};
V.fetchText = async url => { try { const r = await fetch(url); if (!r.ok) throw new Error('HTTP ' + r.status); return await r.text(); } catch (e) { if (DS.bridge.online) { const r = await DS.bridge.call('fetch', { url, method: 'GET' }); if (r.status >= 400) throw new Error('HTTP ' + r.status); return r.body; } throw e; } };

const PLUGIN_TEMPLATE = '/** @plugin {"name":"me.hello","title":"Hello","version":"0.1.0","description":"A tiny example: a tool, a command and a status item."} */\n' +
  'ctx.tool({\n  name: "dice", description: "Roll an N-sided die.", gate: "none",\n  parameters: { type: "object", properties: { sides: { type: "integer" } } },\n  run: ({ sides = 6 }) => ({ roll: 1 + Math.floor(Math.random() * sides) }),\n  summarize: (a, r) => "rolled " + r.roll\n});\n' +
  'ctx.command({ name: "hello", desc: "Say hello", run: (arg, c) => c.reply("Hello from a plugin! " + (arg || "")) });\n' +
  'ctx.status({ id: "hello", align: "right", text: () => "hello plugin" });\n';
V.PLUGIN_TEMPLATE = PLUGIN_TEMPLATE;

/* ---------- Plugins manager ---------- */
function mountPlugins(root) {
  let tab = 'installed';
  root.innerHTML = '<div class="vhead"><h2>Plugins</h2><div class="seg"><button data-t="installed">Installed</button><button data-t="catalog">Catalog</button><button data-t="add">Add</button></div></div><div class="vscroll" id="pg-body"></div>';
  const body = $('#pg-body', root);
  const draw = () => {
    $$('.seg button', root).forEach(b => b.classList.toggle('on', b.dataset.t === tab)); body.innerHTML = '';
    if (tab === 'installed') drawInstalled(); else if (tab === 'catalog') drawCatalog(); else drawAdd();
  };
  function drawInstalled() {
    const all = DS.kernel.all().filter(p => !p.parent); const user = all.filter(p => p.origin === 'user'), built = all.filter(p => p.origin !== 'user');
    body.appendChild(el('div', { class: 'sm muted', style: 'margin-bottom:10px' }, 'Everything in Forge is a plugin — tools, views, themes, commands, even the model providers. <b>' + all.length + '</b> loaded · <b>' + DS.kernel.activeCount() + '</b> active.'));
    const grp = (t, list) => { if (!list.length) return; body.appendChild(el('div', { class: 'sec-t' }, esc(t) + ' (' + list.length + ')')); list.forEach(p => body.appendChild(pluginRow(p))); };
    grp('Yours', user); grp('Built-in', built);
    if (!user.length) body.insertBefore(el('div', { class: 'card', style: 'margin-bottom:12px' }, '<b>Anything can be a plugin.</b><div class="sm muted" style="margin:4px 0 8px">Paste code, load a file or URL, or ask the agent to write one (<span class="mono">/plugin a pomodoro timer</span>).</div>'), body.firstChild.nextSibling), $('.card', body).appendChild((() => { const b = el('button', { class: 'btn pri sm' }); b.textContent = 'Add a plugin'; b.onclick = () => { tab = 'add'; draw(); }; return b; })());
  }
  function pluginRow(p) {
    const cs = DS.kernel.contributionsOf(p.name); const r = el('div', { class: 'li' }); const stCls = { active: 'ok', error: 'err', disabled: '', waiting: 'warn', loading: 'acc' }[p.state] || '';
    r.innerHTML = '<div class="info"><div class="nm">' + esc(p.title) + ' <span class="chip ' + stCls + '" style="height:20px">' + esc(p.state) + '</span>' + (p.origin === 'user' ? '<span class="chip acc" style="height:20px">yours</span>' : '') + '</div><div class="ds">' + esc(p.description || p.name) + '</div><div class="row wrap" style="gap:4px;margin-top:6px">' + Object.entries(cs).map(([k, v]) => '<span class="pt-chip">' + k + (v > 1 ? ' ×' + v : '') + '</span>').join('') + '</div>' + (p.error ? '<div class="xs" style="color:var(--danger);margin-top:4px">' + esc(p.error.message) + '</div>' : '') + '</div>';
    r.querySelector('.info').style.cursor = 'pointer'; r.querySelector('.info').onclick = () => pluginDetail(p);
    if (!p.locked) r.appendChild(toggle(p.state === 'active', async on => { await DS.plugins.setEnabled(p.name, on); draw(); DS.shell.renderNav(); })); return r;
  }
  function pluginDetail(p) {
    const box = el('div'); const cs = DS.kernel.contributionsOf(p.name);
    box.innerHTML = '<div class="kv"><label>id</label><span class="mono">' + esc(p.name) + '</span><label>version</label><span>' + esc(p.version) + '</span><label>origin</label><span>' + esc(p.origin) + (p.url ? ' · ' + esc(p.url) : '') + '</span><label>state</label><span>' + esc(p.state) + '</span>' + (p.author ? '<label>author</label><span>' + esc(p.author) + '</span>' : '') + (p.requires.length ? '<label>requires</label><span class="mono">' + esc(p.requires.join(', ')) + '</span>' : '') + '</div>' +
      '<div class="sec-t">Contributions</div><div class="row wrap" style="gap:6px">' + (Object.keys(cs).length ? Object.entries(cs).map(([k, v]) => '<span class="chip">' + k + ' · ' + v + '</span>').join('') : '<span class="muted sm">none</span>') + '</div>';
    if (p.permissions && p.permissions.length) box.appendChild(el('div', {}, '<div class="sec-t">Declares</div>' + p.permissions.map(x => '<span class="pt-chip">' + esc(x) + '</span> ').join('')));
    const acts = []; if (p.origin === 'user') { acts.push({ label: 'Edit source', onClick: c => { c(); editSource(p); } }); acts.push({ label: 'Remove', danger: true, onClick: async c => { if (await ui.confirm('Remove “' + p.title + '”?', 'Remove')) { await DS.plugins.remove(p.name); c(); draw(); DS.shell.renderNav(); } } }); }
    acts.push({ label: 'Reload', onClick: async c => { await DS.plugins.reload(p.name); c(); draw(); ui.toast('Reloaded ' + p.title, 'ok'); } });
    ui.sheet({ title: p.title, node: box, actions: acts });
  }
  function editSource(p) {
    const ta = el('textarea', { class: 'inp', rows: 18, spellcheck: 'false' }); ta.value = p.source || ''; ta.style.minHeight = '50dvh';
    ui.sheet({ title: 'Edit ' + p.title, node: ta, full: true, actions: [{ label: 'Cancel' }, { label: 'Save & hot-reload', primary: true, onClick: async c => { const r = await V.installSource({ source: ta.value, origin: 'edit' }); if (r) { c(); draw(); } } }] });
  }
  async function drawCatalog() {
    const entries = DS.kernel.list('catalogEntry').slice(); const cats = Store.settings().catalogs || [];
    body.appendChild(el('div', { class: 'sm muted', style: 'margin-bottom:10px' }, 'Curated plugins that ship with Forge' + (cats.length ? ' plus ' + cats.length + ' remote catalog' + (cats.length > 1 ? 's' : '') : '') + '. Add a catalog URL in Settings → Plugins.'));
    const slot = el('div'); body.appendChild(slot);
    const paint = list => { slot.innerHTML = ''; if (!list.length) slot.appendChild(el('div', { class: 'empty-v' }, 'No catalog entries yet.')); list.forEach(e => { const inst = DS.kernel.plugins.has(e.pluginName || e.id) || DS.store.state.plugins.some(p => p.name === (e.pluginName || e.id)); const r = el('div', { class: 'li' }, '<div class="info"><div class="nm">' + esc(e.title) + '</div><div class="ds">' + esc(e.description || '') + '</div><div class="row wrap" style="gap:4px;margin-top:6px">' + (e.tags || []).map(t => '<span class="pt-chip">' + esc(t) + '</span>').join('') + '</div></div>'); const b = el('button', { class: 'btn sm' + (inst ? '' : ' pri') }); b.textContent = inst ? 'Installed' : 'Install'; if (inst) b.disabled = true; b.onclick = async () => { try { const src = e.source || await V.fetchText(e.url); const rr = await V.installSource({ source: src, origin: 'catalog', url: e.url, title: 'Install ' + e.title }); if (rr) draw(); } catch (er) { ui.toast('Could not fetch: ' + er.message, 'err'); } }; r.appendChild(b); slot.appendChild(r); }); };
    paint(entries);
    for (const url of cats) { try { const j = JSON.parse(await V.fetchText(url)); const arr = Array.isArray(j) ? j : (j.plugins || []); entries.push(...arr.map(x => Object.assign({ id: x.id || x.name }, x))); paint(entries); } catch (e) { slot.appendChild(el('div', { class: 'xs', style: 'color:var(--danger)' }, 'Catalog ' + esc(url) + ' failed: ' + esc(e.message))); } }
  }
  function drawAdd() {
    const ta = el('textarea', { class: 'inp', rows: 12, spellcheck: 'false', placeholder: PLUGIN_TEMPLATE }); ta.style.minHeight = '34dvh';
    body.appendChild(el('div', { class: 'sm muted', style: 'margin-bottom:8px' }, 'Accepted: a <b>plugin body</b> with a header comment, an <b>ES module</b> (<span class="mono">export default function(ctx)</span>), or <span class="mono">DS.plugin({…})</span>. See the <b>SDK</b> tab for every contribution point.'));
    body.appendChild(field('Paste code', ta));
    const r = el('div', { class: 'row wrap' }); const mk = (t, cls, fn) => { const b = el('button', { class: 'btn ' + cls }); b.innerHTML = t; b.onclick = fn; r.appendChild(b); return b; };
    mk('Review & install', 'pri', async () => { const rr = await V.installSource({ source: ta.value, origin: 'paste' }); if (rr) { tab = 'installed'; draw(); } });
    mk('Use template', '', () => { ta.value = PLUGIN_TEMPLATE; });
    mk('Load .js file', '', () => { const f = el('input', { type: 'file', accept: '.js,.mjs,.txt' }); f.onchange = async () => { const file = f.files[0]; if (file) ta.value = await file.text(); }; f.click(); });
    body.appendChild(r);
    body.appendChild(el('div', { class: 'sec-t' }, 'From a URL'));
    const u = el('input', { class: 'inp', placeholder: 'https://…/plugin.js' }); const ur = el('div', { class: 'row' }); const ub = el('button', { class: 'btn' }); ub.textContent = 'Fetch'; ub.onclick = async () => { try { ta.value = await V.fetchText(u.value.trim()); ui.toast('Fetched ' + DS.fmtBytes(ta.value.length), 'ok'); } catch (e) { ui.toast('Fetch failed: ' + e.message, 'err'); } }; ur.append(u, ub); body.appendChild(ur);
    body.appendChild(el('div', { class: 'sec-t' }, 'Have the agent write it'));
    const ai = el('div', { class: 'row' }); const ip = el('input', { class: 'inp', placeholder: 'e.g. a pomodoro timer in the status bar' }); const ib = el('button', { class: 'btn pri' }); ib.textContent = 'Ask'; ib.onclick = () => { if (!ip.value.trim()) return; DS.shell.show('thread'); DS.threadView.submit('/plugin ' + ip.value.trim()); }; ai.append(ip, ib); body.appendChild(ai);
    body.appendChild(el('div', { class: 'xs muted', style: 'margin-top:6px' }, 'The agent can also call <span class="mono">plugin_create</span> itself; you always review the code before it runs.'));
  }
  $('.seg', root).onclick = e => { const b = e.target.closest('[data-t]'); if (b) { tab = b.dataset.t; draw(); } };
  const refresh = DS.util.debounce(() => { if (root.classList.contains('on') && tab === 'installed') draw(); }, 120); DS.bus.on('plugin:change', refresh); draw();
  root._open = t => { tab = t; draw(); };
}
V.mountPlugins = mountPlugins;

/* ---------- Settings ---------- */
function mountSettings(root) {
  root.innerHTML = '<div class="vhead"><h2>Settings</h2></div><div class="vscroll" id="st-body"></div>'; const body = $('#st-body', root); const s = Store.settings(); const save = () => { Store.save(); DS.shell.renderHeader(); };
  const sec = (t, nodes) => { body.appendChild(el('div', { class: 'sec-t' }, esc(t))); nodes.forEach(n => body.appendChild(n)); };
  const sel = (val, opts, on) => { const x = el('select', { class: 'sel' }); opts.forEach(o => { const op = el('option', { value: o[0] }); op.textContent = o[1]; if (o[0] === val) op.selected = true; x.appendChild(op); }); x.onchange = () => on(x.value); return x; };
  const draw = () => {
    body.innerHTML = '';
    sec('Model', [swRow('Offline Sim only', 'Ignore the API key and use the built-in scripted model.', s.forceSim, v => { s.forceSim = v; save(); }),
      field('Base URL', input(s.baseUrl, v => { s.baseUrl = v.trim(); save(); }), 'Any OpenAI-compatible endpoint. Default: DeepSeek.'), field('API key', input(s.apiKey, v => { s.apiKey = v.trim(); save(); draw(); }, { type: 'password', placeholder: 'sk-…', autocomplete: 'off' }), 'Stored only in this browser. Requests go straight to the endpoint (or via the bridge if CORS blocks it).'),
      field('Planner model', input(s.models.planner, v => { s.models.planner = v; save(); })), field('Executor model', input(s.models.executor, v => { s.models.executor = v; save(); })), field('Critic model', input(s.models.critic, v => { s.models.critic = v; save(); })),
      field('Max steps per run', input(s.maxSteps, v => { s.maxSteps = Math.max(1, Math.min(60, +v || 14)); save(); }, { type: 'number', inputmode: 'numeric' })), field('Temperature', input(s.temperature, v => { s.temperature = Math.max(0, Math.min(2, +v || 0)); save(); }, { type: 'number', step: '0.1' })),
      swRow('Show reasoning', 'Display the model’s thinking stream when available.', s.showReasoning !== false, v => { s.showReasoning = v; save(); }), swRow('Critic pass', 'After tool runs, a second model call reviews the result.', s.verify, v => { s.verify = v; save(); })]);
    sec('Behaviour', [field('Default mode', sel(s.mode, [['auto', 'Auto — plan then act'], ['plan', 'Plan — approve before acting'], ['act', 'Act — just do it']], v => { s.mode = v; save(); })), field('Enter key', sel(s.enterToSend, [['auto', 'Desktop sends, mobile newline'], ['always', 'Enter always sends'], ['never', 'Enter is always newline']], v => { s.enterToSend = v; save(); }))]);
    const tiers = el('div', { class: 'tier-g' }); Object.values(Guard.tiers).forEach(t => { const b = el('button', { class: 'tier' + (s.permission === t.id ? ' on' : '') }, '<b>' + esc(t.label) + '</b><span>' + esc(t.blurb) + '</span>'); b.onclick = () => { s.permission = t.id; save(); draw(); }; tiers.appendChild(b); });
    sec('Permissions', [tiers, swRow('Taint guard', 'Escalate to approval when the agent has read untrusted content or a command looks dangerous.', s.taintCheck, v => { s.taintCheck = v; save(); })]);
    const th = el('div', { class: 'tier-g' }); DS.kernel.list('theme').forEach(t => { const b = el('button', { class: 'tier' + (s.theme === t.id ? ' on' : '') }, '<b>' + esc(t.label) + '</b><span>' + (t.dark === false ? 'light' : 'dark') + ' · plugin “' + esc(t.__owner || '') + '”</span>'); b.onclick = () => { s.theme = t.id; save(); DS.shell.applyTheme(); draw(); }; th.appendChild(b); });
    sec('Appearance', [th, field('Text size', input(s.fontScale, v => { s.fontScale = Math.max(0.8, Math.min(1.4, +v || 1)); save(); DS.shell.applyTheme(); }, { type: 'number', step: '0.05' }))]);
    sec('Bridge', [swRow('Auto-connect on launch', 'Reconnect to the local bridge at startup.', s.autoBridge, v => { s.autoBridge = v; save(); }), (() => { const b = el('button', { class: 'btn' }); b.textContent = 'Open bridge panel'; b.onclick = () => V.bridgeSheet(); return b; })()]);
    /* MCP */
    const mcpBox = el('div'); (s.mcp || []).forEach((m, i) => { const sv = DS.mcp.servers.get(m.name); const r = el('div', { class: 'li' }, '<div class="info"><div class="nm">' + esc(m.name) + ' <span class="chip ' + (sv && sv.status === 'ready' ? 'ok' : sv && sv.status === 'error' ? 'err' : '') + '" style="height:20px">' + esc(sv ? sv.status : 'not connected') + '</span></div><div class="ds mono">' + esc(m.url || m.command || '') + (sv && sv.err ? ' · ' + esc(sv.err) : '') + (sv && sv.tools.length ? ' · ' + sv.tools.length + ' tools' : '') + '</div></div>'); const rm = el('button', { class: 'btn sm danger' }); rm.textContent = 'Remove'; rm.onclick = () => { s.mcp.splice(i, 1); save(); DS.kernel.enable('core.mcp-host').then(() => DS.plugins.reload('core.mcp-host')); setTimeout(draw, 200); }; r.appendChild(rm); mcpBox.appendChild(r); });
    const nm = el('input', { class: 'inp', placeholder: 'name' }), ur = el('input', { class: 'inp', placeholder: 'https://server/mcp (HTTP)  or  npx -y @scope/server (stdio via bridge)' }); const ad = el('button', { class: 'btn' }); ad.textContent = 'Add MCP server';
    ad.onclick = () => { const n = nm.value.trim().replace(/\s+/g, '-'), u = ur.value.trim(); if (!n || !u) return ui.toast('Name and URL/command needed', 'warn'); const cfg = /^https?:/.test(u) ? { name: n, url: u } : { name: n, transport: 'stdio', command: u.split(/\s+/)[0], args: u.split(/\s+/).slice(1) }; s.mcp = (s.mcp || []).concat([cfg]); save(); DS.plugins.reload('core.mcp-host'); setTimeout(draw, 400); };
    sec('MCP servers (tools from outside)', [mcpBox, el('div', { class: 'col' }, ''), nm, ur, ad]);
    sec('Plugin catalogs', [field('Catalog URLs (one per line)', (() => { const t = el('textarea', { class: 'inp', rows: 2 }); t.value = (s.catalogs || []).join('\n'); t.onchange = () => { s.catalogs = t.value.split('\n').map(x => x.trim()).filter(Boolean); save(); }; return t; })(), 'JSON: an array of {id,title,description,tags,url|source}.')]);
    sec('Data', [el('div', { class: 'sm muted' }, 'Storage: ' + Store.kind + ' · ' + DS.fmtBytes(Store.usageBytes())), (() => { const r = el('div', { class: 'row wrap' }); const ex = el('button', { class: 'btn' }); ex.textContent = 'Export everything'; ex.onclick = () => { const st = JSON.parse(JSON.stringify(Store.state)); st.settings.apiKey = ''; st.settings.bridgeToken = ''; (function redact(o, d) { if (!o || typeof o !== 'object' || d > 8) return; for (const k of Object.keys(o)) { if (/(^|_|-)(api)?keys?$|token|secret|password|authorization|^headers$/i.test(k) && typeof o[k] === 'string') o[k] = ''; else if (/^keys$|apiKeys|secrets/i.test(k) && o[k] && typeof o[k] === 'object') { for (const j of Object.keys(o[k])) o[k][j] = typeof o[k][j] === 'string' ? '' : o[k][j]; } else redact(o[k], d + 1); } })(st.pluginDataBag, 0); util.download('forge-backup.json', JSON.stringify({ state: st, files: Store.files }, null, 1), 'application/json'); ui.toast('Exported (API key and bridge token are not included)', 'ok', 3500); }; const im = el('button', { class: 'btn' }); im.textContent = 'Import'; im.onclick = () => { const f = el('input', { type: 'file', accept: '.json' }); f.onchange = async () => { try { const j = JSON.parse(await f.files[0].text()); if (!j.state) throw new Error('not a Forge backup'); const keep = { apiKey: Store.settings().apiKey, bridgeToken: Store.settings().bridgeToken }; const keepPD = Store.state.pluginDataBag; Store.state = j.state; if (keepPD && Store.state.pluginDataBag) for (const pk of Object.keys(keepPD)) { const cur = Store.state.pluginDataBag[pk] = Store.state.pluginDataBag[pk] || {}; for (const k of Object.keys(keepPD[pk] || {})) if (/key|token|secret/i.test(k) && (cur[k] === undefined || cur[k] === '' || (cur[k] && typeof cur[k] === 'object'))) cur[k] = (typeof keepPD[pk][k] === 'object' && cur[k] && typeof cur[k] === 'object') ? Object.assign({}, keepPD[pk][k], Object.fromEntries(Object.entries(cur[k]).filter(e => e[1]))) : keepPD[pk][k]; } Store.state.settings = Object.assign({}, DS.store.defaults().settings, Store.state.settings || {}); if (!Store.state.settings.apiKey) Store.state.settings.apiKey = keep.apiKey; if (!Store.state.settings.bridgeToken) Store.state.settings.bridgeToken = keep.bridgeToken; Store.files = j.files || {}; Store.state.workspaces.forEach(w => Store._dirty.add(w.id)); await Store.flush(); location.reload(); } catch (e) { ui.toast('Import failed: ' + e.message, 'err'); } }; f.click(); }; const rs = el('button', { class: 'btn danger' }); rs.textContent = 'Reset all data'; rs.onclick = async () => { if (await ui.confirm('Erase every thread, file, plugin and setting?', 'Erase everything')) { try { indexedDB.deleteDatabase('ds-forge'); } catch (_) {} try { localStorage.clear(); } catch (_) {} location.reload(); } }; const sm = el('button', { class: 'btn' }); sm.textContent = 'Relaunch in safe mode'; sm.onclick = () => { try { localStorage.setItem('ds-forge:safe', '1'); } catch (_) { window.name = 'ds-forge:safe'; } location.reload(); }; r.append(ex, im, sm, rs); return r; })()]);
    DS.kernel.list('settings').forEach(sc => { const host = el('div'); body.appendChild(el('div', { class: 'sec-t' }, esc(sc.title))); body.appendChild(host); try { sc.render(host); } catch (e) { host.textContent = 'failed: ' + e.message; } });
    body.appendChild(el('div', { class: 'xs muted mono', style: 'margin-top:24px' }, 'Forge ' + DS.version + ' · build ' + DS.build));
  };
  draw(); root._redraw = draw; DS.bus.on('contrib:change', e => { if (e.point === 'settings' || e.point === 'theme') draw(); });
}
V.mountSettings = mountSettings;

/* ---------- Changes ---------- */
function mountChanges(root) {
  root.innerHTML = '<div class="vhead"><h2>Changes</h2><button class="btn sm danger" id="rv-all">Revert all</button></div><div class="vscroll" id="ch-body"></div>'; const body = $('#ch-body', root);
  const draw = async () => {
    const th = Store.activeThread(); const ch = (th && th.changes) || {}; const paths = Object.keys(ch); body.innerHTML = '';
    if (!paths.length) { body.innerHTML = '<div class="empty-v">No pending changes.<br><span class="xs">File edits the agent makes in this thread show up here with a diff and a revert button.</span></div>'; return; }
    for (const p of paths) {
      let after = null; try { after = (await DS.fs.read(p)).content; } catch (_) {} const before = ch[p].before; const st = DS.diff.stat(before || '', after || ''); const kind = before === null ? 'new' : after === null ? 'deleted' : 'modified';
      const r = el('div', { class: 'li', style: 'flex-direction:column;align-items:stretch' }, '<div class="row"><div class="info"><div class="nm mono" style="font-size:12.5px">' + esc(p) + ' <span class="chip ' + (kind === 'new' ? 'ok' : kind === 'deleted' ? 'err' : 'acc') + '" style="height:20px">' + kind + '</span></div><div class="ds"><span style="color:var(--ok)">+' + st.add + '</span> <span style="color:var(--danger)">−' + st.del + '</span></div></div></div><div class="diffbox" style="display:none">' + DS.diff.html(before || '', after || '', 3) + '</div><div class="row" style="margin-top:8px"></div>');
      const acts = $('.row:last-child', r); const mk = (t, cls, fn) => { const b = el('button', { class: 'btn sm ' + cls }); b.textContent = t; b.onclick = fn; acts.appendChild(b); }; mk('Diff', '', () => { const d = $('.diffbox', r); d.style.display = d.style.display === 'none' ? 'block' : 'none'; }); mk('Keep', '', () => DS.agent.accept(th, p)); mk('Revert', 'danger', async () => { await DS.agent.revert(th, p); ui.toast('Reverted ' + p, 'ok'); });
      body.appendChild(r);
    }
  };
  $('#rv-all', root).onclick = async () => { const th = Store.activeThread(); if (!th) return; for (const p of Object.keys(th.changes || {})) await DS.agent.revert(th, p); ui.toast('Reverted all changes', 'ok'); };
  DS.bus.on('changes:update', draw); DS.bus.on('thread:switch', draw); DS.bus.on('fs:change', DS.util.debounce(draw, 200)); draw();
}
V.mountChanges = mountChanges;

/* ---------- Trace ---------- */
function mountTrace(root) {
  root.innerHTML = '<div class="vhead"><h2>Trace</h2><div class="seg"><button data-l="all" class="on">All</button><button data-l="warn">Warn</button><button data-l="error">Errors</button></div><button class="btn sm" id="tr-clear">Clear</button></div><div class="vscroll" id="tr-body" style="padding-top:6px"></div>'; const body = $('#tr-body', root); let lvl = 'all';
  const row = e => el('div', { class: 'trow' }, '<span class="ts">' + DS.fmtTime(e.ts) + '</span><span class="lv ' + e.level + '">' + e.level + '</span><span class="src">' + esc(e.source) + '</span><span class="ms">' + esc(e.msg) + '</span>');
  const draw = () => { body.innerHTML = ''; DS.kernel.trace.filter(e => lvl === 'all' || (lvl === 'warn' ? e.level !== 'info' : e.level === 'error')).slice(-300).forEach(e => body.appendChild(row(e))); body.scrollTop = body.scrollHeight; };
  DS.bus.on('trace', e => { if (!root.classList.contains('on')) return; if (lvl === 'all' || (lvl === 'warn' ? e.level !== 'info' : e.level === 'error')) { body.appendChild(row(e)); if (body.scrollHeight - body.scrollTop < body.clientHeight + 80) body.scrollTop = body.scrollHeight; } });
  $('.seg', root).onclick = e => { const b = e.target.closest('[data-l]'); if (!b) return; lvl = b.dataset.l; $$('.seg button', root).forEach(x => x.classList.toggle('on', x === b)); draw(); }; $('#tr-clear', root).onclick = () => { DS.kernel.trace.length = 0; draw(); }; root._redraw = draw; draw();
}
V.mountTrace = mountTrace;
