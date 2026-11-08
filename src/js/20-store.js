/* ═══════════════════════════ STORE (IndexedDB, in-memory cache, localStorage fallback) ═══════════════════════════ */
const { sleep, clamp } = DS.util;
const IDB = {
  db: null,
  open() { return new Promise((res, rej) => { if (!window.indexedDB) return rej(new Error('no indexedDB')); const r = indexedDB.open('ds-forge', 1); r.onupgradeneeded = () => r.result.createObjectStore('kv'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); r.onblocked = () => rej(new Error('blocked')); }); },
  get(k) { return new Promise((res, rej) => { const q = this.db.transaction('kv').objectStore('kv').get(k); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); }); },
  set(k, v) { return new Promise((res, rej) => { const t = this.db.transaction('kv', 'readwrite'); t.objectStore('kv').put(v, k); t.oncomplete = () => res(); t.onerror = () => rej(t.error); }); },
  del(k) { return new Promise((res, rej) => { const t = this.db.transaction('kv', 'readwrite'); t.objectStore('kv').delete(k); t.oncomplete = () => res(); t.onerror = () => rej(t.error); }); }
};
const LS = { get: async k => { try { const v = localStorage.getItem('ds-forge:' + k); return v ? JSON.parse(v) : undefined; } catch (_) { return undefined; } }, set: async (k, v) => { localStorage.setItem('ds-forge:' + k, JSON.stringify(v)); }, del: async k => { try { localStorage.removeItem('ds-forge:' + k); } catch (_) {} } };
const MEM = { m: new Map(), get: async k => { const v = MEM.m.get(k); return v === undefined ? undefined : JSON.parse(v); }, set: async (k, v) => { MEM.m.set(k, JSON.stringify(v)); }, del: async k => { MEM.m.delete(k); } };
const lsUsable = () => { try { const k = 'ds-forge:__probe'; localStorage.setItem(k, '1'); localStorage.removeItem(k); return true; } catch (_) { return false; } };

function seedFiles() {
  return {
    '/AGENTS.md': '# AGENTS.md\n\nProject instructions the agent reads before every run (same idea as Codex).\n\n## Conventions\n- Prefer small, focused edits; use `fs_edit` for changes to existing files.\n- Keep apps single-file HTML unless asked otherwise.\n- Explain what you changed in one short paragraph at the end.\n\n## Commands\n- Preview apps with the Preview tab; run code with `run_js` or the Terminal.\n',
    '/README.md': '# Forge workspace\n\nA plugin-first agent workspace running in your browser.\n\n- `/src`: sources the agent can read and edit\n- `/apps`: generated apps and games (open them in **Preview**)\n- `/notes`: goals and scratchpads\n\nTry: **"audit the workspace and write a report"**, **"build a snake game"**, or type `/help`.\n',
    '/src/main.js': '// entry point for the demo project\nimport { createAgent } from "./agent.js";\n\nconst agent = createAgent({ mode: "plan-execute", maxSteps: 6 });\nagent.on("step", (s) => console.log("[step]", s.title));\nagent.run("audit the workspace and summarise findings");\n',
    '/src/agent.js': 'export function createAgent(opts = {}) {\n  const listeners = new Map();\n  return {\n    on(evt, fn) { listeners.set(evt, fn); return this; },\n    emit(evt, payload) { const fn = listeners.get(evt); if (fn) fn(payload); },\n    async run(goal) {\n      this.emit("step", { title: "plan", goal });\n      return { goal, steps: opts.maxSteps || 4 };\n    }\n  };\n}\n',
    '/src/utils.js': 'export const clamp = (n, a, b) => Math.max(a, Math.min(b, n));\nexport const uid = (p = "id") => p + "_" + Math.random().toString(36).slice(2, 10);\nexport const sleep = (ms) => new Promise((r) => setTimeout(r, ms));\n',
    '/notes/goals.md': '# Session goals\n\n1. Map the workspace file tree\n2. Identify dead code paths\n3. Draft a refactor plan with risk notes\n'
  };
}
const normFiles = m => { const o = {}; for (const [k, v] of Object.entries(m || {})) { const p = DS.fs ? DS.fs.norm(k) : k; o[p] = (v && typeof v === 'object' && 'content' in v) ? { path: p, content: String(v.content ?? ''), mtime: v.mtime || now() } : { path: p, content: String(v ?? ''), mtime: now() }; } return o; };

const Store = DS.store = {
  state: null, files: {}, kind: 'idb', _dirty: new Set(), _t: null, _saving: false,
  defaults() {
    const ws = 'ws_default';
    return {
      v: 1, workspaces: [{ id: ws, name: 'default', created: now(), backend: { type: 'mem' } }], activeWorkspace: ws,
      threads: { [ws]: [] }, activeThread: { [ws]: null },
      settings: {
        permission: 'supervised', mode: 'auto', maxSteps: 14, taintCheck: true, sandbox: true,
        provider: 'openai', baseUrl: 'https://api.deepseek.com', apiKey: '', forceSim: false,
        models: { planner: 'deepseek-reasoner', executor: 'deepseek-chat', critic: 'deepseek-chat' },
        temperature: 0.3, think: false, verify: false, theme: 'obsidian', fontScale: 1,
        bridgeUrl: 'ws://127.0.0.1:8787', bridgeToken: '', autoBridge: false, enterToSend: 'auto',
        mcp: [], catalogs: [], showReasoning: true
      },
      plugins: [], disabled: [], pluginDataBag: {}, toggles: { think: false }, meta: { booting: false, first: true }
    };
  },
  async init() {
    let backend = IDB;
    try { IDB.db = await Promise.race([IDB.open(), sleep(2500).then(() => { throw new Error('idb timeout'); })]); }
    catch (e) { if (lsUsable()) { backend = LS; this.kind = 'localStorage'; } else { backend = MEM; this.kind = 'memory'; this.volatile = true; } }
    this.backend = backend;
    let st = null; try { st = await backend.get('state'); } catch (_) {}
    const base = this.defaults();
    if (st) {
      this.state = Object.assign({}, base, st, { settings: Object.assign({}, base.settings, st.settings || {}, { models: Object.assign({}, base.settings.models, (st.settings || {}).models || {}) }), toggles: Object.assign({}, base.toggles, st.toggles || {}), meta: Object.assign({}, base.meta, st.meta || {}) });
      if (!this.state.workspaces || !this.state.workspaces.length) this.state.workspaces = base.workspaces;
      if (!this.state.workspaces.some(w => w.id === this.state.activeWorkspace)) this.state.activeWorkspace = this.state.workspaces[0].id;
    } else { this.state = base; this._migrateLegacy(); }
    for (const w of this.state.workspaces) {
      let f = null; try { f = await backend.get('files:' + w.id); } catch (_) {}
      this.files[w.id] = f && Object.keys(f).length ? f : (w.backend.type === 'mem' && !st ? normFiles(seedFiles()) : (f || {}));
      if (!this.state.threads[w.id]) this.state.threads[w.id] = [];
    }
    if (!st) this._dirty.add(this.state.activeWorkspace);
    return this;
  },
  _migrateLegacy() {
    try {
      let raw = null; try { raw = localStorage.getItem('dsh-lite::state::v1'); } catch (_) {} if (!raw) return;
      const old = JSON.parse(raw); const ws = this.state.activeWorkspace; let n = 0;
      const files = (old.files && old.files[old.activeWorkspace]) || {};
      this.files[ws] = {}; for (const [k, v] of Object.entries(files)) this.files[ws][k] = { path: k, content: String(v && v.content != null ? v.content : v), mtime: (v && v.mtime) || now() };
      const sessions = (old.sessions && old.sessions[old.activeWorkspace]) || [];
      for (const s of sessions) { const msgs = []; for (const m of s.messages || []) { if (m.role === 'user') msgs.push({ id: uid('m'), role: 'user', content: m.content, ts: m.ts }); else if (m.content) msgs.push({ id: uid('m'), role: 'assistant', ts: m.ts, parts: [{ type: 'text', text: m.content }], meta: { endedAt: m.ts, startedAt: m.ts } }); } this.state.threads[ws].push({ id: s.id || uid('t'), title: s.title || 'Imported', created: s.created || now(), updated: s.updated || now(), mode: 'auto', messages: msgs, plan: null, taint: 'low', changes: {}, permission: null }); n++; }
      if (old.settings) { this.state.settings.permission = old.settings.permission || 'supervised'; this.state.settings.bridgeUrl = old.settings.bridgeUrl || this.state.settings.bridgeUrl; this.state.settings.bridgeToken = old.settings.bridgeToken || ''; }
      this.state.meta.migrated = n; this.state.meta.first = false;
    } catch (e) { console.warn('legacy migration failed', e); }
  },
  save() { clearTimeout(this._t); this._t = setTimeout(() => this.flush(), 300); },
  async flush() {
    clearTimeout(this._t); this._t = null; if (!this.state || !this.backend) return;
    try {
      await this.backend.set('state', JSON.parse(JSON.stringify(this.state)));
      for (const id of [...this._dirty]) { this._dirty.delete(id); await this.backend.set('files:' + id, this.files[id] || {}); }
    } catch (e) { if (this.backend !== MEM) { this.backend = MEM; this.kind = 'memory'; this.volatile = true; DS.bus && DS.bus.emit('store:volatile'); return this.flush(); } if (!this._warned) { this._warned = true; DS.ui && DS.ui.toast('Could not save (storage full?)', 'err'); } }
  },
  flushSync() { /* best effort on unload: localStorage mirror of the small state */ if (this.kind === 'memory') return; try { if (this.kind === 'localStorage') { localStorage.setItem('ds-forge:state', JSON.stringify(this.state)); } } catch (_) {} this.flush(); },
  settings() { return this.state.settings; },
  ws() { return this.state.workspaces.find(w => w.id === this.state.activeWorkspace); },
  wsFiles() { const id = this.state.activeWorkspace; return this.files[id] || (this.files[id] = {}); },
  markFiles() { this._dirty.add(this.state.activeWorkspace); this.save(); },
  /* per-plugin persistent bag */
  pluginData(name) {
    const bag = () => (this.state.pluginDataBag[name] || (this.state.pluginDataBag[name] = {}));
    return { get: (k, d) => (k in bag() ? bag()[k] : d), set: (k, v) => { bag()[k] = v; Store.save(); return v; }, del: k => { delete bag()[k]; Store.save(); }, all: () => bag() };
  },
  /* threads */
  threads() { const id = this.state.activeWorkspace; return this.state.threads[id] || (this.state.threads[id] = []); },
  activeThread() { const id = this.state.activeWorkspace; const tid = this.state.activeThread[id]; return this.threads().find(t => t.id === tid) || null; },
  setActive(tid) { this.state.activeThread[this.state.activeWorkspace] = tid; this.save(); DS.bus.emit('thread:switch', this.activeThread()); },
  newThread(title) {
    const t = { id: uid('t'), title: title || 'New thread', created: now(), updated: now(), mode: this.state.settings.mode, permission: null, messages: [], plan: null, goal: null, taint: 'low', changes: {}, allow: {}, usage: { in: 0, out: 0 }, titled: false };
    this.threads().unshift(t); this.state.activeThread[this.state.activeWorkspace] = t.id; this.save();
    DS.bus.emit('thread:create', t); DS.bus.emit('thread:switch', t); return t;
  },
  removeThread(id) { const l = this.threads(); const i = l.findIndex(t => t.id === id); if (i < 0) return; l.splice(i, 1); try { DS.bus.emit('thread:removed', id); } catch (_) {} const ws = this.state.activeWorkspace; if (this.state.activeThread[ws] === id) this.state.activeThread[ws] = null; this.save(); DS.bus.emit('thread:switch', this.activeThread()); DS.bus.emit('sidebar:refresh'); },
  /* workspaces */
  addWorkspace(name, backend) { const w = { id: uid('ws'), name, created: now(), backend: backend || { type: 'mem' } }; this.state.workspaces.push(w); this.state.threads[w.id] = []; this.state.activeThread[w.id] = null; this.files[w.id] = {}; this._dirty.add(w.id); this.save(); return w; },
  switchWorkspace(id) { if (!this.state.workspaces.some(w => w.id === id)) return; this.state.activeWorkspace = id; this.save(); DS.bus.emit('workspace:switch', this.ws()); DS.bus.emit('thread:switch', this.activeThread()); DS.bus.emit('fs:change', { path: '/', kind: 'workspace' }); },
  removeWorkspace(id) { if (this.state.workspaces.length < 2) return false; this.state.workspaces = this.state.workspaces.filter(w => w.id !== id); delete this.state.threads[id]; delete this.files[id]; if (this.backend) this.backend.del('files:' + id); if (this.state.activeWorkspace === id) this.state.activeWorkspace = this.state.workspaces[0].id; this.save(); DS.bus.emit('workspace:switch', this.ws()); return true; },
  usageBytes() { try { return JSON.stringify(this.state).length + Object.values(this.files).reduce((a, f) => a + JSON.stringify(f).length, 0); } catch (_) { return 0; } }
};
