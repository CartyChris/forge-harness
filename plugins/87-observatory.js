/* forge.observatory — live, visual AI-agent observability: swimlane timeline (main + subagents), parsed reasoning,
   web searches / fetched pages / domains, "agent's eye" (the app or game the agent is building, running live, with
   canvas filmstrip, wireframe, FPS/animation/blank detection and console), what the model saw (context window),
   tool-flow graph, metrics, event log, replay scrubber, live HUD, export, and an app_inspect tool so agents can
   see their own apps. Read-only observer: it never changes what agents do. */
DS.plugin({
  name: 'forge.observatory', title: 'Observatory', version: '1.0.0', tags: ['observability', 'visual', 'live'],
  description: 'Watch agents live: timeline of every model call and tool (subagents in their own lanes), parsed reasoning, searches and fetched pages, the app/game being built running live with frames and console, the exact context the model saw, a tool-flow graph, metrics, replay and export.',
  apply(ctx) {
    const U = DS.util, esc = U.esc;
    const wall = () => Date.now();
    const MAX_RUNS = 30, MAX_EV = 2500, MAX_FRAMES = 24;
    const runs = new Map();            /* runId → run */
    const cur = new Map();             /* threadId → runId (running) */
    let seq = 0, selected = null, cutoff = Infinity, tab = ctx.data.get('tab', 'overview');

    /* ---------- helpers ---------- */
    const clip = (s, n) => { s = s == null ? '' : String(s); return s.length > n ? s.slice(0, n) + '…' : s; };
    const redact = s => { try { const sh = DS.service('forge.shield'); if (sh && sh.scan) { const h = sh.scan(s); if (h.length) return sh.redact(s, h); } } catch (_) {} return s; };
    const safe = (s, n) => redact(clip(s, n || 600));
    const host = u => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch (_) { return String(u || '').replace(/^https?:\/\//, '').split('/')[0]; } };
    const hue = s => { let h = 0; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h % 360; };
    const fmtMs = ms => ms < 1000 ? Math.round(ms) + 'ms' : ms < 60000 ? (ms / 1000).toFixed(1) + 's' : Math.floor(ms / 60000) + 'm' + String(Math.round(ms / 1000) % 60).padStart(2, '0') + 's';
    const tok = n => n >= 1000 ? (n / 1000).toFixed(n >= 10000 ? 0 : 1) + 'k' : String(Math.round(n));
    const estTok = v => Math.ceil((typeof v === 'string' ? v.length : JSON.stringify(v || '').length) / 4);
    const CAT = n => /^(web_|computer_|cloud_fetch|browse|gh_)/.test(n) ? 'web' : /^fs_/.test(n) ? 'fs' : /^app_|genart|generate_|render_video/.test(n) ? 'app' : /spawn_subagent|agents_|delegate|council/.test(n) ? 'agents' : /brain_|memory_|past_|remember|recall/.test(n) ? 'memory' : /shell_run|run_js|run_py/.test(n) ? 'code' : 'other';
    const COL = { model: 'var(--violet)', web: '#4aa3ff', fs: '#3fb950', app: '#ff9f43', agents: '#ff6bcb', memory: '#2dd4bf', code: '#e3b341', other: 'var(--muted)', error: 'var(--danger)', approval: 'var(--warn)' };
    const visible = () => !document.hidden && DS.shell && DS.shell.current === 'observe';

    function newRun(thread, text) {
      const run = { id: 'r' + (++seq), threadId: thread.id, title: clip(thread.title || text || 'run', 60), task: clip(text || '', 300), parentId: thread.parentId || null, role: thread.agentRole || '',
        t0: wall(), t1: null, status: 'running', events: [], spans: [], steps: 0, tools: 0, errors: 0, tokIn: 0, tokOut: 0, files: new Map(), sites: new Map(), searches: [], pages: [], thoughts: [], says: '',
        eye: null, frames: [], console: [], ctx: null, cur: { label: 'starting…', since: wall(), cat: 'model' }, seen: {}, mindBuf: '', open: new Map(), trans: {}, lastTool: 'agent' };
      runs.set(run.id, run); cur.set(thread.id, run.id);
      if (runs.size > MAX_RUNS) { const old = [...runs.values()].find(r => r.status !== 'running'); if (old) runs.delete(old.id); }
      if (!selected || !runs.get(selected) || (runs.get(selected).status !== 'running' && !run.parentId)) selected = run.id;
      return run;
    }
    const runOf = thread => thread && runs.get(cur.get(thread.id));
    function ev(run, k, d) { const e = Object.assign({ t: wall(), k }, d || {}); run.events.push(e); if (run.events.length > MAX_EV) run.events.splice(0, run.events.length - MAX_EV); dirty(); return e; }
    function openSpan(run, key, kind, label, cat) { const sp = { key, kind, label, cat, t0: wall(), t1: null, status: 'running' }; run.spans.push(sp); run.open.set(key, sp); if (run.spans.length > 600) run.spans.splice(0, run.spans.length - 600); return sp; }
    function closeSpan(run, key, status, extra) { const sp = run.open.get(key); if (!sp) return null; sp.t1 = wall(); sp.status = status || 'ok'; Object.assign(sp, extra || {}); run.open.delete(key); return sp; }

    /* ---------- reasoning parser: sentences → tagged thoughts ---------- */
    const TAGS = [
      ['plan', /^(\d+[.)]|[-*•]|first|then|next|finally|step \d+|plan:)/i],
      ['decision', /\b(so i|therefore|decid|i('| a)?ll go with|best (option|approach)|choose|chose|instead)\b/i],
      ['intent', /\b(i('| a)?ll|i will|let me|i('| a)?m going to|i need to|i should|we need to|going to)\b/i],
      ['question', /\?\s*$/],
      ['doubt', /\b(maybe|perhaps|not sure|unclear|might|possibly|could be|i wonder|hmm)\b/i],
      ['observation', /\b(the (result|page|search|file|error|output)|it (says|shows|returned)|found|looks like|seems)\b/i]
    ];
    function tagOf(s) { for (const [t, re] of TAGS) if (re.test(s)) return t; return 'note'; }
    function feedMind(run, delta, src) {
      run.mindBuf += delta;
      const parts = run.mindBuf.split(/(?<=[.!?])\s+|\n+/);
      run.mindBuf = parts.pop() || '';
      for (const p of parts) { const s = p.replace(/^[#>\s]+/, '').trim(); if (s.length < 3) continue; run.thoughts.push({ t: wall(), text: safe(s, 400), tag: tagOf(s), step: run.steps, src }); }
      if (run.thoughts.length > 600) run.thoughts.splice(0, run.thoughts.length - 600);
    }
    function flushMind(run) { if (run.mindBuf.trim().length > 2) { const s = run.mindBuf.trim(); run.thoughts.push({ t: wall(), text: safe(s, 400), tag: tagOf(s), step: run.steps, src: 'reasoning' }); } run.mindBuf = ''; }

    /* ---------- capture ---------- */
    ctx.hook('run:start', ({ thread, text }) => { const run = newRun(thread, text); ev(run, 'run', { text: safe(text, 300), parent: run.parentId, role: run.role }); }, { order: 2 });
    ctx.hook('beforeModel', pre => {
      const run = runOf(pre.thread); if (!run) return;
      run.steps++;
      const msgs = pre.messages || [], parts = { system: 0, user: 0, assistant: 0, tool: 0 };
      for (const m of msgs) parts[m.role in parts ? m.role : 'user'] += estTok(m.content || '') + (m.tool_calls ? estTok(m.tool_calls) : 0);
      const toolsTok = estTok((pre.tools || []).map(t => ({ n: t.name, d: t.description, p: t.parameters })));
      let prov = ''; try { prov = DS.providers.pick(pre.thread).id; } catch (_) {}
      run.ctx = { t: wall(), step: run.steps, provider: prov, model: pre.model || '', parts, toolsTok, total: parts.system + parts.user + parts.assistant + parts.tool + toolsTok,
        tools: (pre.tools || []).map(t => t.name), messages: msgs.slice(-40).map(m => ({ role: m.role, tok: estTok(m.content || '') + (m.tool_calls ? estTok(m.tool_calls) : 0), text: safe(typeof m.content === 'string' ? m.content : JSON.stringify(m.content || ''), 220), calls: m.tool_calls ? m.tool_calls.map(c => c.function && c.function.name).join(', ') : '' })),
        system: safe((msgs.find(m => m.role === 'system') || {}).content || '', 6000) };
      run.tokIn += run.ctx.total;
      openSpan(run, 'm' + run.steps, 'model', 'step ' + run.steps + ' · ' + (pre.model || prov), 'model');
      run.cur = { label: 'thinking · step ' + run.steps, since: wall(), cat: 'model' };
      ev(run, 'model', { step: run.steps, provider: prov, model: pre.model || '', ctx: run.ctx.total, tools: run.ctx.tools.length });
    }, { order: 99 });
    ctx.hook('afterModel', ({ res, thread }) => {
      const run = runOf(thread); if (!run) return;
      flushMind(run);
      const calls = (res && res.toolCalls || []).map(c => c.name);
      const out = res && res.usage && (res.usage.completion_tokens || res.usage.output_tokens) || estTok((res && res.content) || '') + estTok(calls);
      run.tokOut += out;
      const sp = closeSpan(run, 'm' + run.steps, 'ok', { calls }); ev(run, 'model_end', { step: run.steps, ms: sp ? sp.t1 - sp.t0 : 0, calls, out });
    }, { order: 99 });
    ctx.on('msg:update', ({ thread, msg }) => {
      const run = runOf(thread); if (!run || !msg || msg.role !== 'assistant') return;
      const seen = run.seen[msg.id] || (run.seen[msg.id] = { r: 0, x: 0 });
      /* O(new text) per update: sum part lengths, then slice only the tail that is new (no full-string rebuild per delta) */
      const tail = (type, seenLen) => { const ps = (msg.parts || []).filter(p => p.type === type); let total = 0; for (const p of ps) total += (p.text || '').length; if (total <= seenLen) return { total, d: '' };
        let need = total - seenLen, out = ''; for (let i = ps.length - 1; i >= 0 && need > 0; i--) { const t = ps[i].text || ''; const take = Math.min(need, t.length); out = t.slice(t.length - take) + out; need -= take; } return { total, d: out }; };
      const R = tail('reasoning', seen.r), X = tail('text', seen.x);
      /* tool calls that fail before afterTool (validation, guard denial) — close their span and count the error */
      for (const p of msg.parts || []) if (p.type === 'tool' && (p.status === 'err' || p.status === 'denied') && !(run.seen['p:' + p.id])) {
        run.seen['p:' + p.id] = 1; const key = run.open.get('last:' + p.name);
        if (key && run.open.has(key)) { run.open.delete('last:' + p.name); run.errors++; closeSpan(run, key, 'err'); ev(run, 'tool_end', { name: p.name, cat: CAT(p.name), ms: 0, status: 'err', summary: safe(p.summary || (p.result && p.result.error) || p.status, 200) }); if (run.cur.tool === p.name) run.cur = { label: 'thinking · step ' + run.steps, since: wall(), cat: 'model' }; }
      }
      if (R.d) { feedMind(run, R.d, 'reasoning'); seen.r = R.total; if (run.cur.cat === 'model') run.cur.label = 'reasoning · step ' + run.steps; dirty(); }
      if (X.d) { const d = X.d; seen.x = X.total; run.says = clip(run.says.length < 4000 ? run.says + d : run.says, 4000); if (!R.total) feedMind(run, d, 'answer'); if (run.cur.cat === 'model') run.cur.label = 'writing · step ' + run.steps; dirty(); }
    });
    ctx.hook('beforeTool', ({ name, args, thread }) => {
      const run = runOf(thread); if (!run) return;
      run.tools++; const cat = CAT(name);
      const key = 't' + run.tools; run.open.set('last:' + name, key);
      openSpan(run, key, 'tool', name, cat);
      run.trans[run.lastTool + '>' + name] = (run.trans[run.lastTool + '>' + name] || 0) + 1; run.lastTool = name;
      const label = name === 'web_search' || name === 'computer_search' ? 'searching “' + clip(args && args.query, 50) + '”' : /fetch|open|browse/.test(name) && args && args.url ? 'reading ' + host(args.url) : /^fs_|app_create/.test(name) && args ? 'writing ' + clip(args.path || ('/apps/' + (args.name || '')), 48) : name;
      run.cur = { label, since: wall(), cat, tool: name };
      ev(run, 'tool', { name, cat, args: safe(JSON.stringify(args || {}), 400) });
    }, { order: 99 });
    ctx.hook('afterTool', ({ name, args, result, thread, part }) => {
      const run = runOf(thread); if (!run) return;
      const key = run.open.get('last:' + name); run.open.delete('last:' + name);
      if (part && run.seen['p:' + part.id]) return;
      if (part) run.seen['p:' + part.id] = 1;
      const err = (part && (part.status === 'err' || part.status === 'denied')) || (result && result.error);
      if (err) run.errors++;
      const sp = key ? closeSpan(run, key, err ? 'err' : 'ok') : null;
      const t = wall(); const a = args || {};
      try {
        if (name === 'web_search' && Array.isArray(result)) run.searches.push({ t, q: clip(a.query, 160), engine: 'web', results: result.slice(0, 10).map(x => ({ title: safe(x.title, 140), url: String(x.url || ''), snippet: safe(x.snippet, 220) })) });
        else if (name === 'computer_search' && result && Array.isArray(result.results)) run.searches.push({ t, q: clip(a.query, 160), engine: result.engine || 'browser', results: result.results.slice(0, 10).map(x => ({ title: safe(x.text, 140), url: String(x.href || ''), snippet: safe(x.source, 120) })) });
        else if ((name === 'web_search' || name === 'computer_search') && result && result.error) run.searches.push({ t, q: clip(a.query, 160), engine: 'web', error: safe(result.error, 200), results: [] });
        if (/^(web_fetch|computer_open|cloud_fetch)$/.test(name)) {
          const url = (result && (result.url || result.finalUrl)) || a.url || '';
          const text = result && (result.text || result.content || result.body) || '';
          run.pages.push({ t, url: String(url), host: host(url), title: safe((result && result.title) || url, 160), status: result && result.status, via: result && result.via, chars: String(text).length, links: Array.isArray(result && result.links) ? result.links.length : (result && result.links) || (String(text).match(/\]\(http/g) || []).length, text: safe(text, 2400), error: result && result.error ? safe(result.error, 200) : '' });
          if (url) { const h = host(url); run.sites.set(h, (run.sites.get(h) || 0) + 1); }
        }
        if (name === 'web_search' && Array.isArray(result)) for (const x of result.slice(0, 10)) { const h = host(x.url); if (h) run.sites.set(h, run.sites.get(h) || 0); }
        if (/^(fs_write|fs_edit|fs_copy|fs_move|app_create)$/.test(name) && !err) {
          const paths = name === 'app_create' && result && Array.isArray(result.files) ? result.files : [a.path || a.to || (result && result.path)].filter(Boolean);
          for (const p of paths) { const pth = typeof p === 'string' ? p : p.path; if (!pth) continue; const f = run.files.get(pth) || { writes: 0, bytes: 0, t0: t }; f.writes++; f.t = t; f.bytes = String(a.content || a.html || (p && p.content) || '').length || f.bytes; run.files.set(pth, f); }
          const entry = name === 'app_create' && result ? result.entry : (/\.html?$/i.test(a.path || '') ? a.path : null);
          if (entry) eyeLoad(run, DS.fs.norm(entry), 'write');
        }
        if (name === 'app_preview' && result && result.path) eyeLoad(run, result.path, 'preview');
        if (name === 'spawn_subagent') ev(run, 'spawn', { role: a.role || '', task: safe(a.task || '', 200) });
      } catch (e) { console.warn('[observatory]', e); }
      ev(run, 'tool_end', { name, cat: CAT(name), ms: sp ? sp.t1 - sp.t0 : 0, status: err ? 'err' : 'ok', summary: safe((part && part.summary) || (result && result.error) || '', 200) });
      if (run.cur.tool === name) run.cur = { label: 'thinking · step ' + run.steps, since: wall(), cat: 'model' };
    }, { order: 99 });
    /* Claude-in-artifact: which tier/effort it picked for this step, and why */
    ctx.on('claude:route', d => { const run = d && runs.get(cur.get(d.threadId)); if (!run) return; const sp = run.open.get('m' + run.steps); const tag = d.tier + (d.effort ? '·' + d.effort : ''); if (sp) sp.label = 'step ' + run.steps + ' · claude ' + tag; run.cur = { label: 'thinking · step ' + run.steps + ' · claude ' + tag, since: wall(), cat: 'model' }; ev(run, 'route', { tier: d.tier, effort: d.effort, why: d.why }); });
    ctx.on('approval:open', req => { const run = req && runOf(req.thread) || runs.get(selected); if (run) { openSpan(run, 'appr', 'approval', 'waiting for you: ' + ((req && req.tool) || ''), 'approval'); run.cur = { label: 'waiting for your approval · ' + ((req && req.tool) || ''), since: wall(), cat: 'approval' }; ev(run, 'approval', { tool: req && req.tool, action: req && req.action }); } });
    ctx.on('approval:result', r => { for (const run of runs.values()) if (run.open.has('appr')) { closeSpan(run, 'appr', r && r.allowed ? 'ok' : 'err'); ev(run, 'approval_end', { tool: r && r.tool, allowed: !!(r && r.allowed) }); } });
    ctx.hook('run:end', ({ thread, msg }) => {
      const run = runOf(thread); if (!run) return;
      flushMind(run); run.t1 = wall();
      run.status = msg && msg.meta && msg.meta.error ? 'error' : msg && msg.meta && msg.meta.aborted ? 'stopped' : 'done';
      for (const k of [...run.open.keys()]) if (!k.startsWith('last:')) closeSpan(run, k, run.status === 'done' ? 'ok' : 'err');
      run.cur = { label: run.status, since: wall(), cat: run.status === 'done' ? 'fs' : 'error' };
      ev(run, 'run_end', { status: run.status, ms: run.t1 - run.t0, error: msg && msg.meta && msg.meta.error ? safe(msg.meta.error, 300) : '' });
      cur.delete(thread.id); hud();
    }, { order: 99 });

    /* ---------- agent's eye: run the app the agent is building, watch it ---------- */
    const NONCE = 'eye' + Math.random().toString(36).slice(2);
    const PROBE = '<script>(function(){var N="' + NONCE + '",t0=Date.now(),fc=0,k=0;function P(o){o.__eye=N;try{parent.postMessage(o,"*")}catch(e){}}' +
      '(function L(){fc++;requestAnimationFrame(L)})();' +
      'function sig(c){try{var s=document.createElement("canvas");s.width=16;s.height=16;var x=s.getContext("2d");x.drawImage(c,0,0,16,16);var d=x.getImageData(0,0,16,16).data,a=[];for(var i=0;i<d.length;i+=4)a.push((d[i]*3+d[i+1]*4+d[i+2])>>3);return a}catch(e){return null}}' +
      'function shot(c){try{var w=200,h=Math.max(1,Math.round(c.height*w/Math.max(1,c.width)));if(h>300){h=300;w=Math.round(c.width*h/Math.max(1,c.height))}var s=document.createElement("canvas");s.width=w;s.height=h;var x=s.getContext("2d");x.drawImage(c,0,0,w,h);return s.toDataURL("image/jpeg",.6)}catch(e){return ""}}' +
      'function boxes(){var o=[],els=document.body?document.body.getElementsByTagName("*"):[];for(var i=0;i<els.length&&o.length<140;i++){var e=els[i],r=e.getBoundingClientRect();if(r.width<4||r.height<4||r.bottom<0||r.top>innerHeight*1.5)continue;var cs=getComputedStyle(e);if(cs.visibility=="hidden"||cs.display=="none"||+cs.opacity===0)continue;o.push([Math.round(r.left),Math.round(r.top),Math.round(r.width),Math.round(r.height),e.tagName.toLowerCase(),cs.backgroundColor,(e.children.length?"":(e.textContent||"").trim().slice(0,24))])}return o}' +
      'function snap(){requestAnimationFrame(function(){var c=document.querySelector("canvas"),el=(Date.now()-t0)/1000;var r={type:"snap",k:k++,fps:Math.round(fc/Math.max(.2,el)),title:document.title||"",text:(document.body&&document.body.innerText||"").replace(/\\s+/g," ").slice(0,500),w:innerWidth,h:innerHeight,n:document.getElementsByTagName("*").length,buttons:document.querySelectorAll("button,[role=button],a[href]").length,inputs:document.querySelectorAll("input,textarea,select").length,keys:!!(window.onkeydown||document.onkeydown||window.onkeyup||document.onkeyup||document.body&&document.body.onkeydown),boxes:boxes()};' +
      'if(c){r.canvas={w:c.width,h:c.height,img:shot(c),sig:sig(c),n:document.querySelectorAll("canvas").length}}P(r);fc=0;t0=Date.now()})}' +
      'var iv=setInterval(snap,700);setTimeout(snap,250);setTimeout(function(){clearInterval(iv);iv=setInterval(snap,2500)},20000);setTimeout(function(){clearInterval(iv)},120000);' +
      'addEventListener("message",function(e){if(e.data&&e.data.__eyePing===N)snap()});})();<\/script>';
    function sigStats(a, b) {
      if (!a) return { blank: null, motion: null };
      let mean = 0; for (const v of a) mean += v; mean /= a.length; let vr = 0; for (const v of a) vr += (v - mean) * (v - mean); vr /= a.length;
      let diff = null; if (b && b.length === a.length) { diff = 0; for (let i = 0; i < a.length; i++) diff += Math.abs(a[i] - b[i]); diff /= a.length; }
      return { blank: vr < 2, motion: diff, mean };
    }
    async function buildDoc(path) {
      const f = await DS.fs.read(path); if (!f) throw new Error('not found: ' + path);
      const A = DS.service('forge.apps'); let html = f.content || '';
      if (A && A.inlineAssets) html = await A.inlineAssets(html, path);
      html = /<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, m => m + PROBE) : PROBE + html;
      if (A && A.withShim) html = A.withShim(html);
      return html;
    }
    /* frames that report back: iframe.contentWindow → handler */
    const listeners = new Map();
    addEventListener('message', e => { const h = listeners.get(e.source); if (h) h(e.data); });
    ctx.effect(() => () => listeners.clear());
    function attach(frame, onMsg) { const reg = () => { if (frame.contentWindow) listeners.set(frame.contentWindow, onMsg); }; reg(); frame.addEventListener('load', reg); return () => { if (frame.contentWindow) listeners.delete(frame.contentWindow); }; }
    function ingest(eye, d) {
      if (!d) return;
      if (d.__forge && d.level) { eye.console.push({ t: wall(), level: d.level, msg: safe(d.msg, 300) }); if (d.level === 'error') eye.errors++; if (eye.console.length > 200) eye.console.splice(0, 50); dirty(); return; }
      if (d.__eye !== NONCE || d.type !== 'snap') return;
      const prev = eye.last; const st = d.canvas ? sigStats(d.canvas.sig, prev && prev.canvas && prev.canvas.sig) : { blank: null, motion: null };
      eye.last = d; eye.snaps++; eye.fps = d.fps; eye.title = d.title; eye.text = safe(d.text, 500); eye.boxes = d.boxes || []; eye.vw = d.w; eye.vh = d.h;
      eye.stats = { elements: d.n, buttons: d.buttons, inputs: d.inputs, keys: d.keys, canvas: d.canvas ? { w: d.canvas.w, h: d.canvas.h, count: d.canvas.n, blank: st.blank, motion: st.motion } : null };
      if (st.motion != null) eye.motionHist.push(st.motion); if (eye.motionHist.length > 30) eye.motionHist.shift();
      if (d.canvas && d.canvas.img && (!prev || !prev.canvas || st.motion == null || st.motion > 0.4 || eye.frames.length < 3)) { eye.frames.push({ t: wall(), img: d.canvas.img, motion: st.motion }); if (eye.frames.length > MAX_FRAMES) eye.frames.shift(); }
      dirty();
    }
    function verdict(eye) {
      const c = eye.stats && eye.stats.canvas; const m = eye.motionHist.slice(-5); const avg = m.length ? m.reduce((a, b) => a + b, 0) / m.length : null;
      if (eye.errors) return { k: 'err', t: eye.errors + ' error' + (eye.errors > 1 ? 's' : '') };
      if (c) { if (c.blank && (avg == null || avg < 0.2)) return { k: 'warn', t: 'canvas looks blank' + (eye.snaps < 2 ? '…' : '') }; if (avg != null && avg > 0.4) return { k: 'ok', t: 'animating' }; return { k: 'ok', t: 'static frame' }; }
      if (eye.stats && eye.stats.elements > 3) return { k: 'ok', t: 'UI rendered' };
      return { k: 'warn', t: eye.snaps ? 'almost empty page' : 'loading…' };
    }
    const newEye = (path, why) => ({ path, why, t: wall(), console: [], errors: 0, snaps: 0, frames: [], motionHist: [], boxes: [], stats: null, fps: 0, title: '', text: '', last: null });
    /* background capture (offscreen frames are throttled by browsers, so it sits inside the viewport, invisible, behind the UI) */
    let bgFrame = null, bgOff = null, bgTimer = 0;
    function eyeLoad(run, path, why) {
      run.eye = newEye(path, why); ev(run, 'eye', { path, why });
      clearTimeout(bgTimer);
      bgTimer = setTimeout(async () => {
        try {
          const html = await buildDoc(path); stopBg();
          bgFrame = U.sandboxFrame(html); bgFrame.setAttribute('aria-hidden', 'true'); bgFrame.tabIndex = -1;
          bgFrame.style.cssText = 'position:fixed;left:0;bottom:0;width:390px;height:640px;border:0;opacity:0.001;pointer-events:none;z-index:-1';
          const eye = run.eye; bgOff = attach(bgFrame, d => ingest(eye, d)); document.body.appendChild(bgFrame);
          setTimeout(stopBg, 6000);
        } catch (e) { run.eye.console.push({ t: wall(), level: 'error', msg: String(e.message || e) }); run.eye.errors++; dirty(); }
      }, 600);
      if (visible()) setTimeout(() => mountEye(), 650);
    }
    function stopBg() { if (bgOff) bgOff(); bgOff = null; if (bgFrame) bgFrame.remove(); bgFrame = null; }
    ctx.effect(() => () => stopBg());

    /* app_inspect: let the agent see its own app */
    ctx.tool({ name: 'app_inspect', label: 'Inspect app', gate: 'none', readonly: true,
      description: 'Run an app/game (path to index.html or its /apps/<slug>/ folder) for ~3 s and report what it shows: title, visible text, errors and console output, element/button counts, canvas size, whether the canvas is blank or animating, and FPS. Use it after app_create to check your work.',
      parameters: { type: 'object', properties: { path: { type: 'string' }, ms: { type: 'number', description: 'watch time in ms (1000-8000, default 3000)' } }, required: ['path'] },
      async run(a, t) {
        let p = DS.fs.norm(a.path || ''); if (!/\.html?$/i.test(p)) p = p.replace(/\/$/, '') + '/index.html';
        if (!(await DS.fs.exists(p))) throw new Error('Not found: ' + p);
        const eye = newEye(p, 'inspect'); const run = t && runOf(t.thread); if (run) { run.eye = eye; ev(run, 'eye', { path: p, why: 'inspect' }); }
        const html = await buildDoc(p);
        const fr = U.sandboxFrame(html); fr.setAttribute('aria-hidden', 'true'); fr.tabIndex = -1;
        fr.style.cssText = 'position:fixed;left:0;bottom:0;width:390px;height:640px;border:0;opacity:0.001;pointer-events:none;z-index:-1';
        const off = attach(fr, d => ingest(eye, d)); document.body.appendChild(fr);
        const ms = Math.max(1000, Math.min(8000, +a.ms || 3000));
        await new Promise((res, rej) => { const tm = setTimeout(res, ms); t && t.signal && t.signal.addEventListener('abort', () => { clearTimeout(tm); rej(Object.assign(new Error('aborted'), { name: 'AbortError' })); }, { once: true }); }).finally(() => { off(); fr.remove(); });
        const v = verdict(eye);
        return { path: p, verdict: v.t, title: eye.title, text: eye.text, errors: eye.console.filter(c => c.level === 'error').map(c => c.msg).slice(0, 8), console: eye.console.slice(-10).map(c => c.level + ': ' + c.msg), fps: eye.fps, elements: eye.stats && eye.stats.elements, buttons: eye.stats && eye.stats.buttons, keyboard: eye.stats && eye.stats.keys, canvas: eye.stats && eye.stats.canvas, snapshots: eye.snaps };
      },
      summarize: (a, r) => r ? r.verdict + (r.errors && r.errors.length ? ' · ' + r.errors.length + ' errors' : '') + (r.canvas ? ' · canvas ' + r.canvas.w + '×' + r.canvas.h : '') : '' });

    /* ---------- rendering ---------- */
    let pend = 0;
    function dirty() { hud(); if (pend || !visible()) return; pend = setTimeout(() => { pend = 0; try { render(); } catch (e) { console.warn('[observatory] render', e); } }, 220); }
    ctx.effect(() => () => clearTimeout(pend));
    const css = `
.ob{display:flex;flex-direction:column;min-height:0;height:100%}
.ob-top{display:flex;gap:6px;align-items:center;padding:8px 12px;border-bottom:1px solid var(--line);flex-wrap:wrap}
.ob-runs{display:flex;gap:6px;overflow-x:auto;flex:1;min-width:0;-webkit-overflow-scrolling:touch;scrollbar-width:none}
.ob-run{flex:none;display:inline-flex;align-items:center;gap:6px;height:30px;padding:0 10px;border-radius:99px;border:1px solid var(--line-2);background:var(--card);font-size:12px;max-width:220px}
.ob-run.on{border-color:var(--accent-line);background:var(--accent-soft);color:var(--accent)}.ob-run span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ob-dot{width:8px;height:8px;border-radius:50%;background:var(--muted);flex:none}.ob-dot.running{background:var(--ok);animation:obp 1s infinite}.ob-dot.error,.ob-dot.stopped{background:var(--danger)}
@keyframes obp{50%{opacity:.35}}
.ob-scrub{display:flex;align-items:center;gap:8px;padding:6px 12px;border-bottom:1px solid var(--line);font:11px var(--mono);color:var(--muted)}.ob-scrub input{flex:1;min-width:0;accent-color:var(--accent)}
.ob-tabs{display:flex;gap:2px;overflow-x:auto;padding:6px 10px;border-bottom:1px solid var(--line);scrollbar-width:none}.ob-tabs button{flex:none;height:32px;padding:0 12px;border-radius:8px;font-size:12.5px;color:var(--text-2)}.ob-tabs button.on{background:var(--accent-soft);color:var(--accent)}
.ob-body{flex:1;overflow-y:auto;overflow-x:hidden;-webkit-overflow-scrolling:touch;padding:12px;min-height:0}
.ob-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,320px),1fr));gap:12px}
.ob-card{background:var(--bg-2);border:1px solid var(--line);border-radius:12px;padding:10px 12px;min-width:0;overflow:hidden}
.ob-card h4{margin:0 0 8px;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);display:flex;align-items:center;gap:6px}
.ob-metrics{display:grid;grid-template-columns:repeat(auto-fit,minmax(92px,1fr));gap:8px;margin-bottom:12px}
.ob-m{background:var(--bg-2);border:1px solid var(--line);border-radius:10px;padding:8px 10px;min-width:0}.ob-m b{display:block;font:600 17px var(--mono);color:var(--text)}.ob-m span{font-size:10.5px;color:var(--muted);text-transform:uppercase;letter-spacing:.06em}
.ob-now{display:flex;gap:10px;align-items:center;padding:10px 12px;border-radius:12px;border:1px solid var(--accent-line);background:var(--accent-soft);margin-bottom:12px;min-width:0}
.ob-now .lbl{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13.5px}
.ob-pulse{width:12px;height:12px;border-radius:50%;flex:none;box-shadow:0 0 0 0 currentColor;animation:obr 1.4s infinite}@keyframes obr{0%{box-shadow:0 0 0 0 color-mix(in srgb,currentColor 60%,transparent)}100%{box-shadow:0 0 0 10px transparent}}
.ob-th{display:flex;gap:8px;align-items:flex-start;padding:6px 0;border-bottom:1px dashed var(--line);font-size:13px;min-width:0}.ob-th:last-child{border-bottom:0}
.ob-tag{flex:none;font:600 9.5px/18px var(--mono);text-transform:uppercase;padding:0 6px;border-radius:5px;background:var(--card-2);color:var(--muted);min-width:62px;text-align:center}
.ob-tag.plan{color:#4aa3ff}.ob-tag.intent{color:var(--violet)}.ob-tag.question{color:var(--warn)}.ob-tag.doubt{color:#ff9f43}.ob-tag.decision{color:var(--ok)}.ob-tag.observation{color:#2dd4bf}
.ob-th p{margin:0;min-width:0;overflow-wrap:anywhere}
.ob-res{display:flex;gap:8px;align-items:flex-start;padding:6px 0;min-width:0}.ob-av{width:22px;height:22px;border-radius:6px;flex:none;display:inline-flex;align-items:center;justify-content:center;font:700 11px var(--mono);color:#fff}
.ob-res a{font-size:13px;color:var(--accent);overflow-wrap:anywhere}.ob-res .u{font:10.5px var(--mono);color:var(--muted);overflow-wrap:anywhere}.ob-res .s{font-size:12px;color:var(--text-2);overflow-wrap:anywhere}
.ob-q{display:inline-flex;align-items:center;gap:6px;font:12px var(--mono);padding:3px 9px;border-radius:99px;background:rgba(74,163,255,.12);color:#4aa3ff;border:1px solid rgba(74,163,255,.35);max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ob-page{border:1px solid var(--line);border-radius:10px;padding:8px 10px;margin:8px 0;background:var(--bg)}.ob-page .rd{font-size:12px;color:var(--text-2);white-space:pre-wrap;overflow-wrap:anywhere;max-height:160px;overflow:auto;margin-top:6px;border-left:2px solid var(--line-2);padding-left:8px}
.ob-eye{display:grid;grid-template-columns:minmax(0,1fr);gap:10px}.ob-stage{position:relative;height:420px;border-radius:12px;overflow:hidden;border:1px solid var(--line-2);background:#fff}
.ob-stage iframe{width:100%;height:100%;border:0}
.ob-film{display:flex;gap:6px;overflow-x:auto;padding-bottom:4px}.ob-film img{height:70px;border-radius:6px;border:1px solid var(--line);flex:none;background:#000}
.ob-badges{display:flex;gap:6px;flex-wrap:wrap}.ob-con{font:11px/1.45 var(--mono);max-height:180px;overflow:auto;background:var(--code-bg);border:1px solid var(--line);border-radius:8px;padding:6px 8px}.ob-con div{overflow-wrap:anywhere}.ob-con .error{color:var(--danger)}.ob-con .warn{color:var(--warn)}
.ob-bar{display:flex;height:14px;border-radius:7px;overflow:hidden;background:var(--card-2)}.ob-bar i{display:block;height:100%}
.ob-leg{display:flex;gap:10px;flex-wrap:wrap;font-size:11px;color:var(--muted);margin:6px 0}.ob-leg i{display:inline-block;width:9px;height:9px;border-radius:2px;margin-right:4px;vertical-align:-1px}
.ob-msg{display:flex;gap:8px;font-size:12px;padding:4px 0;border-bottom:1px solid var(--line);min-width:0}.ob-msg b{flex:none;width:64px;font:600 10.5px var(--mono);text-transform:uppercase;color:var(--muted)}.ob-msg span{flex:1;min-width:0;overflow-wrap:anywhere;color:var(--text-2)}.ob-msg em{flex:none;font:10.5px var(--mono);color:var(--muted);font-style:normal}
.ob-log{font:11.5px/1.5 var(--mono)}.ob-log div{display:flex;gap:8px;padding:2px 0;border-bottom:1px solid var(--line);min-width:0}.ob-log .ts{color:var(--muted);flex:none}.ob-log .k{flex:none;width:76px}.ob-log .d{flex:1;min-width:0;overflow-wrap:anywhere;color:var(--text-2)}
.ob-empty{color:var(--muted);text-align:center;padding:30px 10px;font-size:13px}
.ob-svg{width:100%;display:block}.ob-svg text{font:10px var(--mono);fill:var(--muted)}
.ob-live-n{animation:obp 1.2s infinite}
#ob-hud{position:fixed;z-index:85;top:calc(var(--sat) + 58px);right:10px;max-width:min(360px,calc(100vw - var(--rail) - var(--sal) - 20px));display:none;align-items:center;gap:8px;height:34px;padding:0 12px;border-radius:99px;background:var(--card-2);border:1px solid var(--accent-line);box-shadow:var(--shadow);font-size:12px;color:var(--text);cursor:pointer}
#ob-hud.on{display:flex}#ob-hud span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}#ob-hud em{font:11px var(--mono);color:var(--muted);font-style:normal;flex:none}
@media (prefers-reduced-motion:reduce){.ob-dot.running,.ob-pulse,.ob-live-n{animation:none}}
`;
    let cssOn = false; const ensureCss = () => { if (cssOn) return; cssOn = true; const s = document.createElement('style'); s.id = 'ob-css'; s.textContent = css; document.head.appendChild(s); ctx.effect(() => () => s.remove()); };

    let root = null, eyeFrame = null, eyeOff = null, eyeFor = null;
    const TABS = [['overview', 'Overview'], ['mind', 'Reasoning'], ['web', 'Web'], ['eye', 'Agent\'s eye'], ['context', 'What it saw'], ['tools', 'Tools'], ['log', 'Log']];
    const sel = () => runs.get(selected) || [...runs.values()].pop() || null;
    const inCut = x => x.t <= cutoff;
    const kids = run => [...runs.values()].filter(r => r.parentId && r.parentId === run.threadId);

    function swimlane(run, W) {
      const lanes = [run, ...kids(run)];
      const t0 = Math.min(...lanes.map(r => r.t0)), tEnd = Math.min(cutoff, Math.max(...lanes.map(r => r.t1 || wall())));
      const span = Math.max(1000, tEnd - t0), L = 86, H = 26, w = Math.max(200, W - L - 8);
      const x = t => L + Math.max(0, Math.min(w, (t - t0) / span * w));
      let s = '<svg class="ob-svg" viewBox="0 0 ' + (L + w + 8) + ' ' + (lanes.length * (H + 8) + 24) + '" preserveAspectRatio="none" role="img" aria-label="Timeline of model calls and tools">';
      for (let i = 0; i <= 4; i++) { const tx = L + w * i / 4; s += '<line x1="' + tx + '" x2="' + tx + '" y1="0" y2="' + (lanes.length * (H + 8)) + '" stroke="var(--line)" stroke-width="1"/><text x="' + tx + '" y="' + (lanes.length * (H + 8) + 14) + '" text-anchor="middle">' + fmtMs(span * i / 4) + '</text>'; }
      lanes.forEach((r, li) => {
        const y = li * (H + 8) + 2;
        s += '<text x="4" y="' + (y + H / 2 + 4) + '">' + esc(clip(li ? (r.role || 'subagent') : 'main', 12)) + '</text>';
        s += '<rect x="' + L + '" y="' + y + '" width="' + w + '" height="' + H + '" rx="5" fill="var(--card)" />';
        for (const sp of r.spans) {
          if (sp.t0 > cutoff) continue; const e = Math.min(sp.t1 || wall(), cutoff);
          const x0 = x(sp.t0), x1 = Math.max(x0 + 2, x(e)); const col = sp.status === 'err' ? COL.error : COL[sp.cat] || COL.other;
          const inset = sp.kind === 'model' ? 0 : 5;
          s += '<rect x="' + x0.toFixed(1) + '" y="' + (y + inset) + '" width="' + (x1 - x0).toFixed(1) + '" height="' + (H - inset * 2) + '" rx="3" fill="' + col + '" opacity="' + (sp.kind === 'model' ? 0.35 : 0.9) + '"' + (sp.t1 ? '' : ' class="ob-live-n"') + '><title>' + esc(sp.label + ' · ' + fmtMs((sp.t1 || wall()) - sp.t0) + (sp.status === 'err' ? ' · failed' : '')) + '</title></rect>';
        }
      });
      if (cutoff === Infinity && lanes.some(r => r.status === 'running')) { const nx = x(wall()); s += '<line x1="' + nx + '" x2="' + nx + '" y1="0" y2="' + (lanes.length * (H + 8)) + '" stroke="var(--accent)" stroke-width="1.5"/>'; }
      return s + '</svg><div class="ob-leg">' + ['model', 'web', 'fs', 'app', 'agents', 'memory', 'code', 'approval', 'error'].map(k => '<span><i style="background:' + COL[k] + '"></i>' + (k === 'model' ? 'model call' : k) + '</span>').join('') + '</div>';
    }
    function flowGraph(run) {
      const counts = {}; for (const e of run.events) if (e.k === 'tool' && inCut(e)) counts[e.name] = (counts[e.name] || 0) + 1;
      const names = Object.keys(counts).sort((a, b) => counts[b] - counts[a]).slice(0, 14);
      if (!names.length) return '<div class="ob-empty">No tool calls yet.</div>';
      const W = 320, Hh = 260, cx = W / 2, cy = Hh / 2, R = 100;
      const pos = { agent: [cx, cy] }; names.forEach((n, i) => { const a = -Math.PI / 2 + i * 2 * Math.PI / names.length; pos[n] = [cx + R * Math.cos(a), cy + R * Math.sin(a)]; });
      let s = '<svg class="ob-svg" viewBox="0 0 ' + W + ' ' + Hh + '" role="img" aria-label="Tool flow graph">';
      const max = Math.max(1, ...Object.values(run.trans));
      for (const [k, v] of Object.entries(run.trans)) { const [a, b] = k.split('>'); if (!pos[a] || !pos[b] || a === b) continue; s += '<line x1="' + pos[a][0] + '" y1="' + pos[a][1] + '" x2="' + pos[b][0] + '" y2="' + pos[b][1] + '" stroke="var(--accent)" stroke-opacity="' + (0.15 + 0.6 * v / max) + '" stroke-width="' + (1 + 3 * v / max) + '"/>'; }
      const live = run.status === 'running' && run.cur && run.cur.tool;
      s += '<circle cx="' + cx + '" cy="' + cy + '" r="20" fill="var(--violet)" opacity=".85"/><text x="' + cx + '" y="' + (cy + 4) + '" text-anchor="middle" style="fill:#fff;font-weight:700">agent</text>';
      const cmax = Math.max(...names.map(n => counts[n]));
      for (const n of names) { const [x, y] = pos[n]; const r = 8 + 10 * counts[n] / cmax; s += '<circle cx="' + x + '" cy="' + y + '" r="' + r + '" fill="' + (COL[CAT(n)] || COL.other) + '"' + (live === n ? ' class="ob-live-n" stroke="var(--text)" stroke-width="2"' : '') + '><title>' + esc(n + ' × ' + counts[n]) + '</title></circle><text x="' + x + '" y="' + (y + r + 11) + '" text-anchor="middle">' + esc(clip(n, 16)) + ' ×' + counts[n] + '</text>'; }
      return s + '</svg>';
    }
    function domains(run) {
      const d = [...run.sites.entries()].sort((a, b) => b[1] - a[1]).slice(0, 16);
      if (!d.length) return '<div class="ob-empty">No sites yet.</div>';
      return '<div class="ob-badges">' + d.map(([h, n]) => '<span class="chip" style="border-color:hsl(' + hue(h) + ' 60% 50% / .5)"><span class="ob-av" style="width:16px;height:16px;font-size:9px;background:hsl(' + hue(h) + ' 55% 45%)">' + esc(h[0] || '?').toUpperCase() + '</span>' + esc(h) + (n ? ' · read ' + n : ' · listed') + '</span>').join('') + '</div>';
    }
    function thoughtsHtml(run, limit) {
      const th = run.thoughts.filter(inCut); const list = limit ? th.slice(-limit) : th;
      if (!list.length) return '<div class="ob-empty">' + (run.status === 'running' ? 'Waiting for the model to think out loud…' : 'This model did not expose reasoning; its answer text is parsed instead when available.') + '</div>';
      let last = -1; return list.map(x => (x.step !== last ? ((last = x.step), '<div class="xs muted" style="margin:6px 0 2px">step ' + x.step + (x.src === 'answer' ? ' · from answer' : '') + '</div>') : '') + '<div class="ob-th"><span class="ob-tag ' + x.tag + '">' + x.tag + '</span><p>' + esc(x.text) + '</p></div>').join('') + (run.status === 'running' && run.mindBuf ? '<div class="ob-th"><span class="ob-tag">…</span><p class="muted">' + esc(clip(run.mindBuf, 300)) + '▍</p></div>' : '');
    }
    function searchesHtml(run, limit) {
      const ss = run.searches.filter(inCut); const list = limit ? ss.slice(-limit) : ss;
      if (!list.length) return '<div class="ob-empty">No searches yet.</div>';
      return list.map(s => '<div style="margin-bottom:10px"><span class="ob-q">⌕ ' + esc(s.q) + '</span> <span class="xs muted">' + esc(s.engine) + ' · ' + (s.error ? 'failed' : s.results.length + ' results') + '</span>' +
        (s.error ? '<div class="xs" style="color:var(--danger);overflow-wrap:anywhere">' + esc(s.error) + '</div>' : s.results.slice(0, limit ? 3 : 10).map(r => { const h = host(r.url); return '<div class="ob-res"><span class="ob-av" style="background:hsl(' + hue(h) + ' 55% 45%)">' + esc((h[0] || '?').toUpperCase()) + '</span><div style="min-width:0"><a href="' + esc(r.url) + '" target="_blank" rel="noopener noreferrer">' + esc(r.title || r.url) + '</a><div class="u">' + esc(h) + '</div>' + (r.snippet ? '<div class="s">' + esc(r.snippet) + '</div>' : '') + '</div></div>'; }).join('')) + '</div>').join('');
    }
    function pagesHtml(run, limit) {
      const ps = run.pages.filter(inCut); const list = limit ? ps.slice(-limit) : ps;
      if (!list.length) return '<div class="ob-empty">No pages read yet.</div>';
      return list.map(p => '<div class="ob-page"><div class="row" style="gap:8px;min-width:0"><span class="ob-av" style="background:hsl(' + hue(p.host) + ' 55% 45%)">' + esc((p.host[0] || '?').toUpperCase()) + '</span><div style="min-width:0;flex:1"><a href="' + esc(p.url) + '" target="_blank" rel="noopener noreferrer" style="font-size:13px;color:var(--accent);overflow-wrap:anywhere">' + esc(p.title) + '</a><div class="xs muted" style="overflow-wrap:anywhere">' + esc(p.host) + ' · ' + (p.error ? 'failed' : (p.status || '') + ' · ' + p.chars + ' chars · ' + p.links + ' links' + (p.via ? ' · via ' + esc(p.via) : '')) + '</div></div></div>' +
        (p.error ? '<div class="xs" style="color:var(--danger);overflow-wrap:anywhere">' + esc(p.error) + '</div>' : '<div class="rd">' + esc(limit ? clip(p.text, 500) : p.text) + '</div>') + '</div>').join('');
    }
    function wireframe(eye) {
      if (!eye || !eye.boxes || !eye.boxes.length) return '';
      const W = eye.vw || 390, Hh = Math.min(eye.vh || 640, 900);
      let s = '<svg class="ob-svg" viewBox="0 0 ' + W + ' ' + Hh + '" style="max-height:260px;background:var(--bg);border-radius:8px;border:1px solid var(--line)" role="img" aria-label="Wireframe of what the app shows">';
      for (const b of eye.boxes) { const [x, y, w, h, tag, bg, txt] = b; if (y > Hh) continue; const fill = bg && !/rgba\(0, 0, 0, 0\)|transparent/.test(bg) ? bg : 'none'; s += '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" fill="' + esc(fill) + '" fill-opacity=".55" stroke="' + (tag === 'canvas' ? '#ff9f43' : tag === 'button' ? '#4aa3ff' : 'var(--line-2)') + '" stroke-width="' + (tag === 'canvas' || tag === 'button' ? 2 : 1) + '"/>' + (txt ? '<text x="' + (x + 3) + '" y="' + (y + 12) + '" style="font-size:10px;fill:var(--text-2)">' + esc(txt) + '</text>' : ''); }
      return s + '</svg>';
    }
    function eyeBadges(eye) {
      if (!eye) return '';
      const v = verdict(eye), c = eye.stats && eye.stats.canvas;
      return '<div class="ob-badges"><span class="chip ' + (v.k === 'ok' ? 'ok' : v.k === 'err' ? 'err' : 'warn') + '">' + esc(v.t) + '</span>' + (eye.fps ? '<span class="chip">' + eye.fps + ' fps</span>' : '') + (c ? '<span class="chip">canvas ' + c.w + '×' + c.h + '</span>' : '') +
        (eye.stats ? '<span class="chip">' + eye.stats.elements + ' elements</span><span class="chip">' + eye.stats.buttons + ' buttons</span>' + (eye.stats.keys ? '<span class="chip">keyboard</span>' : '') : '') + (eye.title ? '<span class="chip acc">' + esc(clip(eye.title, 40)) + '</span>' : '') + '</div>';
    }
    function consoleHtml(eye) { if (!eye || !eye.console.length) return '<div class="xs muted">No console output.</div>'; return '<div class="ob-con">' + eye.console.slice(-60).map(c => '<div class="' + esc(c.level) + '">' + esc(c.level) + ': ' + esc(c.msg) + '</div>').join('') + '</div>'; }
    function filmHtml(eye) { if (!eye || !eye.frames.length) return ''; return '<div class="ob-film">' + eye.frames.map(f => '<img alt="frame" src="' + esc(f.img) + '">').join('') + '</div>'; }
    function contextHtml(run) {
      const c = run.ctx; if (!c) return '<div class="ob-empty">No model call yet.</div>';
      const segs = [['system', c.parts.system, 'var(--violet)'], ['tools schema', c.toolsTok, '#e3b341'], ['user', c.parts.user, '#4aa3ff'], ['assistant', c.parts.assistant, '#3fb950'], ['tool results', c.parts.tool, '#ff9f43']];
      const tot = Math.max(1, c.total), WIN = 128000;
      return '<div class="row wrap" style="gap:8px;margin-bottom:6px"><span class="chip acc">step ' + c.step + '</span><span class="chip">' + esc(c.provider) + ' · ' + esc(c.model) + '</span><span class="chip">≈' + tok(c.total) + ' tokens in</span><span class="chip">' + c.tools.length + ' tools offered</span></div>' +
        '<div class="ob-bar" title="share of the request">' + segs.map(s => '<i style="width:' + (100 * s[1] / tot).toFixed(1) + '%;background:' + s[2] + '"></i>').join('') + '</div>' +
        '<div class="ob-leg">' + segs.map(s => '<span><i style="background:' + s[2] + '"></i>' + s[0] + ' ' + tok(s[1]) + '</span>').join('') + '</div>' +
        '<div class="xs muted" style="margin:4px 0 8px">Context window use (vs 128k reference): ' + Math.min(100, (100 * c.total / WIN)).toFixed(1) + '% · estimates (chars ÷ 4)</div>' +
        '<div class="ob-bar" style="height:8px"><i style="width:' + Math.min(100, 100 * c.total / WIN).toFixed(1) + '%;background:var(--accent)"></i></div>' +
        '<h4 style="margin:12px 0 6px;font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.08em">Messages the model received</h4>' +
        c.messages.map(m => '<div class="ob-msg"><b>' + esc(m.role) + '</b><span>' + esc(m.calls ? '→ ' + m.calls : m.text) + '</span><em>' + tok(m.tok) + '</em></div>').join('') +
        '<h4 style="margin:12px 0 6px;font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.08em">Tools it could call</h4><div class="ob-badges">' + c.tools.map(n => '<span class="chip" style="border-color:' + (COL[CAT(n)] || 'var(--line-2)') + '">' + esc(n) + '</span>').join('') + '</div>' +
        '<details style="margin-top:12px"><summary class="sm">System prompt (redacted, first 6000 chars)</summary><pre style="white-space:pre-wrap;overflow-wrap:anywhere;font:11px/1.5 var(--mono);background:var(--code-bg);border:1px solid var(--line);border-radius:8px;padding:8px;max-height:320px;overflow:auto">' + esc(c.system) + '</pre></details>';
    }
    function toolsHtml(run) {
      const byName = {}; for (const sp of run.spans) if (sp.kind === 'tool' && sp.t0 <= cutoff) { const b = byName[sp.label] || (byName[sp.label] = { n: 0, err: 0, ms: 0 }); b.n++; if (sp.status === 'err') b.err++; b.ms += (sp.t1 || wall()) - sp.t0; }
      const rows = Object.entries(byName).sort((a, b) => b[1].n - a[1].n); const max = Math.max(1, ...rows.map(r => r[1].n));
      const files = [...run.files.entries()].filter(([, f]) => f.t0 <= cutoff).sort((a, b) => b[1].t - a[1].t);
      return '<div class="ob-grid"><div class="ob-card"><h4>Tool flow</h4>' + flowGraph(run) + '</div><div class="ob-card"><h4>Calls by tool</h4>' + (rows.length ? rows.map(([n, b]) => '<div style="margin:6px 0"><div class="row" style="justify-content:space-between;font-size:12px"><span class="mono">' + esc(n) + '</span><span class="muted">' + b.n + '× · ' + fmtMs(b.ms / b.n) + ' avg' + (b.err ? ' · <span style="color:var(--danger)">' + b.err + ' failed</span>' : '') + '</span></div><div class="ob-bar" style="height:6px"><i style="width:' + (100 * b.n / max) + '%;background:' + (COL[CAT(n)] || COL.other) + '"></i></div></div>').join('') : '<div class="ob-empty">No tool calls yet.</div>') + '</div>' +
        '<div class="ob-card"><h4>Files touched</h4>' + (files.length ? files.map(([p, f]) => '<div class="ob-msg"><b style="width:auto;color:' + COL.fs + '">' + f.writes + '×</b><span class="mono">' + esc(p) + '</span><em>' + (f.bytes ? tok(f.bytes / 4) + ' tok' : '') + '</em></div>').join('') : '<div class="ob-empty">No files written yet.</div>') + '</div></div>';
    }
    function logHtml(run) {
      const evs = run.events.filter(inCut).slice(-400);
      const desc = e => e.k === 'tool' ? e.name + ' ' + e.args : e.k === 'tool_end' ? e.name + ' · ' + e.status + ' · ' + fmtMs(e.ms) + (e.summary ? ' · ' + e.summary : '') : e.k === 'model' ? 'step ' + e.step + ' → ' + e.provider + ' · ' + e.model + ' · ≈' + tok(e.ctx) + ' tok · ' + e.tools + ' tools' : e.k === 'model_end' ? 'step ' + e.step + ' · ' + fmtMs(e.ms) + (e.calls.length ? ' · calls ' + e.calls.join(', ') : ' · answer') : e.k === 'run' ? e.text : e.k === 'run_end' ? e.status + ' · ' + fmtMs(e.ms) + (e.error ? ' · ' + e.error : '') : e.k === 'eye' ? e.why + ' ' + e.path : e.k === 'spawn' ? e.role + ': ' + e.task : e.k === 'route' ? 'claude ' + e.tier + (e.effort ? ' · ' + e.effort : '') + ' — ' + e.why : JSON.stringify(Object.assign({}, e, { t: undefined, k: undefined }));
      return evs.length ? '<div class="ob-log">' + evs.map(e => '<div><span class="ts">' + new Date(e.t).toLocaleTimeString([], { hour12: false }) + '</span><span class="k" style="color:' + (e.k.startsWith('tool') ? COL[e.cat] || COL.other : e.k.startsWith('model') ? COL.model : e.status === 'err' ? COL.error : 'var(--text-2)') + '">' + esc(e.k) + '</span><span class="d">' + esc(desc(e)) + '</span></div>').join('') + '</div>' : '<div class="ob-empty">No events.</div>';
    }
    function metrics(run) {
      const lanes = [run, ...kids(run)];
      const el = ((run.t1 || wall()) - run.t0);
      const M = [['elapsed', fmtMs(Math.min(el, cutoff === Infinity ? el : cutoff - run.t0))], ['steps', run.steps], ['tool calls', run.tools], ['errors', run.errors], ['tokens in', '≈' + tok(run.tokIn)], ['tokens out', '≈' + tok(run.tokOut)], ['sites', run.sites.size], ['files', run.files.size], ['subagents', lanes.length - 1]];
      return '<div class="ob-metrics">' + M.map(([k, v]) => '<div class="ob-m"><b' + (k === 'errors' && v ? ' style="color:var(--danger)"' : '') + '>' + esc(String(v)) + '</b><span>' + esc(k) + '</span></div>').join('') + '</div>';
    }
    function nowCard(run) {
      const c = run.cur || {}; const col = COL[c.cat] || COL.other;
      return '<div class="ob-now"><span class="ob-pulse" style="color:' + col + ';background:' + col + (run.status === 'running' ? '' : ';animation:none') + '"></span><span class="lbl"><b>' + esc(run.status === 'running' ? 'Now: ' : 'Finished: ') + '</b>' + esc(c.label || '') + '</span><span class="xs mono muted">' + (run.status === 'running' ? fmtMs(wall() - (c.since || wall())) : esc(run.status)) + '</span></div>';
    }
    function eyeSummary(run) {
      const e = run.eye; if (!e) return '<div class="ob-empty">When the agent builds an app or game, you\'ll see it here — live.</div>';
      const img = e.frames.length ? '<img alt="latest frame" src="' + esc(e.frames[e.frames.length - 1].img) + '" style="width:100%;max-height:200px;object-fit:contain;background:#000;border-radius:8px">' : wireframe(e);
      return '<div class="xs mono muted" style="overflow-wrap:anywhere;margin-bottom:6px">' + esc(e.path) + '</div>' + img + '<div style="margin-top:8px">' + eyeBadges(e) + '</div><button class="btn sm" data-tab="eye" style="margin-top:8px">Watch it live</button>';
    }

    function render() {
      if (!root || !root.isConnected) return;
      const run = sel();
      const runsBar = root.querySelector('.ob-runs'), body = root.querySelector('.ob-body'), scrub = root.querySelector('.ob-scrub');
      const list = [...runs.values()].filter(r => !r.parentId).slice(-12).reverse();
      runsBar.innerHTML = list.length ? list.map(r => '<button class="ob-run' + (run && r.id === run.id ? ' on' : '') + '" data-run="' + r.id + '"><i class="ob-dot ' + r.status + '"></i><span>' + esc(r.title) + '</span></button>').join('') : '<span class="xs muted">No runs yet — send a message and watch here.</span>';
      root.querySelectorAll('.ob-tabs button').forEach(b => b.classList.toggle('on', b.dataset.t === tab));
      if (!run) { body.innerHTML = '<div class="ob-empty">Nothing to watch yet.<br><br><button class="btn pri" data-demo>Watch a demo agent build a game</button></div>'; scrub.style.display = 'none'; return; }
      scrub.style.display = '';
      const rng = scrub.querySelector('input'), lbl = scrub.querySelector('span');
      const end = run.t1 || wall(); if (cutoff === Infinity) rng.value = 1000;
      lbl.textContent = cutoff === Infinity ? (run.status === 'running' ? '● LIVE' : 'end') : '⏪ ' + fmtMs(cutoff - run.t0) + ' / ' + fmtMs(end - run.t0);
      const keepScroll = body.scrollTop;
      if (tab === 'eye') { renderEye(run, body); return; }
      unmountEye();
      let h = '';
      if (tab === 'overview') {
        h = nowCard(run) + metrics(run) +
          '<div class="ob-card" style="margin-bottom:12px"><h4>Timeline' + (kids(run).length ? ' · ' + kids(run).length + ' subagent lane' + (kids(run).length > 1 ? 's' : '') : '') + '</h4>' + swimlane(run, Math.max(280, body.clientWidth - 50)) + '</div>' +
          '<div class="ob-grid"><div class="ob-card"><h4>Latest reasoning</h4>' + thoughtsHtml(run, 6) + '</div>' +
          '<div class="ob-card"><h4>Agent\'s eye</h4>' + eyeSummary(run) + '</div>' +
          '<div class="ob-card"><h4>Searching &amp; finding</h4>' + searchesHtml(run, 2) + '</div>' +
          '<div class="ob-card"><h4>Pages read</h4>' + pagesHtml(run, 2) + '<h4 style="margin-top:10px">Sites</h4>' + domains(run) + '</div>' +
          '<div class="ob-card"><h4>Tool flow</h4>' + flowGraph(run) + '</div>' +
          '<div class="ob-card"><h4>What it saw (last request)</h4>' + (run.ctx ? '<div class="ob-bar">' + [['system', run.ctx.parts.system, 'var(--violet)'], ['tools', run.ctx.toolsTok, '#e3b341'], ['user', run.ctx.parts.user, '#4aa3ff'], ['assistant', run.ctx.parts.assistant, '#3fb950'], ['tool', run.ctx.parts.tool, '#ff9f43']].map(s => '<i style="width:' + (100 * s[1] / Math.max(1, run.ctx.total)).toFixed(1) + '%;background:' + s[2] + '"></i>').join('') + '</div><div class="xs muted" style="margin-top:6px">≈' + tok(run.ctx.total) + ' tokens · ' + run.ctx.tools.length + ' tools · ' + esc(run.ctx.model) + '</div><button class="btn sm" data-tab="context" style="margin-top:8px">Inspect</button>' : '<div class="ob-empty">No model call yet.</div>') + '</div></div>';
      } else if (tab === 'mind') h = '<div class="ob-card">' + thoughtsHtml(run, 0) + '</div>' + (run.says ? '<div class="ob-card" style="margin-top:12px"><h4>Answer so far</h4><div class="sm" style="white-space:pre-wrap;overflow-wrap:anywhere">' + esc(clip(run.says, 3000)) + '</div></div>' : '');
      else if (tab === 'web') h = '<div class="ob-grid"><div class="ob-card"><h4>Searches</h4>' + searchesHtml(run, 0) + '</div><div class="ob-card"><h4>Pages read — exactly what the agent got</h4>' + pagesHtml(run, 0) + '</div><div class="ob-card"><h4>Sites</h4>' + domains(run) + '</div></div>';
      else if (tab === 'context') h = '<div class="ob-card">' + contextHtml(run) + '</div>';
      else if (tab === 'tools') h = toolsHtml(run);
      else if (tab === 'log') h = '<div class="row" style="justify-content:flex-end;margin-bottom:8px"><button class="btn sm" data-export>Export run (JSON)</button></div><div class="ob-card">' + logHtml(run) + '</div>';
      body.innerHTML = h; body.scrollTop = keepScroll;
    }
    function renderEye(run, body) {
      const e = run.eye;
      if (!e) { unmountEye(); body.innerHTML = '<div class="ob-empty">No app or game yet. When an agent creates one (app_create / an .html file), it runs here live and Forge watches it: frames, motion, FPS, errors and console.</div>'; return; }
      let shell = body.querySelector('.ob-eye');
      if (!shell || shell.dataset.path !== e.path || shell.dataset.t !== String(e.t)) {
        unmountEye();
        body.innerHTML = '<div class="ob-eye" data-path="' + esc(e.path) + '" data-t="' + e.t + '"><div class="row wrap" style="gap:8px"><span class="mono xs" style="overflow-wrap:anywhere;flex:1;min-width:0">' + esc(e.path) + '</span><button class="btn sm" data-reload>Reload</button><button class="btn sm" data-open-preview>Open in Preview</button></div><div class="ob-stage"></div><div data-badges></div><div class="ob-card"><h4>Frames (canvas filmstrip)</h4><div data-film></div></div><div class="ob-card"><h4>Wireframe — what the page lays out</h4><div data-wire></div></div><div class="ob-card"><h4>Console</h4><div data-con></div></div></div>';
        shell = body.querySelector('.ob-eye'); mountEye();
      }
      shell.querySelector('[data-badges]').innerHTML = eyeBadges(e);
      shell.querySelector('[data-film]').innerHTML = filmHtml(e) || '<div class="xs muted">No canvas frames (this app has no &lt;canvas&gt;, or it is WebGL without preserveDrawingBuffer).</div>';
      shell.querySelector('[data-wire]').innerHTML = wireframe(e) || '<div class="xs muted">Waiting for the first snapshot…</div>';
      shell.querySelector('[data-con]').innerHTML = consoleHtml(e);
    }
    async function mountEye() {
      const run = sel(); if (!run || !run.eye || !root) return;
      const stage = root.querySelector('.ob-stage'); if (!stage) return;
      if (eyeFrame && eyeFor === run.eye && stage.contains(eyeFrame)) return;
      unmountEye();
      try {
        const e = run.eye; const html = await buildDoc(e.path); if (!stage.isConnected) return;
        eyeFrame = U.sandboxFrame(html); eyeFor = e; eyeOff = attach(eyeFrame, d => ingest(e, d)); stage.appendChild(eyeFrame);
      } catch (err) { stage.innerHTML = '<div class="ob-empty">' + esc(err.message || String(err)) + '</div>'; }
    }
    function unmountEye() { if (eyeOff) eyeOff(); eyeOff = null; if (eyeFrame) eyeFrame.remove(); eyeFrame = null; eyeFor = null; }

    /* ---------- view ---------- */
    if (!DS.icons.eye) DS.icons.eye = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>';
    ctx.view({ id: 'observe', title: 'Observatory', icon: 'eye', order: 41,
      badge: () => { const n = [...runs.values()].filter(r => r.status === 'running').length; return n ? String(n) : ''; },
      mount(el) {
        ensureCss(); root = el; el.classList.add('ob');
        el.innerHTML = '<div class="ob-top"><div class="ob-runs"></div></div><div class="ob-scrub"><span>● LIVE</span><input type="range" min="0" max="1000" value="1000" aria-label="Replay position"><button class="btn sm" data-live>Live</button></div><div class="ob-tabs">' + TABS.map(([k, l]) => '<button data-t="' + k + '">' + l + '</button>').join('') + '</div><div class="ob-body"></div>';
        const rng = el.querySelector('.ob-scrub input');
        rng.addEventListener('input', () => { const run = sel(); if (!run) return; const end = run.t1 || wall(); const v = +rng.value; cutoff = v >= 1000 ? Infinity : run.t0 + (end - run.t0) * v / 1000; render(); });
        el.addEventListener('click', async ev2 => {
          const r = ev2.target.closest('[data-run]'); if (r) { selected = r.dataset.run; cutoff = Infinity; unmountEye(); render(); return; }
          const tb = ev2.target.closest('[data-t],[data-tab]'); if (tb) { tab = tb.dataset.t || tb.dataset.tab; ctx.data.set('tab', tab); render(); return; }
          if (ev2.target.closest('[data-live]')) { cutoff = Infinity; render(); return; }
          if (ev2.target.closest('[data-reload]')) { unmountEye(); const run = sel(); if (run && run.eye) { run.eye = Object.assign(newEye(run.eye.path, 'reload')); } render(); return; }
          if (ev2.target.closest('[data-open-preview]')) { const run = sel(); if (run && run.eye) { try { await DS.agent.tool('app_preview').run({ path: run.eye.path }, {}); } catch (_) { DS.shell.show('preview'); } } return; }
          if (ev2.target.closest('[data-export]')) { const run = sel(); if (run) U.download('forge-run-' + run.id + '.json', JSON.stringify(exportRun(run), null, 1), 'application/json'); return; }
          if (ev2.target.closest('[data-demo]')) { demo(); return; }
        });
        render(); mountEye();
        const iv = setInterval(() => { if (visible() && [...runs.values()].some(r => r.status === 'running')) render(); }, 1000);
        return () => { clearInterval(iv); unmountEye(); root = null; };
      } });
    if (ctx.rail) ctx.rail({ id: 'observe', icon: 'eye', label: 'Observatory — watch agents live', group: 'top', order: 43, run: () => DS.shell.show('observe'), active: () => DS.shell.current === 'observe' });
    ctx.on('view:show', () => { if (visible()) setTimeout(() => { render(); mountEye(); }, 30); else unmountEye(); });

    function exportRun(run) {
      return { id: run.id, title: run.title, task: run.task, status: run.status, started: new Date(run.t0).toISOString(), ended: run.t1 ? new Date(run.t1).toISOString() : null, steps: run.steps, tools: run.tools, errors: run.errors, tokensIn: run.tokIn, tokensOut: run.tokOut,
        spans: run.spans.map(s => ({ kind: s.kind, label: s.label, cat: s.cat, start: s.t0 - run.t0, ms: (s.t1 || wall()) - s.t0, status: s.status })), thoughts: run.thoughts, searches: run.searches, pages: run.pages.map(p => Object.assign({}, p, { text: clip(p.text, 1200) })), files: [...run.files.entries()].map(([p, f]) => ({ path: p, writes: f.writes, bytes: f.bytes })), sites: [...run.sites.entries()], events: run.events, eye: run.eye ? { path: run.eye.path, verdict: verdict(run.eye).t, fps: run.eye.fps, errors: run.eye.errors, console: run.eye.console.slice(-50), stats: run.eye.stats } : null };
    }

    /* ---------- live HUD on every screen while an agent runs ---------- */
    let hudEl = null, hudT = 0;
    function hud() {
      if (hudT) return; hudT = setTimeout(() => { hudT = 0; drawHud(); }, 250);
    }
    function drawHud() {
      if (DS.store.settings().obsHud === false) { if (hudEl) hudEl.classList.remove('on'); return; }
      const live = [...runs.values()].filter(r => r.status === 'running');
      if (!hudEl) { ensureCss(); hudEl = document.createElement('button'); hudEl.id = 'ob-hud'; hudEl.type = 'button'; hudEl.setAttribute('aria-label', 'Open the Observatory'); hudEl.onclick = () => DS.shell.show('observe'); document.body.appendChild(hudEl); ctx.effect(() => () => { hudEl && hudEl.remove(); hudEl = null; }); }
      const on = live.length && DS.shell && DS.shell.current !== 'observe';
      hudEl.classList.toggle('on', !!on);
      if (!on) return;
      const r = live.find(x => !x.parentId) || live[0]; const c = r.cur || {}; const col = COL[c.cat] || COL.other;
      hudEl.innerHTML = '<i class="ob-dot running" style="background:' + col + '"></i><span>' + esc(c.label || 'working') + '</span><em>' + (live.length > 1 ? live.length + ' agents · ' : '') + fmtMs(wall() - r.t0) + '</em>';
    }
    ctx.setInterval(() => { if ([...runs.values()].some(r => r.status === 'running')) drawHud(); }, 1000);
    ctx.settings({ id: 'observatory', title: 'Observatory', order: 61, render(node) {
      const s = DS.store.settings();
      node.innerHTML = '<p class="sm">Watches every agent run live: timeline, reasoning, searches, pages read, the app being built, and what the model saw. Nothing leaves your device; secrets are redacted before anything is shown or exported.</p><label class="row sm" style="gap:8px"><input type="checkbox" data-hud' + (s.obsHud === false ? '' : ' checked') + '> Show the live activity pill on other screens</label>';
      node.querySelector('[data-hud]').onchange = e2 => { s.obsHud = e2.target.checked; DS.store.save(); drawHud(); };
    } });

    /* ---------- demo + Sim ---------- */
    const DEMO_GAME = '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Orbit Dodge</title><style>html,body{margin:0;height:100%;background:#0b1020;color:#cfe;font:14px system-ui}canvas{display:block;width:100%;height:100%}#s{position:fixed;top:10px;left:12px}</style></head><body><div id="s">score 0</div><canvas id="c"></canvas><script>const c=document.getElementById("c"),x=c.getContext("2d");let W,H,t=0,sc=0,px=.5,rocks=[];function R(){W=c.width=innerWidth;H=c.height=innerHeight}addEventListener("resize",R);R();addEventListener("pointermove",e=>px=e.clientX/W);addEventListener("keydown",e=>{if(e.key=="ArrowLeft")px-=.05;if(e.key=="ArrowRight")px+=.05});function L(){t++;x.fillStyle="rgba(11,16,32,.35)";x.fillRect(0,0,W,H);if(t%20==0)rocks.push({x:Math.random()*W,y:-10,v:2+Math.random()*3,r:6+Math.random()*10});x.fillStyle="#ff9f43";rocks.forEach(o=>{o.y+=o.v;x.beginPath();x.arc(o.x,o.y,o.r,0,7);x.fill()});rocks=rocks.filter(o=>o.y<H+20);const sx=px*W,sy=H-40;x.fillStyle="#4aa3ff";x.beginPath();x.moveTo(sx,sy-14);x.lineTo(sx-10,sy+10);x.lineTo(sx+10,sy+10);x.fill();sc++;document.getElementById("s").textContent="score "+sc;console.log&&t%120==0&&console.log("frame",t,"rocks",rocks.length);requestAnimationFrame(L)}L();<\/script></body></html>';
    ctx.intent({ id: 'observe-demo', order: 30, match: t => /^\s*(watch|observe)\b.*\b(build|make|game|agent)/i.test(t) || /watch (a|the) (demo )?agent/i.test(t),
      script: () => { setTimeout(() => DS.shell.show('observe'), 50); return [
        { say: 'I\'ll plan a small canvas game, build it, then inspect it so you can watch every step.\n\nFirst, a plan.', tool: { name: 'update_plan', args: { goal: 'Build and verify a tiny canvas game', steps: [{ text: 'Write the game as one HTML file', status: 'doing' }, { text: 'Run it and check frames, FPS and errors', status: 'pending' }] } } },
        { say: 'Now I\'ll write the game: a ship that dodges falling rocks, with pointer and arrow-key controls.', tool: { name: 'app_create', args: { name: 'orbit-dodge', html: DEMO_GAME, open: false } } },
        { say: 'Let me run it and look at what it renders — is the canvas animating, any errors?', tool: { name: 'app_inspect', args: { path: '/apps/orbit-dodge/', ms: 2500 } } },
        { final: r => { const x = r[r.length - 1] || {}; return 'Built **Orbit Dodge** and watched it run: **' + (x.verdict || '?') + '**' + (x.fps ? ', ~' + x.fps + ' fps' : '') + (x.canvas ? ', canvas ' + x.canvas.w + '×' + x.canvas.h : '') + (x.errors && x.errors.length ? ', ' + x.errors.length + ' errors' : ', no errors') + '.\n\nOpen **Observatory → Agent\'s eye** to see it live, with the frame filmstrip, wireframe and console.'; } }
      ]; } });
    ctx.suggest({ id: 'observe-demo', emoji: '👁', title: 'Watch an agent build a game', sub: 'Live Observatory: reasoning, tools, the game as it renders', prompt: 'watch an agent build a tiny canvas game' });
    function demo() { const t = DS.store.newThread(); DS.shell.show('thread'); DS.agent.run(t, 'watch an agent build a tiny canvas game').catch(() => {}); setTimeout(() => DS.shell.show('observe'), 300); }
    ctx.command({ name: 'observe', desc: 'Open the Observatory (live agent visibility)', run: () => DS.shell.show('observe') });

    const api = { runs: () => [...runs.values()], run: id => runs.get(id), selected: () => sel(), select: id => { selected = id; render(); }, exportRun, verdict, setCutoff: v => { cutoff = v; render(); }, demo };
    ctx.provide('forge.observe', api);
  }
});
