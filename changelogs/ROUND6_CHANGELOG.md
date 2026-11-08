# Forge — round 6 (2026-10-26): a browser that reads the web from a file, and a real IDE

## Browser (rail 🖥 "Browser", `/browse`, tools `computer_*`)
Works from iOS file:// with no key and no server — read-only / static, honest about every route.
- **Route ladder** — every page shows *via* and a tap-to-explain list of what was tried:
  1. Keyless site APIs: Wikipedia, Hacker News (+ Algolia search), GitHub, npm.
  2. Direct fetch (sites that allow CORS) → your gateway / Vercel `/api/fetch` → local bridge.
  3. Public readers: Jina Reader (`r.jina.ai`), allOrigins, cors.lol, codetabs.
  4. allOrigins JSONP run **only inside a sealed sandbox iframe** (no access to Forge, keys or storage).
  5. Wayback Machine snapshot for pages that are down or blocked.
  Pages are cached 10 min. Toggle "Use public readers/proxies" (on; they see the URLs you open). Private/localhost URLs, URLs carrying tokens/keys/passwords, and form POSTs never go to public routes. corsproxy.io removed (dev-only now).
- **Four ways to view:** **Page** (the real page re-rendered static, scripts removed; links and GET forms keep browsing inside Forge), **Reader** (clean text + find-in-page), **Shot** (WordPress mShots image, auto-retry while it renders), **Live** (real iframe — only sites that allow framing) + **Open in Safari ↗**.
- Back/forward/reload, tabs, bookmarks, history; search falls back to Wikipedia + Hacker News when DuckDuckGo can't be reached. The agent's `web_fetch` now retries through the same ladder.

## IDE (rail </> "IDE", `/ide path[:line]`)
- File tree · tabs · editor · Outline / Problems / Stack (bottom switcher on iPhone).
- **Lite editor** (offline, iPhone-friendly: highlighting, line numbers, tab/auto-indent, current line, go-to-line) and **Monaco** (VS Code engine, loads from CDN on desktop; falls back to Lite automatically).
- Save / Save all / Revert / diff vs saved (feeds the Changes view), find & replace (regex), format, Run (HTML preview, JS, Python), AI actions (Explain, Fix problems, Refactor selection, Write tests), find usages.
- **Open the IDE from a file:** Files sheet "IDE" button, clickable paths in tool cards, "Open in IDE" on any answer with code, `/ide`, tool `ide_open`.
- **See its code / stack:** read-only **Forge source** (core + every plugin, line numbers match the files); a **Stack** panel that parses any error (or picks recent captured errors) and jumps to the exact line — builds now tag every plugin with `sourceURL`, so stacks read `forge/plugins/62-router.js:127`.

## Independent review — 9 findings, all fixed
- URLs carrying credentials in less obvious forms (S3 `X-Amz-Signature`, `client_secret`, OAuth `code`, `user:pw@`, `#access_token`) could reach public readers → stricter detection on every parameter name.
- Screenshot mode/tool ignored the "public readers off" setting and the secret check → now honours both.
- Live mode could give a page on Forge's own (Vercel) origin same-origin access → never for Forge's origin.
- IDE: two files changed by the agent at once — only one tab refreshed → all refresh; Save now warns before overwriting a file that changed on disk; snippet files always appear in Changes; closed Monaco tabs free their memory.
- Browser: private-address check now also covers other plugins' calls; history capped; per-thread state freed when a thread is deleted.

## Tests
42 suites (3 new). The a9 iOS suite now ignores offline CDN load failures (Monaco) and prints them instead.
## Not verified
No internet in the build sandbox: every public route, reader and screenshot service was tested against mocks only; cors.lol / codetabs URL formats unverified; Monaco not loaded for real; nothing run on a real iPhone.
