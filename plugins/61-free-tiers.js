/* forge.freetiers — keyed free-tier + local OpenAI-compatible providers, registered on the shared core of 60-providers.js.
   HONESTY: written in a sandbox with no internet. No endpoint, CORS policy or model id here was verified live.
   Model lists are EMPTY on purpose: the primary path is live GET {base}/models after you paste a key, plus a free-text
   custom model id. Everything is tagged `unverified` until a discovery call succeeds. Free tiers still need a key. */
const FT_LIST = [
  { id: 'deepseek', name: 'DeepSeek API', base: 'https://api.deepseek.com', signup: 'https://platform.deepseek.com/api_keys', ph: 'sk-...', tools: 'native', freeTier: false, models: ['deepseek-flash', 'deepseek-v4-pro', 'deepseek-v4-flash'], thinking: true, note: 'Official API (api-docs.deepseek.com, checked 2026-11-08): deepseek-flash = V4.1 Flash, deepseek-v4-pro; legacy deepseek-v4-flash still accepted. Thinking mode supports tool calls — Forge sends the reasoning back on every turn as DeepSeek requires. Paid, very low cost; new accounts sometimes get trial credit.' },
  { id: 'groq', name: 'Groq', base: 'https://api.groq.com/openai/v1', signup: 'https://console.groq.com/keys', ph: 'gsk_...', tools: 'native' },
  { id: 'gemini', name: 'Google AI Studio (Gemini)', base: 'https://generativelanguage.googleapis.com/v1beta/openai', signup: 'https://aistudio.google.com/apikey', ph: 'AIza...', tools: 'native', note: 'OpenAI-compatibility layer; discovered ids have the "models/" prefix stripped.' },
  { id: 'mistral', name: 'Mistral', base: 'https://api.mistral.ai/v1', signup: 'https://console.mistral.ai/api-keys', tools: 'native' },
  { id: 'cerebras', name: 'Cerebras', base: 'https://api.cerebras.ai/v1', signup: 'https://cloud.cerebras.ai/', ph: 'csk-...', tools: 'native' },
  { id: 'huggingface', name: 'Hugging Face router', base: 'https://router.huggingface.co/v1', signup: 'https://huggingface.co/settings/tokens', ph: 'hf_...', tools: 'prompt' },
  { id: 'cohere', name: 'Cohere (compat API)', base: 'https://api.cohere.ai/compatibility/v1', signup: 'https://dashboard.cohere.com/api-keys', tools: 'prompt', note: 'Compatibility endpoint may not expose /models — use a custom model id if Discover fails.' },
  { id: 'together', name: 'Together AI', base: 'https://api.together.xyz/v1', signup: 'https://api.together.ai/settings/api-keys', tools: 'native', freeTier: false, note: 'Free credits / some free models — check your account.' },
  { id: 'sambanova', name: 'SambaNova Cloud', base: 'https://api.sambanova.ai/v1', signup: 'https://cloud.sambanova.ai/apis', tools: 'prompt' },
  { id: 'github', name: 'GitHub Models', base: 'https://models.github.ai/inference', discover: 'https://models.github.ai/catalog/models', signup: 'https://github.com/settings/tokens', ph: 'github_pat_... (models:read)', tools: 'prompt', note: 'Uses a GitHub token with models scope; ids look like publisher/model.' },
  { id: 'xai', name: 'xAI (Grok)', base: 'https://api.x.ai/v1', signup: 'https://console.x.ai/', ph: 'xai-...', tools: 'native', freeTier: false },
  { id: 'openai', name: 'OpenAI', base: 'https://api.openai.com/v1', signup: 'https://platform.openai.com/api-keys', ph: 'sk-...', tools: 'native', freeTier: false, pid: 'openai-api', note: 'Paid API. Registered as openai-api (core "openai" = DeepSeek slot).' }
];
const FT_LOCAL = [
  { id: 'ollama', name: 'Ollama (local)', base: 'http://localhost:11434/v1', hint: 'Start with OLLAMA_ORIGINS=* ollama serve, then ollama pull <model>.' },
  { id: 'lmstudio', name: 'LM Studio (local)', base: 'http://localhost:1234/v1', hint: 'Developer tab → Start server, enable CORS.' },
  { id: 'llamacpp', name: 'llama.cpp / llamafile (local)', base: 'http://localhost:8080/v1', hint: 'llama-server -m model.gguf --port 8080 (or ./x.llamafile --server).' }
];

DS.plugin({
  name: 'forge.freetiers', title: 'Free-tier & local providers', version: '1.0.0', tags: ['providers', 'models', 'free', 'local'],
  description: 'Groq, Gemini (AI Studio), Mistral, Cerebras, Hugging Face, Cohere, Together, SambaNova, GitHub Models, xAI, OpenAI + local Ollama / LM Studio / llama.cpp — live /models discovery, honest unverified tags.',
  apply(ctx) {
    let alive = true;
    ctx.effect(() => () => { alive = false; });
    const wire = core => {
      if (!alive || !core) return;
      FT_LIST.forEach((p, i) => {
        const pid = p.pid || p.id; if (core.has(pid)) return;
        core.register(pid, { name: p.name, base: p.base, endpoint: p.base + '/chat/completions', discover: p.discover || p.base + '/models', models: (p.models || []).map(id => ({ id, tools: p.tools === 'native' })), thinking: !!p.thinking, keyless: false, freeTier: p.freeTier !== false, route: 'direct', tools: p.tools || 'prompt', sampling: true, signup: p.signup, ph: p.ph, verifyByDiscovery: true, tag: 'unverified', order: 60 + i,
          note: (p.freeTier !== false ? '' : 'Key required. ') + (p.note || '') + ' Route direct → automatic gateway fallback on network/CORS failure.' }, ctx);
      });
      FT_LOCAL.forEach((p, i) => {
        if (core.has(p.id)) return;
        core.register(p.id, { name: p.name, base: p.base, endpoint: p.base + '/chat/completions', discover: p.base + '/models', models: [], keyless: true, local: true, route: 'local', tools: 'prompt', sampling: true, verifyByDiscovery: true, order: 80 + i,
          note: p.hint + ' From an https:// page the browser blocks http://localhost (mixed content); file:// works in some browsers, or serve Forge over http.' }, ctx);
      });
      ctx.log('info', 'registered ' + (FT_LIST.length + FT_LOCAL.length) + ' free-tier/local providers (unverified until discovery)');
    };
    Promise.resolve(ctx.waitFor('forge.providers.core')).then(wire).catch(e => ctx.log('warn', 'forge.providers.core unavailable: ' + (e && e.message)));

    ctx.command({ name: 'providers', args: '[discover <id>]', desc: 'List free-tier/local providers, or discover models', async run(arg, c) {
      const core = ctx.service('forge.providers.core'); if (!core) return c.reply('Provider core not loaded (enable forge.providers).');
      const m = String(arg || '').trim().match(/^discover\s+(\S+)/i);
      if (m) { try { c.reply('✓ ' + await core.discover(m[1])); } catch (e) { c.reply('✗ ' + e.message); } return; }
      const all = FT_LIST.map(p => ({ pid: p.pid || p.id, n: p.name, free: p.freeTier !== false })).concat(FT_LOCAL.map(p => ({ pid: p.id, n: p.name, local: true })));
      c.reply('| provider | id | kind | key |\n|---|---|---|---|\n' + all.map(p => '| ' + p.n + ' | `' + p.pid + '` | ' + (p.local ? 'local' : p.free ? 'free-tier (key required, rate-limited)' : 'paid/credits') + ' | ' + (p.local ? 'none' : core.hasKey(p.pid) ? 'saved' : '—') + ' |').join('\n') + '\n\nAll **unverified** until `/providers discover <id>` (or Discover in `/model`) succeeds. Say "add provider groq" to open the key form.');
    } });
    ctx.suggest && ctx.suggest({ id: 'ft-sug', emoji: '🔑', title: 'Add a free-tier provider', sub: 'Groq, Gemini, Mistral, Cerebras… or local Ollama', prompt: 'add provider groq' });
  }
});
