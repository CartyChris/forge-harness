/* ═══════════════════════════ UI SHELL: header · sidebar · tabs · bottom nav · status bar · themes · shortcuts ═══════════════════════════ */
const UI = DS.shell = {
  current: 'thread', mounted: new Map(), themeVars: [],
  coreViews() { return [{ id: 'thread', title: 'Thread', icon: 'plusChat', order: -1, core: true }]; },
  views() { return this.coreViews().concat(DS.kernel.list('view')); },
  async init() {
    if (DS.isNarrow()) document.body.classList.remove('side-open'); else document.body.classList.toggle('side-collapsed', !!Store.settings().sideCollapsed);
    this.buildHeader(); this.buildSide(); this.renderNav(); this.renderStatus(); this.bindDrawer(); this.renderVolatile();
    DS.bus.on('store:volatile', () => this.renderVolatile());
    const k = DS.kernel;
    DS.bus.on('contrib:change', e => { if (e.point === 'view') { this.pruneViews(); this.renderNav(); } if (e.point === 'railAction') this.renderRail(); if (e.point === 'theme') this.applyTheme(); if (e.point === 'statusItem') this.renderStatus(); if (e.point === 'sidebarSection') this.renderSide(); if (e.point === 'shortcut') this.bindKeys(); });
    DS.bus.on('plugin:change', () => { this.renderSideFoot(); this.renderRail(); });
    for (const ev of ['thread:switch', 'thread:create', 'sidebar:refresh', 'workspace:switch', 'run:end', 'run:start']) DS.bus.on(ev, () => { this.renderSide(); this.renderHeader(); });
    DS.bus.on('bridge:status', () => { this.renderHeader(); this.renderStatus(); });
    DS.bus.on('mcp:change', () => this.renderStatus()); DS.bus.on('theme:set', () => this.applyTheme());
    setInterval(() => { this.renderStatus(); this.renderRail(); }, 2000);
    this.applyTheme(); this.bindKeys();
    window.visualViewport && visualViewport.addEventListener('resize', () => { const kb = Math.max(0, innerHeight - visualViewport.height - visualViewport.offsetTop); document.documentElement.style.setProperty('--kb', kb > 80 ? kb + 'px' : '0px'); });
    this.show('thread');
  },
  /* ---------- themes ---------- */
  applyTheme() {
    const s = Store.settings(); const themes = DS.kernel.list('theme'); const t = themes.find(x => x.id === s.theme) || themes[0]; const root = document.documentElement;
    this.themeVars.forEach(v => root.style.removeProperty(v)); this.themeVars = [];
    if (!t) return; root.dataset.theme = t.id; root.style.colorScheme = t.dark === false ? 'light' : 'dark';
    for (const [k, v] of Object.entries(t.vars || {})) { root.style.setProperty(k, v); this.themeVars.push(k); }
    root.style.setProperty('--fs', s.fontScale || 1); const m = document.querySelector('meta[name=theme-color]'); if (m) m.content = (t.vars && t.vars['--bg']) || '#0a0c10';
  },
  /* ---------- header ---------- */
  buildHeader() { this.renderHeader(); },
  renderHeader() {
    const h = $('#hdr'); const s = Store.settings(); const th = Store.activeThread(); const tier = Guard.tier(th); const run = DS.agent.isRunning(th); const mode = (th && th.mode) || s.mode;
    const bridge = DS.bridge.status === 'online';
    h.innerHTML = '<button class="icon-btn menu-btn" data-a="side" aria-label="Toggle sidebar" aria-controls="side">' + DS.icons.sidebar + '</button>' +
      '<div class="grow"><div class="title">' + esc(this.current === 'thread' ? (th ? th.title : 'Forge') : ((this.views().find(v => v.id === this.current) || {}).title || 'Forge')) + '</div><div class="hsub">' + esc(Store.ws().name) + (DS.providers.isLive() ? ' · ' + esc(DS.agent.model('executor')) : ' · offline sim') + (run ? ' · <span style="color:var(--accent)">working…</span>' : '') + '</div></div>' +
      '<button class="hchip" data-a="mode" title="Agent mode"><span class="muted">mode</span><b>' + esc(mode) + '</b></button>' +
      '<button class="hchip" data-a="bridge" title="Local bridge"><span class="dot' + (bridge ? ' ok' : '') + '"></span></button>' +
      '<button class="hchip" data-a="tier" title="Permission tier"><b style="color:var(--' + ({ ok: 'ok', acc: 'accent', warn: 'warn', err: 'danger' }[tier.tone]) + ')">' + esc(tier.label) + '</b></button>';
    h.onclick = e => { if (e.target.closest('.title') && this.current === 'thread') { const t = Store.activeThread(); if (t) ui.menu(DS.kernel.list('threadAction').map(a => ({ icon: a.icon, label: a.label, danger: a.id === 'delete', run: () => a.run(t) })), t.title); return; } const b = e.target.closest('[data-a]'); if (!b) return; const a = b.dataset.a;
      if (a === 'side') this.side(); else if (a === 'bridge') DS.views.bridgeSheet(); else if (a === 'tier') DS.views.tierSheet(); else if (a === 'mode') { const t = Store.activeThread() || Store.newThread(); const order = ['auto', 'plan', 'act']; t.mode = order[(order.indexOf(t.mode || s.mode) + 1) % 3]; s.mode = t.mode; Store.save(); this.renderHeader(); ui.toast('Mode: ' + t.mode + ' — ' + ({ auto: 'plans then acts', plan: 'plans, then waits for your approval', act: 'acts directly' }[t.mode]), 'ok'); } };
  },
  /* ---------- sidebar: ONE system — overlay drawer (<900px) or collapsible column (>=900px) ---------- */
  buildSide() { this.renderSide(); },
  sideOpen() { return DS.isNarrow() ? document.body.classList.contains('side-open') : !document.body.classList.contains('side-collapsed'); },
  side(open) {
    const want = open == null ? !this.sideOpen() : !!open; const b = document.body;
    if (DS.isNarrow()) { b.classList.toggle('side-open', want); if (want) { const f = $('#side button'); if (f) try { f.focus({ preventScroll: true }); } catch (_) {} } }
    else { b.classList.remove('side-open'); b.classList.toggle('side-collapsed', !want); Store.settings().sideCollapsed = !want; Store.save(); }
    this.renderRail();
  },
  closeDrawer() { if (document.body.classList.contains('side-open')) { document.body.classList.remove('side-open'); this.renderRail(); } },
  bindDrawer() {
    if (this._drawerBound) return; this._drawerBound = true;
    $('#backdrop').addEventListener('click', () => this.closeDrawer());
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && document.body.classList.contains('side-open') && !document.querySelector('.sheet-wrap')) { e.preventDefault(); this.closeDrawer(); const t = $('#rail [data-r="core:side"]'); if (t) t.focus(); } });
    const side = $('#side'); let x0 = null, y0 = 0;
    side.addEventListener('touchstart', e => { const t = e.touches[0]; x0 = t.clientX; y0 = t.clientY; }, { passive: true });
    side.addEventListener('touchend', e => { if (x0 == null) return; const t = e.changedTouches[0]; const dx = t.clientX - x0, dy = t.clientY - y0; x0 = null; if (dx < -50 && Math.abs(dx) > Math.abs(dy) * 1.3) this.closeDrawer(); }, { passive: true });
    let rt = 0; addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(() => { if (!DS.isNarrow()) document.body.classList.remove('side-open'); this.renderRail(); }, 120); });
    addEventListener('orientationchange', () => setTimeout(() => this.renderRail(), 250));
  },
  renderVolatile() {
    const old = $('#volatile'); if (!Store.volatile) { if (old) old.remove(); return; } if (old || this._volDismissed) return;
    const n = el('div', { id: 'volatile', role: 'status' }, '<span class="grow" title="This browser blocks IndexedDB and localStorage. Forge keeps working in memory; export before closing.">⚠ <b>Storage is volatile</b> · in-memory only</span><button class="btn sm" data-x="exp">Export</button><button class="icon-btn" data-x="close" aria-label="Dismiss storage notice">' + DS.icons.x + '</button>');
    n.onclick = e => { const b = e.target.closest('[data-x]'); if (!b) return; if (b.dataset.x === 'close') { this._volDismissed = true; n.remove(); } else util.download('forge-backup.json', JSON.stringify({ state: Object.assign({}, Store.state, { settings: Object.assign({}, Store.state.settings, { apiKey: '', bridgeToken: '' }) }), files: Store.files }, null, 1), 'application/json'); };
    const col = $('#col'); col.insertBefore(n, $('#body'));
  },
  /* ---------- left rail (always visible) ---------- */
  railItems() {
    const svc = n => { try { return DS.kernel.service ? DS.kernel.service(n) : null; } catch (_) { return null; } };
    const contrib = DS.kernel.list('railAction'); const grp = g => contrib.filter(c => (c.group || 'top') === g);
    const isWide = !DS.isNarrow();
    const top = [{ id: 'core:side', icon: 'sidebar', label: this.sideOpen() ? 'Hide sidebar' : 'Show sidebar', run: () => this.side(), active: () => this.sideOpen(), expanded: this.sideOpen() },
      { id: 'core:new', icon: 'plusChat', label: 'New chat', run: () => { Store.newThread(); this.show('thread'); this.closeDrawer(); setTimeout(() => { try { DS.threadView.ta.focus(); } catch (_) {} }, 30); }, active: () => this.current === 'thread' }].concat(grp('top'));
    const coreBottom = { themes: { id: 'core:themes', icon: 'sun', label: 'Themes', run: () => { const t = svc('forge.themes'); if (t && t.openPicker) return t.openPicker(); ui.menu(DS.kernel.list('theme').map(x => ({ icon: 'sun', label: x.label || x.id, run: () => { Store.settings().theme = x.id; Store.save(); this.applyTheme(); } })), 'Theme'); } },
      models: { id: 'core:models', icon: 'atom', label: 'Models', run: () => { const m = svc('forge.models'); if (m && m.openPicker) return m.openPicker(); this.show('settings'); } },
      plugins: { id: 'core:plugins', icon: 'branch', label: 'Plugins', run: () => this.show('plugins'), active: () => this.current === 'plugins' },
      settings: { id: 'core:settings', icon: 'gear', label: 'Settings', run: () => this.show('settings'), active: () => this.current === 'settings' } };
    const bc = grp('bottom'); const key = c => String(c.id || '').toLowerCase().replace(/^.*[.:]/, '');
    const bottom = bc.concat(Object.keys(coreBottom).filter(k => !bc.some(c => key(c) === k)).map(k => coreBottom[k])).sort((a, b) => (a.order || 100) - (b.order || 100));
    const views = this.views().filter(v => !v.core && !['plugins', 'settings'].includes(v.id) && !contrib.some(c => key(c) === v.id) /* a plugin's own rail icon wins over the auto view entry */).map(v => ({ id: 'view:' + v.id, icon: v.icon || 'sparkle', label: v.title, run: () => { this.show(v.id); this.closeDrawer(); }, active: () => this.current === v.id, badge: v.badge }));
    return { top, forge: grp('forge'), bottom, views, isWide };
  },
  renderRail() {
    const r = $('#rail'); if (!r) return; const g = this.railItems(); const SLOT = 48;
    const cs = getComputedStyle(r); const H = r.clientHeight - parseFloat(cs.paddingTop || 0) - parseFloat(cs.paddingBottom || 0) - (g.forge.length ? 14 : 0) - 8;
    const must = g.top.slice(0, 2).concat(g.forge); let settings = g.bottom.find(b => /settings/.test(b.id)) || g.bottom[g.bottom.length - 1];
    let cap = Math.max(4, Math.floor((H + 4) / SLOT)); const tight = must.length + 2 > cap; r.classList.toggle('tight', tight);
    if (tight) { cap = Math.max(4, Math.floor((H + 10) / 44)); if (must.length + 2 > cap) settings = null; }
    const optional = g.top.slice(2).concat(g.views, g.bottom.filter(b => b !== settings));
    let left = cap - must.length - (settings ? 1 : 0); let shown = optional; let more = [];
    if (optional.length > left) { left = Math.max(0, left - 1); shown = optional.slice(0, left); more = optional.slice(left); }
    const cur = g.views.find(v => v.active()); if (cur && more.includes(cur) && shown.length) { const sw = shown.filter(x => g.views.includes(x)).pop(); if (sw) { shown[shown.indexOf(sw)] = cur; more[more.indexOf(cur)] = sw; } }
    const set = new Set(shown); const topShown = g.top.slice(0, 2).concat(g.top.slice(2).filter(x => set.has(x)), g.views.filter(x => set.has(x)));
    const botShown = g.bottom.filter(b => b === settings || set.has(b));
    this._rail = new Map(); const btn = it => { this._rail.set(it.id, it); let on = false, bd = ''; try { on = !!(it.active && it.active()); } catch (_) {} try { bd = it.badge ? String(it.badge() || '') : ''; } catch (_) {} const ic = /^\s*</.test(it.icon || '') ? it.icon : DS.icon(it.icon || 'sparkle'); return '<button class="rb' + (on ? ' on' : '') + '" data-r="' + esc(it.id) + '" title="' + esc(it.label) + '" aria-label="' + esc(it.label) + (bd ? ' (' + esc(bd) + ')' : '') + '"' + (on ? ' aria-current="true"' : '') + (it.id === 'core:side' ? ' aria-controls="side" aria-expanded="' + (it.expanded ? 'true' : 'false') + '"' : '') + '>' + ic + (bd ? '<i class="bdg">' + esc(bd) + '</i>' : '') + '</button>'; };
    if (more.length) { const mi = { id: 'core:more', icon: 'more', label: 'More', run: () => ui.menu(more.map(m => ({ icon: /^\s*</.test(m.icon || '') ? 'sparkle' : m.icon, label: m.label, run: () => m.run() })), 'More') }; topShown.push(mi); }
    const html = '<div class="rgrp top" role="group" aria-label="Navigation">' + topShown.map(btn).join('') + '</div>' + (g.forge.length ? '<div class="rgrp forge" role="group" aria-label="Forge actions">' + g.forge.map(btn).join('') + '</div>' : '') + '<div class="rsp"></div><div class="rgrp bottom" role="group" aria-label="App">' + botShown.map(btn).join('') + '</div>';
    if (html !== this._railHtml) { const fid = document.activeElement && r.contains(document.activeElement) ? document.activeElement.dataset.r : null; r.innerHTML = html; this._railHtml = html; if (fid) { const f = r.querySelector('[data-r="' + fid + '"]'); if (f) f.focus(); } }
    if (!r._bound) { r._bound = true; r.addEventListener('click', e => { const b = e.target.closest('[data-r]'); if (!b) return; const it = this._rail.get(b.dataset.r); if (!it) return; try { it.run(); } catch (err) { DS.kernel.log('error', it.__owner || 'rail', err.message); ui.toast(it.label + ' failed: ' + err.message, 'err'); } setTimeout(() => this.renderRail(), 0); }); }
  },
  renderSide() {
    const s = $('#side'); const w = Store.ws(); const th = Store.threads().filter(t => !t.hidden); const act = Store.activeThread();
    s.innerHTML = '<div class="side-h"><svg class="logo" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#141a23"/><path d="M14 44h36l-6-10H30l-4-8h-6z" fill="var(--accent)"/><rect x="20" y="46" width="24" height="5" rx="2" fill="#ff8a3d"/></svg><span class="brand grow">Forge</span><button class="icon-btn" data-a="new" aria-label="New thread">' + DS.icons.plusChat + '</button></div>' +
      '<div style="padding:0 12px 6px"><button class="hchip" style="width:100%;justify-content:space-between" data-a="ws"><span class="mono">▣ ' + esc(w.name) + '</span><span class="muted">' + (w.backend.type === 'bridge' ? 'local' : 'browser') + ' ▾</span></button></div>' +
      '<div class="side-body" id="side-body"></div><div class="side-f"><span id="side-kernel"></span><span id="side-plugins"></span></div>';
    { const ic = document.querySelector('link[rel="icon"]'); const lg = s.querySelector('.side-h svg.logo'); if (ic && lg && /^data:image\/png/.test(ic.href)) { const im = document.createElement('img'); im.className = 'logo'; im.alt = ''; im.src = ic.href; im.style.borderRadius = '9px'; lg.replaceWith(im); } }
    const b = $('#side-body', s);
    const nav = el('div', { class: 'side-sec' }, '<h4>Workspace</h4>');
    for (const v of this.views()) { const bd = v.badge ? (() => { try { return v.badge(); } catch (_) { return ''; } })() : ''; const i = el('button', { class: 'nav-i' + (this.current === v.id ? ' on' : ''), 'data-v': v.id }, DS.icon(v.icon || 'sparkle') + '<span class="t">' + esc(v.title) + '</span>' + (bd ? '<span class="b">' + esc(bd) + '</span>' : '')); nav.appendChild(i); }
    b.appendChild(nav);
    const tl = el('div', { class: 'side-sec' }, '<h4>Threads</h4>');
    if (!th.length) tl.appendChild(el('div', { class: 'muted sm', style: 'padding:6px 10px' }, 'No threads yet.'));
    for (const t of th.slice(0, 60)) { const r = el('div', { class: 'th-i' }, '<button class="nav-i' + (act && act.id === t.id && this.current === 'thread' ? ' on' : '') + '" data-t="' + t.id + '"><span class="t">' + esc(t.title) + '</span><span class="b">' + (DS.agent.isRunning(t) ? '●' : util.fmtAgo(t.updated).replace(' ago', '')) + '</span></button><button class="icon-btn x" data-del="' + t.id + '" aria-label="Delete thread">' + DS.icons.x + '</button>'); tl.appendChild(r); }
    b.appendChild(tl);
    for (const sec of DS.kernel.list('sidebarSection')) { const box = el('div', { class: 'side-sec' }, sec.title ? '<h4>' + esc(sec.title) + '</h4>' : ''); const body = el('div'); box.appendChild(body); b.appendChild(box); try { sec.render(body); } catch (e) { body.textContent = 'section failed: ' + e.message; } }
    s.onclick = async e => {
      const a = e.target.closest('[data-a]'), v = e.target.closest('[data-v]'), t = e.target.closest('[data-t]'), d = e.target.closest('[data-del]');
      if (d) { e.stopPropagation(); const th2 = Store.threads().find(x => x.id === d.dataset.del); if (th2 && DS.agent.isRunning(th2)) DS.agent.stop(th2); if (await ui.confirm('Delete this thread?', 'Delete')) Store.removeThread(d.dataset.del); return; }
      if (t) { Store.setActive(t.dataset.t); this.show('thread'); this.closeDrawer(); return; }
      if (v) { this.show(v.dataset.v); this.closeDrawer(); return; }
      if (a && a.dataset.a === 'new') { Store.newThread(); this.show('thread'); this.closeDrawer(); }
      if (a && a.dataset.a === 'ws') DS.views.workspaceSheet();
    };
    this.renderSideFoot();
  },
  renderSideFoot() { const k = $('#side-kernel'), p = $('#side-plugins'); if (!k) return; const errs = DS.kernel.all().filter(x => x.state === 'error').length; k.textContent = 'kernel ' + (errs ? errs + ' error' + (errs > 1 ? 's' : '') : 'ok'); k.style.color = errs ? 'var(--danger)' : ''; p.textContent = DS.kernel.activeCount() + ' plugins'; },
  /* ---------- nav (desktop tabs + mobile bottom nav) ---------- */
  renderNav() {
    this.renderRail(); const vs = this.views(); const tabs = $('#tabs'); tabs.innerHTML = vs.map(v => '<button class="tab' + (this.current === v.id ? ' on' : '') + '" data-v="' + v.id + '">' + DS.icon(v.icon || 'sparkle') + esc(v.title) + '</button>').join('');
    tabs.onclick = e => { const b = e.target.closest('[data-v]'); if (b) this.show(b.dataset.v); };
    const bn = $('#bnav'); const main = vs.slice(0, 4), more = vs.slice(4); const cur = vs.find(v => v.id === this.current);
    if (cur && !main.includes(cur) && more.includes(cur)) { main[3] = cur; more.splice(more.indexOf(cur), 1, vs[3]); }
    bn.innerHTML = main.map(v => { const bd = v.badge ? (() => { try { return v.badge(); } catch (_) { return ''; } })() : ''; return '<button class="' + (this.current === v.id ? 'on' : '') + '" data-v="' + v.id + '">' + DS.icon(v.icon || 'sparkle') + '<span>' + esc(v.title) + '</span>' + (bd ? '<i class="bdg">' + esc(bd) + '</i>' : '') + '</button>'; }).join('') + (more.length ? '<button data-more>' + DS.icon('more') + '<span>More</span></button>' : '');
    bn.onclick = e => { const b = e.target.closest('[data-v]'); if (b) return this.show(b.dataset.v); if (e.target.closest('[data-more]')) ui.menu(more.map(v => ({ icon: v.icon, label: v.title, run: () => this.show(v.id) })), 'More views'); };
  },
  pruneViews() { for (const [id, m] of [...this.mounted]) if (!DS.kernel.list('view').some(v => v.id === id)) { try { m.dispose && m.dispose(); } catch (_) {} m.el.remove(); this.mounted.delete(id); if (this.current === id) this.show('thread'); } },
  show(id) {
    const v = this.views().find(x => x.id === id) || this.views()[0]; this.current = v.id;
    const host = $('#views'); host.querySelectorAll('.view').forEach(n => n.classList.remove('on'));
    let m = this.mounted.get(v.id);
    if (!m) {
      const node = el('div', { class: 'view', id: 'v-' + v.id }); host.appendChild(node); m = { el: node, dispose: null }; this.mounted.set(v.id, m);
      try { if (v.core) { DS.threadView.mount(node); } else { const d = v.mount(node, { show: x => this.show(x), toast: ui.toast, DS }); if (typeof d === 'function') m.dispose = d; } }
      catch (e) { node.innerHTML = '<div class="empty-v"><b style="color:var(--danger)">View “' + esc(v.title) + '” failed to mount</b><br><span class="mono sm">' + esc(e.message) + '</span></div>'; DS.kernel.log('error', v.__owner || 'ui', 'view ' + v.id + ' mount failed: ' + e.message); }
    }
    m.el.classList.add('on'); try { v.onShow && v.onShow(m.el); } catch (_) {}
    if (v.core) DS.threadView.onShow();
    this.renderNav(); this.renderSide(); this.renderHeader(); DS.bus.emit('view:show', v.id);
  },
  /* ---------- status bar ---------- */
  renderStatus() {
    const st = $('#status'); if (!st) return; const items = DS.kernel.list('statusItem'); const mk = side => items.filter(i => (i.align || 'left') === side).map(i => { let t = ''; try { t = i.text(); } catch (_) { t = '!'; } return t === '' || t == null ? '' : '<span class="si" data-id="' + esc(i.id) + '"' + (i.onClick ? ' data-click="1"' : '') + '>' + esc(t) + '</span>'; }).join('');
    st.innerHTML = mk('left') + '<span class="grow"></span>' + mk('right'); st.onclick = e => { const s = e.target.closest('[data-id]'); if (!s) return; const it = items.find(i => i.id === s.dataset.id); if (it && it.onClick) it.onClick(); };
  },
  /* ---------- keyboard shortcuts ---------- */
  bindKeys() {
    if (!this._keys) { this._keys = e => { const parts = []; if (e.metaKey || e.ctrlKey) parts.push('mod'); if (e.altKey) parts.push('alt'); if (e.shiftKey) parts.push('shift'); const k = e.key.length === 1 ? e.key.toLowerCase() : e.key.toLowerCase(); parts.push(k); const combo = parts.join('+'); for (const sc of DS.kernel.list('shortcut')) { if (String(sc.keys).toLowerCase() === combo) { e.preventDefault(); try { sc.run(); } catch (err) { DS.kernel.log('error', sc.__owner || 'shortcut', err.message); } return; } } }; document.addEventListener('keydown', this._keys); }
  }
};
