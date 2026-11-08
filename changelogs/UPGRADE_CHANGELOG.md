# Forge — massive upgrade (2026-10-25)

Built from (a) the research and designs in your other sessions — Agentic AI OS blueprint, RIP & Replace, recursive-harness-kit / harness2, distill gates, S1 Harness, local-AI on M4 Pro — collected in `research/PRIOR_SESSIONS.md`, and (b) a fresh GitHub search, `research/GITHUB_2026-10-25.md`.

## New plugins (each one tested in its own Playwright suite)
| Plugin | What you get | Source |
|---|---|---|
| **Auto router** (`62-router`) | Provider **Auto · free failover**: ordered free-model chain, cooldowns (quota errors 2 min → 10 min → 1 h → 24 h ladder like freellmapi; 5xx/network 30 s doubling; Retry-After always wins), sticky route per thread, opt-in exact cache, cheap→strong cascade. `/router`, Settings → Router. | freellmapi (41k★), RouteLLM notes |
| **Memory v2** (`90-brain`) | Memory-stream ranking (recency × relevance × importance), own BM25 + optional Transformers.js embeddings fused by reciprocal-rank fusion, auto **reflections**, ReasoningBank-style **strategy / pitfall lessons** from every tool run injected as "Lessons from earlier runs". | Park et al. 2023, google-research/reasoning-bank, mem0 |
| **Shield** (`85-shield`) | Spotlighting + datamarking of untrusted tool output, lethal-trifecta guard, Meta **Rule of Two** (untrusted + sensitive + outbound always asks a human, even at Full access), per-thread quarantine, 26-rule secret scanner with Redact & send, autonomy ladder L1–L4 with trust ledger (suggestions only), **Approve for me** auto-reviewer (Codex auto_review style; off by default). | Microsoft Spotlighting, Meta Agents Rule of Two, CaMeL, gitleaks rules |
| **Traces & evals** (`86-traces`) | OpenTelemetry GenAI-shaped spans (`invoke_agent` → `chat` / `execute_tool`), waterfall view, OTLP-JSON + JSONL export, cost ledger + budget cap, SHA-256 hash-chained audit log with Verify, loop detector, golden-set evals with pass-rate sparkline. | OTel GenAI semconv (still "Development"), Langfuse |
| **Council** (`96-council`) | 2–5 models talk to each other: Debate / Council (answer → anonymous peer ranking → chair synthesis) / Brainstorm / Comedy. Repetition-collapse stop, skeptic anti-sycophancy, order-swapped judge flags position bias. Works offline. | karpathy/llm-council, Du et al. debate |
| **Checkpoints** (`15-checkpoints`) | Snapshot before every run; Rewind code / conversation / both / **summarize up to here**, with a diff preview; fork a thread from any message; `/folder` real-folder import with write-back where the browser supports it. | Claude Code checkpointing, Cline, LibreChat |
| **Skills** (`97-skills`) | Import Agent Skills (SKILL.md) by paste, file, **zip** (own ZIP reader) or URL; progressive disclosure via `use_skill`; AGENTS.md editor; **learned skills** proposed from successful runs but only activated after you approve, behind a validation + canary check. | anthropics/skills spec, harness2 / Voyager "verify before persisting" |
| **Hooks** (`98-hooks`) | Your own lifecycle hooks with the Codex / Claude Code event names (SessionStart, UserPromptSubmit, PreToolUse, PostToolUse, Stop) and the JSON decision contract; JS or bridge shell commands; imports a Claude Code `settings.json` hooks block. | Codex/Claude Code/Gemini CLI hook convergence |

## Fixes and core upgrades
- Hooks can now change what the model sees (`afterTool` → `{result}`, `beforeModel` messages/tools), `run:start` `{block}` is honoured, and approvals emit `approval:result`.
- `web_fetch` / `web_search` go through your Vercel backend when it is online; new `/api/search` endpoint (tested).
- Disconnecting an MCP server now removes its tools.
- Computer-use clicks and form posts to private/localhost addresses need the Full access tier.
- Router can pick a specific model inside a provider; plugin views no longer show twice in the rail; the Council seats fit at 390 px; mermaid pinned (10.9.1); new Ember logo in the sidebar and boot screen; core "Trace" view renamed "Kernel log".

## Independent review (separate agent) — 8 findings, all fixed and covered by tests
- Stored XSS through a model-supplied memory id/type in the Brain view → ids/types sanitised and escaped.
- Zip-slip: a skill zip could overwrite `/AGENTS.md` via `references/../../` → paths confined to `/skills/<name>/`.
- The model auto-reviewer could be talked into ALLOW on a tainted thread → tainted threads never reach the model reviewer.
- A redacted secret was still saved in checkpoint labels and trace titles → prompts are now redacted before anything records them (core: `user:message` runs first and can rewrite the text).
- Unbounded checkpoint / trace storage on iOS → 1.5 MB checkpoint budget with oldest-first eviction, pruning on thread delete, 120 spans per run, 800 audit entries, secrets redacted in traces.
- Router misread numbers like "≤ 512" as HTTP 5xx → only status-shaped numbers count; providers now pass Retry-After through.
- `/api/search` and `/api/fetch` crashed on malformed HTML entities → guarded.

## Tests
31 suites green in `tests/run_all.sh`, including 9 new ones (`u1`–`u7`, `m_hooks`, `m_upgrades`) and 25/25 Vercel API checks + 16/16 MCP checks.

## Not verified here (no internet, no WebKit in the build sandbox)
- Real iOS Safari / Textastic (Chromium iPhone emulation only); any live provider, CDN, CORS behaviour or Vercel deploy.
- Transformers.js semantic memory download, the real-folder picker (needs a real tap), the "Approve for me" **model** reviewer (only the offline rules are tested), freellmapi internals (taken from code explainers, not read in the repo).
