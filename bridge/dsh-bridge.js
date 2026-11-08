#!/usr/bin/env node
/* Forge bridge (Node, zero dependencies). Gives the Forge web app a real folder, a shell, a fetch proxy and stdio MCP servers.
   usage: node dsh-bridge.js [--root DIR] [--port 8787] [--host 127.0.0.1] [--token TOKEN] [--readonly] [--no-shell]
   Security model: binds to loopback by default; every connection must present the token (WebSocket subprotocol
   "token.<base64url>"); all paths are confined to --root (symlinks resolved); --readonly disables write/remove/shell/mcp. */
'use strict';
const http = require('http'), crypto = require('crypto'), fs = require('fs'), path = require('path'), os = require('os'), cp = require('child_process');
const argv = process.argv.slice(2); const arg = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 ? (argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : true) : d; };
const ROOT = fs.realpathSync(path.resolve(String(arg('root', process.cwd())).replace(/^~(?=$|\/)/, os.homedir())));
const PORT = +arg('port', 8787), HOST = String(arg('host', '127.0.0.1')); const READONLY = !!arg('readonly', false), NOSHELL = !!arg('no-shell', false);
const TOKEN = String(arg('token', crypto.randomBytes(18).toString('base64url'))); const VERSION = '2.0.0'; const MAX_READ = 5 * 1024 * 1024;
const OPS = ['ping', 'list', 'read', 'write', 'remove', 'shell', 'grep', 'fetch', 'mcp'];

/* ---- path confinement ---- */
function safe(p, forWrite) {
  const abs = path.resolve(ROOT, '.' + path.posix.normalize('/' + String(p == null ? '/' : p).replace(/\\/g, '/')));
  if (abs !== ROOT && !abs.startsWith(ROOT + path.sep)) throw new Error('path escapes root');
  let probe = abs; while (!fs.existsSync(probe) && probe !== ROOT) probe = path.dirname(probe);
  const real = fs.realpathSync(probe); if (real !== ROOT && !real.startsWith(ROOT + path.sep)) throw new Error('symlink escapes root');
  return abs;
}
const mime = f => ({ '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.webm': 'video/webm', '.mp4': 'video/mp4', '.pdf': 'application/pdf' }[path.extname(f).toLowerCase()] || 'application/octet-stream');
const isBin = buf => { const n = Math.min(buf.length, 4096); for (let i = 0; i < n; i++) if (buf[i] === 0) return true; return false; };

/* ---- ops ---- */
const ops = {
  ping: async () => ({ name: 'dsh-bridge', version: VERSION, impl: 'node ' + process.version, root: ROOT, platform: process.platform, readonly: READONLY, shell: !READONLY && !NOSHELL, ops: OPS }),
  list: async ({ path: p }) => { const d = safe(p); return fs.readdirSync(d, { withFileTypes: true }).filter(e => e.name !== '.git' || true).map(e => { let st = null; try { st = fs.statSync(path.join(d, e.name)); } catch (_) {} return { name: e.name, type: (st ? st.isDirectory() : e.isDirectory()) ? 'dir' : 'file', size: st && st.isFile() ? st.size : null, mtime: st ? st.mtimeMs : 0 }; }).sort((a, b) => a.type === b.type ? a.name.localeCompare(b.name) : (a.type === 'dir' ? -1 : 1)); },
  read: async ({ path: p }) => { const f = safe(p); const st = fs.statSync(f); if (st.isDirectory()) throw new Error('is a directory'); if (st.size > MAX_READ) throw new Error('file too large (' + st.size + ' bytes, limit ' + MAX_READ + ')'); const buf = fs.readFileSync(f); if (isBin(buf)) return { content: 'data:' + mime(f) + ';base64,' + buf.toString('base64'), binary: true, size: st.size }; return { content: buf.toString('utf8'), size: st.size, truncated: false }; },
  write: async ({ path: p, content }) => { if (READONLY) throw new Error('bridge is read-only'); const f = safe(p, true); if (f === ROOT) throw new Error('cannot write root'); fs.mkdirSync(path.dirname(f), { recursive: true }); const m = /^data:[^;,]+(;[^,]*)?,/.exec(String(content).slice(0, 100)); let buf; if (m && /;base64/.test(m[0])) buf = Buffer.from(String(content).slice(m[0].length), 'base64'); else buf = Buffer.from(String(content == null ? '' : content), 'utf8'); fs.writeFileSync(f, buf); return { bytes: buf.length }; },
  remove: async ({ path: p }) => { if (READONLY) throw new Error('bridge is read-only'); const f = safe(p); if (f === ROOT) throw new Error('cannot remove root'); fs.rmSync(f, { recursive: true, force: true }); return { removed: 1 }; },
  grep: async ({ pattern, path: p, regex, glob, max = 80, ci = true }) => {
    const base = safe(p || '/'); let re; try { re = regex ? new RegExp(pattern, ci ? 'i' : '') : null; } catch (e) { throw new Error('bad regex: ' + e.message); }
    const q = ci ? String(pattern).toLowerCase() : String(pattern); const g = glob ? new RegExp('^' + glob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*/g, '\u0001').replace(/\*/g, '[^/]*').replace(/\u0001/g, '.*').replace(/\?/g, '[^/]') + '$', 'i') : null; const out = [];
    (function walk(d) { if (out.length >= max) return; let es; try { es = fs.readdirSync(d, { withFileTypes: true }); } catch (_) { return; } for (const e of es) { if (out.length >= max) return; if (e.name === 'node_modules' || e.name === '.git') continue; const f = path.join(d, e.name); if (e.isDirectory()) { walk(f); continue; } if (!e.isFile()) continue; const rel = '/' + path.relative(ROOT, f).split(path.sep).join('/'); if (g && !g.test(rel) && !g.test(e.name)) continue; let buf; try { if (fs.statSync(f).size > 2e6) continue; buf = fs.readFileSync(f); } catch (_) { continue; } if (isBin(buf)) continue; const lines = buf.toString('utf8').split('\n'); for (let i = 0; i < lines.length && out.length < max; i++) { const hit = re ? re.test(lines[i]) : (ci ? lines[i].toLowerCase() : lines[i]).includes(q); if (hit) out.push({ path: rel, line: i + 1, text: lines[i].slice(0, 200) }); } } })(base);
    return { matches: out };
  },
  fetch: async ({ url, method = 'GET', headers = {}, body }) => {
    if (!/^https?:\/\//i.test(url)) throw new Error('only http(s) URLs'); const ac = new AbortController(); const t = setTimeout(() => ac.abort(), 60000);
    try { const r = await fetch(url, { method, headers, body: ['GET', 'HEAD'].includes(method) ? undefined : body, signal: ac.signal, redirect: 'follow' }); const txt = await r.text(); const h = {}; r.headers.forEach((v, k) => { h[k] = v; }); return { status: r.status, headers: h, body: txt.slice(0, 4e6) }; } finally { clearTimeout(t); }
  },
  shell: async ({ cmd, cwd, timeout = 60 }, send) => {
    if (READONLY || NOSHELL) throw new Error('shell is disabled on this bridge'); const dir = safe(cwd || '/');
    return new Promise((resolve, reject) => {
      const sh = process.platform === 'win32' ? ['cmd', ['/c', cmd]] : ['/bin/sh', ['-c', cmd]]; const ch = cp.spawn(sh[0], sh[1], { cwd: dir, env: process.env, detached: process.platform !== 'win32' }); let so = '', se = '', done = false;
      const kill = () => { try { process.platform === 'win32' ? ch.kill() : process.kill(-ch.pid, 'SIGKILL'); } catch (_) { try { ch.kill('SIGKILL'); } catch (__) {} } };
      const timer = setTimeout(() => { se += '\n[bridge] timed out after ' + timeout + 's'; kill(); }, Math.max(1, Math.min(600, +timeout || 60)) * 1000);
      ch.stdout.on('data', d => { const s = d.toString(); if (so.length < 2e6) so += s; send({ data: s, stream: 'stdout' }); }); ch.stderr.on('data', d => { const s = d.toString(); if (se.length < 2e6) se += s; send({ data: s, stream: 'stderr' }); });
      ch.on('error', e => { if (!done) { done = true; clearTimeout(timer); reject(e); } }); ch.on('close', code => { if (!done) { done = true; clearTimeout(timer); resolve({ code: code == null ? -1 : code, stdout: so, stderr: se }); } });
    });
  },
  mcp: async ({ server, command, args = [], method, params }) => {
    if (READONLY || NOSHELL) throw new Error('mcp stdio is disabled on this bridge'); let s = mcpServers.get(server);
    if (!s || s.dead) { const ch = cp.spawn(command, args, { cwd: ROOT, stdio: ['pipe', 'pipe', 'pipe'], env: process.env }); s = { ch, pending: new Map(), buf: '', n: 0, dead: false, err: '' }; mcpServers.set(server, s); ch.on('error', e => { s.dead = true; s.err = e.message; for (const [, p] of s.pending) p.reject(e); s.pending.clear(); }); ch.on('close', () => { s.dead = true; for (const [, p] of s.pending) p.reject(new Error('mcp server exited ' + s.err)); s.pending.clear(); }); ch.stderr.on('data', d => { s.err = (s.err + d.toString()).slice(-800); }); ch.stdout.on('data', d => { s.buf += d.toString(); let i; while ((i = s.buf.indexOf('\n')) >= 0) { const line = s.buf.slice(0, i).trim(); s.buf = s.buf.slice(i + 1); if (!line) continue; let m; try { m = JSON.parse(line); } catch (_) { continue; } const p = s.pending.get(m.id); if (p) { s.pending.delete(m.id); m.error ? p.reject(new Error(m.error.message || 'mcp error')) : p.resolve(m.result); } } }); }
    if (method && method.startsWith('notifications/')) { s.ch.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n'); return {}; }
    const id = ++s.n; return new Promise((resolve, reject) => { const t = setTimeout(() => { s.pending.delete(id); reject(new Error('mcp timeout')); }, 45000); s.pending.set(id, { resolve: v => { clearTimeout(t); resolve(v); }, reject: e => { clearTimeout(t); reject(e); } }); s.ch.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n'); });
  }
};
const mcpServers = new Map();

/* ---- minimal RFC 6455 server ---- */
const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
function frame(op, payload) { const len = payload.length; let h; if (len < 126) h = Buffer.from([0x80 | op, len]); else if (len < 65536) { h = Buffer.alloc(4); h[0] = 0x80 | op; h[1] = 126; h.writeUInt16BE(len, 2); } else { h = Buffer.alloc(10); h[0] = 0x80 | op; h[1] = 127; h.writeBigUInt64BE(BigInt(len), 2); } return Buffer.concat([h, payload]); }
const server = http.createServer((req, res) => { res.writeHead(200, { 'content-type': 'text/plain' }); res.end('Forge bridge ' + VERSION + ' — connect with a WebSocket (subprotocol "dsh").\n'); });
server.on('upgrade', (req, socket) => {
  const key = req.headers['sec-websocket-key']; const protos = String(req.headers['sec-websocket-protocol'] || '').split(',').map(s => s.trim()).filter(Boolean);
  const tp = protos.find(p => p.startsWith('token.')); let supplied = ''; try { supplied = tp ? Buffer.from(tp.slice(6), 'base64url').toString('utf8') : ''; } catch (_) {}
  const a = Buffer.from(supplied), b = Buffer.from(TOKEN); const okTok = a.length === b.length && crypto.timingSafeEqual(a, b);
  if (!key || !okTok || !protos.includes('dsh')) { socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\nContent-Length: 0\r\n\r\n'); socket.destroy(); log('rejected connection (bad token or protocol) from ' + socket.remoteAddress); return; }
  const accept = crypto.createHash('sha1').update(key + GUID).digest('base64');
  socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + accept + '\r\nSec-WebSocket-Protocol: dsh\r\n\r\n'); socket.setNoDelay(true);
  log('client connected from ' + socket.remoteAddress);
  let buf = Buffer.alloc(0), frag = [], fragOp = 0; const sendJSON = o => { if (!socket.destroyed) socket.write(frame(1, Buffer.from(JSON.stringify(o)))); };
  const handle = async txt => {
    let m; try { m = JSON.parse(txt); } catch (_) { return; } const { id, op, params } = m; const fn = ops[op];
    if (!fn) return sendJSON({ id, ok: false, error: 'unknown op: ' + op });
    try { const result = await fn(params || {}, c => sendJSON({ id, event: 'chunk', ...c })); sendJSON({ id, ok: true, result }); } catch (e) { sendJSON({ id, ok: false, error: e.message || String(e) }); }
  };
  socket.on('data', d => {
    buf = Buffer.concat([buf, d]);
    for (;;) {
      if (buf.length < 2) return; const fin = !!(buf[0] & 0x80), op = buf[0] & 0x0f, masked = !!(buf[1] & 0x80); let len = buf[1] & 0x7f, off = 2;
      if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); off = 4; } else if (len === 127) { if (buf.length < 10) return; len = Number(buf.readBigUInt64BE(2)); off = 10; }
      if (len > 64 * 1024 * 1024) { socket.destroy(); return; } const need = off + (masked ? 4 : 0) + len; if (buf.length < need) return;
      let payload = buf.slice(off + (masked ? 4 : 0), need); if (masked) { const mk = buf.slice(off, off + 4); payload = Buffer.from(payload); for (let i = 0; i < payload.length; i++) payload[i] ^= mk[i & 3]; } buf = buf.slice(need);
      if (op === 8) { socket.write(frame(8, Buffer.alloc(0))); socket.end(); return; } if (op === 9) { socket.write(frame(10, payload)); continue; } if (op === 10) continue;
      if (op === 1 || op === 2 || op === 0) { if (op !== 0) { frag = []; fragOp = op; } frag.push(payload); if (fin) { const full = Buffer.concat(frag); frag = []; if (fragOp === 1) handle(full.toString('utf8')); } }
    }
  });
  socket.on('error', () => {}); socket.on('close', () => log('client disconnected'));
});
const log = m => console.log('[' + new Date().toTimeString().slice(0, 8) + '] ' + m);
process.on('exit', () => { for (const [, s] of mcpServers) { try { s.ch.kill(); } catch (_) {} } }); process.on('SIGINT', () => process.exit(0)); process.on('SIGTERM', () => process.exit(0));
server.listen(PORT, HOST, () => {
  console.log('\nForge bridge ' + VERSION + ' (node)\n  root     ' + ROOT + '\n  listen   ws://' + HOST + ':' + PORT + '\n  token    ' + TOKEN + '\n  mode     ' + (READONLY ? 'READ-ONLY' : NOSHELL ? 'files only (no shell)' : 'files + shell + mcp') + '\n\nIn Forge: header ● → paste the token → Connect.' + (HOST !== '127.0.0.1' && HOST !== 'localhost' ? '\n  ⚠ listening on a non-loopback address: anyone with the token can run commands on this machine.' : '') + '\n');
});
server.on('error', e => { console.error('bridge failed to start: ' + e.message); process.exit(1); });
