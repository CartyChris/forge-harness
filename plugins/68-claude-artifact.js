DS.plugin({
  name: 'forge.claude-artifact', title: 'Claude (built into this artifact)', version: '2.0.0',
  description: 'When Forge runs as a published Claude artifact, the agent, planner/trainer and critic/judge run on the viewer\'s own Claude account through the artifact "sample" capability — no API key. The first call asks permission and uses the viewer\'s Claude usage. Also routes downloads through the artifact "downloads" capability.',
  apply(ctx) {
    const PID = 'claude_artifact';
    const LABEL = 'Claude (built into this artifact)';
    const NOTE = 'No API key needed: the agent, trainer and judge run on your own Claude account, through a "Claude (built into this artifact)" provider. The first call asks your permission and uses your Claude usage.';
    /* model ids: claude-auto (Claude picks its own tier/effort per step), claude-inherit (your chat model), claude-<tier>[-<effort>] */
    const MODELS = ['claude-auto', 'claude-inherit', 'claude-complex-high', 'claude-complex', 'claude-default', 'claude-default-low', 'claude-quick'];
    const MODEL_LABEL = { 'claude-auto': 'Auto — Claude picks tier & effort per step', 'claude-inherit': 'Your chat model (inherit)', 'claude-complex-high': 'Most capable · high effort', 'claude-complex': 'Most capable', 'claude-default': 'Balanced', 'claude-default-low': 'Balanced · low effort', 'claude-quick': 'Fastest' };
    const st = { sample: null, ready: false, denied: false, disabled: '', tier: 'default', downloads: null, lastErr: '', limits: null, last: null, calls: 0, byTier: { quick: 0, default: 0, complex: 0, inherit: 0 } };
    const inArtifact = () => typeof window !== 'undefined' && !!window.claude && typeof window.claude.use === 'function';

    /* resolve the capability once (memoized by the platform; null = not served here) */
    let probe = null;
    function resolve() {
      if (!inArtifact()) return Promise.resolve(null);
      if (!probe) probe = Promise.resolve().then(() => window.claude.use('sample')).then(async s => { st.sample = s || null; st.ready = !!s; if (s && s.limits) { try { st.limits = await s.limits(); } catch (_) {} } refreshUI(); return st.sample; }).catch(() => { st.ready = false; return null; });
      return probe;
    }

    const canInherit = () => !!(st.limits && Array.isArray(st.limits.modelTiers) && st.limits.modelTiers.includes('inherit'));
    /* explicit ids → {tier, effort}; anything else (OpenRouter-style ids, role models) maps by family */
    function parseModel(model) {
      const m = String(model || '').toLowerCase();
      const x = /^claude-(quick|default|complex|inherit)(?:-(low|medium|high))?$/.exec(m);
      if (x) return { tier: x[1] === 'inherit' && !canInherit() ? 'complex' : x[1], effort: x[2] || '' };
      if (m === 'claude-auto' || m === 'auto' || m === 'openrouter/auto' || !m) return { auto: true };
      if (/opus|complex|reason|planner/.test(m)) return { tier: 'complex', effort: '' };
      if (/haiku|quick|fast|mini|flash|nano/.test(m)) return { tier: 'quick', effort: '' };
      return { auto: true };
    }
    const tierFor = model => { const p = parseModel(model); return p.auto ? 'default' : p.tier; };
    /* Auto: Claude orchestrates its own effort. Cheap heuristics, decided per model call and shown in the Observatory:
       - first step of a hard task (build/debug/design/research…, long prompts, plan phase, orchestrator) → complex · high
       - trivial chat → quick
       - follow-up steps that are just processing tool results → default (low/medium)
       - two recent tool failures → escalate to complex (cascade, FrugalGPT-style) */
    const HARD = /\b(build|create|make|implement|write (a|an|the) (app|game|program|script|function)|refactor|debug|fix|design|architect|game|app|analy[sz]e|research|investigate|plan|optimi[sz]e|migrate|prove|algorithm|compare|review|audit|orchestrat)/i;
    function autoChoice(messages, thread, phase) {
      let lastUser = -1; for (let i = messages.length - 1; i >= 0; i--) if (messages[i].role === 'user' && !/^\[(TOOL_RESULT|FORGE)/.test(String(messages[i].content || ''))) { lastUser = i; break; }
      const u = lastUser >= 0 ? String(messages[lastUser].content || '') : '';
      const after = lastUser >= 0 ? messages.slice(lastUser + 1) : [];
      const step = after.filter(m => m.role === 'assistant').length;
      const recentTools = after.filter(m => m.role === 'tool').slice(-4);
      const fails = recentTools.filter(m => /"error"|how_to_fix|denied|failed/i.test(String(m.content || '').slice(0, 400))).length;
      const hard = HARD.test(u) || u.length > 600 || /```/.test(u) || phase === 'plan' || !!(thread && thread.agentRole === 'orchestrator');
      const trivial = !hard && u.length < 80 && !/[?].*[?]/.test(u);
      if (fails >= 2) return { tier: 'complex', effort: 'medium', why: 'escalated after ' + fails + ' tool failures' };
      if (phase === 'plan') return { tier: 'complex', effort: 'high', why: 'planning' };
      if (step === 0) return hard ? { tier: 'complex', effort: 'high', why: 'first step of a hard task' } : trivial ? { tier: 'quick', effort: '', why: 'short, simple message' } : { tier: 'default', effort: 'medium', why: 'everyday task' };
      return hard ? { tier: 'default', effort: 'medium', why: 'continuing a hard task (step ' + (step + 1) + ')' } : { tier: 'default', effort: 'low', why: 'processing tool results' };
    }
    const COPY = {
      not_granted: 'You declined Claude for this artifact (or your organization did). Pick another provider in Models, or reload to be asked again.',
      sampling_disabled: 'Claude isn\'t available for this account/organization here.',
      rate_limited: 'Claude usage limit or too many calls right now — wait a moment and try again.',
      session_expired: 'Your Claude session expired — sign in again, then retry.',
      prompt_too_large: 'The conversation is too long for one Claude call — start a new thread or trim the context.',
      refused: 'Claude declined this request — rephrase it.',
      empty_completion: 'Claude returned no text — try again with a simpler request.',
      upstream_error: 'Claude had a temporary problem — try again.'
    };
    function toErr(e) {
      const code = (e && e.code) || 'upstream_error';
      if (code === 'cancelled') return Object.assign(new Error('aborted'), { name: 'AbortError' });
      if (code === 'not_granted') st.denied = true;
      if (code === 'sampling_disabled' || code === 'not_declared' || code === 'capability_disabled' || code === 'capability_removed') st.disabled = code;
      const err = new Error(LABEL + ': ' + (COPY[code] || (e && e.message) || code));
      err.code = code; err.status = code === 'rate_limited' ? 429 : code === 'not_granted' ? 403 : code === 'upstream_error' ? 503 : 400;
      st.lastErr = err.message; refreshUI(); return err;
    }

    /* Forge messages → sample turns: no system role, so instructions become a leading user turn; tool calls use the prompt protocol */
    function toTurns(messages, tools) {
      const core = DS.service('forge.providers.core');
      const flat = core && core.flattenForPrompt ? core.flattenForPrompt(messages) : messages;
      const sys = flat.filter(m => m.role === 'system').map(m => String(m.content || '')).join('\n\n');
      const proto = tools && tools.length && core && core.toolPrompt ? core.toolPrompt(tools) : '';
      const head = ['[INSTRUCTIONS — standing rules from the Forge harness; follow them for every turn]', sys, proto].filter(Boolean).join('\n\n');
      const turns = [{ role: 'user', content: head || 'You are a helpful assistant.' }];
      for (const m of flat) {
        if (m.role === 'system') continue;
        const role = m.role === 'assistant' ? 'assistant' : 'user';
        let c = typeof m.content === 'string' ? m.content : Array.isArray(m.content) ? m.content.map(p => p && (p.text || '')).join('\n') : String(m.content || '');
        if (!c.trim()) c = role === 'assistant' ? '(no text)' : '(empty)';
        turns.push({ role, content: c });
      }
      if (turns[turns.length - 1].role !== 'user') turns.push({ role: 'user', content: 'Continue.' });
      /* stay under the 256 KiB cap: drop the oldest middle turns, never the instructions or the last user turn */
      const enc = typeof TextEncoder !== 'undefined' ? new TextEncoder() : null;
      const bytes = t => enc ? enc.encode(t.content).length : t.content.length * 2;
      const CAP = Math.floor(((st.limits && st.limits.maxPromptBytes) || 262144) * 0.92);
      const sizes = turns.map(bytes); let total = sizes.reduce((a, b) => a + b, 0);
      /* drop the oldest middle turns first (keeping user/assistant alternation), never the instructions or the last turn */
      while (total > CAP && turns.length > 3) { total -= sizes[1]; turns.splice(1, 1); sizes.splice(1, 1); if (turns.length > 3 && turns[1].role === 'assistant') { total -= sizes[1]; turns.splice(1, 1); sizes.splice(1, 1); } }
      if (total > CAP) { const over = total - CAP; turns[0].content = turns[0].content.slice(0, Math.max(4000, turns[0].content.length - over - 64)) + '\n…(instructions trimmed to fit)'; }
      if (turns.length > 1 && turns[1].role === 'assistant') turns.splice(1, 0, { role: 'user', content: '(earlier conversation trimmed)' });
      return turns;
    }

    ctx.provider({
      id: PID, label: LABEL, order: 5, route: 'artifact', keyless: true, free: true,
      models: MODELS, modelLabels: MODEL_LABEL,
      note: NOTE,
      available: () => st.ready && !st.denied && !st.disabled,
      async stream({ messages, tools, signal, onDelta, model, forceModel, thread, phase }) {
        const sample = await resolve();
        if (!sample) throw Object.assign(new Error(LABEL + ': not available here — this only works inside a published Claude artifact.'), { status: 404 });
        if (st.denied) throw toErr({ code: 'not_granted' });
        const turns = toTurns(messages || [], tools || []);
        const want = forceModel || model || '';
        const pm = parseModel(want);
        const ch = pm.auto ? autoChoice(messages || [], thread, phase) : { tier: pm.tier, effort: pm.effort, why: 'fixed: ' + want };
        const tier = ch.tier;
        const opts = { cache: false, modelTier: tier, signal };
        if (ch.effort && tier !== 'quick') opts.effort = ch.effort;
        st.last = { t: Date.now(), tier, effort: ch.effort || '', why: ch.why, model: want || 'claude-auto' }; st.calls++; st.byTier[tier] = (st.byTier[tier] || 0) + 1;
        try { DS.bus.emit('claude:route', Object.assign({ threadId: thread && thread.id }, st.last)); } catch (_) {}
        const M = DS.service('forge.models');
        try { M && M.setIdentity && M.setIdentity({ provider: PID, providerName: LABEL, model: 'claude-' + tier + (ch.effort ? '-' + ch.effort : ''), requestedModel: want || 'claude-auto', resolvedModel: 'claude ' + tier + ' tier' + (ch.effort ? ' · ' + ch.effort + ' effort' : '') + (pm.auto ? ' (auto: ' + ch.why + ')' : ''), route: 'artifact', free: true, keyless: true }); } catch (_) {}
        let shown = '';
        let res;
        try {
          /* stream only prose: hold back from the first tool-call marker on (the call itself is parsed at the end) */
          const MARK = /```\s*(tool_call|json)|<tool_call|<function=/;
          res = await sample(turns, Object.assign(opts, { onText: ({ text }) => {
            const mi = tools && tools.length ? text.search(MARK) : -1;
            const safe = mi >= 0 ? text.slice(0, mi) : (tools && tools.length ? text.slice(0, Math.max(0, text.length - 12)) : text);
            if (safe.length > shown.length) { const d = safe.slice(shown.length); shown = safe; onDelta && onDelta({ content: d }); }
          } }));
        } catch (e) { throw toErr(e); }
        const text = (res && res.text) || shown;
        let toolCalls = [], content = text;
        if (tools && tools.length) {
          const core = DS.service('forge.providers.core');
          const p = core && core.parsePromptTools ? core.parsePromptTools(text, tools) : { calls: [], clean: text };
          toolCalls = (p.calls || []).map(c => ({ id: c.id || DS.util.uid('call'), name: c.name, args: c.args || {}, raw: c.raw || JSON.stringify(c.args || {}) }));
          if (toolCalls.length) content = p.clean != null ? p.clean : text;
        }
        /* flush whatever prose was held back (never the tool-call block) */
        const tail = String(content || '');
        if (onDelta && tail.length > shown.length && tail.startsWith(shown)) onDelta({ content: tail.slice(shown.length) });
        if (res && res.truncated) ctx.toast('Claude\'s answer hit the length limit — ask for less at a time.', 'warn', 4000);
        const applied = (res && res.modelTierApplied) || tier;
        if (applied !== tier && tier !== 'inherit') ctx.toast('Your plan served the ' + applied + ' tier instead of ' + tier + '.', 'info', 3500);
        return { content, reasoning: '', toolCalls, usage: null, model: (res && res.modelApplied) || ('claude-' + applied + (ch.effort ? '-' + ch.effort : '')) };
      }
    });

    /* ---------- make it the default inside the artifact (once, unless the user already chose something with a key) ---------- */
    function defaultIfArtifact() {
      const s = DS.store.settings(); if (s._claudeArtifactDefaulted) return;
      s._claudeArtifactDefaulted = true;
      /* only replace the unconfigured default (OpenRouter with no key) or the Sim; a provider the user set up stays */
      if ((s.provider === 'openai' && !s.apiKey) || s.provider === 'sim' || s.forceSim || !s.provider) {
        s.provider = PID; s.forceSim = false;
        s.models = Object.assign({}, s.models, DEFAULT_MODELS);
        Promise.resolve(ctx.waitFor ? ctx.waitFor('forge.agents') : null).then(() => applyTeam('claude', true)).catch(() => {});
      }
      try { DS.store.save(); } catch (_) {}
      refreshUI();
    }

    const DEFAULT_MODELS = { planner: 'claude-complex-high', executor: 'claude-auto', critic: 'claude-quick' };
    /* ---------- self-orchestration: Claude leads, cheaper tiers (or free models) do the parts ---------- */
    const TEAMS = {
      claude: { label: 'Claude team', desc: 'Orchestrator = most capable (high effort); Coder & Researcher = balanced; Reviewer = most capable; Fast = quickest.',
        roles: { orchestrator: [PID, 'claude-complex-high'], coder: [PID, 'claude-default'], researcher: [PID, 'claude-default-low'], reviewer: [PID, 'claude-complex'], fast: [PID, 'claude-quick'] } },
      mixed: { label: 'Claude lead + free workers', desc: 'Claude plans, reviews and merges; Researcher & Fast run on the free fallback chain (no Claude usage), Coder stays on Claude.',
        roles: { orchestrator: [PID, 'claude-complex-high'], coder: [PID, 'claude-default'], researcher: ['auto', ''], reviewer: [PID, 'claude-complex'], fast: ['auto', ''] } },
      inherit: { label: 'Inherit everything', desc: 'Every role uses whatever the main thread uses.', roles: { orchestrator: ['', ''], coder: ['', ''], researcher: ['', ''], reviewer: ['', ''], fast: ['', ''] } }
    };
    function applyTeam(id, onlyEmpty) {
      const A = DS.service('forge.agents'); const T = TEAMS[id]; if (!A || !A.setRole || !T) return false;
      const cur = (A.roles && A.roles()) || {};
      for (const [rid, [prov, mod]] of Object.entries(T.roles)) { if (onlyEmpty && cur[rid] && cur[rid].provider) continue; try { A.setRole(rid, { provider: prov, model: mod }); } catch (_) {} }
      ctx.data.set('team', id); return true;
    }
    const selfOrch = () => ctx.data.get('selfOrch', true);
    /* when Claude is the main model, tell it it may delegate to cheaper copies of itself — it decides when */
    ctx.prompt({ id: 'claude-self-orch', build: t => {
      try {
        if (!selfOrch() || !st.ready || (t && (t.hidden || t.parentId))) return '';
        if (DS.providers.pick(t).id !== PID) return '';
        if (!DS.agent.tool('spawn_subagent')) return '';
        return '## DELEGATION (you decide)\nYou can run copies of yourself at lower cost: spawn_subagent {task, role} — coder / researcher run on a balanced tier, fast on the quickest tier, reviewer on the most capable tier. Do small or tightly-coupled work yourself. For a large task with independent parts (e.g. research + build + review), spawn them with wait:false, then agents_wait, then review and merge. Give each subagent a self-contained task with all context it needs.';
      } catch (_) { return ''; }
    } });

    /* ---------- downloads through the artifact capability (plain links do nothing inside the viewer) ---------- */
    const origDownload = DS.util.download;
    function patchDownloads(dl) {
      if (!dl || DS.util.download.__artifact) return;
      const wrapped = function (name, content, type) {
        const blob = content instanceof Blob ? content : new Blob([content], { type: type || 'text/plain' });
        Promise.resolve(dl.save({ filename: String(name || 'download'), data: blob })).catch(e => {
          if (e && (e.code === 'cancelled' || e.code === 'dismissed' || e.code === 'declined')) return;
          try { origDownload.call(DS.util, name, content, type); } catch (_) {}
        });
      };
      wrapped.__artifact = true; DS.util.download = wrapped;
    }
    ctx.effect(() => () => { if (DS.util.download && DS.util.download.__artifact) DS.util.download = origDownload; });

    /* ---------- UI: settings section + status ---------- */
    let el = null;
    function refreshUI() { if (el) render(el); try { DS.bus && DS.bus.emit && DS.bus.emit('models:changed'); } catch (_) {} }
    function render(node) {
      el = node; const esc = DS.util.esc; const s = DS.store.settings(); const on = s.provider === PID;
      const state = !inArtifact() ? 'Not inside a Claude artifact — this provider appears when Forge is opened as a published artifact on claude.ai.' : st.disabled ? 'Unavailable here (' + st.disabled + ').' : st.denied ? 'You declined Claude for this artifact in this view.' : st.ready ? (on ? 'Active — your default provider.' : 'Ready.') : 'Connecting to the artifact runtime…';
      node.innerHTML = '<p class="sm" style="overflow-wrap:anywhere">' + esc(NOTE) + '</p>' +
        '<div class="row" style="gap:8px;flex-wrap:wrap;margin:8px 0"><span class="chip ' + (st.ready && !st.denied ? 'ok' : 'warn') + '">' + esc(state) + '</span></div>' +
        (st.lastErr ? '<p class="xs muted" style="overflow-wrap:anywhere">' + esc(st.lastErr) + '</p>' : '') +
        '<div class="field"><label>Agent (executor) model</label><select class="sel" data-exec>' + MODELS.filter(m => m !== 'claude-inherit' || canInherit()).map(m => '<option value="' + m + '"' + (((s.models || {}).executor || '') === m ? ' selected' : '') + '>' + esc(MODEL_LABEL[m]) + '</option>').join('') + '</select><div class="hint">Trainer/planner: most capable · high effort. Judge/critic: fastest. “Auto” lets Claude pick its own tier and effort for every step (hard first steps → most capable, routine steps → balanced, small talk → fastest, repeated tool failures → escalate).</div></div>' +
        (st.last ? '<div class="xs muted" style="margin:-4px 0 10px;overflow-wrap:anywhere">Last call: <b>' + esc(st.last.tier) + (st.last.effort ? ' · ' + esc(st.last.effort) : '') + '</b> — ' + esc(st.last.why) + ' · calls so far: ' + esc(Object.entries(st.byTier).filter(e => e[1]).map(e => e[0] + ' ' + e[1]).join(', ') || '0') + '</div>' : '') +
        '<div class="field"><label>Subagent team (orchestration)</label><div class="col" style="gap:6px">' + Object.entries(TEAMS).map(([id, T]) => '<button class="btn sm" style="justify-content:flex-start;text-align:left;white-space:normal;height:auto;padding:8px 10px" data-team="' + id + '"><b>' + esc(T.label) + (ctx.data.get('team', '') === id ? ' ✓' : '') + '</b>&nbsp;— ' + esc(T.desc) + '</button>').join('') + '</div></div>' +
        '<label class="row sm" style="gap:8px;margin-bottom:10px"><input type="checkbox" data-selforch' + (selfOrch() ? ' checked' : '') + '> Let Claude decide when to delegate to cheaper copies of itself</label>' +
        '<div class="row" style="gap:8px;flex-wrap:wrap"><button class="btn sm ' + (on ? '' : 'pri') + '" data-use="1"' + (st.ready ? '' : ' disabled') + '>' + (on ? 'In use' : 'Use Claude (built in)') + '</button>' +
        '<button class="btn sm" data-perm="1"' + (inArtifact() ? '' : ' disabled') + '>Artifact permissions…</button></div>';
    }
    ctx.settings({ id: 'claude-artifact', title: LABEL, order: 4, render(node) {
      render(node);
      node.onchange = ev => { const s = DS.store.settings(); if (ev.target.matches('[data-exec]')) { s.models = Object.assign({}, s.models, { executor: ev.target.value }); DS.store.save(); render(node); } if (ev.target.matches('[data-selforch]')) ctx.data.set('selfOrch', !!ev.target.checked); };
      node.onclick = async ev => {
        const s = DS.store.settings();
        const tm = ev.target.closest('[data-team]'); if (tm) { if (applyTeam(tm.dataset.team, false)) ctx.toast(TEAMS[tm.dataset.team].label + ' applied to the subagent roles.', 'ok'); else ctx.toast('Agents plugin not loaded.', 'warn'); render(node); return; }
        if (ev.target.closest('[data-use]')) { s.provider = PID; s.forceSim = false; s.models = Object.assign({}, s.models, DEFAULT_MODELS); DS.store.save(); applyTeam('claude', true); ctx.toast('Using Claude (built into this artifact).', 'ok'); refreshUI(); return; }
        if (ev.target.closest('[data-perm]')) { try { const p = await window.claude.use('permissions'); if (p && p.manage) await p.manage(); } catch (_) { ctx.toast('Open the artifact\'s Permissions menu to change this.', 'info'); } }
      };
    } });

    /* the welcome screen says it once, inside the artifact */
    if (inArtifact()) ctx.suggest({ id: 'claude-artifact', emoji: '✦', title: 'No API key needed', sub: 'Runs on your Claude account — the first call asks permission', prompt: 'What can you do in this harness? Answer in 5 short bullets.' });

    /* boot: probe the runtime; only default when the capability is really served */
    if (inArtifact()) {
      resolve().then(s => { if (!s) return; defaultIfArtifact(); try { ctx.toast(NOTE, 'info', 7000); } catch (_) {} });
      Promise.resolve().then(() => window.claude.use('downloads')).then(dl => { if (dl) { st.downloads = dl; patchDownloads(dl); } }).catch(() => {});
    }
    DS.bus.on && ctx.effect(() => DS.bus.on('claude:route', () => { if (el && el.isConnected) render(el); }));
    ctx.provide('forge.claudeArtifact', { inArtifact, autoChoice, parseModel, applyTeam, TEAMS, MODELS, ready: () => st.ready, state: () => Object.assign({}, st, { sample: !!st.sample, downloads: !!st.downloads }), note: NOTE, tierFor, toTurns });
  }
});
