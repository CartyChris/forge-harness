# Forge — subagent brief (round 7, 2026-11-08)

Forge is a single-file, plugin-first AI agent harness (`dist/ds-forge.html`) that must run from **iOS Safari / Textastic file://** (every request is cross-origin; no build step at runtime) and also deploy to **Vercel** (`vercel/`). Core is a Cordis-style kernel; *everything* is a plugin.

## Layout
- `src/shell.html` — HTML + CSS shell (CSS vars per theme: --bg --bg-2 --surface --card --card-2 --text --text-2 --muted --line --line-2 --accent --accent-soft --accent-line --violet --danger --ok --warn --code-bg --code-head --add --del).
- `src/js/*.js` — core (kernel 10, store 20, fs 30, guard 40, providers/diff 50, toolkit 55, agent 60, ui 70-76, boot 80). **Only the main agent edits core.**
- `plugins/NN-name.js` — each `DS.plugin({ name, title, version, description, apply(ctx) {…} })`.
- `bridge/` (local Node/Python bridge), `vercel/` (Edge API + MCP server), `research/`, `tests/`.
- Build: `python3 build.py` → `dist/ds-forge.html`; `python3 build.py --only a,b` → `dist/test-a_b.html` (core + those plugins). Plugin scripts get `//# sourceURL=forge/plugins/<stem>.js` (file line = stack line − 3).

## ctx API (from `DS.POINTS` in src/js/10-kernel.js — read it for shapes)
`ctx.tool / command / view / fence / theme / status / composerAction / pill / mention / messageAction / settings / sidebar / guardRule / hook(event, fn, {order}) / provider / profile / skill / shortcut / prompt / previewer / intent / suggest / rail / backdrop`, plus `ctx.provide(name, api)`, `ctx.service(n)`, `ctx.waitFor(n)`, `ctx.on/once/emit`, `ctx.effect(fn→disposer)`, `ctx.setTimeout/setInterval` (auto-cleared), `ctx.data.get/set` (persisted per plugin), `ctx.toast(msg, kind, ms)`.
Globals: `DS.util` (esc, el, uid, download, debounce, sandboxFrame…), `DS.fs` (VFS: read/write/exists/list/walk/search/norm), `DS.store` (threads, settings(), activeThread(), newThread()), `DS.agent` (run, tools(), tool(name)), `DS.ui` (sheet, menu, confirm, promptText, panel, toast), `DS.shell.show(viewId)`, `DS.bus`, `DS.kernel.list(point)`, `DS.guard`, `DS.render`.
Hooks: run:start, run:end, user:message (may return {text} or {block}), beforeModel (mutate pre.messages/pre.tools), afterModel, beforeTool ({block}|{args}), afterTool ({result} changes what the model sees).
Services you may use: forge.models (identity/catalog/select/openPicker), forge.providers.core (register, streamFor(pid,{…, forceModel})), forge.gateway, forge.backend, forge.router, forge.brain, forge.shield, forge.traces, forge.council, forge.checkpoints, forge.skills, forge.hooks, forge.computer, forge.ide, forge.themes, forge.backdrops, forge.arena, forge.localai, forge.voice, forge.genart.

## Rules
1. **Honesty:** never claim a model/endpoint/CDN works unless tested; tag unverified things in UI ("unverified"); never invent model ids or URLs; never claim to bypass CORS from file://.
2. **iOS:** feature-detect every API; no horizontal page scroll at 390px; hit targets ≥ 40px; respect prefers-reduced-motion; pause heavy work when `document.hidden`.
3. Escape every untrusted string you put in innerHTML (`DS.util.esc`). No `allow-same-origin` on sandboxed frames that hold remote content.
4. Offline Sim: new features need a Sim `intent` + a `suggest` card so they demo with no key.
5. Touch ONLY the files you own. Valid JS at all times (`node --check` your file after each edit).
6. **Time-box 5:00 HARD** (the user's rule): `date +%s > plugins/.t/<ID>.start` first; check elapsed before every batch; at 3:30 stop adding features and test; at 4:30 write `plugins/<ID>.HANDOFF.md` (what works, what's untested, core issues for the main agent); finish by 5:00. No work loss: files must be valid whenever you stop.
7. Tests: Playwright Python, `tests/t_<area>.py <ABS html path>`, print PASS/FAIL lines and `FAILS: none` at the end, exit 1 on failure; always run with `timeout 150`. Default permission tier is Supervised — set `DS.store.settings().permission='unrestricted'` in tests that run tools. The sandbox has no internet: mock with `pg.route`.
8. Final message ≤ 8 lines.
