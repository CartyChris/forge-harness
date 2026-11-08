/* forge.providers — multi-provider model routing ported from ATT (DeepSeek Harness Forge Ultimate).
   Honest route tags: direct | gateway | origin | local | sim. No fake model names: ids come from ATT lists or live /models. */
const FP_CAT = {
  pollinations: { name: 'Pollinations (free key)', endpoint: 'https://gen.pollinations.ai/v1/chat/completions', endpoints: ['https://gen.pollinations.ai/v1/chat/completions', 'https://text.pollinations.ai/openai'], epNote: 'Since late 2026 Pollinations asks for a key (401 “A valid API key is required”). Get a free publishable pk_ key at enter.pollinations.ai — it is meant for browser use. Without a key Forge still tries once in case anonymous access returns.', models: ['openai', 'gemini', 'openai-fast', 'openai-large', 'deepseek', 'llama', 'mistral', 'qwen-coder', 'hermes', 'dolphin-mistral'], keyOptional: true, signup: 'https://enter.pollinations.ai', ph: 'pk_… (publishable key, safe in a browser)', route: 'direct', tools: 'prompt', sampling: false },
  openrouter: { name: 'OpenRouter', endpoint: 'https://openrouter.ai/api/v1/chat/completions', models: ['openrouter/auto', 'deepseek/deepseek-chat-v3.2', 'anthropic/claude-sonnet-4.6', 'openai/gpt-5', 'google/gemini-3-flash-preview', 'meta-llama/llama-4-maverick', 'nousresearch/hermes-4-70b', 'cognitivecomputations/dolphin-mistral-24b-venice-edition', 'cognitivecomputations/dolphin-mistral-24b-venice-edition:free', 'nousresearch/hermes-3-llama-3.1-405b:free'], keyless: false, route: 'direct', tools: 'native', sampling: true, signup: 'https://openrouter.ai/keys', ph: 'sk-or-...' },
  puter: { name: 'Puter.js (origin only)', endpoint: null, models: ['gpt-5-nano', 'gpt-4o-mini', 'claude-3-5-sonnet', 'gemini-1.5-flash', 'deepseek-chat', 'mistral-large', 'llama-3.3-70b', 'cognitivecomputations/dolphin-mistral-24b-venice-edition:free'], keyless: true, route: 'origin', tools: 'prompt', sampling: false },
  uncloseai: { name: 'UncloseAI', endpoint: 'https://uncloseai.com/v1/chat/completions', models: ['hermes-4-70b', 'dolphin-3.0', 'gpt-oss-120b'], keyless: true, route: 'gateway', tools: 'prompt', sampling: false, tag: 'unverified' },
  orcarouter: { name: 'OrcaRouter', endpoint: 'https://api.orcarouter.ai/v1/chat/completions', models: ['qwen3.8-27b-uncensored-free', 'hermes-4-70b-free', 'dolphin-mistral-24b-free', 'nex-n2.5-mini-uncensored-free'], keyless: false, route: 'gateway', tools: 'prompt', sampling: true, signup: 'https://www.orcarouter.ai/', ph: 'sk-orca-...', tag: 'unverified' },
  venice: { name: 'Venice.ai', endpoint: 'https://api.venice.ai/api/v1/chat/completions', base: 'https://api.venice.ai/api/v1', discover: 'https://api.venice.ai/api/v1/models', models: ['venice-uncensored-1-2', 'venice-uncensored', 'dolphin-mistral-24b-venice-edition', 'llama-3.1-70b-uncensored'], keyless: false, route: 'direct', note: 'Venice API docs: browser cross-origin requests accepted from any origin; GET /models works without a key; chat needs an inference key. Free-tier limits not stated.', tools: 'prompt', sampling: true, signup: 'https://venice.ai/', ph: 'venice-...' },
  meganova: { name: 'MegaNova', endpoint: 'https://api.meganova.ai/v1/chat/completions', models: ['meganova-ai/manta-mini-1.0', 'DeepSeek-V3-0324', 'meganova-ai/manta-pro-1.0'], keyless: false, route: 'gateway', tools: 'prompt', sampling: true, signup: 'https://console.meganova.ai/register', ph: 'sk-...' },
  aicommunity: { name: 'AICommunityAPI (raw IP)', endpoint: 'https://193.93.169.64/v1/chat/completions', models: ['deepseek-3.2v-uncensored'], keyless: true, route: 'gateway', tools: 'prompt', sampling: false, off: true, tag: 'unstable', warn: 'Raw-IP endpoint with no verifiable operator or TLS identity. Your prompts go to an unknown server. Off by default.' },
  dulus: { name: 'Dulus', endpoint: 'https://control.dulus.ai/v1/chat/completions', models: ['dulus-uncensored', 'dulus-chat', 'dulus-code'], keyless: false, route: 'gateway', tools: 'prompt', sampling: true, signup: 'https://dulus.ai/', ph: 'dulus-...' },
  g4f: { name: 'g4f multi-provider', endpoints: ['https://g4f.dev/api/openai/chat/completions', 'https://api.aichatfree.info/v1/chat/completions', 'https://aiuncensored.info/api/v1/chat/completions', 'https://darkai.foundation/v1/chat/completions'], models: ['hermes-3', 'gpt-4o-mini', 'llama-3.1-70b', 'deepseek-chat'], keyless: true, route: 'gateway', tools: 'prompt', sampling: false, tag: 'unstable' },
  nvidia: { name: 'NVIDIA NIM / Build API', endpoint: 'https://integrate.api.nvidia.com/v1/chat/completions', models: ['nvidia/nemotron-3-super-120b-a12b', 'nvidia/nemotron-3-ultra-550b-a55b', 'deepseek-ai/deepseek-v4.1-flash', 'meta/llama-3.1-8b-instruct', 'moonshotai/kimi-k2.5', 'z-ai/glm4.7', 'openai/gpt-oss-20b'], keyless: false, route: 'gateway', tools: 'native', sampling: true, signup: 'https://build.nvidia.com/', ph: 'nvapi-...' }
};
const FP_IDQ = /\b(what|which|who)\b[^?\n]{0,40}\b(model|llm|ai|provider)\b[^?\n]{0,30}\b(are|is|am)\b[^?\n]{0,20}\b(you|this|running|using|routing)\b|\bwhat model (are you|is this|am i (talking|using))|\bwho are you\b|\bmodel identity\b/i;
const FP_LF = /dolphin|hermes|uncensored|venice-edition|abliterat/i; /* open-weight / less-filtered fine-tunes (neutral tag, no prompt changes) */
const FP_REASON_KEYS = ['reasoning', 'reasoning_content', 'thinking', 'analysis'];

DS.plugin({
  name: 'forge.providers', title: 'Model providers', version: '2.0.0', tags: ['providers', 'models', 'gateway'],
  description: 'Pollinations (direct, streaming), OpenRouter (+live free list), Puter (origin), NVIDIA NIM, g4f, Venice, and more — with exact model identity, gateway chain, prompt-based tool calling and a model picker.',
  apply(ctx) {
    const esc = DS.util.esc; const S = () => DS.store.state.settings;
    const keys = () => ctx.data.get('keys', {}) || {};
    const sel = () => ctx.data.get('sel', { provider: 'pollinations', model: 'openai-fast' });
    const live = ctx.data.get('live', {}) || {};
    const toolMode = ctx.data.get('toolMode', {}) || {};
    let identity = { provider: 'sim', providerName: 'Offline Sim', model: 'sim', requestedModel: 'sim', resolvedModel: 'sim', route: 'sim', gateway: '', free: true, keyless: true, ts: Date.now() };
    let healthProbe = null;
    const isOrigin = () => /^https?:$/.test(location.protocol);
    const enabled = id => { const en = ctx.data.get('enabled', {}); return en[id] != null ? !!en[id] : !FP_CAT[id].off; };
    const status = ctx.data.get('status', {}) || {}; const verified = ctx.data.get('verified', {}) || {};
    const favs = () => ctx.data.get('favs', []) || []; const recent = () => ctx.data.get('recent', []) || [];
    const markStatus = (pid, ok, msg) => { status[pid] = { ok: !!ok, ts: Date.now(), msg: String(msg || '').slice(0, 140) }; ctx.data.set('status', status); };
    let healthInfo = null;
    const lfOf = m => !!(m && (m.lessFiltered || FP_LF.test(m.id || '')));
    const modelsOf = id => { const L = live[id]; const base = (FP_CAT[id].models || []).map(m => typeof m === 'string' ? ({ id: m, label: m, free: /:free$/.test(m) || undefined }) : Object.assign({ label: m.id }, m)); if (!L || !L.length) return base; const seen = new Set(L.map(x => x.id)); return L.concat(base.filter(b => !seen.has(b.id))); };

    /* ---------- gateway ---------- */
    const gateway = {
      get: () => ctx.data.get('gateway', ''),
      set: url => { ctx.data.set('gateway', String(url || '').trim()); ctx.emit('models:change', {}); },
      async sameOrigin() {
        if (!isOrigin()) return false;
        if (!healthProbe) healthProbe = fetch('/api/health', { method: 'GET', headers: gateway.hdr({}) }).then(async r => { let j = {}; try { j = await r.json(); } catch (_) {} const fe = Array.isArray(j.features) ? j.features : (j.features && typeof j.features === 'object' ? Object.keys(j.features).filter(k => j.features[k]) : []); healthInfo = { ok: r.ok, features: fe, serverKeys: Array.isArray(j.serverKeys) ? j.serverKeys : [], raw: j, ts: Date.now() }; return r.ok; }).catch(() => { healthInfo = { ok: false, features: [], serverKeys: [], ts: Date.now() }; return false; });
        return healthProbe;
      },
      info: () => healthInfo ? Object.assign({}, healthInfo) : null,
      hdr(h, pid) { const o = Object.assign({}, h || {}); const tk = ctx.data.get('token', ''); if (tk) o['x-forge-token'] = tk; if (pid && gateway.serverKey(pid)) { o['x-forge-use-server-key'] = '1'; delete o.Authorization; } return o; },
      serverKey: pid => !!(ctx.data.get('useServerKey', false) && healthInfo && (healthInfo.serverKeys || []).map(String).map(x => x.toLowerCase()).includes(String(pid).toLowerCase())),
      wrap(base, url) { return /[?=]$/.test(base) || /\?url=$/.test(base) ? base + encodeURIComponent(url) : base.replace(/\/+$/, '') + '?url=' + encodeURIComponent(url); },
      async fetch(url, init = {}, opt = {}) {
        const errs = [];
        const gi = Object.assign({}, init, { headers: gateway.hdr(init.headers, opt.pid) });
        if (opt.pid && gateway.serverKey(opt.pid)) opt.direct = false;
        if (opt.direct !== false) {
          try { const r = await fetch(url, init); r._route = 'direct'; r._gateway = ''; return r; }
          catch (e) { if (e.name === 'AbortError') throw e; errs.push('direct: ' + e.message); }
        }
        if (!opt.local && await gateway.sameOrigin()) {
          try { const g = '/api/proxy?url=' + encodeURIComponent(url); const r = await fetch(g, gi); r._route = 'gateway'; r._gateway = '/api/proxy'; return r; }
          catch (e) { if (e.name === 'AbortError') throw e; errs.push('same-origin /api/proxy: ' + e.message); }
        }
        const gw = gateway.get();
        if (gw && !opt.local) {
          try { const r = await fetch(gateway.wrap(gw, url), gi); r._route = 'gateway'; r._gateway = gw; return r; }
          catch (e) { if (e.name === 'AbortError') throw e; errs.push('gateway ' + gw + ': ' + e.message); }
        }
        if (DS.bridge && DS.bridge.online) {
          try {
            const b = await DS.bridge.call('fetch', { url, method: init.method || 'GET', headers: init.headers || {}, body: init.body }, { timeout: 180000 });
            const r = new Response(b.body, { status: b.status || 200, headers: { 'Content-Type': (b.headers && (b.headers['content-type'] || b.headers['Content-Type'])) || 'application/json' } });
            r._route = 'gateway'; r._gateway = 'bridge'; return r;
          } catch (e) { errs.push('bridge: ' + e.message); }
        }
        if (opt.local) { const err = new Error('Local server unreachable at ' + new URL(url).host + '. Is it running? ' + (location.protocol === 'https:' ? 'This page is https:// — browsers block requests to http://localhost (mixed content); open Forge from file:// (works in some browsers) or an http:// origin. ' : '') + 'Also allow CORS: Ollama → set OLLAMA_ORIGINS=* (e.g. `OLLAMA_ORIGINS=* ollama serve`); LM Studio → enable CORS in the server tab; llama.cpp → `llama-server --host 127.0.0.1 --port 8080` (CORS on by default). [' + errs.join(' | ') + ']'); err.kind = 'network'; throw err; }
        const fileHint = location.protocol === 'file:' ? ' You are on file:// — browsers block cross-origin calls to servers that do not send CORS headers, and nothing in a local file can bypass that.' : '';
        const err = new Error('Network/CORS: could not reach ' + new URL(url).host + '.' + fileHint + ' Next step: set a gateway URL (Model picker → Gateway, e.g. https://you.vercel.app/api/forge-proxy?url=), deploy Forge to Vercel, or connect the local bridge. Or pick Pollinations (works direct). [' + errs.join(' | ') + ']');
        err.kind = 'network'; throw err;
      },
      snippet() {
        return `// api/forge-proxy.js — Vercel Edge CORS gateway for Forge\nexport const config = { runtime: 'edge' };\nconst ALLOW = /^(https:\\/\\/)(openrouter\\.ai|integrate\\.api\\.nvidia\\.com|api\\.venice\\.ai|api\\.meganova\\.ai|control\\.dulus\\.ai|api\\.orcarouter\\.ai|uncloseai\\.com|g4f\\.dev|text\\.pollinations\\.ai)\\//;\nconst CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS', 'Access-Control-Allow-Headers': '*' };\nexport default async function handler(req) {\n  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });\n  const url = new URL(req.url).searchParams.get('url');\n  if (!url || !ALLOW.test(url)) return new Response('blocked', { status: 400, headers: CORS });\n  const h = new Headers(req.headers); ['host', 'origin', 'referer', 'cookie'].forEach(k => h.delete(k));\n  const up = await fetch(url, { method: req.method, headers: h, body: req.method === 'GET' ? undefined : req.body });\n  const out = new Headers(up.headers); Object.entries(CORS).forEach(([k, v]) => out.set(k, v));\n  return new Response(up.body, { status: up.status, headers: out });\n}\n`;
      }
    };
    ctx.provide('forge.gateway', { get: gateway.get, set: gateway.set, fetch: (u, i, o) => gateway.fetch(u, i, o || {}), snippet: gateway.snippet, info: () => gateway.info(), probe: () => { healthProbe = null; return gateway.sameOrigin().then(() => gateway.info()); }, setToken: t => ctx.data.set('token', String(t || '').trim()), hasToken: () => !!ctx.data.get('token', '') });

    /* ---------- error explanation ---------- */
    async function httpError(res, pid) {
      let t = ''; try { t = await res.text(); } catch (_) {}
      const n = FP_CAT[pid] ? FP_CAT[pid].name : pid; const st = res.status; let why;
      if (st === 401 || st === 403) why = 'the API key was rejected (' + st + '). Open the Model picker and paste a valid ' + n + ' key.';
      else if (st === 402) why = 'payment required (402): this model needs credits. Pick a FREE model or top up.';
      else if (st === 429) why = 'rate limited (429). Wait a moment, or switch provider/model.';
      else if (st === 400 && /tool/i.test(t)) why = 'this model rejected native tool calls (400).';
      else why = 'HTTP ' + st + '.';
      const e = new Error(n + ': ' + why + (t ? ' Server said: ' + t.slice(0, 220) : '')); e.status = st; e.body = t; try { const ra = res.headers && res.headers.get('retry-after'); if (ra != null && isFinite(+ra)) e.retryAfter = +ra; } catch (_) {} return e;
    }

    /* ---------- prompt-based tool adapter ---------- */
    function toolPrompt(tools) {
      const T = DS.toolkit;
      return '[TOOL_PROTOCOL]\nYou cannot call functions natively. To use a tool, write ONE fenced block like this and then STOP writing:\n```tool_call\n{"name":"fs_write","arguments":{"path":"/notes/a.md","content":"hello"}}\n```\nThe "name" must be one of the tool names below (never "tool_call" itself). Arguments are a JSON object. You will get the result back as a user message starting with [TOOL_RESULT]; then continue. When no tool is needed, just answer.\nTools (name(args) — what it does):\n' +
        tools.map(t => '- ' + (T ? T.signature(t) : t.name) + ' — ' + String(t.description || '').replace(/\s+/g, ' ').slice(0, 140)).join('\n');
    }
    function parsePromptTools(text, tools) {
      if (DS.toolkit) return DS.toolkit.parse(text, { names: (tools || []).map(t => t.name) });
      const calls = []; const re = /```tool_call\s*\n([\s\S]*?)```/g; let m;
      while ((m = re.exec(text))) { const j = DS.safeJSON(m[1].trim()); if (j && j.name) calls.push({ id: DS.util.uid('call'), name: j.name, args: j.arguments || j.args || {}, raw: JSON.stringify(j.arguments || j.args || {}) }); }
      return { calls, clean: text.replace(re, '').trim() };
    }
    function flattenForPrompt(messages) { /* convert native tool messages into plain text for prompt-mode models */
      return messages.map(m => {
        if (m.role === 'tool') return { role: 'user', content: '[TOOL_RESULT ' + (m.tool_call_id || '') + ']\n' + m.content };
        if (m.role === 'assistant' && m.tool_calls) return { role: 'assistant', content: (m.content || '') + m.tool_calls.map(tc => '\n```tool_call\n' + JSON.stringify({ name: tc.function.name, arguments: DS.safeJSON(tc.function.arguments) }) + '\n```').join('') };
        return m;
      });
    }

    /* ---------- request body + steering ---------- */
    function buildBody(pid, model, messages, tools, mode, temperature) {
      const C = FP_CAT[pid];
      /* reasoning_content is required back by DeepSeek thinking+tools, and rejected or wasted elsewhere */
      if (!C.thinking) messages = messages.map(m => m && m.reasoning_content !== undefined ? (({ reasoning_content, ...r }) => r)(m) : m);
      const body = { model, messages, stream: true };
      const think = !!(DS.store && DS.store.state && DS.store.state.toggles && DS.store.state.toggles.think);
      if (C.thinking) { body.thinking = { type: think ? 'enabled' : 'disabled' }; if (think) body.reasoning_effort = 'high'; }
      else if (think && pid === 'openrouter') body.reasoning = { effort: 'high' };
      if (pid === 'openrouter' || pid === 'nvidia') body.stream_options = { include_usage: true };
      if (temperature != null) body.temperature = temperature;
      if (tools && tools.length && mode === 'native') { body.tools = tools.map(t => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } })); body.tool_choice = 'auto'; }
      if (pid === 'pollinations') { body.referrer = 'forge'; body.private = true; }
      let st = null; try { const s = DS.kernel.services && DS.kernel.services.get && DS.kernel.services.get('forge.steering'); st = s && s.get ? s.get() : null; } catch (_) {}
      if (st && C.sampling) {
        for (const k of ['temperature', 'top_p', 'top_k', 'min_p', 'top_a', 'frequency_penalty', 'presence_penalty', 'repetition_penalty', 'max_tokens', 'seed', 'stop', 'parallel_tool_calls']) if (st[k] != null && st[k] !== '') body[k] = st[k];
        if (st.tool_choice && body.tools) body.tool_choice = st.tool_choice;
        const eff = st.reasoning_effort || st.reasoningEffort; if (eff) { if (pid === 'openrouter') body.reasoning = { effort: eff }; else body.reasoning_effort = eff; }
      } else if (st && st.temperature != null) body.temperature = st.temperature;
      return body;
    }

    /* ---------- shared OpenAI-compatible SSE core ---------- */
    async function readSSE(res, onDelta, meta) {
      const ct = res.headers.get('content-type') || '';
      let content = '', reasoning = '', usage = null; const tcs = [];
      let inThink = false, sawThink = false, pend = '';
      const emitText = t => { /* split inline <think>…</think> only when actually present */
        pend += t; let out = '';
        for (;;) {
          if (!inThink) {
            const i = pend.indexOf('<think>');
            if (i < 0) { const lt = pend.lastIndexOf('<'); const hold = lt >= 0 && '<think>'.startsWith(pend.slice(lt)) ? pend.slice(lt) : ''; out += pend.slice(0, pend.length - hold.length); pend = hold; break; }
            out += pend.slice(0, i); pend = pend.slice(i + 7); inThink = true; sawThink = true;
          }
          else { const i = pend.indexOf('</think>'); if (i < 0) { reasoning += pend; onDelta && pend && onDelta({ reasoning: pend }); pend = ''; break; } const r = pend.slice(0, i); reasoning += r; r && onDelta && onDelta({ reasoning: r }); pend = pend.slice(i + 8); inThink = false; }
        }
        if (out) { content += out; onDelta && onDelta({ content: out }); }
      };
      const handle = j => {
        if (j.model && !meta.resolved) { meta.resolved = j.model; }
        if (j.usage) usage = j.usage;
        const ch = j.choices && j.choices[0]; if (!ch) return;
        const dl = ch.delta || ch.message || {};
        for (const k of FP_REASON_KEYS) { const v = dl[k]; if (typeof v === 'string' && v) { reasoning += v; onDelta && onDelta({ reasoning: v }); break; } }
        if (typeof dl.content === 'string' && dl.content) emitText(dl.content);
        if (dl.tool_calls) for (const tc of dl.tool_calls) { const i = tc.index || 0; const c = tcs[i] || (tcs[i] = { id: '', name: '', raw: '' }); if (tc.id) c.id = tc.id; if (tc.function) { if (tc.function.name) c.name += tc.function.name; if (tc.function.arguments) c.raw += typeof tc.function.arguments === 'string' ? tc.function.arguments : JSON.stringify(tc.function.arguments); } onDelta && onDelta({ toolDelta: { index: i, name: c.name } }); }
      };
      if (!/event-stream/.test(ct) && /json/.test(ct)) { handle(await res.json()); }
      else if (!res.body || !res.body.getReader) { const t = await res.text(); for (const l of t.split('\n')) { const d = l.replace(/^data:\s*/, '').trim(); if (d && d !== '[DONE]') { try { handle(JSON.parse(d)); } catch (_) {} } } }
      else {
        const rd = res.body.getReader(); const dec = new TextDecoder(); let buf = '';
        for (;;) {
          const { done, value } = await rd.read(); if (done) break; buf += dec.decode(value, { stream: true });
          let idx; while ((idx = buf.indexOf('\n')) >= 0) {
            const line = buf.slice(0, idx).trim(); buf = buf.slice(idx + 1); if (!line.startsWith('data:')) continue; const d = line.slice(5).trim(); if (d === '[DONE]') continue;
            let j; try { j = JSON.parse(d); } catch (_) { continue; } handle(j);
          }
        }
      }
      if (pend) { if (inThink) { reasoning += pend; onDelta && onDelta({ reasoning: pend }); } else { content += pend; onDelta && onDelta({ content: pend }); } }
      void sawThink;
      const toolCalls = tcs.filter(Boolean).map(c => ({ id: c.id || DS.util.uid('call'), name: c.name, args: DS.safeJSON(c.raw), raw: c.raw }));
      return { content, reasoning, toolCalls, usage };
    }

    /* ---------- identity ---------- */
    const setIdentityReal = o => setIdentity(o); function setIdentity(o) { identity = Object.assign({}, identity, o, { ts: Date.now() }); ctx.emit('models:identity', identity); DS.bus.emit('status:refresh'); }
    function identityAnswer(id) {
      const i = id || identity;
      if (i.provider === 'sim') return 'I am the **Offline Sim** built into Forge — a scripted, local stand-in with no language model behind it (route: `sim`). Pick a real model with `/model`.';
      return 'I am running on **' + i.providerName + '** — model `' + (i.resolvedModel || i.requestedModel) + '`' + (i.resolvedModel && i.resolvedModel !== i.requestedModel ? ' (requested `' + i.requestedModel + '`)' : '') + ', route `' + i.route + '`' + (i.gateway ? ' via `' + i.gateway + '`' : '') + '. This comes from Forge\'s runtime routing record, not from the model\'s own guess.';
    }
    const wantsIdentity = t => FP_IDQ.test(String(t || '')) && String(t).length < 160;
    const lastUserText = messages => { for (let i = messages.length - 1; i >= 0; i--) if (messages[i].role === 'user') { const c = messages[i].content; return typeof c === 'string' ? c : (c || []).map(p => p.text || '').join(' '); } return ''; };

    /* ---------- Puter lazy loader (http/https only) ---------- */
    let puterP = null;
    function loadPuter() {
      if (!isOrigin()) return Promise.reject(new Error('Puter.js needs an http(s) origin; it never loads on file://. Open Forge from a web server or Vercel.'));
      if (window.puter) return Promise.resolve(window.puter);
      return puterP || (puterP = new Promise((ok, no) => { const s = document.createElement('script'); s.src = 'https://js.puter.com/v2/'; s.async = true; s.onload = () => window.puter ? ok(window.puter) : no(new Error('Puter loaded without global')); s.onerror = () => { puterP = null; no(new Error('Could not load Puter.js (offline or blocked).')); }; document.head.appendChild(s); }));
    }

    /* ---------- the stream function per provider ---------- */
    async function streamFor(pid, { messages, tools, signal, onDelta, temperature, forceModel, quiet }) {
      const setIdentity = quiet ? () => {} : setIdentityReal;  /* quiet: background calls (IDE autocomplete) never change the "current model" readout */
      const C = FP_CAT[pid]; const sl = sel(); const model = forceModel || (sl.provider === pid && sl.model) || C.defaultModel || (C.models || [])[0] || (live[pid] && live[pid][0] && live[pid][0].id);
      if (!C.keyless && !C.keyOptional && !keys()[pid] && !gateway.serverKey(pid)) { keyToast(pid, C); throw new Error(C.name + ': no API key. Open the Model picker (/model) and paste your key' + (C.signup ? '. Get free key ↗ ' + C.signup : '') + '.'); }
      if (!model) throw new Error(C.name + ': no model id yet. Open /model → ' + C.name + ' → Discover models (needs key + network) or type a custom model id.');
      const k = keys()[pid] || '';
      const base = { provider: pid, providerName: C.name, requestedModel: model, model, resolvedModel: model, free: !!C.keyless || /:free$|free/i.test(model), keyless: !!C.keyless };
      if (wantsIdentity(lastUserText(messages))) { /* deterministic, never a guessed name */
        const t = identityAnswer(Object.assign({}, identity, base, { route: identity.provider === pid ? identity.route : C.route, gateway: identity.provider === pid ? identity.gateway : '' }));
        onDelta && onDelta({ content: t }); setIdentity(Object.assign(base, { route: identity.provider === pid ? identity.route : C.route })); return { content: t, reasoning: '', toolCalls: [], usage: null };
      }
      if (!C.keyless && !C.keyOptional && !k && !gateway.serverKey(pid)) { keyToast(pid, C); throw new Error(C.name + ': no API key. Open the Model picker (/model) and paste your key' + (C.signup ? '. Get free key ↗ ' + C.signup : '') + '.'); }
      if (pid === 'puter') {
        const puter = await loadPuter(); const msgs = flattenForPrompt(messages);
        const r = await puter.ai.chat(msgs, { model, stream: true }); let content = '';
        for await (const part of r) { if (signal && signal.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' }); const t = part && (part.text || ''); if (t) { content += t; onDelta && onDelta({ content: t }); } }
        setIdentity(Object.assign(base, { route: 'origin', gateway: 'puter.js' }));
        const p = parsePromptTools(content, tools); return { content: p.clean, reasoning: '', toolCalls: p.calls, usage: null };
      }
      let mode = toolMode[pid + '/' + model] || C.tools; if (!tools || !tools.length) mode = 'none';
      const go = async m => {
        let msgs = m === 'native' ? messages : flattenForPrompt(messages);
        if (m === 'prompt') msgs = [Object.assign({}, msgs[0], { content: msgs[0].content + '\n\n' + toolPrompt(tools) })].concat(msgs.slice(1));
        const body = buildBody(pid, model, msgs, tools, m, temperature);
        const headers = { 'Content-Type': 'application/json', Accept: 'text/event-stream' };
        if (k) headers.Authorization = 'Bearer ' + k;
        if (C.headers) Object.assign(headers, C.headers);
        if (C.stream === false) { body.stream = false; delete body.stream_options; headers.Accept = 'application/json'; }
        if (pid === 'openrouter') { headers['HTTP-Referer'] = isOrigin() ? location.origin : 'https://forge.local/'; headers['X-Title'] = 'Forge'; }
        const urls = C.endpoints || [C.endpoint]; let lastErr = null;
        for (const u of urls) {
          try {
            const res = await gateway.fetch(u, { method: 'POST', headers, body: JSON.stringify(body), signal }, { direct: true, pid, local: !!C.local });
            if (!res.ok) { lastErr = await httpError(res, pid); markStatus(pid, false, lastErr.message); if (C.endpoints && (res.status >= 500 || res.status === 404) && u !== urls[urls.length - 1]) { ctx.log('warn', C.name + ': ' + u + ' → ' + res.status + ', trying next endpoint'); continue; } if (res.status === 400 && /stream/i.test(lastErr.body || '') && body.stream) { lastErr.noStream = true; } throw lastErr; }
            const meta = {}; const out = await readSSE(res, onDelta, meta); markStatus(pid, true, (meta.resolved || model) + ' via ' + (res._route || C.route) + (urls.length > 1 ? ' @ ' + new URL(u).host : ''));
            setIdentity(Object.assign(base, { resolvedModel: meta.resolved || model, route: res._route || C.route, gateway: res._gateway || '' }));
            return out;
          } catch (e) { if (e.name === 'AbortError' || e.status) throw e; lastErr = e; markStatus(pid, false, e.message); if (!C.endpoints) throw e; }
        }
        throw lastErr || new Error(C.name + ': all endpoints failed.');
      };
      let out;
      try { out = await go(mode); }
      catch (e) {
        if (e.noStream && C.custom) { C.stream = false; ctx.toast(C.name + ': streaming rejected — retrying without stream.', 'warn'); out = await go(mode); }
        else if (mode === 'native' && e.status === 400 && /tool/i.test(e.body || '')) { toolMode[pid + '/' + model] = 'prompt'; ctx.data.set('toolMode', toolMode); ctx.toast('Model rejected native tools — switched to prompt-based tool calls.', 'warn'); out = await go('prompt'); mode = 'prompt'; }
        else if (ctx.data.get('autoFallback', false) && pid !== 'pollinations' && e.name !== 'AbortError') { ctx.toast(e.message.slice(0, 120) + ' — falling back to Pollinations.', 'warn', 5000); return streamFor('pollinations', { messages, tools, signal, onDelta, temperature }); }
        else throw e;
      }
      /* prompt mode — and native mode when a model wrote the call as text instead of using the API (common with reasoning models) */
      if (tools && tools.length && !out.toolCalls.length && (mode === 'prompt' || /```|<tool_call>|<function|"name"\s*:/.test(out.content || ''))) { const p = parsePromptTools(out.content || '', tools); if (p.calls.length) { out.content = p.clean; out.toolCalls = p.calls; if (mode !== 'prompt') DS.kernel.log('info', 'providers', 'recovered ' + p.calls.length + ' tool call(s) written as text by ' + model); } }
      return out;
    }

    function keyToast(pid, C) { /* key-missing toast with a real "Get free key" link (DS.ui.toast is text-only) */
      try { const host = document.getElementById('toasts'); if (!host || !C.signup) return ctx.toast(C.name + ': no API key — open /model', 'err', 6000);
        const t = DS.util.el('div', { class: 'toast err fp-kt', role: 'alert' }); t.innerHTML = '<span>' + esc(C.name) + ': no API key.</span> <a class="btn sm pri" data-gk="' + esc(pid) + '" href="' + esc(C.signup) + '" target="_blank" rel="noopener">' + ((C.freeTier || C.keyOptional || modelsOf(pid).some(m => m.free)) ? 'Get free key ↗' : 'Get key ↗') + '</a> <button class="btn sm" data-kto>Paste key</button>';
        t.querySelector('[data-kto]').onclick = () => { t.remove(); openPicker({ focus: pid }); }; host.appendChild(t); setTimeout(() => t.remove(), 9000); } catch (_) {} }
    /* ---------- register providers (also used by 61-free-tiers + custom endpoints) ---------- */
    const modelFor = pid => { const C = FP_CAT[pid]; if (!C) return ''; const sl = sel(); return (sl.provider === pid && sl.model) || C.defaultModel || (C.models || [])[0] || (live[pid] && live[pid][0] && live[pid][0].id) || ''; };
    function regProvider(pid, C, owner) {
      owner = owner || ctx; C.models = C.models || []; FP_CAT[pid] = C;
      const d = owner.provider({ id: pid, label: C.name, order: C.order || 20, models: C.models.slice(), route: C.route,
        available: () => FP_CAT[pid] === C && enabled(pid) && (C.keyless || C.keyOptional || !!keys()[pid] || gateway.serverKey(pid)) && (pid !== 'puter' || isOrigin()),
        stream: opts => streamFor(pid, opts) });
      let gone = false; const undo = () => { if (gone) return; gone = true; try { d && d(); } catch (_) {} if (FP_CAT[pid] === C) delete FP_CAT[pid]; ctx.emit('models:change', {}); };
      if (owner !== ctx) owner.effect(() => undo);
      ctx.emit('models:change', {}); return undo;
    }
    Object.keys(FP_CAT).forEach((pid, i) => { FP_CAT[pid].order = 20 + i; regProvider(pid, FP_CAT[pid]); });

    /* ---------- live /models discovery for any OpenAI-compatible provider ---------- */
    async function discover(pid) {
      const C = FP_CAT[pid]; if (!C) throw new Error('unknown provider ' + pid);
      const url = C.discover || (C.base ? C.base.replace(/\/+$/, '') + '/models' : ''); if (!url) throw new Error(C.name + ': no /models endpoint.');
      const k = keys()[pid]; if (!k && !C.keyless && !C.keyOptional && !gateway.serverKey(pid)) throw new Error(C.name + ': paste your key first' + (C.signup ? ' (get one at ' + C.signup + ')' : '') + ' — discovery calls GET ' + url + ' with it.');
      const h = Object.assign({ Accept: 'application/json' }, C.headers || {}); if (k) h.Authorization = 'Bearer ' + k;
      let r; try { r = await gateway.fetch(url, { method: 'GET', headers: h }, { pid, local: !!C.local }); } catch (e) { markStatus(pid, false, e.message); throw e; }
      if (!r.ok) { const e = await httpError(r, pid); markStatus(pid, false, e.message); throw e; }
      const j = await r.json(); const arr = Array.isArray(j) ? j : (j.data || j.models || []);
      live[pid] = arr.map(m => typeof m === 'string' ? { id: m } : { id: String(m.id || m.name || m.model || '').replace(/^models\//, ''), context: m.context_length || m.context_window, owner: m.owned_by }).filter(m => m.id).map(m => Object.assign(m, { label: m.id }));
      verified[pid] = Date.now(); ctx.data.set('verified', verified); ctx.data.set('live', live); markStatus(pid, true, 'discovered ' + live[pid].length + ' models via ' + (r._route || 'direct')); ctx.emit('models:change', {});
      return pid + ':' + live[pid].length;
    }

    /* ---------- custom OpenAI-compatible endpoints ---------- */
    const customs = () => ctx.data.get('custom', []) || []; const customUndo = {};
    function customSpec(c) {
      const base = String(c.base || '').trim().replace(/\/+$/, '').replace(/\/chat\/completions$/, ''); let hd = {};
      if (c.headers) { hd = typeof c.headers === 'string' ? (DS.safeJSON(c.headers) || {}) : c.headers; }
      const local = /^http:\/\/(localhost|127\.|0\.0\.0\.0|\[::1\])/.test(base);
      return { name: c.name || base, base, endpoint: base + '/chat/completions', discover: base + '/models', models: c.defaultModel ? [c.defaultModel] : [], defaultModel: c.defaultModel || '', keyOptional: true, keyless: false, route: local ? 'local' : 'direct', local, tools: c.tools || 'prompt', stream: c.stream !== false, sampling: true, headers: hd, custom: true, tag: 'custom', note: 'Your custom endpoint — unverified until a call succeeds.', verifyByDiscovery: true };
    }
    function addCustom(c) {
      if (!c || !/^https?:\/\//.test(String(c.base || '').trim())) throw new Error('Base URL must start with http:// or https://');
      if (c.headers && typeof c.headers === 'string' && c.headers.trim() && !DS.safeJSON(c.headers)) throw new Error('Headers must be a JSON object, e.g. {"X-Org":"me"}');
      const id = (c.id || String(c.name || 'ep').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'ep').slice(0, 32);
      const rec = { id, name: c.name || id, base: String(c.base).trim(), headers: c.headers || '', defaultModel: c.defaultModel || '', tools: ['native', 'prompt', 'none'].includes(c.tools) ? c.tools : 'prompt', stream: c.stream !== false };
      const L = customs().filter(x => x.id !== id).concat([rec]); ctx.data.set('custom', L);
      if (c.key) setKey('custom:' + id, c.key);
      if (customUndo[id]) customUndo[id](); customUndo[id] = regProvider('custom:' + id, customSpec(rec));
      return 'custom:' + id;
    }
    function removeCustom(id) {
      id = String(id).replace(/^custom:/, ''); ctx.data.set('custom', customs().filter(x => x.id !== id));
      if (customUndo[id]) { customUndo[id](); delete customUndo[id]; } setKey('custom:' + id, '');
      if (sel().provider === 'custom:' + id) select('pollinations', 'openai-fast');
      return true;
    }
    customs().forEach(c => { try { customUndo[c.id] = regProvider('custom:' + c.id, customSpec(c)); } catch (e) { ctx.log('warn', 'custom endpoint ' + c.id + ': ' + e.message); } });

    /* ---------- catalog / select / refresh ---------- */
    function catalog() {
      const out = [];
      for (const pid of Object.keys(FP_CAT)) { const C = FP_CAT[pid]; const unv = C.verifyByDiscovery && !verified[pid]; for (const m of modelsOf(pid)) out.push({ provider: pid, id: m.id, label: m.label || m.id, free: !!(C.keyless || m.free || C.freeTier), freeTier: !!C.freeTier, keyless: !!C.keyless, keyOptional: !!C.keyOptional, route: C.route, fileSafe: C.route === 'direct', context: m.context, note: m.note || C.warn || C.note, tag: unv ? 'unverified' : (m.free ? 'free' : (C.tag || (C.keyless ? 'free' : 'key'))), verified: !unv, custom: !!C.custom, lessFiltered: lfOf(m) || undefined, signup: C.signup || undefined }); }
      out.push({ provider: 'openai', id: (S().models && S().models.executor) || 'deepseek-chat', label: 'DeepSeek (core OpenAI-compatible)', free: false, keyless: false, route: 'direct', fileSafe: true, tag: 'key' });
      out.push({ provider: 'sim', id: 'sim', label: 'Offline Sim', free: true, keyless: true, route: 'sim', fileSafe: true, tag: 'sim' });
      return out;
    }
    function select(provider, model) {
      const s = S();
      if (provider === 'sim' || provider === 'openai') { s.provider = provider; s.forceSim = provider === 'sim'; }
      else if (!FP_CAT[provider] && DS.kernel.list('provider').some(p => p.id === provider)) { s.provider = provider; s.forceSim = false; DS.store.save && DS.store.save(); ctx.emit('models:change', { provider, model: model || '' }); DS.bus.emit('status:refresh'); return identity; }
      else { if (!FP_CAT[provider]) throw new Error('unknown provider ' + provider); model = model || (sel().provider === provider ? sel().model : '') || modelFor(provider); ctx.data.set('sel', { provider, model: model || '' }); if (model) ctx.data.set('recent', [provider + '|' + model].concat(recent().filter(x => x !== provider + '|' + model)).slice(0, 8)); s.provider = provider; s.forceSim = false; const en = ctx.data.get('enabled', {}); if (FP_CAT[provider].off && !en[provider]) { en[provider] = true; ctx.data.set('enabled', en); } }
      DS.store.save && DS.store.save();
      const C = FP_CAT[provider]; const m = C ? (model || sel().model) : (provider === 'sim' ? 'sim' : ((s.models && s.models.executor) || 'deepseek-chat'));
      setIdentity({ provider, providerName: C ? C.name : (provider === 'sim' ? 'Offline Sim' : 'DeepSeek (OpenAI-compatible)'), model: m, requestedModel: m, resolvedModel: m, route: C ? C.route : (provider === 'sim' ? 'sim' : 'direct'), gateway: '', free: C ? !!C.keyless : provider === 'sim', keyless: C ? !!C.keyless : provider === 'sim' });
      ctx.emit('models:change', { provider, model: m }); DS.bus.emit('status:refresh');
      return identity;
    }
    async function refresh(pid) {
      const done = [];
      if (pid && pid !== 'pollinations' && pid !== 'openrouter') { done.push(await discover(pid)); return done; }
      if (!pid || pid === 'pollinations') {
        let r; try { r = await gateway.fetch('https://text.pollinations.ai/models', { method: 'GET', headers: { Accept: 'application/json' } }); if (!r.ok && r.status >= 500) throw await httpError(r, 'pollinations'); }
        catch (e) { if (e.name === 'AbortError') throw e; ctx.log('warn', 'pollinations /models primary failed, trying gen.pollinations.ai (unverified): ' + e.message); r = await gateway.fetch('https://gen.pollinations.ai/v1/models', { method: 'GET', headers: { Accept: 'application/json' } }); }
        if (!r.ok) throw await httpError(r, 'pollinations');
        const j = await r.json(); const arr = Array.isArray(j) ? j : (j.models || j.data || []);
        live.pollinations = arr.map(m => typeof m === 'string' ? { id: m, label: m } : { id: m.name || m.id, label: (m.name || m.id) + (m.description ? ' — ' + m.description : ''), note: m.tools ? 'tools' : '' }).filter(m => m.id); done.push('pollinations:' + live.pollinations.length);
      }
      if (!pid || pid === 'openrouter') {
        const r = await gateway.fetch('https://openrouter.ai/api/v1/models?min_price=0&max_price=0&min_output_price=0&max_output_price=0&limit=1000', { method: 'GET', headers: { Accept: 'application/json' } });
        if (!r.ok) throw await httpError(r, 'openrouter');
        const j = await r.json();
        const free = (j.data || []).filter(m => { const p = m.pricing || {}; return Number(p.prompt || 0) === 0 && Number(p.completion || 0) === 0; });
        live.openrouter = [{ id: 'openrouter/auto', label: 'openrouter/auto (router picks)' }].concat(free.map(m => ({ id: m.id, label: (m.name || m.id) + ' · FREE', free: true, context: m.context_length, note: (m.supported_parameters || []).includes('tools') ? 'tools' : '' })));
        done.push('openrouter free:' + free.length);
      }
      ctx.data.set('live', live); ctx.emit('models:change', {}); return done;
    }

    /* ---------- agent integration: identity block + meta + per-profile model ---------- */
    ctx.hook('beforeModel', pre => {
      const p = DS.providers.pick(); const C = p && FP_CAT[p.id];
      if (C) pre.model = modelFor(p.id);
      const i = C ? Object.assign({}, identity, { provider: p.id, providerName: C.name, requestedModel: pre.model, model: pre.model }) : (p && p.id === 'sim' ? { provider: 'sim', providerName: 'Offline Sim', requestedModel: 'sim', route: 'sim' } : { provider: 'openai', providerName: 'DeepSeek (OpenAI-compatible)', requestedModel: pre.model, route: 'direct' });
      const block = '[RUNTIME_MODEL_IDENTITY]\nprovider=' + i.providerName + ' (' + i.provider + ')\nmodel=' + i.requestedModel + '\nroute=' + (C ? C.route : i.route) + '\nIf asked what model you are, state exactly this provider and model. Never claim to be a different model.';
      if (pre.messages && pre.messages[0] && pre.messages[0].role === 'system' && !/\[RUNTIME_MODEL_IDENTITY\]/.test(pre.messages[0].content)) pre.messages[0].content += '\n\n' + block;
    }, { order: 40 });
    ctx.hook('afterModel', ({ thread }) => {
      try { const m = thread && thread.messages && thread.messages[thread.messages.length - 1]; if (m && m.role === 'assistant' && m.meta) { m.meta.identity = { provider: identity.provider, model: identity.resolvedModel || identity.model, route: identity.route, gateway: identity.gateway }; } } catch (_) {}
    });

    /* ---------- UI ---------- */
    DS.icons.models = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="4" width="16" height="16" rx="3"/><path d="M9 9h6v6H9z"/><path d="M9 1v3M15 1v3M9 20v3M15 20v3M1 9h3M1 15h3M20 9h3M20 15h3"/></svg>';
    ctx.effect(() => { const s = document.createElement('style'); s.textContent = `
.fp-pk{display:flex;flex-direction:column;gap:10px}.fp-pk .fp-top{display:flex;gap:8px}.fp-pk .fp-top .inp{flex:1;min-width:0}
.fp-grp{border:1px solid var(--line);border-radius:var(--radius);background:var(--card);overflow:hidden}
.fp-gh{display:flex;align-items:center;gap:6px;padding:10px 12px;font-weight:600;flex-wrap:wrap}.fp-gh .grow{flex:1}
.fp-m{display:flex;align-items:center;gap:6px;min-height:44px;padding:6px 12px;border-top:1px solid var(--line);cursor:pointer;font-size:13px;word-break:break-all}
.fp-m:hover,.fp-m:focus-visible{background:var(--accent-soft);outline:none}.fp-m.on{background:var(--accent-soft);box-shadow:inset 3px 0 0 var(--accent)}
.fp-b{font-size:10px;font-weight:700;letter-spacing:.04em;padding:2px 6px;border-radius:6px;border:1px solid var(--line-2);color:var(--text-2);white-space:nowrap}
.fp-b.free{color:var(--ok);border-color:var(--ok)}.fp-b.key{color:var(--warn);border-color:var(--warn)}.fp-b.gw{color:var(--violet);border-color:var(--violet)}.fp-b.un{color:var(--danger);border-color:var(--danger)}.fp-b.org{color:var(--accent);border-color:var(--accent-line)}
.fp-kr{display:flex;gap:6px;padding:0 12px 10px}.fp-kr .inp{flex:1;min-width:0}.fp-warn{font-size:12px;color:var(--danger);padding:0 12px 8px}
.fp-ml{max-height:300px;overflow-y:auto;overscroll-behavior:contain}.fp-note{font-size:11.5px;color:var(--muted);padding:0 12px 8px}.fp-note a{color:var(--accent)}
.fp-st{font-size:10.5px;font-family:var(--mono);white-space:nowrap}.fp-st.ok{color:var(--ok)}.fp-st.err{color:var(--danger)}.fp-hl{box-shadow:0 0 0 2px var(--accent)}
.fp-star{background:none;border:0;color:var(--muted);font-size:17px;min-width:36px;min-height:36px;cursor:pointer}.fp-star.on{color:var(--warn)}
.fp-b.lf{color:var(--text-2);border-color:var(--line-2);background:var(--card-2)}.fp-gk{text-decoration:none;white-space:nowrap;display:inline-flex;align-items:center}.fp-lfc{min-height:36px;cursor:pointer}.fp-kt{display:flex;gap:6px;align-items:center;flex-wrap:wrap}.fp-kt a{text-decoration:none}
.fp-chip{display:inline-flex;gap:4px;align-items:center;font-size:11px;color:var(--muted);font-family:var(--mono);margin-top:4px}`; document.head.appendChild(s); return () => s.remove(); });

    const badges = (pid, m) => { const C = FP_CAT[pid]; const b = [];
      if (C.keyless || (m && m.free)) b.push('<span class="fp-b free">FREE</span>'); if (C.freeTier) b.push('<span class="fp-b free" title="free-tier (key required, rate-limited)">FREE TIER</span>'); if (!C.keyless && !C.keyOptional) b.push('<span class="fp-b key">KEY</span>'); if (C.custom) b.push('<span class="fp-b org">CUSTOM</span>');
      if (C.route === 'gateway') b.push('<span class="fp-b gw">GATEWAY</span>'); if (C.route === 'origin') b.push('<span class="fp-b org">ORIGIN</span>'); if (C.route === 'local') b.push('<span class="fp-b">LOCAL</span>');
      if (C.tag === 'unstable') b.push('<span class="fp-b un">UNSTABLE</span>'); if (C.tag === 'unverified') b.push('<span class="fp-b">UNVERIFIED</span>'); return b.join(''); };

    function openPicker(opt) {
      opt = opt || {};
      const root = DS.util.el('div', { class: 'fp-pk' });
      const gi = gateway.info();
      root.innerHTML = '<div class="fp-top"><input class="inp" type="search" placeholder="Search models…" aria-label="Search models"><button class="btn sm" data-a="refresh" title="Refresh Pollinations + OpenRouter free lists">Refresh</button></div><div class="row" style="gap:6px;flex-wrap:wrap"><button class="chip fp-lfc" data-a="lf" aria-pressed="false" title="Show only open-weight / less-filtered models">Open · less filtered</button></div><div class="fp-list"></div>' +
        '<div class="card fp-cust" style="padding:12px"><div class="sec-t">Custom OpenAI-compatible endpoints</div><div data-cl></div>' +
        '<details data-cf><summary class="sm" style="cursor:pointer;min-height:40px;display:flex;align-items:center">+ Add / edit endpoint</summary><div class="col" style="gap:6px;margin-top:6px">' +
        '<input class="inp" data-c="name" placeholder="Name (e.g. My vLLM)"><input class="inp" data-c="base" placeholder="Base URL, e.g. https://host/v1"><input class="inp" type="password" autocomplete="off" data-c="key" placeholder="API key (optional)"><input class="inp mono" data-c="headers" placeholder=\'Extra headers JSON, e.g. {"X-Org":"me"}\'><input class="inp" data-c="defaultModel" placeholder="Default model id">' +
        '<div class="row" style="gap:6px;flex-wrap:wrap"><select class="sel" data-c="tools"><option value="prompt">tools: prompt</option><option value="native">tools: native</option><option value="none">tools: none</option></select><label class="row sm" style="gap:6px"><input type="checkbox" data-c="stream" checked> stream (auto non-stream fallback)</label></div>' +
        '<div class="row" style="gap:6px"><button class="btn sm pri" data-a="cadd">Save endpoint</button></div></div></details></div>' +
        '<div class="card" style="padding:12px"><div class="sec-t">Gateway</div><div class="field"><input class="inp" data-gw placeholder="https://you.vercel.app/api/forge-proxy?url=" value="' + esc(gateway.get()) + '"><div class="hint">Order: direct → same-origin /api/proxy → this URL → local bridge. File:// cannot bypass CORS.</div></div>' +
        '<div class="field"><input class="inp" type="password" autocomplete="off" data-tok placeholder="' + (ctx.data.get('token', '') ? '•••• gateway token saved' : 'Gateway token (x-forge-token, optional)') + '"></div>' +
        '<div class="xs muted" data-gi style="margin-bottom:6px">' + (gi ? 'Health: ' + (gi.ok ? 'ok' : 'unreachable') + (gi.features.length ? ' · features ' + esc(gi.features.join(', ')) : '') + (gi.serverKeys.length ? ' · server keys: ' + esc(gi.serverKeys.join(', ')) : '') : (isOrigin() ? 'Health: not probed yet' : 'Health: n/a on file:// (no same-origin /api)')) + '</div>' +
        '<div class="row" style="gap:6px;flex-wrap:wrap"><button class="btn sm" data-a="gwsave">Save</button><button class="btn sm" data-a="snip">Copy Vercel snippet</button><button class="btn sm" data-a="test">Test connection</button><label class="row sm" style="gap:6px"><input type="checkbox" data-fb ' + (ctx.data.get('autoFallback', false) ? 'checked' : '') + '> Auto-fallback to Pollinations</label><label class="row sm" style="gap:6px" title="Only for providers the gateway lists in serverKeys"><input type="checkbox" data-sk ' + (ctx.data.get('useServerKey', false) ? 'checked' : '') + '> Use server key</label></div><div class="xs muted" data-tst style="margin-top:6px"></div></div>';
      const list = root.querySelector('.fp-list'); const q = root.querySelector('input[type=search]');
      const ago = ts => DS.util.fmtAgo ? DS.util.fmtAgo(ts) : new Date(ts).toLocaleTimeString();
      const row = (pid, m, cur, sp) => { const fk = pid + '|' + m.id; const fav = favs().includes(fk); return '<div class="fp-m' + (sp === pid && cur.provider === pid && cur.model === m.id ? ' on' : '') + '" tabindex="0" role="button" data-sel="' + esc(pid) + '" data-m="' + esc(m.id) + '"><span class="grow">' + esc(m.label || m.id) + '</span>' + (m.free ? '<span class="fp-b free">FREE</span>' : '') + (m.note === 'tools' ? '<span class="fp-b">TOOLS</span>' : '') + (lfOf(m) ? '<span class="fp-b lf" title="Open-weight fine-tune with lighter built-in filtering. Forge adds no jailbreak prompts.">OPEN · LESS FILTERED</span>' : '') + '<button class="fp-star' + (fav ? ' on' : '') + '" data-fav="' + esc(fk) + '" aria-label="' + (fav ? 'Unpin' : 'Pin') + ' ' + esc(m.id) + '" title="Pin to top">' + (fav ? '★' : '☆') + '</button></div>'; };
      const draw = () => {
        const f = q.value.trim().toLowerCase(); const cur = sel(); const sp = S().provider; let h = ''; const lfo = !!root._lf;
        const pr = favs().concat(recent().filter(x => !favs().includes(x))).map(x => { const i = x.indexOf('|'); return { pid: x.slice(0, i), id: x.slice(i + 1) }; }).filter(x => FP_CAT[x.pid] && (!f || (x.pid + ' ' + x.id).toLowerCase().includes(f)) && (!lfo || lfOf(x)));
        if (pr.length) { h += '<div class="fp-grp" data-p="_pin"><div class="fp-gh">★ Pinned &amp; recent</div><div class="fp-ml">'; for (const x of pr) h += row(x.pid, { id: x.id, label: x.pid + ' / ' + x.id + (favs().includes(x.pid + '|' + x.id) ? '' : ' · recent') }, cur, sp); h += '</div></div>'; }
        for (const pid of Object.keys(FP_CAT)) {
          const C = FP_CAT[pid]; const ms = modelsOf(pid).filter(m => (!f || (pid + ' ' + m.id + ' ' + C.name + ' ' + (m.label || '')).toLowerCase().includes(f)) && (!lfo || lfOf(m))); if (lfo && !ms.length) continue; if (f && !ms.length && !(pid + ' ' + C.name).toLowerCase().includes(f)) continue;
          const st = status[pid]; const unv = C.verifyByDiscovery && !verified[pid];
          h += '<div class="fp-grp" data-p="' + esc(pid) + '"><div class="fp-gh">' + esc(C.name) + ' ' + badges(pid) + (unv ? '<span class="fp-b">UNVERIFIED</span>' : '') + '<span class="grow"></span>' + (st ? '<span class="fp-st ' + (st.ok ? 'ok' : 'err') + '" title="' + esc(st.msg) + '">' + (st.ok ? '● ok' : '● err') + ' · ' + esc(ago(st.ts)) + '</span>' : '') + (C.off || pid === 'aicommunity' ? '<label class="xs row" style="gap:4px"><input type="checkbox" data-en="' + esc(pid) + '" ' + (enabled(pid) ? 'checked' : '') + '> on</label>' : '') + '</div>';
          if (C.warn) h += '<div class="fp-warn">⚠ ' + esc(C.warn) + '</div>';
          if (C.note || C.epNote) h += '<div class="fp-note">' + esc([C.freeTier ? 'free-tier (key required, rate-limited)' : '', C.note, C.epNote].filter(Boolean).join(' · ')) + '</div>';
          if (st && !st.ok) h += '<div class="fp-warn xs">' + esc(st.msg) + '</div>';
          if (pid === 'puter' && !isOrigin()) h += '<div class="fp-warn">Needs an http(s) origin — unavailable on file://.</div>';
          if (!C.keyless) h += '<div class="fp-kr"><input class="inp" type="password" autocomplete="off" data-k="' + esc(pid) + '" placeholder="' + esc(keys()[pid] ? '•••• key saved' : (C.keyOptional ? 'API key (optional)' : (C.ph || 'API key'))) + '"><button class="btn sm" data-ks="' + esc(pid) + '">Save key</button>' + (C.signup ? '<a class="btn sm pri fp-gk" data-gk="' + esc(pid) + '" href="' + esc(C.signup) + '" target="_blank" rel="noopener" title="Opens ' + esc(C.signup) + '">' + (C.freeTier || C.keyOptional || modelsOf(pid).some(m => m.free) ? 'Get free key ↗' : 'Get key ↗') + '</a>' : '') + '</div>';
          if (C.base || C.discover) h += '<div class="fp-kr"><input class="inp mono" data-cm="' + esc(pid) + '" placeholder="Custom model id"><button class="btn sm" data-cmu="' + esc(pid) + '">Use</button><button class="btn sm" data-disc="' + esc(pid) + '" title="GET /models">Discover</button>' + (C.custom ? '<button class="btn sm" data-ced="' + esc(pid) + '">Edit</button><button class="btn sm danger" data-crm="' + esc(pid) + '">Remove</button>' : '') + '</div>';
          h += '<div class="fp-ml">'; for (const m of ms.slice(0, f ? 400 : 120)) h += row(pid, m, cur, sp);
          if (!ms.length) h += '<div class="fp-m muted" style="cursor:default">No models listed yet — ' + (C.base || C.discover ? 'Discover (key + network) or type a custom model id.' : 'refresh.') + '</div>';
          if (!f && ms.length > 120) h += '<div class="fp-m muted">+' + (ms.length - 120) + ' more — search to filter</div>';
          h += '</div></div>';
        }
        { const extra = (DS.kernel.list('provider') || []).filter(p => !FP_CAT[p.id] && !['openai', 'sim'].includes(p.id) && !String(p.id).startsWith('custom:') && (!f || ((p.label || p.id) + ' ' + p.id).toLowerCase().includes(f)));
          if (extra.length) { h += '<div class="fp-grp"><div class="fp-gh">On-device &amp; plugin providers</div>'; for (const p of extra) { let av = true; try { av = !p.available || !!p.available(); } catch (_) { av = false; } h += '<div class="fp-m' + (sp === p.id ? ' on' : '') + '" tabindex="0" role="button" data-sel="' + esc(p.id) + '">' + esc(p.label || p.id) + '<span class="grow"></span>' + (p.id === 'auto' ? '<span class="fp-b free">AUTO</span>' : '<span class="fp-b">' + esc((p.route || 'local').toUpperCase()) + '</span>') + (av ? '' : '<span class="fp-b un">NOT READY</span>') + '</div>'; } h += '</div>'; } }
        h += '<div class="fp-grp"><div class="fp-gh">Core</div><div class="fp-m' + (sp === 'openai' ? ' on' : '') + '" tabindex="0" role="button" data-sel="openai">DeepSeek (Settings → Model key)<span class="grow"></span><span class="fp-b key">KEY</span></div><div class="fp-m' + (S().forceSim || sp === 'sim' ? ' on' : '') + '" tabindex="0" role="button" data-sel="sim">Offline Sim<span class="grow"></span><span class="fp-b">SIM</span></div></div>';
        list.innerHTML = h;
        const cl = root.querySelector('[data-cl]'); const L = customs();
        cl.innerHTML = L.length ? L.map(c => '<div class="kv"><span>' + esc(c.name) + '</span><b class="mono xs">' + esc(c.base) + '</b></div>').join('') : '<div class="xs muted">None yet. Any server speaking POST /chat/completions works (vLLM, LiteLLM, Ollama, LM Studio…).</div>';
      };
      const cf = n => root.querySelector('[data-c="' + n + '"]');
      q.addEventListener('input', DS.util.debounce ? DS.util.debounce(draw, 120) : draw);
      const tst = root.querySelector('[data-tst]');
      root.addEventListener('keydown', e => { if ((e.key === 'Enter' || e.key === ' ') && e.target.dataset && e.target.dataset.sel) { e.preventDefault(); e.target.click(); } });
      root.addEventListener('click', async e => {
        const t = e.target.closest('[data-fav],[data-sel],[data-ks],[data-a],[data-en],[data-disc],[data-cmu],[data-crm],[data-ced]'); if (!t) return;
        if (t.dataset.fav) { e.stopPropagation(); const F = favs(); const i = F.indexOf(t.dataset.fav); if (i >= 0) F.splice(i, 1); else F.unshift(t.dataset.fav); ctx.data.set('favs', F); draw(); return; }
        if (t.dataset.en) { const en = ctx.data.get('enabled', {}); en[t.dataset.en] = t.checked; ctx.data.set('enabled', en); return; }
        if (t.dataset.sel) { select(t.dataset.sel, t.dataset.m); ctx.toast('Model: ' + t.dataset.sel + (t.dataset.m ? '/' + t.dataset.m : ''), 'ok'); draw(); return; }
        if (t.dataset.ks) { const inp = root.querySelector('[data-k="' + t.dataset.ks + '"]'); setKey(t.dataset.ks, inp.value); inp.value = ''; draw(); ctx.toast('Key saved for ' + t.dataset.ks, 'ok'); return; }
        if (t.dataset.cmu) { const v = root.querySelector('[data-cm="' + t.dataset.cmu + '"]').value.trim(); if (!v) return ctx.toast('Type a model id first', 'warn'); select(t.dataset.cmu, v); ctx.toast('Model: ' + t.dataset.cmu + '/' + v + ' (unverified until a call succeeds)', 'ok'); draw(); return; }
        if (t.dataset.disc) { const pid = t.dataset.disc; t.disabled = true; t.textContent = '…'; try { const r = await discover(pid); ctx.toast('Discovered ' + r, 'ok'); } catch (err) { ctx.toast(err.message.slice(0, 240), 'err', 8000); } draw(); return; }
        if (t.dataset.crm) { if (DS.ui.confirm && !(await DS.ui.confirm('Remove ' + FP_CAT[t.dataset.crm].name + '?', 'Remove'))) return; removeCustom(t.dataset.crm); ctx.toast('Endpoint removed', 'ok'); draw(); return; }
        if (t.dataset.ced) { const c = customs().find(x => 'custom:' + x.id === t.dataset.ced); if (c) { cf('name').value = c.name; cf('base').value = c.base; cf('headers').value = typeof c.headers === 'string' ? c.headers : JSON.stringify(c.headers || {}); cf('defaultModel').value = c.defaultModel || ''; cf('tools').value = c.tools; cf('stream').checked = c.stream !== false; cf('name').dataset.id = c.id; root.querySelector('[data-cf]').open = true; cf('name').focus(); } return; }
        const a = t.dataset.a;
        if (a === 'cadd') { try { const id = addCustom({ id: cf('name').dataset.id || undefined, name: cf('name').value.trim(), base: cf('base').value.trim(), key: cf('key').value.trim(), headers: cf('headers').value.trim(), defaultModel: cf('defaultModel').value.trim(), tools: cf('tools').value, stream: cf('stream').checked }); ['name', 'base', 'key', 'headers', 'defaultModel'].forEach(n => { cf(n).value = ''; }); delete cf('name').dataset.id; ctx.toast('Endpoint saved: ' + id, 'ok'); draw(); } catch (err) { ctx.toast(err.message, 'err', 6000); } return; }
        if (a === 'lf') { root._lf = !root._lf; t.classList.toggle('acc', root._lf); t.setAttribute('aria-pressed', String(root._lf)); draw(); return; }
        if (a === 'refresh') { t.disabled = true; t.textContent = '…'; try { const r = await refresh(); ctx.toast('Refreshed ' + r.join(', '), 'ok'); } catch (err) { ctx.toast(err.message.slice(0, 220), 'err', 7000); } t.disabled = false; t.textContent = 'Refresh'; draw(); }
        if (a === 'gwsave') { gateway.set(root.querySelector('[data-gw]').value); ctx.data.set('autoFallback', root.querySelector('[data-fb]').checked); ctx.data.set('useServerKey', root.querySelector('[data-sk]').checked); const tk = root.querySelector('[data-tok]').value.trim(); if (tk) ctx.data.set('token', tk); root.querySelector('[data-tok]').value = ''; healthProbe = null; gateway.sameOrigin().then(() => { const g = gateway.info(); const el = root.querySelector('[data-gi]'); if (g && el) el.textContent = 'Health: ' + (g.ok ? 'ok' : 'unreachable') + (g.serverKeys.length ? ' · server keys: ' + g.serverKeys.join(', ') : ''); }); ctx.toast('Gateway saved', 'ok'); }
        if (a === 'snip') { DS.util.copy(gateway.snippet()); ctx.toast('Vercel edge proxy copied', 'ok'); }
        if (a === 'test') { tst.textContent = 'Testing ' + identity.provider + '…'; try { const r = await testConnection(); tst.textContent = '✓ ' + r; } catch (err) { tst.textContent = '✗ ' + err.message; } draw(); }
      });
      draw();
      DS.ui.sheet({ title: 'Models', node: root, full: true });
      if (opt.focus) setTimeout(() => { const g = root.querySelector('.fp-grp[data-p="' + opt.focus + '"]'); if (g) { g.scrollIntoView({ block: 'start' }); g.classList.add('fp-hl'); const k = g.querySelector('[data-k]'); k && k.focus(); } }, 60);
      if (opt.custom) setTimeout(() => { const d = root.querySelector('[data-cf]'); d.open = true; d.scrollIntoView({ block: 'start' }); cf('name').focus(); }, 60);
      return root;
    }
    async function testConnection() {
      const sp = S().provider; const pid = FP_CAT[sp] ? sp : 'pollinations'; let txt = '';
      const r = await streamFor(pid, { messages: [{ role: 'system', content: 'Reply with the single word: pong' }, { role: 'user', content: 'ping' }], tools: [], onDelta: d => { if (d.content) txt += d.content; } });
      return identity.providerName + ' / ' + identity.resolvedModel + ' via ' + identity.route + ': ' + (r.content || txt).slice(0, 60);
    }
    function setKey(pid, key) { const k = keys(); if (key) k[pid] = String(key).trim(); else delete k[pid]; ctx.data.set('keys', k); ctx.emit('models:change', {}); }

    ctx.provide('forge.models', { identity: () => Object.assign({}, identity), catalog, select, refresh, discover, setKey, hasKey: pid => !!keys()[pid], openPicker, identityAnswer: () => identityAnswer(), wantsIdentity, status: () => JSON.parse(JSON.stringify(status)), favs, recent, custom: { list: () => customs().map(c => Object.assign({}, c)), add: addCustom, remove: removeCustom } });
    ctx.provide('forge.providers.core', { register: (pid, spec, owner) => regProvider(pid, spec, owner), discover, streamFor, readSSE, gateway: { fetch: (u, i, o) => gateway.fetch(u, i, o || {}), info: () => gateway.info() }, hasKey: pid => !!keys()[pid], setKey, select, openPicker, catalog, markStatus, has: pid => !!FP_CAT[pid], spec: pid => FP_CAT[pid] ? Object.assign({}, FP_CAT[pid], { models: modelsOf(pid) }) : null, ids: () => Object.keys(FP_CAT), lessFiltered: m => lfOf(typeof m === 'string' ? { id: m } : m), hasModel: pid => !!modelFor(pid) });

    const curLabel = () => { const sp = S().forceSim ? 'sim' : S().provider; return FP_CAT[sp] ? sp + '/' + sel().model : (sp === 'openai' ? 'deepseek/' + ((S().models && S().models.executor) || 'deepseek-chat') : 'sim'); };
    ctx.status({ id: 'fp-model', align: 'right', text: () => '⬡ ' + curLabel(), onClick: openPicker });
    ctx.command({ name: 'model', args: '[provider[/model]]', desc: 'Pick a model / provider', run(arg, c) {
      arg = (arg || '').trim(); if (!arg) return openPicker();
      if (arg === 'id' || arg === 'identity') return c.reply(identityAnswer());
      const [p, ...rest] = arg.split('/'); try { select(p, rest.join('/') || undefined); c.reply('Switched to **' + curLabel() + '** (route `' + identity.route + '`).'); } catch (e) { c.reply('Unknown provider `' + p + '`. Known: ' + Object.keys(FP_CAT).concat(['openai', 'sim']).join(', ')); }
    } });
    ctx.composerAction({ id: 'fp-switch', icon: 'models', label: 'Switch model', desc: curLabel(), run: () => openPicker() });
    if (ctx.rail) ctx.rail({ id: 'models', icon: 'models', label: 'Models', group: 'bottom', order: 50, run: openPicker });
    ctx.messageAction({ id: 'fp-ident', icon: 'models', label: 'Model info', when: m => m.role === 'assistant' && m.meta && (m.meta.identity || m.meta.provider), run(m, c) { const i = m.meta.identity || { provider: m.meta.provider, model: m.meta.model, route: m.meta.provider === 'sim' ? 'sim' : '?' }; c.toast(i.provider + '/' + i.model + ' · ' + i.route + (i.gateway ? ' · ' + i.gateway : ''), 'info', 5000); } });
    ctx.settings({ id: 'fp-settings', title: 'Model providers', render(el) {
      el.innerHTML = '<div class="kv"><span>Active</span><b class="mono">' + esc(curLabel()) + '</b></div><div class="kv"><span>Route</span><b>' + esc(identity.route) + '</b></div><div class="kv"><span>Gateway</span><b class="mono">' + esc(gateway.get() || '(none)') + '</b></div><div class="kv"><span>Keys saved</span><b>' + esc(Object.keys(keys()).join(', ') || 'none') + '</b></div><div class="row" style="gap:6px;margin-top:8px"><button class="btn sm pri">Open model picker</button></div>';
      el.querySelector('button').onclick = openPicker;
    } });

    /* ---------- Sim intents ---------- */
    ctx.intent({ id: 'fp-whoami', order: 50, match: t => wantsIdentity(t), script: () => [{ final: () => identityAnswer() }] });
    ctx.intent({ id: 'fp-switch', order: 50, match: t => /\b(switch|use|change)\b.*\b(to\s+)?(pollinations|openrouter|nvidia|puter|g4f|venice)\b/i.test(t), script: t => { const p = t.match(/(pollinations|openrouter|nvidia|puter|g4f|venice)/i)[1].toLowerCase(); return [{ final: () => { try { select(p); return 'Switched the router to **' + curLabel() + '** (route `' + FP_CAT[p].route + '`' + (FP_CAT[p].keyless ? ', no key needed' : ', needs a key — open `/model`') + '). Your next message goes there' + (FP_CAT[p].keyless || keys()[p] ? '.' : ' once a key is saved; until then Forge stays on the Sim.'); } catch (e) { return e.message; } } }]; } });
    ctx.intent({ id: 'fp-refresh', order: 50, match: t => /\brefresh\b.*\b(free )?models?\b/i.test(t), script: () => [{ say: 'Refreshing Pollinations and OpenRouter free model lists…\n\n' }, { final: () => 'Started a refresh — results appear in the Model picker (`/model`). Offline, this will report a clear network error rather than fake models.' }] });
    const ALIAS = { gemini: 'gemini', google: 'gemini', 'ai studio': 'gemini', hf: 'huggingface', 'hugging face': 'huggingface', huggingface: 'huggingface', github: 'github', 'lm studio': 'lmstudio', lmstudio: 'lmstudio', 'llama.cpp': 'llamacpp', llamacpp: 'llamacpp', llamafile: 'llamacpp', grok: 'xai', xai: 'xai' };
    const findPid = t => { t = String(t || '').toLowerCase(); for (const [k, v] of Object.entries(ALIAS)) if (t.includes(k) && FP_CAT[v]) return v; return Object.keys(FP_CAT).find(p => new RegExp('\\b' + p.replace(/[^a-z0-9]/g, '.') + '\\b').test(t)) || ''; };
    ctx.intent({ id: 'fp-addprov', order: 45, match: t => /\b(add|connect|set ?up|configure)\b.{0,20}\b(provider|key|endpoint|api)\b/i.test(t) || /\badd (provider|key)\b/i.test(t), script: t => [{ final: () => {
      if (/custom|endpoint|openai.compatible|own server/i.test(t) && !findPid(t)) { openPicker({ custom: true }); return 'Opened **Models → Custom endpoints**. Enter a name, base URL (…/v1), optional key/headers and a default model; it then appears as `custom:<id>` in the picker.'; }
      const pid = findPid(t); if (!pid) { openPicker(); return 'Opened the Model picker. Known providers: ' + Object.keys(FP_CAT).join(', ') + '.'; }
      const C = FP_CAT[pid]; openPicker({ focus: pid });
      return 'Opened **' + C.name + '** in the Model picker. ' + (C.keyless ? 'No key needed' + (C.local ? ' — it must be running locally (Discover checks /models).' : '.') : 'Paste your key' + (C.signup ? ' (from ' + C.signup + ')' : '') + ', then tap **Discover** to load the live model list (or type a custom model id).') + (C.freeTier ? ' Free tier: key required, rate-limited.' : '') + ' Status stays `unverified` until a call succeeds.'; } }] });
    ctx.suggest && ctx.suggest({ id: 'fp-sug', emoji: '⬡', title: 'What model are you?', sub: 'Exact runtime model identity', prompt: 'What model are you?' });
    // kick refresh for the refresh intent in background when matched
    ctx.hook('user:message', ({ text }) => { if (/\brefresh\b.*\bmodels?\b/i.test(text || '')) refresh().then(r => ctx.toast('Refreshed ' + r.join(', '), 'ok')).catch(e => ctx.toast(e.message.slice(0, 200), 'err', 6000)); });

    /* initial identity */
    const sp = S().forceSim ? 'sim' : S().provider; if (FP_CAT[sp]) setIdentity({ provider: sp, providerName: FP_CAT[sp].name, model: sel().model, requestedModel: sel().model, resolvedModel: sel().model, route: FP_CAT[sp].route, free: !!FP_CAT[sp].keyless, keyless: !!FP_CAT[sp].keyless });
  }
});
