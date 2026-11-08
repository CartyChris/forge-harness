/* forge.picks (A14) — research picks integrated lazily: Research view, DOMPurify sanitize, mermaid/math/chart/csv fences,
   repo_map + delegate tools, /plan /build toggles, optional semantic memory. Nothing bundled; every load is optional. */
const PICKS = [
  { id: 'dompurify', name: 'DOMPurify', npm: 'dompurify', ver: '3.4.16', path: 'dist/purify.min.js', global: 'DOMPurify', stars: '17.3k', license: 'MPL-2.0 OR Apache-2.0', kb: 1578, mode: 'umd', why: 'Sanitizer for model-produced HTML (markdown output, fences).', status: 'wired: sanitizes assistant markdown once loaded', verified: { stars: true, license: true, version: true } },
  { id: 'mermaid', name: 'Mermaid', npm: 'mermaid', ver: '12.1.0', path: 'dist/mermaid.min.js', global: 'mermaid', stars: '90.5k', license: 'MIT', kb: 119455, mode: 'umd', why: 'Diagrams in ```mermaid fences (securityLevel strict).', status: 'wired: lazy on first ```mermaid fence', risk: 'UMD path unverified in v12 (module = mermaid.core.mjs)', verified: { stars: true, license: true, version: true } },
  { id: 'katex', name: 'KaTeX', npm: 'katex', ver: '0.19.0', path: 'dist/katex.min.js', css: 'dist/katex.min.css', global: 'katex', stars: 'unverified', license: 'MIT', kb: 3950, mode: 'umd', why: 'Maths in ```math / ```latex fences and $$ blocks.', status: 'wired: lazy on first math fence', verified: { stars: false, license: true, version: true } },
  { id: 'chartjs', name: 'Chart.js', npm: 'chart.js', ver: '4.5.1', path: 'dist/chart.umd.min.js', global: 'Chart', stars: 'unverified', license: 'MIT', kb: 6082, mode: 'umd', why: '```chart fences from a JSON spec.', status: 'wired: lazy on first ```chart fence', verified: { stars: false, license: true, version: true } },
  { id: 'transformers', name: 'Transformers.js', npm: '@huggingface/transformers', ver: '4.3.1', path: 'dist/transformers.min.js', esm: true, stars: '16.4k', license: 'Apache-2.0', kb: 9729, mode: 'esm', why: 'In-browser embeddings for semantic memory (Xenova/all-MiniLM-L6-v2).', status: 'opt-in: "Enable semantic memory" below', risk: 'medium: large WASM, onnxruntime-web pulled at runtime', verified: { stars: true, license: true, version: true } },
  { id: 'marked', name: 'marked', npm: 'marked', ver: '18.1.0', path: 'lib/marked.umd.js', global: 'marked', stars: '37.2k', license: 'MIT', kb: 506, mode: 'umd', why: 'Alternative markdown renderer (core keeps its own).', status: 'catalog only (load on demand)', verified: { stars: true, license: true, version: true } },
  { id: 'orama', name: 'Orama', npm: '@orama/orama', ver: '3.1.18', path: '+esm', esm: true, stars: '10.6k', license: 'Apache-2.0', kb: 2141, mode: 'esm', why: 'Hybrid BM25+vector search over memory and VFS.', status: 'catalog only', verified: { stars: true, license: true, version: true } },
  { id: 'webllm', name: 'WebLLM', npm: '@mlc-ai/web-llm', ver: '0.2.85', path: '+esm', esm: true, stars: '19.3k', license: 'Apache-2.0', kb: 14077, mode: 'esm', why: 'OpenAI-shaped local LLM on WebGPU (Safari 26+).', status: 'catalog only (needs navigator.gpu)', verified: { stars: true, license: true, version: true } },
  { id: 'highlightjs', name: 'highlight.js', npm: 'highlight.js', ver: '11.12.0', path: 'unverified', stars: 'unverified', license: 'BSD-3-Clause', kb: 0, mode: 'umd', why: 'Mobile-friendly syntax highlighting.', status: 'catalog only; CDN path unverified', verified: { stars: false, license: true, version: true } },
  { id: 'xterm', name: 'xterm.js', npm: '@xterm/xterm', ver: '6.0.0', path: 'lib/xterm.mjs', esm: true, stars: '21.2k', license: 'MIT', kb: 5783, mode: 'esm', why: 'Standard web terminal.', status: 'catalog only', verified: { stars: true, license: true, version: true } }
];
const CDNS = ['https://cdn.jsdelivr.net/npm/', 'https://unpkg.com/'];
const A14_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z"/><path d="M4 21V5"/><path d="M9 7h6"/></svg>';

DS.plugin({
  name: 'forge.picks', title: 'Research picks', version: '1.0.0', tags: ['research', 'render', 'tools'],
  description: 'Research view of vetted libraries; lazy DOMPurify sanitizing; mermaid/math/chart/csv fences; repo_map + delegate tools; /plan /build.',
  apply(ctx) {
    const U = DS.util, esc = U.esc;
    if (!DS.icons.book) DS.icons.book = A14_ICON;
    const byId = id => PICKS.find(p => p.id === id);
    const urlsOf = p => CDNS.map(c => c + p.npm + '@' + p.ver + '/' + p.path);
    const online = () => navigator.onLine !== false;
    const libs = {};   // id -> {state:'idle|loading|ok|err', val, err, url, p}
    const st = id => libs[id] || (libs[id] = { state: 'idle' });
    const refreshView = () => DS.bus.emit('picks:change');
    let alive = true;

    function loadScript(url) {
      return new Promise((res, rej) => {
        const s = document.createElement('script'); s.src = url; s.async = true; s.crossOrigin = 'anonymous';
        const to = setTimeout(() => { s.remove(); rej(new Error('timeout')); }, 20000);
        s.onload = () => { clearTimeout(to); res(); }; s.onerror = () => { clearTimeout(to); s.remove(); rej(new Error('load failed: ' + url)); };
        document.head.appendChild(s);
      });
    }
    function loadCss(url) { if (document.querySelector('link[data-a14="' + url + '"]')) return; const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = url; l.dataset.a14 = url; l.crossOrigin = 'anonymous'; document.head.appendChild(l); }
    /* load(id) → Promise<lib>; never throws synchronously; tries jsDelivr then unpkg */
    function load(id) {
      const p = byId(id), s = st(id); s.p = p;
      if (s.state === 'ok') return Promise.resolve(s.val);
      if (s.promise) return s.promise;
      if (!online()) { s.state = 'err'; s.err = 'offline'; refreshView(); return Promise.reject(new Error('offline')); }
      if (!p || p.path === 'unverified') return Promise.reject(new Error('no verified CDN path'));
      s.state = 'loading'; refreshView();
      s.promise = (async () => {
        let last;
        for (const url of urlsOf(p)) {
          try {
            let val;
            if (p.esm) val = await import(url);
            else { if (!window[p.global]) await loadScript(url); val = window[p.global]; if (!val) throw new Error(p.global + ' missing after load'); }
            if (p.css) loadCss(url.replace(p.path, p.css));
            s.state = 'ok'; s.val = val; s.url = url; s.err = ''; refreshView(); if (id !== 'dompurify' && st('dompurify').state === 'idle') load('dompurify').catch(() => { }); if (id === 'dompurify') ctx.data.set('purify', true); return val;
          } catch (e) { last = e; }
        }
        s.state = 'err'; s.err = (last && last.message) || 'failed'; s.promise = null; refreshView(); throw last || new Error('failed');
      })();
      return s.promise;
    }

    /* ---------- sanitize ---------- */
    const sanitize = html => { const P = st('dompurify').val; if (P && P.sanitize) return P.sanitize(String(html), { ADD_ATTR: ['target'] }); const d = document.createElement('div'); d.textContent = String(html); return d.innerHTML; };
    DS.sanitize = sanitize;
    const origInto = DS.render.into;
    const sanitizeMd = container => { const P = st('dompurify').val; if (!P || !container || !container.children) return; for (const n of container.children) { if (n.className === 'md' && n._src != null && n._san !== n._src) { n.innerHTML = P.sanitize(n.innerHTML, { ADD_ATTR: ['target'] }); n._san = n._src; } } };
    const wrappedInto = function (container, text, c) { const r = origInto.apply(this, arguments); try { sanitizeMd(container); } catch (e) { } return r; };
    DS.render.into = wrappedInto;
    ctx.effect(() => () => { if (DS.render.into === wrappedInto) DS.render.into = origInto; if (DS.sanitize === sanitize) delete DS.sanitize; alive = false; });
    const autoPurify = () => { if (online() && ctx.data.get('purify', false)) load('dompurify').catch(() => { }); };
    ctx.setTimeout(autoPurify, 1500);
    ctx.effect(() => { const f = () => autoPurify(); window.addEventListener('online', f); return () => window.removeEventListener('online', f); });

    /* ---------- CSS ---------- */
    ctx.effect(() => {
      const s = document.createElement('style');
      s.textContent = `
.a14f{border:1px solid var(--line);border-radius:var(--radius);background:var(--card);margin:8px 0;overflow:hidden;max-width:100%}
.a14f .a14h{display:flex;align-items:center;gap:8px;padding:6px 10px;background:var(--code-head);font-size:12px;color:var(--text-2)}
.a14f .a14h b{font-family:var(--mono);font-weight:600;color:var(--text)} .a14f .a14h .grow{flex:1}
.a14f .a14b{padding:10px;overflow-x:auto;max-width:100%} .a14f .a14b svg{max-width:100%;height:auto}
.a14f pre{margin:0;padding:10px;background:var(--code-bg);font-family:var(--mono);font-size:12px;white-space:pre-wrap;word-break:break-word;color:var(--text)}
.a14f .a14n{padding:6px 10px;font-size:12px;color:var(--warn);border-top:1px solid var(--line)}
.a14f .a14cv{position:relative;width:100%;height:240px}
.a14t{border-collapse:collapse;font-size:12px;width:100%} .a14t th,.a14t td{border-bottom:1px solid var(--line);padding:6px 8px;text-align:left;white-space:nowrap}
.a14t th{cursor:pointer;color:var(--text-2);user-select:none;position:sticky;top:0;background:var(--card)} .a14t th[data-s]::after{content:attr(data-s);margin-left:4px;color:var(--accent)}
.a14v .vscroll{padding:12px 16px 40px} .a14card{padding:12px;margin-bottom:10px;border:1px solid var(--line);border-radius:var(--radius);background:var(--card);min-width:0}
.a14card h3{margin:0 0 4px;font-size:15px;display:flex;gap:8px;align-items:center;flex-wrap:wrap} .a14meta{display:flex;flex-wrap:wrap;gap:6px;margin:6px 0}
.a14card p{margin:4px 0;font-size:13px;color:var(--text-2);overflow-wrap:anywhere} .a14uv{color:var(--warn);font-family:var(--mono);font-size:11px}
.a14acts{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px} .a14acts .btn{min-height:40px}
.a14sem{padding:12px;border:1px dashed var(--accent-line);border-radius:var(--radius);margin-bottom:12px;background:var(--accent-soft)}
.a14sem .inp{width:100%;box-sizing:border-box;margin-top:8px}`;
      document.head.appendChild(s); return () => s.remove();
    });

    /* ---------- fences ---------- */
    function shell(el, lang, label) {
      el.className = 'a14f'; el.innerHTML = '<div class="a14h"><b></b><span class="grow"></span><span class="xs muted" data-st></span><button class="btn sm" data-src>Source</button></div><div class="a14b" data-out></div><pre data-pre hidden></pre><div class="a14n" data-note hidden></div>';
      el.querySelector('b').textContent = label || lang;
      el.querySelector('[data-src]').onclick = () => { const pr = el.querySelector('[data-pre]'); pr.hidden = !pr.hidden; };
      el._built = true;
    }
    function fallback(el, code, why) {
      const pr = el.querySelector('[data-pre]'); pr.textContent = code; pr.hidden = false;
      const n = el.querySelector('[data-note]'); n.hidden = false; n.textContent = why === 'offline' ? 'offline — showing source' : 'renderer unavailable (' + why + ') — showing source';
      el.querySelector('[data-st]').textContent = '';
    }
    function fenceRun(lang, label, libId, draw) {
      return (el, code, c) => {
        if (!el._built) shell(el, lang, label);
        el.querySelector('[data-pre]').textContent = code;
        if (!c.closed) { el.querySelector('[data-pre]').hidden = false; el.querySelector('[data-st]').textContent = 'streaming…'; return; }
        if (el._done === code) return; el._done = code;
        const out = el.querySelector('[data-out]'); out.innerHTML = '';
        const go = lib => Promise.resolve(draw(out, code, lib, c)).then(() => { if (el._done !== code) return; el.querySelector('[data-pre]').hidden = true; el.querySelector('[data-note]').hidden = true; el.querySelector('[data-st]').textContent = ''; })
          .catch(e => { if (el._done === code) fallback(el, code, 'error: ' + String(e && e.message || e).slice(0, 120)); });
        if (!libId) return go(null);
        if (!online()) return fallback(el, code, 'offline');
        el.querySelector('[data-st]').textContent = 'loading ' + byId(libId).name + '…';
        load(libId).then(go, e => { if (el._done === code) fallback(el, code, /offline/.test(e && e.message) ? 'offline' : 'CDN unreachable'); });
      };
    }
    let mmInit = false, mmN = 0;
    ctx.fence({ order: 50, langs: ['mermaid'], render: fenceRun('mermaid', 'mermaid', 'mermaid', async (out, code, mm) => {
      if (!mmInit) { mm.initialize({ startOnLoad: false, securityLevel: 'strict', theme: document.documentElement.dataset.dark === '0' ? 'default' : 'dark' }); mmInit = true; }
      const r = await mm.render('a14mm' + (++mmN) + Date.now().toString(36), code);
      out.innerHTML = sanitize(r.svg != null ? r.svg : r);
    }) });
    const mathDraw = (out, code, k) => { out.innerHTML = k.renderToString(code.trim().replace(/^\$\$|\$\$$/g, ''), { displayMode: true, throwOnError: false, output: 'htmlAndMathml' }); };
    ctx.fence({ order: 50, langs: ['math', 'latex', 'tex', 'katex'], render: fenceRun('math', 'math', 'katex', mathDraw) });
    ctx.fence({ order: 50, langs: ['chart'], render: fenceRun('chart', 'chart', 'chartjs', (out, code, Chart) => {
      const spec = JSON.parse(code); const box = document.createElement('div'); box.className = 'a14cv'; const cv = document.createElement('canvas'); box.appendChild(cv); out.appendChild(box);
      spec.options = Object.assign({ responsive: true, maintainAspectRatio: false, animation: false }, spec.options || {});
      const ch = new Chart(cv, spec); out._chart = ch;
    }) });
    /* $$…$$ display maths in plain text → handled after render (post-pass) */
    const mathPost = container => {
      if (!container || !container.querySelectorAll) return;
      for (const n of container.querySelectorAll('.md')) {
        if (n._a14m === n._src || !/\$\$[\s\S]+?\$\$/.test(n.textContent)) continue; n._a14m = n._src;
        const k = st('katex').val;
        const apply = kk => { if (n._a14m !== n._src) return; n.innerHTML = n.innerHTML.replace(/\$\$([\s\S]+?)\$\$/g, (m, tex) => { try { const t = document.createElement('textarea'); t.innerHTML = tex; return kk.renderToString(t.value, { displayMode: true, throwOnError: false }); } catch (e) { return m; } }); };
        if (k) apply(k); else if (online()) load('katex').then(apply, () => { });
      }
    };
    const into2 = DS.render.into;
    const wrapped2 = function (container) { const r = into2.apply(this, arguments); try { mathPost(container); } catch (e) { } return r; };
    DS.render.into = wrapped2; ctx.effect(() => () => { if (DS.render.into === wrapped2) DS.render.into = into2; });

    /* csv → sortable table (no library) */
    function parseCsv(src) {
      const rows = []; let row = [], f = '', q = false; const sep = (src.split('\n')[0].match(/\t/) ? '\t' : (src.split('\n')[0].split(';').length > src.split('\n')[0].split(',').length ? ';' : ','));
      for (let i = 0; i < src.length; i++) { const ch = src[i];
        if (q) { if (ch === '"') { if (src[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += ch; }
        else if (ch === '"') q = true; else if (ch === sep) { row.push(f); f = ''; } else if (ch === '\n') { row.push(f); rows.push(row); row = []; f = ''; } else if (ch !== '\r') f += ch; }
      if (f || row.length) { row.push(f); rows.push(row); }
      return rows.filter(r => r.some(x => x.trim()));
    }
    ctx.fence({ order: 50, langs: ['csv', 'tsv'], render: fenceRun('csv', 'csv', null, (out, code) => {
      const rows = parseCsv(code); if (!rows.length) throw new Error('empty csv');
      const head = rows[0], body = rows.slice(1); let sortI = -1, dir = 1;
      const tbl = document.createElement('table'); tbl.className = 'a14t';
      const draw = () => {
        const b = body.slice(); if (sortI >= 0) b.sort((x, y) => { const a = x[sortI] || '', c = y[sortI] || ''; const na = parseFloat(a), nc = parseFloat(c); return (!isNaN(na) && !isNaN(nc) ? na - nc : a.localeCompare(c)) * dir; });
        tbl.innerHTML = '<thead><tr>' + head.map((h, i) => '<th data-i="' + i + '"' + (i === sortI ? ' data-s="' + (dir > 0 ? '▲' : '▼') + '"' : '') + '>' + esc(h) + '</th>').join('') + '</tr></thead><tbody>' + b.map(r => '<tr>' + head.map((_, i) => '<td>' + esc(r[i] || '') + '</td>').join('') + '</tr>').join('') + '</tbody>';
      };
      tbl.onclick = e => { const th = e.target.closest('th'); if (!th) return; const i = +th.dataset.i; if (sortI === i) dir = -dir; else { sortI = i; dir = 1; } draw(); };
      draw(); out.appendChild(tbl);
      const n = document.createElement('div'); n.className = 'xs muted'; n.style.marginTop = '6px'; n.textContent = body.length + ' rows · tap a header to sort'; out.appendChild(n);
    }) });

    /* ---------- repo_map (aider-style) ---------- */
    const OUTLINE = {
      js: [/^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s*\*?\s*([\w$]+)/, /^\s*(?:export\s+)?(?:default\s+)?class\s+([\w$]+)/, /^\s*(?:export\s+)?(?:const|let|var)\s+([\w$]+)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[\w$]+)\s*=>/, /^\s*export\s+(?:const|let|var)\s+([\w$]+)/],
      py: [/^\s*(?:async\s+)?def\s+(\w+)/, /^\s*class\s+(\w+)/],
      html: [/<(h[1-3])[^>]*>([^<]{1,60})/i, /<(script|style)\b[^>]*?(?:src=["']([^"']+))?/i, /\bid=["']([\w-]+)["']/],
      css: [/^\s*([.#@:][^{]{1,60}?)\s*\{/],
      md: [/^(#{1,4}\s+.{1,70})/]
    };
    const extOf = p => { const m = /\.([a-z0-9]+)$/i.exec(p); const e = m ? m[1].toLowerCase() : ''; return ({ ts: 'js', tsx: 'js', jsx: 'js', mjs: 'js', cjs: 'js', htm: 'html', markdown: 'md', scss: 'css' })[e] || e; };
    function outline(path, content) {
      const ex = extOf(path), pats = OUTLINE[ex]; if (!pats) return [];
      const out = [], lines = String(content).split('\n');
      for (let i = 0; i < lines.length && out.length < 40; i++) {
        const L = lines[i]; if (L.length > 400) continue;
        for (const re of pats) { const m = re.exec(L); if (m) {
          let s; if (ex === 'html') s = m[2] ? m[1].toLowerCase() + ' ' + m[2].trim() : (m[1] && /script|style/i.test(m[1]) ? '<' + m[1].toLowerCase() + '>' : '#' + m[1]);
          else if (ex === 'md') s = m[1].trim(); else if (ex === 'css') s = m[1].trim(); else s = (/class/.test(re.source) ? 'class ' : /def|function/.test(re.source) ? 'fn ' : '') + m[1];
          out.push((i + 1) + ': ' + s); break; } }
      }
      return out;
    }
    async function repoMap(args = {}) {
      const dir = DS.fs.norm ? DS.fs.norm(args.dir || '/') : (args.dir || '/'); const max = Math.max(400, Math.min(+args.max_chars || 6000, 20000));
      let paths = await DS.fs.walk(dir); paths = (paths || []).map(p => typeof p === 'string' ? p : p.path).filter(p => p && !/\/(node_modules|\.git)\//.test(p)).sort();
      let tree = ''; try { tree = await DS.fs.tree(dir, 4); } catch (e) { tree = paths.join('\n'); }
      if (typeof tree !== 'string') tree = String(tree && (tree.text || tree.tree) || paths.join('\n'));
      let outS = '# repo map ' + dir + ' (' + paths.length + ' files)\n' + (tree.length > max / 3 ? tree.slice(0, Math.floor(max / 3)) + '\n…' : tree) + '\n\n';
      let shown = 0, cut = 0;
      for (const p of paths) {
        let r; try { r = await DS.fs.read(p); } catch (e) { continue; }
        const c = r && r.content; if (typeof c !== 'string' || (DS.fs.isBinary && DS.fs.isBinary(c))) continue;
        const ol = outline(p, c); const block = p + ' (' + c.split('\n').length + ' lines)\n' + ol.map(x => '  ' + x).join('\n') + (ol.length ? '\n' : '');
        if (outS.length + block.length > max) { cut++; continue; }
        outS += block; shown++;
      }
      if (cut) outS += '… ' + cut + ' more files omitted (raise max_chars)\n';
      return { dir, files: paths.length, outlined: shown, omitted: cut, chars: outS.length, map: outS };
    }
    ctx.tool({ name: 'repo_map', gate: 'read', label: 'Repo map',
      description: 'Compact map of the workspace: file tree plus per-file outline (functions, classes, exports, headings, selectors) for js/ts/py/html/css/md, budgeted by max_chars. Use before editing an unfamiliar project.',
      parameters: { type: 'object', properties: { dir: { type: 'string', description: 'directory, default /' }, max_chars: { type: 'number', description: 'budget, default 6000' } } },
      run: a => repoMap(a), summarize: (a, r) => r && r.files != null ? r.files + ' files · ' + r.outlined + ' outlined · ' + r.chars + ' chars' : '',
      inline(part, el) { const r = part.result; if (!r || !r.map) return; el.innerHTML = ''; const pre = document.createElement('pre'); pre.className = 'mono xs'; pre.style.cssText = 'max-height:260px;overflow:auto;white-space:pre;margin:0;padding:8px;background:var(--code-bg);border-radius:8px'; pre.textContent = r.map; el.appendChild(pre); } });

    /* ---------- delegate (OpenCode-style subagent) ---------- */
    const SUB_MAX = 6;
    const subs = new Map(); // threadId -> step count
    ctx.hook('beforeModel', p => { const t = p && p.thread; if (!t || !subs.has(t.id)) return; const n = subs.get(t.id) + 1; subs.set(t.id, n); if (n > SUB_MAX) { setTimeout(() => DS.agent.stop(t), 0); throw new Error('subagent step cap (' + SUB_MAX + ') reached'); } });
    async function delegate(a, tctx) {
      const prof = a.profile ? DS.agent.profile(a.profile) : null;
      const parentMode = 'act';
      const sub = { id: U.uid('sub'), title: 'subagent: ' + String(a.prompt || '').slice(0, 40), created: Date.now(), updated: Date.now(), mode: parentMode, permission: (tctx && tctx.thread && tctx.thread.permission) || null, messages: [], plan: null, goal: null, taint: (tctx && tctx.thread && tctx.thread.taint) || 'low', changes: {}, allow: {}, usage: { in: 0, out: 0 }, titled: true, sub: true };
      const text = (prof && prof.system ? '[Profile ' + (prof.label || prof.id) + '] ' + prof.system + '\n\n' : '') + 'You are a delegated subagent. Work independently, then answer concisely with your findings.\n\nTask: ' + String(a.prompt || '');
      subs.set(sub.id, 0);
      const onAbort = () => DS.agent.stop(sub); if (tctx && tctx.signal) tctx.signal.addEventListener('abort', onAbort);
      try { await DS.agent.run(sub, text, { mode: 'act' }); }
      finally { if (tctx && tctx.signal) tctx.signal.removeEventListener('abort', onAbort); subs.delete(sub.id); }
      const m = sub.messages.filter(x => x.role === 'assistant').pop();
      const final = m ? (m.parts || []).filter(p => p.type === 'text').map(p => p.text).join('\n').trim() : '';
      const tools = m ? (m.parts || []).filter(p => p.type === 'tool').map(p => p.name) : [];
      return { ok: !(m && m.meta && m.meta.error), profile: a.profile || 'default', steps: tools.length, tools, text: final || (m && m.meta && m.meta.error ? 'subagent error: ' + m.meta.error : '(no text)') };
    }
    ctx.tool({ name: 'delegate', gate: 'none', label: 'Delegate',
      description: 'Run an isolated subagent (fresh context, same tools and permission tier, max ' + SUB_MAX + ' steps) on a self-contained task and return its final answer. Good for searches/summaries that would clutter this thread.',
      parameters: { type: 'object', properties: { prompt: { type: 'string', description: 'self-contained task' }, profile: { type: 'string', description: 'optional profile id, e.g. planner, critic' } }, required: ['prompt'] },
      run: (a, t) => delegate(a, t), summarize: (a, r) => r ? 'subagent · ' + r.steps + ' tool calls' : '' });

    /* ---------- /plan /build ---------- */
    const setMode = m => { const t = DS.store.activeThread() || DS.store.newThread(); t.mode = m; DS.store.state.settings.mode = m; DS.store.save(); try { DS.shell.renderHeader && DS.shell.renderHeader(); } catch (e) { } DS.bus.emit('mode:change', m); return t; };
    ctx.command({ name: 'plan', desc: 'Plan mode (OpenCode "plan"): read-only, proposes a plan for approval', run: (_, c) => { setMode('plan'); c.reply('**Mode → plan.** I will explore read-only and propose a plan for your approval. `/build` to switch back.'); } });
    ctx.command({ name: 'build', desc: 'Build mode (OpenCode "build" = core "act"): edits directly', run: (_, c) => { setMode('act'); c.reply('**Mode → build** (core `act`): I edit directly within your permission tier. `/plan` to go read-only.'); } });

    /* ---------- semantic memory (optional) ---------- */
    const sem = { state: 'off', pipe: null, err: '' };
    async function enableSemantic() {
      if (sem.state === 'ready' || sem.state === 'loading') return;
      if (!online()) { sem.state = 'err'; sem.err = 'offline'; refreshView(); return; }
      sem.state = 'loading'; sem.err = ''; refreshView();
      try { const T = await load('transformers'); const fx = T.pipeline || (T.default && T.default.pipeline); if (!fx) throw new Error('pipeline() missing');
        sem.pipe = await fx('feature-extraction', 'Xenova/all-MiniLM-L6-v2'); sem.state = 'ready'; }
      catch (e) { sem.state = 'err'; sem.err = String(e && e.message || e).slice(0, 160); }
      refreshView();
    }
    async function embed(text) { if (!sem.pipe) throw new Error('semantic memory not enabled'); const o = await sem.pipe(String(text), { pooling: 'mean', normalize: true }); return Array.from(o.data || o); }
    const cos = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };
    async function semanticSearch(q, k = 5) {
      const brain = ctx.service('forge.brain'); const all = brain && brain.all ? brain.all() : []; if (!all.length) return [];
      const qv = await embed(q); const out = [];
      for (const m of all.slice(0, 200)) { const t = m.text || m.content || m.title || JSON.stringify(m); out.push({ m, s: cos(qv, await embed(t)) }); }
      return out.sort((a, b) => b.s - a.s).slice(0, k).map(x => ({ score: +x.s.toFixed(3), text: (x.m.text || x.m.content || x.m.title || '').slice(0, 160) }));
    }
    const api = { picks: PICKS, load, status: id => Object.assign({}, st(id), { promise: undefined, val: undefined }), sanitize, repoMap, delegate, enableSemantic, embed, semanticSearch, semantic: () => ({ state: sem.state, err: sem.err }), parseCsv };
    ctx.provide('forge.picks', api); DS.picks = api; ctx.effect(() => () => { if (DS.picks === api) delete DS.picks; });

    /* ---------- Research view ---------- */
    const manifest = p => JSON.stringify({ name: p.name, npm: p.npm, version: p.ver, urls: p.path === 'unverified' ? [] : urlsOf(p), license: p.license, loadMode: p.mode, sizeKB: p.kb, verified: p.verified }, null, 2);
    const uv = (val, ok) => ok ? esc(val) : '<span class="a14uv">' + esc(val === 'unverified' ? 'unverified' : val + ' (unverified)') + '</span>';
    function card(p) {
      const s = st(p.id); const chip = s.state === 'ok' ? '<span class="chip ok">loaded</span>' : s.state === 'loading' ? '<span class="chip acc">loading…</span>' : s.state === 'err' ? '<span class="chip err">' + esc(s.err === 'offline' ? 'offline' : 'failed') + '</span>' : '<span class="chip">idle</span>';
      const v = p.verified || {};
      return '<div class="a14card" data-p="' + p.id + '"><h3>' + esc(p.name) + ' ' + chip + '</h3>' +
        '<div class="a14meta"><span class="pt-chip">★ ' + uv(p.stars, v.stars) + '</span><span class="pt-chip">' + uv(p.license, v.license) + '</span><span class="pt-chip mono">@' + uv(p.ver, v.version) + '</span>' + (p.kb ? '<span class="pt-chip">' + p.kb + ' KB pkg</span>' : '') + '<span class="pt-chip">' + esc(p.mode) + '</span></div>' +
        '<p>' + esc(p.why) + '</p><p class="xs">Status: ' + esc(p.status) + '</p>' + (p.risk ? '<p class="xs a14uv">Risk: ' + esc(p.risk) + '</p>' : '') + (p.path === 'unverified' ? '<p class="xs a14uv">CDN path: unverified</p>' : '') + (s.url ? '<p class="xs mono">' + esc(s.url) + '</p>' : '') +
        '<div class="a14acts">' + (p.path !== 'unverified' && p.id !== 'transformers' ? '<button class="btn sm pri" data-a="load">' + (s.state === 'ok' ? 'Loaded' : 'Load') + '</button>' : '') + '<button class="btn sm" data-a="url"' + (p.path === 'unverified' ? ' disabled' : '') + '>Copy URL</button><button class="btn sm" data-a="man">Copy manifest</button></div></div>';
    }
    ctx.view({ id: 'research', title: 'Research', icon: 'book', order: 92,
      badge: () => { const n = Object.values(libs).filter(x => x.state === 'ok').length; return n ? String(n) : ''; },
      mount(el) {
        el.classList.add('a14v');
        el.innerHTML = '<div class="vhead"><h2>Research picks</h2></div><div class="vscroll"></div>';
        const sc = el.querySelector('.vscroll');
        const draw = () => {
          const semTxt = { off: 'Off. Downloads Transformers.js 4.3.1 + Xenova/all-MiniLM-L6-v2 (~25 MB) from the CDN; nothing is bundled.', loading: 'Loading model…', ready: 'Ready — memory search below ranks forge.brain entries by cosine similarity.', err: 'Unavailable: ' + sem.err }[sem.state];
          sc.innerHTML = '<p class="sm muted">Vetted by research (A11), pinned to releases ≥2 weeks old. Everything loads lazily from jsDelivr → unpkg; <span class="a14uv">unverified</span> marks fields the research could not confirm. ' + (online() ? '' : '<b>Offline</b> — loads disabled; fences show source.') + '</p>' +
            '<div class="a14sem"><b>Semantic memory</b> <span class="chip ' + (sem.state === 'ready' ? 'ok' : sem.state === 'err' ? 'err' : '') + '">' + esc(sem.state) + '</span><p class="xs">' + esc(semTxt) + '</p>' +
            (sem.state === 'ready' ? '<input class="inp" data-q placeholder="search memory semantically…"><div data-res class="xs"></div>' : '<button class="btn sm pri" data-a="sem"' + (sem.state === 'loading' ? ' disabled' : '') + '>Enable semantic memory</button>') + '</div>' +
            PICKS.map(card).join('');
        };
        draw();
        sc.addEventListener('click', async e => {
          const b = e.target.closest('button[data-a]'); if (!b) return; const a = b.dataset.a;
          if (a === 'sem') return enableSemantic();
          const p = byId(b.closest('[data-p]').dataset.p);
          if (a === 'load') load(p.id).then(() => ctx.toast(p.name + ' loaded', 'ok'), er => ctx.toast(p.name + ': ' + (er && er.message === 'offline' ? 'offline' : 'CDN unreachable'), 'warn'));
          else if (a === 'url') { U.copy(urlsOf(p)[0]); ctx.toast('URL copied', 'ok'); }
          else if (a === 'man') { U.copy(manifest(p)); ctx.toast('Manifest copied', 'ok'); }
        });
        sc.addEventListener('keydown', async e => { if (e.key !== 'Enter' || !e.target.matches('[data-q]')) return; const r = sc.querySelector('[data-res]'); r.textContent = 'searching…'; try { const hits = await semanticSearch(e.target.value); r.innerHTML = hits.length ? hits.map(h => '<div>' + h.score + ' · ' + esc(h.text) + '</div>').join('') : 'no memories yet'; } catch (er) { r.textContent = er.message; } });
        const off = DS.bus.on('picks:change', () => { if (!sc.querySelector('[data-q]:focus')) draw(); });
        const fo = () => draw(); window.addEventListener('online', fo); window.addEventListener('offline', fo);
        return () => { if (typeof off === 'function') off(); window.removeEventListener('online', fo); window.removeEventListener('offline', fo); };
      } });
    ctx.command({ name: 'research', desc: 'Open the Research picks view (vetted libraries, lazy loaders)', run: (_, c) => { DS.shell.show('research'); } });

    /* ---------- Sim intents + starter ---------- */
    const MERMAID_DEMO = '```mermaid\nflowchart TD\n  U[User message] --> P{Plan mode?}\n  P -- yes --> PL[update_plan → wait for approval]\n  P -- no --> M[Model step]\n  M --> T{Tool calls?}\n  T -- yes --> G[Guard gate] --> X[Run tool] --> M\n  T -- no --> F[Final answer]\n```';
    ctx.intent({ id: 'picks-repo-map', order: 50, match: t => /\brepo[ _-]?map\b|map (of )?(the )?(repo|workspace|project)/i.test(t),
      script: () => [{ say: 'Building an aider-style repo map of the workspace.', tool: { name: 'repo_map', args: { dir: '/', max_chars: 6000 } } },
        { final: r => { const m = r[0] || {}; return 'Repo map ready: **' + (m.files || 0) + ' files**, ' + (m.outlined || 0) + ' outlined in ' + (m.chars || 0) + ' chars' + (m.omitted ? ' (' + m.omitted + ' omitted by budget)' : '') + '. Expand the tool card to see tree + symbols.'; } }] });
    ctx.intent({ id: 'picks-mermaid', order: 50, match: t => /\bmermaid\b|diagram of the agent loop/i.test(t),
      script: () => [{ final: 'Here is the Forge agent loop as a Mermaid diagram (renders when online; offline shows the source):\n\n' + MERMAID_DEMO }] });
    ctx.intent({ id: 'picks-research', order: 50, match: t => /^\/?research\b|research picks|which libraries/i.test(t.trim()),
      script: () => [{ final: () => { try { DS.shell.show('research'); } catch (e) { } return 'Opened **Research** — ' + PICKS.length + ' vetted picks with pinned versions. Live fences: ```mermaid, ```math, ```chart, ```csv. Tools: `repo_map`, `delegate`.'; } }] });
    ctx.intent({ id: 'picks-delegate', order: 50, match: t => /^(delegate|subagent)\b/i.test(t.trim()),
      script: t => [{ say: 'Handing this to an isolated subagent.', tool: { name: 'delegate', args: { prompt: t.replace(/^(delegate|subagent)\s*:?\s*/i, '') || 'summarise the workspace' } } },
        { final: r => '**Subagent answer:**\n\n' + ((r[0] && r[0].text) || '(none)') }] });
    ctx.suggest({ id: 'picks-mermaid', emoji: '🧭', title: 'Diagram the agent loop', sub: 'Mermaid fence · lazy, offline-safe', prompt: 'draw a mermaid diagram of the agent loop' });
    ctx.suggest({ id: 'picks-map', emoji: '🗺️', title: 'Repo map', sub: 'aider-style tree + symbols', prompt: 'make a repo map of the workspace' });
    return () => { alive = false; };
  }
});
