// past.dev long-term memory backend. Field names from https://past.dev/docs/memory-api/api-reference/llms.txt
// (read 2026-11-08); NOT tested against the live API — UI labels it "unverified".
DS.plugin({
  name: 'forge.past', title: 'Long-term memory (past.dev)', version: '0.1.0',
  description: 'Hosted long-term memory via past.dev (ingest/recall/forget), falls back to the local brain.',
  apply(ctx) {
    const BASE = 'https://api.past.dev/api/v1';
    const esc = s => DS.util.esc(String(s == null ? '' : s));
    const key = () => String(ctx.data.get('key', '') || '').trim();
    const mask = k => k ? (k.length > 8 ? k.slice(0, 3) + '…' + k.slice(-4) : '••••') : '';
    const identity = () => String(ctx.data.get('identity', '') || 'forge-user');
    const audience = () => String(ctx.data.get('audience', '') || '');
    const brain = () => { try { return DS.service('forge.brain'); } catch (_) { return null; } };
    const CAP = () => Math.max(100, Math.min(4000, +ctx.data.get('cap', 600) || 600)); // tokens (~4 chars each)
    const CORS_MSG = 'past.dev blocked the browser request (CORS); use the Vercel deploy or the local bridge';

    async function call(method, path, body) {
      const url = BASE + path;
      const init = { method, headers: { Authorization: 'Bearer ' + key(), Accept: 'application/json' } };
      if (body !== undefined) { init.headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(body); }
      let r;
      try { r = await fetch(url, init); }
      catch (e) {
        if (!(e instanceof TypeError)) throw e;
        let gw = null; try { gw = DS.service('forge.gateway'); } catch (_) {}
        if (gw && gw.get && gw.get() && gw.fetch) {
          try { r = await gw.fetch(url, init); } catch (_) { throw new Error(CORS_MSG); }
        } else throw new Error(CORS_MSG);
      }
      if (r.status === 204) return {};
      let j = null; try { j = await r.json(); } catch (_) {}
      if (!r.ok) { const m = (j && (j.debugMessage || j.code || j.message)) || ('HTTP ' + r.status); const err = new Error('past.dev ' + r.status + ': ' + String(m).slice(0, 200)); err.status = r.status; throw err; }
      return j || {};
    }
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    async function ingest(text, opts = {}) {
      const body = { content: String(text), timestamp: opts.timestamp || new Date().toISOString(), identity: identity() };
      const aud = opts.audience || audience(); if (aud) body.audience = aud;
      if (opts.label) body.label = opts.label;
      const j = await call('POST', '/ingest', body);
      const id = j.ingestionId; let status = j.status || 'queued';
      for (let i = 0; id && status !== 'completed' && status !== 'failed' && i < (opts.polls || 20); i++) {
        if (document.hidden) await sleep(1500);
        await sleep(opts.pollMs != null ? opts.pollMs : 700);
        const s = await call('GET', '/ingest/' + encodeURIComponent(id)); status = s.status || status;
        if (s.failure) return { ingestionId: id, status: 'failed', failure: s.failure };
      }
      return { ingestionId: id, status };
    }
    async function recall(query, limit = 5, maxTokens) {
      const body = { query: String(query), identity: identity(), limit: Math.max(1, Math.min(50, +limit || 5)) };
      if (maxTokens) body.maxTokens = maxTokens;
      const j = await call('POST', '/recall', body);
      const results = (j.results || []).map(x => ({ id: x.id, rank: x.rank, occurredAt: x.occurredAt, content: String(x.content || ''),
        sources: (x.sources || []).map(s => ({ sourceId: s.sourceId, occurredAt: s.occurredAt, label: s.label })) }));
      return { asOf: j.asOf, usedEvidenceTokens: j.usedEvidenceTokens, results, pending: j.pending };
    }
    const forget = id => call('DELETE', '/ingest/' + encodeURIComponent(id)).then(() => ({ deleted: id }));
    const LOCAL = 'No past.dev key set — used the local Forge brain instead.';
    const api = { ingest, recall, forget, hasKey: () => !!key(), test: () => recall('connection test', 1) };
    ctx.provide('forge.past', api);

    ctx.tool({ name: 'past_remember', gate: 'net', label: 'past.dev remember', description: 'Save text to long-term memory (past.dev; falls back to local brain without a key).',
      parameters: { type: 'object', properties: { text: { type: 'string' }, audience: { type: 'string' } }, required: ['text'] },
      async run(a) {
        if (!key()) { const b = brain(); const it = b && b.store({ content: a.text, type: 'knowledge' }); return { backend: 'local', note: LOCAL, stored: it ? { id: it.id, content: it.content } : null }; }
        try { return { backend: 'past.dev', ...(await ingest(a.text, { audience: a.audience })) }; } catch (e) { return { error: e.message }; }
      } });
    ctx.tool({ name: 'past_recall', gate: 'net', readonly: true, parallel: true, label: 'past.dev recall', description: 'Recall dated, sourced evidence from long-term memory (past.dev; local brain without a key).',
      parameters: { type: 'object', properties: { query: { type: 'string' }, limit: { type: 'number' } }, required: ['query'] },
      async run(a) {
        if (!key()) { const b = brain(); const hits = (b && b.retrieve(a.query, a.limit || 5, { touch: false })) || [];
          return { backend: 'local', note: LOCAL, results: hits.map(h => ({ id: h.id, occurredAt: h.created ? new Date(h.created).toISOString() : null, content: h.content, sources: [{ label: 'local brain' }] })) }; }
        try { return { backend: 'past.dev', ...(await recall(a.query, a.limit)) }; } catch (e) { return { error: e.message }; }
      } });
    ctx.tool({ name: 'past_forget', gate: 'write', label: 'past.dev forget', description: 'Delete an ingestion from past.dev by ingestionId (local brain id without a key).',
      parameters: { type: 'object', properties: { ingestionId: { type: 'string' } }, required: ['ingestionId'] },
      async run(a) {
        if (!key()) { const b = brain(); const n = b ? b.forget(a.ingestionId) : 0; return { backend: 'local', note: LOCAL, removed: n }; }
        try { return { backend: 'past.dev', ...(await forget(a.ingestionId)) }; } catch (e) { return { error: e.message }; }
      } });

    // auto-recall → system prompt (capped)
    ctx.hook('beforeModel', async p => {
      if (!ctx.data.get('autoRecall', false) || !key()) return;
      const msgs = p.messages || []; const last = [...msgs].reverse().find(m => m.role === 'user'); if (!last) return;
      const q = typeof last.content === 'string' ? last.content : JSON.stringify(last.content || '');
      const sysIdx = msgs.findIndex(m => m.role === 'system');
      if (sysIdx >= 0 && typeof msgs[sysIdx].content === 'string' && msgs[sysIdx].content.includes('[Long-term memory — past.dev')) return;
      let r; try { r = await Promise.race([recall(q.slice(0, 2000), 5, CAP()), sleep(4000).then(() => null)]); } catch (e) { ctx.log && ctx.log('warn', 'past recall: ' + e.message); return; }
      if (!r || !r.results.length) return;
      const budget = CAP() * 4; let txt = '[Long-term memory — past.dev, as of ' + (r.asOf || '?') + ']\n';
      for (const x of r.results) { const line = '- (' + (x.occurredAt || 'undated') + ') ' + x.content.replace(/\s+/g, ' ').slice(0, 400) + '\n'; if (txt.length + line.length > budget) break; txt += line; }
      if (sysIdx >= 0 && typeof msgs[sysIdx].content === 'string') msgs[sysIdx] = { ...msgs[sysIdx], content: msgs[sysIdx].content + '\n\n' + txt };
      else msgs.unshift({ role: 'system', content: txt });
    });
    // auto-ingest finished exchange
    let lastQ = '', lastAt = '';
    ctx.hook('run:start', p => { if (p && p.text) { lastQ = p.text; lastAt = new Date().toISOString(); } });
    ctx.hook('run:end', p => {
      if (!ctx.data.get('autoIngest', false) || !key()) return;
      try {
        const th = (p && p.thread) || (ctx.thread && ctx.thread()); const ms = (th && th.messages) || [];
        const a = (p && p.msg) || [...ms].reverse().find(m => m.role === 'assistant'); if (!a || a.meta?.aborted) return;
        const ans = typeof a.content === 'string' && a.content ? a.content : (a.parts || []).filter(x => x.type === 'text').map(x => x.text).join('\n');
        const u = lastQ || ([...ms].reverse().find(m => m.role === 'user') || {}).content || '';
        if (!ans.trim() || !String(u).trim()) return;
        ingest('User: ' + u + '\n\nAssistant: ' + ans, { timestamp: lastAt || new Date().toISOString(), label: 'forge exchange' })
          .catch(e => ctx.log && ctx.log('warn', 'past ingest: ' + e.message));
      } catch (e) { ctx.log && ctx.log('warn', 'past run:end: ' + e.message); }
    });

    ctx.settings({ id: 'past', title: 'Long-term memory (past.dev)', render(el) {
      el.innerHTML = `<div class="pm-root" style="max-width:100%;overflow-wrap:anywhere">
        <div class="hint xs muted">Hosted memory API. Request fields follow past.dev's API reference but are <b>unverified</b> against the live service. Recall costs 1 credit (pay-as-you-go, 150k starting credits per their homepage). Browsers may hit CORS; the Vercel deploy or local bridge gateway avoids that.</div>
        <div class="field"><label>Project key <span class="pm-k muted xs"></span></label><input class="inp pm-key" type="password" autocomplete="off" placeholder="paste project key" style="width:100%;box-sizing:border-box"></div>
        <div class="field"><label>Identity (reader)</label><input class="inp pm-id" style="width:100%;box-sizing:border-box"></div>
        <div class="field"><label>Default audience</label><input class="inp pm-aud" placeholder="(none)" style="width:100%;box-sizing:border-box"></div>
        <label class="row" style="min-height:40px"><input type="checkbox" class="pm-ar"> Auto-recall before each run (≤ <input class="inp pm-cap" type="number" min="100" max="4000" step="100" style="width:80px"> tokens)</label>
        <label class="row" style="min-height:40px"><input type="checkbox" class="pm-ai"> Auto-ingest each finished exchange</label>
        <div class="row" style="flex-wrap:wrap;gap:8px"><button class="btn pm-test" style="min-height:40px">Test connection</button><button class="btn pm-clear" style="min-height:40px">Clear key</button>
        <a class="btn" style="min-height:40px;display:inline-flex;align-items:center" href="https://app.past.dev" target="_blank" rel="noopener">Get a key ↗</a></div>
        <div class="hint xs pm-out" aria-live="polite"></div></div>`;
      const $ = s => el.querySelector(s);
      const showK = () => { $('.pm-k').textContent = key() ? '(saved: ' + mask(key()) + ')' : '(not set — local brain is used)'; };
      showK();
      $('.pm-key').onchange = e => { const v = e.target.value.trim(); if (v) ctx.data.set('key', v); e.target.value = ''; showK(); };
      $('.pm-clear').onclick = () => { ctx.data.set('key', ''); showK(); };
      $('.pm-id').value = identity(); $('.pm-id').onchange = e => ctx.data.set('identity', e.target.value.trim());
      $('.pm-aud').value = audience(); $('.pm-aud').onchange = e => ctx.data.set('audience', e.target.value.trim());
      $('.pm-cap').value = CAP(); $('.pm-cap').onchange = e => ctx.data.set('cap', +e.target.value || 600);
      const ar = $('.pm-ar'), ai = $('.pm-ai'); ar.checked = !!ctx.data.get('autoRecall', false); ai.checked = !!ctx.data.get('autoIngest', false);
      ar.onchange = () => ctx.data.set('autoRecall', ar.checked); ai.onchange = () => ctx.data.set('autoIngest', ai.checked);
      $('.pm-test').onclick = async () => {
        const out = $('.pm-out'); if (!key()) { out.textContent = 'No key set.'; return; }
        out.textContent = 'Testing…';
        try { const r = await api.test(); out.textContent = '✓ Connected · asOf ' + (r.asOf || '?') + ' · ' + r.results.length + ' result(s)'; }
        catch (e) { out.textContent = '✗ ' + e.message; }
      };
    } });

    // offline Sim demo (no key → local brain)
    ctx.intent({ id: 'past-demo', order: 45, match: t => /long[- ]term memory|past\.dev/i.test(t),
      script: () => [
        { say: 'Demo: saving a fact to long-term memory (' + (key() ? 'past.dev' : 'local brain — no past.dev key') + ').', tool: { name: 'past_remember', args: { text: 'Chris prefers concise answers with code first.' } } },
        { tool: { name: 'past_recall', args: { query: 'concise answers code', limit: 3 } } },
        { final: r => { const rec = [].concat(r || []).reverse().find(x => x && x.results) || {}; const lines = (rec.results || []).slice(0, 3).map(x => '- ' + (x.occurredAt ? x.occurredAt.slice(0, 10) + ' · ' : '') + x.content);
          return '🗄️ Long-term memory (' + (rec.backend || '?') + ')' + (rec.note ? ' — ' + rec.note : '') + '\n' + (lines.join('\n') || '(no results)') + '\n\nAdd a past.dev key in Settings → Long-term memory to use the hosted backend (unverified).'; } }] });
    ctx.suggest({ id: 'past', emoji: '🗄️', title: 'Give Forge long-term memory', sub: 'past.dev or local brain', prompt: 'Show me long-term memory with past.dev' });
  }
});
