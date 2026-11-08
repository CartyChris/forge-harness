#!/usr/bin/env python3
"""Forge bridge (Python 3.8+, standard library only). Same protocol as dsh-bridge.js.
usage: python3 dsh_bridge.py [--root DIR] [--port 8787] [--host 127.0.0.1] [--token TOKEN] [--readonly] [--no-shell]
Security: loopback by default; token required (WebSocket subprotocol "token.<base64url>"); paths confined to --root
(symlinks resolved); --readonly disables write/remove/shell/mcp."""
import argparse, asyncio, base64, hashlib, hmac, json, mimetypes, os, re, secrets, shutil, struct, sys, time, urllib.request, urllib.error
ap = argparse.ArgumentParser(); ap.add_argument('--root', default=os.getcwd()); ap.add_argument('--port', type=int, default=8787); ap.add_argument('--host', default='127.0.0.1')
ap.add_argument('--token', default=None); ap.add_argument('--readonly', action='store_true'); ap.add_argument('--no-shell', action='store_true'); A = ap.parse_args()
ROOT = os.path.realpath(os.path.expanduser(A.root)); TOKEN = A.token or secrets.token_urlsafe(18); VERSION = '2.0.0'; MAX_READ = 5 * 1024 * 1024
OPS = ['ping', 'list', 'read', 'write', 'remove', 'shell', 'grep', 'fetch', 'mcp']; GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11'

def safe(p):
    p = str(p if p is not None else '/').replace('\\', '/'); parts = []
    for seg in p.split('/'):
        if seg in ('', '.'): continue
        if seg == '..':
            if parts: parts.pop()
            continue
        parts.append(seg)
    ab = os.path.join(ROOT, *parts) if parts else ROOT
    probe = ab
    while not os.path.exists(probe) and probe != ROOT: probe = os.path.dirname(probe)
    real = os.path.realpath(probe)
    if real != ROOT and not real.startswith(ROOT + os.sep): raise Exception('symlink escapes root')
    return ab
def is_bin(b): return b'\x00' in b[:4096]
def ro():
    if A.readonly: raise Exception('bridge is read-only')

async def op_ping(p, send): return {'name': 'dsh-bridge', 'version': VERSION, 'impl': 'python ' + sys.version.split()[0], 'root': ROOT, 'platform': sys.platform, 'readonly': A.readonly, 'shell': not (A.readonly or A.no_shell), 'ops': OPS}
async def op_list(p, send):
    d = safe(p.get('path')); out = []
    for e in os.scandir(d):
        try: st = e.stat(); isd = e.is_dir()
        except OSError: st = None; isd = False
        out.append({'name': e.name, 'type': 'dir' if isd else 'file', 'size': (st.st_size if st and not isd else None), 'mtime': (st.st_mtime * 1000 if st else 0)})
    out.sort(key=lambda x: (x['type'] != 'dir', x['name'].lower())); return out
async def op_read(p, send):
    f = safe(p.get('path'))
    if os.path.isdir(f): raise Exception('is a directory')
    sz = os.path.getsize(f)
    if sz > MAX_READ: raise Exception('file too large (%d bytes, limit %d)' % (sz, MAX_READ))
    b = open(f, 'rb').read()
    if is_bin(b): return {'content': 'data:%s;base64,%s' % (mimetypes.guess_type(f)[0] or 'application/octet-stream', base64.b64encode(b).decode()), 'binary': True, 'size': sz}
    return {'content': b.decode('utf-8', 'replace'), 'size': sz, 'truncated': False}
async def op_write(p, send):
    ro(); f = safe(p.get('path'))
    if f == ROOT: raise Exception('cannot write root')
    os.makedirs(os.path.dirname(f), exist_ok=True); c = p.get('content'); c = '' if c is None else str(c); m = re.match(r'^data:[^;,]+(;[^,]*)?,', c[:100])
    b = base64.b64decode(c[m.end():]) if (m and ';base64' in m.group(0)) else c.encode('utf-8')
    open(f, 'wb').write(b); return {'bytes': len(b)}
async def op_remove(p, send):
    ro(); f = safe(p.get('path'))
    if f == ROOT: raise Exception('cannot remove root')
    if os.path.isdir(f) and not os.path.islink(f): shutil.rmtree(f, ignore_errors=True)
    elif os.path.lexists(f): os.remove(f)
    return {'removed': 1}
async def op_grep(p, send):
    base = safe(p.get('path') or '/'); pat = p.get('pattern', ''); ci = p.get('ci', True); mx = int(p.get('max') or 80); out = []
    try: rx = re.compile(pat, re.I if ci else 0) if p.get('regex') else None
    except re.error as e: raise Exception('bad regex: %s' % e)
    q = pat.lower() if ci else pat; g = p.get('glob'); gre = None
    if g: gre = re.compile('^' + re.escape(g).replace('\\*\\*', '\x01').replace('\\*', '[^/]*').replace('\x01', '.*').replace('\\?', '[^/]') + '$', re.I)
    for dp, dn, fn in os.walk(base):
        dn[:] = [d for d in dn if d not in ('node_modules', '.git')]
        for n in fn:
            if len(out) >= mx: return {'matches': out}
            f = os.path.join(dp, n); rel = '/' + os.path.relpath(f, ROOT).replace(os.sep, '/')
            if gre and not gre.match(rel) and not gre.match(n): continue
            try:
                if os.path.getsize(f) > 2e6: continue
                b = open(f, 'rb').read()
            except OSError: continue
            if is_bin(b): continue
            for i, line in enumerate(b.decode('utf-8', 'replace').split('\n')):
                if (rx.search(line) if rx else (q in (line.lower() if ci else line))):
                    out.append({'path': rel, 'line': i + 1, 'text': line[:200]})
                    if len(out) >= mx: break
    return {'matches': out}
def _fetch(p):
    url = p.get('url', '')
    if not re.match(r'^https?://', url, re.I): raise Exception('only http(s) URLs')
    body = p.get('body'); m = p.get('method', 'GET')
    req = urllib.request.Request(url, data=(body.encode() if body and m not in ('GET', 'HEAD') else None), method=m, headers=p.get('headers') or {})
    try: r = urllib.request.urlopen(req, timeout=60); st = r.status
    except urllib.error.HTTPError as e: r = e; st = e.code
    return {'status': st, 'headers': {k.lower(): v for k, v in r.headers.items()}, 'body': r.read(4_000_000).decode('utf-8', 'replace')}
async def op_fetch(p, send): return await asyncio.get_event_loop().run_in_executor(None, _fetch, p)
async def op_shell(p, send):
    ro()
    if A.no_shell: raise Exception('shell is disabled on this bridge')
    cwd = safe(p.get('cwd') or '/'); timeout = max(1, min(600, float(p.get('timeout') or 60)))
    proc = await asyncio.create_subprocess_shell(p.get('cmd', ''), cwd=cwd, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE, start_new_session=(os.name != 'nt'))
    so, se = [], []
    async def pump(stream, buf, name):
        while True:
            d = await stream.read(4096)
            if not d: break
            s = d.decode('utf-8', 'replace')
            if sum(map(len, buf)) < 2_000_000: buf.append(s)
            await send({'data': s, 'stream': name})
    t = asyncio.gather(pump(proc.stdout, so, 'stdout'), pump(proc.stderr, se, 'stderr'))
    try: await asyncio.wait_for(asyncio.shield(t), timeout)
    except asyncio.TimeoutError:
        se.append('\n[bridge] timed out after %ds' % timeout)
        try:
            import signal; os.killpg(proc.pid, signal.SIGKILL) if os.name != 'nt' else proc.kill()
        except Exception: proc.kill()
    await proc.wait()
    try: await asyncio.wait_for(t, 2)
    except Exception: pass
    return {'code': proc.returncode if proc.returncode is not None else -1, 'stdout': ''.join(so), 'stderr': ''.join(se)}
MCP = {}
async def op_mcp(p, send):
    ro()
    if A.no_shell: raise Exception('mcp stdio is disabled on this bridge')
    name = p.get('server'); s = MCP.get(name)
    if not s or s['dead']:
        proc = await asyncio.create_subprocess_exec(p.get('command'), *(p.get('args') or []), cwd=ROOT, stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE)
        s = {'proc': proc, 'pending': {}, 'n': 0, 'dead': False, 'err': ''}; MCP[name] = s
        async def rd():
            while True:
                line = await proc.stdout.readline()
                if not line: break
                try: m = json.loads(line)
                except Exception: continue
                f = s['pending'].pop(m.get('id'), None)
                if f and not f.done():
                    if 'error' in m: f.set_exception(Exception((m['error'] or {}).get('message', 'mcp error')))
                    else: f.set_result(m.get('result'))
            s['dead'] = True
            for f in s['pending'].values():
                if not f.done(): f.set_exception(Exception('mcp server exited ' + s['err']))
        async def er():
            while True:
                d = await proc.stderr.read(1024)
                if not d: break
                s['err'] = (s['err'] + d.decode('utf-8', 'replace'))[-800:]
        asyncio.ensure_future(rd()); asyncio.ensure_future(er())
    method = p.get('method', '')
    if method.startswith('notifications/'):
        s['proc'].stdin.write((json.dumps({'jsonrpc': '2.0', 'method': method, 'params': p.get('params')}) + '\n').encode()); await s['proc'].stdin.drain(); return {}
    s['n'] += 1; i = s['n']; fut = asyncio.get_event_loop().create_future(); s['pending'][i] = fut
    s['proc'].stdin.write((json.dumps({'jsonrpc': '2.0', 'id': i, 'method': method, 'params': p.get('params')}) + '\n').encode()); await s['proc'].stdin.drain()
    return await asyncio.wait_for(fut, 45)
OPFN = {'ping': op_ping, 'list': op_list, 'read': op_read, 'write': op_write, 'remove': op_remove, 'grep': op_grep, 'fetch': op_fetch, 'shell': op_shell, 'mcp': op_mcp}

def log(m): print('[%s] %s' % (time.strftime('%H:%M:%S'), m), flush=True)
def frame(op, payload):
    n = len(payload)
    h = bytes([0x80 | op, n]) if n < 126 else (bytes([0x80 | op, 126]) + struct.pack('>H', n) if n < 65536 else bytes([0x80 | op, 127]) + struct.pack('>Q', n))
    return h + payload
async def handle(reader, writer):
    peer = writer.get_extra_info('peername')
    try:
        head = await asyncio.wait_for(reader.readuntil(b'\r\n\r\n'), 10)
    except Exception: writer.close(); return
    lines = head.decode('latin1').split('\r\n'); hd = {}
    for l in lines[1:]:
        if ':' in l: k, v = l.split(':', 1); hd[k.strip().lower()] = v.strip()
    protos = [x.strip() for x in hd.get('sec-websocket-protocol', '').split(',') if x.strip()]; key = hd.get('sec-websocket-key')
    tp = next((x for x in protos if x.startswith('token.')), None); supplied = ''
    try: supplied = base64.urlsafe_b64decode(tp[6:] + '=' * (-len(tp[6:]) % 4)).decode() if tp else ''
    except Exception: pass
    if hd.get('upgrade', '').lower() != 'websocket':
        body = ('Forge bridge %s — connect with a WebSocket (subprotocol "dsh").\n' % VERSION).encode(); writer.write(b'HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nContent-Length: %d\r\nConnection: close\r\n\r\n' % len(body) + body); await writer.drain(); writer.close(); return
    if not key or 'dsh' not in protos or not hmac.compare_digest(supplied.encode(), TOKEN.encode()):
        writer.write(b'HTTP/1.1 401 Unauthorized\r\nConnection: close\r\nContent-Length: 0\r\n\r\n'); await writer.drain(); writer.close(); log('rejected connection (bad token or protocol) from %s' % (peer[0],)); return
    acc = base64.b64encode(hashlib.sha1((key + GUID).encode()).digest()).decode()
    writer.write(('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: %s\r\nSec-WebSocket-Protocol: dsh\r\n\r\n' % acc).encode()); await writer.drain(); log('client connected from %s' % (peer[0],))
    lock = asyncio.Lock()
    async def send_json(o):
        async with lock:
            try: writer.write(frame(1, json.dumps(o).encode())); await writer.drain()
            except Exception: pass
    async def run(m):
        i, op = m.get('id'), m.get('op'); fn = OPFN.get(op)
        if not fn: return await send_json({'id': i, 'ok': False, 'error': 'unknown op: %s' % op})
        async def chunk(c): await send_json(dict({'id': i, 'event': 'chunk'}, **c))
        try: await send_json({'id': i, 'ok': True, 'result': await fn(m.get('params') or {}, chunk)})
        except Exception as e: await send_json({'id': i, 'ok': False, 'error': str(e) or e.__class__.__name__})
    frag = []; fragop = 0
    try:
        while True:
            h = await reader.readexactly(2); fin = bool(h[0] & 0x80); op = h[0] & 0x0f; masked = bool(h[1] & 0x80); n = h[1] & 0x7f
            if n == 126: n = struct.unpack('>H', await reader.readexactly(2))[0]
            elif n == 127: n = struct.unpack('>Q', await reader.readexactly(8))[0]
            if n > 64 * 1024 * 1024: break
            mk = await reader.readexactly(4) if masked else b''; pl = await reader.readexactly(n) if n else b''
            if masked: pl = bytes(b ^ mk[i & 3] for i, b in enumerate(pl)) if n < 4096 else (int.from_bytes(pl, 'big') ^ int.from_bytes((mk * (n // 4 + 1))[:n], 'big')).to_bytes(n, 'big')
            if op == 8: writer.write(frame(8, b'')); break
            if op == 9: writer.write(frame(10, pl)); continue
            if op == 10: continue
            if op in (0, 1, 2):
                if op: frag = []; fragop = op
                frag.append(pl)
                if fin:
                    full = b''.join(frag); frag = []
                    if fragop == 1:
                        try: m = json.loads(full.decode())
                        except Exception: continue
                        asyncio.ensure_future(run(m))
    except (asyncio.IncompleteReadError, ConnectionError): pass
    finally:
        log('client disconnected')
        try: writer.close()
        except Exception: pass
async def main():
    srv = await asyncio.start_server(handle, A.host, A.port)
    print('\nForge bridge %s (python)\n  root     %s\n  listen   ws://%s:%d\n  token    %s\n  mode     %s\n\nIn Forge: header ● → paste the token → Connect.%s\n' % (VERSION, ROOT, A.host, A.port, TOKEN, 'READ-ONLY' if A.readonly else ('files only (no shell)' if A.no_shell else 'files + shell + mcp'), '' if A.host in ('127.0.0.1', 'localhost') else '\n  ! listening on a non-loopback address: anyone with the token can run commands on this machine.'), flush=True)
    async with srv: await srv.serve_forever()
try: asyncio.run(main())
except KeyboardInterrupt: pass
except OSError as e: print('bridge failed to start: %s' % e); sys.exit(1)
