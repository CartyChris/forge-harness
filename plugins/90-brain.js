// forge.brain — persistent learning memory v2
// Memory stream (Park et al. 2023): recency × relevance × importance; BM25 (+ optional MiniLM embeddings, RRF k=60);
// reflections at an importance threshold; ReasoningBank-style strategy/pitfall memory from tool runs.
DS.plugin({
  name: 'forge.brain', title: 'Brain', version: '2.0.0', tags: ['memory', 'learning', 'rag'],
  description: 'Memory stream: recency+relevance+importance scoring, BM25 + optional semantic embeddings, reflections, strategy/pitfall lessons from runs.',
  apply(ctx) {
    const CAP = 400, BUDGET = 800, LESSON_BUDGET = 600, REFLECT_AT = 30, RRF_K = 60, K1 = 1.2, BB = 0.75;
    const CDN = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.1', MODEL = 'Xenova/all-MiniLM-L6-v2';
    const STOP = new Set('the and for with that this from have are was were will would could should about into your their they them then than when what which where while also just like some more most such only other very well here there been being does done make made please want need using used use can you how why who our its not but all any each get got'.split(' '));
    const toks = t => (String(t).toLowerCase().match(/[a-z0-9]{3,}/g) || []).filter(w => !STOP.has(w));
    const tagsOf = t => [...new Set((String(t).toLowerCase().match(/[a-z]{4,}/g) || []).filter(w => !STOP.has(w)))].slice(0, 8);
    const norm = s => String(s).toLowerCase().replace(/\s+/g, ' ').trim();
    const LESSON = new Set(['strategy', 'pitfall']);
    const KIND = b => b.type === 'strategy' ? 'strategy' : b.type === 'pitfall' ? 'pitfall' : b.type === 'insight' ? 'insight' : 'knowledge';

    // ---------- storage
    let cache = null, ver = 0;
    const all = () => { if (!cache) cache = ctx.data.get('entries', []); return cache; };
    const save = list => { cache = list.slice(-CAP); ver++; ctx.data.set('entries', cache); ctx.emit('brain:change'); };
    let touchT = 0; const touchSave = () => { clearTimeout(touchT); touchT = setTimeout(() => ctx.data.set('entries', all()), 400); };
    const weights = () => Object.assign({ rec: 1, rel: 1, imp: 1 }, ctx.data.get('weights', {}));

    function importanceOf(content, type) {
      const s = String(content).toLowerCase(); let n = 3;
      const kw = s.match(/\b(decision|decided|decide|prefer|prefers|preference|always|never|deadline|must|important|critical|remember|rule|policy|password|budget|due)\b/g) || [];
      n += Math.min(4, kw.length ? 2 + kw.length : 0);
      if (s.length > 120) n += 1; if (s.length > 600) n += 1;
      if (type === 'memory') n += 1; if (type === 'pitfall') n += 2; if (type === 'insight') n = Math.max(n, 8);
      return Math.max(1, Math.min(10, n));
    }
    function store(e, opts = {}) {
      const content = String((e && e.content) || '').trim(); if (!content) return null;
      const list = all().slice(); const n = norm(content);
      const dup = list.find(x => norm(x.content) === n);
      if (dup) { dup.quality = Math.max(dup.quality || 0, e.quality ?? 0.7); dup.uses = (dup.uses || 0) + 1; dup.lastAccessed = Date.now(); save(list); return dup; }
      const type = String(e.type || 'knowledge').replace(/[^\w-]/g, '').slice(0, 24) || 'knowledge', now = Date.now();
      const imp = e.importance != null ? Math.max(1, Math.min(10, Math.round(+e.importance) || 5)) : importanceOf(content, type);
      const item = { id: e.id && /^[\w.-]{1,64}$/.test(String(e.id)) && !list.some(x => x.id === e.id) ? String(e.id) : DS.util.uid(), type, title: e.title ? String(e.title).slice(0, 120) : undefined,
        content: content.slice(0, 4000), quality: e.quality ?? 0.7, importance: imp, tags: e.tags && e.tags.length ? e.tags.slice(0, 10) : tagsOf(content),
        created: e.created || now, lastAccessed: e.lastAccessed || e.created || now, uses: e.uses || 0 };
      list.push(item); save(list);
      if (sem.status === 'ready') queueEmbed();
      if (type !== 'insight' && !opts.noReflect) {
        const acc = (ctx.data.get('impSince', 0) || 0) + imp; ctx.data.set('impSince', acc);
        if (acc >= REFLECT_AT && ctx.data.get('autoReflect', true) !== false) setTimeout(() => reflect('auto'), 0);
      }
      return item;
    }

    // ---------- BM25 inverted index (rebuilt lazily on change)
    let idx = null;
    function index() {
      if (idx && idx.ver === ver) return idx;
      const docs = all(), post = new Map(), len = []; let tot = 0;
      docs.forEach((b, i) => {
        const tk = toks((b.title || '') + ' ' + b.content + ' ' + (b.tags || []).join(' ')); len[i] = tk.length; tot += tk.length;
        const tf = new Map(); tk.forEach(t => tf.set(t, (tf.get(t) || 0) + 1));
        tf.forEach((f, t) => { let p = post.get(t); if (!p) post.set(t, p = []); p.push([i, f]); });
      });
      return idx = { ver, docs, post, len, avg: tot / Math.max(1, docs.length) || 1 };
    }
    function bm25(q) {
      const I = index(), N = I.docs.length, sc = new Map();
      for (const t of new Set(toks(q))) {
        const p = I.post.get(t); if (!p) continue;
        const idf = Math.log(1 + (N - p.length + 0.5) / (p.length + 0.5));
        for (const [i, f] of p) sc.set(i, (sc.get(i) || 0) + idf * (f * (K1 + 1)) / (f + K1 * (1 - BB + BB * I.len[i] / I.avg)));
      }
      return sc;
    }

    // ---------- optional semantic embeddings (lazy Transformers.js; never blocks retrieve)
    const sem = { status: 'off', msg: '', pipe: null, qcache: new Map(), busy: false };
    const vecs = () => ctx.data.get('vecs', {});
    function setSem(status, msg) { sem.status = status; sem.msg = msg || ''; ctx.emit('brain:change'); }
    async function enableSemantic() {
      if (sem.status === 'ready' || sem.status === 'loading') return sem.status;
      setSem('loading', 'Loading ' + MODEL + '…');
      try {
        if (typeof navigator !== 'undefined' && navigator.onLine === false) throw new Error('browser is offline');
        const mod = await Promise.race([import(CDN), new Promise((_, rj) => setTimeout(() => rj(new Error('CDN timeout')), 20000))]);
        if (!mod || !mod.pipeline) throw new Error('transformers.js missing pipeline()');
        sem.pipe = await mod.pipeline('feature-extraction', MODEL);
        setSem('ready', 'MiniLM-L6 ready'); queueEmbed(); return 'ready';
      } catch (e) {
        setSem('error', 'Semantic memory unavailable (' + (e && e.message || e) + ') — using BM25 keyword search only.');
        ctx.log('warn', 'brain semantic: ' + sem.msg); return 'error';
      }
    }
    async function embed(text) {
      const out = await sem.pipe(String(text).slice(0, 1000), { pooling: 'mean', normalize: true });
      return Array.from(out.data || out).map(x => Math.round(x * 1e4) / 1e4);
    }
    function queueEmbed() {
      if (sem.busy || sem.status !== 'ready') return; sem.busy = true;
      ctx.setTimeout(async () => {
        try {
          const v = { ...vecs() }; let n = 0; const ids = new Set(all().map(b => b.id));
          for (const b of all()) { if (v[b.id]) continue; v[b.id] = await embed((b.title || '') + ' ' + b.content); if (++n % 8 === 0) await DS.util.sleep(10); }
          Object.keys(v).forEach(k => { if (!ids.has(k)) delete v[k]; });
          ctx.data.set('vecs', v); if (n) ctx.emit('brain:change');
        } catch (e) { setSem('error', 'Embedding failed: ' + e.message); }
        sem.busy = false;
      }, 50);
    }
    async function warmQuery(q) {
      if (sem.status !== 'ready' || !q || sem.qcache.has(q)) return;
      try { sem.qcache.set(q, await embed(q)); if (sem.qcache.size > 50) sem.qcache.delete(sem.qcache.keys().next().value); } catch (e) {}
    }
    const cos = (a, b) => { let s = 0; for (let i = 0; i < a.length && i < b.length; i++) s += a[i] * b[i]; return s; };

    // ---------- memory-stream scoring
    function explain(q, opts = {}) {
      const docs = all(), w = weights(), now = Date.now(), ws = (w.rec + w.rel + w.imp) || 1;
      const types = opts.types ? new Set(opts.types) : null;
      const bs = q ? bm25(q) : new Map();
      const bRank = [...bs.entries()].sort((a, b) => b[1] - a[1]).map(x => x[0]);
      let cRank = [], cs = new Map();
      const qv = q && sem.status === 'ready' ? sem.qcache.get(q) : null;
      if (qv) { const V = vecs(); docs.forEach((b, i) => { if (V[b.id]) { const c = cos(qv, V[b.id]); if (c > 0.25) cs.set(i, c); } }); cRank = [...cs.entries()].sort((a, b) => b[1] - a[1]).map(x => x[0]); }
      const rrf = new Map();
      bRank.forEach((i, r) => rrf.set(i, (rrf.get(i) || 0) + 1 / (RRF_K + r + 1)));
      cRank.forEach((i, r) => rrf.set(i, (rrf.get(i) || 0) + 1 / (RRF_K + r + 1)));
      const maxR = Math.max(1e-9, ...rrf.values());
      const cand = q ? [...rrf.keys()] : docs.map((_, i) => i);
      return cand.filter(i => !types || types.has(docs[i].type)).map(i => {
        const b = docs[i], hrs = Math.max(0, (now - (b.lastAccessed || b.created)) / 36e5);
        const rec = Math.pow(0.995, hrs), rel = q ? (rrf.get(i) || 0) / maxR : 0, imp = (b.importance || importanceOf(b.content, b.type)) / 10;
        const score = (w.rec * rec + w.rel * rel + w.imp * imp) / ws;
        return { item: b, score, rec, rel, imp, bm25: bs.get(i) || 0, cosine: cs.get(i) || 0, hours: hrs };
      }).sort((a, b) => b.score - a.score);
    }
    function retrieve(q, limit = 4, opts = {}) {
      const qs = String(q || ''); if (!toks(qs).length) return [];
      if (sem.status === 'ready' && !sem.qcache.has(qs)) warmQuery(qs);
      const hits = explain(qs, opts).slice(0, limit), now = Date.now();
      if (opts.touch !== false && hits.length) { hits.forEach(h => { h.item.lastAccessed = now; h.item.uses = (h.item.uses || 0) + 1; }); touchSave(); }
      return hits.map(h => h.item);
    }
    function forget(idOrQuery) {
      const list = all(); let keep = list.filter(x => x.id !== idOrQuery);
      if (keep.length === list.length) { const hit = retrieve(idOrQuery, 1, { touch: false })[0]; if (hit) keep = list.filter(x => x.id !== hit.id); }
      const removed = list.length - keep.length;
      if (removed) { const v = { ...vecs() }; list.forEach(x => { if (!keep.includes(x)) delete v[x.id]; }); ctx.data.set('vecs', v); }
      save(keep); return removed;
    }
    function quality(out) {
      const s = String(out || ''); if (s.length < 160) return 0;
      if (/^(error|sorry|i can't|i cannot)/i.test(s.trim())) return 0;
      const len = Math.min(1, s.length / 2000), struct = /(^|\n)(#|\d+\.|- |```)/.test(s) ? 0.2 : 0;
      return Math.min(1, 0.4 + len * 0.4 + struct);
    }

    // ---------- reflection (extractive offline)
    function reflect(why = 'manual') {
      const last = ctx.data.get('lastReflect', 0) || 0;
      let pool = all().filter(b => b.type !== 'insight' && b.created > last);
      if (pool.length < 2) pool = all().filter(b => b.type !== 'insight').slice(-20);
      if (pool.length < 2) return null;
      const tf = new Map();
      pool.forEach(b => new Set(toks((b.title || '') + ' ' + b.content)).forEach(t => { if (!/^\d+$/.test(t)) tf.set(t, (tf.get(t) || 0) + (b.importance || 5)); }));
      const themes = [...tf.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(x => x[0]);
      const top = pool.slice().sort((a, b) => (b.importance || 0) - (a.importance || 0) || b.created - a.created).slice(0, 3);
      const lessons = pool.filter(b => b.type === 'pitfall').length;
      const content = 'Insight: recurring themes — ' + themes.join(', ') + '. Most important: ' +
        top.map(b => '“' + (b.title || b.content).replace(/\s+/g, ' ').slice(0, 90) + '”').join('; ') +
        (lessons ? '. ' + lessons + ' pitfall(s) recorded — check lessons before similar runs.' : '.');
      ctx.data.set('impSince', 0); ctx.data.set('lastReflect', Date.now());
      const it = store({ type: 'insight', content, title: 'Reflection (' + why + ') on ' + pool.length + ' memories', importance: 8, tags: themes.slice(0, 5), quality: 0.8 }, { noReflect: true });
      if (it && why === 'auto') ctx.toast('🧠 New insight: ' + themes.slice(0, 3).join(', '), 'ok', 2600);
      return it;
    }

    function overview(n = 5) {
      const ex = explain('', {});
      const pick = t => ex.filter(x => KIND(x.item) === t).slice(0, n).map(x => x.item);
      return { knowledge: pick('knowledge'), strategy: pick('strategy'), pitfall: pick('pitfall'), insight: pick('insight'), total: all().length };
    }
    const api = { retrieve, store, forget, all, quality, explain, reflect, overview, enableSemantic, semantic: () => ({ status: sem.status, msg: sem.msg, vectors: Object.keys(vecs()).length }) };
    ctx.provide('forge.brain', api);
    ctx.provide('forge.memory', api);
    if (ctx.data.get('semantic', false)) ctx.setTimeout(() => enableSemantic(), 800);

    // ---------- tools
    const short = b => ({ id: b.id, type: b.type, title: b.title, q: +(b.quality || 0).toFixed(2), importance: b.importance, tags: b.tags, content: b.content.slice(0, 400) });
    ctx.tool({ name: 'brain_store', gate: 'none', label: 'Brain store', description: 'Store a fact/insight in long-term memory. Optional importance 1-10 and type (knowledge|insight).',
      parameters: { type: 'object', properties: { content: { type: 'string' }, tags: { type: 'array', items: { type: 'string' } }, quality: { type: 'number' }, importance: { type: 'number' }, type: { type: 'string', enum: ['knowledge', 'insight'] } }, required: ['content'] },
      run: a => { const it = store({ ...a, type: a.type === 'insight' ? 'insight' : 'knowledge' }); return it ? { stored: short(it) } : { error: 'empty content' }; },
      summarize: (a, r) => r && r.stored ? 'stored ★' + r.stored.importance + ' #' + (r.stored.tags || []).slice(0, 3).join(' #') : 'failed' });
    ctx.tool({ name: 'brain_recall', gate: 'none', label: 'Brain recall', description: 'Recall relevant memories for a query (ranked by recency + relevance + importance).',
      parameters: { type: 'object', properties: { query: { type: 'string' }, limit: { type: 'number' } }, required: ['query'] },
      run: a => { const r = retrieve(a.query, a.limit || 5); return { count: r.length, memories: r.map(short) }; },
      summarize: (a, r) => (r && r.count || 0) + ' memories' });
    ctx.tool({ name: 'brain_forget', gate: 'none', label: 'Brain forget', description: 'Forget a memory by id or best match for text.',
      parameters: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
      run: a => ({ removed: forget(a.id) }) });
    ctx.tool({ name: 'memory_add', gate: 'none', label: 'Memory add', description: 'Add a user preference/fact to memory (always injected when relevant).',
      parameters: { type: 'object', properties: { text: { type: 'string' }, importance: { type: 'number' } }, required: ['text'] },
      run: a => { const it = store({ content: a.text, type: 'memory', quality: 0.9, importance: a.importance }); return it ? { added: short(it) } : { error: 'empty' }; } });
    ctx.tool({ name: 'memory_list', gate: 'none', label: 'Memory list', description: 'List stored memories.',
      parameters: { type: 'object', properties: { type: { type: 'string' } } },
      run: a => { const l = all().filter(x => !a.type || x.type === a.type); return { count: l.length, items: l.slice(-30).reverse().map(short) }; } });
    ctx.tool({ name: 'brain_reflect', gate: 'none', label: 'Brain reflect', description: 'Synthesize an "Insight" reflection item from recent memories (extractive).',
      parameters: { type: 'object', properties: {} },
      run: () => { const it = reflect('manual'); return it ? { insight: short(it) } : { error: 'not enough memories to reflect on' }; },
      summarize: (a, r) => r && r.insight ? 'new insight' : 'nothing to reflect' });
    ctx.tool({ name: 'brain_overview', gate: 'none', label: 'Brain overview', description: 'What the agent has learned: top knowledge, strategies, pitfalls and insights.',
      parameters: { type: 'object', properties: { limit: { type: 'number' } } },
      run: a => { const o = overview(a.limit || 4); return { total: o.total, knowledge: o.knowledge.map(short), strategies: o.strategy.map(short), pitfalls: o.pitfall.map(short), insights: o.insight.map(short) }; },
      summarize: (a, r) => (r && r.total || 0) + ' memories' });

    // ---------- injection (memory + lessons; context-rot guard caps both)
    function minimal() { try { const s = ctx.service('forge.steering'); const g = s && s.get && s.get(); return !!(g && (g.context_policy === 'minimal' || g.contextPolicy === 'minimal')); } catch (e) { return false; } }
    const clip = (s, n) => s.replace(/\s+/g, ' ').slice(0, n);
    function lessonsBlock(q) {
      const hits = retrieve(q, 4, { types: ['strategy', 'pitfall'] }); if (!hits.length) return '';
      let txt = 'Lessons from earlier runs:\n';
      for (const h of hits) { const line = '- ' + (h.type === 'pitfall' ? '⚠ ' : '✓ ') + clip(h.content, 200) + '\n'; if (txt.length + line.length > LESSON_BUDGET) break; txt += line; }
      return txt;
    }
    function memoryBlock(q) {
      const hits = retrieve(q, 4, { types: ['knowledge', 'memory', 'output', 'insight'] }); if (!hits.length) return '';
      let txt = '[Brain — relevant memories]\n';
      for (const h of hits) { const line = '- ' + clip(h.content, 220) + '\n'; if (txt.length + line.length > BUDGET) break; txt += line; }
      return txt;
    }
    ctx.hook('beforeModel', async p => {
      if (ctx.data.get('inject', true) === false || minimal()) return;
      const msgs = p.messages || []; const last = [...msgs].reverse().find(m => m.role === 'user');
      if (!last) return; const q = typeof last.content === 'string' ? last.content : JSON.stringify(last.content || '');
      if (sem.status === 'ready') await Promise.race([warmQuery(q), DS.util.sleep(800)]);
      const sysIdx = msgs.findIndex(m => m.role === 'system');
      if (sysIdx >= 0 && typeof msgs[sysIdx].content === 'string' && msgs[sysIdx].content.includes('[Brain — ')) return;
      const txt = [memoryBlock(q), ctx.data.get('lessons', true) !== false ? lessonsBlock(q) : ''].filter(Boolean).join('\n');
      if (!txt) return;
      if (sysIdx >= 0 && typeof msgs[sysIdx].content === 'string') msgs[sysIdx] = { ...msgs[sysIdx], content: msgs[sysIdx].content + '\n\n' + txt };
      else msgs.unshift({ role: 'system', content: txt });
    });
    let lastQ = '';
    ctx.hook('user:message', p => { lastQ = (p && (p.text || p.content)) || ''; });
    ctx.hook('run:start', p => { if (p && p.text) lastQ = p.text; });
    const SELF = /^(brain_|memory_)/;
    function learnFromRun(th, msg) {
      const parts = (msg && msg.parts) || [];
      const tools = parts.filter(x => x.type === 'tool' && !SELF.test(x.name || ''));
      if (!tools.length) return null;
      const title = clip(lastQ || (th && th.title) || 'task', 70);
      const mark = t => t.name + (t.status === 'ok' ? ' ✓' : ' ✗' + (t.status && t.status !== 'err' ? '(' + t.status + ')' : ''));
      const seq = tools.map(mark).join(' → ');
      const bad = tools.filter(t => t.status !== 'ok');
      const out = {};
      const text = parts.filter(x => x.type === 'text').map(x => x.text || '').join(' ') || (typeof msg.content === 'string' ? msg.content : '');
      if (!bad.length && !msg.meta?.aborted && text.trim()) // Voyager-style: only keep verified successes
        out.strategy = store({ type: 'strategy', title, content: 'For “' + title + '”: ' + seq + ' — all tools succeeded.', importance: 5, tags: [...new Set(tools.map(t => t.name))].concat(tagsOf(title)).slice(0, 8), quality: 0.8 });
      if (bad.length) {
        const why = bad.map(t => { const r = t.result; const e = r && (r.error || r.reason) || t.summary || t.status; return t.name + ': ' + clip(String(typeof e === 'string' ? e : JSON.stringify(e)), 90); }).join('; ');
        out.pitfall = store({ type: 'pitfall', title, content: 'Pitfall on “' + title + '”: ' + why + '. Sequence: ' + seq + '. Verify inputs/permissions before retrying.', tags: [...new Set(bad.map(t => t.name))].concat(tagsOf(title)).slice(0, 8), quality: 0.8 });
      }
      return out;
    }
    ctx.hook('run:end', p => {
      try {
        const th = (p && p.thread) || ctx.thread(); const ms = (th && th.messages) || [];
        const a = (p && p.msg) || [...ms].reverse().find(m => m.role === 'assistant'); if (!a) return;
        if (ctx.data.get('strategies', true) !== false) learnFromRun(th, a);
        if (ctx.data.get('reflect', true) === false) return;
        const text = typeof a.content === 'string' && a.content ? a.content : (a.parts || []).filter(x => x.type === 'text').map(x => x.text).join('\n');
        if ((a.parts || []).some(x => x.type === 'tool' && x.status !== 'ok')) return;
        const q = quality(text); if (q < 0.5) return;
        store({ type: 'output', content: text, quality: q, tags: tagsOf(lastQ || text) });
      } catch (e) { ctx.log('warn', 'brain run:end: ' + e.message); }
    });

    // ---------- commands
    ctx.command({ name: 'remember', args: '<text>', desc: 'Save to brain memory', run: (t, c) => { const it = store({ content: t, type: 'memory', quality: 0.9 }); c.reply(it ? '🧠 Remembered (★' + it.importance + '): _' + DS.util.esc(it.content.slice(0, 120)) + '_' : 'Nothing to remember.'); } });
    ctx.command({ name: 'recall', args: '<query>', desc: 'Recall memories', run: (t, c) => { const r = explain(t).slice(0, 6); c.reply(r.length ? '**Recall: ' + DS.util.esc(t) + '**\n' + r.map(h => '- ' + h.item.content.slice(0, 160).replace(/\n/g, ' ') + ' `' + h.item.type + ' ' + h.score.toFixed(2) + '`').join('\n') : 'No memories match.'); } });
    ctx.command({ name: 'forget', args: '<id|text>', desc: 'Forget a memory', run: (t, c) => c.reply('Removed ' + forget(t.trim()) + ' memor(ies).') });
    ctx.command({ name: 'reflect', args: '[model]', desc: 'Create an Insight from recent memories (add “model” to ask the live model)', run: (t, c) => {
      const live = DS.providers && DS.providers.isLive && DS.providers.isLive();
      if (/model/i.test(t) && live) {
        const mem = all().slice(-25).map(b => '- [' + b.type + ' ★' + b.importance + '] ' + clip(b.content, 160)).join('\n');
        return c.send('Reflect on these memories. Identify 2-3 higher-level insights and save each with brain_store (type "insight", importance 8), starting with "Insight:".\n' + mem);
      }
      const it = reflect('manual'); c.reply(it ? '💡 **' + DS.util.esc(it.content) + '**' + (/model/i.test(t) ? '\n\n_(No live model selected — used offline extractive reflection.)_' : '') : 'Not enough memories to reflect on yet.');
    } });
    ctx.mention({ id: 'memory', search: q => retrieve(q || 'memory', 6, { touch: false }).concat(q ? [] : all().slice(-6)).slice(0, 6).map(b => ({ label: '@memory ' + b.content.slice(0, 40), desc: b.type, attach: { name: 'memory-' + b.id.slice(0, 6), text: () => b.content } })) });

    // ---------- view
    DS.icons.brain = DS.icons.brain || '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 4a3 3 0 0 0-3 3 3 3 0 0 0-2 5 3 3 0 0 0 2 5 3 3 0 0 0 6 1V5a2 2 0 0 0-3-1z"/><path d="M15 4a3 3 0 0 1 3 3 3 3 0 0 1 2 5 3 3 0 0 1-2 5 3 3 0 0 1-6 1"/></svg>';
    ctx.effect(() => { const s = document.createElement('style'); s.textContent = `
.br-q{height:4px;border-radius:2px;background:var(--line);overflow:hidden;margin-top:6px}.br-q>i{display:block;height:100%;background:var(--accent)}
.br-tags,.br-f{display:flex;flex-wrap:wrap;gap:6px;margin:6px 0}.br-it{padding:10px 12px;margin-bottom:8px;cursor:pointer}
.br-it p{margin:4px 0;font-size:13px;word-break:break-word;white-space:pre-wrap;max-height:90px;overflow:hidden}
.br-it.k-insight{border-left:3px solid var(--violet);background:linear-gradient(90deg,var(--accent-soft),transparent 60%)}
.br-it.k-pitfall{border-left:3px solid var(--warn)}.br-it.k-strategy{border-left:3px solid var(--ok)}
.br-it .ti{font-weight:600;font-size:13px}.br-st{color:var(--warn);letter-spacing:1px;font-size:12px}.br-st i{color:var(--line-2);font-style:normal}
.br-bar{display:flex;gap:8px;padding:10px 16px 4px;flex-wrap:wrap}.br-bar .inp{flex:1 1 100%;min-width:0}.br-bar .btn{min-height:40px}
.br-f button{min-height:36px}.br-sem{padding:0 16px;font-size:12px}.br-sem.err{color:var(--warn)}
.br-bk{display:grid;grid-template-columns:auto 1fr auto;gap:6px 10px;align-items:center;font-size:13px}.br-bk b{font-family:var(--mono);font-weight:500}
.br-bk .m{height:6px;border-radius:3px;background:var(--line);overflow:hidden}.br-bk .m>i{display:block;height:100%;background:var(--accent)}`; document.head.appendChild(s); return () => s.remove(); });
    const stars = n => { const k = Math.round((n || 0) / 2); return '<span class="br-st" title="importance ' + n + '/10">' + '★'.repeat(k) + '<i>' + '★'.repeat(5 - k) + '</i></span>'; };
    const chipCls = { knowledge: '', strategy: 'ok', pitfall: 'warn', insight: 'acc' };
    function breakdown(b, q) {
      const x = (q ? explain(q) : explain('')).find(h => h.item.id === b.id) || { score: 0, rec: Math.pow(0.995, (Date.now() - (b.lastAccessed || b.created)) / 36e5), rel: 0, imp: (b.importance || 0) / 10, bm25: 0, cosine: 0, hours: (Date.now() - (b.lastAccessed || b.created)) / 36e5 };
      const w = weights(), row = (l, v, d) => `<span>${l}</span><div class="m"><i style="width:${Math.round(Math.min(1, v) * 100)}%"></i></div><b>${d}</b>`;
      const node = DS.util.el('div', {}, `<div class="br-bk">${row('Recency', x.rec, x.rec.toFixed(3))}${row('Relevance', x.rel, q ? x.rel.toFixed(3) : 'n/a')}${row('Importance', x.imp, (b.importance || 0) + '/10')}${row('Total', x.score, x.score.toFixed(3))}</div>
        <p class="xs muted" style="margin-top:10px">score = (${w.rec}·0.995^${x.hours.toFixed(1)}h + ${w.rel}·relevance + ${w.imp}·importance/10) / ${w.rec + w.rel + w.imp}. ${q ? 'Query “' + DS.util.esc(q) + '”: BM25 ' + x.bm25.toFixed(2) + (sem.status === 'ready' ? ', cosine ' + x.cosine.toFixed(2) : ', embeddings off') + ', fused by RRF (k=60).' : 'Type a search to see relevance.'}</p>
        <p class="xs muted">${DS.util.esc(b.type)} · created ${DS.util.fmtAgo ? DS.util.fmtAgo(b.created) : ''} · used ${b.uses || 0}× · id <span class="mono">${b.id.slice(0, 8)}</span></p><div class="md sm" style="white-space:pre-wrap;word-break:break-word">${DS.util.esc(b.content)}</div>`);
      DS.ui.sheet({ title: b.title || 'Memory', node, actions: [{ label: 'Forget', danger: true, onClick: c => { forget(b.id); c(); } }, { label: 'Close', primary: true, onClick: c => c() }] });
    }
    ctx.view({ id: 'brain', title: 'Brain', icon: 'brain', order: 85, badge: () => String(all().length || ''),
      mount(el) {
        el.innerHTML = '<div class="vhead"><h2>Brain</h2><span class="muted sm br-count"></span></div><div class="br-bar"><input class="inp br-s" placeholder="Search memories (ranked)…"><button class="btn sm br-add">Add</button><button class="btn sm br-ref">Reflect</button><button class="btn sm br-exp">Export</button><button class="btn sm br-imp">Import</button></div><div class="br-f" style="padding:0 16px"></div><div class="br-sem muted"></div><div class="br-tags" style="padding:0 16px"></div><div class="vscroll br-list" style="padding:0 16px 16px"></div>';
        const $ = s => el.querySelector(s); let tag = '', kind = 'all';
        const draw = () => {
          const q = $('.br-s').value.trim(); let l = q ? explain(q).map(h => h.item) : all().slice().reverse();
          const cnt = { all: all().length }; all().forEach(b => { const k = KIND(b); cnt[k] = (cnt[k] || 0) + 1; });
          if (kind !== 'all') l = l.filter(b => KIND(b) === kind);
          if (tag) l = l.filter(b => (b.tags || []).includes(tag));
          $('.br-count').textContent = all().length + ' entries';
          $('.br-f').innerHTML = ['all', 'knowledge', 'strategy', 'pitfall', 'insight'].map(k => `<button class="chip${k === kind ? ' acc' : ''}" data-k="${k}">${k} ${cnt[k] || 0}</button>`).join('');
          const s = api.semantic(); $('.br-sem').className = 'br-sem muted' + (s.status === 'error' ? ' err' : '');
          $('.br-sem').textContent = s.status === 'off' ? 'Keyword (BM25) ranking · enable Semantic memory in Settings → Brain' : s.status === 'ready' ? '🧬 Semantic + BM25 hybrid · ' + s.vectors + ' vectors' : s.msg;
          const tc = {}; all().forEach(b => (b.tags || []).forEach(t => tc[t] = (tc[t] || 0) + 1));
          $('.br-tags').innerHTML = Object.entries(tc).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([t, n]) => `<button class="chip${t === tag ? ' acc' : ''}" data-t="${DS.util.esc(t)}">#${DS.util.esc(t)} ${n}</button>`).join('');
          $('.br-list').innerHTML = l.length ? l.slice(0, 120).map(b => { const k = KIND(b); return `<div class="card br-it k-${k}" data-id="${DS.util.esc(String(b.id))}"><div class="row"><span class="chip ${chipCls[k]}">${k === 'insight' ? '💡 ' : k === 'pitfall' ? '⚠ ' : ''}${DS.util.esc(String(b.type))}</span>${stars(b.importance)}<span class="grow"></span><span class="xs muted">${DS.util.fmtAgo ? DS.util.fmtAgo(b.created) : ''}</span><button class="icon-btn br-del" title="Delete">${DS.icon('trash')}</button></div>${b.title ? '<div class="ti">' + DS.util.esc(b.title) + '</div>' : ''}<p>${DS.util.esc(b.content.slice(0, 400))}</p><div class="xs muted">${(b.tags || []).map(t => '#' + DS.util.esc(t)).join(' ')}</div><div class="br-q"><i style="width:${Math.round((b.quality || 0) * 100)}%"></i></div></div>`; }).join('') : '<div class="empty-v">No memories here yet. Try <span class="mono">/remember I prefer TypeScript</span> or run a task with tools.</div>';
        };
        $('.br-s').oninput = DS.util.debounce ? DS.util.debounce(draw, 120) : draw;
        $('.br-f').onclick = e => { const b = e.target.closest('[data-k]'); if (b) { kind = b.dataset.k; draw(); } };
        $('.br-tags').onclick = e => { const b = e.target.closest('[data-t]'); if (b) { tag = tag === b.dataset.t ? '' : b.dataset.t; draw(); } };
        $('.br-list').onclick = e => {
          const card = e.target.closest('[data-id]'); if (!card) return;
          if (e.target.closest('.br-del')) { forget(card.dataset.id); draw(); return; }
          const b = all().find(x => x.id === card.dataset.id); if (b) breakdown(b, $('.br-s').value.trim());
        };
        $('.br-add').onclick = async () => { const t = await DS.ui.promptText('Remember…', ''); if (t) { store({ content: t, type: 'memory', quality: 0.9 }); draw(); } };
        $('.br-ref').onclick = () => { const it = reflect('manual'); ctx.toast(it ? '💡 Insight created' : 'Not enough memories yet', it ? 'ok' : 'warn'); draw(); };
        $('.br-exp').onclick = () => DS.util.download('forge-brain.json', JSON.stringify({ format: 'forge-brain/2', exported: new Date().toISOString(), entries: all() }, null, 1), 'application/json');
        $('.br-imp').onclick = () => { const i = document.createElement('input'); i.type = 'file'; i.accept = '.json,application/json'; i.onchange = async () => { try { const n = importJSON(await i.files[0].text()); ctx.toast('Imported ' + n, 'ok'); draw(); } catch (e) { ctx.toast('Import failed: ' + e.message, 'err'); } }; i.click(); };
        const off = DS.bus && DS.bus.on ? DS.bus.on('brain:change', draw) : null;
        draw(); return () => { if (typeof off === 'function') off(); };
      } });
    function importJSON(txt) {
      const j = JSON.parse(txt); const arr = Array.isArray(j) ? j : (j && Array.isArray(j.entries) ? j.entries : []);
      let n = 0; arr.forEach(x => { if (x && x.content && store(x, { noReflect: true })) n++; }); return n;
    }
    api.importJSON = importJSON;
    ctx.settings({ id: 'brain', title: 'Brain', render(el) {
      const w = weights();
      el.innerHTML = `<label class="row"><input type="checkbox" class="b-i"> Inject relevant memories (≤${BUDGET} chars)</label>
        <label class="row"><input type="checkbox" class="b-l"> Inject “Lessons from earlier runs” (≤${LESSON_BUDGET} chars)</label>
        <label class="row"><input type="checkbox" class="b-s"> Learn strategies &amp; pitfalls from tool runs</label>
        <label class="row"><input type="checkbox" class="b-r"> Auto-store high-quality answers</label>
        <label class="row"><input type="checkbox" class="b-a"> Auto-reflect at importance ≥ ${REFLECT_AT}</label>
        <label class="row"><input type="checkbox" class="b-e"> Semantic memory (downloads MiniLM ≈23 MB via Transformers.js)</label><div class="hint xs muted b-es"></div>
        <div class="field"><label>Score weights — recency / relevance / importance</label><div class="row"><input class="inp b-w" data-k="rec" type="number" step="0.1" min="0" max="5" value="${w.rec}"><input class="inp b-w" data-k="rel" type="number" step="0.1" min="0" max="5" value="${w.rel}"><input class="inp b-w" data-k="imp" type="number" step="0.1" min="0" max="5" value="${w.imp}"></div></div>`;
      const bind = (c, k, d) => { const i = el.querySelector(c); i.checked = !!ctx.data.get(k, d); i.onchange = () => ctx.data.set(k, i.checked); return i; };
      bind('.b-i', 'inject', true); bind('.b-l', 'lessons', true); bind('.b-s', 'strategies', true); bind('.b-r', 'reflect', true); bind('.b-a', 'autoReflect', true);
      const es = el.querySelector('.b-es'), showS = () => { const s = api.semantic(); es.textContent = s.status === 'off' ? 'Off — BM25 keyword ranking.' : s.status === 'ready' ? 'Ready · ' + s.vectors + ' vectors cached' : s.msg; };
      const e = bind('.b-e', 'semantic', false); e.onchange = async () => { ctx.data.set('semantic', e.checked); if (e.checked) { showS(); const r = await enableSemantic(); showS(); if (r === 'error') ctx.toast(sem.msg, 'warn', 4000); } else { setSem('off'); showS(); } };
      showS();
      el.querySelectorAll('.b-w').forEach(i => i.onchange = () => { const cur = weights(); cur[i.dataset.k] = Math.max(0, Math.min(5, parseFloat(i.value) || 0)); ctx.data.set('weights', cur); });
    } });

    // ---------- Sim intents + starter
    ctx.intent({ id: 'brain-remember', order: 50, match: t => /^(please )?remember (that )?/i.test(t.trim()),
      script: t => [{ say: 'Saving that to memory.', tool: { name: 'memory_add', args: { text: t.trim().replace(/^(please )?remember (that )?/i, '') } } }, { final: r => r[0] && r[0].added ? '🧠 Got it — I will remember (importance ★' + r[0].added.importance + '/10): **' + r[0].added.content + '**' : 'Could not store that.' }] });
    ctx.intent({ id: 'brain-recall', order: 50, match: t => /what do you (remember|know) about|recall\b/i.test(t),
      script: t => [{ tool: { name: 'brain_recall', args: { query: t.replace(/.*(about|recall)\s*/i, '') || t } } }, { final: r => r[0] && r[0].count ? 'Here is what I remember (ranked by recency + relevance + importance):\n' + r[0].memories.map(m => '- ' + m.content).join('\n') : 'I have no memories about that yet.' }] });
    ctx.intent({ id: 'brain-learned', order: 49, match: t => /what (have|did) you (learn|learned)|what you('ve| have) learned|lessons (learned|so far)|show (me )?(your )?(lessons|insights)/i.test(t),
      script: () => [{ say: 'Checking my memory stream.', tool: { name: 'brain_overview', args: { limit: 4 } } }, { final: r => {
        const o = r[0] || {}; if (!o.total) return 'I have not learned anything yet. Tell me *“remember …”* or run a task with tools (e.g. *“list files”*) and I will keep strategies and pitfalls.';
        const sec = (h, l, f) => l && l.length ? '\n\n**' + h + '**\n' + l.map(f).join('\n') : '';
        return '🧠 **What I have learned** (' + o.total + ' memories)' +
          sec('💡 Insights', o.insights, m => '- ' + m.content.slice(0, 200)) +
          sec('Top memories', o.knowledge, m => '- ' + '★'.repeat(Math.round((m.importance || 0) / 2)) + ' ' + m.content.slice(0, 160)) +
          sec('✓ Strategies that worked', o.strategies, m => '- ' + m.content.slice(0, 180)) +
          sec('⚠ Pitfalls to avoid', o.pitfalls, m => '- ' + m.content.slice(0, 180)) +
          '\n\n_Open the **Brain** view to filter, inspect scores, export or reflect._';
      } }] });
    ctx.intent({ id: 'brain-reflect', order: 50, match: t => /^(reflect|make an insight|summari[sz]e (your )?memor)/i.test(t.trim()),
      script: () => [{ tool: { name: 'brain_reflect', args: {} } }, { final: r => r[0] && r[0].insight ? '💡 ' + r[0].insight.content : 'Not enough memories to reflect on yet.' }] });
    ctx.suggest({ id: 'brain', emoji: '🧠', title: 'Teach me something', sub: 'Persistent memory', prompt: 'Remember that I prefer concise TypeScript examples' });
    ctx.suggest({ id: 'brain-learned', emoji: '💡', title: 'What have you learned?', sub: 'Memories, lessons & insights', prompt: 'What have you learned?' });
  }
});
