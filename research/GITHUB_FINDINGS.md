# Forge — GitHub Findings (A11)
Date: 2026-10-24. Sources: npm registry (read live from shell: version, publish time, licence, unpackedSize), github.com pages via WebFetch (stars, licence). GitHub API and jsDelivr were **blocked** from the sandbox (403 / no connect), so CDN paths come from npm `unpkg`/`browser`/`module` fields where noted, else `unverified`. Pinned versions are the newest release published **before 2026-10-10** (≥2 weeks old). Stars marked `unverified` were not read. Machine-readable: `research/picks.json` (39 entries).

## Top-10 picks
| # | Pick | Stars | Latest npm (date) | Licence | Pin | unpacked KB | Why | Integration (forgePoint) |
|---|---|---|---|---|---|---|---|---|
| 1 | marked + DOMPurify | 37.2k / 17.3k | 18.1.1 (10-12) / 3.4.17 (10-12) | MIT / MPL-2.0 OR Apache-2.0 | 18.1.0 / 3.4.16 | 506 / 1578 | Smallest, UMD (`lib/marked.umd.js`, `dist/purify.min.js` per npm `browser`) | view: md → sanitize → DOM |
| 2 | @modelcontextprotocol/sdk | 13.6k | 1.32.2 (10-23) | MIT (v1); v2 main = Apache-2.0 new contribs | 1.32.1 | 4387 | Official; Streamable HTTP; v2 targets spec 2026-07-28 | tool: lazy `import()` Client over Streamable HTTP via CORS/Vercel proxy |
| 3 | WebLLM | 19.3k | 0.2.86 (10-11) | Apache-2.0 | 0.2.85 | 14077 | OpenAI-shaped API in-browser on WebGPU | provider `local:webllm`, gated on `navigator.gpu` |
| 4 | Transformers.js | 16.4k | 4.3.1 (10-06) | Apache-2.0 | 4.3.1 | 9729 | One lib = embeddings + Whisper ASR + small LLMs | provider/tool: embeddings for memory, ASR for voice |
| 5 | free-llm-api-resources | 29.2k | n/a (data) | unverified | — | — | Catalog to refresh free providers | provider catalog source (13 free tiers listed) |
| 6 | Pollinations | 5k | n/a | MIT | — | — | Zero-key OpenAI-compatible: `https://gen.pollinations.ai/v1` | provider default + image gen |
| 7 | jsdiff + diff2html | unverified | 9.0.0 (04-13) / 3.4.56 (01-31) | BSD-3 / MIT | same | 601 / 1975 | Patch create/apply + rendered diff | tool (edit/apply) + view (approval card) |
| 8 | xterm.js | 21.2k | 6.0.0 (2025-12-22) | MIT | 6.0.0 | 5783 | Standard web terminal | view: terminal panel (v6 entry is ESM `lib/xterm.mjs`) |
| 9 | Orama | 10.6k | 3.1.18 (2025-12-19) | Apache-2.0 | 3.1.18 | 2141 | Hybrid full-text + vector, pure JS | tool: memory/VFS search |
| 10 | Mermaid + KaTeX | 90.5k / unverified | 12.2.0 (10-13) / 0.19.1 (10-23) | MIT / MIT | 12.1.0 / 0.19.0 | 119455 / 3950 | Diagrams/maths fences | fence: lazy on first ```mermaid / $$ |

## Categories (pins + notes)
- **Local LLM:** WebLLM (WebGPU), Transformers.js, **wllama 1.4k MIT 3.8.1 (10-02)** = WASM/GGUF fallback for no-WebGPU iOS. onnxruntime-web 1.30.0 (141 MB pkg) only via Transformers.js. MediaPipe tasks-genai 0.10.29 (Apache-2.0; Gemma weight terms) priority 4.
- **Free providers / catalog:** cheahjs list (29.2k) free tiers: OpenRouter, Google AI Studio, NVIDIA NIM, Mistral (La Plateforme + Codestral), HF Inference Providers, Vercel AI Gateway, Kilo Gateway, OpenCode Zen, Cerebras, Groq, Cohere, Cloudflare Workers AI. Trial-credit only: Fireworks, Baseten, Nebius, Novita, AI21, Upstage, NLP Cloud, Alibaba, Modal, Inference.net, Hyperbolic, SambaNova, Scaleway. Also seen: mnfst/awesome-free-llm-apis (unverified). Puter.js npm 2.6.4 Apache-2.0 but **repo is AGPL-3.0 (43.8k)** — script-tag only, never vendor.
- **MCP:** official TS SDK (above); README lists Node/Bun/Deno only — browser use unverified, needs CORS. **mcp-use 10.6k MIT**, `@mcp-use/client` claims browser + React; pin 1.34.8 (2.11.2 is <2 weeks old).
- **Markdown/code/math/diagrams:** marked (pick), markdown-it 14.3.2 alt, highlight.js 11.12.0 BSD-3 (mobile pick), Shiki 4.5.0 (desktop optional), KaTeX 0.19.0, Mermaid 12.1.0 (v12 `module` is `mermaid.core.mjs`; UMD path unverified), Chart.js 4.5.1 (`dist/chart.umd.min.js` per npm). uPlot 1.6.32 last published 2025-03.
- **Editors:** CodeMirror 6 (`codemirror` 6.0.2 meta pkg; @codemirror/view 6.43.14) for mobile; Monaco 0.57.0 rejected on iOS (touch, 99 MB pkg).
- **Runtimes:** Pyodide 314.0.7 (14.8k, MPL-2.0; new versioning, CDN path unverified), quickjs-emscripten 0.32.0 MIT, sql.js 1.14.2 (classic, file://-safe), @sqlite.org/sqlite-wasm 3.53.4-build2 (OPFS), DuckDB-WASM 1.32.0 (huge, p5).
- **Storage:** idb-keyval 6.3.0 (55 KB pkg, `dist/umd.js`), Dexie 4.4.6. localForage 1.10.0 stale (2022) → reject.
- **Vector/RAG:** Orama + Transformers.js embeddings. voy-search (2023) and hnswlib-wasm (2023) stale → reject.
- **Speech:** Transformers.js Whisper for ASR; kokoro-js 1.2.1 (Apache-2.0, npm stale since 2025-05, 29 MB) optional TTS; default Web Speech API.
- **Games/gen-art (previewer importmap/CDN):** three 0.186.1, Rapier3d-compat 0.21.0, Phaser 4.2.1 (UMD `dist/phaser.js`), KAPLAY 3001.0.19, p5 2.3.4 (**LGPL-2.1** — CDN-unmodified only). cannon-es 0.20.0 stale (2022) → prefer Rapier.

## Features to emulate (harness references)
- **OpenCode (221.1k, MIT, verified):** two primary agents toggled by Tab — `build` (full access) and `plan` (read-only, edits denied, bash asks); `@general` subagent for multi-step search.
- From prior knowledge, **unverified this session** (aider, cline, goose, OpenHands, codex CLI, gemini-cli, Continue, Open WebUI, LibreChat, Lobe Chat, big-AGI, Jan): repo-map/context summary (aider); per-step approve/deny with diff preview + checkpoints/restore (cline); auto-commit/undo per edit (aider); MCP-first extensions (goose); sandboxed runtime + event stream (OpenHands); approval modes suggest/auto-edit/full-auto (codex); GEMINI.md/AGENTS.md project memory files + `/memory` (gemini-cli, claude-code); model switcher + side-by-side multi-model ("beam", big-AGI); conversation branching/forking (LibreChat, big-AGI); artifacts pane (Lobe/LibreChat); local model hub with download progress (Jan/LM Studio); RAG over uploaded docs (Open WebUI).

## Rejected / flagged
- Monaco (mobile touch, size). DuckDB-WASM (size). voy, hnswlib-wasm, localForage, cannon-es (stale ≥2y). gpt4free (licence GPL-3 as known; unverified here; ToS-violating reverse-engineered providers) — reject. LiteLLM (Python server; only as an optional Vercel-side reference). Puter repo (AGPL) — use hosted script only. p5 (LGPL) — CDN only.
- All versions published after 2026-10-10 deliberately **not** pinned (marked 18.1.1, dompurify 3.4.17, katex 0.19.1, mermaid 12.2.0, MCP SDK 1.32.2, dexie 4.4.7, chart.js 4.6.x, mcp-use 2.x, sql.js 1.15.1).

## iOS Safari / Textastic file:// notes
- `type=module` + `import()` from https CDN works on file:// in modern Safari, but workers from cross-origin URLs do not → wrap via Blob URL; OPFS/COOP-COEP SharedArrayBuffer unavailable on file:// → wllama/Pyodide single-thread builds only. WebGPU needs Safari 26+. Keep every lib lazy and optional; prefer UMD (marked, DOMPurify, KaTeX, diff, diff2html, idb-keyval, Chart.js, Phaser) for no-module fallback.
