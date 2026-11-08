/* forge.arena — blind Model Arena (LMArena-style): two anonymous models answer, you vote, Elo updates.
   Offline: 'sim' entries (and any failing live side) use a tiny deterministic local generator per model id. */
const AR_K = 32, AR_START = 1000;
const arHash = s => { let h = 2166136261; for (const c of String(s)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };
const arKey = e => e.provider + '/' + e.model;
const arExpected = (ra, rb) => 1 / (1 + Math.pow(10, (rb - ra) / 400));
/* score sa ∈ {1, 0, .5}; returns [newA, newB] */
const arElo = (ra, rb, sa, k) => { k = k || AR_K; const ea = arExpected(ra, rb); return [ra + k * (sa - ea), rb + k * ((1 - sa) - (1 - ea))]; };
function arTopic(q) {
  const w = (String(q || '').toLowerCase().match(/[a-z0-9À-￿']+/g) || []).filter(x => x.length > 3 && !/^(what|which|should|would|could|there|their|about|with|from|this|that|have|explain|please|write|give|make|does|when|where|your|tell)$/.test(x));
  const by = w.slice().sort((a, b) => b.length - a.length);
  return { T: String(q || 'the question').replace(/[?.!\s]+$/, '').slice(0, 80), K1: by[0] || 'the idea', K2: by[1] || by[0] || 'the result', K3: by[2] || 'the basics' };
}
const AR_STYLES = [
  t => '**Short answer:** ' + t.T + ' comes down to **' + t.K1 + '**.\n\n- Start with ' + t.K3 + ' — get that right first.\n- Then connect it to ' + t.K2 + '.\n- Check the result against one concrete example.\n\nThat covers 80% of it.',
  t => 'Let me walk through it step by step.\n\n1. **Define the goal.** What does "' + t.K1 + '" mean here?\n2. **Gather inputs.** List what you know about ' + t.K2 + '.\n3. **Apply the rule.** Combine them, one change at a time.\n4. **Verify.** Re-read the question: "' + t.T + '".\n\nIf any step feels fuzzy, that is the one to dig into.',
  t => 'Think of **' + t.K1 + '** like a kitchen: ' + t.K2 + ' is the recipe and ' + t.K3 + ' are the ingredients. You can own great ingredients and still burn dinner if you skip the recipe.\n\nSo for "' + t.T + '": follow the recipe first, improvise second.',
  t => '| | Pros | Cons |\n|---|---|---|\n| Focus on ' + t.K1 + ' | fast, simple | may miss edge cases |\n| Focus on ' + t.K2 + ' | thorough | slower to start |\n\n**Verdict:** begin with ' + t.K1 + ', add ' + t.K2 + ' once the basics hold.',
  t => '**Q:** ' + t.T + '?\n\n**A:** Mostly yes — but it depends on ' + t.K2 + '.\n\n**Q:** What is the most common mistake?\n\n**A:** Treating ' + t.K1 + ' as a one-off instead of a habit.\n\n**Q:** First step today?\n\n**A:** Write down one sentence about ' + t.K3 + '.',
  t => 'Honest take: most advice about **' + t.K1 + '** is overcomplicated. Here is the version I would give a friend —\n\n> Do the boring part (' + t.K3 + ') well, measure ' + t.K2 + ', ignore the rest for a week.\n\nYou will learn more from that week than from another article.'
];
const AR_SIGN = ['Hope that helps.', 'Happy to go deeper on any point.', 'Want an example?', '(Answer kept short on purpose.)', 'Let me know what you find.', ''];
function arLocalAnswer(model, prompt) {
  const t = arTopic(prompt), h = arHash(model), h2 = arHash(model + '|' + prompt);
  return AR_STYLES[h % AR_STYLES.length](t) + (AR_SIGN[h2 % AR_SIGN.length] ? '\n\n' + AR_SIGN[h2 % AR_SIGN.length] : '') + '\n\n<sub>offline answer · persona ' + (h % 997) + '</sub>';
}

DS.plugin({
  name: 'forge.arena', title: 'Model Arena', version: '1.0.0', tags: ['models', 'eval', 'arena'],
  description: 'Blind side-by-side model battles with Elo ratings, leaderboard, rematch and "continue with winner". Works offline with local personas.',
  apply(ctx) {
    const esc = DS.util.esc;
    DS.icons.swords = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 17.5 3 6V3h3l11.5 11.5"/><path d="m13 19 6-6"/><path d="m16 16 4 4"/><path d="m19 21 2-2"/><path d="M14.5 6.5 18 3h3v3l-3.5 3.5"/><path d="m5 14 4 4"/><path d="m7 17-3 3"/><path d="m3 19 2 2"/></svg>';
    ctx.effect(() => { const s = document.createElement('style'); s.textContent = `
.ar-wrap{display:flex;flex-direction:column;gap:12px;padding:12px 16px 24px}
.ar-tabs{margin-left:auto}
.ar-q{width:100%;min-height:76px;resize:vertical}
.ar-row{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.ar-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:10px}
.ar-side{border:1px solid var(--line);border-radius:var(--radius);background:var(--card);display:flex;flex-direction:column;min-width:0}
.ar-side.win{border-color:var(--ok);box-shadow:0 0 0 1px var(--ok) inset}
.ar-sh{display:flex;align-items:center;gap:8px;padding:9px 12px;border-bottom:1px solid var(--line);font-weight:600}
.ar-badge{width:24px;height:24px;border-radius:50%;display:grid;place-items:center;background:var(--accent-soft);color:var(--accent);font-size:12px;flex:none}
.ar-name{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ar-sb{padding:10px 12px;min-height:90px;overflow-wrap:anywhere;font-size:14px}
.ar-sb.raw{white-space:pre-wrap}
.ar-err{margin:0 12px 10px;padding:6px 9px;border-radius:8px;background:color-mix(in srgb,var(--danger) 12%,transparent);color:var(--danger);font-size:12px}
.ar-dots::after{content:'▍';animation:arb 1s steps(2) infinite;color:var(--accent)}@keyframes arb{50%{opacity:0}}
.ar-votes{display:grid;grid-template-columns:repeat(4,1fr);gap:8px}
.ar-votes .btn{min-height:44px;justify-content:center}
@media (max-width:420px){.ar-votes{grid-template-columns:1fr 1fr}}
.ar-res{padding:10px 12px;border-radius:var(--radius);background:var(--accent-soft);border:1px solid var(--accent-line);font-size:14px}
.ar-tbl{width:100%;border-collapse:collapse;font-size:13px}
.ar-tbl th,.ar-tbl td{padding:8px 6px;border-bottom:1px solid var(--line);text-align:left}
.ar-tbl td.n,.ar-tbl th.n{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
.ar-tbl td.m{word-break:break-all}
.ar-pool{width:100%;min-height:180px;font-family:var(--mono);font-size:12px}
`; document.head.appendChild(s); return () => s.remove(); });

    /* ---------- state ---------- */
    const models = () => { try { return ctx.service('forge.models'); } catch (_) { return null; } };
    const providers = () => DS.kernel.list('provider') || [];
    const findP = id => providers().find(p => p.id === id);
    function defaultPool() {
      const out = [], seen = new Set(); const fileProto = location.protocol === 'file:';
      try { const m = models(); (m && m.catalog ? m.catalog() : []).forEach(c => { if (!(c.keyless || c.free) || c.provider === 'sim' || (c.route === 'origin' && fileProto)) return; const p = findP(c.provider); let ok = true; try { ok = !!(p && (!p.available || p.available())); } catch (_) { ok = false; } if (!ok) return; const e = { provider: c.provider, model: c.id }; if (!seen.has(arKey(e)) && out.length < 10) { seen.add(arKey(e)); out.push(e); } }); } catch (_) {}
      out.push({ provider: 'sim', model: 'atlas-sim' }, { provider: 'sim', model: 'nova-sim' });
      return out;
    }
    const getPool = () => { const p = ctx.data.get('pool', null); return Array.isArray(p) && p.length ? p : defaultPool(); };
    const setPool = list => { const clean = (list || []).map(e => typeof e === 'string' ? (i => i > 0 ? { provider: e.slice(0, i).trim(), model: e.slice(i + 1).trim() } : { provider: e.trim(), model: e.trim() })(e.indexOf('/')) : { provider: String(e.provider), model: String(e.model || e.provider) }).filter(e => e.provider && e.model); ctx.data.set('pool', clean.length ? clean : null); return getPool(); };
    const ratings = () => ctx.data.get('ratings', {}) || {};
    const votes = () => ctx.data.get('votes', []) || [];
    let B = null, ctrl = null; const subs = new Set();
    const notify = k => subs.forEach(f => { try { f(k); } catch (e) { DS.kernel.log('warn', 'forge.arena', e.message); } });

    function pickPair(pool, avoid) {
      const uniq = []; const seen = new Set(); pool.forEach(e => { if (!seen.has(arKey(e))) { seen.add(arKey(e)); uniq.push(e); } });
      if (!uniq.length) uniq.push({ provider: 'sim', model: 'atlas-sim' });
      if (uniq.length === 1) return [uniq[0], uniq[0]];
      for (let tries = 0; tries < 8; tries++) {
        const i = Math.floor(Math.random() * uniq.length); let j = Math.floor(Math.random() * (uniq.length - 1)); if (j >= i) j++;
        const pair = Math.random() < 0.5 ? [uniq[i], uniq[j]] : [uniq[j], uniq[i]];
        if (!avoid || uniq.length < 3 || !(arKey(pair[0]) === avoid[0] && arKey(pair[1]) === avoid[1]) && !(arKey(pair[0]) === avoid[1] && arKey(pair[1]) === avoid[0])) return pair;
      }
      return [uniq[0], uniq[1]];
    }
    async function streamLocal(side, text, signal, onDelta) { for (let i = 0; i < text.length; i += 16) { if (signal && signal.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' }); onDelta(text.slice(i, i + 16)); await DS.util.sleep(6); } }
    /* runs one side: live provider stream, or local generator for sim / unavailable / failed */
    async function runSide(side, prompt, signal, onChange) {
      const push = d => { side.text += d; onChange(); };
      const p = side.provider === 'sim' ? null : findP(side.provider);
      let avail = false; try { avail = !!(p && (!p.available || p.available())); } catch (_) {}
      if (p && avail) {
        try {
          const r = await p.stream({ messages: [{ role: 'user', content: prompt }], tools: [], model: side.model, forceModel: side.model, signal, onDelta: d => { if (d && d.content) push(d.content); } });
          if (r && r.content && !side.text) push(r.content);
          if (!side.text.trim()) throw new Error('empty response');
          side.live = true; side.done = true; onChange(); return side;
        } catch (e) { if (e && e.name === 'AbortError') throw e; side.err = (e && e.message) || String(e); side.text = ''; }
      } else if (side.provider !== 'sim') side.err = 'provider "' + side.provider + '" is not available (no key / not loaded)';
      side.fallback = true; await streamLocal(side, arLocalAnswer(side.model, prompt), signal, push);
      side.done = true; onChange(); return side;
    }
    const mkSide = e => ({ provider: e.provider, model: e.model, key: arKey(e), text: '', err: '', fallback: false, live: false, done: false });
    async function battle(prompt, opts) {
      opts = opts || {}; prompt = String(prompt || '').trim(); if (!prompt) throw new Error('Type a prompt first');
      if (ctrl) ctrl.abort(); const my = ctrl = new AbortController();
      const [a, b] = pickPair(opts.pool || getPool(), opts.avoid);
      B = { id: DS.util.uid('ar'), prompt, a: mkSide(a), b: mkSide(b), voted: null, delta: null, ts: Date.now(), status: 'running' }; const me = B; notify('reset');
      try { await Promise.all([runSide(me.a, prompt, my.signal, () => notify('delta')), runSide(me.b, prompt, my.signal, () => notify('delta'))]); }
      catch (e) { if (e && e.name === 'AbortError') { me.status = 'aborted'; return me; } throw e; }
      if (B === me) { me.status = 'ready'; notify('ready'); }
      return me;
    }
    function vote(w) {
      if (!B || B.status !== 'ready') throw new Error('No finished battle to vote on'); if (B.voted) throw new Error('Already voted');
      if (!['a', 'b', 'tie', 'bad'].includes(w)) throw new Error('vote must be a|b|tie|bad');
      const R = ratings(), A = B.a.key, Bk = B.b.key, base = k => R[k] || { r: AR_START, g: 0, w: 0, l: 0, t: 0 };
      const ra = base(A), rb = base(Bk), before = [ra.r, rb.r];
      /* a live model that failed and was replaced by an offline stand-in must not gain or lose rating under its name */
      const voidRun = [B.a, B.b].some(x => x.fallback && x.provider !== 'sim');
      if (A !== Bk && !voidRun) {
        const sa = w === 'a' ? 1 : w === 'b' ? 0 : 0.5; const [na, nb] = arElo(ra.r, rb.r, sa);
        ra.r = na; rb.r = nb; ra.g++; rb.g++;
        if (w === 'a') { ra.w++; rb.l++; } else if (w === 'b') { rb.w++; ra.l++; } else { ra.t++; rb.t++; }
        R[A] = ra; R[Bk] = rb; ctx.data.set('ratings', R);
      }
      B.voted = w; B.delta = { a: [before[0], ra.r], b: [before[1], rb.r], same: A === Bk, unrated: voidRun };
      const v = votes(); v.push({ id: B.id, ts: Date.now(), prompt: B.prompt, a: A, b: Bk, vote: w, ratingA: [before[0], ra.r], ratingB: [before[1], rb.r], fallbackA: B.a.fallback, fallbackB: B.b.fallback, unrated: voidRun }); ctx.data.set('votes', v.slice(-500));
      notify('voted'); if (voidRun) ctx.toast('Vote saved but not rated — a live model failed and an offline stand-in answered', 'warn', 4500); return { vote: w, unrated: voidRun, a: { model: A, rating: Math.round(ra.r) }, b: { model: Bk, rating: Math.round(rb.r) } };
    }
    const board = () => Object.entries(ratings()).map(([k, s]) => ({ model: k, rating: Math.round(s.r), games: s.g, wins: s.w, losses: s.l, ties: s.t, winPct: s.g ? Math.round(100 * s.w / s.g) : 0, rough: s.g ? Math.round(400 / Math.sqrt(s.g)) : null })).sort((x, y) => y.rating - x.rating);
    const exportVotes = () => { const data = { exported: new Date().toISOString(), k: AR_K, start: AR_START, ratings: ratings(), votes: votes() }; DS.util.download('arena-votes-' + Date.now() + '.json', JSON.stringify(data, null, 2), 'application/json'); return data; };
    const resetRatings = () => { ctx.data.set('ratings', {}); ctx.data.set('votes', []); notify('board'); };
    function continueWinner() {
      if (!B || !B.voted || !['a', 'b'].includes(B.voted)) throw new Error('Vote A or B first');
      const s = B[B.voted]; try { const m = models(); if (m && m.select) m.select(s.provider, s.provider === 'sim' ? undefined : s.model); } catch (e) { ctx.toast('Could not select ' + s.key + ': ' + e.message, 'warn'); }
      DS.shell.show('thread'); const p = B.prompt; setTimeout(() => { try { DS.threadView.submit(p); } catch (e) { ctx.toast(e.message, 'err'); } }, 30); return s.key;
    }
    ctx.provide('forge.arena', { battle, vote, state: () => B && JSON.parse(JSON.stringify(B)), board, ratings, votes, pool: getPool, setPool, defaultPool, exportVotes, resetRatings, continueWinner, elo: arElo, localAnswer: arLocalAnswer, pickPair });

    /* ---------- view ---------- */
    let tab = 'battle', lastPrompt = '';
    ctx.view({ id: 'arena', title: 'Arena', icon: 'swords', order: 86, badge: () => B && B.status === 'ready' && !B.voted ? 'vote' : '',
      mount(el) {
        el.innerHTML = '<div class="vhead"><h2>Arena</h2><div class="seg ar-tabs"><button data-t="battle">Battle</button><button data-t="board">Leaderboard</button><button data-t="pool">Pool</button></div></div><div class="vscroll"><div class="ar-wrap"></div></div>';
        const W = el.querySelector('.ar-wrap'); const $ = s => W.querySelector(s);
        const segs = () => el.querySelectorAll('.ar-tabs button').forEach(b => b.classList.toggle('on', b.dataset.t === tab));
        const label = (B, k) => B && B.voted ? B[k].key : 'Model ' + k.toUpperCase();
        function sideHTML(k) { return '<div class="ar-side" data-s="' + k + '"><div class="ar-sh"><span class="ar-badge">' + k.toUpperCase() + '</span><span class="ar-name"></span><span class="grow"></span><span class="chip xs ar-tag" hidden></span></div><div class="ar-sb raw"></div><div class="ar-err" hidden></div></div>'; }
        function drawBattle() {
          W.innerHTML = '<textarea class="inp ar-q" placeholder="Ask anything — two anonymous models will answer. Vote, then see who they were."></textarea><div class="ar-row"><button class="btn pri ar-go">' + DS.icon('play') + ' Battle</button><span class="muted xs ar-pool-n"></span></div><div class="ar-out"></div>';
          $('.ar-q').value = (B && B.prompt) || lastPrompt; $('.ar-pool-n').textContent = getPool().length + ' models in pool · blind until you vote'; drawOut(true);
        }
        function drawOut(full) {
          const out = $('.ar-out'); if (!out) return;
          if (!B) { out.innerHTML = '<div class="empty-v muted sm">No battle yet. Type a prompt and tap <b>Battle</b>.</div>'; return; }
          if (full || !out.querySelector('.ar-grid')) out.innerHTML = '<div class="ar-grid">' + sideHTML('a') + sideHTML('b') + '</div><div class="ar-vote-box" style="margin-top:12px"></div>';
          ['a', 'b'].forEach(k => { const s = B[k], box = out.querySelector('[data-s="' + k + '"]'), body = box.querySelector('.ar-sb');
            box.querySelector('.ar-name').textContent = label(B, k);
            const tag = box.querySelector('.ar-tag'); tag.hidden = !B.voted; if (B.voted) { tag.textContent = s.fallback ? 'offline answer' : 'live'; tag.className = 'chip xs ar-tag ' + (s.fallback ? 'warn' : 'ok'); }
            box.classList.toggle('win', B.voted === k);
            if (s.done && !body._md) { body._md = 1; body.classList.remove('raw', 'ar-dots'); body.innerHTML = ''; try { DS.render.into(body, s.text); } catch (_) { body.textContent = s.text; } }
            else if (!s.done) { body.textContent = s.text; body.classList.add('ar-dots'); }
            const er = box.querySelector('.ar-err'); er.hidden = !s.err; if (s.err) er.textContent = '⚠ Live call failed — showing offline answer. ' + (B.voted ? s.err : '(details shown after you vote, to keep it blind)');
          });
          drawVote();
        }
        function drawVote() {
          const vb = $('.ar-vote-box'); if (!vb || !B) return;
          if (B.status === 'running') { vb.innerHTML = '<div class="muted sm">Both models are answering…</div>'; return; }
          if (!B.voted) { vb.innerHTML = '<div class="sec-t">Which is better?</div><div class="ar-votes"><button class="btn" data-v="a">👈 A is better</button><button class="btn" data-v="b">B is better 👉</button><button class="btn" data-v="tie">🤝 Tie</button><button class="btn" data-v="bad">👎 Both bad</button></div>'; return; }
          const d = B.delta, f = x => Math.round(x), sg = x => (x >= 0 ? '+' : '') + Math.round(x), vt = { a: 'You picked <b>A</b>', b: 'You picked <b>B</b>', tie: 'You called it a <b>tie</b>', bad: 'You said <b>both bad</b> (scored as a tie)' }[B.voted];
          vb.innerHTML = '<div class="ar-res">' + vt + '.<br>A = <b class="mono">' + esc(B.a.key) + '</b> ' + (d.same ? '' : f(d.a[0]) + ' → <b>' + f(d.a[1]) + '</b> (' + sg(d.a[1] - d.a[0]) + ')') + '<br>B = <b class="mono">' + esc(B.b.key) + '</b> ' + (d.same ? '' : f(d.b[0]) + ' → <b>' + f(d.b[1]) + '</b> (' + sg(d.b[1] - d.b[0]) + ')') + (d.same ? '<br><span class="muted xs">Same model on both sides (pool has one entry) — ratings unchanged.</span>' : '') + '</div><div class="ar-row" style="margin-top:10px"><button class="btn pri ar-re">' + DS.icon('redo') + ' Rematch</button><button class="btn ar-cont"' + (['a', 'b'].includes(B.voted) ? '' : ' disabled') + '>' + DS.icon('share') + ' Continue with winner</button><button class="btn ar-new">New prompt</button></div>';
        }
        function drawBoard() {
          const rows = board();
          W.innerHTML = '<div class="ar-row"><button class="btn sm ar-exp">' + DS.icon('download') + ' Export votes JSON</button><button class="btn sm danger ar-reset">' + DS.icon('trash') + ' Reset ratings</button><span class="grow"></span><span class="muted xs">' + votes().length + ' votes · K=' + AR_K + '</span></div>' +
            (rows.length ? '<table class="ar-tbl"><thead><tr><th>#</th><th>Model</th><th class="n">Rating</th><th class="n">Games</th><th class="n">Win%</th></tr></thead><tbody>' + rows.map((r, i) => '<tr><td>' + (i + 1) + '</td><td class="m mono">' + esc(r.model) + '</td><td class="n"><b>' + r.rating + '</b> <span class="muted xs">±' + r.rough + '</span></td><td class="n">' + r.games + '</td><td class="n">' + r.winPct + '%</td></tr>').join('') + '</tbody></table><div class="muted xs">± = 400/√games, a <b>rough</b> uncertainty band (not a bootstrap CI). Ties and "both bad" count as half a win in Elo.</div>' : '<div class="empty-v muted sm">No rated battles yet. Vote in a battle to start the leaderboard.</div>');
        }
        function drawPool() {
          const prov = providers().map(p => p.id).join(', ');
          W.innerHTML = '<div class="field"><label>Battle pool — one <span class="mono">provider/model</span> per line</label><textarea class="inp ar-pool"></textarea><div class="hint">Default = keyless/free models from the Model catalog + two offline personas (<span class="mono">sim/…</span>). Any <span class="mono">sim/&lt;name&gt;</span> line is a distinct offline persona. Loaded providers: ' + esc(prov) + '</div></div><div class="ar-row"><button class="btn pri ar-psave">Save pool</button><button class="btn ar-pdef">Reset to default</button><button class="btn ar-poff">Offline only</button></div>';
          $('.ar-pool').value = getPool().map(arKey).join('\n');
        }
        function draw() { segs(); if (tab === 'battle') drawBattle(); else if (tab === 'board') drawBoard(); else drawPool(); }
        async function go(p, avoid) { lastPrompt = p; tab = 'battle'; try { const r = battle(p, { avoid }); draw(); await r; } catch (e) { ctx.toast(e.message, 'err'); } }
        el.addEventListener('click', async e => {
          const t = e.target.closest('button'); if (!t) return;
          if (t.dataset.t) { tab = t.dataset.t; draw(); return; }
          if (t.dataset.v) { try { vote(t.dataset.v); } catch (er) { ctx.toast(er.message, 'warn'); } return; }
          if (t.classList.contains('ar-go')) { const q = $('.ar-q').value.trim(); if (!q) return ctx.toast('Type a prompt first', 'warn'); go(q); }
          else if (t.classList.contains('ar-re')) go(B.prompt, [B.a.key, B.b.key]);
          else if (t.classList.contains('ar-new')) { lastPrompt = ''; B = null; drawBattle(); $('.ar-q').focus(); }
          else if (t.classList.contains('ar-cont')) { try { const k = continueWinner(); ctx.toast('Model: ' + k, 'ok'); } catch (er) { ctx.toast(er.message, 'warn'); } }
          else if (t.classList.contains('ar-exp')) { exportVotes(); ctx.toast('Exported ' + votes().length + ' votes', 'ok'); }
          else if (t.classList.contains('ar-reset')) { if (await DS.ui.confirm('Reset all arena ratings and votes?', 'Reset')) { resetRatings(); drawBoard(); ctx.toast('Ratings reset', 'ok'); } }
          else if (t.classList.contains('ar-psave')) { const n = setPool($('.ar-pool').value.split('\n').map(s => s.trim()).filter(Boolean)).length; ctx.toast('Pool: ' + n + ' models', 'ok'); }
          else if (t.classList.contains('ar-pdef')) { setPool(null); drawPool(); }
          else if (t.classList.contains('ar-poff')) { setPool(['sim/atlas-sim', 'sim/nova-sim', 'sim/orion-sim']); drawPool(); }
        });
        el.addEventListener('keydown', e => { if (e.target.classList.contains('ar-q') && e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); el.querySelector('.ar-go').click(); } });
        let raf = 0; const sub = k => { if (tab !== 'battle') { if (k === 'board' && tab === 'board') drawBoard(); return; } if (k === 'delta') { if (!raf) raf = requestAnimationFrame(() => { raf = 0; drawOut(false); }); return; } drawOut(k === 'reset'); };
        subs.add(sub); draw();
        return () => { subs.delete(sub); if (raf) cancelAnimationFrame(raf); };
      } });

    /* ---------- command / tool / sim ---------- */
    ctx.command({ name: 'arena', args: '<prompt>', desc: 'Blind battle between two models (vote to reveal)', run(arg, c) {
      DS.shell.show('arena'); if (arg.trim()) { lastPrompt = arg.trim(); tab = 'battle'; battle(arg.trim()).catch(e => ctx.toast(e.message, 'err')); }
      else c.reply('Opened the **Arena**. Type a prompt there, or use `/arena <prompt>`.'); } });
    ctx.tool({ name: 'arena_battle', gate: 'none', label: 'Arena battle',
      description: 'Run the same prompt on two different models from the arena pool and return both answers WITH model names. Not blind (agent-run) and does not change Elo ratings; for blind voting the user uses the Arena view.',
      parameters: { type: 'object', properties: { prompt: { type: 'string', description: 'Prompt to send to both models' } }, required: ['prompt'] },
      async run(args, tctx) {
        const prompt = String(args.prompt || '').trim(); if (!prompt) throw new Error('prompt required');
        const [a, b] = pickPair(getPool()); const A = mkSide(a), Bs = mkSide(b);
        await Promise.all([runSide(A, prompt, tctx && tctx.signal, () => {}), runSide(Bs, prompt, tctx && tctx.signal, () => {})]);
        const pack = s => ({ model: s.key, offline: s.fallback, error: s.err || undefined, answer: s.text.slice(0, 3500) });
        return { mode: 'not blind (agent-run)', note: 'Model names are shown openly because an agent cannot vote blind. Ratings unchanged — open the Arena view for blind voting.', prompt, a: pack(A), b: pack(Bs) };
      },
      summarize: (a, r) => r && r.a ? r.a.model + ' vs ' + r.b.model + ' (not blind)' : 'arena battle' });
    ctx.intent({ id: 'arena', order: 50, match: t => /^\s*(run\s+(an?\s+)?)?(model\s+)?arena\b|\b(arena|blind)\s+battle\b|\bpit\s+two\s+models\b/i.test(t),
      script: t => { const p = t.replace(/^[\s\S]*?(battle|arena)\b\s*(on|about|for|:)?\s*/i, '').trim() || 'Explain recursion to a 10-year-old';
        return [{ say: 'Running an arena battle (agent-run, so **not blind**)…', tool: { name: 'arena_battle', args: { prompt: p } } },
          { final: rs => { const r = rs[rs.length - 1] || {}; if (!r.a) return 'The arena battle failed: ' + (r.error || 'unknown error'); const sec = s => '**' + s.model + '**' + (s.offline ? ' _(offline answer)_' : '') + '\n\n' + s.answer.replace(/<sub>[\s\S]*?<\/sub>/g, '').trim(); return '### Arena — not blind (agent-run)\n\n**Prompt:** ' + r.prompt + '\n\n---\n\n' + sec(r.a) + '\n\n---\n\n' + sec(r.b) + '\n\n---\n\nFor a **blind** vote with Elo ratings, open the Arena view or type `/arena ' + r.prompt + '`.'; } }]; } });
    ctx.suggest({ id: 'arena', emoji: '⚔️', title: 'Model arena', sub: 'Two anonymous models, you judge', run: () => { DS.shell.show('arena'); } });
  }
});
