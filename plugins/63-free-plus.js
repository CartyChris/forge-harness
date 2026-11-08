/* forge.freeplus — more free providers (LLM7, Z.ai GLM Flash, Vercel AI Gateway, Nous Portal, Hack Club AI) + the "Free AI" directory view.
   HONESTY: written in a sandbox with no internet. Sources: research/FREE_PROVIDERS_2026-10-26.md. Anything not marked [V] there is tagged
   `unverified`. Model ids come only from that file or from live GET /models (Discover). No CORS bypass is claimed: route `direct` means the
   browser tries the endpoint itself and falls back to the gateway chain on a network/CORS failure. */
const FX_LIST = [
  { id: 'llm7', name: 'LLM7.io', base: 'https://api.llm7.io/v1', signup: 'https://dash.llm7.io', keyOptional: true, freeTier: true, tools: 'prompt',
    models: ['gpt-oss:20b', 'deepseek-v4-pro', 'glm-5.2', 'mistral-Nemo-Instruct-2407', 'codestral-latest', 'gemma4:31b'], ph: 'free token (optional)',
    limits: 'Works without a key at a lower rate (reported ~30 RPM anon); free token raises it. Sources conflict — try keyless first.', note: 'Model ids from a third-party listing — Discover to confirm. CORS unverified.' },
  { id: 'zai', name: 'Z.ai GLM Flash', base: 'https://api.z.ai/api/paas/v4', signup: 'https://z.ai', freeTier: true, tools: 'native',
    models: ['glm-4.7-flash', 'glm-4.5-flash'], ph: 'Z.ai API key', limits: 'Free flash models, reported ~1 rps / ~1000 req/day. glm-4.5-flash retirement announced.', note: 'Free key: z.ai profile → API Keys. Unverified on the primary docs page.' },
  { id: 'vercel-ai', name: 'Vercel AI Gateway', base: 'https://ai-gateway.vercel.sh/v1', signup: 'https://vercel.com/docs/ai-gateway', freeTier: true, tools: 'native',
    models: [], ph: 'AI Gateway API key', limits: 'Monthly free credit per team (amount not stated), free-tier subset of models, lower rate limits. Buying credits ends the free credit.', note: 'Base URL from docs (not live-checked); Discover lists models.' },
  { id: 'nous', name: 'Nous Portal', base: 'https://inference-api.nousresearch.com/v1', signup: 'https://portal.nousresearch.com', freeTier: true, tools: 'prompt',
    models: [], ph: 'Nous API key', limits: '$0 plan: daily quota on free models only (may be limited; a $0 checkout is reported for the key).', note: 'Discover to see which Hermes models are free today.' },
  { id: 'hackclub', name: 'Hack Club AI (teens)', base: 'https://ai.hackclub.com/proxy/v1', signup: 'https://ai.hackclub.com/dashboard', freeTier: true, tools: 'prompt', verified: true,
    models: ['qwen/qwen3-32b'], ph: 'Hack Club key', limits: 'Free for teens (Hack Club eligibility). Key required.', note: 'Docs: docs.ai.hackclub.com.' }
];
const FX_EXTRA = [ /* directory-only rows: no provider can be honestly registered */
  { id: 'cloudflare', name: 'Cloudflare Workers AI', group: 'key', route: 'gateway', signup: 'https://dash.cloudflare.com/', limits: '10,000 neurons/day free (unverified). Needs your account id in the URL and a Worker/gateway — api.cloudflare.com is not callable from a browser page.', needs: 'needs Worker/gateway' }
];
const FX_ONDEVICE = ['chrome_ai', 'wllama', 'tjs_local', 'webllm_local'];
const FX_FREEKEY = ['openrouter']; /* keyed but has :free models */

DS.plugin({
  name: 'forge.freeplus', title: 'Free AI directory', version: '1.0.0', tags: ['providers', 'free', 'directory'],
  description: 'LLM7.io (keyless), Z.ai GLM Flash, Vercel AI Gateway, Nous Portal, Hack Club AI — plus a "Free AI" directory with Get-key, Use and one-tap Test for every provider.',
  apply(ctx) {
    const esc = DS.util.esc; let alive = true; let core = null;
    ctx.effect(() => () => { alive = false; });
    const wire = c => {
      if (!alive || !c) return; core = c;
      FX_LIST.forEach((p, i) => {
        if (c.has(p.id)) return;
        c.register(p.id, { name: p.name, base: p.base, endpoint: p.base + '/chat/completions', discover: p.base + '/models', models: p.models.slice(), keyless: false, keyOptional: !!p.keyOptional, freeTier: true,
          route: 'direct', tools: p.tools, sampling: true, signup: p.signup, ph: p.ph, verifyByDiscovery: true, tag: p.verified ? undefined : 'unverified', order: 55 + i, limits: p.limits,
          note: p.limits + ' ' + p.note + ' Route direct → automatic gateway fallback on network/CORS failure.' }, ctx);
      });
      ctx.emit('models:change', {});
    };
    Promise.resolve(ctx.waitFor('forge.providers.core')).then(wire).catch(e => ctx.log('warn', 'forge.providers.core unavailable: ' + (e && e.message)));

    /* ---------- directory model ---------- */
    const GROUPS = [['nokey', 'No key needed — works right here'], ['nokeyu', 'No key — worth a try (browser access not yet verified)'], ['nokeygw', 'No key, but needs your gateway or an https page'], ['key', 'Free key (1-minute signup)'], ['device', 'On-device (no key)'], ['local', 'Local server'], ['paid', 'Paid']];
    function entries() {
      const c = core || ctx.service('forge.providers.core'); const out = []; const seen = new Set();
      const kp = DS.kernel.list('provider') || [];
      if (c && c.ids) for (const pid of c.ids()) {
        const C = c.spec(pid); if (!C || C.custom) continue; seen.add(pid);
        const ms = C.models || []; const hasFree = ms.some(m => m.free);
        let g = C.local ? 'local' : (C.keyless || C.keyOptional) ? ((C.off || (C.route && C.route !== 'direct')) ? 'nokeygw' : (C.tag === 'unverified' || /CORS unverified/i.test(C.note || '')) ? 'nokeyu' : 'nokey') : (C.freeTier || hasFree || FX_FREEKEY.includes(pid)) ? 'key' : 'paid';
        out.push({ pid, name: C.name, group: g, route: C.route, signup: C.signup, limits: C.limits || C.note || C.warn || '', tag: C.tag, off: !!C.off, warn: C.warn, model: (ms.find(m => m.free) || ms[0] || {}).id || '', hasKey: c.hasKey(pid), keyless: !!C.keyless, keyOptional: !!C.keyOptional });
      }
      for (const p of kp) {
        if (seen.has(p.id) || p.id === 'auto') continue;
        const dev = FX_ONDEVICE.includes(p.id) || (p.route === 'local' && !/localhost/.test(p.label || ''));
        if (p.id === 'sim') out.push({ pid: 'sim', name: 'Offline Sim (scripted, no model)', group: 'nokey', route: 'sim', limits: 'Always works offline; scripted demo, not a language model.', model: 'sim' });
        else if (p.id === 'openai') out.push({ pid: 'openai', name: 'DeepSeek (core, Settings → Model key)', group: 'paid', route: 'direct', signup: 'https://platform.deepseek.com/api_keys', limits: 'Paid API key.', model: '' });
        else if (dev) out.push({ pid: p.id, name: p.label || p.id, group: 'device', route: 'local', limits: 'Runs in this browser; downloads model weights on first use.', model: (p.models || [])[0] || '' });
        else out.push({ pid: p.id, name: p.label || p.id, group: p.keyless ? ((p.route && p.route !== 'direct') ? 'nokeygw' : 'nokey') : 'paid', route: p.route || 'direct', limits: '', model: (p.models || [])[0] || '' });
      }
      if (!out.some(e => e.pid === 'openai')) out.push({ pid: 'openai', name: 'DeepSeek (core, Settings → Model key)', group: 'paid', route: 'direct', signup: 'https://platform.deepseek.com/api_keys', limits: 'Paid API key.', model: '' });
      FX_EXTRA.forEach(x => out.push(Object.assign({ extra: true, pid: x.id }, x)));
      return out;
    }
    const routeBadge = r => '<span class="fx-rb fx-' + esc(r || 'direct') + '" title="' + esc({ direct: 'Browser calls it directly (CORS permitting)', gateway: 'Needs the Vercel/Edge gateway or local bridge', origin: 'Needs an http(s) origin', local: 'Runs locally / in-browser', sim: 'Scripted offline' }[r] || '') + '">' + esc((r || 'direct').toUpperCase()) + '</span>';

    async function testOne(pid) {
      const c = core || ctx.service('forge.providers.core'); let txt = '';
      const messages = [{ role: 'system', content: 'Reply with the single word: pong' }, { role: 'user', content: 'ping' }];
      const onDelta = d => { if (d && d.content) txt += d.content; };
      try {
        if (c && c.has(pid)) { const r = await c.streamFor(pid, { messages, tools: [], onDelta }); return { ok: true, text: String((r && r.content) || txt).trim().slice(0, 80) }; }
        const p = (DS.kernel.list('provider') || []).find(x => x.id === pid); if (!p || !p.stream) throw new Error('provider ' + pid + ' not loaded');
        const r = await p.stream({ messages, tools: [], model: (p.models || [])[0], onDelta, signal: undefined }); return { ok: true, text: String((r && r.content) || txt).trim().slice(0, 80) };
      } catch (e) {
        let m = (e && e.message) || String(e);
        if (location.protocol === 'file:' && /failed to fetch|networkerror|load failed|cors|network/i.test(m)) m += ' — on file:// the browser blocks endpoints without CORS; set a gateway in /model or host Forge on Vercel.';
        return { ok: false, text: m.slice(0, 260) };
      }
    }
    function useOne(e) {
      const M = ctx.service('forge.models') || core;
      try { if (!M) throw new Error('model service not loaded'); M.select(e.pid, e.model || undefined); ctx.toast('Using ' + e.name + (e.model ? ' / ' + e.model : '') + (e.keyless || e.keyOptional || e.group === 'device' || e.group === 'nokey' || e.hasKey ? '' : ' — paste a key in /model'), 'ok', 3500); return true; }
      catch (err) { ctx.toast('Could not select ' + e.pid + ': ' + err.message, 'err', 5000); return false; }
    }

    /* ---------- view ---------- */
    DS.icons.gift = DS.icons.gift || '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="8" width="18" height="4" rx="1"/><path d="M5 12v8h14v-8M12 8v12M12 8c-1.5-3-5-4-5.5-1.5S9.5 8 12 8zM12 8c1.5-3 5-4 5.5-1.5S14.5 8 12 8z"/></svg>';
    ctx.effect(() => { const s = document.createElement('style'); s.textContent = `
.fx-g{margin:0 0 14px}.fx-gt{font-weight:700;font-size:13px;color:var(--text-2);margin:4px 2px 8px;display:flex;gap:6px;align-items:center}
.fx-r{border:1px solid var(--line);background:var(--card);border-radius:var(--radius);padding:10px 12px;margin-bottom:8px;display:flex;flex-direction:column;gap:6px;min-width:0}
.fx-h{display:flex;gap:6px;align-items:center;flex-wrap:wrap;min-width:0}.fx-h b{font-size:14px;overflow-wrap:anywhere}.fx-l{font-size:12px;color:var(--muted);overflow-wrap:anywhere}
.fx-a{display:flex;gap:6px;flex-wrap:wrap}.fx-a .btn{min-height:40px}.fx-a a.btn{text-decoration:none;display:inline-flex;align-items:center}
.fx-rb{font-size:10px;font-weight:700;letter-spacing:.04em;padding:2px 6px;border-radius:6px;border:1px solid var(--line-2);color:var(--text-2)}
.fx-direct{color:var(--ok);border-color:var(--ok)}.fx-gateway{color:var(--violet);border-color:var(--violet)}.fx-origin{color:var(--accent);border-color:var(--accent-line)}
.fx-o{font-family:var(--mono);font-size:11.5px;overflow-wrap:anywhere}.fx-o.ok{color:var(--ok)}.fx-o.err{color:var(--danger)}`; document.head.appendChild(s); return () => s.remove(); });

    if (ctx.rail) ctx.rail({ id: 'freeai', icon: 'gift', label: 'Free AI — providers you can use now', group: 'top', order: 50, run: () => DS.shell.show('freeai'), active: () => DS.shell.current === 'freeai' });
    ctx.view({ id: 'freeai', title: 'Free AI', icon: 'gift', order: 77, mount(el) {
      el.innerHTML = '<div class="vhead"><h2>Free AI</h2></div><div class="vscroll" style="padding:12px 16px"><div class="xs muted" style="margin-bottom:10px">Every provider Forge knows, grouped by what it takes to start. Route tags are honest: <b>direct</b> = browser calls it (if CORS allows), <b>gateway</b> = needs your proxy. Nothing here bypasses CORS.</div><div data-fx></div></div>';
      const host = el.querySelector('[data-fx]');
      const draw = () => {
        const E = entries(); let h = '';
        for (const [g, title] of GROUPS) {
          const rows = E.filter(e => e.group === g); if (!rows.length) continue;
          h += '<section class="fx-g" data-g="' + g + '"><div class="fx-gt">' + esc(title) + ' <span class="chip">' + rows.length + '</span></div>';
          for (const e of rows) {
            h += '<div class="fx-r" data-pid="' + esc(e.pid) + '"><div class="fx-h"><b>' + esc(e.name) + '</b>' + routeBadge(e.route) + (e.tag === 'unverified' ? '<span class="fx-rb">UNVERIFIED</span>' : '') + (e.tag === 'unstable' ? '<span class="fx-rb" style="color:var(--danger)">UNSTABLE</span>' : '') + (e.hasKey ? '<span class="fx-rb fx-direct">KEY SAVED</span>' : '') + (e.needs ? '<span class="fx-rb fx-gateway">' + esc(e.needs.toUpperCase()) + '</span>' : '') + '</div>' +
              (e.limits ? '<div class="fx-l">' + esc(e.limits) + '</div>' : '') +
              '<div class="fx-a">' + (e.signup ? '<a class="btn sm pri" data-gk="' + esc(e.pid) + '" href="' + esc(e.signup) + '" target="_blank" rel="noopener">' + (g === 'paid' ? 'Get key ↗' : 'Get free key ↗') + '</a>' : '') +
              (e.extra ? '<button class="btn sm" data-cust>Add as custom endpoint</button>' : '<button class="btn sm" data-use="' + esc(e.pid) + '">Use</button><button class="btn sm" data-test="' + esc(e.pid) + '">Test</button>' + (e.keyless || e.group === 'device' || e.pid === 'sim' ? '' : '<button class="btn sm" data-key="' + esc(e.pid) + '">' + (e.keyOptional ? 'Key (optional)' : 'Paste key') + '</button>')) +
              '</div><div class="fx-o" data-out></div></div>';
          }
          h += '</section>';
        }
        host.innerHTML = h;
      };
      host.addEventListener('click', async ev => {
        const t = ev.target.closest('[data-use],[data-test],[data-key],[data-cust]'); if (!t) return;
        const E = entries();
        if (t.dataset.use) { const e = E.find(x => x.pid === t.dataset.use); if (e) useOne(e); return; }
        if (t.dataset.key) { const M = ctx.service('forge.models'); M && M.openPicker({ focus: t.dataset.key }); return; }
        if (t.dataset.cust) { const M = ctx.service('forge.models'); M && M.openPicker({ custom: true }); return; }
        if (t.dataset.test) { const out = t.closest('.fx-r').querySelector('[data-out]'); t.disabled = true; out.className = 'fx-o'; out.textContent = 'testing…';
          const r = await testOne(t.dataset.test); t.disabled = false; out.className = 'fx-o ' + (r.ok ? 'ok' : 'err'); out.textContent = (r.ok ? '✓ ok: ' : '✗ ') + (r.text || '(empty reply)'); }
      });
      draw(); const off = ctx.on('models:change', () => setTimeout(draw, 0));
      return () => { try { typeof off === 'function' && off(); } catch (_) {} };
    } });

    ctx.provide('forge.freeai', { entries, test: testOne, use: pid => { const e = entries().find(x => x.pid === pid); return e ? useOne(e) : false; }, open: () => DS.shell.show('freeai') });
    ctx.command({ name: 'free', desc: 'Open the Free AI directory', run() { DS.shell.show('freeai'); } });
    ctx.intent({ id: 'fx-free', order: 50, match: t => /\b(free (ai|models?|providers?|llms?)|no[- ]key (ai|models?)|which (ai|models?) (are|is) free)\b/i.test(t), script: () => [{ final: () => {
      const E = entries(); const by = g => E.filter(e => e.group === g).map(e => e.name).join(', ') || '—';
      setTimeout(() => { try { DS.shell.show('freeai'); } catch (_) {} }, 50);
      return 'Opened the **Free AI** directory.\n\n- **No key:** ' + by('nokey') + '\n- **No key (unverified):** ' + by('nokeyu') + '\n- **No key (needs gateway / https):** ' + by('nokeygw') + '\n- **Free key:** ' + by('key') + '\n- **On-device:** ' + by('device') + '\n- **Local server:** ' + by('local') + '\n\nTap **Test** on any row for a live ping (needs network; endpoints marked UNVERIFIED have not been checked live).'; } }] });
    ctx.suggest && ctx.suggest({ id: 'fx-sug', emoji: '🎁', title: 'Free AI directory', sub: 'No-key, free-key and on-device models', prompt: 'show me free AI models' });
  }
});
