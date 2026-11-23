# Forge — Round 7 (2026-11-08)

## What was fixed (from your screenshots)
- **The chat no longer scrolls sideways.** Long words, URLs, JSON errors, tool cards and tables now wrap or scroll inside their own box, never the page. This is tested at 390×844, 844×390 and 1280×800 with deliberately nasty content.
- **Tool calls stopped failing in loops.** The `tool_call unknown tool 'tool_call'` errors and the "four tool calls in a row failed" stops came from models wrapping calls or guessing names. A new core module, `DS.toolkit` (`src/js/55-toolkit.js`), fixes this:
  - **Wrapped calls:** it unwraps `tool_call` / `function` / `invoke` wrappers.
  - **Names:** it maps common aliases (`write_file`→`fs_write`, `bash`→`shell_run`, `search`→`web_search`, `subagent`→`spawn_subagent`…) and fuzzy-matches near-miss names.
  - **Arguments:** it coerces argument types and fills in synonyms (`file`→`path`, `text`/`html`/`code`→`content`, `q`→`query`…).
  - **Clear errors:** it checks required arguments and returns an error with a `how_to_fix` hint, the tool's signature and an example.
  - **Text-only models:** tool calls a model writes as text are recovered (fences, `<tool_call>`, `<function=…>`, bare JSON, `name({...})`).
- **Every model gets a tool guide.** A short **tool quick-reference** is in the system prompt, scoped to the tools the request needs (core tools are always included; recently used tools are kept). There is also a new `tool_help {name|query}` tool, and a nudge after two failures.
- **`app_create`** now accepts `html` directly. Models kept sending `html` while the schema required `files`, which was the most common failure.
- **Model labels are correct now.** The **Think pill** sent `deepseek-reasoner` to Pollinations and the local engine, which caused the wrong chips "pollinations · deepseek-reasoner" and "wllama · deepseek-reasoner". It now only swaps the model on the DeepSeek API.
- **Local AI (wllama 3.x)** loads with the new `pathConfig`, which fixes `"default" is missing from pathConfig`.
- **Pollinations** now needs a free key (they changed this). It is labelled "Pollinations (free key)" with a link to enter.pollinations.ai, and it is no longer listed as keyless.
- **Preview is on the left rail** (▶), so it no longer sits behind "…".
- Streaming is **~17× faster** on long answers because rendering is coalesced to one paint per frame. 3000 deltas went from 10.9 s to 0.64 s.

## New
- **3D wallpapers (three.js).** A Wallpapers gallery has 48 wallpapers, 30 of them live 3D. There are 4 new 3D scenes: aurora-ribbons, monoliths, nebula-particles and emberforge.
  - All scenes share one WebGL renderer, with Auto/Low/High quality, an intensity control, pause-when-typing, iOS gyro parallax and a still-image mode.
  - Scenes follow your theme colours.
  - If three.js can't load (offline, or from file:// with no network), a 3D wallpaper falls back to its 2D version and the app says so. Your 3D choice is remembered.
  - Open it from the rail, with `/wallpaper`, or by asking "set wallpaper to nebula".
- **Subagents and orchestrator.**
  - **Roles:** Orchestrator, Coder, Researcher, Reviewer, Fast, plus your own. Each role has its own model, tool groups and step cap.
  - **Tools:** `spawn_subagent`, `agents_wait` and `agents_status` run hidden child threads, at most 3 at once, with a 5-minute budget and the same permission tier as the parent.
  - **Orchestrate pill:** turns on the orchestrator prompt and the Orchestrator role's model.
  - **Agents view:** includes a live panel with Stop and Open thread.
  - **Per-thread model routing:** every thread can be pinned to a provider and model.
- **Continue.dev compatibility.**
  - **Import:** import a Continue `config.yaml` or `config.json`. Models go to providers or custom endpoints. Roles are mapped (chat, edit/apply→coder, summarize→fast, autocomplete). Rules go into `/AGENTS.md`. Prompts become `/commands`. HTTP MCP servers are connected.
  - **Export:** Forge exports back to `config.yaml` with `${{ secrets.X }}` placeholders and never real keys.
  - **Autocomplete:** **IDE ghost-text autocomplete** (Monaco, press Tab to accept) uses Continue's `autocomplete` role. It is off until you set that role.
  - **Free trial:** Continue's own "free trial" models only work inside Continue's apps, so Forge skips them and says so. Free continual use comes from the free providers already in Forge (Groq, Gemini, Cerebras, OpenRouter free, DeepSeek, local AI).
- **Superagent (GitHub repo watcher).** This is inspired by `deepseek-ai/dsh-superagent-prototype`; it is not DeepSeek's code.
  - **Inbox:** it watches one repo's issues, PRs and failed CI runs, using ETag/304 caching and backing off on rate limits.
  - **Triage:** a 3-line triage for each item.
  - **Work on it:** opens a plan-first thread with the issue, its comments, the repo tree and the README.
  - **Results:** `gh_pr_draft` always asks you first, then opens a **draft PR** if you have a token, or writes a `.patch` if you don't. Proactive mode is off by default and never opens PRs on its own.
- **DeepSeek API provider (2026 models).** Models are `deepseek-flash`, `deepseek-v4-pro` and the legacy `deepseek-v4-flash`. `reasoning_content` is sent back during tool calls, and `thinking` / `reasoning_effort` are supported.
- **Smarter default router.** Keyed providers come first, then keyless direct routes, then gateway routes only when a gateway exists.

## Engine fixes found while integrating
- **Parallel tool calls.** Parallel-safe calls in one step now run together: reads, searches and `spawn_subagent`. Writes still run in order, and results always go back in call order.
- **Stop.** Stopping one thread (a subagent, for example) no longer cancels another thread's pending approval or question.
- **Hidden threads.** Subagent threads stay out of the sidebar, the command palette and the boot fallback.
- **Plugin options.**
  - Guard rules can ask with `human: true`, so the auto-reviewer can never answer for you.
  - Tools can declare `readonly: true` so Plan mode can use them.
  - `streamFor(..., {quiet:true})` makes background calls without changing the "current model" readout.
- **Offline Sim** scripts now read raw tool results even when the shield has spotlighted them.

## Tests (Playwright, in `tests/`, all `FAILS: none` on the full build)
| Suite | Coverage |
| --- | --- |
| `t_core` | boot, views, chat overflow ×3 sizes |
| `t_toolcalls` | 17 bad-model scenarios |
| `t_engine` | parallel batches, scoped stop |
| `t_perf` | — |
| `t_wallpapers` | real three.js r149: lit pixels, one WebGL context, offline fallback, persistence |
| `t_agents` | 21 checks |
| `t_continue` | 44 checks |
| `t_superagent` | 39 checks with GitHub mocked, `.patch` checked with `git apply` |
| `t_ide_ghost` | real Monaco 0.57 |

## Not verified (honest list)
- None of this has run on a real iPhone, iPad or Safari/WebKit. Everything was tested in Chromium.
- No live endpoints were called from this sandbox. That includes DeepSeek, Pollinations, GitHub, the jsDelivr/unpkg CDNs, and Continue configs pointing at real servers.
- Not tested:
  - the subagent 5-minute timeout path;
  - stdio MCP servers through the local bridge;
  - Superagent with private repos.

## Round 7b (same day, your follow-up request)
- **OrcaRouter, cyber tier.** The provider now uses OpenAI-compatible `https://api.orcarouter.ai/v1` with a `sk-orca-…` Bearer key, per docs.orcarouter.ai. The model ids come from orcarouter.ai/models?tier=cyber, checked 2026-11-08: `orca/orcacyber-flash-1.0`, `-ultra-1.0`, `-zero-1.5`, `-glm-5.3`, `-k3.1-pro`, `-minimax-m3.1-flash`, `-qwen3.8-flash-next`, `-mimo-flash`, `-hy4`, `orca/orcac2-1.0`, and the listed `deepseek/deepseek-v4(.1)-flash-free`. Once a key is saved, the live list loads from `/v1/models`. The stale model ids from an earlier round are gone. Tested with a mock (`t_orca`); real browser CORS has not been tested.
- **BlackBit was not added.** blackbit.sh is BLACKBIT.ZERO, an autonomous security-testing environment. Pro costs $2,100/mo, access is approved by email, and it publishes no inference API, base URL or model ids. If they give you an OpenAI-compatible endpoint, add it under Models → Custom endpoint.
- **ECC pack (affaan-m/ECC, MIT).** 14 core ECC agents become `ecc-*` subagent roles. An **ECC loop** pill runs plan → tests first → implement → self-review → verify → remember, with ECC's common rules. `ecc_load` fetches any of the 71 agents, 314 skills or rules on demand. Also added: `/tdd`, `/code-review`, `/build-fix`, `/verify` and `/ecc-plan`, plus an ECC view whose "Export AGENTS.md" button lets you use the loop in any coding harness.
- **Agent skills (addyosmani/agent-skills, MIT).** All 25 skills are bundled, from spec → plan → build → test → review → ship, and are available through `use_skill` as `as-*`. The routing meta-skill is a toggle, there is a viewer in Settings, and `/skills-addy` lists them. `use_skill` now also accepts skills whose instructions load lazily.
- **Long-term memory (past.dev).** Adds `past_remember`, `past_recall` and `past_forget`, plus optional auto-recall into the prompt (with a token cap) and auto-ingest after each run. Both are off by default. The key is masked and only ever sent as the Authorization header. Without a key, these fall back to the local brain and say so. Field names come from past.dev's API reference but have only been tested against a mock.
- Tests: `t_orca`, `t_ecc` (14), `t_agent_skills` (16) and `t_past_memory` (21) were added. All 13 suites report `FAILS: none` on the full build.

## Round 7c (2026-11-17): free fallback before the offline Sim
- **Free fallback (Continue-style).** The fallback runs when the chosen model has no key or fails before any text arrives: network/CORS errors, HTTP 401, 402, 403, 404, 408 or 429, 5xx, or 25 s with no reply. Forge then tries the free chain:
  1. Your keyed free tiers: Groq, Gemini, OpenRouter `:free` and others.
  2. Keyless endpoints, in this order: **Kilo Gateway → LLM7 → BlockRun → OVHcloud → Pollinations**.
  3. The offline Sim, only after all of those fail.
  - **Visibility:** a toast and the message chip name the model that actually answered.
  - **Cooldowns:** rate-limited or failing models are skipped for a cooldown period.
  - **Stickiness:** the model that answered is reused for 10 minutes.
  - **When everything fails:** a one-time **"No free model answered"** sheet offers the best free options. These are Get key links for OpenRouter, Groq and Gemini, a Retry button, and on-device model setup.
  - **No network calls:** choosing the Sim explicitly, or turning the fallback off (Settings → Router → Free fallback), never touches the network.
  - **Helper features** fall back to their own offline heuristics instead of Sim text: Superagent triage and the shield reviewer.
- **New keyless providers.** All three need no key, and browser CORS is untested for all of them.
  - **Kilo Gateway** `https://ai-gateway.kilo.ai/api/v1`: `:free` models, about 200 requests/hour per IP, per the Kilo docs.
  - **BlockRun** `https://blockrun.ai/api/v1`: NVIDIA-hosted free models, per-IP limit.
  - **OVHcloud AI Endpoints** `https://oai.endpoints.kepler.ai.cloud.ovh.net/v1`: anonymous use at 2 requests/minute per model. That anonymous access comes from third-party directories only.
- **Not added:** OpenCode Zen. Its docs say the free models are for the OpenCode app only.
- **Tests:** `t_freefallback` covers the no-key free answer, 429 → next, 401 keyed → free, the silent-endpoint timeout, all-fail → Sim + one-time prompt, no network when Sim is explicit or the fallback is off, and helpers getting an exhausted error. All 14 suites report `FAILS: none`.

## Round 7d (2026-11-22): Claude built into the artifact
- **New default inside a published Claude artifact.** "No API key needed: the agent, trainer and judge run on your own Claude account, through a "Claude (built into this artifact)" provider. The first call asks your permission and uses your Claude usage."
  - **How it runs:** it uses the artifact `sample` capability. The agent (executor) uses the `default` tier, the trainer (planner) `complex`, and the judge (critic) `quick`, all switchable in Settings.
  - **Tools:** these go through Forge's prompt protocol, so every existing tool works. The tool-call block itself is never streamed to the screen.
  - **What it replaces:** only an unconfigured setup (OpenRouter with no key) or the Sim. A provider you have already set up stays your default.
  - **If you decline consent:** the provider is marked unavailable and the free fallback takes over. Other providers stay available; note that the artifact viewer blocks outbound network calls, so in practice they work only from file:// or Vercel.
  - **Outside an artifact:** nothing changes (file:// and Vercel default to OpenRouter).
- **Downloads** inside the artifact go through the `downloads` capability. Plain links do nothing in the artifact viewer.
- **Free fallback:** inside an artifact, Claude is first in the chain.
- **Catalog:** the core provider is now listed as "OpenRouter / OpenAI-compatible (core)".
- **Tests:** `t_claude_artifact` mocks the artifact runtime and runs 15 checks: default provider and tiers, the streaming chat, the instructions turn, a tool call through the loop, downloads, declined consent → fallback, no network, and nothing changing outside an artifact. All 15 suites report `FAILS: none`.

## Round 7e (2026-11-23): Observatory — live, visual agent observability
- **Observatory view** (👁 on the left rail, `/observe`, and a live activity pill on every other screen while an agent runs):
  - **Now card and 9 live metrics:** elapsed time, steps, tool calls, errors, tokens in and out, sites, files and subagents.
  - **Swimlane timeline:** every model call and tool as a coloured bar (web, files, apps, agents, memory, code, approvals, errors), with each subagent in its own lane and a live "now" line.
  - **Reasoning:** streamed thinking, or answer text when a model hides its reasoning, split into thoughts tagged plan / decision / intent / question / doubt / observation, step by step.
  - **Web:** every search with its result cards, every page read showing exactly the text the agent got (redacted), and a domain map.
  - **Agent's eye:** the app or game the agent is building runs live inside the Observatory. Forge watches it and shows:
    - a canvas filmstrip;
    - motion, blank-canvas and FPS detection;
    - a wireframe of the page layout;
    - element, button and keyboard counts;
    - the console and errors.
  - **What it saw:** the exact request for each step, as a token breakdown (system / tools schema / user / assistant / tool results) with a context-window gauge, every message as the model received it, the scoped list of tools it could call, and the redacted system prompt.
  - **Tools:** a flow graph (which tool followed which), calls per tool with average latency and failures, and the files touched.
  - **Log:** every event in order, with JSON export of the whole run.
  - **Replay scrubber:** slide back in time and every panel re-renders as it was.
- **`app_inspect` tool:** the agent can now see its own app. It runs the app for about 3 s and returns a verdict (animating / static / blank canvas / errors), FPS, canvas size, element and button counts, visible text and console output.
- **Offline demo:** "Watch an agent build a game" on the welcome screen. It plans, builds a canvas game, inspects it and shows the result live.
- **Safety:** observe-only (it never changes what agents do). Page text and prompts are passed through the shield's secret redaction. App frames run sandboxed without same-origin access, and only frames Forge created can report back.
- **Tests:** `t_observe` (20 checks) covers:
  - the run and its spans, thoughts and files;
  - the agent's eye on a real running canvas game (frames, an "animating" verdict, no errors);
  - searches, pages and sites, with redaction;
  - tagged reasoning and the context snapshot;
  - a subagent lane, the HUD, every tab at 390px without overflow, replay and export.
  
  All 16 suites report `FAILS: none`.
- **Limits:**
  - Screenshots of WebGL canvases need `preserveDrawingBuffer`; without it, frames may show blank.
  - Live pages are shown as the text the agent read, not as embedded sites (most sites refuse embedding).
  - Token counts are estimates (characters ÷ 4) unless the provider reports usage.
