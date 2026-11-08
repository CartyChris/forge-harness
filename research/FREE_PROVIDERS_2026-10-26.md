# Free Providers Research (R2) 2026-10-26

## Batch 1 (t~60s)
### A) Keyless
- LLM7.io [U] (freellm.net third-party): base https://api.llm7.io/v1 ; anonymous 30 RPM, token (token.llm7.io) 120 RPM (page also says 60 RPM/250 req/hr - inconsistent). Model ids listed there: deepseek-v4-pro, glm-5.2, minimax-m3, minimax-m2.7, gemma4:31b, mistral-Nemo-Instruct-2407, codestral-latest, gpt-oss:20b, nemotron-3-nano:30b. /models not confirmed. CORS unknown.
- Hack Club AI [V] docs.ai.hackclub.com: NOT keyless anymore. base https://ai.hackclub.com/proxy/v1 , /chat/completions, Bearer key from https://ai.hackclub.com/dashboard ; "Free AI APIs for teens" (eligibility = teens/Hack Club). Example model qwen/qwen3-32b. -> belongs in C (teen-only).
### B) In-browser
- Chrome Prompt API [V] developer.chrome.com/docs/ai/prompt-api: global `LanguageModel`. availability(opts) -> 'unavailable'|'downloadable'|'downloading'|'available' (page shows unavailable/downloading). create({signal, initialPrompts:[{role,content}], expectedInputs:[{type:'text'|'image'|'audio',languages}], expectedOutputs:[{type:'text',languages}], monitor(m){m.addEventListener('downloadprogress',e=>e.loaded)}}) needs user activation for download. session.prompt(input,{signal,responseConstraint:JSONSchema}), session.promptStreaming() -> ReadableStream, append(), clone(), destroy(), contextUsage/contextWindow, measureContextUsage(). Web pages: Chrome 148 stable; extensions Chrome 138. topK/temperature extension-only; web has samplingMode only via origin trial. Desktop only (Win10/11, macOS13+, Linux, ChromeOS Plus) - NOT Android/iOS. 22GB free disk, >4GB VRAM or 16GB RAM+4 cores. Not in Workers. Languages en/ja/es/de/fr.
- wllama [V] unpkg @wllama/wllama@3.6.1 README: `new Wllama(CONFIG_PATHS|WasmFromCDN)` (import WasmFromCDN from '@wllama/wllama/esm/wasm-from-cdn.js'); loadModelFromHF({repo,file},{progressCallback}); loadModelFromUrl for non-HF; createChatCompletion({messages,max_tokens,temperature,top_k,top_p}) -> choices[0].message.content. v3.1+ auto WebGPU, n_gpu_layers:0 disables (CPU wasm fallback); setCompat('default','firefox_safari'). Multi-thread needs COOP/COEP headers (file:// & iOS -> single thread, n_threads:1). 2GB/file limit, split <=512MB chunks via llama-gguf-split. Q4-Q6 recommended.
### D)
- OpenRouter ids seen in search [U]: cognitivecomputations/dolphin-mistral-24b-venice-edition:free ; venice/uncensored:free (pages exist on openrouter.ai)
## Batch 2 (t~100s)
- OVHcloud AI Endpoints [V] docs.ovhcloud.com .../ai-endpoints-capabilities: anonymous tier 2 req/min per IP per model; with key 400 req/min per project per model; 429 on exceed. Base URL / CORS not on that page (prior knowledge oai.endpoints.kepler.ai.cloud.ovh.net/v1 NOT verified here). Too slow for primary use; OK as last-resort keyless fallback.
- mlvoca: no primary page found in search - skip/unverified.
- OpenRouter [V] openrouter.ai/venice/uncensored:free resolves to id `cognitivecomputations/dolphin-mistral-24b-venice-edition:free` (developer dphn.ai + Venice.ai), marked Free; context 33K (page also shows 128K). Alias venice/uncensored:free appears to redirect.
- Nous Portal: Cline docs give no base URL/ids [U]. Hermes 4 70B/405B listed on llmreference.com [U].
## Batch 3 (t~140s)
- Cloudflare Workers AI [U] (cheahjs free-llm-api-resources mirror): 10,000 neurons/day free. REST https://api.cloudflare.com/client/v4/accounts/{ACCOUNT_ID}/ai/run/{model}; Bearer CF API token (Workers AI perm). Ids: @cf/meta/llama-3.3-70b-instruct-fp8, @cf/openai/gpt-oss-120b, @cf/qwen/qwen3-30b-a3b-fp8. (OpenAI-compatible path .../ai/v1/chat/completions exists per CF docs from prior knowledge - NOT verified this run.) Browser CORS on api.cloudflare.com likely blocked -> needs a Worker proxy.
- Nous Portal [U] free-llm.com: base https://inference-api.nousresearch.com/v1 ; signup https://portal.nousresearch.com ; $0 plan, no credits, daily quota on free models only; Hermes-4-70B "No Longer Free"; user report: $0 Stripe checkout needed for key.
- Chutes: docs at https://www.chutes.ai/docs/guides/starter-guide (not fetched). Model ids seen on TypingMind [U]: zai-org/GLM-4.6-FP8, zai-org/GLM-5.2-TEE, tngtech/DeepSeek-R1T-Chimera, openai/gpt-oss-20b, google/gemma-4-31B-turbo-TEE.
- Venice: model `venice-uncensored` (TypingMind lists "venice uncensored 1.2") [U]; docs.venice.ai/api-reference/api-spec.
## Batch 4 (t~150s)
- Chutes [V] chutes.ai/docs/guides/starter-guide: base https://llm.chutes.ai/v1 , /chat/completions, /v1/models lists catalog; key cpk_... Bearer. NO free tier on page: PAYG, Plus $10/mo daily quota, Pro $20/mo. -> not free; drop from A/C.
- Transformers.js [V] HF blog v3: npm @huggingface/transformers (CDN jsDelivr @3.x); pipeline('text-generation','onnx-community/Qwen2.5-0.5B-Instruct',{device:'webgpu',dtype:'q4'}). TextStreamer not on that page (exists in lib, prior knowledge). Fallback device 'wasm' when no WebGPU.
- Venice API [V] docs.venice.ai api-spec: base https://api.venice.ai/api/v1 ; GET /models works WITHOUT key; Bearer INFERENCE key for chat; CORS: "accepts cross-origin browser requests from any origin" (docs warn not to embed key). Uncensored id: venice-uncensored-1-2. Free tier limits not stated on spec page.
- Z.ai GLM Flash [U]: freellm.net has page "glm-4-5-flash-retirement-announced"; blog mentions GLM-4.7-Flash free. Not verified on primary page.
## Batch 5 (t~175s)
- Z.ai [U] free-llm.com (Oct 2026): base https://api.z.ai/api/paas/v4 (OpenAI-compat), free ids glm-4.7-flash, glm-4.5-flash (128K), glm-4.6v-flash (vision); ~1 rps, ~1000 req/day; key via z.ai profile > API Keys; GLM-5.2 paid. Check docs.z.ai.
- OpenRouter Hermes [U]: nousresearch/hermes-3-llama-3.1-405b:free (openrouter.ai/models page exists).
- LLM7: GitHub repo chigwell/llm7.io exists; langchain-llm7 package (npm/pypi) [U].
- Vercel AI Gateway: pricing at https://vercel.com/docs/ai-gateway/pricing (fetching next).
## Batch 6 (t~200s) - final
- Vercel AI Gateway [V] vercel.com/docs/ai-gateway/pricing (updated 2026-09-08): every team gets a monthly free credit (amount NOT stated on page) starting at first request; free tier = subset of models (/ai-gateway/models?freeTier=true), lower per-model rate limits (429); buying credits ends the monthly free credit; BYOK paid tier only.
- OpenRouter [V] nousresearch/hermes-3-llama-3.1-405b:free - Free, 131K ctx, no deprecation notice.
- LLM7 [U] gittrend (repo chigwell/llm7.io): says token required, free token at https://dash.llm7.io ; conflicts with freellm.net "anonymous 30 RPM". Treat as: try keyless, fall back to free token. CORS unverified -> probe at runtime.

## BEST PICKS
A keyless: LLM7.io (api.llm7.io/v1, maybe anon 30 RPM, else free token) [U]; OVHcloud AI Endpoints anon 2 RPM/IP/model [V] (fallback only). Hack Club AI now needs key (teens) [V]; Chutes not free [V]; mlvoca unverified.
B in-browser: Chrome LanguageModel (Chrome 148 web, desktop only, not iOS) [V]; wllama 3.6.1 (WASM CPU w/ n_gpu_layers:0, single-thread on file://) [V]; Transformers.js onnx-community/Qwen2.5-0.5B-Instruct q4 webgpu/wasm [V].
C free-key: Z.ai glm-4.7-flash/glm-4.5-flash @ api.z.ai/api/paas/v4 ~1000/day [U]; Vercel AI Gateway monthly free credit [V]; Cloudflare Workers AI 10k neurons/day [U] (needs proxy); Nous Portal inference-api.nousresearch.com/v1 free-model daily quota [U]; Hack Club AI (teens) [V].
D less-restricted: OpenRouter cognitivecomputations/dolphin-mistral-24b-venice-edition:free [V], nousresearch/hermes-3-llama-3.1-405b:free [V]; Venice API venice-uncensored-1-2, CORS any-origin, /models keyless [V] (free limits not stated).
