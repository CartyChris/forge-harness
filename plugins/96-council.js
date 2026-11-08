/* forge.council — the "Consciousness": several models debate, rank each other anonymously, a chair synthesizes.
   Modes: Debate · Council (karpathy/llm-council style) · Brainstorm · Comedy riff. Offline: built-in council-sim. */
const CN_ROLES = {
  proposer: { label: 'Proposer', emoji: '💡', sys: 'You are the PROPOSER on a council of AI models. Put forward a concrete, actionable position and defend or refine it as others respond.' },
  skeptic: { label: 'Skeptic', emoji: '🛡️', sys: 'You are the SKEPTIC / red-team on a council of AI models. You MUST disagree with at least one specific point made so far (name it), surface risks, hidden assumptions and failure modes. Never simply agree; if you concede, still state your strongest remaining objection.' },
  expert: { label: 'Domain expert', emoji: '🎓', sys: 'You are the DOMAIN EXPERT on a council of AI models. Ground the discussion in prior art, standard practice, numbers and pitfalls from the field.' },
  comedian: { label: 'Comedian', emoji: '🎭', sys: 'You are the COMEDIAN on a council of AI models. Be genuinely funny and short, but every joke must carry a real point about the question.' },
  judge: { label: 'Judge / Chair', emoji: '⚖️', sys: 'You are the JUDGE / CHAIR and moderator of a council of AI models. Summarize where seats agree and disagree. If the seats have genuinely converged, begin your reply with the word CONSENSUS. Be impartial; ignore answer order and length.' }
};
const CN_MODES = {
  debate: { label: 'Debate', rule: 'This is a DEBATE. Respond to specific points by seat name; argue, concede or refine.' },
  council: { label: 'Council', rule: 'This is a COUNCIL: answer independently, then rank anonymized peers.' },
  brainstorm: { label: 'Brainstorm', rule: 'This is a BRAINSTORM. Build on previous ideas ("yes, and"), add at least one NEW idea per turn, no repeats.' },
  comedy: { label: 'Comedy riff', rule: 'This is a COMEDY RIFF. Riff off the previous joke, escalate, keep it kind, under 60 words.' }
};
const cnWords = s => String(s || '').toLowerCase().replace(/[`*_#>\[\]()]/g, ' ').match(/[a-z0-9À-￿']+/g) || [];
const cnTrigrams = s => { const w = cnWords(s), set = new Set(); for (let i = 0; i + 2 < w.length; i++) set.add(w[i] + ' ' + w[i + 1] + ' ' + w[i + 2]); return set; };
const cnSimilarity = (a, b) => { const A = cnTrigrams(a), B = cnTrigrams(b); if (!A.size && !B.size) return 0; let n = 0; A.forEach(t => { if (B.has(t)) n++; }); return n / (A.size + B.size - n); };
/* order-swapped pairwise: v1 = verdict for (X,Y), v2 = verdict for (Y,X); each '1' | '2' | 'tie' */
const cnResolvePair = (v1, v2) => { const w1 = v1 === '1' ? 'X' : v1 === '2' ? 'Y' : 'tie'; const w2 = v2 === '1' ? 'Y' : v2 === '2' ? 'X' : 'tie'; return w1 === w2 ? w1 : 'bias'; };
const cnAgrees = t => /\b(i agree|agreed|concur|exactly|great point|well said|i second|spot on|fully support)\b/i.test(t) && !/\b(disagree|however|but|risk|concern|object|wrong|counter|unless)\b/i.test(t);
const cnDisagrees = t => /\b(disagree|however|but|risk|concern|object|wrong|counter|unless|not convinced|push back)\b/i.test(t);
const cnHash = s => { let h = 2166136261; for (const c of String(s)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };

/* ---------- council-sim: deterministic, distinct, role-aware canned contributions ---------- */
const CN_SIM = {
  proposer: [
    '**Position:** for “{T}”, start with the simplest version that works — a narrow pilot focused on **{K1}**, measured for two weeks, then expand. (1) Small scope lowers risk. (2) {K2} gives a clear success metric. (3) It is cheap to reverse.',
    'Responding to the Skeptic: fair hit on hidden costs. Revised plan — keep the pilot but add a kill-switch and a budget cap. Learning fast on {K1} still beats a long design phase; the data will settle the {K2} question.',
    'Final stance: pilot + kill-switch + budget cap, a named owner, review at day 14. That merges both sides on {K2}.'],
  skeptic: [
    '**I disagree on one point:** a pilot on {K1} can hide the real failure mode. Risks: (1) selection bias — early adopters are friendlier than the median; (2) {K2} may not be measurable in two weeks; (3) reversibility is assumed, not shown. What evidence would change the plan?',
    'Better, but I still disagree that two weeks is enough. Counter-proposal: define the failure threshold *before* starting and pre-register the {K2} metric so nobody moves the goalposts.',
    'I can accept it if the failure threshold is written down. Remaining objection, for the record: long-tail effects of {K1} will not show up in a pilot.'],
  expert: [
    '**Domain view:** in practice {K1} efforts stall on integration, not ideas. Standard practice is a staged rollout (10% → 50% → 100%) with {K2} instrumented from day one. Classic pitfall: nobody owns the metric.',
    'Both proposals fit standard practice. Concretely: a pre-registered metric, staged rollout, and a rollback runbook — that is what mature teams do for {K1}.',
    'Technically sound now. One addition: write the assumptions down so the next review can audit them.'],
  comedian: [
    '“{T}”? I asked my toaster and it said *pilot first* — then it burned the pilot. Moral: always ship a kill-switch, and never trust a kitchen appliance with {K2}.',
    'The Skeptic wants a pre-registered metric. I pre-registered my diet in January; the goalposts moved, they are in the fridge now. So yes — write the {K2} threshold down *in pen*.',
    'We agree! Quick, screenshot it before the Skeptic finds another risk. This council has more process than my wedding — and the wedding had a rollback plan.'],
  judge: [
    '**Moderator:** real disagreement on whether {K2} is measurable quickly and on pilot length. Open: failure threshold, owner, rollback. Not converged yet — next round, address the Skeptic directly.',
    'CONSENSUS on the core plan: pilot on {K1} + pre-registered {K2} metric + kill-switch + named owner. Minor dissent remains on pilot length (logged).',
    'CONSENSUS reached.']
};
const CN_IDEAS = ['a one-page {K1} checklist', 'a weekly {K2} digest', 'a public scoreboard', 'pairing newcomers with a mentor', 'a “pre-mortem” session', 'a tiny CLI that automates the boring part of {K1}', 'office hours for {K2}', 'a bounty for the best failure story', 'an opt-in beta channel', 'a 5-minute demo every Friday', 'templates people can fork', 'a dashboard with one number', 'a “kill a meeting” day', 'a shared glossary for {K1}', 'a monthly retro with real data'];
const CN_JOKES = ['Why did {K1} join the council? It heard there would be snacks and *consensus*, and only one of those showed up.', 'Yes, and — {K2} walked into a bar. The bartender asked for a metric. {K2} said “vibes”.', 'Yes, and the Skeptic ordered a drink, then red-teamed the ice cubes.', 'Yes, and the Judge banged the gavel so hard it achieved CONSENSUS with the table.', 'Yes, and the Expert cited a 2009 paper proving the joke was funnier in staging.', 'And that is why {T} now ships with a laugh track and a rollback plan.'];
function cnTopic(q) {
  const w = cnWords(q).filter(x => x.length > 3 && !/^(what|which|should|would|could|there|their|about|with|from|this|that|have|best|into|does|when|where|your)$/.test(x));
  const by = w.slice().sort((a, b) => b.length - a.length);
  return { T: String(q || 'the question').replace(/[?.!\s]+$/, '').slice(0, 70), K1: by[0] || 'the idea', K2: by[1] || by[0] || 'the outcome' };
}
const cnFill = (s, tp) => s.replace(/\{T\}/g, tp.T).replace(/\{K1\}/g, tp.K1).replace(/\{K2\}/g, tp.K2);
function cnSimGenerate(o) {
  const tp = cnTopic(o.question), r = Math.max(0, (o.round || 1) - 1), role = CN_ROLES[o.role] ? o.role : 'proposer';
  if (o.phase === 'rank') {
    const list = o.answers.slice().sort((a, b) => (b.text.length + (cnHash(b.letter + o.seat) % 40)) - (a.text.length + (cnHash(a.letter + o.seat) % 40)));
    return 'Reasoning: ' + list.map((a, i) => 'Response ' + a.letter + (i === 0 ? ' is the most concrete' : i === list.length - 1 ? ' is the least actionable' : ' is solid but narrower')).join('; ') + '.\n\nFINAL RANKING:\n' + list.map((a, i) => (i + 1) + '. Response ' + a.letter).join('\n');
  }
  if (o.phase === 'pair') return 'VERDICT: ' + (o.a.length >= o.b.length ? '1' : '2') + '\nThe ' + (o.a.length >= o.b.length ? 'first' : 'second') + ' answer is more specific and addresses more risks.';
  if (o.phase === 'synth') {
    const pts = (o.turns || []).filter(t => t.role !== 'judge').map(t => '- **' + t.who + ':** ' + cnFirst(t.text));
    const sk = (o.turns || []).filter(t => t.role === 'skeptic').pop();
    return '## Chair synthesis\n**Question:** ' + tp.T + '\n\n**Verdict:** run a small, reversible pilot on ' + tp.K1 + ' with a pre-registered ' + tp.K2 + ' metric, a kill-switch and a named owner; expand only if the threshold is met.\n\n**Key points**\n' + pts.slice(0, 6).join('\n') + (sk ? '\n\n**Dissent logged:** ' + cnFirst(sk.text) : '') + '\n\n**Next step:** write the failure threshold down, then start.\n\n_Offline council-sim — add API keys for real models._';
  }
  if (o.mode === 'brainstorm' && role !== 'judge') { const i = (o.seatIdx * 5 + r * 3) % CN_IDEAS.length; return (r ? 'Yes, and building on that — ' : '') + '**Idea:** ' + cnFill(CN_IDEAS[i], tp) + '. Twist: combine it with ' + cnFill(CN_IDEAS[(i + 7) % CN_IDEAS.length], tp) + ' so it compounds.'; }
  if (o.mode === 'comedy' && role !== 'judge') return cnFill(CN_JOKES[(o.seatIdx + r * 2) % CN_JOKES.length], tp);
  if (o.mode === 'council' && role === 'judge') return '**Chair’s own answer:** a reversible pilot on ' + tp.K1 + ' with a pre-registered ' + tp.K2 + ' metric is the safest high-information move; the main risk is an unclear owner.';
  return cnFill(CN_SIM[role][Math.min(r, 2)], tp);
}
function cnFirst(t) { const s = String(t || '').replace(/[*_#>`]/g, '').replace(/\s+/g, ' ').trim(); const m = s.match(/^.{20,180}?[.!?](\s|$)/); return (m ? m[0] : s.slice(0, 160)).trim(); }

DS.plugin({
  name: 'forge.council', title: 'Council', version: '1.0.0', tags: ['multi-agent', 'debate', 'consciousness'],
  description: 'The Consciousness: 2–5 model seats (Proposer, Skeptic, Expert, Comedian, Judge) debate, rank each other anonymously and a chair synthesizes. Repetition-collapse stop, sycophancy guard, order-swapped judging. Works offline with council-sim.',
  apply(ctx) {
    const esc = DS.util.esc;
    DS.icons.council = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="9.5" r="5"/><circle cx="15" cy="9.5" r="5"/><circle cx="12" cy="15" r="5"/></svg>';
    const providers = () => DS.kernel.list('provider') || [];
    const findP = id => providers().find(p => p.id === id);
    const models = () => { try { return ctx.service('forge.models'); } catch (_) { return null; } };
    const modelsFor = pid => { const m = models(); let ids = []; try { if (m && m.catalog) ids = m.catalog().filter(c => c.provider === pid).map(c => c.id); } catch (_) {} const p = findP(pid); if (!ids.length && p && p.models) ids = p.models.slice(); return ids.length ? ids.slice(0, 60) : ['default']; };
    const defaultSeat = role => { let p = null; try { p = DS.providers.pick(); } catch (_) {} const pid = p && p.id ? p.id : 'sim'; let model = modelsFor(pid)[0]; try { const id = models() && models().identity(); if (id && id.provider === pid && id.model) model = id.model; } catch (_) {} return { role, provider: pid, model }; };
    let cfg = ctx.data.get('cfg', null);
    if (!cfg || !Array.isArray(cfg.seats) || cfg.seats.length < 2) cfg = { mode: 'debate', rounds: 3, seats: ['proposer', 'skeptic', 'judge'].map(defaultSeat) };
    const saveCfg = () => ctx.data.set('cfg', cfg);
    const fresh = () => ({ id: DS.util.uid('cn'), question: '', mode: cfg.mode, seats: [], turns: [], chips: [], ranking: null, pairwise: null, summary: null, status: 'idle', stopReason: '', ts: Date.now() });
    let S = fresh(), ctrl = null; const subs = new Set();
    const notify = (k, x) => subs.forEach(f => { try { f(k, x); } catch (e) { DS.kernel.log('warn', 'forge.council', e.message); } });
    const chip = (kind, text) => { if (!S.chips.some(c => c.text === text)) { S.chips.push({ kind, text }); notify('chips'); } };
    const seatName = (i, s) => 'Seat ' + String.fromCharCode(65 + i) + ' · ' + CN_ROLES[s.role].label;

    async function streamText(text, onDelta, signal) { for (let i = 0; i < text.length; i += 22) { if (signal && signal.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' }); onDelta(text.slice(i, i + 22)); await DS.util.sleep(8); } return text; }
    async function callSeat(seat, messages, simInfo, onDelta, signal) {
      let p = seat.provider === 'sim' ? null : findP(seat.provider);
      let avail = false; try { avail = !!(p && (!p.available || p.available())); } catch (_) {}
      if (!p || !avail) { if (seat.provider !== 'sim') chip('warn', (seat.provider || '?') + ' unavailable → council-sim used'); return { text: await streamText(cnSimGenerate(simInfo), onDelta, signal), sim: true }; }
      let acc = '';
      const r = await p.stream({ messages, tools: [], model: seat.model, signal, onDelta: d => { if (d && d.content) { acc += d.content; onDelta(d.content); } } });
      const text = (r && r.content) || acc; if (text && !acc) onDelta(text); return { text, sim: false };
    }
    const sysFor = (seat, mode) => CN_ROLES[seat.role].sys + '\n' + CN_MODES[mode].rule + '\nModerator rules: speak only for your seat, ≤120 words, no greetings, reference other seats by name, do not repeat yourself.';
    const transcript = (turns, upto) => turns.slice(0, upto).filter(t => t.stage === 'turn' || t.stage === 'answer').map(t => '[' + t.who + ', round ' + t.round + ']: ' + t.text).join('\n\n');

    async function runTurn(seat, i, round, stage, messages, simInfo, signal) {
      const t = { id: DS.util.uid('t'), seat: i, who: seatName(i, seat), role: seat.role, provider: seat.provider, model: seat.model, round, stage, text: '', streaming: true };
      S.turns.push(t); notify('turn', t);
      try { const r = await callSeat(seat, messages, simInfo, d => { t.text += d; notify('delta', t); }, signal); t.text = r.text || t.text; t.sim = r.sim; }
      catch (e) { if (e.name === 'AbortError') { t.streaming = false; notify('done', t); throw e; } t.text = (t.text ? t.text + '\n\n' : '') + '⚠️ ' + e.message; t.error = true; chip('err', t.who + ': ' + e.message.slice(0, 60)); }
      t.streaming = false; notify('done', t); return t;
    }
    async function pairwise(judge, ji, X, Y, signal) {
      const ask = async (a, b) => { const msgs = [{ role: 'system', content: CN_ROLES.judge.sys }, { role: 'user', content: 'Question: ' + S.question + '\n\nAnswer 1:\n' + a + '\n\nAnswer 2:\n' + b + '\n\nWhich answer is better? Reply with exactly one line "VERDICT: 1", "VERDICT: 2" or "VERDICT: TIE", then one sentence why.' }];
        const r = await callSeat(judge, msgs, { phase: 'pair', a, b, question: S.question }, () => {}, signal); const m = /VERDICT:\s*(1|2|TIE)/i.exec(r.text || ''); return m ? m[1].toLowerCase() : 'tie'; };
      const v1 = await ask(X.text, Y.text), v2 = await ask(Y.text, X.text), res = cnResolvePair(v1, v2);
      S.pairwise = { x: X.label || X.who, y: Y.label || Y.who, v1, v2, result: res, text: res === 'bias' ? 'position bias — tie' : res === 'tie' ? 'tie' : (res === 'X' ? (X.label || X.who) : (Y.label || Y.who)) + ' wins (both orders agree)' };
      if (res === 'bias') chip('warn', 'Judge showed position bias — scored as tie'); notify('board');
    }

    async function convene(opts) {
      opts = opts || {};
      if (ctrl) ctrl.abort();
      const myCtrl = ctrl = new AbortController(); const signal = myCtrl.signal;
      if (opts.signal) opts.signal.addEventListener('abort', () => myCtrl.abort(), { once: true });
      const mode = CN_MODES[opts.mode] ? opts.mode : cfg.mode;
      const seats = (opts.seats || cfg.seats).slice(0, 5).map(s => Object.assign({}, s)); if (seats.length < 2) throw new Error('Council needs at least 2 seats');
      const rounds = Math.max(1, Math.min(6, +(opts.rounds || cfg.rounds) || 3));
      S = fresh(); Object.assign(S, { question: String(opts.question || '').trim() || 'What should we build next?', mode, seats, rounds, status: 'running' }); notify('reset');
      const order = seats.map((s, i) => ({ s, i })).sort((a, b) => (a.s.role === 'judge') - (b.s.role === 'judge'));
      const judgeIx = seats.findIndex(s => s.role === 'judge'), chairIx = judgeIx >= 0 ? judgeIx : seats.length - 1;
      try {
        if (mode === 'council') {
          await Promise.all(seats.map((s, i) => runTurn(s, i, 1, 'answer', [{ role: 'system', content: sysFor(s, mode) }, { role: 'user', content: 'Question: ' + S.question + '\n\nGive your independent answer.' }], { role: s.role, round: 1, mode, seatIdx: i, question: S.question }, signal)));
          const ans = S.turns.filter(t => t.stage === 'answer'), rot = cnHash(S.question) % ans.length;
          ans.forEach((t, k) => { t.letter = String.fromCharCode(65 + ((k + rot) % ans.length)); t.label = 'Response ' + t.letter; });
          const anon = ans.slice().sort((a, b) => a.letter < b.letter ? -1 : 1).map(t => ({ letter: t.letter, text: t.text }));
          const block = anon.map(a => 'Response ' + a.letter + ':\n' + a.text).join('\n\n');
          const ranks = await Promise.all(seats.map((s, i) => runTurn(s, i, 2, 'rank', [{ role: 'system', content: 'You evaluate anonymized answers impartially. Ignore order and length.' }, { role: 'user', content: 'Question: ' + S.question + '\n\n' + block + '\n\nCritique each briefly, then end with "FINAL RANKING:" followed by a numbered list best→worst like "1. Response B".' }], { phase: 'rank', answers: anon, seat: i, question: S.question }, signal)));
          const pts = {}; anon.forEach(a => pts[a.letter] = 0);
          ranks.forEach(r => { const tail = (r.text.split(/FINAL RANKING:/i)[1] || r.text); const seen = []; (tail.match(/Response\s+([A-E])/g) || []).forEach(m => { const L = m.slice(-1); if (pts[L] != null && !seen.includes(L)) seen.push(L); }); seen.forEach((L, k) => pts[L] += anon.length - k); });
          S.ranking = Object.entries(pts).sort((a, b) => b[1] - a[1]).map(([L, p]) => { const t = ans.find(x => x.letter === L); return { letter: L, points: p, who: t.who, provider: t.provider }; }); notify('board');
          const top = S.ranking.slice(0, 2).map(r => ans.find(t => t.letter === r.letter));
          if (top.length === 2) await pairwise(seats[chairIx], chairIx, top[0], top[1], signal);
        } else {
          outer: for (let r = 1; r <= rounds; r++) {
            S.round = r; notify('status');
            for (const { s, i } of order) {
              const msgs = [{ role: 'system', content: sysFor(s, mode) }, { role: 'user', content: 'Question: ' + S.question + '\n\nTranscript so far:\n' + (transcript(S.turns) || '(you speak first)') + '\n\nRound ' + r + ' of ' + rounds + '. You are ' + seatName(i, s) + '.' + (s.role === 'judge' ? ' If converged, start with CONSENSUS.' : '') }];
              const t = await runTurn(s, i, r, 'turn', msgs, { role: s.role, round: r, mode, seatIdx: i, question: S.question }, signal);
              if (s.role === 'skeptic' && mode === 'debate' && !cnDisagrees(t.text)) chip('warn', t.who + ' did not disagree with any point');
              const prev = S.turns.filter(x => x.stage === 'turn' && x.seat === i && x !== t).pop();
              if (prev) { const j = cnSimilarity(prev.text, t.text); if (j > 0.6) { S.stopReason = 'repetition collapse: ' + t.who + ' repeated itself (trigram Jaccard ' + j.toFixed(2) + ')'; chip('warn', 'Repetition collapse — stopped'); break outer; } }
              if (s.role === 'judge' && /^\W*CONSENSUS\b/i.test(t.text)) { S.stopReason = 'judge declared CONSENSUS in round ' + r; chip('ok', 'Consensus · round ' + r); break outer; }
            }
            if (r === 1) { const r1 = S.turns.filter(t => t.round === 1 && t.role !== 'judge'); if (r1.length >= 2 && r1.every(t => cnAgrees(t.text))) chip('warn', 'All seats agree in round 1 — possible sycophancy cascade'); }
            if (r === rounds) S.stopReason = 'max rounds (' + rounds + ') reached';
          }
          const nj = seats.map((s, i) => ({ s, i })).filter(x => x.s.role !== 'judge');
          if (judgeIx >= 0 && nj.length >= 2) { const last = k => S.turns.filter(t => t.stage === 'turn' && t.seat === k).pop(); const X = last(nj[0].i), Y = last(nj[1].i); if (X && Y) await pairwise(seats[judgeIx], judgeIx, X, Y, signal); }
        }
        const chair = seats[chairIx];
        const sm = await runTurn(chair, chairIx, 0, 'synth', [{ role: 'system', content: CN_ROLES.judge.sys + '\nYou are now the CHAIR writing the final synthesis.' }, { role: 'user', content: 'Question: ' + S.question + '\n\nFull council transcript:\n' + S.turns.filter(t => t.stage !== 'synth').map(t => '[' + (t.label || t.who) + ' / ' + t.stage + ']: ' + t.text).join('\n\n') + (S.ranking ? '\n\nPeer ranking (Borda): ' + S.ranking.map(r => r.letter + '=' + r.points).join(', ') : '') + '\n\nWrite a markdown synthesis: verdict, key points, dissent, next step. ≤200 words.' }], { phase: 'synth', question: S.question, turns: S.turns.filter(t => t.stage === 'turn' || t.stage === 'answer') }, signal);
        S.summary = sm.text; S.status = 'done';
      } catch (e) {
        if (e.name !== 'AbortError') { S.status = 'error'; S.stopReason = e.message; chip('err', e.message.slice(0, 80)); }
        else { S.status = 'stopped'; S.stopReason = 'stopped by user'; S.turns.forEach(t => t.streaming = false); }
      }
      if (ctrl === myCtrl) ctrl = null;
      notify('status'); notify('board');
      return result();
    }
    const result = () => ({ question: S.question, mode: S.mode, status: S.status, stopReason: S.stopReason, seats: S.seats.map((s, i) => seatName(i, s) + ' (' + s.provider + '/' + s.model + ')'), turns: S.turns.filter(t => t.stage !== 'synth').length, ranking: S.ranking, pairwise: S.pairwise ? S.pairwise.text : null, warnings: S.chips.filter(c => c.kind !== 'ok').map(c => c.text), summary: S.summary || '' });
    const stop = () => { if (ctrl) ctrl.abort(); };
    function toMarkdown() {
      const L = ['# Council — ' + S.question, '', '_' + CN_MODES[S.mode].label + ' · ' + new Date(S.ts).toISOString() + ' · ' + S.status + (S.stopReason ? ' (' + S.stopReason + ')' : '') + '_', '', '## Seats'];
      S.seats.forEach((s, i) => L.push('- ' + seatName(i, s) + ' — `' + s.provider + '/' + s.model + '`'));
      if (S.chips.length) { L.push('', '## Flags'); S.chips.forEach(c => L.push('- [' + c.kind + '] ' + c.text)); }
      L.push('', '## Transcript');
      S.turns.filter(t => t.stage !== 'synth').forEach(t => L.push('', '### ' + (t.stage === 'rank' ? 'Ranking by ' : '') + (t.label ? t.label + ' (' + t.who + ')' : t.who) + (t.round ? ' · round ' + t.round : ''), '', t.text));
      if (S.ranking) { L.push('', '## Peer ranking (Borda)'); S.ranking.forEach((r, k) => L.push((k + 1) + '. Response ' + r.letter + ' — ' + r.points + ' pts (' + r.who + ')')); }
      if (S.pairwise) L.push('', '## Pairwise judge (order-swapped)', '', S.pairwise.x + ' vs ' + S.pairwise.y + ': order A/B → ' + S.pairwise.v1 + ', order B/A → ' + S.pairwise.v2 + ' ⇒ **' + S.pairwise.text + '**');
      L.push('', '## Chair summary', '', S.summary || '(none)'); return L.join('\n');
    }
    async function exportMd() { const path = '/notes/council-' + new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19) + '.md'; await DS.fs.write(path, toMarkdown()); return path; }
    function sendToChat() { if (!S.summary) return false; const md = '### 🏛️ Council (' + CN_MODES[S.mode].label + '): ' + S.question + '\n\n' + S.summary + (S.pairwise ? '\n\n_Pairwise judge: ' + S.pairwise.text + '_' : ''); if (DS.threadView && DS.threadView.replyLocal) DS.threadView.replyLocal(md); DS.shell.show('thread'); return true; }
    const open = () => DS.shell.show('council');

    /* ---------- styles ---------- */
    ctx.effect(() => { const s = document.createElement('style'); s.textContent = `
.cn-wrap [hidden]{display:none!important}.cn-wrap{padding:12px 16px 40px;display:flex;flex-direction:column;gap:12px}.cn-setup{padding:12px;display:flex;flex-direction:column;gap:10px}
.cn-setup textarea{width:100%;min-height:58px;resize:vertical;box-sizing:border-box}.cn-modes{display:flex;flex-wrap:wrap}.cn-modes button{flex:1;min-height:36px}
.cn-seat{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr) 40px;gap:6px;align-items:center;padding:8px;border:1px solid var(--line);border-radius:var(--radius);background:var(--card-2)}
.cn-seat .sel{min-width:0;width:100%;min-height:40px}.cn-seat .cn-model{grid-column:1 / 3}.cn-seat .cn-x{grid-row:1 / 3;grid-column:3;height:40px}@media (max-width:520px){.cn-seat{grid-template-columns:minmax(0,1fr) 40px}.cn-seat>.sel{grid-column:1}.cn-seat .cn-model{grid-column:1}.cn-seat .cn-x{grid-row:1 / 4;grid-column:2}}
.cn-ctl{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.cn-ctl .inp{width:56px;min-height:36px}.cn-chips{display:flex;flex-wrap:wrap;gap:6px}.cn-chips:empty{display:none}
.cn-turn{border:1px solid var(--line);border-left:3px solid var(--cn-c,var(--accent));border-radius:var(--radius);background:var(--card);padding:10px 12px;animation:cnIn .25s ease}
.cn-turn[data-role=skeptic]{--cn-c:var(--danger)}.cn-turn[data-role=expert]{--cn-c:var(--violet)}.cn-turn[data-role=comedian]{--cn-c:var(--warn)}.cn-turn[data-role=judge]{--cn-c:var(--ok)}
.cn-th{display:flex;gap:8px;align-items:center;margin-bottom:6px;flex-wrap:wrap}.cn-av{width:28px;height:28px;border-radius:50%;display:grid;place-items:center;background:var(--accent-soft);font-size:15px}
.cn-tb{font-size:14px;line-height:1.5;word-break:break-word}.cn-tb.cn-live{white-space:pre-wrap}.cn-tb.cn-live::after{content:'▍';color:var(--cn-c,var(--accent));animation:cnB 1s steps(2) infinite}
.cn-rd{font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);margin:4px 0 -4px}.cn-board,.cn-sum{padding:12px}.cn-board:empty,.cn-sum:empty{display:none}
.cn-bar{display:flex;align-items:center;gap:8px;margin:4px 0}.cn-bar i{flex:1;height:6px;border-radius:3px;background:var(--line);overflow:hidden}.cn-bar i b{display:block;height:100%;background:var(--accent)}
.cn-sum{border:1px solid var(--accent-line);background:var(--accent-soft)}.cn-acts{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}
@keyframes cnIn{from{opacity:0;transform:translateY(6px)}to{opacity:1}}@keyframes cnB{50%{opacity:0}}`; document.head.appendChild(s); return () => s.remove(); });

    /* ---------- view ---------- */
    ctx.view({ id: 'council', title: 'Council', icon: 'council', order: 88, badge: () => S.status === 'running' ? '●' : '',
      mount(el) {
        el.innerHTML = '<div class="vhead"><h2>Council</h2><span class="grow"></span><span class="chip cn-st"></span></div><div class="vscroll"><div class="cn-wrap">' +
          '<div class="card cn-setup"><div class="seg cn-modes">' + Object.entries(CN_MODES).map(([k, m]) => '<button data-m="' + k + '">' + m.label + '</button>').join('') + '</div>' +
          '<textarea class="inp cn-q" placeholder="Ask the council… e.g. Should we rewrite the backend in Rust?"></textarea><div class="col cn-seats" style="gap:8px"></div>' +
          '<div class="cn-ctl"><button class="btn sm cn-add">+ Seat</button><label class="sm muted">Rounds <input type="number" class="inp cn-r" min="1" max="6"></label><span class="grow"></span><button class="btn danger cn-stop" hidden>Stop</button><button class="btn pri cn-go">Convene</button></div></div>' +
          '<div class="cn-chips"></div><div class="col cn-turns" style="gap:10px"></div><div class="card cn-board"></div><div class="card cn-sum"></div></div></div>';
        const $ = s => el.querySelector(s);
        const opt = (v, l, sel) => '<option value="' + esc(v) + '"' + (v === sel ? ' selected' : '') + '>' + esc(l) + '</option>';
        const drawSetup = () => {
          el.querySelectorAll('.cn-modes button').forEach(b => b.classList.toggle('on', b.dataset.m === cfg.mode)); $('.cn-r').value = cfg.rounds; $('.cn-r').disabled = cfg.mode === 'council';
          const ps = providers(); const pl = ps.map(p => ({ id: p.id, label: p.id === 'sim' ? 'Sim (offline)' : (p.label || p.id) }));
          $('.cn-seats').innerHTML = cfg.seats.map((s, i) => { const ms = modelsFor(s.provider); if (!ms.includes(s.model)) ms.unshift(s.model);
            return '<div class="cn-seat" data-i="' + i + '"><select class="sel cn-role" aria-label="Role">' + Object.entries(CN_ROLES).map(([k, r]) => opt(k, r.emoji + ' ' + r.label, s.role)).join('') + '</select>' +
              '<select class="sel cn-prov" aria-label="Provider">' + (pl.some(p => p.id === s.provider) ? '' : opt(s.provider, s.provider + ' (missing)', s.provider)) + pl.map(p => opt(p.id, p.label, s.provider)).join('') + '</select>' +
              '<button class="icon-btn cn-x" title="Remove seat"' + (cfg.seats.length <= 2 ? ' disabled' : '') + '>' + DS.icon('x') + '</button><select class="sel cn-model" aria-label="Model">' + ms.map(m => opt(m, m, s.model)).join('') + '</select></div>'; }).join('');
          $('.cn-add').disabled = cfg.seats.length >= 5;
        };
        const drawStatus = () => { const st = $('.cn-st'); st.className = 'chip cn-st ' + ({ running: 'acc', done: 'ok', stopped: 'warn', error: 'err' }[S.status] || ''); st.textContent = S.status === 'running' ? (S.mode === 'council' ? 'deliberating…' : 'round ' + (S.round || 1) + '/' + S.rounds) : S.status; $('.cn-stop').hidden = S.status !== 'running'; $('.cn-go').disabled = S.status === 'running'; };
        const drawChips = () => { $('.cn-chips').innerHTML = S.chips.map(c => '<span class="chip ' + c.kind + '">' + esc(c.text) + '</span>').join(''); };
        const turnHtml = t => '<div class="cn-turn" data-tid="' + t.id + '" data-role="' + t.role + '"><div class="cn-th"><span class="cn-av">' + CN_ROLES[t.role].emoji + '</span><b class="sm">' + esc(t.stage === 'rank' ? 'Ranking · ' + t.who : t.label ? t.label : t.who) + '</b><span class="grow"></span><span class="xs muted mono">' + esc((t.sim || t.provider === 'sim' ? 'council-sim' : t.provider + '/' + t.model)) + '</span></div><div class="cn-tb"></div></div>';
        const fill = (t, node) => { const b = node.querySelector('.cn-tb'); if (t.streaming) { b.classList.add('cn-live'); b.textContent = t.text; } else { b.classList.remove('cn-live'); b.innerHTML = ''; try { DS.render.into(b, t.text); } catch (_) { b.textContent = t.text; } } };
        const drawTurns = () => { const box = $('.cn-turns'); let html = '', last = null; S.turns.filter(t => t.stage !== 'synth').forEach(t => { const g = t.stage === 'answer' ? 'Stage 1 · independent answers' : t.stage === 'rank' ? 'Stage 2 · anonymous peer ranking' : 'Round ' + t.round; if (g !== last) { html += '<div class="cn-rd">' + g + '</div>'; last = g; } html += turnHtml(t); }); box.innerHTML = html; S.turns.forEach(t => { const n = box.querySelector('[data-tid="' + t.id + '"]'); if (n) fill(t, n); }); };
        const drawBoard = () => { const b = $('.cn-board'); let h = ''; if (S.ranking) { const mx = Math.max(1, ...S.ranking.map(r => r.points)); h += '<div class="sec-t">Peer ranking (anonymous, Borda)</div>' + S.ranking.map((r, k) => '<div class="cn-bar"><span class="sm mono">' + (k + 1) + '. ' + r.letter + '</span><i><b style="width:' + Math.round(r.points / mx * 100) + '%"></b></i><span class="xs muted">' + r.points + ' · ' + esc(r.who) + '</span></div>').join(''); }
          if (S.pairwise) h += '<div class="sec-t" style="margin-top:8px">Judge pairwise (order-swapped)</div><div class="sm">' + esc(S.pairwise.x) + ' vs ' + esc(S.pairwise.y) + ' — A/B: <b>' + esc(S.pairwise.v1) + '</b>, B/A: <b>' + esc(S.pairwise.v2) + '</b> ⇒ <span class="chip ' + (S.pairwise.result === 'bias' ? 'warn' : 'ok') + ' cn-pw">' + esc(S.pairwise.text) + '</span></div>';
          if (S.stopReason && S.status !== 'running') h += '<div class="xs muted cn-why" style="margin-top:8px">Stopped: ' + esc(S.stopReason) + '</div>'; b.innerHTML = h; };
        const drawSum = () => { const sm = S.turns.find(t => t.stage === 'synth'), box = $('.cn-sum'); if (!sm) { box.innerHTML = ''; return; } box.innerHTML = '<div class="cn-turn" data-tid="' + sm.id + '" data-role="judge" style="border:0;background:none;padding:0"><div class="cn-th"><span class="cn-av">🏛️</span><b class="sm">Chair · ' + esc(sm.who) + '</b></div><div class="cn-tb"></div></div><div class="cn-acts"' + (sm.streaming ? ' hidden' : '') + '><button class="btn sm cn-exp">' + DS.icon('download') + ' Export .md</button><button class="btn sm pri cn-chat">' + DS.icon('share') + ' Send summary to chat</button><button class="btn sm cn-copy">' + DS.icon('copy') + ' Copy</button></div>'; fill(sm, box.querySelector('.cn-turn')); };
        const drawAll = () => { drawSetup(); drawStatus(); drawChips(); drawTurns(); drawBoard(); drawSum(); };
        let raf = 0; const pend = new Set();
        const on = (k, t) => {
          if (k === 'delta') { pend.add(t); if (!raf) raf = requestAnimationFrame(() => { raf = 0; pend.forEach(x => { const n = el.querySelector('[data-tid="' + x.id + '"]'); if (n) fill(x, n); }); pend.clear(); const sc = el.querySelector('.vscroll'); if (sc && sc.scrollHeight - sc.scrollTop - sc.clientHeight < 220) sc.scrollTop = sc.scrollHeight; }); return; }
          if (k === 'turn') { if (t.stage === 'synth') drawSum(); else drawTurns(); return; }
          if (k === 'done') { const n = el.querySelector('[data-tid="' + t.id + '"]'); if (n) fill(t, n); if (t.stage === 'synth') drawSum(); return; }
          if (k === 'chips') return drawChips(); if (k === 'board') return drawBoard(); if (k === 'status') return drawStatus(); drawAll();
        };
        subs.add(on);
        el.querySelector('.cn-modes').onclick = e => { const b = e.target.closest('[data-m]'); if (b) { cfg.mode = b.dataset.m; if (cfg.mode === 'comedy' && !cfg.seats.some(s => s.role === 'comedian')) cfg.seats[0].role = 'comedian'; saveCfg(); drawSetup(); } };
        $('.cn-r').onchange = () => { cfg.rounds = Math.max(1, Math.min(6, +$('.cn-r').value || 3)); saveCfg(); };
        $('.cn-add').onclick = () => { if (cfg.seats.length < 5) { const used = cfg.seats.map(s => s.role); const r = ['expert', 'comedian', 'skeptic', 'proposer', 'judge'].find(x => !used.includes(x)) || 'expert'; cfg.seats.splice(cfg.seats.findIndex(s => s.role === 'judge') >= 0 ? cfg.seats.length - 1 : cfg.seats.length, 0, defaultSeat(r)); saveCfg(); drawSetup(); } };
        $('.cn-seats').onchange = e => { const row = e.target.closest('[data-i]'); if (!row) return; const s = cfg.seats[+row.dataset.i];
          if (e.target.classList.contains('cn-role')) s.role = e.target.value; if (e.target.classList.contains('cn-model')) s.model = e.target.value;
          if (e.target.classList.contains('cn-prov')) { s.provider = e.target.value; s.model = modelsFor(s.provider)[0]; } saveCfg(); drawSetup(); };
        $('.cn-seats').onclick = e => { const x = e.target.closest('.cn-x'); if (x && cfg.seats.length > 2) { cfg.seats.splice(+x.closest('[data-i]').dataset.i, 1); saveCfg(); drawSetup(); } };
        $('.cn-go').onclick = () => { const q = $('.cn-q').value.trim(); if (!q) { ctx.toast('Ask the council a question first', 'warn'); $('.cn-q').focus(); return; } convene({ question: q }); };
        $('.cn-stop').onclick = stop;
        $('.cn-sum').onclick = async e => {
          if (e.target.closest('.cn-exp')) { try { const p = await exportMd(); ctx.toast('Saved ' + p, 'ok'); } catch (er) { ctx.toast('Export failed: ' + er.message, 'err'); } }
          if (e.target.closest('.cn-chat')) sendToChat();
          if (e.target.closest('.cn-copy')) { DS.util.copy(S.summary || ''); ctx.toast('Copied', 'ok'); }
        };
        if (S.question) $('.cn-q').value = S.question;
        drawAll();
        return () => { subs.delete(on); if (raf) cancelAnimationFrame(raf); };
      },
      onShow(el) { const q = el.querySelector('.cn-q'); if (q && S.question && !q.value) q.value = S.question; }
    });
    if (typeof ctx.rail === 'function') ctx.rail({ id: 'council', icon: 'council', label: 'Council', group: 'top', order: 60, run: open, badge: () => S.status === 'running' ? '●' : '', active: () => DS.shell.current === 'council' });

    /* ---------- command / tool / sim ---------- */
    ctx.command({ name: 'council', args: '<question>', desc: 'Convene the model council (debate → chair synthesis)', run(t) {
      const m = /^\s*(debate|council|brainstorm|comedy)\b[:\s]*/i.exec(t || ''); const q = (m ? t.slice(m[0].length) : t || '').trim();
      open(); if (!q) return; setTimeout(() => { const ta = document.querySelector('.cn-q'); if (ta) ta.value = q; }, 0); convene({ question: q, mode: m ? m[1].toLowerCase() : undefined }); } });
    ctx.tool({ name: 'council_convene', gate: 'none', label: 'Council',
      description: 'Convene a council of several AI models (Proposer, Skeptic, Expert, Judge…) on a question. They debate (or answer independently and anonymously rank each other), then a chair writes a synthesis. Returns the chair summary.',
      parameters: { type: 'object', properties: { question: { type: 'string', description: 'The question to deliberate' }, mode: { type: 'string', enum: ['debate', 'council', 'brainstorm', 'comedy'], description: 'Default debate' } }, required: ['question'] },
      detail: a => ({ preview: null, cmd: (a.mode || 'debate') + ': ' + (a.question || '') }),
      async run(a, tctx) { const r = await convene({ question: a.question, mode: a.mode, signal: tctx && tctx.signal }); if (r.status === 'error') throw new Error(r.stopReason); return r; },
      summarize: (a, r) => r && r.status ? r.turns + ' turns · ' + (r.stopReason || r.status) : 'council',
      inline(part, el) { if (el._cn) return; el._cn = 1; const b = DS.util.el('button', { class: 'btn sm' }, DS.icon('council') + ' Open Council transcript'); b.onclick = open; el.appendChild(b); } });
    ctx.intent({ id: 'council', order: 50, match: t => /^\s*(convene|ask)\s+(the\s+)?(council|models)\b|^\s*(let|have)\s+(the\s+)?(models|ais?|council)\s+(debate|discuss|argue|talk|brainstorm)|^\s*(debate|brainstorm|comedy riff)\b.{6,}|\bcouncil\b.*\?/i.test(t),
      script: t => { const mode = /brainstorm/i.test(t) ? 'brainstorm' : /comedy|joke|funny/i.test(t) ? 'comedy' : /rank|council mode|anonym/i.test(t) ? 'council' : 'debate';
        const q = t.replace(/^\s*(convene|ask)\s+(the\s+)?(council|models)\s*(on|about|:|to)?\s*|^\s*(let|have)\s+(the\s+)?(models|ais?|council)\s+(debate|discuss|argue|talk|brainstorm)\s*(about|on|:)?\s*|^\s*(debate|brainstorm|comedy riff)\s*(about|on|:)?\s*/i, '').trim() || t;
        return [{ say: 'Convening the council (' + mode + ') — watch it live in the **Council** view.', tool: { name: 'council_convene', args: { question: q, mode } } },
          { final: r => { const x = r[0] || {}; return x.summary ? x.summary + '\n\n— ' + x.turns + ' turns · ' + (x.stopReason || x.status) + (x.pairwise ? ' · judge: ' + x.pairwise : '') + (x.warnings && x.warnings.length ? '\n\n⚠️ ' + x.warnings.join(' · ') : '') : 'The council could not reach a summary.'; } }]; } });
    ctx.suggest({ id: 'council', emoji: '🏛️', title: 'Convene the council', sub: 'Models debate, a judge synthesizes', prompt: 'Convene the council on: should we rewrite our backend in Rust?' });
    ctx.provide('forge.council', { open, convene, stop, state: () => S, result, similarity: cnSimilarity, trigrams: s => [...cnTrigrams(s)], resolvePairwise: cnResolvePair, simGenerate: cnSimGenerate, toMarkdown, exportMd, sendToChat, roles: () => Object.keys(CN_ROLES), modes: () => Object.keys(CN_MODES), config: () => JSON.parse(JSON.stringify(cfg)) });
    return () => stop();
  }
});
