/* ═══════════════════════════ DIFF · PROVIDERS (OpenAI-compatible streaming + offline Sim) ═══════════════════════════ */
DS.diff = {
  /* line-level LCS diff → [{t:' '|'+'|'-', s}] */
  lines(a, b) {
    const A = String(a == null ? '' : a).split('\n'), B = String(b == null ? '' : b).split('\n');
    if (A.length * B.length > 4e6) return A.map(s => ({ t: '-', s })).concat(B.map(s => ({ t: '+', s })));
    let pre = 0; while (pre < A.length && pre < B.length && A[pre] === B[pre]) pre++;
    let suf = 0; while (suf < A.length - pre && suf < B.length - pre && A[A.length - 1 - suf] === B[B.length - 1 - suf]) suf++;
    const a2 = A.slice(pre, A.length - suf), b2 = B.slice(pre, B.length - suf); const n = a2.length, m = b2.length;
    const L = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = a2[i] === b2[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
    const out = A.slice(0, pre).map(s => ({ t: ' ', s })); let i = 0, j = 0;
    while (i < n && j < m) { if (a2[i] === b2[j]) { out.push({ t: ' ', s: a2[i] }); i++; j++; } else if (L[i + 1][j] >= L[i][j + 1]) out.push({ t: '-', s: a2[i++] }); else out.push({ t: '+', s: b2[j++] }); }
    while (i < n) out.push({ t: '-', s: a2[i++] }); while (j < m) out.push({ t: '+', s: b2[j++] });
    return out.concat(A.slice(A.length - suf).map(s => ({ t: ' ', s })));
  },
  stat(a, b) { let add = 0, del = 0; for (const l of this.lines(a, b)) { if (l.t === '+') add++; else if (l.t === '-') del++; } return { add, del }; },
  /* html with context folding. ctx = lines of context around changes */
  html(a, b, ctx = 3) {
    const ls = this.lines(a, b); const keep = new Array(ls.length).fill(false);
    ls.forEach((l, i) => { if (l.t !== ' ') for (let k = Math.max(0, i - ctx); k <= Math.min(ls.length - 1, i + ctx); k++) keep[k] = true; });
    let out = '', skipped = 0, an = 0, bn = 0;
    ls.forEach((l, i) => {
      if (l.t !== '+') an++; if (l.t !== '-') bn++;
      if (!keep[i]) { skipped++; return; }
      if (skipped) { out += '<div class="dl fold">⋯ ' + skipped + ' unchanged line' + (skipped > 1 ? 's' : '') + '</div>'; skipped = 0; }
      out += '<div class="dl ' + (l.t === '+' ? 'add' : l.t === '-' ? 'del' : 'ctx') + '"><span class="dn">' + (l.t === '+' ? '' : an) + '</span><span class="dn">' + (l.t === '-' ? '' : bn) + '</span><span class="dt">' + (l.t === ' ' ? ' ' : l.t) + '</span><span class="ds">' + DS.util.esc(l.s) + '</span></div>';
    });
    if (skipped) out += '<div class="dl fold">⋯ ' + skipped + ' unchanged line' + (skipped > 1 ? 's' : '') + '</div>';
    return out || '<div class="dl fold">no changes</div>';
  },
  unified(path, a, b) { const ls = this.lines(a, b); return '--- a' + path + '\n+++ b' + path + '\n' + ls.filter(l => l.t !== ' ').map(l => l.t + l.s).join('\n'); }
};

DS.providers = {
  pick() {
    const s = Store.settings(); const list = DS.kernel.list('provider');
    const want = s.forceSim ? 'sim' : s.provider;
    let p = list.find(x => x.id === want);
    if (!p || (p.available && !p.available())) p = list.find(x => x.id === 'sim') || list[0];
    return p;
  },
  isLive() { const p = this.pick(); return !!p && p.id !== 'sim'; }
};

/* ---------- OpenAI-compatible (DeepSeek by default) ---------- */
DS.openaiProvider = {
  id: 'openai', label: 'OpenAI-compatible (DeepSeek)', order: 10,
  available() { const s = Store.settings(); return !!(s.apiKey && s.baseUrl); },
  async stream({ messages, tools, model, signal, onDelta, temperature }) {
    const s = Store.settings(); const base = s.baseUrl.replace(/\/+$/, '');
    const body = { model, messages, stream: true, stream_options: { include_usage: true } };
    if (!/reasoner|o1|o3|r1/i.test(model) && temperature != null) body.temperature = temperature;
    if (tools && tools.length) { body.tools = tools.map(t => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } })); body.tool_choice = 'auto'; }
    const headers = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + s.apiKey };
    let res;
    try { res = await fetch(base + '/chat/completions', { method: 'POST', headers, body: JSON.stringify(body), signal }); }
    catch (e) {
      if (e.name === 'AbortError') throw e;
      if (DS.bridge.online) { /* CORS fallback: proxy through the local bridge (non-streaming) */
        body.stream = false; delete body.stream_options; DS.kernel.log('warn', 'provider', 'direct request failed (' + e.message + '); retrying via bridge');
        const r = await DS.bridge.call('fetch', { url: base + '/chat/completions', method: 'POST', headers, body: JSON.stringify(body) }, { timeout: 180000 });
        if (r.status >= 400) throw new Error('API ' + r.status + ': ' + String(r.body).slice(0, 300));
        const j = JSON.parse(r.body); const m = (j.choices && j.choices[0] && j.choices[0].message) || {};
        const toolCalls = (m.tool_calls || []).map(tc => ({ id: tc.id, name: tc.function.name, args: safeJSON(tc.function.arguments), raw: tc.function.arguments }));
        if (m.reasoning_content) onDelta && onDelta({ reasoning: m.reasoning_content }); if (m.content) onDelta && onDelta({ content: m.content });
        return { content: m.content || '', reasoning: m.reasoning_content || '', toolCalls, usage: j.usage || null };
      }
      throw new Error('Network error: ' + e.message + '. If this is CORS, connect the local bridge (Settings → Bridge) so requests can be proxied.');
    }
    if (!res.ok) { let t = ''; try { t = await res.text(); } catch (_) {} throw new Error('API ' + res.status + ': ' + t.slice(0, 300)); }
    const rd = res.body.getReader(); const dec = new TextDecoder(); let buf = '', content = '', reasoning = '', usage = null; const tcs = [];
    for (;;) {
      const { done, value } = await rd.read(); if (done) break; buf += dec.decode(value, { stream: true });
      let idx; while ((idx = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, idx).trim(); buf = buf.slice(idx + 1); if (!line.startsWith('data:')) continue; const d = line.slice(5).trim(); if (d === '[DONE]') continue;
        let j; try { j = JSON.parse(d); } catch (_) { continue; } if (j.usage) usage = j.usage;
        const dl = j.choices && j.choices[0] && j.choices[0].delta; if (!dl) continue;
        if (dl.reasoning_content) { reasoning += dl.reasoning_content; onDelta && onDelta({ reasoning: dl.reasoning_content }); }
        if (dl.content) { content += dl.content; onDelta && onDelta({ content: dl.content }); }
        if (dl.tool_calls) for (const tc of dl.tool_calls) { const i = tc.index || 0; const c = tcs[i] || (tcs[i] = { id: '', name: '', raw: '' }); if (tc.id) c.id = tc.id; if (tc.function) { if (tc.function.name) c.name += tc.function.name; if (tc.function.arguments) c.raw += tc.function.arguments; } onDelta && onDelta({ toolDelta: { index: i, name: c.name } }); }
      }
    }
    const toolCalls = tcs.filter(Boolean).map((c, i) => ({ id: c.id || uid('call'), name: c.name, args: safeJSON(c.raw), raw: c.raw }));
    return { content, reasoning, toolCalls, usage };
  }
};
function safeJSON(s) { if (s && typeof s === 'object') return s; try { return JSON.parse(s || '{}'); } catch (_) { try { return JSON.parse(String(s).replace(/,\s*([}\]])/g, '$1')); } catch (e) { return { __parseError: String(s).slice(0, 200) }; } } }
DS.safeJSON = safeJSON;

/* ---------- Sim: an offline "model" driven by `intent` contributions ---------- */
DS.simProvider = {
  id: 'sim', label: 'Offline Sim (no key needed)', order: 99, models: ['sim'],
  available() { return true; },
  async stream({ messages, tools, signal, onDelta }) {
    const lastUser = (() => { for (let i = messages.length - 1; i >= 0; i--) if (messages[i].role === 'user') return i; return -1; })();
    let text = lastUser >= 0 ? String(typeof messages[lastUser].content === 'string' ? messages[lastUser].content : (messages[lastUser].content || []).map(p => p.text || '').join(' ')) : '';
    const after = messages.slice(lastUser + 1); const step = after.filter(m => m.role === 'assistant').length;
    const results = after.filter(m => m.role === 'tool').map(m => { try { return JSON.parse(m.content); } catch (_) { return m.content; } });
    if (/^Plan approved/i.test(text)) { for (let i = lastUser - 1; i >= 0; i--) if (messages[i].role === 'user' && !/^Plan approved/i.test(String(messages[i].content))) { text = String(messages[i].content); break; } }
    const sys = (messages[0] && messages[0].role === 'system') ? messages[0].content : '';
    const isCritic = /CRITIC/.test(sys) && !tools.length;
    const say = async t => { if (!t) return; for (let i = 0; i < t.length; i += 18) { if (signal && signal.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' }); onDelta && onDelta({ content: t.slice(i, i + 18) }); await DS.util.sleep(10); } };
    if (isCritic) { const t = 'Looks consistent with the request. (Offline critic: no model available to review in depth.)'; await say(t); return { content: t, reasoning: '', toolCalls: [], usage: null }; }
    const sctx = { text, step, results, thread: DS.store.activeThread(), tools: (tools || []).map(t => t.name), files: Object.keys(Store.wsFiles()) };
    let script = null, intent = null;
    for (const it of DS.kernel.list('intent')) { try { if (it.match(text, sctx)) { script = await it.script(text, sctx); intent = it; break; } } catch (e) { DS.kernel.log('error', it.__owner || 'sim', 'intent ' + it.id + ' failed: ' + e.message); } }
    if (!script) {
      const t = 'I’m running on the **offline Sim** (no API key), so I only understand a few built-in intents.\n\nTry: *“audit the workspace”*, *“build a snake game”*, *“make an image of a neon city”*, *“list files”*, *“read AGENTS.md”*, `/help`.\n\nAdd a DeepSeek key in **Settings → Model** for the real thing; or teach the Sim new tricks with an `intent` plugin.';
      await say(t); return { content: t, reasoning: '', toolCalls: [], usage: null };
    }
    const reason = ''; await DS.util.sleep(60);
    const ent = script[step];
    if (!ent) { const t = (script.__final ? script.__final(results) : 'Done.'); await say(t); return { content: t, reasoning: reason, toolCalls: [], usage: null }; }
    if (ent.say) await say(ent.say);
    if (ent.tool) { const tl = typeof ent.tool === 'function' ? ent.tool(results) : ent.tool; if (tl) return { content: ent.say || '', reasoning: reason, toolCalls: [{ id: uid('call'), name: tl.name, args: tl.args || {}, raw: JSON.stringify(tl.args || {}) }], usage: null }; }
    if (ent.final) { const t = typeof ent.final === 'function' ? ent.final(results) : ent.final; await say(t); return { content: (ent.say || '') + t, reasoning: reason, toolCalls: [], usage: null }; }
    return { content: ent.say || '', reasoning: reason, toolCalls: [], usage: null };
  }
};
