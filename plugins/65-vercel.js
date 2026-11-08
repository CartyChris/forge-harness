/* forge.vercel — lights up full-stack features when the harness is served by the Vercel backend (vercel/api/*).
   On file:// with no base URL it degrades silently and shows a "Deploy to unlock" card. Honest: never claims to bypass CORS. */
DS.plugin({
  name: 'forge.vercel', title: 'Vercel backend', version: '1.0.0', tags: ['vercel', 'backend', 'mcp', 'cloud'],
  description: 'Detects the Vercel backend (/api/health), adds cloud_fetch + cloud_models tools, one-tap Forge MCP connect, deploy checklist.',
  apply(ctx) {
    const util = DS.util, esc = util.esc;
    DS.icons.cloud = DS.icons.cloud || '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M7 18a4.5 4.5 0 0 1-.6-8.96A6 6 0 0 1 18 9.5a4 4 0 0 1-.5 8.5H7z"/></svg>';
    const MCP_NAME = 'forge-cloud';
    const STEPS = [
      ['Get the folder', 'Use the <span class="mono">vercel/</span> folder of the Forge repo (it contains <span class="mono">public/index.html</span> + <span class="mono">api/</span>).'],
      ['Deploy — Dashboard', 'Push <span class="mono">vercel/</span> to a Git repo → vercel.com/new → import → Framework preset <b>Other</b>, root = this folder → Deploy.'],
      ['…or CLI', '<span class="mono">npm i -g vercel &amp;&amp; cd vercel &amp;&amp; vercel deploy --prod</span>'],
      ['…or Button', '<span class="mono">https://vercel.com/new/clone?repository-url=&lt;your-repo-url&gt;&amp;root-directory=vercel</span>'],
      ['Verify', 'Open <span class="mono">https://&lt;app&gt;.vercel.app/api/health</span> — it should return <span class="mono">{"ok":true,…}</span>.'],
      ['Secure it', 'Set env <span class="mono">FORGE_ACCESS_TOKEN</span> (required header <span class="mono">x-forge-token</span>) and optionally <span class="mono">FORGE_MCP_TOKEN</span> (Bearer for /api/mcp). Paste the token below.'],
      ['From file://', 'Opened locally (Textastic/Files)? Paste your deployment URL as Base URL below — file:// cannot bypass CORS; the backend sends CORS <span class="mono">*</span>.']
    ];
    let state = { online: false, origin: '', features: {}, serverKeys: [], version: '', tokenRequired: false, checked: false, err: '' };
    let inflight = null;
    const isHttp = () => /^https?:$/.test(location.protocol);
    const trimUrl = u => String(u || '').trim().replace(/\/+$/, '').replace(/\/api(\/health)?$/, '');
    const token = () => String(ctx.data.get('token', '') || '');
    const headers = () => { const h = {}; const t = token(); if (t) h['x-forge-token'] = t; return h; };
    const candidates = () => { const c = []; const b = trimUrl(ctx.data.get('base', '')); if (isHttp()) c.push(location.origin); if (b && !c.includes(b)) c.push(b); return c; };
    async function probe(origin) {
      const ac = new AbortController(); const t = setTimeout(() => ac.abort(), 2500);
      try {
        const r = await fetch(origin + '/api/health', { signal: ac.signal, headers: headers(), cache: 'no-store' });
        if (!r.ok) return { err: 'HTTP ' + r.status };
        const j = await r.json(); if (!j || j.ok !== true) return { err: 'health not ok' };
        return { j };
      } catch (e) { return { err: e.name === 'AbortError' ? 'timeout (2.5 s)' : 'unreachable (network/CORS): ' + (e.message || e) }; }
      finally { clearTimeout(t); }
    }
    function detect(force) {
      if (inflight) return inflight;
      if (state.checked && !force) return Promise.resolve(info());
      inflight = (async () => {
        await null; const prev = state.online + '|' + state.origin; let errs = [];
        let next = { online: false, origin: '', features: {}, serverKeys: [], version: '', tokenRequired: false, checked: true, err: '' };
        for (const o of candidates()) {
          const r = await probe(o);
          if (r.j) { next = { online: true, origin: o, features: r.j.features || {}, serverKeys: r.j.serverKeys || [], version: r.j.version || '', tokenRequired: !!r.j.tokenRequired, checked: true, err: '' }; break; }
          errs.push(o + ': ' + r.err);
        }
        if (!next.online) next.err = errs.length ? errs.join(' · ') : 'no http(s) origin and no base URL set';
        state = next;
        if (prev !== state.online + '|' + state.origin) ctx.emit('backend:change', info());
        try { DS.shell.renderStatus && DS.shell.renderStatus(); } catch (_) {}
        return info();
      })();
      const p = inflight; p.finally(() => { if (inflight === p) inflight = null; }); return p;
    }
    const info = () => ({ online: state.online, origin: state.origin, features: Object.assign({}, state.features), serverKeys: state.serverKeys.slice(), version: state.version, tokenRequired: state.tokenRequired, error: state.err || undefined });
    const base = () => state.online ? state.origin : '';
    const OFF = () => ({ error: 'Vercel backend offline' + (state.err ? ' (' + state.err + ')' : ''), hint: 'Deploy to Vercel or set base URL (Settings → Vercel backend).' });
    async function api(path) {
      await detect(); if (!state.online) return { off: OFF() };
      let r; try { r = await fetch(state.origin + path, { headers: headers(), cache: 'no-store' }); }
      catch (e) { return { off: { error: 'backend unreachable: ' + (e.message || e), hint: 'Check the base URL / network. file:// cannot bypass CORS.' } }; }
      let j = null; try { j = await r.json(); } catch (_) {}
      if (r.status === 401) return { off: { error: 'backend rejected the access token (401)', hint: 'Set the x-forge-token in Settings → Vercel backend (FORGE_ACCESS_TOKEN on the server).' } };
      if (!r.ok && !(j && j.models)) return { off: { error: 'backend HTTP ' + r.status + (j && j.error ? ': ' + j.error : ''), hint: 'See /api/health and the Vercel function logs.' } };
      return { j };
    }

    /* ---------- MCP ---------- */
    const mcpUrl = () => (state.origin || trimUrl(ctx.data.get('base', '')) || (isHttp() ? location.origin : 'https://<app>.vercel.app')) + '/api/mcp';
    const mcpServer = () => DS.mcp && DS.mcp.servers.get(MCP_NAME);
    async function mcpConnect() {
      await detect();
      if (!state.online) return Object.assign({ connected: false }, OFF());
      if (!state.features.mcp) return { connected: false, error: 'this backend does not advertise features.mcp', hint: 'Redeploy the latest vercel/ folder (api/mcp.js).' };
      if (!DS.mcp) return { connected: false, error: 'core MCP client missing' };
      const cur = mcpServer(); if (cur && cur.status === 'ready') return { connected: true, url: cur.cfg.url, tools: cur.tools.map(t => 'mcp_' + MCP_NAME.replace(/[^a-zA-Z0-9_]/g, '_') + '_' + t.name) };
      const cfg = { name: MCP_NAME, url: state.origin + '/api/mcp', headers: {} }; const t = token(); if (t) cfg.headers.Authorization = 'Bearer ' + t;
      const srv = await DS.mcp.connect(cfg, ctx);
      if (srv.status !== 'ready') {
        const e = String(srv.err || 'unknown');
        const hint = /401|403/.test(e) ? 'The MCP server wants a Bearer token (FORGE_MCP_TOKEN). Paste it as the access token.' : /fetch|network|cors/i.test(e) ? 'Network/CORS failure — the browser could not reach ' + cfg.url + '. file:// cannot bypass CORS.' : 'See Settings → Vercel backend.';
        return { connected: false, url: cfg.url, error: 'MCP connect failed: ' + e, hint };
      }
      ctx.data.set('mcpAuto', true);
      return { connected: true, url: cfg.url, tools: srv.tools.map(x => 'mcp_' + MCP_NAME.replace(/[^a-zA-Z0-9_]/g, '_') + '_' + x.name) };
    }
    function mcpDisconnect() { if (DS.mcp) { if (DS.mcp.disconnect) DS.mcp.disconnect(MCP_NAME); else DS.mcp.servers.delete(MCP_NAME); } ctx.data.set('mcpAuto', false); DS.bus.emit('mcp:change'); ctx.toast('Forge MCP disconnected — its tools were removed', 'ok'); }

    ctx.provide('forge.backend', { detect: f => detect(f !== false), info, base, mcpConnect, mcpUrl, api /* api(path) → {j}|{off} */ });

    /* ---------- tools ---------- */
    ctx.tool({ name: 'cloud_status', label: 'Backend status', gate: 'read', description: 'Check whether the Forge Vercel backend (/api/health) is online and which features it offers.',
      parameters: { type: 'object', properties: {} },
      async run() { const i = await detect(true); return i.online ? i : Object.assign({}, i, OFF()); },
      summarize: (a, r) => r && r.online ? '☁ online · ' + r.origin : '☁ offline' });
    ctx.tool({ name: 'cloud_fetch', label: 'Cloud fetch', gate: 'net', description: 'Fetch a public https page through the Forge Vercel backend (/api/fetch) and return readable text, title and links. Works only when the backend is online.',
      parameters: { type: 'object', properties: { url: { type: 'string', description: 'https URL' }, max: { type: 'number', description: 'max chars (default 8000)' } }, required: ['url'] },
      detail: a => ({ path: a.url }),
      async run(a) {
        const max = Math.min(Number(a.max) || 8000, 20000);
        const r = await api('/api/fetch?url=' + encodeURIComponent(a.url) + '&max=' + max); if (r.off) return r.off;
        const j = r.j; return { url: j.url, status: j.status, title: j.title, text: String(j.text || '').slice(0, max), links: (j.links || []).slice(0, 25), truncated: !!j.truncated, via: state.origin + '/api/fetch' };
      },
      summarize: (a, r) => r && r.error ? 'offline' : (r && r.title ? r.title : a.url) });
    ctx.tool({ name: 'cloud_models', label: 'Cloud models', gate: 'net', description: 'List free models aggregated by the Forge Vercel backend (/api/models: OpenRouter :free + Pollinations). Optional provider filter.',
      parameters: { type: 'object', properties: { provider: { type: 'string', description: 'openrouter | pollinations' } } },
      async run(a) {
        const r = await api('/api/models'); if (r.off) return r.off;
        let ms = (r.j.models || []); if (a && a.provider) ms = ms.filter(m => m.provider === String(a.provider).toLowerCase());
        return { count: ms.length, models: ms.slice(0, 60).map(m => ({ provider: m.provider, id: m.id, context: m.context || null })), errors: r.j.errors || {}, via: state.origin + '/api/models' };
      },
      summarize: (a, r) => r && r.error ? 'offline' : r.count + ' models' });
    ctx.tool({ name: 'cloud_mcp_connect', label: 'Connect Forge MCP', gate: 'net', description: 'Connect the Forge MCP server on the Vercel backend (/api/mcp); its tools then become agent tools.',
      parameters: { type: 'object', properties: {} }, async run() { return mcpConnect(); },
      summarize: (a, r) => r.connected ? (r.tools || []).length + ' MCP tools' : 'failed' });

    /* ---------- UI pieces ---------- */
    ctx.effect(() => { const s = document.createElement('style'); s.textContent = `
      .vc-card{border:1px solid var(--line);background:var(--card);border-radius:var(--radius);padding:14px;display:flex;flex-direction:column;gap:10px}
      .vc-hd{display:flex;align-items:center;gap:10px}.vc-hd svg{width:22px;height:22px;color:var(--accent)}
      .vc-hd b{font-size:15px}.vc-steps{margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:8px;counter-reset:vc}
      .vc-steps li{counter-increment:vc;display:grid;grid-template-columns:24px 1fr;gap:8px;font-size:13px;color:var(--text-2);overflow-wrap:anywhere}
      .vc-steps li::before{content:counter(vc);width:22px;height:22px;border-radius:50%;background:var(--accent-soft);color:var(--accent);display:grid;place-items:center;font-size:12px;font-weight:600}
      .vc-steps b{color:var(--text)}.vc-feat{display:flex;flex-wrap:wrap;gap:6px}.vc-row{display:flex;flex-wrap:wrap;gap:8px}.vc-row .btn{min-height:40px}
      .vc-err{font-size:12px;color:var(--muted);overflow-wrap:anywhere}`; document.head.appendChild(s); return () => s.remove(); });

    function statusCard() {
      const i = info(); const box = util.el('div', { class: 'vc-card' });
      const feats = Object.keys(i.features).map(k => '<span class="chip ' + (i.features[k] ? 'ok' : '') + '">' + esc(k) + '</span>').join('');
      box.innerHTML = '<div class="vc-hd">' + DS.icons.cloud + '<div class="grow"><b>' + (i.online ? 'Vercel backend online' : 'Deploy to unlock') + '</b><div class="xs muted mono">' + esc(i.online ? i.origin + (i.version ? ' · v' + i.version : '') : (isHttp() ? location.origin + ' has no /api/health' : 'opened from ' + location.protocol + ' — no server')) + '</div></div><span class="chip ' + (i.online ? 'ok' : 'warn') + '">' + (i.online ? '☁ vercel' : '☁ offline') + '</span></div>' +
        (i.online ? '<div class="vc-feat">' + feats + (i.serverKeys.length ? '<span class="chip acc">server keys: ' + esc(i.serverKeys.join(', ')) + '</span>' : '') + (i.tokenRequired ? '<span class="chip warn">token required</span>' : '') + '</div>'
          : '<div class="sm muted">Host this single HTML file on Vercel (with <span class="mono">api/</span>) to unlock: CORS gateway, readable <b>cloud_fetch</b>, free-model catalog, and the Forge <b>MCP</b> server. Everything else keeps working offline.</div>' + (i.error ? '<div class="vc-err">' + esc(i.error) + '</div>' : ''));
      return box;
    }
    function checklistCard() {
      const box = util.el('div', { class: 'vc-card' });
      box.innerHTML = '<div class="vc-hd">' + DS.icons.cloud + '<b class="grow">Deploy checklist</b></div><ol class="vc-steps">' + STEPS.map(s => '<li><div><b>' + s[0] + '.</b> ' + s[1] + '</div></li>').join('') + '</ol>';
      const row = util.el('div', { class: 'vc-row' });
      const cp = util.el('button', { class: 'btn sm', 'data-vc': 'copy-mcp' }); cp.textContent = 'Copy MCP URL'; cp.onclick = () => { util.copy(mcpUrl()); ctx.toast('Copied ' + mcpUrl(), 'ok'); };
      const cj = util.el('button', { class: 'btn sm' }); cj.textContent = 'Copy MCP client JSON'; cj.onclick = () => { util.copy(JSON.stringify({ mcpServers: { forge: { type: 'http', url: mcpUrl(), headers: { Authorization: 'Bearer <FORGE_MCP_TOKEN>' } } } }, null, 2)); ctx.toast('Copied MCP client config', 'ok'); };
      row.append(cp, cj); box.appendChild(row); return box;
    }
    function mcpRow(after) {
      const box = util.el('div', { class: 'vc-card' }); const sv = mcpServer();
      const st = sv ? sv.status : 'not connected';
      box.innerHTML = '<div class="vc-hd">' + DS.icons.cloud + '<div class="grow"><b>Forge MCP</b><div class="xs muted mono">' + esc(mcpUrl()) + '</div></div><span class="chip ' + (st === 'ready' ? 'ok' : st === 'error' ? 'err' : '') + '">' + esc(st) + '</span></div>' +
        (sv && sv.status === 'ready' ? '<div class="xs muted">' + sv.tools.length + ' tools: ' + esc(sv.tools.map(t => t.name).join(', ')) + '</div>' : '') + (sv && sv.err ? '<div class="vc-err">' + esc(sv.err) + '</div>' : '');
      const row = util.el('div', { class: 'vc-row' });
      if (!sv || sv.status !== 'ready') {
        const b = util.el('button', { class: 'btn pri sm', 'data-vc': 'mcp-connect' }); b.textContent = 'Connect Forge MCP (…/api/mcp)'; b.disabled = !(state.online && state.features.mcp);
        b.onclick = async () => { b.disabled = true; b.textContent = 'Connecting…'; const r = await mcpConnect(); ctx.toast(r.connected ? 'Forge MCP connected · ' + r.tools.length + ' tools' : r.error + ' — ' + (r.hint || ''), r.connected ? 'ok' : 'err', 5000); after(); };
        row.appendChild(b); if (!state.online) row.appendChild(util.el('span', { class: 'xs muted' }, 'needs the backend online'));
      } else { const d = util.el('button', { class: 'btn sm' }); d.textContent = 'Disconnect'; d.onclick = () => { mcpDisconnect(); after(); }; row.appendChild(d); }
      box.appendChild(row); return box;
    }

    ctx.settings({ id: 'vercel', title: 'Vercel backend', order: 45, render(el) {
      const draw = () => {
        el.innerHTML = ''; el.appendChild(statusCard());
        const f1 = util.el('div', { class: 'field' }, '<label>Base URL (for a file:// copy)</label>'); const bu = util.el('input', { class: 'inp', id: 'vc-base', placeholder: 'https://your-app.vercel.app', value: ctx.data.get('base', '') }); f1.appendChild(bu);
        f1.appendChild(util.el('div', { class: 'hint' }, 'Same-origin <span class="mono">/api/health</span> is tried first when served over http(s).'));
        const f2 = util.el('div', { class: 'field' }, '<label>Access token (x-forge-token / MCP Bearer)</label>'); const tk = util.el('input', { class: 'inp', id: 'vc-token', type: 'password', placeholder: token() ? '•••• saved' : 'optional', autocomplete: 'off' }); f2.appendChild(tk);
        const row = util.el('div', { class: 'vc-row' }); const tb = util.el('button', { class: 'btn pri', 'data-vc': 'test' }); tb.textContent = 'Save & Test';
        tb.onclick = async () => { ctx.data.set('base', trimUrl(bu.value)); if (tk.value) ctx.data.set('token', tk.value.trim()); tb.disabled = true; tb.textContent = 'Testing…'; const i = await detect(true); ctx.toast(i.online ? '☁ Backend online · ' + i.origin : '☁ Offline — ' + (i.error || ''), i.online ? 'ok' : 'warn', 4500); draw(); };
        const ct = util.el('button', { class: 'btn' }); ct.textContent = 'Clear token'; ct.onclick = () => { ctx.data.del('token'); draw(); ctx.toast('Token cleared', 'ok'); };
        row.append(tb, ct); el.append(f1, f2, row, mcpRow(draw), checklistCard());
      };
      draw();
    } });

    ctx.status({ id: 'backend', align: 'right', text: () => state.checked ? (state.online ? '☁ vercel' : '☁ offline') : '', onClick: () => openSheet() });

    function openSheet() {
      const node = util.el('div', { class: 'col', style: 'gap:12px' }); const draw = () => { node.innerHTML = ''; node.append(statusCard(), mcpRow(draw), checklistCard()); };
      draw(); detect(true).then(draw);
      DS.ui.sheet({ title: 'Vercel backend', node, actions: [{ label: 'Settings', onClick: c => { c(); DS.shell.show('settings'); } }, { label: 'Done', primary: true, onClick: c => c() }] });
    }
    if (ctx.rail) ctx.rail({ id: 'backend', icon: 'cloud', label: 'Backend', group: 'bottom', order: 55, run: openSheet, badge: () => state.online ? '●' : '' });

    ctx.command({ name: 'backend', desc: 'Vercel backend status + deploy checklist', async run(arg, c) {
      const i = await detect(true);
      c.reply('### ☁ Vercel backend — ' + (i.online ? '**online**' : '**offline**') + '\n' + (i.online ? '- origin: `' + i.origin + '`\n- version: ' + (i.version || '?') + '\n- features: ' + Object.keys(i.features).filter(k => i.features[k]).join(', ') + '\n- server keys: ' + (i.serverKeys.join(', ') || 'none') + (i.tokenRequired ? '\n- token required: yes' : '') + '\n- MCP: `' + mcpUrl() + '`'
        : '- ' + (i.error || '') + '\n\n**Deploy to unlock:**\n' + STEPS.map((s, n) => (n + 1) + '. **' + s[0] + '** — ' + s[1].replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')).join('\n')));
    } });
    ctx.command({ name: 'mcp-connect', desc: 'Connect the Forge MCP server on the Vercel backend', async run(arg, c) {
      const r = await mcpConnect(); c.reply(r.connected ? '✅ Forge MCP connected at `' + r.url + '` — tools: ' + r.tools.map(t => '`' + t + '`').join(', ') : '⚠️ ' + r.error + (r.hint ? '\n\n' + r.hint : ''));
    } });

    /* ---------- Sim ---------- */
    ctx.intent({ id: 'vercel-status', order: 50, match: t => /\b(backend|vercel)\b.*\b(status|online|check|up)\b|\bcheck (the )?(backend|vercel)\b/i.test(t), script: () => [
      { say: 'Probing `/api/health`…\n\n', tool: { name: 'cloud_status', args: {} } },
      { final: rs => { const r = rs[0] || {}; return r.online ? '☁ The Vercel backend is **online** at `' + r.origin + '` (features: ' + Object.keys(r.features || {}).filter(k => r.features[k]).join(', ') + '). `cloud_fetch`, `cloud_models` and the Forge MCP are available.' : '☁ The backend is **offline**. ' + (r.hint || '') + ' Run `/backend` for the deploy checklist.'; } }
    ] });
    ctx.intent({ id: 'vercel-mcp', order: 50, match: t => /\bconnect\b.*\bmcp\b|\bmcp\b.*\bconnect/i.test(t), script: () => [
      { say: 'Connecting the Forge MCP server on the backend…\n\n', tool: { name: 'cloud_mcp_connect', args: {} } },
      { final: rs => { const r = rs[0] || {}; return r.connected ? 'Connected `' + r.url + '`. New tools: ' + (r.tools || []).map(t => '`' + t + '`').join(', ') + '.' : 'Could not connect: ' + (r.error || '?') + '. ' + (r.hint || ''); } }
    ] });
    ctx.intent({ id: 'vercel-fetch', order: 50, match: t => /\bcloud[ _]fetch\b/i.test(t) && /https:\/\/\S+/.test(t), script: t => [
      { tool: { name: 'cloud_fetch', args: { url: (t.match(/https:\/\/\S+/) || [''])[0] } } },
      { final: rs => { const r = rs[0] || {}; return r.error ? r.error + ' — ' + r.hint : '**' + (r.title || r.url) + '**\n\n' + String(r.text || '').slice(0, 600); } }
    ] });
    if (ctx.suggest) ctx.suggest({ id: 'vercel', emoji: '☁', title: 'Check backend status', sub: 'Vercel /api/health, MCP, cloud tools', prompt: 'check backend status' });

    /* ---------- boot ---------- */
    ctx.setTimeout(() => detect(true).then(i => { if (i.online && i.features.mcp && ctx.data.get('mcpAuto', false) && !mcpServer()) mcpConnect(); }), 50);
  }
});
