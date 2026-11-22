DS.plugin({
  name: 'forge.claude-artifact', title: 'Claude (built into this artifact)', version: '1.0.0',
  description: 'When Forge runs as a published Claude artifact, the agent, planner/trainer and critic/judge run on the viewer\'s own Claude account through the artifact "sample" capability — no API key. The first call asks permission and uses the viewer\'s Claude usage. Also routes downloads through the artifact "downloads" capability.',
  apply(ctx) {
    const PID = 'claude_artifact';
    const LABEL = 'Claude (built into this artifact)';
    const NOTE = 'No API key needed: the agent, trainer and judge run on your own Claude account, through a "Claude (built into this artifact)" provider. The first call asks your permission and uses your Claude usage.';
    const TIERS = { 'claude-default': 'default', 'claude-complex': 'complex', 'claude-quick': 'quick' };
    const st = { sample: null, ready: false, denied: false, disabled: '', tier: 'default', downloads: null, lastErr: '' };
    const inArtifact = () => typeof window !== 'undefined' && !!window.claude && typeof window.claude.use === 'function';

    /* resolve the capability once (memoized by the platform; null = not served here) */
    let probe = null;
    function resolve() {
      if (!inArtifact()) return Promise.resolve(null);
      if (!probe) probe = Promise.resolve().then(() => window.claude.use('sample')).then(s => { st.sample = s || null; st.ready = !!s; refreshUI(); return st.sample; }).catch(() => { st.ready = false; return null; });
      return probe;
    }

    const tierFor = model => {
      const m = String(model || '').toLowerCase();
      if (TIERS[m]) return TIERS[m];
      if (/opus|complex|reason|planner/.test(m)) return 'complex';
      if (/haiku|quick|fast|mini|flash/.test(m)) return 'quick';
      return st.tier || 'default';
    };
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
      const size = () => turns.reduce((n, t) => n + t.content.length * 1.2, 0);
      while (size() > 240000 && turns.length > 3) turns.splice(1, 1);
      if (size() > 240000) turns[0].content = turns[0].content.slice(0, 120000) + '\n…(instructions trimmed)';
      return turns;
    }

    ctx.provider({
      id: PID, label: LABEL, order: 5, route: 'artifact', keyless: true, free: true,
      models: Object.keys(TIERS),
      note: NOTE,
      available: () => st.ready && !st.denied && !st.disabled,
      async stream({ messages, tools, signal, onDelta, model, forceModel }) {
        const sample = await resolve();
        if (!sample) throw Object.assign(new Error(LABEL + ': not available here — this only works inside a published Claude artifact.'), { status: 404 });
        if (st.denied) throw toErr({ code: 'not_granted' });
        const turns = toTurns(messages || [], tools || []);
        const tier = tierFor(forceModel || model);
        const M = DS.service('forge.models');
        try { M && M.setIdentity && M.setIdentity({ provider: PID, providerName: LABEL, model: 'claude-' + tier, requestedModel: forceModel || model || 'claude-' + tier, resolvedModel: 'claude (' + tier + ' tier)', route: 'artifact', free: true, keyless: true }); } catch (_) {}
        let shown = '';
        let res;
        try {
          /* stream only prose: hold back from the first tool-call marker on (the call itself is parsed at the end) */
          const MARK = /```\s*(tool_call|json)|<tool_call|<function=/;
          res = await sample(turns, { cache: false, modelTier: tier, signal, onText: ({ text }) => {
            const mi = tools && tools.length ? text.search(MARK) : -1;
            const safe = mi >= 0 ? text.slice(0, mi) : (tools && tools.length ? text.slice(0, Math.max(0, text.length - 12)) : text);
            if (safe.length > shown.length) { const d = safe.slice(shown.length); shown = safe; onDelta && onDelta({ content: d }); }
          } });
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
        return { content, reasoning: '', toolCalls, usage: null, model: (res && (res.modelApplied || ('claude-' + (res.modelTierApplied || tier)))) || 'claude-' + tier };
      }
    });

    /* ---------- make it the default inside the artifact (once, unless the user already chose something with a key) ---------- */
    function defaultIfArtifact() {
      const s = DS.store.settings(); if (s._claudeArtifactDefaulted) return;
      s._claudeArtifactDefaulted = true;
      /* only replace the unconfigured default (OpenRouter with no key) or the Sim; a provider the user set up stays */
      if ((s.provider === 'openai' && !s.apiKey) || s.provider === 'sim' || s.forceSim || !s.provider) {
        s.provider = PID; s.forceSim = false;
        s.models = Object.assign({}, s.models, { planner: 'claude-complex', executor: 'claude-default', critic: 'claude-quick' });
      }
      try { DS.store.save(); } catch (_) {}
      refreshUI();
    }

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
        '<div class="field"><label>Model tier for the agent (executor)</label><div class="seg" role="group">' + ['quick', 'default', 'complex'].map(t => '<button data-tier="' + t + '" class="' + (((s.models || {}).executor || '') === 'claude-' + t ? 'on' : '') + '">' + t + '</button>').join('') + '</div><div class="hint">Trainer/planner uses “complex”, judge/critic uses “quick” by default.</div></div>' +
        '<div class="row" style="gap:8px;flex-wrap:wrap"><button class="btn sm ' + (on ? '' : 'pri') + '" data-use="1"' + (st.ready ? '' : ' disabled') + '>' + (on ? 'In use' : 'Use Claude (built in)') + '</button>' +
        '<button class="btn sm" data-perm="1"' + (inArtifact() ? '' : ' disabled') + '>Artifact permissions…</button></div>';
    }
    ctx.settings({ id: 'claude-artifact', title: LABEL, order: 4, render(node) {
      render(node);
      node.onclick = async ev => {
        const s = DS.store.settings();
        const t = ev.target.closest('[data-tier]'); if (t) { s.models = Object.assign({}, s.models, { executor: 'claude-' + t.dataset.tier }); DS.store.save(); render(node); return; }
        if (ev.target.closest('[data-use]')) { s.provider = PID; s.forceSim = false; s.models = Object.assign({}, s.models, { planner: 'claude-complex', executor: s.models && /^claude-/.test(s.models.executor || '') ? s.models.executor : 'claude-default', critic: 'claude-quick' }); DS.store.save(); ctx.toast('Using Claude (built into this artifact).', 'ok'); refreshUI(); return; }
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
    ctx.provide('forge.claudeArtifact', { inArtifact, ready: () => st.ready, state: () => Object.assign({}, st, { sample: !!st.sample, downloads: !!st.downloads }), note: NOTE, tierFor, toTurns });
  }
});
