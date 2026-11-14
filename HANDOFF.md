# Handoff: Forge (for ChatGPT / Codex)

Forge is a single-file, plugin-first AI agent harness. It must run from iOS Safari over file:// and also deploy to Vercel. The default endpoint is OpenRouter (`https://openrouter.ai/api/v1`).

**Read first:** `AGENT_BRIEF.md` (layout, ctx API, rules) and `changelogs/ROUND7_CHANGELOG.md` (current state and the list of unverified items).

**Build and test**
- `python3 build.py` writes `dist/ds-forge.html`.
- `python3 build.py --package` also writes `vercel/public/index.html` and `dist/forge-vercel.zip`.
- Tests are Playwright Python: `for t in tests/t_*.py; do timeout 150 python3 $t $PWD/dist/ds-forge.html; done`.
  - Every suite must print `FAILS: none`.
  - `t_ide_ghost` needs `npm pack monaco-editor@0.57.0`, with the path to the unpacked `package/` dir as arg 2.
- Vercel: `cd vercel && node test/run.mjs` (25 checks).

**Rules**
- Core is `src/js/*.js`; everything else is a plugin in `plugins/NN-name.js`.
- Escape all untrusted HTML.
- No fake model ids or URLs. Label anything untested "unverified".
- No horizontal scroll at 390px. Hit targets ≥40px. Feature-detect iOS APIs.
- Every feature gets an offline Sim intent plus a suggest card.
- Add or extend a `tests/t_*.py` for each change.

**Next priorities**
1. Test on real iOS/WebKit: Playwright webkit plus a real device. Fix anything that breaks.
2. Verify the live endpoints: OpenRouter, DeepSeek, OrcaRouter, Pollinations, past.dev (field names), GitHub (Superagent), CDN loads (three.js, Monaco, wllama). Correct or label each one.
3. Cover the subagent 5-minute timeout path, stdio MCP via the bridge, and Superagent on private repos.
4. Cut size, now 1.8 MB: lazy-load the ECC and agent-skills data, and split rarely used plugins into lazy chunks for the Vercel build.
5. Decongest the UI: message action rows on mobile, and the wallpapers gallery's first screen.
6. Per-call tool gates in core: `ecc_load` and `gh_read` currently work around this.
