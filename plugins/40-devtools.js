// A4 — forge.devtools: virtual shell, terminal view, run_js/run_py/web_fetch/web_search, highlighting, rich fences, voice, export
DS.plugin({
  name: 'forge.devtools', title: 'Dev tools', version: '1.0.0', tags: ['dev', 'terminal', 'code', 'web'],
  description: 'Virtual shell + terminal, sandboxed JS/Python runners, web fetch/search, syntax highlighting, mermaid/math/csv/json fences, dictation and export.',
  apply(ctx) {
    const U = DS.util, esc = U.esc, fs = DS.fs;
    // ---------- run_js core ----------
    function runJS(code, timeout) {
      timeout = timeout || 8000;
      return new Promise((resolve) => {
        const t0 = performance.now();
        const src = `const L=[];const fmt=v=>{try{if(typeof v==='string')return v;if(v===undefined)return 'undefined';if(typeof v==='function')return v.toString().slice(0,200);return JSON.stringify(v,null,1)??String(v)}catch(e){return String(v)}};
['log','info','warn','error','debug'].forEach(k=>{console[k]=(...a)=>L.push({level:k,text:a.map(fmt).join(' ')})});
self.onmessage=async e=>{const code=e.data;let fn,res,err;
const c2=code.trim().replace(/;+$/,'');const k=Math.max(c2.lastIndexOf(';'),c2.lastIndexOf('\\n'));const tries=['return ('+c2+'\\n)'];if(k>0&&!/^\\s*(return|const|let|var|if|for|while|function|class|throw|})/.test(c2.slice(k+1)))tries.push(c2.slice(0,k+1)+'\\nreturn ('+c2.slice(k+1)+'\\n)');tries.push(code);for(const b of tries){try{fn=new Function('return (async()=>{'+b+'\\n})()');err=null;break}catch(e2){err=String(e2)}}
if(fn){try{res=await fn()}catch(e3){err=(e3&&e3.stack)?String(e3).slice(0,500):String(e3)}}
postMessage({logs:L,result:res===undefined?undefined:fmt(res),error:err})}`;
        let w;
        try { w = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' }))); }
        catch (e) { return resolve({ logs: [], error: 'Worker unavailable: ' + e.message, ms: 0 }); }
        const done = (r) => { clearTimeout(to); w.terminate(); r.ms = Math.round(performance.now() - t0); resolve(r); };
        const to = setTimeout(() => done({ logs: [], error: `Timed out after ${timeout}ms (infinite loop?)` }), timeout);
        w.onmessage = (e) => done(e.data);
        w.onerror = (e) => { e.preventDefault(); done({ logs: [], error: e.message || 'Worker error' }); };
        w.postMessage(String(code));
      });
    }
    // ---------- network helpers ----------
    async function getText(url) {
      try { const r = await fetch(url); return { status: r.status, text: await r.text() }; }
      catch (e) {
        if (DS.bridge && DS.bridge.online) { const r = await DS.bridge.call('fetch', { url, method: 'GET' }); return { status: r.status || 200, text: r.body || r.text || r.content || '' }; }
        throw new Error('Network unavailable (' + e.message + '). Connect the desktop bridge (Settings → Bridge) to fetch through your machine.');
      }
    }
    function htmlToText(html, base, maxLinks) {
      const doc = new DOMParser().parseFromString(html, 'text/html');
      doc.querySelectorAll('script,style,noscript,svg,iframe,template').forEach(n => n.remove());
      let n = 0;
      doc.querySelectorAll('a[href]').forEach(a => { if (n >= maxLinks) return; const t = a.textContent.trim(); if (!t) return; let h = a.getAttribute('href'); try { h = new URL(h, base).href; } catch (e) {} a.textContent = `[${t}](${h})`; n++; });
      doc.querySelectorAll('p,div,li,h1,h2,h3,h4,br,tr,section,article').forEach(el => el.append('\n'));
      const title = (doc.querySelector('title') || {}).textContent || '';
      const text = (doc.body ? doc.body.textContent : '').replace(/[ \t\f\v]+/g, ' ').replace(/\n\s*\n+/g, '\n\n').trim();
      return { title: title.trim(), text };
    }
    /* Prefer the Forge Vercel backend when it is online (no CORS limits there; SSRF-guarded server side). */
    async function backend(path) {
      const b = DS.service && DS.service('forge.backend'); if (!b || !b.api) return null;
      try { const inf = b.info(); if (!inf.online && !(await b.detect(true), b.info().online)) return null; const r = await b.api(path); return r && r.j ? r.j : null; } catch (_) { return null; }
    }
    async function webFetch(url, max) {
      if (!/^https?:/.test(url)) url = 'https://' + url;
      const via = await backend('/api/fetch?url=' + encodeURIComponent(url) + '&max=12000');
      if (via && typeof via.text === 'string') return { url: via.url || url, status: via.status, title: via.title || '', text: via.text.slice(0, 12000), route: 'backend' };
      const r = await getText(url);
      const isHtml = /<html|<body|<div/i.test(r.text.slice(0, 2000));
      const o = isHtml ? htmlToText(r.text, url, max || 40) : { title: '', text: r.text };
      return { url, status: r.status, title: o.title, text: o.text.slice(0, 12000) };
    }
    async function webSearch(query, n) {
      const via = await backend('/api/search?q=' + encodeURIComponent(query) + '&n=' + (n || 8));
      if (via && Array.isArray(via.results)) return via.results.slice(0, n || 8);
      const r = await getText('https://html.duckduckgo.com/html/?q=' + encodeURIComponent(query));
      const doc = new DOMParser().parseFromString(r.text, 'text/html');
      const out = [];
      doc.querySelectorAll('.result').forEach(el => {
        const a = el.querySelector('a.result__a'); if (!a) return;
        let url = a.getAttribute('href') || '';
        const m = url.match(/uddg=([^&]+)/); if (m) url = decodeURIComponent(m[1]);
        out.push({ title: a.textContent.trim(), url, snippet: ((el.querySelector('.result__snippet') || {}).textContent || '').trim() });
      });
      return out.slice(0, n || 8);
    }
    // ---------- vsh ----------
    const env = { HOME: '/', USER: 'forge', SHELL: 'vsh' };
    const hist = [];
    const join = (cwd, p) => { if (!p) return cwd; if (p === '~' || p.startsWith('~/')) p = '/' + p.slice(2); return fs.norm(p.startsWith('/') ? p : cwd.replace(/\/$/, '') + '/' + p); };
    function tokenize(line) {
      const toks = []; let cur = '', q = null, has = false;
      for (let i = 0; i < line.length; i++) {
        const c = line[i];
        if (q) { if (c === q) q = null; else if (c === '$' && q === '"') { const m = line.slice(i + 1).match(/^\w+/); if (m) { cur += env[m[0]] || ''; i += m[0].length; } else cur += c; } else cur += c; continue; }
        if (c === '"' || c === "'") { q = c; has = true; continue; }
        if (c === '$') { const m = line.slice(i + 1).match(/^\w+/); if (m) { cur += env[m[0]] || ''; i += m[0].length; has = true; continue; } }
        if (/\s/.test(c)) { if (cur || has) toks.push({ v: cur, raw: !has }); cur = ''; has = false; continue; }
        if (c === '|' || c === '>' || (c === '&' && line[i + 1] === '&')) {
          if (cur || has) toks.push({ v: cur, raw: !has }); cur = ''; has = false;
          if (c === '>' && line[i + 1] === '>') { toks.push({ op: '>>' }); i++; } else if (c === '&') { toks.push({ op: '&&' }); i++; } else toks.push({ op: c });
          continue;
        }
        cur += c;
      }
      if (cur || has) toks.push({ v: cur, raw: !has });
      return toks;
    }
    const globRe = (g) => new RegExp('^' + g.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$');
    async function expand(toks, cwd) {
      const out = [];
      for (const t of toks) {
        if (t.raw && /[*?]/.test(t.v)) {
          const full = join(cwd, t.v), dir = full.slice(0, full.lastIndexOf('/')) || '/', pat = full.slice(full.lastIndexOf('/') + 1);
          try { const ents = await fs.list(dir); const re = globRe(pat); const m = ents.map(e => e.name || e).filter(nm => re.test(nm)).sort(); if (m.length) { m.forEach(nm => out.push(t.v.includes('/') ? (dir === '/' ? '' : dir) + '/' + nm : nm)); continue; } } catch (e) {}
        }
        out.push(t.v);
      }
      return out;
    }
    const flags = (args) => { const f = new Set(), rest = []; for (const a of args) { if (/^-[a-zA-Z]+$/.test(a)) [...a.slice(1)].forEach(c => f.add(c)); else rest.push(a); } return [f, rest]; };
    async function readF(p) { const r = await fs.read(p); if (!r) throw new Error(p + ': No such file'); return typeof r === 'string' ? r : (r.content || ''); }
    async function isDir(p) { p = fs.norm(p); if (p === '/') return true; if (await fs.exists(p)) return false; try { return (await fs.list(p)).length > 0; } catch (e) { return false; } }
    const entName = (e) => typeof e === 'string' ? e : e.name;
    const entDir = (e) => typeof e === 'object' && (e.type === 'dir' || e.dir || e.isDir);
    async function builtin(cmd, args, stdin, st) {
      const [f, a] = flags(args); const P = (x) => join(st.cwd, x);
      switch (cmd) {
        case 'pwd': return st.cwd + '\n';
        case 'cd': { const d = P(a[0] || '/'); if (!(await isDir(d)) && d !== '/') throw new Error('cd: ' + (a[0]) + ': Not a directory'); st.cwd = d; return ''; }
        case 'ls': {
          const targets = a.length ? a : ['.']; let o = '';
          for (const t of targets) {
            const p = P(t);
            if (!(await isDir(p))) { if (await fs.exists(p)) { o += t + '\n'; continue; } throw new Error('ls: ' + t + ': No such file or directory'); }
            let ents = await fs.list(p); if (!f.has('a')) ents = ents.filter(e => !entName(e).startsWith('.'));
            ents.sort((x, y) => entName(x).localeCompare(entName(y)));
            if (f.has('l')) for (const e of ents) { const d = entDir(e); o += (d ? 'd' : '-') + 'rw-r--r--  ' + String(d ? '-' : DS.fmtBytes(e.size || 0)).padStart(8) + '  ' + entName(e) + (d ? '/' : '') + '\n'; }
            else o += ents.map(e => entName(e) + (entDir(e) ? '/' : '')).join('  ') + (ents.length ? '\n' : '');
          }
          return o;
        }
        case 'cat': return a.length ? (await Promise.all(a.map(x => readF(P(x))))).join('') : stdin;
        case 'echo': return (f.has('n') ? args.filter(x => x !== '-n') : args).join(' ') + (f.has('n') ? '' : '\n');
        case 'mkdir': for (const x of a) { if (fs.mkdir) await fs.mkdir(P(x)); else await fs.write(P(x) + '/.keep', ''); } return '';
        case 'touch': for (const x of a) { if (!(await fs.exists(P(x)))) { DS.agent.recordChange && st.thread && DS.agent.recordChange(st.thread, P(x), null); await fs.write(P(x), ''); } } return '';
        case 'rm': for (const x of a) { if (!(await fs.exists(P(x))) && !(await isDir(P(x)))) { if (!f.has('f')) throw new Error('rm: ' + x + ': No such file'); continue; } if ((await isDir(P(x))) && !f.has('r')) throw new Error('rm: ' + x + ': is a directory (use -r)'); await fs.remove(P(x)); } return '';
        case 'mv': case 'cp': { if (a.length < 2) throw new Error(cmd + ': missing operand'); let dst = P(a[a.length - 1]); const srcs = a.slice(0, -1); for (const s of srcs) { let d = dst; if (await isDir(dst)) d = dst.replace(/\/$/, '') + '/' + s.split('/').pop(); await fs[cmd === 'mv' ? 'move' : 'copy'](P(s), d); } return ''; }
        case 'grep': {
          let [pat, ...files] = a; if (pat == null) throw new Error('grep: missing pattern');
          const re = new RegExp(pat, f.has('i') ? 'i' : ''); let o = '';
          const scan = (txt, name) => txt.split('\n').forEach((l, i) => { if (re.test(l)) o += (name ? name + ':' : '') + (f.has('n') ? (i + 1) + ':' : '') + l + '\n'; });
          if (!files.length) { scan(stdin, ''); return o; }
          for (const fl of files) {
            const p = P(fl);
            if (await isDir(p)) { if (!f.has('r')) throw new Error('grep: ' + fl + ': is a directory'); const all = await fs.walk(p); for (const w of all) { const wp = typeof w === 'string' ? w : w.path; try { const c = await readF(wp); if (!fs.isBinary(c)) scan(c, wp); } catch (e) {} } }
            else scan(await readF(p), files.length > 1 ? fl : '');
          }
          return o;
        }
        case 'head': case 'tail': {
          let n = 10; const rest = []; for (let i = 0; i < args.length; i++) { if (args[i] === '-n') n = +args[++i]; else if (/^-\d+$/.test(args[i])) n = +args[i].slice(1); else rest.push(args[i]); }
          const txt = rest.length ? await readF(P(rest[0])) : stdin; let ls = txt.replace(/\n$/, '').split('\n');
          ls = cmd === 'head' ? ls.slice(0, n) : ls.slice(-n); return ls.join('\n') + '\n';
        }
        case 'wc': { const txt = a.length ? await readF(P(a[0])) : stdin; const l = (txt.match(/\n/g) || []).length; if (f.has('l')) return l + '\n'; return `${l} ${txt.split(/\s+/).filter(Boolean).length} ${txt.length}${a[0] ? ' ' + a[0] : ''}\n`; }
        case 'tree': { const t = await fs.tree(P(a[0] || '.'), 4); return typeof t === 'string' ? t + '\n' : JSON.stringify(t, null, 1) + '\n'; }
        case 'find': {
          const root = P(a[0] && !a[0].startsWith('-') ? a[0] : '.'); const ni = args.indexOf('-name'); const re = ni >= 0 ? globRe(args[ni + 1]) : null;
          const all = await fs.walk(root); return all.map(w => typeof w === 'string' ? w : w.path).filter(p => !re || re.test(p.split('/').pop())).join('\n') + '\n';
        }
        case 'sort': { let ls = (a.length ? await readF(P(a[0])) : stdin).replace(/\n$/, '').split('\n'); ls.sort(f.has('n') ? (x, y) => parseFloat(x) - parseFloat(y) : undefined); if (f.has('r')) ls.reverse(); return ls.join('\n') + '\n'; }
        case 'uniq': { const ls = (a.length ? await readF(P(a[0])) : stdin).replace(/\n$/, '').split('\n'); const o = []; let prev = null, c = 0; for (const l of ls.concat([null])) { if (l === prev) { c++; continue; } if (prev !== null) o.push(f.has('c') ? String(c).padStart(4) + ' ' + prev : prev); prev = l; c = 1; } return o.join('\n') + '\n'; }
        case 'cut': { let d = '\t', fl = '1'; for (let i = 0; i < args.length; i++) { if (args[i].startsWith('-d')) d = args[i].slice(2) || args[++i]; else if (args[i].startsWith('-f')) fl = args[i].slice(2) || args[++i]; } const idx = fl.split(',').map(x => +x - 1); return stdin.replace(/\n$/, '').split('\n').map(l => { const p = l.split(d); return idx.map(i => p[i] ?? '').join(d); }).join('\n') + '\n'; }
        case 'date': return new Date().toString() + '\n';
        case 'env': return Object.entries(env).map(([k, v]) => k + '=' + v).join('\n') + '\n';
        case 'export': for (const x of args) { const [k, ...v] = x.split('='); env[k] = v.join('='); } return '';
        case 'history': return hist.map((h, i) => String(i + 1).padStart(4) + '  ' + h).join('\n') + '\n';
        case 'clear': st.clear = true; return '';
        case 'help': return 'vsh — virtual shell over the Forge VFS\n  pwd cd ls[-la] cat echo mkdir[-p] touch rm[-r] mv cp grep[-nir] head tail wc[-l] tree find sort uniq cut date env export history clear help\n  js <code> | node -e <code>   run JavaScript (sandboxed worker)\n  pipes |, redirects > >>, &&, quotes, $VAR, globs *.js\n  !<cmd>  run on your real machine (bridge)\n';
        case 'js': case 'node': {
          let code = cmd === 'node' ? (args[0] === '-e' ? args.slice(1).join(' ') : (args[0] ? await readF(P(args[0])) : stdin)) : args.join(' ');
          const r = await runJS(code); let o = r.logs.map(l => l.text).join('\n'); if (o) o += '\n';
          if (r.error) throw new Error(r.error); if (r.result !== undefined && cmd === 'js') o += r.result + '\n'; return o;
        }
        default: throw new Error(cmd + ': command not found (try help)');
      }
    }
    async function exec(line, opts) {
      opts = opts || {}; const st = { cwd: opts.cwd || '/', thread: opts.thread }; const onOut = opts.onOut || (() => {});
      line = String(line || '').trim(); if (!line) return { code: 0, out: '', cwd: st.cwd };
      hist.push(line); if (hist.length > 200) hist.shift();
      if (line.startsWith('!')) {
        if (!(DS.bridge && DS.bridge.online)) { const m = 'bridge offline — connect the desktop bridge to run real shell commands\n'; onOut(m); return { code: 1, out: m, cwd: st.cwd }; }
        let out = ''; try { const r = await DS.bridge.call('shell', { cmd: line.slice(1), cwd: st.cwd }, { onChunk: (c) => { const s = typeof c === 'string' ? c : (c.data || c.text || ''); out += s; onOut(s); } }); if (!out && r) { out = (r.stdout || '') + (r.stderr || ''); onOut(out); } return { code: r && r.code || 0, out, cwd: st.cwd }; }
        catch (e) { const m = String(e.message || e) + '\n'; onOut(m); return { code: 1, out: out + m, cwd: st.cwd }; }
      }
      const toks = tokenize(line); let all = '', code = 0;
      // split by &&
      const chains = [[]]; toks.forEach(t => t.op === '&&' ? chains.push([]) : chains[chains.length - 1].push(t));
      for (const ch of chains) {
        const segs = [[]]; ch.forEach(t => t.op === '|' ? segs.push([]) : segs[segs.length - 1].push(t));
        let stdin = '';
        try {
          for (let i = 0; i < segs.length; i++) {
            let seg = segs[i], redir = null;
            const ri = seg.findIndex(t => t.op === '>' || t.op === '>>');
            if (ri >= 0) { redir = { op: seg[ri].op, path: join(st.cwd, (seg[ri + 1] || {}).v || '') }; seg = seg.slice(0, ri); }
            const words = await expand(seg, st.cwd); if (!words.length) continue;
            let out = await builtin(words[0], words.slice(1), stdin, st);
            if (redir) {
              const before = (await fs.exists(redir.path)) ? await readF(redir.path) : null;
              if (st.thread && DS.agent.recordChange) DS.agent.recordChange(st.thread, redir.path, before);
              await fs.write(redir.path, (redir.op === '>>' && before ? before : '') + out); out = '';
            }
            stdin = out;
          }
          if (stdin) { onOut(stdin); all += stdin; } code = 0;
        } catch (e) { const m = String(e.message || e) + '\n'; onOut(m, 'err'); all += m; code = 1; break; }
      }
      return { code, out: all, cwd: st.cwd, clear: st.clear };
    }
    async function complete(partial, cwd) {
      const full = join(cwd, partial || '.'), endsSlash = !partial || partial.endsWith('/');
      const dir = endsSlash ? full : (full.slice(0, full.lastIndexOf('/')) || '/'), pre = endsSlash ? '' : full.slice(full.lastIndexOf('/') + 1);
      try { const ents = await fs.list(dir); return ents.filter(e => entName(e).startsWith(pre)).map(e => entName(e) + (entDir(e) ? '/' : '')).map(nm => (partial && partial.includes('/') ? partial.slice(0, partial.lastIndexOf('/') + 1) : '') + nm); } catch (e) { return []; }
    }
    ctx.provide('vsh', { exec, complete, history: hist, env });

    // ---------- CSS ----------
    ctx.effect(() => {
      const s = document.createElement('style');
      s.textContent = `
.hl-k{color:var(--violet)}.hl-s{color:var(--ok)}.hl-n{color:var(--warn)}.hl-c{color:var(--muted);font-style:italic}.hl-f{color:var(--accent)}.hl-t{color:var(--accent)}.hl-a{color:var(--warn)}
.vt{display:flex;flex-direction:column;flex:1;min-height:0;background:var(--code-bg)}
.vt-out{flex:1;overflow:auto;padding:10px 12px;font:12.5px/1.45 var(--mono);white-space:pre-wrap;word-break:break-word;color:var(--text)}
.vt-out .p{color:var(--accent)}.vt-out .e{color:var(--danger)}.vt-out .d{color:var(--muted)}
.vt-in{display:flex;align-items:center;gap:6px;padding:6px 10px;border-top:1px solid var(--line);background:var(--surface)}
.vt-in .cw{font:12px var(--mono);color:var(--accent);max-width:40%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.vt-in input{flex:1;min-width:0;height:40px;background:transparent;border:0;outline:0;color:var(--text);font:14px var(--mono)}
.vt-keys{display:flex;gap:6px;overflow-x:auto;padding:6px 10px calc(6px + env(safe-area-inset-bottom));background:var(--surface);border-top:1px solid var(--line);scrollbar-width:none}
.vt-keys button{flex:0 0 auto;min-width:40px;height:36px;padding:0 10px;border-radius:8px;border:1px solid var(--line);background:var(--card);color:var(--text);font:13px var(--mono)}
.vt-keys button:active{background:var(--accent-soft)}
.rj-logs{font:12px/1.45 var(--mono);white-space:pre-wrap;word-break:break-word;margin:0}.rj-logs .warn{color:var(--warn)}.rj-logs .error{color:var(--danger)}.rj-res{color:var(--ok)}.rj-res b{color:var(--muted);font-weight:500}
.fx-tbl{overflow:auto;max-height:360px}.fx-tbl table{border-collapse:collapse;font-size:12.5px;width:100%}.fx-tbl th,.fx-tbl td{border:1px solid var(--line);padding:5px 8px;text-align:left;white-space:nowrap}.fx-tbl th{background:var(--code-head);position:sticky;top:0}.fx-tbl td.num{text-align:right;font-family:var(--mono)}
.jt{font:12.5px/1.5 var(--mono);padding:8px 10px;overflow:auto;max-height:420px}.jt details{padding-left:14px}.jt summary{margin-left:-14px;cursor:pointer;list-style:none}.jt summary::before{content:'▸ ';color:var(--muted)}.jt details[open]>summary::before{content:'▾ '}.jt .ky{color:var(--accent)}.jt .row{display:block}
.fx-note{font-size:11.5px;color:var(--muted);padding:4px 10px}.fx-mer{padding:10px;overflow:auto;background:var(--card)}.fx-math{padding:12px;text-align:center;overflow:auto;font-size:15px}
`;
      document.head.appendChild(s); return () => s.remove();
    });

    // ---------- highlighter ----------
    const KW = {
      js: 'async await break case catch class const continue debugger default delete do else export extends finally for from function if import in instanceof let new of return static super switch this throw try typeof var void while with yield true false null undefined interface type enum implements readonly',
      py: 'and as assert async await break class continue def del elif else except False finally for from global if import in is lambda None nonlocal not or pass raise return True try while with yield print self',
      bash: 'if then else elif fi for in do done while case esac function return export local echo cd ls cat grep sudo npm git',
      sql: 'select from where and or not insert into values update set delete create table drop alter join left right inner outer on group by order having limit as distinct null is in like count sum avg primary key',
      css: '', json: 'true false null', md: ''
    };
    const ALIAS = { javascript: 'js', jsx: 'js', ts: 'js', typescript: 'js', tsx: 'js', mjs: 'js', node: 'js', python: 'py', py: 'py', sh: 'bash', shell: 'bash', zsh: 'bash', console: 'bash', bash: 'bash', sql: 'sql', css: 'css', scss: 'css', json: 'json', html: 'html', xml: 'html', svg: 'html', vue: 'html', md: 'md', markdown: 'md', js: 'js' };
    const kwSets = {}; for (const k in KW) kwSets[k] = new Set(KW[k].split(' ').filter(Boolean));
    const span = (c, t) => `<span class="hl-${c}">${esc(t)}</span>`;
    function hlGeneric(code, L) {
      const ci = L === 'sql', kws = kwSets[L] || new Set();
      const cm = L === 'py' || L === 'bash' ? '#[^\\n]*' : L === 'sql' ? '--[^\\n]*|/\\*[\\s\\S]*?\\*/' : L === 'css' ? '/\\*[\\s\\S]*?\\*/' : L === 'json' ? '(?!)' : '//[^\\n]*|/\\*[\\s\\S]*?\\*/';
      const str = L === 'py' ? `"""[\\s\\S]*?"""|'''[\\s\\S]*?'''|"(?:\\\\.|[^"\\\\\\n])*"|'(?:\\\\.|[^'\\\\\\n])*'` : '`(?:\\\\.|[^`\\\\])*`|"(?:\\\\.|[^"\\\\\\n])*"|\'(?:\\\\.|[^\'\\\\\\n])*\'';
      const re = new RegExp(`(${cm})|(${str})|(\\b\\d[\\d_]*\\.?\\d*(?:e[+-]?\\d+)?\\b|\\b0x[\\da-f]+\\b)|(${L === 'css' ? '[#.]?[a-zA-Z_-][\\w-]*' : L === 'bash' ? '\\$\\w+|[A-Za-z_][\\w-]*' : '[A-Za-z_$][\\w$]*'})`, 'gi');
      let o = '', last = 0, m;
      while ((m = re.exec(code))) {
        o += esc(code.slice(last, m.index)); last = re.lastIndex;
        if (m[1]) o += span('c', m[1]);
        else if (m[2]) o += span(L === 'json' && /^\s*:/.test(code.slice(last)) ? 'f' : 's', m[2]);
        else if (m[3]) o += span('n', m[3]);
        else { const w = m[4]; if (kws.has(ci ? w.toLowerCase() : w)) o += span('k', w); else if (L === 'css' && /^[#.]/.test(w)) o += span('f', w); else if (/^\s*\(/.test(code.slice(last)) || (L === 'bash' && w[0] === '$')) o += span('f', w); else o += esc(w); }
        if (m[0] === '') re.lastIndex++;
      }
      return o + esc(code.slice(last));
    }
    function hlHtml(code) {
      return code.replace(/(<!--[\s\S]*?-->)|(<\/?)([\w:-]+)([^>]*)(\/?>)|([^<]+)/g, (all, c, open, tag, attrs, close, text) => {
        if (c) return span('c', c);
        if (text !== undefined) return esc(text);
        const a = (attrs || '').replace(/([\w:-]+)(=)("[^"]*"|'[^']*'|[^\s>]+)?|([^]+?)/g, (x, n, eq, v, rest) => n ? span('a', n) + esc(eq) + (v ? span('s', v) : '') : esc(rest || ''));
        return esc(open) + span('t', tag) + a + esc(close);
      }).replace(/(<[^s<][^<]*)$/, x => x);
    }
    function hlMd(code) { return esc(code).replace(/^(#{1,6} .*)$/gm, '<span class="hl-k">$1</span>').replace(/(\*\*[^*\n]+\*\*)/g, '<span class="hl-f">$1</span>').replace(/(`[^`\n]+`)/g, '<span class="hl-s">$1</span>').replace(/^(\s*[-*+] )/gm, '<span class="hl-n">$1</span>'); }
    function highlight(code, lang) {
      const L = ALIAS[String(lang || '').toLowerCase()]; if (!L || code.length > 200000) return null;
      try { return L === 'html' ? hlHtml(code) : L === 'md' ? hlMd(code) : hlGeneric(code, L); } catch (e) { return null; }
    }
    const prevHl = DS.render.highlight; DS.render.highlight = highlight;
    ctx.effect(() => () => { if (DS.render.highlight === highlight) DS.render.highlight = prevHl; });
    ctx.provide('highlight', { highlight });

    // ---------- lazy loader ----------
    const loads = {};
    function loadScript(url, glob) {
      if (window[glob]) return Promise.resolve(window[glob]);
      return loads[url] || (loads[url] = new Promise((res, rej) => { const s = document.createElement('script'); s.src = url; s.onload = () => window[glob] ? res(window[glob]) : rej(new Error('loaded but missing ' + glob)); s.onerror = () => { delete loads[url]; rej(new Error('Could not load ' + url + ' (offline?)')); }; document.head.appendChild(s); }));
    }
    function loadCss(url) { if (document.querySelector(`link[href="${url}"]`)) return; const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = url; document.head.appendChild(l); }

    // ---------- fences ----------
    function parseCSV(t) {
      const rows = []; let row = [], cur = '', q = false; const d = (t.split('\n')[0].match(/\t/g) || []).length > (t.split('\n')[0].match(/,/g) || []).length ? '\t' : ',';
      for (let i = 0; i < t.length; i++) { const c = t[i]; if (q) { if (c === '"' && t[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c; } else if (c === '"') q = true; else if (c === d) { row.push(cur); cur = ''; } else if (c === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; } else if (c !== '\r') cur += c; }
      if (cur || row.length) { row.push(cur); rows.push(row); } return rows.filter(r => r.some(x => x !== ''));
    }
    ctx.fence({ langs: ['csv', 'tsv'], render(el, code, o) {
      if (!o.closed) { el.innerHTML = `<pre class="fx-note">${esc(code.split('\n').length + ' rows streaming…')}</pre>`; return; }
      const rows = parseCSV(code); if (!rows.length) { el.textContent = '(empty csv)'; return; }
      const num = (v) => /^-?[\d,.]+%?$/.test(v.trim());
      el.innerHTML = `<div class="fx-tbl"><table><thead><tr>${rows[0].map(h => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.slice(1, 501).map(r => `<tr>${rows[0].map((_, i) => `<td class="${num(r[i] || '') ? 'num' : ''}">${esc(r[i] || '')}</td>`).join('')}</tr>`).join('')}</tbody></table></div><div class="fx-note">${rows.length - 1} rows × ${rows[0].length} cols</div>`;
    } });
    function jtree(v, k, depth) {
      const key = k != null ? `<span class="ky">${esc(JSON.stringify(k))}</span>: ` : '';
      if (v && typeof v === 'object') {
        const arr = Array.isArray(v), ents = arr ? v.map((x, i) => [i, x]) : Object.entries(v);
        const sum = arr ? `[${ents.length}]` : `{${ents.length}}`;
        return `<details ${depth < 2 ? 'open' : ''}><summary>${key}<span class="hl-c">${sum}</span></summary>${ents.slice(0, 500).map(([kk, x]) => jtree(x, arr ? null : kk, depth + 1)).join('')}</details>`;
      }
      return `<span class="row">${key}${highlight(JSON.stringify(v), 'json')}</span>`;
    }
    ctx.fence({ langs: ['json'], render(el, code, o) {
      if (!o.closed) { el.innerHTML = `<pre class="jt">${highlight(code, 'json')}</pre>`; return; }
      try { const v = JSON.parse(code); el.innerHTML = `<div class="jt">${jtree(v, null, 0)}</div>`; }
      catch (e) { el.innerHTML = `<pre class="jt">${highlight(code, 'json')}</pre><div class="fx-note">invalid JSON: ${esc(e.message)}</div>`; }
    } });
    let merN = 0;
    ctx.fence({ langs: ['mermaid'], render(el, code, o) {
      if (!o.closed) { el.innerHTML = `<pre class="jt">${esc(code)}</pre>`; return; }
      if (el._src === code) return; el._src = code;
      el.innerHTML = `<div class="fx-mer">rendering diagram…</div>`;
      loadScript('https://cdn.jsdelivr.net/npm/mermaid@10.9.1/dist/mermaid.min.js', 'mermaid').then(async (m) => {
        const dark = getComputedStyle(document.body).colorScheme === 'dark' || matchMedia('(prefers-color-scheme: dark)').matches;
        m.initialize({ startOnLoad: false, theme: dark ? 'dark' : 'default', securityLevel: 'strict' });
        const { svg } = await m.render('mer' + (++merN) + Date.now(), code); el.innerHTML = `<div class="fx-mer">${svg}</div>`;
      }).catch(e => { el.innerHTML = `<pre class="jt">${esc(code)}</pre><div class="fx-note">Mermaid unavailable: ${esc(e.message || String(e))}</div>`; });
    } });
    const prettyMath = (s) => s.replace(/\\frac\{([^}]*)\}\{([^}]*)\}/g, '($1)/($2)').replace(/\\sqrt\{([^}]*)\}/g, '√($1)').replace(/\\(alpha|beta|gamma|delta|pi|theta|lambda|mu|sigma|omega|infty|sum|int|cdot|times|leq|geq|neq|pm|to)/g, (x, n) => ({ alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', pi: 'π', theta: 'θ', lambda: 'λ', mu: 'μ', sigma: 'σ', omega: 'ω', infty: '∞', sum: '∑', int: '∫', cdot: '·', times: '×', leq: '≤', geq: '≥', neq: '≠', pm: '±', to: '→' })[n]).replace(/\^\{([^}]*)\}|\^(\w)/g, (x, a, b) => '^' + (a || b)).replace(/[{}]/g, '');
    ctx.fence({ langs: ['math', 'latex', 'tex', 'katex'], render(el, code, o) {
      if (!o.closed) { el.innerHTML = `<div class="fx-math">${esc(prettyMath(code))}</div>`; return; }
      if (el._src === code) return; el._src = code;
      el.innerHTML = `<div class="fx-math">${esc(prettyMath(code))}</div>`;
      loadCss('https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.css');
      loadScript('https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.js', 'katex').then(k => { el.innerHTML = `<div class="fx-math">${k.renderToString(code, { displayMode: true, throwOnError: false })}</div>`; }).catch(() => { el.insertAdjacentHTML('beforeend', '<div class="fx-note">KaTeX offline — plain rendering</div>'); });
    } });

    // ---------- tools ----------
    const renderRun = (part, body) => {
      const r = part.result || {}, a = part.args || {};
      body.innerHTML = `<pre class="rj-logs" style="opacity:.75">${highlight(a.code || '', 'js') || esc(a.code || '')}</pre><hr style="border:0;border-top:1px solid var(--line);margin:8px 0">
<pre class="rj-logs">${(r.logs || []).map(l => `<span class="${esc(l.level)}">${esc(l.text)}</span>`).join('\n')}</pre>
${r.result !== undefined ? `<div class="rj-logs rj-res"><b>⇒</b> ${esc(r.result)}</div>` : ''}${r.error ? `<div class="rj-logs" style="color:var(--danger)">✕ ${esc(r.error)}</div>` : ''}<div class="fx-note">${r.ms ?? '?'} ms</div>`;
    };
    ctx.tool({ name: 'run_js', label: 'Run JavaScript', gate: 'exec',
      description: 'Run JavaScript in an isolated sandboxed worker (no DOM, no network creds). Captures console output and the value of the final expression / return. Use for calculations, data transforms, quick experiments.',
      parameters: { type: 'object', properties: { code: { type: 'string', description: 'JS code; an expression or statements with return' }, timeout: { type: 'number', description: 'ms, default 8000' } }, required: ['code'] },
      detail: (a) => ({ cmd: a.code }),
      run: (a) => runJS(a.code, a.timeout),
      summarize: (a, r) => r && r.error ? '✕ ' + String(r.error).slice(0, 60) : r && r.result !== undefined ? '⇒ ' + String(r.result).slice(0, 60) : (r && r.logs ? r.logs.length + ' log lines' : ''),
      render: renderRun });
    let pyP = null;
    ctx.tool({ name: 'run_py', label: 'Run Python', gate: 'exec',
      description: 'Run Python 3 via Pyodide (WebAssembly, loads on first use ~10MB). Captures stdout and the last expression value.',
      parameters: { type: 'object', properties: { code: { type: 'string' } }, required: ['code'] },
      detail: (a) => ({ cmd: a.code }),
      async run(a) {
        const t0 = performance.now();
        try {
          pyP = pyP || loadScript('https://cdn.jsdelivr.net/pyodide/v0.26.4/full/pyodide.js', 'loadPyodide').then(l => l({ indexURL: 'https://cdn.jsdelivr.net/pyodide/v0.26.4/full/' }));
          const py = await pyP; let out = '';
          py.setStdout({ batched: (s) => { out += s + '\n'; } }); py.setStderr({ batched: (s) => { out += s + '\n'; } });
          const r = await py.runPythonAsync(a.code);
          return { stdout: out, result: r === undefined || r === null ? undefined : String(r), ms: Math.round(performance.now() - t0) };
        } catch (e) { pyP = /load/i.test(String(e)) ? null : pyP; return { error: /Could not load/.test(String(e.message)) ? 'Python runtime unavailable offline — Pyodide could not be downloaded. Connect to the internet and retry (or use run_js).' : String(e.message || e).slice(-1500), ms: Math.round(performance.now() - t0) }; }
      },
      summarize: (a, r) => r && r.error ? '✕ ' + String(r.error).slice(0, 60) : r ? (r.result ?? (r.stdout || '').trim().split('\n').pop() ?? '').toString().slice(0, 60) : '',
      render(part, body) { const r = part.result || {}; body.innerHTML = `<pre class="rj-logs" style="opacity:.75">${highlight(part.args.code || '', 'py')}</pre><pre class="rj-logs">${esc(r.stdout || '')}</pre>${r.result !== undefined ? `<div class="rj-logs rj-res"><b>⇒</b> ${esc(r.result)}</div>` : ''}${r.error ? `<div class="rj-logs" style="color:var(--danger)">${esc(r.error)}</div>` : ''}`; } });
    ctx.tool({ name: 'web_fetch', label: 'Fetch URL', gate: 'net',
      description: 'Fetch a web page or API and return readable text (HTML stripped, links as markdown), max 12000 chars.',
      parameters: { type: 'object', properties: { url: { type: 'string' }, max: { type: 'number', description: 'max links to keep (default 40)' } }, required: ['url'] },
      detail: (a) => ({ cmd: 'GET ' + a.url }),
      async run(a) { try { return await webFetch(a.url, a.max); } catch (e) { return { url: a.url, error: e.message }; } },
      summarize: (a, r) => r && r.error ? '✕ ' + r.error.slice(0, 60) : r ? `${r.status} · ${r.title || a.url} · ${(r.text || '').length} chars` : '' });
    ctx.tool({ name: 'web_search', label: 'Web search', gate: 'net',
      description: 'Search the web (DuckDuckGo). Returns [{title,url,snippet}]. Follow up with web_fetch to read a page.',
      parameters: { type: 'object', properties: { query: { type: 'string' }, n: { type: 'number' } }, required: ['query'] },
      detail: (a) => ({ cmd: 'search: ' + a.query }),
      async run(a) { try { return await webSearch(a.query, a.n); } catch (e) { return { error: 'Web search failed: ' + e.message }; } },
      summarize: (a, r) => Array.isArray(r) ? r.length + ' results' : (r && r.error ? '✕ offline' : '') ,
      render(part, body) { const r = part.result; body.innerHTML = Array.isArray(r) ? r.map(x => `<div style="margin:0 0 10px"><a href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.title)}</a><div class="xs muted">${esc(x.url)}</div><div class="sm">${esc(x.snippet)}</div></div>`).join('') || '<div class="muted">No results</div>' : `<div style="color:var(--danger)">${esc((r && r.error) || '')}</div>`; } });

    // ---------- terminal view ----------
    DS.icons.terminal = DS.icons.terminal || '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 17l6-5-6-5M12 19h8"/></svg>';
    const term = { cwd: ctx.data.get('cwd', '/'), lines: [] };
    ctx.view({ id: 'terminal', title: 'Terminal', icon: 'terminal', order: 40,
      mount(el) {
        el.innerHTML = `<div class="vhead"><h2>Terminal</h2><div class="grow"></div><button class="icon-btn" data-a="copy" title="Copy output" aria-label="Copy output">${DS.icon('copy')}</button><button class="icon-btn" data-a="clear" title="Clear" aria-label="Clear">${DS.icon('trash')}</button></div>
<div class="vt"><div class="vt-out" aria-live="polite"></div><div class="vt-in"><span class="cw"></span><span class="mono" style="color:var(--muted)">$</span><input autocapitalize="off" autocomplete="off" autocorrect="off" spellcheck="false" enterkeyhint="send" placeholder="help · ls · !cmd (bridge)" aria-label="Command"><button class="btn sm pri" data-a="run">Run</button></div>
<div class="vt-keys">${['Tab', '↑', '↓', '^C', '|', '>', '/', '~', '-', '*', '&&'].map(k => `<button data-k="${esc(k)}">${esc(k)}</button>`).join('')}</div></div>`;
        const out = el.querySelector('.vt-out'), inp = el.querySelector('input'), cw = el.querySelector('.cw');
        let hi = -1, busy = false, stopped = false;
        const add = (t, c) => { const s = document.createElement('span'); if (c) s.className = c; s.textContent = t; out.appendChild(s); term.lines.push([t, c]); if (term.lines.length > 2000) term.lines.shift(); out.scrollTop = out.scrollHeight; };
        const paint = () => { cw.textContent = term.cwd; };
        if (!term.lines.length) add('vsh — virtual shell over the Forge filesystem. Type help.\n', 'd'); else term.lines.forEach(([t, c]) => { const s = document.createElement('span'); if (c) s.className = c; s.textContent = t; out.appendChild(s); });
        paint();
        async function run() {
          const line = inp.value; if (busy) return; inp.value = ''; hi = -1;
          add(term.cwd + ' $ ', 'p'); add(line + '\n');
          if (!line.trim()) return;
          busy = true; stopped = false;
          const r = await exec(line, { cwd: term.cwd, thread: DS.store.activeThread && DS.store.activeThread(), onOut: (t, k) => { if (!stopped) add(t, k === 'err' ? 'e' : ''); } });
          busy = false;
          if (r.clear) { out.innerHTML = ''; term.lines = []; }
          term.cwd = r.cwd; ctx.data.set('cwd', r.cwd); paint();
        }
        async function tab() {
          const v = inp.value, m = v.match(/(\S*)$/), part = m ? m[1] : '';
          const c = await complete(part, term.cwd); if (!c.length) return;
          if (c.length === 1) { inp.value = v.slice(0, v.length - part.length) + c[0]; return; }
          let pre = c[0]; c.forEach(x => { while (!x.startsWith(pre)) pre = pre.slice(0, -1); });
          if (pre.length > part.length) inp.value = v.slice(0, v.length - part.length) + pre; else add(c.join('  ') + '\n', 'd');
        }
        const histMove = (d) => { if (!hist.length) return; hi = hi < 0 ? (d < 0 ? hist.length - 1 : -1) : hi + d; if (hi >= hist.length) { hi = -1; inp.value = ''; return; } hi = Math.max(0, hi); inp.value = hist[hi] || ''; };
        inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); run(); } else if (e.key === 'Tab') { e.preventDefault(); tab(); } else if (e.key === 'ArrowUp') { e.preventDefault(); histMove(-1); } else if (e.key === 'ArrowDown') { e.preventDefault(); histMove(1); } else if (e.key === 'c' && e.ctrlKey) { stopped = true; busy = false; add('^C\n', 'd'); inp.value = ''; } });
        el.addEventListener('click', (e) => {
          const b = e.target.closest('button'); if (!b) return;
          const k = b.dataset.k, a = b.dataset.a;
          if (a === 'run') run();
          else if (a === 'copy') { U.copy(out.textContent); ctx.toast('Output copied', 'ok'); }
          else if (a === 'clear') { out.innerHTML = ''; term.lines = []; }
          else if (k === 'Tab') tab(); else if (k === '↑') histMove(-1); else if (k === '↓') histMove(1);
          else if (k === '^C') { stopped = true; busy = false; add('^C\n', 'd'); inp.value = ''; }
          else if (k) { const s = inp.selectionStart ?? inp.value.length; const ins = k === '|' || k === '>' || k === '&&' ? ' ' + k + ' ' : k; inp.value = inp.value.slice(0, s) + ins + inp.value.slice(inp.selectionEnd ?? s); inp.setSelectionRange(s + ins.length, s + ins.length); }
          if (k || a === 'run') inp.focus({ preventScroll: true });
        });
        el._vt = { run: (l) => { inp.value = l; return run(); } };
      },
      onShow(el) { const i = el.querySelector('.vt-in input'); if (i && matchMedia('(pointer:fine)').matches) i.focus(); } });

    // ---------- commands ----------
    ctx.command({ name: 'term', desc: 'Open the terminal', run: () => DS.shell.show('terminal') });
    ctx.command({ name: 'run', args: '<js>', desc: 'Run JavaScript and reply with the result', async run(code, c) {
      if (!code.trim()) return c.reply('Usage: `/run 1+2` or `/run console.log("hi")`');
      const r = await runJS(code);
      c.reply('```js\n' + code + '\n```\n' + (r.logs.length ? '```\n' + r.logs.map(l => l.text).join('\n') + '\n```\n' : '') + (r.error ? `**Error:** \`${r.error}\`` : r.result !== undefined ? `⇒ \`${r.result}\`` : '') + ` · ${r.ms} ms`);
    } });
    ctx.command({ name: 'search', args: '<query>', desc: 'Search the web', async run(q, c) {
      if (!q.trim()) return c.reply('Usage: `/search <query>`');
      try { const r = await webSearch(q, 8); c.reply(r.length ? `**Results for “${q}”**\n\n` + r.map((x, i) => `${i + 1}. [${x.title}](${x.url})  \n   ${x.snippet}`).join('\n') : 'No results.'); }
      catch (e) { c.reply('⚠️ ' + e.message); }
    } });
    function threadMd(t) { return (t.messages || []).map(m => `### ${m.role === 'user' ? 'You' : 'Assistant'}\n\n` + (typeof m.content === 'string' ? m.content : (m.parts || []).map(p => p.text || (p.type === 'tool' || p.name ? `> tool \`${p.name}\` ${p.args ? JSON.stringify(p.args).slice(0, 200) : ''}` : '')).filter(Boolean).join('\n\n') || m.text || '')).join('\n\n---\n\n'); }
    ctx.command({ name: 'export', args: '[md|json|html]', desc: 'Download this thread', run(arg, c) {
      const t = c.thread || DS.store.activeThread(); if (!t) return c.reply('No thread.');
      const f = (arg.trim() || 'md').toLowerCase(), base = (t.title || 'thread').replace(/[^\w-]+/g, '-').slice(0, 40) || 'thread';
      if (f === 'json') U.download(base + '.json', JSON.stringify(t, null, 2), 'application/json');
      else if (f === 'html') {
        const cs = getComputedStyle(document.documentElement), v = (n) => cs.getPropertyValue(n).trim();
        const body = DS.render.markdown(threadMd(t));
        U.download(base + '.html', `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(t.title || 'Thread')}</title><style>body{max-width:760px;margin:0 auto;padding:24px 16px;background:${v('--bg') || '#fff'};color:${v('--text') || '#111'};font:15px/1.6 system-ui,sans-serif}pre{background:${v('--code-bg') || '#f4f4f4'};padding:12px;border-radius:8px;overflow:auto}code{font-family:ui-monospace,monospace}a{color:${v('--accent') || '#06c'}}h3{margin-top:28px;color:${v('--muted') || '#666'};font-size:13px;text-transform:uppercase;letter-spacing:.06em}hr{border:0;border-top:1px solid ${v('--line') || '#ddd'}}</style></head><body><h1>${esc(t.title || 'Thread')}</h1>${body}</body></html>`, 'text/html');
      } else U.download(base + '.md', `# ${t.title || 'Thread'}\n\n` + threadMd(t), 'text/markdown');
      ctx.toast('Exported ' + f.toUpperCase(), 'ok');
    } });

    // ---------- voice ----------
    let rec = null;
    function dictate(c) {
      const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (!SR) return ctx.toast('Dictation is not supported in this browser', 'warn');
      if (rec) { rec.stop(); rec = null; return; }
      rec = new SR(); rec.interimResults = false; rec.continuous = false; rec.lang = navigator.language || 'en-US';
      rec.onresult = (e) => { const t = [...e.results].map(r => r[0].transcript).join(' '); c.insert(t + ' '); };
      rec.onerror = (e) => ctx.toast('Dictation: ' + e.error, 'warn'); rec.onend = () => { rec = null; };
      rec.start(); ctx.toast('Listening…', 'ok', 1500);
    }
    ctx.composerAction({ id: 'dictate', icon: 'mic', label: 'Dictate', desc: 'Speech to text', run: dictate });
    ctx.command({ name: 'voice', desc: 'Start dictation', run: (a, c) => dictate(c) });
    ctx.messageAction({ id: 'speak', icon: 'speaker', label: 'Speak', when: (m) => m.role !== 'user',
      run(m) {
        if (!window.speechSynthesis) return ctx.toast('Speech synthesis unsupported', 'warn');
        if (speechSynthesis.speaking) { speechSynthesis.cancel(); return; }
        const txt = (typeof m.content === 'string' ? m.content : (m.parts || []).map(p => p.text || '').join(' ')) || m.text || '';
        speechSynthesis.speak(new SpeechSynthesisUtterance(txt.replace(/```[\s\S]*?```/g, ' code block ').replace(/[#*_`>]/g, '').slice(0, 4000)));
      } });

    // ---------- sim intents + suggestions ----------
    const fmtRun = (r) => !r ? 'No result.' : r.error ? `That failed: \`${r.error}\`` : (r.logs && r.logs.length ? '```\n' + r.logs.map(l => l.text).join('\n') + '\n```\n' : '') + (r.result !== undefined ? `Result: **${r.result}**` : 'Done.') + ` _(ran in ${r.ms} ms in a sandboxed worker)_`;
    const jsRe = /^(?:please\s+)?(?:run|execute|evaluate|eval)\s+(?:this\s+)?(?:js|javascript|node)\s*:?\s*([\s\S]+)$/i;
    ctx.intent({ id: 'devtools.runjs', order: 50, match: (t) => jsRe.test(t.trim()),
      script: (t) => { const code = t.trim().match(jsRe)[1].replace(/^```\w*\n?|```$/g, '').trim(); return [{ say: 'Running that in the sandbox.', tool: { name: 'run_js', args: { code } } }, { final: (rs) => fmtRun(rs[0]) }]; } });
    const calcRe = /^(?:calculate|compute|what(?:'s| is)|eval(?:uate)?)\s+([\d\s+\-*/%^().,eE]|sqrt|sin|cos|tan|log|pi|abs|pow|round|floor|ceil|min|max)+\??$/i;
    const toJs = (e) => e.replace(/\?$/, '').replace(/\^/g, '**').replace(/\b(sqrt|sin|cos|tan|log|abs|pow|round|floor|ceil|min|max)\b/gi, (m) => 'Math.' + m.toLowerCase()).replace(/\bpi\b/gi, 'Math.PI');
    ctx.intent({ id: 'devtools.calc', order: 50, match: (t) => calcRe.test(t.trim()) && /\d/.test(t),
      script: (t) => { const expr = t.trim().replace(/^(?:calculate|compute|what(?:'s| is)|evaluate|eval)\s+/i, '').replace(/\?$/, ''); return [{ tool: { name: 'run_js', args: { code: toJs(expr) } } }, { final: (rs) => rs[0] && !rs[0].error ? `**${expr.trim()} = ${rs[0].result}**` : fmtRun(rs[0]) }]; } });
    ctx.intent({ id: 'devtools.fetch', order: 50, match: (t) => /^(?:fetch|read|open|get)\s+(?:the\s+)?(?:page\s+|url\s+)?(https?:\/\/\S+|[\w-]+\.[\w.-]+\/?\S*)$/i.test(t.trim()),
      script: (t) => { const url = t.trim().split(/\s+/).pop(); return [{ say: 'Fetching ' + url, tool: { name: 'web_fetch', args: { url } } }, { final: (rs) => { const r = rs[0] || {}; return r.error ? `Couldn't fetch it: ${r.error}` : `**${r.title || r.url}** (HTTP ${r.status})\n\n${(r.text || '').slice(0, 1200)}${(r.text || '').length > 1200 ? '\n\n…' : ''}`; } }]; } });
    const sRe = /^(?:search|look up|google)\s+(?:the\s+web\s+|online\s+|the\s+internet\s+)?(?:for\s+)?(.+)$/i;
    ctx.intent({ id: 'devtools.search', order: 50, match: (t) => sRe.test(t.trim()),
      script: (t) => { const query = t.trim().match(sRe)[1]; return [{ tool: { name: 'web_search', args: { query, n: 6 } } }, { final: (rs) => { const r = rs[0]; return Array.isArray(r) ? (r.length ? r.map((x, i) => `${i + 1}. [${x.title}](${x.url}) — ${x.snippet}`).join('\n') : 'No results.') : '⚠️ ' + ((r && r.error) || 'search failed') + '\n\nTip: connect the desktop bridge so searches go through your machine.'; } }]; } });
    ctx.suggest({ id: 'devtools.calc', emoji: '🧮', title: 'Calculate', sub: 'Sandboxed JS math', prompt: 'calculate 12*(7+3)' });
    ctx.suggest({ id: 'devtools.js', emoji: '⚡', title: 'Run JavaScript', sub: 'Logs + result', prompt: 'run js: const xs=[3,1,4,1,5,9]; console.log("sorted", xs.sort()); xs.reduce((a,b)=>a+b)' });
    ctx.suggest({ id: 'devtools.term', emoji: '🖥️', title: 'Open terminal', sub: 'Virtual shell over files', run: () => DS.shell.show('terminal') });
  }
});
