/* ═══════════════════════════ KERNEL ═══════════════════════════
   register → lifecycle(apply/dispose) → event bus → service locator → contribution points
   ═══════════════════════════════════════════════════════════ */
class EventBus {
  constructor() { this.h = new Map(); }
  on(evt, fn) { if (!this.h.has(evt)) this.h.set(evt, new Set()); this.h.get(evt).add(fn); return () => this.off(evt, fn); }
  once(evt, fn) { const off = this.on(evt, (p, e) => { off(); fn(p, e); }); return off; }
  off(evt, fn) { const s = this.h.get(evt); if (s) s.delete(fn); }
  emit(evt, payload) {
    const d = this.h.get(evt);
    if (d) for (const fn of [...d]) { try { fn(payload, evt); } catch (e) { console.error('[bus:' + evt + ']', e); } }
    const w = this.h.get('*');
    if (w) for (const fn of [...w]) { try { fn({ evt, payload }); } catch (e) { console.error('[bus:*]', e); } }
  }
}

/* The documented contribution points (also rendered by the SDK reference view). */
DS.POINTS = {
  tool:          { helper: 'tool',          summary: 'A function the agent can call (also exposed to the model as a JSON-schema tool).', shape: '{ name, description, parameters:{type:"object",properties:{…},required:[…]}, gate:"read|write|shell|net|exec|none", label?, icon?, summarize?(args,result)→string, render?(part, el), run(args, tctx) → result }' },
  command:       { helper: 'command',       summary: 'A /slash command in the composer.', shape: '{ name, args?, desc, run(argText, cctx) }  cctx = { thread, reply(markdown), send(text) }' },
  view:          { helper: 'view',          summary: 'A tab / pane (desktop side panel, mobile bottom nav).', shape: '{ id, title, icon, order?, mount(el, vctx) → disposer?, onShow?(), badge?() }' },
  fence:         { helper: 'fence',         summary: 'A renderer for fenced code blocks of given languages inside messages.', shape: '{ langs:["html"], render(el, code, ctx) }  ctx = { lang, closed, streaming, msg }' },
  theme:         { helper: 'theme',         summary: 'A colour theme (CSS variable overrides).', shape: '{ id, label, dark:boolean, vars:{ "--bg":"#000", "--accent":"#0f0", … } }' },
  statusItem:    { helper: 'status',        summary: 'A segment in the status bar.', shape: '{ id, align:"left|right", order?, text()→string, onClick?(), events?:["trace"] }' },
  composerAction:{ helper: 'composerAction',summary: 'An entry in the composer “+” menu.', shape: '{ id, icon, label, desc?, run(cctx) }' },
  composerPill:  { helper: 'pill',          summary: 'A pill next to the composer: a toggle (state in DS.state.toggles) or, with run(), a one-tap action.', shape: '{ id, label, icon?, default?, title?, run?() }' },
  mention:       { helper: 'mention',       summary: 'An @-mention provider: autocomplete + context resolution.', shape: '{ id, search(query)→[{label,hint?,desc?,insert}], resolve?(token)→{name,text} }' },
  messageAction: { helper: 'messageAction', summary: 'A button under assistant messages.', shape: '{ id, icon, label, when?(msg), run(msg, mctx) }' },
  settings:      { helper: 'settings',      summary: 'A section in the Settings view.', shape: '{ id, title, order?, render(el) }' },
  sidebarSection:{ helper: 'sidebar',       summary: 'A section in the left sidebar.', shape: '{ id, title?, order?, render(el), events?:[…] }' },
  guardRule:     { helper: 'guardRule',     summary: 'A permission rule. Return {deny:reason} or {ask:reason} to veto/escalate.', shape: '{ id, check({action, detail, tier, thread}) → undefined | {deny} | {ask} }' },
  hook:          { helper: 'hook',          summary: 'Lifecycle hook: run:start, run:end, beforeModel, afterModel, beforeTool, afterTool, user:message.', shape: 'ctx.hook(event, fn, {order})  beforeTool may return {block:reason} or {args}' },
  provider:      { helper: 'provider',      summary: 'A model backend.', shape: '{ id, label, models?:[…], available()→bool, stream({messages,tools,model,signal,onDelta,…}) → {content,reasoning,toolCalls,usage} }' },
  profile:       { helper: 'profile',       summary: 'An agent persona/frame (planner, executor, critic, …).', shape: '{ id, label, system, model?, tools?:["fs_read",…] }' },
  skill:         { helper: 'skill',         summary: 'Instructions the agent can load on demand (progressive disclosure).', shape: '{ id, title, description, instructions }' },
  shortcut:      { helper: 'shortcut',      summary: 'A keyboard shortcut.', shape: '{ keys:"mod+k", desc, run() }' },
  systemPrompt:  { helper: 'prompt',        summary: 'Text appended to the agent’s system prompt.', shape: '{ id, text | build(thread)→string }' },
  previewer:     { helper: 'previewer',     summary: 'Renders a file type in the Files view.', shape: '{ id, match(path)→bool, render(el, file) }' },
  intent:        { helper: 'intent',        summary: 'Teaches the offline Sim model a new behaviour (works without an API key).', shape: '{ id, match(text)→bool, script(text, sctx)→[{say?, tool?:{name,args}|(prev)=>…, final?:(results)=>string}] }' },
  suggestion:    { helper: 'suggest',       summary: 'A starter card on the empty thread.', shape: '{ id, emoji, title, sub?, prompt | run() }' },
  threadAction:  { helper: 'threadAction',  summary: 'An item in a thread’s ⋯ menu.', shape: '{ id, icon?, label, run(thread) }' },
  catalogEntry:  { helper: 'catalog',       summary: 'An installable plugin in the Catalog tab.', shape: '{ id, title, description, tags?, permissions?, source | url }' },
  railAction:    { helper: 'rail',          summary: 'An icon in the always-visible left rail (tap = run()).', shape: '{ id, icon /*DS.icons key or svg*/, label, group?:"top|forge|bottom", order?, run(), badge?()→string, active?()→bool }' },
  backdrop:      { helper: 'backdrop',      summary: 'An animated background scene rendered behind the UI (WebGL/Canvas).', shape: '{ id, label, group?, start(host:HTMLElement, opts:{quality,reduced,dpr})→stop(), still?:css-gradient-string }' }
};

class Kernel {
  constructor() {
    this.bus = new EventBus(); this.plugins = new Map(); this.services = new Map();
    this.points = new Map(); this.trace = []; this.traceCap = 1500; this._seq = 0; this._n = 0;
  }
  log(level, source, msg, data) {
    const e = { id: DS.util.uid('tr'), seq: ++this._seq, ts: now(), level, source, msg: String(msg), data };
    this.trace.push(e); if (this.trace.length > this.traceCap) this.trace.splice(0, this.trace.length - this.traceCap);
    this.bus.emit('trace', e); return e;
  }
  /* ---- services ---- */
  provide(name, obj, owner) {
    this.services.set(name, { obj, owner }); this.bus.emit('service:provide', name);
    for (const rec of this.plugins.values()) if (rec.state === 'waiting' && rec.requires.every(r => this.services.has(r))) this._apply(rec);
    return obj;
  }
  service(name) { const s = this.services.get(name); return s ? s.obj : undefined; }
  /* ---- contribution points ---- */
  contribute(owner, point, spec) {
    if (!spec || typeof spec !== 'object') throw new Error('contribute(' + point + '): spec must be an object');
    if (!spec.id) spec.id = owner + ':' + point + ':' + (++this._n);
    try { Object.defineProperty(spec, '__owner', { value: owner, enumerable: false, configurable: true }); } catch (_) {}
    const arr = this.points.get(point) || []; this.points.set(point, arr);
    const i = arr.findIndex(c => c.owner === owner && c.spec.id === spec.id); if (i >= 0) arr.splice(i, 1);
    arr.push({ owner, spec });
    this.bus.emit('contrib:change', { point, id: spec.id, owner, op: 'add' });
    return () => this.uncontribute(owner, point, spec.id);
  }
  uncontribute(owner, point, id) {
    const arr = this.points.get(point); if (!arr) return;
    const i = arr.findIndex(c => c.owner === owner && c.spec.id === id); if (i < 0) return;
    arr.splice(i, 1); this.bus.emit('contrib:change', { point, id, owner, op: 'remove' });
  }
  _live(owner) { const p = this.plugins.get(owner); return !p || p.state === 'active' || p.state === 'loading'; }
  list(point) {
    const arr = this.points.get(point) || [];
    return arr.filter(c => this._live(c.owner)).map(c => c.spec).sort((a, b) => (a.order ?? 100) - (b.order ?? 100));
  }
  get(point, id) { return this.list(point).find(s => s.id === id); }
  fence(lang) { return this.list('fence').find(s => [].concat(s.langs || []).includes(lang)); }
  contributionsOf(owner) {
    const out = {}; for (const [pt, arr] of this.points) { const n = arr.filter(c => c.owner === owner).length; if (n) out[pt] = n; } return out;
  }
  async hooks(event, payload) {
    for (const h of this.list('hook').filter(h => h.event === event)) {
      try { const r = await h.fn(payload); if (r && (r.block || r.stop)) return r; if (r && r.args) payload.args = r.args; if (r && Object.prototype.hasOwnProperty.call(r, 'result')) payload.result = r.result; if (r && r.messages) payload.messages = r.messages; if (r && typeof r.text === 'string') payload.text = r.text; }
      catch (e) { this.log('error', h.__owner || 'hook', event + ' hook failed: ' + e.message); }
    }
    return payload;
  }
  /* ---- plugin lifecycle ---- */
  makeCtx(rec) {
    const k = this, name = rec.name; const timers = [];
    const ctx = {
      get name() { return name; }, get kernel() { return k; }, DS,
      log: (lvl, msg, data) => k.log(lvl, name, msg, data),
      on: (evt, fn) => { const off = k.bus.on(evt, fn); rec.disposers.push(off); return off; },
      once: (evt, fn) => { const off = k.bus.once(evt, fn); rec.disposers.push(off); return off; },
      emit: (evt, p) => k.bus.emit(evt, p),
      provide: (n, o) => { rec.provided.push(n); return k.provide(n, o, name); },
      service: n => k.service(n),
      waitFor: n => new Promise(res => { if (k.services.has(n)) return res(k.service(n)); const off = k.bus.on('service:provide', s => { if (s === n) { off(); res(k.service(n)); } }); rec.disposers.push(off); }),
      effect: fn => { const d = fn(); if (typeof d === 'function') rec.disposers.push(d); return d; },
      setTimeout: (fn, ms) => { const t = setTimeout(fn, ms); timers.push(['t', t]); return t; },
      setInterval: (fn, ms) => { const t = setInterval(fn, ms); timers.push(['i', t]); return t; },
      contribute: (point, spec) => { const d = k.contribute(name, point, spec); rec.disposers.push(d); return d; },
      hook: (event, fn, opts = {}) => ctx.contribute('hook', { event, fn, order: opts.order, id: opts.id }),
      register: (def, meta) => k.register(def, Object.assign({ parent: name }, meta)),
      get data() { return DS.store ? DS.store.pluginData(name) : { get() {}, set() {}, all() { return {}; }, del() {} }; },
      get fs() { return DS.fs; }, get ui() { return DS.ui; }, toast: (m, kd, ms) => DS.ui.toast(m, kd, ms),
      thread: () => DS.store && DS.store.activeThread(),
      _clear() { timers.forEach(([t, id]) => (t === 't' ? clearTimeout(id) : clearInterval(id))); timers.length = 0; }
    };
    for (const [pt, info] of Object.entries(DS.POINTS)) if (!ctx[info.helper]) ctx[info.helper] = spec => ctx.contribute(pt, spec);
    return ctx;
  }
  async register(def, meta = {}) {
    if (!def || !def.name) throw new Error('plugin requires a name');
    const prev = this.plugins.get(def.name);
    if (prev && !meta.replace) { if (prev.state === 'active' || prev.state === 'loading') return prev; }
    if (prev) await this._dispose(prev);
    const rec = {
      name: def.name, title: def.title || def.name, description: def.description || '', version: def.version || '0.1.0',
      author: def.author || '', tags: def.tags || [], permissions: def.permissions || [], requires: def.requires || [],
      apply: def.apply, dispose: def.dispose, origin: meta.origin || (DS.booted ? 'runtime' : 'builtin'),
      source: meta.source || null, url: meta.url || null, parent: meta.parent || null, locked: !!def.locked,
      disposers: [], provided: [], state: 'loading', error: null, ctx: null, loadedAt: now()
    };
    this.plugins.set(rec.name, rec);
    await this._apply(rec);
    return rec;
  }
  async _apply(rec) {
    const missing = rec.requires.filter(r => !this.services.has(r));
    if (missing.length) { rec.state = 'waiting'; rec.waitingFor = missing; this.bus.emit('plugin:change', rec.name); return; }
    rec.state = 'loading'; rec.error = null; rec.ctx = this.makeCtx(rec);
    try {
      const run = rec.apply ? rec.apply(rec.ctx, DS) : null;
      const ret = await Promise.race([Promise.resolve(run), new Promise((_, rej) => setTimeout(() => rej(new Error('apply() timed out after 12s')), 12000))]);
      if (typeof ret === 'function') rec.disposers.push(ret);
      rec.state = 'active'; this.log('info', rec.name, 'activated');
    } catch (e) {
      rec.state = 'error'; rec.error = e; this.log('error', rec.name, 'activation failed: ' + e.message, { stack: e.stack }); console.error('[plugin:' + rec.name + ']', e);
      await this._dispose(rec, true); rec.state = 'error';
    }
    this.bus.emit('plugin:change', rec.name);
  }
  async _dispose(rec, keep) {
    const ds = rec.disposers.splice(0).reverse();
    for (const d of ds) { try { d(); } catch (_) {} }
    if (rec.ctx) { rec.ctx._clear(); if (rec.dispose && !keep) { try { await rec.dispose(rec.ctx); } catch (_) {} } }
    for (const [pt, arr] of this.points) { const keepArr = arr.filter(c => c.owner !== rec.name); if (keepArr.length !== arr.length) { this.points.set(pt, keepArr); this.bus.emit('contrib:change', { point: pt, owner: rec.name, op: 'remove' }); } }
    for (const n of rec.provided.splice(0)) { const s = this.services.get(n); if (s && s.owner === rec.name) this.services.delete(n); }
    for (const child of [...this.plugins.values()]) if (child.parent === rec.name && child !== rec) await this._dispose(child), this.plugins.delete(child.name);
  }
  async disable(name) { const r = this.plugins.get(name); if (!r || r.locked) return false; await this._dispose(r); r.state = 'disabled'; this.log('warn', name, 'disabled'); this.bus.emit('plugin:change', name); return true; }
  async enable(name) { const r = this.plugins.get(name); if (!r) return false; if (r.state === 'active') return true; await this._apply(r); return r.state === 'active'; }
  async unload(name) { const r = this.plugins.get(name); if (!r) return; await this._dispose(r); this.plugins.delete(name); this.bus.emit('plugin:change', name); }
  all() { return [...this.plugins.values()]; }
  activeCount() { return this.all().filter(p => p.state === 'active').length; }
}
const kernel = DS.kernel = new Kernel();
DS.service = n => kernel.service(n); DS.bus = kernel.bus; DS.on = (e, f) => kernel.bus.on(e, f); DS.emit = (e, p) => kernel.bus.emit(e, p);

/* ---- plugin declaration: DS.plugin({...}) works for bundled files and live code alike ---- */
DS._queue = [];
DS.plugin = def => { if (DS.booted) return kernel.register(def); DS._queue.push(def); return def; };

/* ═══════════ userland plugins: ANY source can become a plugin ═══════════
   Three accepted source formats:
   1. Body + header comment:   a header comment with an @plugin JSON manifest, then plain code using ctx
   2. ES module:               export const manifest = {...}; export default function(ctx){…}   (may import from CDNs)
   3. Self-registering:        DS.plugin({ name, title, apply(ctx){…} })
   =============================================================== */
function parseManifest(src) {
  const m = src.match(/\/\*+\s*@plugin\s*([\s\S]*?)\*\//) || src.match(/^\s*\/\/\s*@plugin\s*(\{.*\})\s*$/m);
  if (!m) return {};
  try { return JSON.parse(m[1]); } catch (_) { try { return new Function('return (' + m[1].trim() + ')')(); } catch (e) { return {}; } }
}
const isESM = src => /^\s*(import\s[\s\S]*?from\s|import\s*['"]|export\s+(default|const|function|async|let|var|class)\b)/m.test(src);
function esmToBody(src) {
  if (/^\s*import\s/m.test(src)) return null;
  return src.replace(/export\s+const\s+manifest\s*=/, 'const manifest =').replace(/export\s+default\s+(async\s+)?function/, 'return $1function').replace(/export\s+default\s+/, 'return ');
}
DS.scanSource = function (src) {
  const rules = [
    ['eval / Function()', /\beval\s*\(|new\s+Function\s*\(/, 'warn'],
    ['network access (fetch/XHR/WebSocket)', /\bfetch\s*\(|XMLHttpRequest|new\s+WebSocket|navigator\.sendBeacon/, 'warn'],
    ['reads browser storage / cookies', /localStorage|sessionStorage|indexedDB|document\.cookie/, 'high'],
    ['touches API keys / settings', /apiKey|bridgeToken|settings\(\)\s*\.|DS\.store\.state/, 'high'],
    ['imports remote code', /import\s*\(\s*['"]https?:|from\s+['"]https?:/, 'warn'],
    ['injects HTML (innerHTML / document.write)', /\.innerHTML\s*=|document\.write/, 'info'],
    ['runs shell commands', /bridge\.call\(\s*['"]shell|shell_run|service\(\s*['"]bridge/, 'high'],
    ['writes files', /fs\.write|fs_write|\.remove\(/, 'info']
  ];
  return rules.filter(r => r[1].test(src)).map(r => ({ label: r[0], sev: r[2] }));
};
DS.plugins = {
  async parse(src) {
    const manifest = parseManifest(src); const defs = []; const captured = [];
    if (/DS\.plugin\s*\(/.test(src) && !isESM(src)) {
      const shadow = Object.create(DS); shadow.plugin = d => { captured.push(d); return d; };
      const fn = new AsyncFunction('ctx', 'DS', 'kernel', src); await fn(null, shadow, kernel);
      captured.forEach(d => defs.push(Object.assign({}, manifest, d)));
    } else if (isESM(src)) {
      let mod = null, err = null;
      try { const url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' })); try { mod = await import(url); } finally { URL.revokeObjectURL(url); } } catch (e) { err = e; }
      if (mod) {
        const apply = typeof mod.default === 'function' ? mod.default : mod.apply;
        defs.push(Object.assign({}, manifest, mod.manifest || {}, (mod.default && typeof mod.default === 'object') ? mod.default : {}, apply ? { apply } : {}));
      } else {
        const body = esmToBody(src); if (body == null) throw new Error('Module import failed (' + (err && err.message) + ') and the source uses import statements, so it cannot be evaluated inline.');
        const fn = new AsyncFunction('ctx', 'DS', 'kernel', body); const ret = await fn(null, DS, kernel);
        const m2 = {}; try { new Function(body.replace(/return\s+(async\s+)?function[\s\S]*$/, '')); } catch (_) {}
        defs.push(Object.assign({}, manifest, { apply: typeof ret === 'function' ? ret : null }));
      }
    } else {
      const fn = new AsyncFunction('ctx', 'DS', 'kernel', src);
      defs.push(Object.assign({}, manifest, { apply: (ctx) => fn(ctx, DS, kernel) }));
    }
    defs.forEach((d, i) => { if (!d.name) d.name = 'user.' + DS.hash(src) + (i ? '.' + i : ''); if (!d.title) d.title = d.name; });
    if (!defs.length) throw new Error('No plugin found in source');
    return defs;
  },
  /* Install (or replace) a user plugin from source. Persists it. */
  async install({ source, origin = 'paste', url = null, enable = true }) {
    const defs = await DS.plugins.parse(source); const recs = [];
    for (const d of defs) {
      const rec = await kernel.register(d, { origin: 'user', source, url, replace: true });
      const list = DS.store.state.plugins; const i = list.findIndex(p => p.name === d.name);
      const entry = { name: d.name, source, origin, url, enabled: enable, installedAt: now(), manifest: { title: d.title, version: d.version, description: d.description } };
      if (i >= 0) list[i] = entry; else list.push(entry);
      if (!enable) await kernel.disable(d.name);
      recs.push(rec);
    }
    DS.store.save(); return recs;
  },
  async remove(name) {
    await kernel.unload(name); const s = DS.store.state; s.plugins = s.plugins.filter(p => p.name !== name); DS.store.save();
  },
  async setEnabled(name, on) {
    const ok = on ? await kernel.enable(name) : await kernel.disable(name);
    const e = DS.store.state.plugins.find(p => p.name === name);
    if (e) e.enabled = on; else { const d = DS.store.state.disabled; const i = d.indexOf(name); if (!on && i < 0) d.push(name); if (on && i >= 0) d.splice(i, 1); }
    DS.store.save(); return ok;
  },
  async reload(name) {
    const rec = kernel.plugins.get(name); if (!rec) return false;
    if (rec.origin === 'user' && rec.source) { const defs = await DS.plugins.parse(rec.source); for (const d of defs) await kernel.register(d, { origin: 'user', source: rec.source, url: rec.url, replace: true }); return true; }
    await kernel.disable(name); return kernel.enable(name);
  },
  /* Called at boot after builtins. Skips everything in safe mode. */
  async loadUser(safe) {
    const list = DS.store.state.plugins || [];
    for (const p of list) {
      if (safe) { kernel.log('warn', 'loader', 'safe mode: skipped ' + p.name); continue; }
      try {
        const defs = await DS.plugins.parse(p.source);
        for (const d of defs) { const r = await kernel.register(d, { origin: 'user', source: p.source, url: p.url, replace: true }); if (p.enabled === false) await kernel.disable(d.name); }
      } catch (e) { kernel.log('error', 'loader', 'user plugin ' + p.name + ' failed to load: ' + e.message); }
    }
  }
};
