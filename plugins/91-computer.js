// forge.computer — per-thread in-harness browser (route ladder, Page/Reader/Shot/Live modes)
// Honest by design: file:// cannot bypass CORS. Every load is labelled with the route (`via`) that worked
// and the list of routes that were `tried` and why they failed.
DS.plugin({
  name: 'forge.computer', title: 'Browser', version: '2.0.0', tags: ['web', 'browser'],
  description: 'Per-thread virtual browser: site adapters (Wikipedia/HN/GitHub/npm), direct, gateway, bridge, public readers, sandboxed JSONP, Wayback. Page/Reader/Shot/Live modes.',
  apply(ctx) {
    const TEXT_CAP = 6000, TTL = 10 * 60 * 1000, esc = s => DS.util.esc(String(s == null ? '' : s));
    const comps = {}; const cache = new Map();
    const newTab = () => ({ id: Date.now() + Math.random(), url: '', title: 'New tab', text: '', md: '', html: '', links: [], forms: [], tables: [], history: [], fwd: [], via: '', tried: [], mode: '' });
    const tid = th => (th && th.id) || (ctx.thread() && ctx.thread().id) || 'default';
    function comp(th) { const id = tid(th); if (!comps[id]) comps[id] = { tabs: [newTab()], active: 0, log: [], shot: '', mode: ctx.data.get('mode', 'page') }; return comps[id]; }
    const tab = c => c.tabs[c.active];
    const log = (c, m) => { c.log.unshift({ t: Date.now(), m }); c.log.length = Math.min(c.log.length, 60); ctx.emit('computer:change'); };
    const normUrl = u => { u = String(u || '').trim(); if (!u) throw new Error('url required'); if (!/^[a-z]+:\/\//i.test(u)) u = 'https://' + u; return new URL(u).href; };
    const isPrivate = u => { try { const h = new URL(u).hostname; return /^(localhost|127\.|10\.|192\.168\.|169\.254\.|0\.0\.0\.0|\[?::1\]?$)/i.test(h) || /^172\.(1[6-9]|2\d|3[01])\./.test(h) || /\.(local|internal|lan)$/i.test(h) || !/\./.test(h); } catch (e) { return false; } };
    /* URLs that look like they carry credentials never go to third parties (public readers, archives, screenshot services) */
    const SECRET_NAME = /(^|[_-])(token|secret|key|apikey|sig|signature|password|passwd|pwd|auth|credential|credentials|code|session|sessionid|jwt)$/i;
    const SECRET = { test: u => { try { const U = new URL(u); if (U.username || U.password) return true; if (/X-Amz-|[?&#](sig|signature)=/i.test(u)) return true; for (const k of U.searchParams.keys()) if (SECRET_NAME.test(k)) return true; const h = new URLSearchParams(U.hash.replace(/^#/, '')); for (const k of h.keys()) if (SECRET_NAME.test(k)) return true; return false; } catch (_) { return true; } } };
    const usePublic = () => ctx.data.get('publicReaders', true) !== false;
    const publicOk = u => usePublic() && !isPrivate(u) && !SECRET.test(u);
    const privBlocked = (u, th) => { try { const t = DS.guard.tier(th); return isPrivate(u) && !(t && (t.id === 'unrestricted' || t.id === 'full')); } catch (_) { return isPrivate(u); } };
    const svc = async (name, ms = 300) => { try { return ctx.service && ctx.service(name) || await Promise.race([ctx.waitFor(name), new Promise(r => setTimeout(() => r(null), ms))]); } catch (_) { return null; } };

    /* ---------- low-level fetch helpers ---------- */
    async function tfetch(u, signal, ms = 12000, init) {
      const ac = new AbortController(); const to = setTimeout(() => ac.abort(), ms);
      const onAb = () => ac.abort(); if (signal) { if (signal.aborted) ac.abort(); else signal.addEventListener('abort', onAb, { once: true }); }
      try { return await fetch(u, Object.assign({}, init || {}, { signal: ac.signal })); }
      catch (e) { if (signal && signal.aborted) throw e; throw new Error(ac.signal.aborted ? 'timeout' : (e.message || 'network error') + ' (likely CORS/offline)'); }
      finally { clearTimeout(to); if (signal) signal.removeEventListener('abort', onAb); }
    }
    async function getJSON(u, signal) { const r = await tfetch(u, signal); if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); }
    async function getBody(u, signal, init) { const r = await tfetch(u, signal, 12000, init); if (!r.ok) throw new Error('HTTP ' + r.status); const b = await r.text(); if (!b || b.length < 20) throw new Error('empty body'); return b; }
    /* JSONP executed ONLY inside a sandboxed iframe (allow-scripts, no allow-same-origin): remote script never runs in this page. */
    function jsonpSandbox(src, cb = 'cb', ms = 12000) {
      return new Promise((res, rej) => {
        const nonce = 'j' + Math.random().toString(36).slice(2);
        const f = document.createElement('iframe'); f.setAttribute('sandbox', 'allow-scripts'); f.setAttribute('referrerpolicy', 'no-referrer');
        f.style.cssText = 'position:absolute;width:0;height:0;border:0;visibility:hidden'; f.className = 'cm-jsonp';
        const post = "function(m){try{parent.postMessage(m,'*')}catch(e){}}";
        f.srcdoc = '<!doctype html><meta charset="utf-8"><script>var __p=' + post + ';window.' + cb + '=function(d){__p({__fj:"' + nonce + '",data:d})};<\/script><script src="' + esc(src) + '" onerror="__p({__fj:\'' + nonce + '\',err:\'script failed to load\'})"><\/script><script>setTimeout(function(){__p({__fj:"' + nonce + '",err:"no callback"})},' + (ms - 500) + ')<\/script>';
        let done = false; const fin = (fn, v) => { if (done) return; done = true; window.removeEventListener('message', on); clearTimeout(t); f.remove(); fn(v); };
        const on = e => { const d = e.data; if (!d || d.__fj !== nonce || e.source !== f.contentWindow) return; d.err ? fin(rej, new Error(d.err)) : fin(res, d.data); };
        const t = setTimeout(() => fin(rej, new Error('timeout')), ms);
        window.addEventListener('message', on); document.body.appendChild(f);
      });
    }

    /* ---------- site adapters (keyless CORS APIs) ---------- */
    const mdHtml = (md, title) => { let h = ''; try { h = DS.render.markdown(String(md)); } catch (_) { h = '<pre>' + esc(md) + '</pre>'; } return '<html><head><title>' + esc(title) + '</title></head><body>' + h + '</body></html>'; };
    const b64utf8 = s => { try { const bin = atob(String(s).replace(/\s/g, '')); return new TextDecoder().decode(Uint8Array.from(bin, c => c.charCodeAt(0))); } catch (_) { return ''; } };
    const ADAPTERS = [
      { id: 'wikipedia', match: u => /^([a-z-]+)\.(m\.)?wikipedia\.org$/i.test(u.hostname), async run(u, signal) {
        const lang = u.hostname.split('.')[0], host = 'https://' + lang + '.wikipedia.org';
        const q = u.searchParams.get('search') || (/Special:Search/i.test(u.pathname) ? u.searchParams.get('search') : '');
        if (q) { const j = await getJSON(host + '/w/api.php?action=query&list=search&format=json&origin=*&srlimit=20&srsearch=' + encodeURIComponent(q), signal); const it = (j.query && j.query.search) || []; return { html: '<html><head><title>Wikipedia search: ' + esc(q) + '</title></head><body><h1>Search: ' + esc(q) + '</h1><ul>' + it.map(x => '<li><a href="' + host + '/wiki/' + encodeURIComponent(x.title.replace(/ /g, '_')) + '">' + esc(x.title) + '</a> — ' + String(x.snippet || '').replace(/<(?!\/?span)[^>]*>/g, '') + '</li>').join('') + '</ul></body></html>' }; }
        const m = u.pathname.match(/^\/wiki\/(.+)$/); const title = m ? m[1] : (u.searchParams.get('title') || 'Main_Page');
        try { const h = await getBody(host + '/api/rest_v1/page/html/' + title, signal); return { html: h.replace(/<base[^>]*>/i, ''), note: 'REST page/html' }; }
        catch (e) { const j = await getJSON(host + '/w/api.php?action=parse&format=json&origin=*&prop=text|displaytitle&redirects=1&page=' + title, signal); if (!j.parse) throw new Error((j.error && j.error.info) || 'no page'); return { html: '<html><head><title>' + esc(j.parse.title) + '</title></head><body><h1>' + j.parse.displaytitle + '</h1>' + j.parse.text['*'] + '</body></html>', note: 'action API (REST failed: ' + e.message + ')' }; }
      } },
      { id: 'hackernews', match: u => /^news\.ycombinator\.com$/i.test(u.hostname) && /^\/(news|item|newest|best|)$/.test(u.pathname), async run(u, signal) {
        const API = 'https://hacker-news.firebaseio.com/v0/'; const item = id => getJSON(API + 'item/' + id + '.json', signal).catch(() => null);
        const link = it => '<a href="' + esc(it.url || 'https://news.ycombinator.com/item?id=' + it.id) + '">' + esc(it.title || '(untitled)') + '</a>';
        if (u.pathname === '/item' && u.searchParams.get('id')) {
          const it = await item(u.searchParams.get('id')); if (!it) throw new Error('item not found');
          const kids = (await Promise.all((it.kids || []).slice(0, 20).map(item))).filter(k => k && !k.deleted);
          return { html: '<html><head><title>' + esc(it.title || 'HN item') + '</title></head><body><h1>' + link(it) + '</h1><p>' + (it.score || 0) + ' points by ' + esc(it.by) + '</p>' + (it.text || '') + '<h2>Comments</h2>' + kids.map(k => '<div><p><b>' + esc(k.by) + '</b></p>' + (k.text || '') + '</div><hr>').join('') + '</body></html>' };
        }
        const list = u.pathname === '/newest' ? 'newstories' : u.pathname === '/best' ? 'beststories' : 'topstories';
        const ids = (await getJSON(API + list + '.json', signal)).slice(0, 30); const its = (await Promise.all(ids.map(item))).filter(Boolean);
        return { html: '<html><head><title>Hacker News</title></head><body><h1>Hacker News — ' + list + '</h1><ol>' + its.map(it => '<li>' + link(it) + ' <small>' + (it.score || 0) + ' pts · <a href="https://news.ycombinator.com/item?id=' + it.id + '">' + (it.descendants || 0) + ' comments</a></small></li>').join('') + '</ol></body></html>' };
      } },
      { id: 'github', match: u => /^(www\.)?github\.com$/i.test(u.hostname) && /^\/[^/]+\/[^/]+/.test(u.pathname), async run(u, signal) {
        const [, o, r, kind, br, ...rest] = u.pathname.split('/');
        if (kind === 'blob' && br && rest.length) { const t = await getBody('https://raw.githubusercontent.com/' + o + '/' + r + '/' + br + '/' + rest.join('/'), signal); const isMd = /\.md$/i.test(rest[rest.length - 1]); return { html: isMd ? mdHtml(t, rest.join('/')) : '<html><head><title>' + esc(rest.join('/')) + '</title></head><body><pre>' + esc(t) + '</pre></body></html>' }; }
        if (kind) throw new Error('only repo pages and /blob/ files are adapted');
        const repo = await getJSON('https://api.github.com/repos/' + o + '/' + r, signal); let readme = '';
        try { const j = await getJSON('https://api.github.com/repos/' + o + '/' + r + '/readme', signal); readme = b64utf8(j.content); } catch (_) {}
        const head = '# ' + repo.full_name + '\n\n' + (repo.description || '') + '\n\n★ ' + repo.stargazers_count + ' · ' + (repo.language || '') + ' · [homepage](' + (repo.homepage || repo.html_url) + ')\n\n---\n\n';
        return { html: mdHtml(head + readme, repo.full_name) };
      } },
      { id: 'npm', match: u => /^(www\.)?npmjs\.com$/i.test(u.hostname) && /^\/package\//.test(u.pathname), async run(u, signal) {
        const name = decodeURIComponent(u.pathname.replace(/^\/package\//, '')); const j = await getJSON('https://registry.npmjs.org/' + name.replace('/', '%2F'), signal);
        const v = (j['dist-tags'] || {}).latest; return { html: mdHtml('# ' + j.name + ' ' + (v || '') + '\n\n' + (j.description || '') + '\n\n`npm i ' + j.name + '`\n\n---\n\n' + (j.readme || ''), j.name) };
      } }
    ];

    /* ---------- the route ladder ---------- */
    async function ladder(url, opts = {}) {
      const tried = []; const signal = opts.signal; const init = opts.init;
      const ok = (route, r) => { tried.push({ route, ok: true }); return Object.assign({ via: route, tried }, r); };
      const fail = (route, e) => { if (e && e.name === 'AbortError' && signal && signal.aborted) throw e; tried.push({ route, ok: false, why: String((e && e.message) || e).slice(0, 160) }); };
      const skip = (route, why) => tried.push({ route, ok: false, skipped: true, why });
      const isPost = !!(init && init.method && init.method !== 'GET');
      const pub = publicOk(url);
      let U; try { U = new URL(url); } catch (e) { throw new Error('bad url'); }
      if (!isPost) for (const a of ADAPTERS) { if (!a.match(U)) continue; try { const r = await a.run(U, signal); return ok(a.id, { body: r.html, note: r.note }); } catch (e) { fail(a.id, e); } }
      try { return ok('direct', { body: await getBody(url, signal, init) }); } catch (e) { fail('direct', e); }
      const gw = await svc('forge.gateway');
      if (gw && gw.fetch && ((gw.get && gw.get()) || /^https?:/.test(location.protocol))) {
        try { const r = await gw.fetch(url, Object.assign({}, init || {}, { signal }), { direct: false }); if (!r || !r.ok) throw new Error('HTTP ' + (r && r.status)); const b = await r.text(); if (!b) throw new Error('empty'); return ok('gateway', { body: b }); } catch (e) { fail('gateway', e); }
      } else skip('gateway', 'no Gateway URL set (Providers → Gateway)');
      const be = await svc('forge.backend');
      if (be && be.api && !isPost) {
        try { const r = await be.api('/api/fetch?url=' + encodeURIComponent(url) + '&max=60'); if (r.off) throw new Error(r.off.error || 'offline'); const j = r.j || {}; if (j.html) return ok('vercel', { body: j.html }); if (typeof j.text === 'string' && j.text) return ok('vercel', { body: '# ' + (j.title || url) + '\n\n' + j.text, plain: true }); throw new Error('no body'); } catch (e) { fail('vercel', e); }
      } else skip('vercel', 'no Vercel backend detected');
      if (DS.bridge && DS.bridge.online) {
        try { const r = await DS.bridge.call('fetch', { url, method: (init && init.method) || 'GET', body: init && init.body }, { timeout: 20000 }); const b = r && (r.body || r.text || r.content); if (!b) throw new Error('empty'); return ok('bridge', { body: String(b) }); } catch (e) { fail('bridge', e); }
      } else skip('bridge', 'local bridge offline');
      if (!pub) { skip('public', !usePublic() ? 'public readers disabled in Settings' : isPrivate(url) ? 'private/localhost URL — never sent to third parties' : 'URL looks like it carries a secret — not sent to third parties'); }
      else if (isPost) skip('public', 'POST forms are not sent through public readers');
      else {
        try { return ok('jina', { body: await getBody('https://r.jina.ai/' + url, signal), plain: true }); } catch (e) { fail('jina', e); }
        try { return ok('allorigins', { body: await getBody('https://api.allorigins.win/raw?url=' + encodeURIComponent(url), signal) }); } catch (e) { fail('allorigins', e); }
        try { return ok('cors.lol', { body: await getBody('https://api.cors.lol/?url=' + encodeURIComponent(url), signal) }); } catch (e) { fail('cors.lol', e); }
        try { return ok('codetabs', { body: await getBody('https://api.codetabs.com/v1/proxy?quest=' + encodeURIComponent(url), signal) }); } catch (e) { fail('codetabs', e); }
        try { const d = await jsonpSandbox('https://api.allorigins.win/get?callback=cb&url=' + encodeURIComponent(url)); const b = d && typeof d.contents === 'string' ? d.contents : ''; if (b.length < 20) throw new Error('empty contents'); return ok('jsonp-sandbox', { body: b }); } catch (e) { fail('jsonp-sandbox', e); }
        if (!opts.noWayback && !/web\.archive\.org/.test(U.hostname)) {
          try {
            const av = 'https://archive.org/wayback/available?url=' + encodeURIComponent(url);
            let j; try { j = await getJSON(av, signal); } catch (_) { j = await jsonpSandbox(av + '&callback=cb'); }
            const s = j && j.archived_snapshots && j.archived_snapshots.closest; if (!s || !s.timestamp) throw new Error('no snapshot');
            const r = await ladder('https://web.archive.org/web/' + s.timestamp + 'id_/' + url, { signal, noWayback: true });
            tried.push(...r.tried.map(x => Object.assign({}, x, { route: 'wayback→' + x.route }))); tried.push({ route: 'wayback', ok: true });
            return { body: r.body, plain: r.plain, via: 'wayback(' + s.timestamp.slice(0, 8) + ')/' + r.via, tried, snapshot: s.url };
          } catch (e) { fail('wayback', e); }
        }
      }
      const err = new Error('Could not load ' + url + '. Tried: ' + tried.map(t => t.route + (t.why ? ' (' + t.why + ')' : '')).join(' · ') + '. ' + (location.protocol === 'file:' ? 'This page runs from file://, so the browser enforces CORS and nothing here can bypass that. ' : '') + 'Fixes: set a Gateway URL / deploy the Vercel backend, run the local bridge, or enable public readers.');
      err.tried = tried; throw err;
    }
    async function fetchPage(url, opts = {}) {
      const key = url; const hit = !opts.init && !opts.fresh && cache.get(key);
      if (hit && Date.now() - hit.t < TTL) return Object.assign({}, hit.r, { cached: true });
      const r = await ladder(url, opts); if (!opts.init) { cache.set(key, { t: Date.now(), r }); if (cache.size > 40) cache.delete(cache.keys().next().value); }
      return r;
    }

    /* ---------- parsing ---------- */
    function toMd(node, base) {
      const out = []; const abs = h => { try { return new URL(h, base).href; } catch (e) { return ''; } };
      const walk = (n, pre) => {
        if (n.nodeType === 3) { out.push(pre ? n.nodeValue : n.nodeValue.replace(/\s+/g, ' ')); return; }
        if (n.nodeType !== 1) return; const t = n.tagName.toLowerCase();
        if (/^(script|style|noscript|template|svg|iframe|nav|footer|button|select)$/.test(t)) return;
        if (/^h[1-6]$/.test(t)) { out.push('\n\n' + '#'.repeat(+t[1]) + ' ' + n.textContent.replace(/\s+/g, ' ').trim() + '\n\n'); return; }
        if (t === 'pre') { out.push('\n\n```\n' + n.textContent.replace(/\n+$/, '') + '\n```\n\n'); return; }
        if (t === 'a') { const h = abs(n.getAttribute('href') || ''); const tx = n.textContent.replace(/\s+/g, ' ').trim(); out.push(h && /^https?:/.test(h) && tx ? '[' + tx.replace(/[[\]]/g, '') + '](' + h.replace(/\)/g, '%29') + ')' : tx); return; }
        if (t === 'br') { out.push('  \n'); return; }
        if (t === 'li') out.push('\n- '); else if (/^(p|div|section|article|table|tr|ul|ol|blockquote|header|main|dl|dt|dd|figure)$/.test(t)) out.push('\n\n');
        if (t === 'code') { out.push('`' + n.textContent + '`'); return; }
        if (t === 'b' || t === 'strong') { const s = n.textContent.trim(); if (s) out.push('**' + s + '**'); return; }
        if (t === 'td' || t === 'th') out.push(' | ');
        n.childNodes.forEach(c => walk(c, pre));
      };
      walk(node, false);
      return out.join('').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').replace(/\n- \s*\n/g, '\n').trim();
    }
    function parse(html, base, plain) {
      if (plain) { const links = []; String(html).replace(/\[([^\]]{1,80})\]\((https?:[^)\s]+)\)/g, (m, t, h) => { links.push({ i: links.length, text: t, href: h }); return m; }); const md = String(html); return { title: ((md.match(/^Title:\s*(.+)$/m) || md.match(/^#\s+(.+)$/m) || [, base])[1]).trim().slice(0, 120), text: md.slice(0, TEXT_CAP), md, links: links.slice(0, 200), forms: [], tables: [], html: mdHtml(md, base) };
      }
      const doc = new DOMParser().parseFromString(String(html), 'text/html');
      doc.querySelectorAll('script,noscript,iframe,object,embed,template,meta[http-equiv],base,link[rel=preload],link[rel=modulepreload]').forEach(n => n.remove());
      doc.querySelectorAll('*').forEach(n => { for (const a of [...n.attributes]) if (/^on/i.test(a.name) || (/^(href|src|action|formaction)$/i.test(a.name) && /^\s*javascript:/i.test(a.value))) n.removeAttribute(a.name); });
      const clean = '<!doctype html>' + doc.documentElement.outerHTML;
      const abs = h => { try { return new URL(h, base).href; } catch (e) { return ''; } };
      const links = []; doc.querySelectorAll('a[href]').forEach(a => { const href = abs(a.getAttribute('href')); const text = (a.textContent || '').replace(/\s+/g, ' ').trim(); if (href && /^https?:/.test(href) && links.length < 200) links.push({ i: links.length, text: text.slice(0, 80) || href, href }); });
      const forms = [...doc.querySelectorAll('form')].slice(0, 10).map((f, i) => ({ i, action: abs(f.getAttribute('action') || base), method: (f.getAttribute('method') || 'GET').toUpperCase(), fields: [...f.querySelectorAll('input[name],textarea[name],select[name]')].filter(x => x.type !== 'submit').map(x => ({ name: x.getAttribute('name'), type: x.getAttribute('type') || x.tagName.toLowerCase(), value: x.getAttribute('value') || '' })) }));
      const tables = [...doc.querySelectorAll('table')].slice(0, 5).map(t => [...t.rows].slice(0, 20).map(r => [...r.cells].map(c => c.textContent.trim().slice(0, 60))));
      const body = doc.body || doc.documentElement;
      const md = toMd(body, base);
      const tdoc = new DOMParser().parseFromString(clean, 'text/html'); const tb = tdoc.body || tdoc.documentElement; tb.querySelectorAll('style,svg').forEach(n => n.remove());
      tb.querySelectorAll('p,div,li,h1,h2,h3,h4,tr,br,section,article').forEach(n => n.append('\n'));
      const text = (tb.textContent || '').replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n\n').trim().slice(0, TEXT_CAP);
      return { title: ((doc.querySelector('title') || doc.querySelector('h1') || {}).textContent || base).trim().slice(0, 120), text, md, links, forms, tables, html: clean };
    }
    function pushHistory(url, title) { const h = ctx.data.get('history', []).filter(x => x.url !== url); h.unshift({ url, title, t: Date.now() }); ctx.data.set('history', h.slice(0, 100)); }
    async function open(url, th, opts = {}) {
      const c = comp(th), t = tab(c); url = normUrl(url);
      if (privBlocked(url, th)) throw new Error('blocked: private/localhost address — needs the Full access tier');
      log(c, 'GET ' + url);
      let r; try { r = await fetchPage(url, opts); } catch (e) { t.tried = e.tried || []; t.via = 'failed'; log(c, '✗ ' + url); throw e; }
      const p = parse(r.body, url, r.plain);
      if (t.url && t.url !== url && !opts.noHistory) { t.history.push(t.url); if (t.history.length > 50) t.history.splice(0, t.history.length - 50); t.fwd = []; }
      Object.assign(t, { url, title: p.title, text: p.text, md: p.md, html: p.html, links: p.links, forms: p.forms, tables: p.tables, via: r.via, tried: r.tried, cached: !!r.cached });
      if (opts.mode) c.mode = opts.mode === 'reader' ? 'reader' : 'page';
      pushHistory(url, p.title);
      log(c, 'loaded via ' + r.via + (r.cached ? ' (cache)' : '') + ' · ' + p.links.length + ' links');
      return { url, title: p.title, via: r.via, tried: r.tried.map(x => x.route + (x.ok ? ' ✓' : ' ✗ ' + (x.why || ''))), links: p.links.length, forms: p.forms.length, tables: (p.tables || []).length, text: p.text.slice(0, 1500) };
    }
    async function fetchText(url, opts = {}) { url = normUrl(url); if (privBlocked(url, opts.thread)) throw new Error('blocked: private/localhost address — needs the Full access tier'); const r = await fetchPage(url, opts); const p = parse(r.body, url, r.plain); return { url, title: p.title, text: p.md || p.text, html: r.plain ? undefined : r.body, via: r.via, tried: r.tried }; }
    function sgrep(text, q, ctxN = 1) {
      const lines = String(text).split('\n'); const re = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'); const out = [];
      lines.forEach((l, i) => { if (re.test(l) && out.length < 20) out.push({ line: i + 1, text: lines.slice(Math.max(0, i - ctxN), i + ctxN + 1).join(' ⏎ ').slice(0, 300) }); });
      return out;
    }
    /* ---------- search: DDG via ladder, then Wikipedia + HN Algolia keyless fallbacks ---------- */
    async function search(q, th, signal) {
      const results = []; const tried = []; const seen = new Set(); const add = (x, source) => { if (!x.href || seen.has(x.href)) return; seen.add(x.href); results.push({ text: x.text, href: x.href, snippet: x.snippet || '', source }); };
      try {
        const r = await fetchPage('https://html.duckduckgo.com/html/?q=' + encodeURIComponent(q), { signal }); tried.push('duckduckgo via ' + r.via);
        if (r.plain) { parse(r.body, 'https://duckduckgo.com/', true).links.filter(l => !/duckduckgo\.com/.test(l.href)).slice(0, 10).forEach(l => add(l, 'duckduckgo')); }
        else { const doc = new DOMParser().parseFromString(r.body, 'text/html'); doc.querySelectorAll('.result, .web-result').forEach(el => { const a = el.querySelector('a.result__a') || el.querySelector('a[href]'); if (!a) return; let h = a.getAttribute('href') || ''; const m = h.match(/uddg=([^&]+)/); if (m) h = decodeURIComponent(m[1]); if (/^\/\//.test(h)) h = 'https:' + h; if (/^https?:/.test(h) && !/duckduckgo\.com/.test(h)) add({ text: a.textContent.trim(), href: h, snippet: ((el.querySelector('.result__snippet') || {}).textContent || '').trim() }, 'duckduckgo'); }); }
      } catch (e) { tried.push('duckduckgo ✗ ' + String(e.message).slice(0, 80)); }
      if (results.length < 3) {
        const [w, h] = await Promise.allSettled([
          getJSON('https://en.wikipedia.org/w/api.php?action=query&list=search&format=json&origin=*&srlimit=5&srsearch=' + encodeURIComponent(q), signal),
          getJSON('https://hn.algolia.com/api/v1/search?hitsPerPage=5&query=' + encodeURIComponent(q), signal)]);
        if (w.status === 'fulfilled') { tried.push('wikipedia ✓'); ((w.value.query || {}).search || []).forEach(x => add({ text: x.title, href: 'https://en.wikipedia.org/wiki/' + encodeURIComponent(x.title.replace(/ /g, '_')), snippet: String(x.snippet || '').replace(/<[^>]+>/g, '') }, 'wikipedia')); } else tried.push('wikipedia ✗ ' + w.reason.message);
        if (h.status === 'fulfilled') { tried.push('hn-algolia ✓'); (h.value.hits || []).forEach(x => add({ text: x.title || x.story_title || '(untitled)', href: x.url || 'https://news.ycombinator.com/item?id=' + x.objectID, snippet: (x.points || 0) + ' points · HN' }, 'hackernews')); } else tried.push('hn-algolia ✗ ' + h.reason.message);
      }
      const c = comp(th), t = tab(c); const url = 'about:search?q=' + encodeURIComponent(q);
      const html = '<html><head><title>Search: ' + esc(q) + '</title></head><body><h1>Search: ' + esc(q) + '</h1>' + (results.map(x => '<p><a href="' + esc(x.href) + '">' + esc(x.text) + '</a> <small>[' + x.source + ']</small><br><small>' + esc(x.snippet) + '</small></p>').join('') || '<p>No results — every search route failed (see the route badge).</p>') + '</body></html>';
      const p = parse(html, 'https://duckduckgo.com/', false);
      if (t.url && t.url !== url) { t.history.push(t.url); t.fwd = []; }
      Object.assign(t, { url, title: 'Search: ' + q, text: p.text, md: p.md, html: p.html, links: p.links, forms: [], tables: [], via: 'search', tried: tried.map(x => ({ route: x, ok: /✓|via/.test(x) })) });
      log(c, 'search “' + q + '” → ' + results.length + ' results'); ctx.emit('computer:change');
      return { engine: [...new Set(results.map(r => r.source))].join('+') || 'none', query: q, tried, results: results.slice(0, 12), error: results.length ? undefined : 'no search route worked' };
    }

    /* ---------- tools ---------- */
    const need = c => { if (!tab(c).url) throw new Error('No page open. Call computer_open first.'); return tab(c); };
    const REG = {};
    const T = (name, description, properties, required, run, gate = 'net') => { REG[name] = { run }; return ctx.tool({ name, description, gate, label: name.replace('_', ' '), parameters: { type: 'object', properties, required }, run, detail: a => ({ cmd: name + ' ' + (a.url || a.query || a.text || a.index || '') }) }); };
    T('computer_open', 'Open a URL in the thread\'s browser. Returns title, text excerpt, link/form counts, `via` (route used) and `tried` (each route attempted). mode: reader|page (UI view).', { url: { type: 'string' }, mode: { type: 'string', enum: ['reader', 'page'] } }, ['url'], (a, tc) => open(a.url, tc.thread, { signal: tc.signal, mode: a.mode }));
    T('computer_read', 'Read a page as clean markdown. With url: fetch it via the route ladder (selector = CSS selector applied locally). Without url: the current page (offset pages through text).', { url: { type: 'string' }, selector: { type: 'string' }, offset: { type: 'number' } }, [], async (a, tc) => {
      const o = a.offset || 0;
      if (!a.url && !a.selector) { const t = need(comp(tc.thread)); return { url: t.url, title: t.title, via: t.via, text: t.text.slice(o, o + 4000), markdown: (t.md || '').slice(o, o + 6000), more: t.text.length > o + 4000, tables: t.tables }; }
      let url, html, via, tried, plain;
      if (a.url) { url = normUrl(a.url); if (privBlocked(url, tc.thread)) return { error: 'blocked: private/localhost address needs the Full access tier' }; const r = await fetchPage(url, { signal: tc.signal }); html = r.body; via = r.via; tried = r.tried; plain = r.plain; }
      else { const t = need(comp(tc.thread)); url = t.url; html = t.html; via = t.via; }
      if (plain) return { url, via, markdown: String(html).slice(o, o + 8000), note: a.selector ? 'selector ignored: this route returned markdown, not HTML' : undefined };
      const doc = new DOMParser().parseFromString(String(html), 'text/html'); doc.querySelectorAll('script,style,noscript').forEach(n => n.remove());
      let nodes = [doc.body || doc.documentElement]; if (a.selector) { try { nodes = [...doc.querySelectorAll(a.selector)]; } catch (e) { return { error: 'bad selector: ' + e.message }; } if (!nodes.length) return { url, via, error: 'selector matched nothing' }; }
      const md = nodes.slice(0, 50).map(n => toMd(n, url)).join('\n\n---\n\n');
      return { url, via, tried: tried && tried.map(x => x.route + (x.ok ? ' ✓' : ' ✗')), title: ((doc.querySelector('title') || {}).textContent || '').trim(), markdown: md.slice(o, o + 8000), more: md.length > o + 8000 };
    }, 'net');
    T('computer_links', 'List links on the current page with indexes.', { filter: { type: 'string' } }, [], (a, tc) => { const t = need(comp(tc.thread)); const l = t.links.filter(x => !a.filter || (x.text + x.href).toLowerCase().includes(a.filter.toLowerCase())); return { count: l.length, links: l.slice(0, 60) }; }, 'none');
    T('computer_find', 'Grep the current page text and links (sgrep with context).', { query: { type: 'string' } }, ['query'], (a, tc) => { const t = need(comp(tc.thread)); return { matches: sgrep(t.text, a.query), links: t.links.filter(x => x.text.toLowerCase().includes(a.query.toLowerCase())).slice(0, 10) }; }, 'none');
    T('computer_click', 'Follow a link by index or by text.', { index: { type: 'number' }, text: { type: 'string' } }, [], (a, tc) => { const t = need(comp(tc.thread)); const l = a.index != null ? t.links[a.index] : t.links.find(x => x.text.toLowerCase().includes(String(a.text || '').toLowerCase())); if (!l) return { error: 'link not found' }; if (privBlocked(l.href, tc.thread)) return { error: 'blocked: link points to a private/localhost address; that needs the Full access tier' }; return open(l.href, tc.thread, { signal: tc.signal }); });
    T('computer_fill', 'Set form field values (stored until submit).', { form: { type: 'number' }, values: { type: 'object' } }, ['values'], (a, tc) => { const t = need(comp(tc.thread)); const f = t.forms[a.form || 0]; if (!f) return { error: 'no form' }; f.fields.forEach(x => { if (a.values[x.name] != null) x.value = String(a.values[x.name]); }); return { form: f }; }, 'none');
    T('computer_submit', 'Submit a form (GET via URL; POST only via gateway/bridge/direct, never public readers).', { form: { type: 'number' } }, [], (a, tc) => { const t = need(comp(tc.thread)); const f = t.forms[a.form || 0]; if (!f) return { error: 'no form' }; if (privBlocked(f.action, tc.thread)) return { error: 'blocked: form posts to a private/localhost address; that needs the Full access tier' }; const qs = new URLSearchParams(f.fields.map(x => [x.name, x.value])); if (f.method === 'GET') { const u = new URL(f.action); qs.forEach((v, k) => u.searchParams.set(k, v)); return open(u.href, tc.thread, { signal: tc.signal }); } return open(f.action, tc.thread, { signal: tc.signal, init: { method: 'POST', body: qs.toString(), headers: { 'Content-Type': 'application/x-www-form-urlencoded' } } }); });
    T('computer_back', 'Go back in history.', {}, [], (a, tc) => { const t = need(comp(tc.thread)); const u = t.history.pop(); if (!u) return { error: 'no history' }; t.fwd.push(t.url); return open(u, tc.thread, { noHistory: true, signal: tc.signal }); });
    T('computer_tabs', 'List/new/switch/close tabs.', { action: { type: 'string', enum: ['list', 'new', 'switch', 'close'] }, index: { type: 'number' } }, [], (a, tc) => { const c = comp(tc.thread); const act = a.action || 'list'; if (act === 'new') { c.tabs.push(newTab()); c.active = c.tabs.length - 1; } if (act === 'switch' && c.tabs[a.index]) c.active = a.index; if (act === 'close' && c.tabs.length > 1) { c.tabs.splice(a.index ?? c.active, 1); c.active = Math.min(c.active, c.tabs.length - 1); } ctx.emit('computer:change'); return { active: c.active, tabs: c.tabs.map((t, i) => ({ i, title: t.title, url: t.url })) }; }, 'none');
    T('computer_search', 'Search the web: DuckDuckGo HTML through the route ladder, then keyless Wikipedia + Hacker News (Algolia) fallbacks. Results carry a source label.', { query: { type: 'string' } }, ['query'], (a, tc) => search(a.query, tc.thread, tc.signal));
    const mshot = u => 'https://s0.wordpress.com/mshots/v1/' + encodeURIComponent(u) + '?w=1024';
    T('computer_screenshot', 'Screenshot a URL as an image URL (WordPress mShots; thum.io alternate). First request may return a "Generating preview" placeholder — the Browser view retries.', { url: { type: 'string' } }, [], (a, tc) => { const c = comp(tc.thread); const u = a.url ? normUrl(a.url) : need(c).url; if (!publicOk(u)) return { error: isPrivate(u) ? 'private/localhost pages cannot be screenshotted by a public service' : 'not sent to a screenshot service: public readers are turned off, or the URL looks like it carries a secret' }; c.shot = mshot(u); c.mode = 'shot'; log(c, 'screenshot ' + u); return { url: 'https://image.thum.io/get/width/1024/' + u, mshots: c.shot, page: u, note: 'third-party screenshot services see this URL' }; });
    const CLOUD = { steel: 'https://api.steel.dev/v1/sessions', hyperbrowser: 'https://app.hyperbrowser.ai/api/session', browserbase: 'https://api.browserbase.com/v1/sessions' };
    T('cloud_session_start', 'Start a cloud browser session (Steel/Hyperbrowser/Browserbase) — needs a saved key.', { provider: { type: 'string', enum: Object.keys(CLOUD) } }, ['provider'], async a => {
      const key = (ctx.data.get('cloudKeys', {}))[a.provider]; if (!key) return { error: 'No ' + a.provider + ' API key saved. Add one in Settings → Browser. Without it no cloud session can be started.' };
      try { const r = await fetch(CLOUD[a.provider], { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'X-BB-API-Key': key, 'steel-api-key': key }, body: '{}' }); const j = await r.json().catch(() => ({})); return r.ok ? { ok: true, session: j } : { error: 'HTTP ' + r.status, detail: j }; }
      catch (e) { return { error: e.message + ' (cloud browser APIs usually need the gateway when running from file://)' }; }
    });
    ctx.guardRule({ id: 'computer-private-net', check({ tool, detail, tier }) {
      if (!tool || !/^computer_|^cloud_session/.test(tool)) return; const s = (detail && detail.cmd) || '';
      const u = (s.split(' ')[1] || ''); if (u && /[./:]/.test(u) && isPrivate(/^[a-z]+:\/\//i.test(u) ? u : 'http://' + u) && !(tier && (tier.id === 'unrestricted' || tier.id === 'full'))) return { deny: 'private/localhost targets need Full access tier' };
    } });
    /* web_fetch (forge.devtools) benefits: when it fails, retry through this ladder and give the model the result */
    ctx.hook('afterTool', async p => {
      if (!p || p.name !== 'web_fetch' || !p.result || !p.result.error || !p.args || !p.args.url) return;
      try { const u = normUrl(p.args.url); if (isPrivate(u)) return; const r = await fetchText(u); return { result: { url: r.url, title: r.title, text: String(r.text).slice(0, 12000), via: r.via, note: 'web_fetch failed (' + String(p.result.error).slice(0, 120) + '); recovered via forge.computer route ' + r.via } }; } catch (_) { return; }
    });
    ctx.settings({ id: 'computer', title: 'Browser', render(el) {
      const keys = ctx.data.get('cloudKeys', {});
      el.innerHTML = `<div class="field"><label><input type="checkbox" class="cm-pub" ${usePublic() ? 'checked' : ''}> Use public readers/proxies</label><div class="hint">They see the URLs you open (r.jina.ai, allOrigins, cors.lol, codetabs, archive.org). Private/localhost URLs and URLs containing token=/key=/password= are never sent to them.</div></div>` + Object.keys(CLOUD).map(p => `<div class="field"><label>${p} API key</label><input class="inp" type="password" data-p="${p}" placeholder="${keys[p] ? 'saved ••••' : 'not set'}"></div>`).join('') + '<div class="hint">Cloud-browser keys are stored in plugin data on this device only.</div>';
      el.querySelector('.cm-pub').onchange = e => { ctx.data.set('publicReaders', !!e.target.checked); cache.clear(); };
      el.querySelectorAll('input[data-p]').forEach(i => i.onchange = () => { const k = ctx.data.get('cloudKeys', {}); k[i.dataset.p] = i.value.trim(); ctx.data.set('cloudKeys', k); i.value = ''; i.placeholder = 'saved ••••'; });
    } });

    /* ---------- view ---------- */
    DS.icons.monitor = DS.icons.monitor || '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/></svg>';
    ctx.effect(() => { const s = document.createElement('style'); s.textContent = `
.cm-bar{display:flex;gap:4px;padding:6px 12px;align-items:center}.cm-bar .inp{flex:1;min-width:0;height:38px}.cm-bar .icon-btn{min-width:34px;height:38px;font-size:17px}
.cm-row2{display:flex;gap:6px;align-items:center;padding:0 12px 6px;flex-wrap:wrap}.cm-row2 .seg{flex:1;min-width:0;display:flex}.cm-row2 .seg button{flex:1;min-height:34px;font-size:12px}
.cm-via{cursor:pointer;max-width:42vw;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.cm-tabs{display:flex;gap:6px;overflow-x:auto;padding:0 12px 6px}.cm-tabs .chip{white-space:nowrap;max-width:150px;overflow:hidden;text-overflow:ellipsis}
.cm-stage{flex:1;min-height:0;display:flex;flex-direction:column;padding:0 12px 10px;gap:8px;overflow:auto}
.cm-frame{flex:1;min-height:58vh;width:100%;border:1px solid var(--line);border-radius:var(--radius);background:#fff}
.cm-reader{font-size:14px;line-height:1.55;word-break:break-word;padding:12px}.cm-reader mark{background:var(--accent-soft);color:inherit;outline:1px solid var(--accent-line)}
.cm-find{display:flex;gap:6px}.cm-find .inp{flex:1;min-width:0}
.cm-links a{display:block;font-size:12px;padding:8px 0;border-bottom:1px solid var(--line);color:var(--accent);word-break:break-all;cursor:pointer}
.cm-log{font:11px var(--mono);color:var(--muted)}.cm-shot{max-width:100%;border-radius:var(--radius);border:1px solid var(--line)}.cm-err{color:var(--danger);font-size:13px;white-space:pre-wrap}.cm-err:empty{display:none}
.cm-note{font-size:12px;color:var(--muted)}.cm-tried li{font-size:13px;margin:4px 0}.cm-tried .ok{color:var(--ok)}.cm-tried .no{color:var(--danger)}.cm-tried .sk{color:var(--muted)}
.cm-empty{padding:24px 8px;text-align:center}`; document.head.appendChild(s); return () => s.remove(); });
    let viewEl = null; let navNonce = 'n' + Math.random().toString(36).slice(2);
    const NAVJS = n => `<script>(function(){var N=${JSON.stringify(n)};function P(m){m.__fnav=N;try{parent.postMessage(m,'*')}catch(e){}}
document.addEventListener('click',function(e){var a=e.target&&e.target.closest&&e.target.closest('a[href]');if(!a)return;var h=a.href;if(!/^https?:/i.test(h))return;e.preventDefault();var b=document.baseURI.split('#')[0];if(h.split('#')[0]===b&&h.indexOf('#')>0){var id=decodeURIComponent(h.split('#')[1]);var el=document.getElementById(id)||document.getElementsByName(id)[0];if(el)el.scrollIntoView();return;}P({href:h});},true);
document.addEventListener('submit',function(e){var f=e.target;e.preventDefault();var m=(f.getAttribute('method')||'get').toLowerCase();var u=new URL(f.getAttribute('action')||document.baseURI,document.baseURI);if(m!=='get'){P({post:u.href});return;}new FormData(f).forEach(function(v,k){if(typeof v==='string')u.searchParams.set(k,v)});P({href:u.href});},true);})();<\/script>`;
    function pageDoc(t) {
      const base = /^https?:/.test(t.url) ? t.url : 'about:blank';
      let h = String(t.html || ''); const head = '<base href="' + esc(base) + '"><meta name="referrer" content="no-referrer"><style>body{font-family:-apple-system,system-ui,sans-serif;max-width:100%;overflow-wrap:anywhere}img,video,table{max-width:100%;height:auto}</style>';
      h = /<head[^>]*>/i.test(h) ? h.replace(/<head[^>]*>/i, m => m + head) : head + h;
      return h + NAVJS(navNonce);
    }
    const onMsg = e => { const d = e.data; if (!d || d.__fnav !== navNonce || !viewEl) return; const f = viewEl.querySelector('.cm-frame'); if (!f || e.source !== f.contentWindow) return;
      if (d.href && /^https?:/i.test(d.href)) uiOpen(d.href, 'open'); else if (d.post) { const err = viewEl.querySelector('.cm-errbox'); if (err) err.textContent = 'POST forms are not submitted from Page mode (cookies/login do not exist here). Use computer_submit, or open in Safari.'; } };
    ctx.effect(() => { window.addEventListener('message', onMsg); return () => window.removeEventListener('message', onMsg); });
    async function uiOpen(u, how) {
      const c = comp(); const err = viewEl && viewEl.querySelector('.cm-errbox'); if (err) err.textContent = '';
      if (how !== 'search') { try { const n = normUrl(u); if (privBlocked(n, ctx.thread())) throw new Error('Blocked: private/localhost addresses need the Full access tier.'); } catch (e) { if (err) err.textContent = e.message; return; } }
      if (viewEl) viewEl.classList.add('cm-busy'); const vb = viewEl && viewEl.querySelector('.cm-via'); if (vb) vb.textContent = 'loading…';
      try { if (how === 'search') await runTool('computer_search', { query: u }); else await runTool('computer_open', { url: u, noHist: how === 'nohist' }); }
      catch (e) { log(c, '✗ ' + e.message); if (err) err.textContent = e.message; }
      if (viewEl) viewEl.classList.remove('cm-busy'); ctx.emit('computer:change');
    }
    async function runTool(name, args) { const t = REG[name]; return t.run(args, { thread: ctx.thread(), signal: undefined, log() {}, update() {} }); }
    function triedSheet(t) {
      const node = document.createElement('div');
      const why = { wikipedia: 'Wikipedia REST/action API (CORS origin=*)', hackernews: 'HN Firebase API', github: 'GitHub API / raw', npm: 'npm registry', direct: 'plain fetch — works only if the site sends CORS headers', gateway: 'your Gateway URL proxy', vercel: 'your Vercel backend /api/fetch', bridge: 'local bridge on this machine', jina: 'r.jina.ai reader (public; sees URL)', allorigins: 'allOrigins /raw (public; sees URL)', 'cors.lol': 'cors.lol (public, unverified)', codetabs: 'codetabs proxy (public, unverified)', 'jsonp-sandbox': 'allOrigins JSONP run inside a sandboxed iframe', wayback: 'Internet Archive snapshot', public: 'public readers' };
      node.innerHTML = '<p class="sm">Route used: <b>' + esc(t.via || '—') + '</b>' + (t.cached ? ' (from 10-min cache)' : '') + '</p><ol class="cm-tried">' + (t.tried || []).map(x => '<li><span class="' + (x.ok ? 'ok' : x.skipped ? 'sk' : 'no') + '">' + (x.ok ? '✓' : x.skipped ? '–' : '✗') + '</span> <b>' + esc(x.route) + '</b> <span class="muted xs">' + esc(why[x.route] || '') + '</span>' + (x.why ? '<div class="xs muted">' + esc(x.why) + '</div>' : '') + '</li>').join('') + '</ol><p class="xs muted">From file:// the browser enforces CORS; nothing here bypasses it. Routes are tried in order until one returns the page.</p>';
      DS.ui.sheet({ title: 'How this page was loaded', node });
    }
    function listSheet(kind) {
      const items = ctx.data.get(kind, []); const node = document.createElement('div');
      node.innerHTML = items.length ? items.map((x, i) => '<div class="li" data-i="' + i + '" style="cursor:pointer"><div class="info"><div class="nm">' + esc(x.title || x.url) + '</div><div class="ds xs">' + esc(x.url) + '</div></div></div>').join('') : '<div class="muted sm">Nothing yet.</div>';
      let close = null; node.onclick = e => { const r = e.target.closest('[data-i]'); if (!r) return; const x = items[+r.dataset.i]; if (close) close(); uiOpen(x.url, /^about:search/.test(x.url) ? 'search' : 'open'); };
      const s = DS.ui.sheet({ title: kind === 'bookmarks' ? 'Bookmarks' : 'History', node, actions: [{ label: 'Clear', danger: true, onClick: c => { ctx.data.set(kind, []); c(); } }] }); close = s && s.close ? s.close : null;
    }
    ctx.view({ id: 'computer', title: 'Browser', icon: 'monitor', order: 88,
      mount(el) {
        viewEl = el;
        el.innerHTML = '<div class="vhead"><h2>Browser</h2><span class="grow"></span><button class="chip cm-via" title="How was this loaded?"></button></div>' +
          '<div class="cm-bar"><button class="icon-btn cm-back" title="Back">‹</button><button class="icon-btn cm-fwd" title="Forward">›</button><button class="icon-btn cm-reload" title="Reload">↻</button><input class="inp cm-url" placeholder="URL or search…" inputmode="url" autocapitalize="off" autocorrect="off"><button class="btn sm pri cm-go">Go</button></div>' +
          '<div class="cm-row2"><div class="seg cm-modes"><button data-m="page">Page</button><button data-m="reader">Reader</button><button data-m="shot">Shot</button><button data-m="live">Live</button></div><button class="icon-btn cm-star" title="Bookmark">☆</button><button class="icon-btn cm-menu" title="Bookmarks & history">≡</button></div>' +
          '<div class="cm-tabs"></div><div class="cm-stage"><div class="cm-errbox cm-err"></div><div class="cm-body"></div></div>';
        const $ = s => el.querySelector(s); let shown = '';
        const draw = () => {
          const c = comp(), t = tab(c);
          $('.cm-url').value = document.activeElement === $('.cm-url') ? $('.cm-url').value : (/^about:search/.test(t.url) ? decodeURIComponent(t.url.split('q=')[1] || '') : t.url);
          $('.cm-via').textContent = t.via ? 'via ' + t.via + (t.cached ? ' ·cache' : '') : 'routes';
          $('.cm-back').disabled = !t.history.length; $('.cm-fwd').disabled = !t.fwd.length;
          $('.cm-star').textContent = ctx.data.get('bookmarks', []).some(b => b.url === t.url) ? '★' : '☆';
          el.querySelectorAll('.cm-modes button').forEach(b => b.classList.toggle('on', b.dataset.m === c.mode));
          $('.cm-tabs').innerHTML = c.tabs.map((x, i) => `<button class="chip${i === c.active ? ' acc' : ''}" data-i="${i}">${esc(x.title || 'New tab')}</button>`).join('') + '<button class="chip" data-new="1">＋</button>' + (c.tabs.length > 1 ? '<button class="chip" data-close="1">✕</button>' : '');
          const key = c.mode + '|' + c.active + '|' + t.url + '|' + t.via + '|' + (c.mode === 'shot' ? c.shot : '');
          if (key === shown) return; shown = key;
          const body = $('.cm-body'); body.innerHTML = '';
          if (!t.url) { body.innerHTML = '<div class="cm-empty muted">Type a URL or a search.<br><span class="xs">Wikipedia, Hacker News, GitHub and npm load through their own keyless APIs; other sites try direct → gateway → bridge → public readers → sandboxed JSONP → Wayback.</span></div><div class="sec-t">Activity</div><div class="cm-log">' + c.log.slice(0, 12).map(l => esc(new Date(l.t).toLocaleTimeString() + '  ' + l.m)).join('<br>') + '</div>'; return; }
          if (c.mode === 'page') {
            const f = DS.util.sandboxFrame(pageDoc(t), { sandbox: 'allow-scripts allow-forms' }); f.className = 'cm-frame'; f.style.cssText = ''; f.title = t.title; body.appendChild(f);
            body.insertAdjacentHTML('beforeend', '<div class="cm-note">Static re-render: page scripts removed, links & GET forms navigate here. <a href="' + esc(t.url) + '" target="_blank" rel="noopener noreferrer">Open in Safari ↗</a></div>');
          } else if (c.mode === 'reader') {
            body.innerHTML = '<div class="cm-find"><input class="inp cm-q" placeholder="Find in page…"><span class="muted xs cm-qn"></span></div><div class="card cm-reader"></div>';
            const rd = body.querySelector('.cm-reader'); const md = '# ' + t.title + '\n\n' + (t.md || t.text);
            try { DS.render.into(rd, md.slice(0, 60000)); } catch (_) { rd.textContent = md; }
            rd.addEventListener('click', e => { const a = e.target.closest('a[href]'); if (!a) return; e.preventDefault(); const h = a.getAttribute('href'); if (/^https?:/.test(h)) uiOpen(h, 'open'); });
            const q = body.querySelector('.cm-q'); q.oninput = DS.util.debounce ? DS.util.debounce(() => find(rd, q.value, body.querySelector('.cm-qn')), 150) : () => find(rd, q.value, body.querySelector('.cm-qn'));
          } else if (c.mode === 'shot') {
            const src = c.shot && c.shot.includes(encodeURIComponent(t.url)) ? c.shot : (c.shot = mshot(t.url));
            if (!publicOk(t.url)) { body.innerHTML = '<div class="muted">' + (isPrivate(t.url) ? 'Private/localhost pages cannot be screenshotted by a public service.' : 'Not sent to a screenshot service: public readers are off (Settings → Browser) or the URL looks like it carries a secret.') + '</div>'; return; }
            body.innerHTML = '<div class="cm-note">Screenshot by WordPress mShots (a third party; it sees this URL). First load is often a "Generating preview" placeholder — retrying automatically.</div><img class="cm-shot" alt="screenshot of ' + esc(t.url) + '">';
            const img = body.querySelector('img'); let n = 0;
            img.onload = () => { if (img.naturalWidth && img.naturalWidth < 900 && n < 6) { n++; ctx.setTimeout(() => { if (img.isConnected) img.src = src + '&_=' + Date.now(); }, 3500); } };
            img.onerror = () => { if (!img.dataset.alt) { img.dataset.alt = 1; img.src = 'https://image.thum.io/get/width/1024/' + t.url; } else img.replaceWith(Object.assign(document.createElement('div'), { className: 'muted', textContent: 'Screenshot services unreachable (offline?).' })); };
            img.src = src;
          } else {
            body.innerHTML = '<div class="cm-note">Live = the real site in a frame. Most sites forbid framing (X-Frame-Options/CSP) and will show blank or an error; nothing can override that. <a href="' + esc(t.url) + '" target="_blank" rel="noopener noreferrer">Open in Safari ↗</a></div>';
            const f = document.createElement('iframe'); f.className = 'cm-frame'; let sameOrigin = true; try { sameOrigin = new URL(t.url).origin === location.origin; } catch (_) {} f.setAttribute('sandbox', sameOrigin ? 'allow-scripts allow-forms allow-popups' : 'allow-scripts allow-same-origin allow-forms allow-popups'); /* a page on Forge's own origin must never get same-origin access to Forge */ f.setAttribute('referrerpolicy', 'no-referrer'); f.src = /^https?:/.test(t.url) ? t.url : 'about:blank'; body.appendChild(f);
          }
          body.insertAdjacentHTML('beforeend', '<details><summary class="sec-t">Links (' + t.links.length + ')</summary><div class="cm-links">' + t.links.slice(0, 80).map(l => `<a data-h="${esc(l.href)}">[${l.i}] ${esc(l.text)}</a>`).join('') + '</div></details><details><summary class="sec-t">Activity</summary><div class="cm-log">' + c.log.slice(0, 20).map(l => esc(new Date(l.t).toLocaleTimeString() + '  ' + l.m)).join('<br>') + '</div></details>');
        };
        function find(rd, q, cnt) {
          rd.querySelectorAll('mark.cm-hit').forEach(m => m.replaceWith(document.createTextNode(m.textContent))); rd.normalize();
          if (!q || q.length < 2) { cnt.textContent = ''; return; }
          const re = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'); const w = document.createTreeWalker(rd, NodeFilter.SHOW_TEXT); const nodes = []; while (w.nextNode()) nodes.push(w.currentNode); let k = 0;
          nodes.forEach(n => { const s = n.nodeValue; if (!re.test(s)) return; re.lastIndex = 0; const frag = document.createDocumentFragment(); let last = 0; s.replace(re, (m, i) => { frag.append(s.slice(last, i)); const mk = document.createElement('mark'); mk.className = 'cm-hit'; mk.textContent = m; frag.append(mk); last = i + m.length; k++; return m; }); frag.append(s.slice(last)); n.replaceWith(frag); });
          cnt.textContent = k ? k + ' found' : 'none'; const first = rd.querySelector('mark.cm-hit'); if (first) first.scrollIntoView({ block: 'center' });
        }
        const go = () => { const v = $('.cm-url').value.trim(); if (!v) return; $('.cm-url').blur(); uiOpen(v, /\s/.test(v) || !/\.|^[a-z]+:\/\//i.test(v) ? 'search' : 'open'); };
        $('.cm-go').onclick = go; $('.cm-url').onkeydown = e => { if (e.key === 'Enter') go(); };
        $('.cm-back').onclick = () => runTool('computer_back', {}).then(draw, e => log(comp(), '✗ ' + e.message));
        $('.cm-fwd').onclick = () => { const t = tab(comp()); const u = t.fwd.pop(); if (!u) return; t.history.push(t.url); open(u, null, { noHistory: true }).then(draw, e => { const er = $('.cm-errbox'); er.textContent = e.message; }); };
        $('.cm-reload').onclick = () => { const t = tab(comp()); if (!t.url) return; if (/^about:search/.test(t.url)) return uiOpen(decodeURIComponent(t.url.split('q=')[1] || ''), 'search'); cache.delete(t.url); shown = ''; open(t.url, null, { noHistory: true, fresh: true }).then(draw, e => { $('.cm-errbox').textContent = e.message; draw(); }); };
        $('.cm-via').onclick = () => triedSheet(tab(comp()));
        $('.cm-modes').onclick = e => { const b = e.target.closest('button[data-m]'); if (!b) return; const c = comp(); c.mode = b.dataset.m; ctx.data.set('mode', c.mode === 'shot' || c.mode === 'live' ? ctx.data.get('mode', 'page') : c.mode); draw(); };
        $('.cm-star').onclick = () => { const t = tab(comp()); if (!t.url) return; let b = ctx.data.get('bookmarks', []); if (b.some(x => x.url === t.url)) b = b.filter(x => x.url !== t.url); else b.unshift({ url: t.url, title: t.title, t: Date.now() }); ctx.data.set('bookmarks', b.slice(0, 200)); draw(); };
        $('.cm-menu').onclick = () => DS.ui.menu([{ label: '★ Bookmarks', onClick: () => listSheet('bookmarks') }, { label: '🕘 History', onClick: () => listSheet('history') }, { label: '⚙︎ Routes & privacy…', onClick: () => triedSheet(tab(comp())) }], 'Browser');
        $('.cm-tabs').onclick = e => { const b = e.target.closest('button'); if (!b) return; runTool('computer_tabs', b.dataset.new ? { action: 'new' } : b.dataset.close ? { action: 'close' } : { action: 'switch', index: +b.dataset.i }); draw(); };
        $('.cm-stage').addEventListener('click', e => { const a = e.target.closest('.cm-links a[data-h]'); if (a) uiOpen(a.dataset.h, 'open'); });
        const off = ctx.on('computer:change', draw);
        draw(); return () => { viewEl = null; if (typeof off === 'function') off(); };
      } });
    ctx.on('thread:removed', id => { delete comps[id]; });
    const show = () => DS.shell.show('computer');
    ctx.provide('forge.computer', { open: show, openUrl: (u, mode) => open(u, null, { mode }), state: () => comp(), fetchText, search: q => search(q), routes: () => ['adapters(wikipedia,hackernews,github,npm)', 'direct', 'gateway', 'vercel', 'bridge', 'jina', 'allorigins', 'cors.lol', 'codetabs', 'jsonp-sandbox', 'wayback'] });
    if (ctx.rail) ctx.rail({ id: 'computer', icon: 'monitor', label: 'Browser', group: 'top', order: 47, run: show, active: () => DS.shell.current === 'computer' });
    ctx.command({ name: 'browse', args: '<url|query>', desc: 'Open the in-harness browser', run: (t) => { show(); if (t.trim()) uiOpen(t.trim(), /\s/.test(t.trim()) || !/\./.test(t.trim()) ? 'search' : 'open'); } });
    // ---- Sim intents
    const URLRE = /\b((?:https?:\/\/)?[a-z0-9-]+(?:\.[a-z0-9-]+)+(?:\/\S*)?)/i;
    const fail = r => r && r.error ? '⚠️ ' + r.error : null;
    ctx.intent({ id: 'computer-open', order: 50, match: t => /^(open|browse|visit|go to)\s/i.test(t.trim()) && URLRE.test(t),
      script: t => [{ say: 'Opening it in the browser.', tool: { name: 'computer_open', args: { url: t.match(URLRE)[1] } } }, { final: r => fail(r[0]) || '**' + r[0].title + '** (via ' + r[0].via + ', ' + r[0].links + ' links)\n\n' + String(r[0].text || '').slice(0, 600) }] });
    ctx.intent({ id: 'computer-search', order: 50, match: t => /search the web for|web search|look up online/i.test(t),
      script: t => [{ say: 'Searching the web.', tool: { name: 'computer_search', args: { query: t.replace(/.*(search the web for|web search|look up online)\s*/i, '') } } }, { final: r => fail(r[0]) || 'Top results (' + r[0].engine + '):\n' + (r[0].results || []).map(l => '- [' + l.text + '](' + l.href + ') · ' + l.source).join('\n') }] });
    ctx.suggest({ id: 'computer', emoji: '🌐', title: 'Browse the web', sub: 'In-harness browser', prompt: 'open en.wikipedia.org/wiki/Web_browser' });
  }
});
