/* 62-router.js — forge.router: "Auto · free failover" provider (ordered chain, cooldowns from Retry-After,
   sticky sessions, never retries after streaming started), opt-in exact cache, optional cheap→strong cascade. */
DS.plugin({
  name: 'forge.router', title: 'Router · free failover', version: '1.0.0', tags: ['providers', 'router', 'free'],
  description: 'Provider "auto": tries an ordered chain of free models, puts 429/5xx/network failures on cooldown (Retry-After aware), sticks to the last good route per thread for 10 min, optional exact cache and cheap→strong cascade.',
  apply(ctx) {
    const esc = DS.util.esc, now = () => Date.now();
    const S = () => DS.store.state.settings;
    const STICKY_MS = 10 * 60e3, CACHE_TTL = 3600e3, CACHE_MAX = 50;
    const M = () => DS.service('forge.models');
    const keyOf = c => c.provider + '|' + c.model;
    const sticky = {}; const history = []; let last = null;
    const views = new Set();

    /* ---------- chain ---------- */
    const rank = r => ({ direct: 0, gateway: 1, origin: 2, local: 3 }[r] ?? 4);
    function catalog() { try { return (M() && M().catalog()) || []; } catch (_) { return []; } }
    /* default chain: providers you have a key for first (they actually work), then keyless/key-optional direct routes,
       then keyless gateway routes only when a gateway is configured. Max 8. */
    const PREF = ['deepseek', 'groq', 'gemini', 'cerebras', 'openrouter', 'mistral', 'github', 'zai', 'nous', 'sambanova', 'huggingface', 'pollinations', 'llm7'];
    function defaultChain() {
      const m = M(); const hasKey = id => { try { return !!(m && m.hasKey && m.hasKey(id)); } catch (_) { return false; } };
      let gw = false; try { const g = DS.service('forge.gateway'); gw = !!(g && g.get && g.get()) || /^https?:/.test(location.protocol); } catch (_) {}
      const seen = new Set(), out = []; const add = x => { if (seen.has(x.provider) || x.provider === 'sim' || x.provider === 'auto') return; seen.add(x.provider); out.push({ provider: x.provider, model: x.id, route: x.route || '' }); };
      const cat = catalog(); const pr = id => { const i = PREF.indexOf(id); return i < 0 ? 99 : i; };
      cat.filter(x => hasKey(x.provider) && (x.free || x.freeTier || x.provider === 'deepseek')).sort((a, b) => pr(a.provider) - pr(b.provider)).forEach(add);
      cat.filter(x => (x.keyless || x.keyOptional) && x.route === 'direct').sort((a, b) => pr(a.provider) - pr(b.provider)).forEach(add);
      if (gw) cat.filter(x => x.keyless && x.free && x.route !== 'direct' && x.route !== 'local').sort((a, b) => rank(a.route) - rank(b.route)).forEach(add);
      return out.slice(0, 8);
    }
    const custom = () => { const c = ctx.data.get('chain', null); return Array.isArray(c) && c.length ? c : null; };
    const chain = () => custom() || defaultChain();
    function setChain(c) { ctx.data.set('chain', (c || []).map(x => ({ provider: String(x.provider), model: String(x.model || ''), route: x.route || '' }))); refresh(); }
    const provObj = id => DS.kernel.list('provider').find(p => p.id === id);

    /* ---------- cooldowns ---------- */
    const cools = () => { const c = ctx.data.get('cool', {}); let dirty = false; for (const k in c) if (c[k].until < now() - 3600e3 && !(c[k].hits || []).some(t => t > now() - 864e5)) { delete c[k]; dirty = true; } if (dirty) ctx.data.set('cool', c); return c; };
    const coolLeft = k => { const c = cools()[k]; return c && c.until > now() ? Math.ceil((c.until - now()) / 1000) : 0; };
    function classify(e) {
      const msg = String((e && e.message) || e || 'error');
      let st = e && (e.status || e.statusCode); if (!st) { const m = msg.match(/\b(?:HTTP|API|status(?: code)?)[\s:]*(\d{3})\b/i) || msg.match(/\((\d{3})\)/); if (m) st = +m[1]; } /* only status-shaped numbers, never e.g. 'max_tokens ≤ 512' */
      let ra = e && e.retryAfter; if (ra == null && e && e.headers && typeof e.headers.get === 'function') ra = e.headers.get('retry-after');
      if (ra == null) { const m = msg.match(/retry[- _]?after["':=\s]+(\d+(?:\.\d+)?)/i) || msg.match(/try again in (\d+(?:\.\d+)?)\s*s/i); if (m) ra = m[1]; }
      ra = ra != null && isFinite(+ra) && +ra >= 0 ? Math.min(3600, +ra) : null;
      const net = /network|cors|failed to fetch|load failed|timed? ?out|ECONN|could not reach/i.test(msg);
      return { status: st || null, retryAfter: ra, net, quota: st === 429 || st === 402 || st === 403, retry: st === 429 || st === 402 || st === 403 || (st >= 500 && st < 600) || net, msg: msg.slice(0, 200) };
    }
    function setCool(k, info) {
      const c = cools(); const prev = c[k] || {}; const fails = (prev.fails || 0) + 1;
      /* quota errors (429/402/403): escalating ladder 2m → 10m → 1h → 24h by throttle count in the last 24h (freellmapi's scheme);
         5xx / network: 30s doubling, capped at 10 min. A Retry-After header always wins. */
      const hits = (prev.hits || []).filter(t => t > now() - 864e5); if (info.quota) hits.push(now());
      const LADDER = [120, 600, 3600, 86400];
      const secs = info.retryAfter != null ? info.retryAfter : info.quota ? LADDER[Math.min(LADDER.length, hits.length) - 1] : Math.min(600, 30 * Math.pow(2, fails - 1));
      c[k] = { until: now() + secs * 1000, fails, hits, secs, why: (info.status ? 'HTTP ' + info.status : info.net ? 'network' : 'error') + (info.retryAfter != null ? ' · Retry-After ' + info.retryAfter + 's' : '') };
      ctx.data.set('cool', c); return secs;
    }
    function clearCool(k) { const c = cools(); if (k) { if (c[k]) { delete c[k]; ctx.data.set('cool', c); } } else ctx.data.set('cool', {}); refresh(); }

    /* ---------- exact cache ---------- */
    const cacheOn = () => !!ctx.data.get('cacheOn', false);
    const toolNames = tools => (tools || []).map(t => (t.function && t.function.name) || t.name || '').join(',');
    const ckey = o => DS.hash(String(o.model || '') + '\u0001' + JSON.stringify(o.messages || []) + '\u0001' + toolNames(o.tools));
    function cacheAll() { const c = ctx.data.get('cache', {}); for (const k in c) if (c[k].ts < now() - CACHE_TTL) delete c[k]; return c; }
    function cacheGet(k) { const c = cacheAll(); return c[k] || null; }
    function cachePut(k, r, used) {
      const c = cacheAll(); c[k] = { ts: now(), content: r.content || '', reasoning: r.reasoning || '', used };
      const ks = Object.keys(c).sort((a, b) => c[a].ts - c[b].ts); while (ks.length > CACHE_MAX) delete c[ks.shift()];
      ctx.data.set('cache', c);
    }
    const hits = () => ctx.data.get('hits', 0);

    /* ---------- cascade ---------- */
    const cascadeOn = () => !!ctx.data.get('cascadeOn', false);
    function strongCand() {
      const s = ctx.data.get('strong', '');
      if (s) { const i = s.indexOf('|'); return { provider: s.slice(0, i), model: s.slice(i + 1) }; }
      const o = provObj('openai'); if (o && o.available && o.available()) return { provider: 'openai', model: (S().models && S().models.executor) || 'deepseek-chat' };
      const ch = chain(); return ch.length > 1 ? ch[ch.length - 1] : null;
    }
    const REFUSE = /^\s*(i'?m sorry|i am sorry|sorry, (but )?i can|i can(no|')t (help|assist|do)|i('m| am) (unable|not able)|as an ai\b)/i;
    function weak(r) {
      const calls = (r && r.toolCalls) || [];
      for (const tc of calls) { if (tc.args == null) return 'tool call had no parsable arguments'; if (typeof tc.raw === 'string' && tc.raw.trim()) { try { JSON.parse(tc.raw); } catch (_) { return 'tool call JSON did not parse'; } } }
      if (calls.length) return '';
      const t = String((r && r.content) || '').trim();
      if (!t) return 'empty reply'; if (t.length < 12) return 'very short reply (' + t.length + ' chars)';
      if (REFUSE.test(t)) return 'looks like a refusal';
      return '';
    }

    /* ---------- the router ---------- */
    async function attempt(cands, opts, buffer, tried) {
      for (const c of cands) {
        const k = keyOf(c); const left = coolLeft(k);
        if (left) { tried.push({ key: k, result: 'cooldown', secs: left }); continue; }
        const p = provObj(c.provider);
        if (!p || p.id === 'auto') { tried.push({ key: k, result: 'missing' }); continue; }
        if (p.available && !p.available()) { tried.push({ key: k, result: 'unavailable' }); continue; }
        let started = false; const buf = { content: '', reasoning: '' }; const t0 = now();
        const onDelta = d => {
          if (!d) return; if (d.content || d.reasoning || d.toolDelta) started = true;
          if (buffer) { if (d.content) buf.content += d.content; if (d.reasoning) buf.reasoning += d.reasoning; return; }
          opts.onDelta && opts.onDelta(d);
        };
        try {
          const r = await p.stream(Object.assign({}, opts, { model: c.model, forceModel: c.model, onDelta }));
          const cc = cools(); if (cc[k]) { delete cc[k]; ctx.data.set('cool', cc); }
          tried.push({ key: k, result: 'ok', ms: now() - t0 });
          return { r: r || { content: buf.content, reasoning: '', toolCalls: [], usage: null }, c, buf };
        } catch (e) {
          if (e && e.name === 'AbortError') throw e;
          const info = classify(e);
          if (started && !buffer) { /* text already reached the user: never retry (no duplicate output) */
            tried.push({ key: k, result: 'failed-mid-stream', status: info.status, error: info.msg });
            if (info.retry) setCool(k, info); e.routerTried = tried; throw e;
          }
          if (info.retry) tried.push({ key: k, result: 'cooldown-set', status: info.status, secs: setCool(k, info), error: info.msg });
          else tried.push({ key: k, result: 'error', status: info.status, error: info.msg });
        }
      }
      return null;
    }
    function record(rec) {
      last = rec; history.unshift(rec); history.length = Math.min(history.length, 20);
      try { ctx.emit('router:decision', rec); } catch (_) {}
      try { DS.bus.emit('status:refresh'); } catch (_) {}
      refresh();
    }
    function fail(tried, tid) {
      const sum = tried.map(t => t.key + ' ' + t.result + (t.secs ? ' ' + t.secs + 's' : '') + (t.error ? ' (' + t.error.slice(0, 90) + ')' : '')).join('; ') || 'chain is empty';
      record({ thread: tid, ts: now(), tried, used: null, mode: 'failed' });
      const err = new Error('Router: no candidate answered — ' + sum + '. Edit the chain or clear cooldowns in Settings → Router (/router).');
      err.routerTried = tried; return err;
    }
    async function stream(opts) {
      opts = opts || {}; const tid = (opts.thread && opts.thread.id) || 'none';
      const base = chain().slice(); const tried = [];
      if (!base.length) throw fail(tried, tid);
      const st = sticky[tid]; let isSticky = false;
      if (st && st.until > now()) { const i = base.findIndex(c => keyOf(c) === st.key); if (i >= 0) { isSticky = true; if (i > 0) base.unshift(base.splice(i, 1)[0]); } }
      const ck = cacheOn() ? ckey(opts) : null;
      if (ck) {
        const h = cacheGet(ck);
        if (h) {
          ctx.data.set('hits', hits() + 1);
          if (h.reasoning && opts.onDelta) opts.onDelta({ reasoning: h.reasoning });
          if (opts.onDelta) opts.onDelta({ content: h.content });
          record({ thread: tid, ts: now(), tried: [{ key: 'cache', result: 'hit' }], used: 'cache:' + (h.used || '?'), mode: 'cache' });
          return { content: h.content, reasoning: h.reasoning || '', toolCalls: [], usage: null };
        }
      }
      let a, mode = 'failover', escalated = '';
      if (cascadeOn()) {
        mode = 'cascade';
        a = await attempt(base, opts, true, tried);
        if (!a) throw fail(tried, tid);
        const why = weak(a.r); const strong = strongCand();
        if (why && strong && keyOf(strong) !== keyOf(a.c)) {
          escalated = why;
          const b = await attempt([strong], opts, false, tried).catch(e => { e.routerTried = tried; record({ thread: tid, ts: now(), tried, used: null, mode, escalated }); throw e; });
          if (b) a = b; else escalated += ' — strong model unavailable, kept cheap reply';
        }
        if (a.buf && !(escalated && a.c && keyOf(a.c) === keyOf(strong || {})) && opts.onDelta) { /* flush buffered cheap reply */
          if (a.buf.reasoning) opts.onDelta({ reasoning: a.buf.reasoning });
          const t = a.buf.content || (a.r && a.r.content) || ''; if (t) opts.onDelta({ content: t });
        }
      } else {
        a = await attempt(base, opts, false, tried);
        if (!a) throw fail(tried, tid);
      }
      const used = keyOf(a.c);
      sticky[tid] = { key: used, until: now() + STICKY_MS };
      record({ thread: tid, ts: now(), tried, used, mode, sticky: isSticky && tried.length && tried[0].key === used, escalated: escalated || null });
      if (ck && a.r && !(a.r.toolCalls && a.r.toolCalls.length) && String(a.r.content || '').trim()) cachePut(ck, a.r, used);
      return a.r;
    }
    ctx.provider({ id: 'auto', label: 'Auto · free failover', order: 15, models: ['auto'], route: 'router', available: () => chain().length > 0, stream });

    /* ---------- control ---------- */
    const active = () => S().provider === 'auto' && !S().forceSim;
    let prev = null;
    function use(on) {
      const s = S();
      if (on) { if (s.provider !== 'auto') prev = s.provider; s.provider = 'auto'; s.forceSim = false; }
      else { const M0 = M(); const back = prev && prev !== 'auto' ? prev : 'sim'; try { if (M0) M0.select(back); else s.provider = back; } catch (_) { s.provider = 'sim'; s.forceSim = true; } }
      try { DS.store.save && DS.store.save(); } catch (_) {}
      try { DS.bus.emit('status:refresh'); } catch (_) {} refresh();
    }
    function explain() {
      return {
        active: active(), stickyMinutes: 10,
        chain: chain().map((c, i) => ({ n: i + 1, key: keyOf(c), route: c.route || '', state: coolLeft(keyOf(c)) ? 'cooldown ' + coolLeft(keyOf(c)) + 's' : (provObj(c.provider) && (!provObj(c.provider).available || provObj(c.provider).available()) ? 'ready' : 'unavailable') })),
        cooldowns: Object.entries(cools()).filter(([, v]) => v.until > now()).map(([k, v]) => ({ key: k, secs: Math.ceil((v.until - now()) / 1000), why: v.why })),
        sticky: Object.entries(sticky).filter(([, v]) => v.until > now()).map(([t, v]) => ({ thread: t, key: v.key, mins: Math.ceil((v.until - now()) / 60e3) })),
        cache: { on: cacheOn(), hits: hits(), entries: Object.keys(cacheAll()).length },
        cascade: { on: cascadeOn(), strong: strongCand() ? keyOf(strongCand()) : null },
        customChain: !!custom(), last
      };
    }
    function explainMd(x) {
      x = x || explain();
      let s = '**Router** — ' + (x.active ? 'provider **auto** is active' : 'not active (`/router on` to use it)') + '\n\n| # | candidate | route | state |\n|---|---|---|---|\n';
      s += x.chain.map(c => '| ' + c.n + ' | `' + c.key + '` | ' + (c.route || '—') + ' | ' + c.state + ' |').join('\n') || '| – | (empty chain) | | |';
      s += '\n\n**Cooldowns:** ' + (x.cooldowns.length ? x.cooldowns.map(c => '`' + c.key + '` ' + c.secs + 's (' + c.why + ')').join(', ') : 'none');
      s += '\n\n**Cache:** ' + (x.cache.on ? 'on' : 'off') + ' · ' + x.cache.hits + ' hits · ' + x.cache.entries + ' entries  ·  **Cascade:** ' + (x.cascade.on ? 'on → strong `' + (x.cascade.strong || 'none') + '`' : 'off');
      if (x.last) s += '\n\n**Last route:** ' + (x.last.used ? '`' + x.last.used + '`' : 'failed') + ' via ' + x.last.mode + (x.last.escalated ? ' (escalated: ' + x.last.escalated + ')' : '') + ' — tried ' + x.last.tried.map(t => t.key + ':' + t.result).join(', ');
      return s + '\n\nOn HTTP 429/5xx/network errors a candidate cools down (Retry-After if given, else 30s→10min) and the next one is tried; it never retries once text has streamed.';
    }
    ctx.provide('forge.router', { last: () => last, history: () => history.slice(), chain, setChain, resetChain: () => { ctx.data.del('chain'); refresh(); }, cooldowns: () => explain().cooldowns, clearCooldowns: () => clearCool(), use, active, explain, classify, sticky: () => Object.assign({}, sticky),
      cache: { on: cacheOn, set: v => { ctx.data.set('cacheOn', !!v); refresh(); }, hits, clear: () => { ctx.data.set('cache', {}); ctx.data.set('hits', 0); refresh(); } },
      cascade: { on: cascadeOn, set: v => { ctx.data.set('cascadeOn', !!v); refresh(); }, strong: strongCand, setStrong: k => { ctx.data.set('strong', k || ''); refresh(); } } });

    /* ---------- UI ---------- */
    ctx.effect(() => {
      const st = document.createElement('style');
      st.textContent = '.rt-li{display:flex;align-items:center;gap:6px;padding:6px 0;border-bottom:1px solid var(--line)}.rt-li .nm{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:var(--mono);font-size:12px}.rt-li .icon-btn{min-width:36px;min-height:36px}.rt-sw{display:flex;align-items:center;gap:8px;min-height:40px}.rt-sw input{width:20px;height:20px;accent-color:var(--accent)}.rt-tbl{display:flex;flex-direction:column;gap:2px;font-size:12px}.rt-tbl .r{display:flex;gap:6px;align-items:center}.rt-tbl .k{font-family:var(--mono);flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}';
      document.head.appendChild(st); return () => st.remove();
    });
    function chip(state) { const cls = /^ready|ok/.test(state) ? 'ok' : /cool/.test(state) ? 'warn' : 'err'; return '<span class="chip ' + cls + '">' + esc(state) + '</span>'; }
    function render(el) {
      const x = explain(); const ch = chain();
      const inChain = new Set(ch.map(keyOf));
      const opts = catalog().filter(c => c.provider !== 'sim' && !inChain.has(keyOf({ provider: c.provider, model: c.id }))).slice(0, 300);
      el.innerHTML = '<div class="field"><label>Provider</label><div class="row" style="gap:8px;flex-wrap:wrap"><span class="chip ' + (x.active ? 'acc' : '') + '">' + (x.active ? 'Auto active' : 'Auto off') + '</span><button class="btn sm ' + (x.active ? '' : 'pri') + '" data-a="use">' + (x.active ? 'Turn off' : 'Use Auto') + '</button></div><div class="hint">Auto tries the chain top→down. Failures with HTTP 429/5xx or network errors cool down (Retry-After, else 30s doubling to 10 min). The last good route is reused per thread for 10 min. Text is never re-sent once it began streaming.</div></div>' +
        '<div class="sec-t">Chain ' + (x.customChain ? '(custom)' : '(free/keyless defaults)') + '</div><div class="rt-chain">' +
        (ch.length ? ch.map((c, i) => '<div class="rt-li"><span class="muted xs">' + (i + 1) + '</span><span class="nm" title="' + esc(keyOf(c)) + '">' + esc(keyOf(c)) + '</span>' + chip(x.chain[i].state) + '<button class="icon-btn" data-up="' + i + '" aria-label="Move up">↑</button><button class="icon-btn" data-dn="' + i + '" aria-label="Move down">↓</button><button class="icon-btn" data-rm="' + i + '" aria-label="Remove">' + DS.icon('x') + '</button></div>').join('') : '<div class="muted sm">Empty — add a candidate below.</div>') +
        '</div><div class="row" style="gap:6px;margin-top:8px;flex-wrap:wrap"><select class="sel" data-add style="flex:1;min-width:0">' + opts.map(c => '<option value="' + esc(c.provider + '|' + c.id) + '">' + esc(c.provider + ' · ' + c.label + (c.free ? ' · free' : '') + (c.route ? ' · ' + c.route : '')) + '</option>').join('') + '</select><button class="btn sm" data-a="add">Add</button><button class="btn sm" data-a="local">+ Local</button><button class="btn sm" data-a="reset">Reset</button></div>' +
        '<div class="sec-t">Cooldowns</div>' + (x.cooldowns.length ? x.cooldowns.map(c => '<div class="rt-li"><span class="nm">' + esc(c.key) + '</span><span class="chip warn">' + c.secs + 's</span><span class="muted xs">' + esc(c.why) + '</span></div>').join('') : '<div class="muted sm">None.</div>') + '<div class="row" style="margin-top:6px"><button class="btn sm" data-a="clear">Clear cooldowns</button></div>' +
        '<div class="sec-t">Exact cache</div><label class="rt-sw"><input type="checkbox" data-t="cache"' + (x.cache.on ? ' checked' : '') + '> Reuse identical requests for 1 h (text replies only)</label><div class="row" style="gap:8px;align-items:center"><span class="muted sm">' + x.cache.hits + ' hits · ' + x.cache.entries + '/50 entries</span><button class="btn sm" data-a="cclear">Clear</button></div>' +
        '<div class="sec-t">Cascade</div><label class="rt-sw"><input type="checkbox" data-t="cascade"' + (x.cascade.on ? ' checked' : '') + '> Cheap first, escalate if weak</label><div class="hint">The first chain model answers (buffered, so nothing streams twice). An empty, very short (&lt;12 chars) or refusing reply, or tool-call JSON that does not parse, is re-asked to the strong model. Strong: <b class="mono">' + esc(x.cascade.strong || 'none') + '</b></div><div class="row" style="gap:6px"><select class="sel" data-strong style="flex:1;min-width:0"><option value="">auto (DeepSeek if keyed, else last in chain)</option>' + catalog().filter(c => c.provider !== 'sim').slice(0, 300).map(c => { const v = c.provider + '|' + c.id; return '<option value="' + esc(v) + '"' + (ctx.data.get('strong', '') === v ? ' selected' : '') + '>' + esc(c.provider + ' · ' + c.label) + '</option>'; }).join('') + '</select></div>' +
        (x.last ? '<div class="sec-t">Last decision</div><div class="muted sm mono" style="word-break:break-word">' + esc((x.last.used || 'failed') + ' · ' + x.last.mode + (x.last.escalated ? ' · escalated: ' + x.last.escalated : '') + ' · tried ' + x.last.tried.map(t => t.key + ':' + t.result).join(', ')) + '</div>' : '');
      el.onclick = ev => {
        const b = ev.target.closest('button'); if (!b) return; const c = chain().slice();
        if (b.dataset.up != null) { const i = +b.dataset.up; if (i > 0) { [c[i - 1], c[i]] = [c[i], c[i - 1]]; setChain(c); } return; }
        if (b.dataset.dn != null) { const i = +b.dataset.dn; if (i < c.length - 1) { [c[i + 1], c[i]] = [c[i], c[i + 1]]; setChain(c); } return; }
        if (b.dataset.rm != null) { c.splice(+b.dataset.rm, 1); setChain(c); return; }
        const a = b.dataset.a;
        if (a === 'use') use(!active());
        else if (a === 'add') { const v = el.querySelector('[data-add]').value; if (!v) return; const i = v.indexOf('|'); const e = catalog().find(z => z.provider === v.slice(0, i) && z.id === v.slice(i + 1)); c.push({ provider: v.slice(0, i), model: v.slice(i + 1), route: (e && e.route) || '' }); setChain(c); }
        else if (a === 'local') { const add = catalog().filter(z => z.route === 'local' && !c.some(y => keyOf(y) === keyOf({ provider: z.provider, model: z.id }))); const seen = new Set(c.map(y => y.provider)); add.forEach(z => { if (!seen.has(z.provider)) { seen.add(z.provider); c.push({ provider: z.provider, model: z.id, route: 'local' }); } }); setChain(c); ctx.toast(add.length ? 'Added local runtimes (Ollama / LM Studio must be running)' : 'No local runtimes in the catalog', add.length ? 'ok' : 'warn'); }
        else if (a === 'reset') { ctx.data.del('chain'); refresh(); }
        else if (a === 'clear') clearCool();
        else if (a === 'cclear') { ctx.data.set('cache', {}); ctx.data.set('hits', 0); refresh(); }
      };
      el.onchange = ev => {
        const t = ev.target;
        if (t.dataset.t === 'cache') { ctx.data.set('cacheOn', t.checked); refresh(); }
        else if (t.dataset.t === 'cascade') { ctx.data.set('cascadeOn', t.checked); refresh(); }
        else if (t.dataset.strong != null) { ctx.data.set('strong', t.value); refresh(); }
      };
    }
    function refresh() { for (const el of [...views]) { if (!el.isConnected) { views.delete(el); continue; } try { render(el); } catch (e) { ctx.log('warn', 'router render: ' + e.message); } } }
    ctx.settings({ id: 'router', title: 'Router', render(el) { views.add(el); render(el); } });
    function openSheet() { const node = document.createElement('div'); views.add(node); render(node); DS.ui.sheet({ title: 'Router · free failover', node }); }
    ctx.status({ id: 'router', align: 'left', text: () => { if (!active()) return ''; const u = last && last.used; return '⇄ ' + (u ? (u.startsWith('cache:') ? 'cache' : u.split('|')[0]) + (last.mode === 'cascade' && last.escalated ? ' ↑' : '') : 'auto'); }, onClick: openSheet });
    ctx.on('models:change', () => refresh());

    ctx.command({ name: 'router', args: '[on|off|reset|clear]', desc: 'Show the Auto failover chain + cooldowns (on/off/reset/clear)', run(arg, cctx) {
      const a = String(arg || '').trim().toLowerCase();
      if (a === 'on') use(true); else if (a === 'off') use(false); else if (a === 'reset') { ctx.data.del('chain'); refresh(); } else if (a === 'clear') clearCool();
      else if (a === 'open' || a === 'settings') openSheet();
      cctx.reply(explainMd());
    } });
    ctx.tool({ name: 'router_explain', description: 'Show the Auto router failover chain, cooldowns, sticky routes, cache and cascade state.', parameters: { type: 'object', properties: {} }, gate: 'read', label: 'Router chain',
      run: () => explain(), summarize: (_, r) => (r && r.chain ? r.chain.length + ' candidates · ' + r.cooldowns.length + ' cooling' : ''),
      inline(part, el) {
        const r = part.result && (typeof part.result === 'string' ? (() => { try { return JSON.parse(part.result); } catch (_) { return null; } })() : part.result); if (!r || !r.chain) return;
        el.innerHTML = '<div class="rt-tbl">' + r.chain.map(c => '<div class="r"><span class="muted xs">' + c.n + '</span><span class="k">' + esc(c.key) + '</span>' + chip(c.state) + '</div>').join('') + '</div>';
      } });
    ctx.intent({ id: 'router-explain', order: 50, match: t => /\b(router|failover|fail-over|free fallback|auto route)\b/i.test(t),
      script: () => [{ say: 'Checking the Auto router…\n\n', tool: { name: 'router_explain', args: {} } }, { final: res => explainMd(res[res.length - 1]) }] });
    ctx.suggest({ id: 'router', emoji: '🔀', title: 'Free failover router', sub: 'See the Auto chain, cooldowns & cache', prompt: 'Explain my router failover chain' });
  }
});
