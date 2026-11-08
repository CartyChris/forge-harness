/* ═══════════════════════════ FS (workspace filesystem: in-browser or via local bridge) ═══════════════════════════ */
function normPath(p) {
  let s = String(p == null || p === '' ? '/' : p).replace(/\\/g, '/').trim(); if (!s.startsWith('/')) s = '/' + s;
  const out = []; for (const part of s.split('/')) { if (!part || part === '.') continue; if (part === '..') { out.pop(); continue; } out.push(part); }
  return '/' + out.join('/');
}
const globToRe = g => new RegExp('^' + String(g).replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*/g, '\u0001').replace(/\*/g, '[^/]*').replace(/\u0001/g, '.*').replace(/\?/g, '[^/]') + '$', 'i');
const FS = DS.fs = {
  norm: normPath,
  backend() { const w = Store.ws(); return (w && w.backend) || { type: 'mem' }; },
  isBridge() { return this.backend().type === 'bridge'; },
  isBinary(content) { return typeof content === 'string' && /^data:[^;,]+(;[^,]*)?,/.test(content.slice(0, 80)); },
  _emit(path, kind) { DS.bus.emit('fs:change', { path, kind }); },
  async list(dir = '/') {
    dir = normPath(dir);
    if (this.isBridge()) { const r = await DS.bridge.call('list', { path: dir }); return r.map(e => ({ name: e.name, path: (dir === '/' ? '' : dir) + '/' + e.name, type: e.type, size: e.size == null ? null : e.size, mtime: e.mtime || 0 })); }
    const prefix = dir === '/' ? '/' : dir + '/'; const by = new Map(); const files = Store.wsFiles();
    for (const p of Object.keys(files)) {
      if (!p.startsWith(prefix)) continue; const rest = p.slice(prefix.length); if (!rest) continue;
      const seg = rest.split('/')[0]; const isDir = rest.includes('/'); const full = prefix + seg;
      if (isDir) by.set(seg, { name: seg, path: full, type: 'dir', size: null, mtime: 0 });
      else if (!by.has(seg)) by.set(seg, { name: seg, path: full, type: 'file', size: new Blob([files[p].content]).size, mtime: files[p].mtime });
    }
    return [...by.values()].sort((a, b) => a.type === b.type ? a.name.localeCompare(b.name) : (a.type === 'dir' ? -1 : 1));
  },
  async read(p, opts = {}) {
    p = normPath(p);
    if (this.isBridge()) { const r = await DS.bridge.call('read', { path: p }); return { path: p, content: r.content, size: (r.content || '').length, truncated: !!r.truncated, mtime: now() }; }
    const f = Store.wsFiles()[p]; if (!f) throw new Error('no such file: ' + p);
    return { path: p, content: f.content, size: f.content.length, mtime: f.mtime, truncated: false };
  },
  async exists(p) { p = normPath(p); if (this.isBridge()) { try { await DS.bridge.call('read', { path: p }); return true; } catch (_) { return false; } } return p in Store.wsFiles(); },
  async write(p, content) {
    p = normPath(p); if (p === '/') throw new Error('cannot write the filesystem root'); content = String(content == null ? '' : content);
    if (this.isBridge()) { const r = await DS.bridge.call('write', { path: p, content }); this._emit(p, 'update'); return { path: p, bytes: r.bytes, created: false }; }
    const files = Store.wsFiles(); const created = !(p in files);
    files[p] = { path: p, content, mtime: now() }; Store.markFiles(); this._emit(p, created ? 'create' : 'update');
    return { path: p, bytes: new Blob([content]).size, created };
  },
  async remove(p) {
    p = normPath(p); if (p === '/') throw new Error('cannot remove the filesystem root');
    if (this.isBridge()) { await DS.bridge.call('remove', { path: p }); this._emit(p, 'delete'); return 1; }
    const files = Store.wsFiles(); let n = 0; const pre = p + '/';
    for (const k of Object.keys(files)) if (k === p || k.startsWith(pre)) { delete files[k]; n++; }
    Store.markFiles(); this._emit(p, 'delete'); return n;
  },
  async move(a, b) { const f = await this.read(a); await this.write(b, f.content); await this.remove(a); return { from: normPath(a), to: normPath(b) }; },
  async copy(a, b) { const f = await this.read(a); return this.write(b, f.content); },
  /* flat list of every file path under dir (mem: instant; bridge: breadth-limited walk) */
  async walk(dir = '/', limit = 2000) {
    dir = normPath(dir);
    if (!this.isBridge()) { const pre = dir === '/' ? '/' : dir + '/'; return Object.keys(Store.wsFiles()).filter(p => p.startsWith(pre)).sort().slice(0, limit); }
    const out = []; const q = [dir];
    while (q.length && out.length < limit) { const d = q.shift(); let ents = []; try { ents = await this.list(d); } catch (_) {} for (const e of ents) { if (/^(node_modules|\.git)$/.test(e.name)) continue; if (e.type === 'dir') q.push(e.path); else out.push(e.path); } }
    return out;
  },
  async search(query, { dir = '/', regex = false, glob = null, max = 80, ci = true } = {}) {
    if (this.isBridge()) { try { return (await DS.bridge.call('grep', { pattern: query, path: normPath(dir), regex, glob, max, ci })).matches; } catch (e) { if (!/unknown op/.test(e.message)) throw e; } }
    let re; try { re = regex ? new RegExp(query, ci ? 'i' : '') : null; } catch (e) { throw new Error('bad regex: ' + e.message); }
    const gre = glob ? globToRe(glob) : null; const q = ci ? String(query).toLowerCase() : String(query); const out = [];
    for (const p of await this.walk(dir)) {
      if (gre && !gre.test(p) && !gre.test(p.split('/').pop())) continue;
      let f; try { f = await this.read(p); } catch (_) { continue; } if (this.isBinary(f.content)) continue;
      const lines = f.content.split('\n');
      for (let i = 0; i < lines.length; i++) { const hit = re ? re.test(lines[i]) : (ci ? lines[i].toLowerCase() : lines[i]).includes(q); if (hit) { out.push({ path: p, line: i + 1, text: lines[i].slice(0, 200) }); if (out.length >= max) return out; } }
    }
    return out;
  },
  async tree(dir = '/', depth = 3, limit = 160) {
    const lines = []; let n = 0;
    const walk = async (d, pre, lvl) => {
      if (lvl > depth || n > limit) return; let ents = []; try { ents = await this.list(d); } catch (_) { return; }
      for (let i = 0; i < ents.length; i++) { if (n++ > limit) { lines.push(pre + '…'); return; } const e = ents[i]; const last = i === ents.length - 1; lines.push(pre + (last ? '└─ ' : '├─ ') + e.name + (e.type === 'dir' ? '/' : '')); if (e.type === 'dir' && !/^(node_modules|\.git)$/.test(e.name)) await walk(e.path, pre + (last ? '   ' : '│  '), lvl + 1); }
    };
    await walk(normPath(dir), '', 1); return lines.join('\n') || '(empty)';
  }
};
