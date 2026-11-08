# Forge Ultimate — merge changelog

Merged: your DeepSeek-Harness-Forge-Ultimate (ATT) + our plugin-kernel Forge harness → one file, `ds-forge.html` (~780 KB, no build step, no external `<script src>`; CDN libs load lazily and only on demand).

## Architecture
- Our Cordis-style kernel (26 contribution points, services, plugins-for-everything) is the base; every ATT feature was ported as a plugin or shell change — duplicate drawer/sidebar/listener systems removed.
- One drawer system, always-visible 56px left rail, bottom nav removed. The five Forge icons (Themes, Steering, GPU, Bridge, Liquid) live in the rail; composer is never covered; no blur/click-trap overlay.
- Storage: IndexedDB → localStorage → memory, with a "Storage volatile" bar when blocked. Safe-mode survives blocked localStorage (`window.name` fallback).

## Providers / models
- Model Identity runtime object (`forge.models.identity`): every reply carries provider/model/route/gateway; "what model are you?" is answered deterministically from it and shown as a chip.
- Pollinations Direct (`openai-fast`), OpenRouter selector + refresh with free models labelled, Puter (http(s) only), uncloseai, OrcaRouter, Venice, MegaNova, NVIDIA, g4f-style and others from ATT — all 11 ATT providers / 52 models verified present by `att_parity`.
- New: Groq, Gemini, Mistral, Cerebras, HF router, Cohere, Together, SambaNova, GitHub Models, xAI, OpenAI, local Ollama / LM Studio / llama.cpp, WebLLM (in-browser), plus custom OpenAI-compatible endpoints. Lists populate by Discover; all tagged `unverified`.
- Route tags `direct | gateway | origin | local | sim`; models needing CORS help are marked "gateway required". Streaming everywhere; Thinking panel only when the provider actually sends reasoning; prompt-based tool adapter with auto-downgrade.

## UI
- 38 colour themes × 10 layouts; 21 backdrops (Canvas2D seeded + lazy three@0.149 scenes with 2D fallbacks), iPhone particle cap, pause when hidden, reduced-motion respected, pre-paint theme (no flash).
- Command palette (⌘/Ctrl-K), Steering lab (11 presets), GPU lab, Bridge lab, diagnostics, WASM micro-kernel + Blob-worker risk scoring, thread export.

## Full stack
- `vercel/`: Edge `api/proxy.js` (allowlist + SSRF guard, SSE streaming, optional `FORGE_ACCESS_TOKEN`, optional server keys), `health`, `models`, `fetch`, and a stateless Streamable-HTTP **MCP server** (`@modelcontextprotocol/server` 2.x, 6 tools, 10-question evaluation). The harness auto-detects `/api/health` and routes through the gateway when needed.
- Node + Python local bridges (`bridge/`).

## From GitHub research (`research/GITHUB_FINDINGS.md`)
marked + DOMPurify (sanitized rendering), MCP SDK, WebLLM, Transformers.js, free-llm-api-resources, repo-map, delegate/plan/build commands. gpt4free rejected; Puter/p5 licence notes recorded.

## Hardening
- Exports redact keys/tokens/headers/secrets (tested); imports keep local secrets.
- Honest CORS: nothing claims to bypass CORS from `file://`.

## Tests (22 suites, all green)
validate, smoke, full, views, planmode, live_mock, bridge ×2, providers ×2, ATT parity, themes, visual, labs, iOS-shell, brain/computer, picks, vercel, redact, **e2e through the real `api/proxy.js` incl. streaming + 401**, vercel-api 24/24, vercel-mcp 16/16.

## NOT verified (no internet / no WebKit in the build sandbox)
- Real iOS Safari/Textastic (only Chromium iPhone emulation).
- Any live endpoint, CORS behaviour, CDN path or model id; a real Vercel deploy.
- Pollinations fallback URL, free-tier model lists: unverified until you tap Discover.
- 3D scenes are original, in ATT's style — not line-by-line ports.
## Known gaps
Cloud-browser sessions start but aren't driven; web search/fetch don't yet prefer the Vercel backend; disconnecting MCP keeps its tools until reload; `unpkg` mermaid@10 unpinned; AICommunityAPI (raw IP) provider off by default; the "uncensored" prompt string was not ported (neutral Direct-style toggle instead).
