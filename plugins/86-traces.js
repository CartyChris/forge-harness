/* forge.traces — OTel-GenAI-shaped tracing, cost ledger + budget cap, hash-chained audit log, loop detector, mini eval harness (U4) */
DS.plugin({
  name: 'forge.traces', title: 'Traces & Evals', version: '1.0.0', tags: ['observability', 'otel', 'evals', 'audit', 'cost'],
  description: 'Records every run as OpenTelemetry GenAI spans (invoke_agent → chat / execute_tool) with tokens, latency, cost and finish reason; waterfall view + OTLP-JSON export; cost ledger with optional budget cap; tamper-evident hash-chained audit log; repeated-call loop detector; golden-set evals that run offline on the Sim.',
  apply(ctx) {
    const D = ctx.data, U = DS.util, esc = U.esc;
    const MAX_RUNS = 100, MAX_AUDIT = 800, MAX_SPANS = 120;
    /* T(): trim AND redact secrets (via forge.shield when present) before anything is stored or exported */
    const T = s => { s = s == null ? '' : String(s); if (s.length > 4000) s = s.slice(0, 4000); try { const sh = DS.service('forge.shield'); if (sh && sh.scan) { const h = sh.scan(s); if (h.length) s = sh.redact(s, h); } } catch (_) {} return s.length > 300 ? s.slice(0, 300) + '…' : s; };
    const cfg = () => Object.assign({ loop: true, loopN: 3, budgetOn: false, budget: 1, prices: {} }, D.get('cfg', {}));
    const setCfg = patch => { D.set('cfg', Object.assign(cfg(), patch)); refresh(); };
    const hex = n => { try { return [...crypto.getRandomValues(new Uint8Array(n))].map(b => b.toString(16).padStart(2, '0')).join(''); } catch (_) { let s = ''; while (s.length < n * 2) s += Math.floor(Math.random() * 16).toString(16); return s; } };
    const now = () => Date.now(), day = ts => new Date(ts).toISOString().slice(0, 10);
    const est = s => Math.ceil(String(s || '').length / 4);
    let runs = D.get('runs', []); if (!Array.isArray(runs)) runs = [];
    const live = new Map(); /* thread.id → { run, chat, tools:[], fps:{} } */
    const save = U.debounce ? U.debounce(() => D.set('runs', runs), 300) : () => D.set('runs', runs);

    /* ───────── identity / pricing ───────── */
    const ident = model => {
      let provider = '?'; try { provider = DS.providers.pick().id; } catch (_) {}
      let providerName = provider, free = provider === 'sim';
      try { const m = ctx.service('forge.models'); const i = m && m.identity && m.identity(); if (i && i.provider === provider) { providerName = i.providerName || provider; free = free || !!(i.free || i.keyless); if (!model || model === '?') model = i.resolvedModel || i.model; } } catch (_) {}
      return { provider, providerName, model: model || '?', free };
    };
    const priceOf = model => { const p = cfg().prices[model]; return p ? { in: +p.in || 0, out: +p.out || 0 } : { in: 0, out: 0 }; };
    const costOf = (model, tin, tout) => { const p = priceOf(model); return (tin * p.in + tout * p.out) / 1e6; };
    const ledger = () => D.get('ledger', {});
    const addLedger = (model, tin, tout, cost) => { const L = ledger(), d = day(now()); L[d] = L[d] || {}; const r = L[d][model] = L[d][model] || { in: 0, out: 0, cost: 0, calls: 0 }; r.in += tin; r.out += tout; r.cost += cost; r.calls++; const ks = Object.keys(L).sort(); while (ks.length > 60) delete L[ks.shift()]; D.set('ledger', L); };
    const spentToday = () => Object.values(ledger()[day(now())] || {}).reduce((a, r) => a + r.cost, 0);
    const overBudget = () => { const c = cfg(); return c.budgetOn && spentToday() >= (+c.budget || 0); };

    /* ───────── hash-chained audit log ───────── */
    const sha = async s => {
      try { if (crypto && crypto.subtle) { const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)); return 'sha256:' + [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join(''); } } catch (_) {}
      return 'fnv:' + DS.hash(s);
    };
    const canon = e => JSON.stringify({ ts: e.ts, kind: e.kind, name: e.name, p: e.p });
    let aq = Promise.resolve();
    const audit = (kind, name, payload) => (aq = aq.then(async () => {
      const L = D.get('audit', []); const prev = L.length ? L[L.length - 1].digest : D.get('auditBase', 'genesis');
      const e = { ts: now(), kind, name: T(name), p: T(typeof payload === 'string' ? payload : JSON.stringify(payload == null ? null : payload)), prev };
      e.digest = await sha(prev + canon(e)); L.push(e);
      while (L.length > MAX_AUDIT) { const x = L.shift(); D.set('auditBase', x.digest); }
      D.set('audit', L); refresh();
    }).catch(err => ctx.log('warn', 'audit append failed: ' + err.message)));
    const verify = async () => {
      await aq; const L = D.get('audit', []); let prev = D.get('auditBase', 'genesis');
      for (let i = 0; i < L.length; i++) {
        const e = L[i]; if (e.prev !== prev) return { ok: false, index: i, reason: 'prev link mismatch', total: L.length };
        const algo = String(e.digest || '').split(':')[0]; const d = algo === 'fnv' ? 'fnv:' + DS.hash(prev + canon(e)) : await sha(prev + canon(e));
        if (d !== e.digest) return { ok: false, index: i, reason: 'digest mismatch', total: L.length };
        prev = e.digest;
      }
      return { ok: true, total: L.length, head: prev };
    };

    /* ───────── span recording ───────── */
    const span = (rec, name, parent, attrs, kind) => { const s = { spanId: hex(8), parentId: parent ? parent.spanId : '', name, kind: kind || 'INTERNAL', start: now(), end: 0, status: 'UNSET', attrs: attrs || {} }; if (rec.run.spans.length < MAX_SPANS) rec.run.spans.push(s); else rec.run.dropped = (rec.run.dropped || 0) + 1; return s; };
    const endSpan = (s, status, extra, at) => { if (!s || s.end) return; s.end = at || now(); s.status = status || 'OK'; Object.assign(s.attrs, extra || {}); s.attrs['forge.duration_ms'] = s.end - s.start; };
    const fp = (name, args) => { const st = v => v && typeof v === 'object' ? (Array.isArray(v) ? '[' + v.map(st).join(',') + ']' : '{' + Object.keys(v).sort().map(k => k + ':' + st(v[k])).join(',') + '}') : JSON.stringify(v); return name + '|' + st(args || {}); };

    ctx.hook('run:start', ({ thread, text, mode }) => {
      const id = ident(''); const run = { traceId: hex(16), threadId: thread.id, title: T(text).slice(0, 80), eval: !!thread.__eval, start: now(), end: 0, spans: [], model: '', provider: id.provider, tin: 0, tout: 0, cost: 0, status: 'UNSET' };
      const rec = { run, chat: null, tools: [], fps: {} }; live.set(thread.id, rec);
      rec.root = span(rec, 'invoke_agent', null, { 'gen_ai.operation.name': 'invoke_agent', 'gen_ai.agent.name': 'forge', 'gen_ai.provider.name': id.provider, 'gen_ai.conversation.id': thread.id, 'forge.mode': mode || '', 'forge.eval': !!thread.__eval });
      if (overBudget()) { rec.budget = true; audit('block', 'budget', { spent: spentToday(), cap: cfg().budget }); return { block: 'budget cap reached' }; }
    }, { order: 1 });
    /* core ignores run:start blocks, so enforce the same cap at user:message (which IS honoured) */
    ctx.hook('user:message', ({ thread }) => { const r = live.get(thread.id); if (r && r.budget) return { block: 'budget cap reached' }; }, { order: 1 });

    ctx.hook('beforeModel', pre => {
      const rec = live.get(pre.thread && pre.thread.id); if (!rec) return;
      if (rec.chat) endSpan(rec.chat, 'ERROR', { 'error.type': 'abandoned' });
      const id = ident(pre.model); const msgs = pre.messages || [];
      rec.run.model = id.model; rec.run.provider = id.provider;
      rec.chat = span(rec, 'chat ' + id.model, rec.root, { 'gen_ai.operation.name': 'chat', 'gen_ai.provider.name': id.provider, 'forge.provider.label': id.providerName, 'gen_ai.request.model': id.model, 'forge.request.messages': msgs.length, 'forge.request.tools': (pre.tools || []).length, 'forge.free': id.free }, 'CLIENT');
      rec.chat._estIn = est(msgs.map(m => typeof m.content === 'string' ? m.content : JSON.stringify(m.content || '')).join('\n'));
    }, { order: 900 });

    ctx.hook('afterModel', ({ res, thread }) => {
      const rec = live.get(thread && thread.id); if (!rec || !rec.chat) return; const s = rec.chat; rec.chat = null; res = res || {};
      const u = res.usage || null, tcs = res.toolCalls || [];
      const tin = u && u.prompt_tokens != null ? u.prompt_tokens : s._estIn, tout = u && u.completion_tokens != null ? u.completion_tokens : est((res.content || '') + tcs.map(t => t.raw || JSON.stringify(t.args || {})).join(''));
      const model = s.attrs['gen_ai.request.model'], cost = costOf(model, tin, tout);
      endSpan(s, 'OK', { 'gen_ai.usage.input_tokens': tin, 'gen_ai.usage.output_tokens': tout, 'forge.usage.estimated': !u, 'gen_ai.response.model': res.model || model, 'gen_ai.response.finish_reasons': [res.finish_reason || (tcs.length ? 'tool_calls' : 'stop')], 'forge.latency_ms': now() - s.start, 'forge.cost_usd': +cost.toFixed(6), 'forge.response.tool_calls': tcs.length });
      delete s._estIn; rec.run.tin += tin; rec.run.tout += tout; rec.run.cost += cost; addLedger(model, tin, tout, cost);
    }, { order: 1 });

    ctx.hook('beforeTool', ({ name, args, thread }) => {
      const rec = live.get(thread && thread.id); const c = cfg();
      const k = fp(name, args);
      if (rec) rec.fps[k] = (rec.fps[k] || 0) + 1;
      const s = rec ? span(rec, 'execute_tool ' + name, rec.root, { 'gen_ai.operation.name': 'execute_tool', 'gen_ai.tool.name': name, 'gen_ai.tool.call.arguments': T(JSON.stringify(args || {})) }) : null;
      if (rec && c.loop && rec.fps[k] >= (+c.loopN || 3)) {
        endSpan(s, 'ERROR', { 'error.type': 'loop_detected', 'forge.tool.status': 'blocked', 'forge.repeat': rec.fps[k] });
        audit('block', name, { reason: 'loop', repeat: rec.fps[k], args });
        return { block: 'loop detected: same call repeated' };
      }
      if (s) rec.tools.push(s);
    }, { order: 1 });

    ctx.hook('afterTool', ({ name, args, result, thread, part }) => {
      const rec = live.get(thread && thread.id); if (!rec) return; const i = rec.tools.findIndex(s => !s.end && s.attrs['gen_ai.tool.name'] === name); if (i < 0) return;
      const s = rec.tools.splice(i, 1)[0]; let rs = ''; try { rs = typeof result === 'string' ? result : JSON.stringify(result); } catch (_) {}
      const bad = result && typeof result === 'object' && result.error;
      endSpan(s, bad ? 'ERROR' : 'OK', { 'forge.tool.status': part ? part.status : 'ok', 'forge.tool.result_chars': (rs || '').length, ...(bad ? { 'error.type': T(result.error) } : {}) });
      audit('tool', name, { args, status: part ? part.status : 'ok', result: T(rs) });
    }, { order: 999 });

    ctx.on('approval:open', req => audit('approval', (req && req.tool) || '?', { action: req && req.action, tier: req && req.tier && req.tier.label, why: req && req.why }));
    ctx.on('approval:result', r => audit('approval-result', (r && r.tool) || '?', { action: r && r.action, allowed: !!(r && r.allowed), always: !!(r && r.always) }));

    ctx.hook('run:end', ({ thread, msg }) => {
      const rec = live.get(thread && thread.id); if (!rec) return; live.delete(thread.id);
      const parts = ((msg && msg.parts) || []).filter(p => p.type === 'tool');
      for (const s of rec.tools) { /* tools that never reached afterTool: denied by guard/hook, errored, aborted */
        const p = parts.find(p => !p.__u4 && p.name === s.attrs['gen_ai.tool.name']) || {}; p.__u4 = 1;
        endSpan(s, 'ERROR', { 'forge.tool.status': p.status || 'unknown', 'error.type': T((p.result && p.result.error) || p.status || 'not completed') }, p.dur ? s.start + p.dur : 0);
        audit('tool', s.attrs['gen_ai.tool.name'], { args: p.args, status: p.status || 'unknown', result: T(p.result && p.result.error) });
      }
      parts.forEach(p => delete p.__u4);
      if (rec.chat) endSpan(rec.chat, 'ERROR', { 'error.type': (msg && msg.meta && msg.meta.aborted) ? 'aborted' : 'no_response' });
      const err = msg && msg.meta && (msg.meta.error || (msg.meta.aborted && 'aborted'));
      const r = rec.run; r.end = now(); r.status = err ? 'ERROR' : 'OK';
      endSpan(rec.root, r.status, { 'gen_ai.request.model': r.model, 'gen_ai.usage.input_tokens': r.tin, 'gen_ai.usage.output_tokens': r.tout, 'forge.cost_usd': +r.cost.toFixed(6), 'forge.tool_calls': r.spans.filter(s => s.name.startsWith('execute_tool')).length, ...(err ? { 'error.type': T(err) } : {}) });
      runs.push(r); if (runs.length > MAX_RUNS) runs = runs.slice(-MAX_RUNS); save(); refresh();
    }, { order: 999 });

    /* ───────── export ───────── */
    const av = v => typeof v === 'boolean' ? { boolValue: v } : typeof v === 'number' ? (Number.isInteger(v) ? { intValue: String(v) } : { doubleValue: v }) : Array.isArray(v) ? { arrayValue: { values: v.map(av) } } : { stringValue: String(v) };
    const nano = ms => String(Math.round(ms || 0)) + '000000';
    const otlp = list => ({ resourceSpans: [{ resource: { attributes: [{ key: 'service.name', value: { stringValue: 'forge' } }, { key: 'telemetry.sdk.name', value: { stringValue: 'forge.traces' } }] },
      scopeSpans: [{ scope: { name: 'forge.traces', version: '1.0.0' }, spans: [].concat(...list.map(r => r.spans.map(s => ({ traceId: r.traceId, spanId: s.spanId, ...(s.parentId ? { parentSpanId: s.parentId } : {}), name: s.name, kind: s.kind === 'CLIENT' ? 3 : 1,
        startTimeUnixNano: nano(s.start), endTimeUnixNano: nano(s.end || r.end), attributes: Object.entries(s.attrs).map(([key, v]) => ({ key, value: av(v) })), status: { code: s.status === 'ERROR' ? 2 : s.status === 'OK' ? 1 : 0, ...(s.attrs['error.type'] ? { message: String(s.attrs['error.type']) } : {}) } })))) }] }] });
    const jsonl = list => list.map(r => r.spans.map(s => JSON.stringify({ traceId: r.traceId, spanId: s.spanId, parentSpanId: s.parentId || null, name: s.name, start: s.start, end: s.end, status: s.status, ...s.attrs })).join('\n')).join('\n') + '\n';
    const exportOTLP = list => U.download('forge-traces-' + day(now()) + '.otlp.json', JSON.stringify(otlp(list || runs), null, 1), 'application/json');
    const exportJSONL = list => U.download('forge-traces-' + day(now()) + '.jsonl', jsonl(list || runs), 'application/x-ndjson');

    /* ───────── evals ───────── */
    const DEF_CASES = [{ id: 'e1', prompt: 'list files', expect: 'workspace', mode: 'substring' }, { id: 'e2', prompt: 'list files', expect: '```[\\s\\S]+```', mode: 'regex' }];
    const cases = () => D.get('evals', DEF_CASES);
    const hist = () => D.get('evalHist', []);
    let evalRunning = false;
    const hiddenThread = () => ({ id: U.uid('t'), title: 'eval', created: now(), updated: now(), mode: 'act', permission: null, messages: [], plan: null, goal: null, taint: 'low', changes: {}, allow: {}, usage: { in: 0, out: 0 }, titled: true, __eval: true });
    const judge = (c, out) => { if (c.mode === 'regex') { try { return new RegExp(c.expect, 'i').test(out); } catch (_) { return false; } } return out.toLowerCase().includes(String(c.expect).toLowerCase()); };
    const runEvals = async (onProgress) => {
      if (evalRunning) throw new Error('evals already running'); evalRunning = true; const results = [];
      try {
        for (const c of cases()) {
          const t = hiddenThread(), t0 = now(); let out = '', err = '';
          try { const m = await DS.agent.run(t, c.prompt, { mode: 'act' }); out = (m.parts || []).filter(p => p.type === 'text').map(p => p.text).join('\n'); err = (m.meta && m.meta.error) || ''; } catch (e) { err = e.message; }
          results.push({ id: c.id, prompt: c.prompt, pass: !err && judge(c, out), ms: now() - t0, out: T(out || err) }); onProgress && onProgress(results);
        }
      } finally { evalRunning = false; }
      const h = hist(); const rec = { ts: now(), pass: results.filter(r => r.pass).length, total: results.length, results }; h.push(rec); D.set('evalHist', h.slice(-50)); refresh(); return rec;
    };
    const spark = (vals, w = 160, h = 30) => { if (!vals.length) return ''; const n = vals.length, x = i => n === 1 ? w / 2 : (i * (w - 4)) / (n - 1) + 2, y = v => h - 3 - v * (h - 6);
      return '<svg class="u4spark" width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '"><polyline fill="none" stroke="var(--accent)" stroke-width="2" points="' + vals.map((v, i) => x(i).toFixed(1) + ',' + y(v).toFixed(1)).join(' ') + '"/>' + vals.map((v, i) => '<circle cx="' + x(i).toFixed(1) + '" cy="' + y(v).toFixed(1) + '" r="2" fill="var(--accent)"/>').join('') + '</svg>'; };

    /* ───────── UI ───────── */
    DS.icons.traces = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6h9"/><path d="M8 12h10"/><path d="M6 18h7"/><circle cx="16" cy="6" r="1.6"/><circle cx="20" cy="12" r="1.6"/><circle cx="16" cy="18" r="1.6"/></svg>';
    ctx.effect(() => { const s = document.createElement('style'); s.textContent = `
.u4 .vscroll{padding:12px 16px 40px}.u4 .seg{margin:0 16px 8px;display:flex}.u4 .seg button{flex:1;min-height:36px}
.u4 .u4row{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:8px 0}.u4 .u4row .inp,.u4 .u4row .sel{flex:1;min-width:0;min-height:40px}
.u4run{border:1px solid var(--line);background:var(--card);border-radius:var(--radius);margin:8px 0;overflow:hidden}
.u4run>.hd{display:flex;gap:8px;align-items:center;padding:10px 12px;min-height:44px;cursor:pointer}.u4run .t{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600}
.u4meta{font-size:12px;color:var(--muted);padding:0 12px 8px;display:flex;gap:10px;flex-wrap:wrap}
.u4wf{border-top:1px solid var(--line);padding:6px 0}.u4sp{display:grid;grid-template-columns:44% 1fr;align-items:center;gap:6px;padding:4px 12px;min-height:40px;cursor:pointer}
.u4sp:hover{background:var(--card-2)}.u4sp .nm{font:12px var(--mono);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.u4sp .tr{position:relative;height:14px;background:var(--bg-2);border-radius:4px}
.u4sp .bar{position:absolute;top:0;bottom:0;border-radius:4px;background:var(--accent);min-width:3px}.u4sp.tool .bar{background:var(--violet)}.u4sp.root .bar{background:var(--muted);opacity:.5}.u4sp.err .bar{background:var(--danger)}
.u4tbl{width:100%;border-collapse:collapse;font-size:13px}.u4tbl td,.u4tbl th{border-bottom:1px solid var(--line);padding:6px 4px;text-align:left}.u4tbl td.n{text-align:right;font-family:var(--mono)}
.u4tbl input{width:72px;min-height:36px}.u4au{font:12px var(--mono);padding:6px 0;border-bottom:1px solid var(--line);word-break:break-all}
.u4kv{font:12px var(--mono);word-break:break-all}.u4kv div{padding:5px 0;border-bottom:1px solid var(--line)}.u4kv b{color:var(--text-2)}.u4spark{vertical-align:middle}
.u4case{display:flex;gap:8px;align-items:center;padding:8px 0;border-bottom:1px solid var(--line)}.u4case .grow{min-width:0;overflow:hidden;text-overflow:ellipsis}`;
      document.head.appendChild(s); return () => s.remove(); });

    let views = new Set(); const refresh = () => { views.forEach(v => { try { v(); } catch (e) { ctx.log('warn', 'view render: ' + e.message); } }); };
    const money = v => '$' + (v < 0.01 && v > 0 ? v.toFixed(5) : v.toFixed(v >= 100 ? 0 : 2));
    const fmtD = ms => DS.fmtDur ? DS.fmtDur(ms) : ms + 'ms';
    const spanSheet = (r, s) => {
      const node = U.el('div', { class: 'u4kv' }, '<div><b>name</b> ' + esc(s.name) + '</div><div><b>status</b> ' + esc(s.status) + '</div><div><b>traceId</b> ' + r.traceId + '</div><div><b>spanId</b> ' + s.spanId + (s.parentId ? ' ← ' + s.parentId : ' (root)') + '</div><div><b>duration</b> ' + esc(fmtD((s.end || r.end) - s.start)) + '</div>' +
        Object.entries(s.attrs).map(([k, v]) => '<div><b>' + esc(k) + '</b> ' + esc(Array.isArray(v) ? v.join(', ') : String(v)) + '</div>').join(''));
      DS.ui.sheet({ title: s.name, node, actions: [{ label: 'Copy JSON', onClick: () => U.copy(JSON.stringify(s, null, 2)) }, { label: 'Close', primary: true, onClick: c => c() }] });
    };
    const waterfall = r => {
      const dur = Math.max(1, (r.end || now()) - r.start), depth = s => s.parentId ? 1 : 0;
      return '<div class="u4wf">' + r.spans.map((s, i) => { const l = ((s.start - r.start) / dur) * 100, w = (((s.end || r.end) - s.start) / dur) * 100;
        const cls = (s.parentId ? (s.name.startsWith('execute_tool') ? 'tool' : 'chat') : 'root') + (s.status === 'ERROR' ? ' err' : '');
        return '<div class="u4sp ' + cls + '" data-sp="' + i + '"><div class="nm" style="padding-left:' + depth(s) * 12 + 'px">' + esc(s.name) + '</div><div class="tr"><div class="bar" style="left:' + Math.min(99, l).toFixed(2) + '%;width:' + Math.max(0.5, Math.min(100 - l, w)).toFixed(2) + '%"></div></div></div>'; }).join('') + '</div>';
    };
    const costEditor = el => {
      const c = cfg(); const seen = [...new Set([].concat(...Object.values(ledger()).map(o => Object.keys(o))).concat(Object.keys(c.prices)))].sort();
      el.innerHTML = '<div class="field"><label>Price table ($ per 1M tokens)</label><div class="hint">Free, keyless and Sim models cost $0 until you set a price. Prices are per model id.</div></div>' +
        '<table class="u4tbl"><tr><th>model</th><th>in</th><th>out</th></tr>' + seen.map(m => { const p = c.prices[m] || {}; return '<tr><td class="mono xs">' + esc(m) + '</td><td><input class="inp" type="number" min="0" step="0.01" data-m="' + esc(m) + '" data-k="in" value="' + (p.in || 0) + '"></td><td><input class="inp" type="number" min="0" step="0.01" data-m="' + esc(m) + '" data-k="out" value="' + (p.out || 0) + '"></td></tr>'; }).join('') + '</table>' +
        '<div class="u4row"><input class="inp" data-new placeholder="add model id…"><button class="btn sm" data-add>Add</button></div>' +
        '<div class="u4row"><label class="row" style="gap:8px;flex:1"><input type="checkbox" data-bon ' + (c.budgetOn ? 'checked' : '') + '> Daily budget cap ($)</label><input class="inp" style="max-width:110px" type="number" min="0" step="0.01" data-bud value="' + (+c.budget || 0) + '"></div>' +
        '<div class="hint muted sm">When today\'s spend reaches the cap, new runs are blocked with “budget cap reached”. Off by default.</div>' +
        '<div class="u4row"><label class="row" style="gap:8px;flex:1"><input type="checkbox" data-loop ' + (c.loop ? 'checked' : '') + '> Loop detector: block the same tool+args after</label><input class="inp" style="max-width:70px" type="number" min="2" data-ln value="' + (+c.loopN || 3) + '"> calls</div>';
      el.querySelectorAll('input[data-m]').forEach(i => i.onchange = () => { const P = cfg().prices; const m = i.dataset.m; P[m] = Object.assign({ in: 0, out: 0 }, P[m], { [i.dataset.k]: Math.max(0, +i.value || 0) }); setCfg({ prices: P }); });
      el.querySelector('[data-add]').onclick = () => { const v = el.querySelector('[data-new]').value.trim(); if (!v) return; const P = cfg().prices; P[v] = P[v] || { in: 0, out: 0 }; setCfg({ prices: P }); costEditor(el); };
      el.querySelector('[data-bon]').onchange = e => setCfg({ budgetOn: e.target.checked });
      el.querySelector('[data-bud]').onchange = e => setCfg({ budget: Math.max(0, +e.target.value || 0) });
      el.querySelector('[data-loop]').onchange = e => setCfg({ loop: e.target.checked });
      el.querySelector('[data-ln]').onchange = e => setCfg({ loopN: Math.max(2, +e.target.value || 3) });
    };
    ctx.settings({ id: 'traces', title: 'Traces, cost & loop guard', render: costEditor });

    let tab = 'runs';
    ctx.view({ id: 'traces', title: 'Traces', icon: 'traces', order: 62, badge: () => '',
      mount(el) {
        el.classList.add('u4');
        el.innerHTML = '<div class="vhead"><h2>Traces</h2><div class="grow"></div><button class="btn sm" data-x="otlp">OTLP</button><button class="btn sm" data-x="jsonl">JSONL</button></div><div class="seg">' + ['runs', 'cost', 'audit', 'evals'].map(t => '<button data-t="' + t + '">' + t[0].toUpperCase() + t.slice(1) + '</button>').join('') + '</div><div class="vscroll"></div>';
        const body = el.querySelector('.vscroll'); const st = { q: '', status: 'all', kind: 'all', open: null, verify: null };
        const filtered = () => runs.filter(r => (st.status === 'all' || r.status === st.status) && (st.kind === 'all' || (st.kind === 'eval') === !!r.eval) && (!st.q || (r.title + ' ' + r.model + ' ' + r.spans.map(s => s.name).join(' ')).toLowerCase().includes(st.q.toLowerCase())));
        el.querySelector('[data-x="otlp"]').onclick = () => exportOTLP(filtered());
        el.querySelector('[data-x="jsonl"]').onclick = () => exportJSONL(filtered());
        const render = () => {
          el.querySelectorAll('.seg button').forEach(b => b.classList.toggle('on', b.dataset.t === tab));
          if (tab === 'runs') {
            const list = filtered().slice().reverse().slice(0, 40);
            body.innerHTML = '<div class="u4row"><input class="inp" data-q placeholder="filter by text, model, tool…" value="' + esc(st.q) + '"></div><div class="u4row"><select class="sel" data-s><option value="all">all status</option><option value="OK">ok</option><option value="ERROR">error</option></select><select class="sel" data-k><option value="all">all runs</option><option value="user">chat runs</option><option value="eval">eval runs</option></select></div>' +
              (list.length ? list.map(r => '<div class="u4run" data-id="' + r.traceId + '"><div class="hd"><span class="chip ' + (r.status === 'ERROR' ? 'err' : 'ok') + '">' + (r.status === 'ERROR' ? 'err' : 'ok') + '</span><span class="t">' + esc(r.title || '(run)') + '</span>' + (r.eval ? '<span class="chip acc">eval</span>' : '') + '</div><div class="u4meta"><span>' + esc(U.fmtAgo ? U.fmtAgo(r.start) : new Date(r.start).toLocaleTimeString()) + '</span><span class="mono">' + esc(r.model || '?') + '</span><span>' + esc(fmtD(r.end - r.start)) + '</span><span>' + (r.tin + r.tout) + ' tok</span><span>' + money(r.cost) + '</span><span>' + r.spans.length + ' spans</span></div>' + (st.open === r.traceId ? waterfall(r) : '') + '</div>').join('') : '<div class="empty-v">No runs traced yet. Send a message (try “list files”) and it appears here.</div>');
            const q = body.querySelector('[data-q]'); q.oninput = U.debounce(() => { st.q = q.value; render(); const n = body.querySelector('[data-q]'); n.focus(); n.setSelectionRange(n.value.length, n.value.length); }, 250);
            const s = body.querySelector('[data-s]'); s.value = st.status; s.onchange = () => { st.status = s.value; render(); };
            const k = body.querySelector('[data-k]'); k.value = st.kind; k.onchange = () => { st.kind = k.value; render(); };
            body.querySelectorAll('.u4run').forEach(c => { const r = runs.find(x => x.traceId === c.dataset.id);
              c.querySelector('.hd').onclick = () => { st.open = st.open === r.traceId ? null : r.traceId; render(); };
              c.querySelectorAll('.u4sp').forEach(sp => sp.onclick = () => spanSheet(r, r.spans[+sp.dataset.sp])); });
          } else if (tab === 'cost') {
            const L = ledger(), days = Object.keys(L).sort().reverse(), byModel = {};
            days.forEach(d => Object.entries(L[d]).forEach(([m, r]) => { const b = byModel[m] = byModel[m] || { in: 0, out: 0, cost: 0, calls: 0 }; b.in += r.in; b.out += r.out; b.cost += r.cost; b.calls += r.calls; }));
            const c = cfg();
            body.innerHTML = '<div class="card" style="padding:12px"><div class="sec-t">Today</div><div style="font-size:26px;font-weight:700">' + money(spentToday()) + '</div><div class="muted sm">' + (c.budgetOn ? 'cap ' + money(+c.budget) + (overBudget() ? ' — <b style="color:var(--danger)">reached</b>' : '') : 'no budget cap') + '</div></div>' +
              '<div class="sec-t" style="margin-top:14px">By day</div><table class="u4tbl"><tr><th>day</th><th>calls</th><th>tokens</th><th>cost</th></tr>' + days.slice(0, 14).map(d => { const v = Object.values(L[d]); return '<tr><td>' + d + '</td><td class="n">' + v.reduce((a, r) => a + r.calls, 0) + '</td><td class="n">' + v.reduce((a, r) => a + r.in + r.out, 0) + '</td><td class="n">' + money(v.reduce((a, r) => a + r.cost, 0)) + '</td></tr>'; }).join('') + '</table>' +
              '<div class="sec-t" style="margin-top:14px">By model</div><table class="u4tbl"><tr><th>model</th><th>in</th><th>out</th><th>cost</th></tr>' + Object.entries(byModel).map(([m, r]) => '<tr><td class="mono xs">' + esc(m) + '</td><td class="n">' + r.in + '</td><td class="n">' + r.out + '</td><td class="n">' + money(r.cost) + '</td></tr>').join('') + '</table><div style="margin-top:16px" data-ed></div>';
            costEditor(body.querySelector('[data-ed]'));
          } else if (tab === 'audit') {
            const L = D.get('audit', []), v = st.verify;
            body.innerHTML = '<div class="u4row"><button class="btn pri" data-v>Verify chain</button><button class="btn sm" data-ae>Export JSONL</button>' + (v ? (v.ok ? '<span class="chip ok" data-res>OK · ' + v.total + ' entries</span>' : '<span class="chip err" data-res>BROKEN at #' + v.index + ' (' + esc(v.reason) + ')</span>') : '') + '</div><div class="muted sm">Every tool call, approval request and block is appended as {ts, kind, name, digest, prev}; digest = SHA-256(prev + entry). Editing any entry breaks every later link.</div>' +
              L.slice(-60).reverse().map((e, j) => '<div class="u4au"><b>#' + (L.length - 1 - j) + '</b> ' + new Date(e.ts).toLocaleTimeString() + ' <span class="chip">' + esc(e.kind) + '</span> ' + esc(e.name) + '<br><span class="muted">' + esc(e.digest.slice(0, 26)) + '… ← ' + esc(String(e.prev).slice(0, 16)) + '…</span></div>').join('');
            body.querySelector('[data-v]').onclick = async () => { st.verify = await verify(); render(); };
            body.querySelector('[data-ae]').onclick = () => U.download('forge-audit.jsonl', D.get('audit', []).map(e => JSON.stringify(e)).join('\n') + '\n', 'application/x-ndjson');
          } else {
            const C = cases(), H = hist(), last = H[H.length - 1];
            body.innerHTML = '<div class="u4row"><button class="btn pri" data-run ' + (evalRunning ? 'disabled' : '') + '>' + (evalRunning ? 'Running…' : 'Run evals') + '</button>' + spark(H.map(h => h.total ? h.pass / h.total : 0)) + (last ? '<span class="chip ' + (last.pass === last.total ? 'ok' : 'warn') + '" data-last>' + last.pass + '/' + last.total + ' pass</span>' : '') + '</div>' +
              '<div class="sec-t">Golden cases</div>' + C.map(c => { const r = last && last.results.find(x => x.id === c.id); return '<div class="u4case"><span class="chip ' + (r ? (r.pass ? 'ok' : 'err') : '') + '">' + (r ? (r.pass ? 'pass' : 'fail') : '–') + '</span><div class="grow"><div class="sm">' + esc(c.prompt) + '</div><div class="xs muted mono">' + esc(c.mode) + ': ' + esc(c.expect) + (r ? ' · ' + fmtD(r.ms) : '') + '</div></div><button class="icon-btn" data-del="' + esc(c.id) + '" aria-label="delete">' + DS.icon('trash') + '</button></div>'; }).join('') +
              '<div class="sec-t" style="margin-top:14px">Add case</div><div class="u4row"><input class="inp" data-p placeholder="prompt"></div><div class="u4row"><input class="inp" data-e placeholder="expected substring or regex"><select class="sel" data-m style="max-width:120px"><option>substring</option><option>regex</option></select><button class="btn sm" data-add>Add</button></div>' +
              '<div class="muted xs">Each case runs in a fresh hidden thread through the active provider (the offline Sim works). Pairwise judging is not implemented.</div>';
            body.querySelector('[data-run]').onclick = async () => { try { const p = runEvals(() => render()); render(); const r = await p; ctx.toast('Evals: ' + r.pass + '/' + r.total + ' pass', r.pass === r.total ? 'ok' : 'warn'); } catch (e) { ctx.toast(e.message, 'err'); } };
            body.querySelectorAll('[data-del]').forEach(b => b.onclick = () => { D.set('evals', cases().filter(c => c.id !== b.dataset.del)); render(); });
            body.querySelector('[data-add]').onclick = () => { const p = body.querySelector('[data-p]').value.trim(), e = body.querySelector('[data-e]').value.trim(); if (!p || !e) return ctx.toast('prompt and expectation required', 'warn'); D.set('evals', cases().concat([{ id: U.uid('e'), prompt: p, expect: e, mode: body.querySelector('[data-m]').value }])); render(); };
          }
        };
        el.querySelectorAll('.seg button').forEach(b => b.onclick = () => { tab = b.dataset.t; render(); });
        const rr = () => { if (!document.activeElement || !body.contains(document.activeElement) || document.activeElement.tagName === 'BUTTON') render(); };
        views.add(rr); render(); el._u4open = id => { tab = 'runs'; st.open = id; render(); };
        return () => views.delete(rr);
      } });
    const show = (t, openLast) => { tab = t || 'runs'; DS.shell.show('traces'); setTimeout(() => { const v = document.querySelector('.u4'); if (v && v._u4open && openLast && runs.length) v._u4open(runs[runs.length - 1].traceId); refresh(); }, 30); };
    if (ctx.rail) ctx.rail({ id: 'traces', icon: 'traces', label: 'Traces', group: 'top', order: 60, run: () => show('runs') });

    /* ───────── agent surface: tool, commands, sim intent, suggest ───────── */
    const describe = r => { if (!r) return 'No completed runs traced yet.'; const dur = Math.max(1, r.end - r.start);
      return '**' + esc(r.title || 'run') + '** · trace `' + r.traceId.slice(0, 12) + '…` · ' + fmtD(dur) + ' · ' + (r.tin + r.tout) + ' tokens · ' + money(r.cost) + '\n\n```\n' + r.spans.map(s => (s.parentId ? '  └ ' : '') + s.name.padEnd(s.parentId ? 26 : 30) + ' ' + String((s.end || r.end) - s.start).padStart(6) + 'ms ' + s.status + (s.attrs['gen_ai.usage.output_tokens'] != null ? '  in ' + s.attrs['gen_ai.usage.input_tokens'] + ' / out ' + s.attrs['gen_ai.usage.output_tokens'] : '')).join('\n') + '\n```'; };
    ctx.tool({ name: 'trace_last', description: 'Return the OpenTelemetry-style trace (spans, tokens, latency, cost) of the most recent completed agent run(s).', gate: 'read', label: 'Read trace',
      parameters: { type: 'object', properties: { n: { type: 'number', description: 'how many recent runs (default 1)' } } },
      run: args => { const n = Math.max(1, Math.min(5, +args.n || 1)); const L = runs.filter(r => !r.eval).slice(-n); return { runs: L.map(r => ({ traceId: r.traceId, title: r.title, ms: r.end - r.start, tokens: r.tin + r.tout, cost: r.cost, status: r.status, spans: r.spans.map(s => ({ name: s.name, parent: s.parentId ? 'invoke_agent' : null, ms: (s.end || r.end) - s.start, status: s.status })) })), summary: L.length ? describe(L[L.length - 1]) : 'No completed runs traced yet.' }; },
      summarize: (a, r) => (r.runs || []).length + ' run(s)' });
    ctx.command({ name: 'traces', desc: 'Open the Traces view (spans, cost, audit, evals)', run: (a, c) => { const last = runs.filter(r => !r.eval).slice(-1)[0]; c.reply(describe(last)); show('runs', true); } });
    ctx.command({ name: 'evals', args: '[run]', desc: 'Open evals; “/evals run” runs the golden set', run: async (a, c) => { show('evals'); if (/run/.test(a || '')) { try { const r = await runEvals(); c.reply('Evals: **' + r.pass + '/' + r.total + '** pass\n\n' + r.results.map(x => '- ' + (x.pass ? '✅' : '❌') + ' `' + x.prompt + '` · ' + x.ms + 'ms').join('\n')); } catch (e) { c.reply('Evals: ' + e.message); } } else c.reply('Evals: ' + cases().length + ' golden cases. Use `/evals run` or the Run evals button.'); } });
    ctx.intent({ id: 'traces-last', order: 50, match: t => /\b(trace|traces|spans?)\b/i.test(t) && /\b(show|open|view|last|latest|my)\b/i.test(t) && !/\bevals?\b/i.test(t),
      script: () => [{ say: 'Pulling the trace of your last run…', tool: { name: 'trace_last', args: { n: 1 } } }, { final: rs => { const r = rs[rs.length - 1]; setTimeout(() => show('runs', true), 50); return (r && r.summary ? r.summary : 'No completed runs traced yet.') + '\n\nOpened the **Traces** view: tap a run for its waterfall, tap a span for its attributes, or export OTLP-JSON.'; } }] });
    ctx.suggest({ id: 'traces', emoji: '📈', title: "Show my last run's trace", sub: 'OTel spans · tokens · cost · audit', prompt: "Show my last run's trace" });

    const api = { runs: () => runs, last: () => runs[runs.length - 1], live: () => live, otlp: l => otlp(l || runs), jsonl: l => jsonl(l || runs), exportOTLP, exportJSONL, audit, verify, auditLog: () => D.get('audit', []), runEvals, cases, history: hist, ledger, spentToday, cfg, setCfg, show, flush: () => aq };
    ctx.provide('forge.traces', api); DS.traces = api;
    return () => { if (DS.traces === api) delete DS.traces; };
  }
});
