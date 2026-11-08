# Browser Routes research (R3) — 2026-10-26
Keyless, CORS-readable routes for a file:// single-HTML "virtual browser". [V]=read primary page, [U]=search snippet/secondary only.

## Batch 1 (t~10s)
- microlink.io [V pricing]: free plan = 25 req/day, cached responses don't count; free API key via signup (no card). Endpoints: screenshot, metadata, rendered HTML ("after JavaScript runs"). CORS not stated on pricing page. https://microlink.io/pricing
- corsproxy.io: search hits only secondary (sliplane, corsfix blog) — status unverified [U]. corsfix.com page failed to fetch.
- r.jina.ai: jina.ai pricing page robots-disallowed; no primary read yet [U].
- allorigins: self-hostable (docker computeronix/allorigins, git.gay mirror); public instance api.allorigins.win status unverified [U].

## Batch 2 (t~60s)
- r.jina.ai [U secondary — Simon Willison 2024-06-16]: keyless 20 RPM (per IP), free key 200 RPM. CORS not stated there. jina.ai pricing blocked to fetch.
- Wayback availability [V archive.org/help/wayback_api.php]: GET https://archive.org/wayback/available?url=<u>&timestamp=YYYYMMDDhhmmss ; supports `callback=` JSONP (=> usable from file:// via <script> even if no CORS). CORS + id_ raw mode not documented on that page.
- corsproxy.io [U secondary, sliplane post-Jul-2025]: free = "10,000 req/month, dev only" (localhost, CodePen etc.); production requires paid plan. => treat as NOT usable from iOS file:// (origin "null").
- cors.lol [U sliplane]: free, rate-limited, non-commercial, no key/account; $35 lifetime Pro.
- cors.sh [U]: needs x-cors-api-key; free only for OSS with 5+ stars. Corsfix: free tier gone ($5/mo), self-host OSS.
- CORS Anywhere public demo: severely rate-limited since 2021 (opt-in per visitor) — useless.
- thingproxy (freeboard.io) [U nordicapis 2023]: 100k char limit, 10 req/s/IP — historic; current status unknown.
- allorigins [U nordicapis 2023]: JSON/P or raw output; current uptime unknown.

## Batch 3 (t~95s)
- mShots [U-ish: shkspr.mobi 2018 blog, primary-ish]: <img src="https://s0.wordpress.com/mshots/v1/<encodeURIComponent(url)>?w=800&h=500"> ; max 1280x960; first hit 307 -> "Generating Preview" placeholder, retry after few s (append cache-buster to retry); no key; Automattic, commercial users asked to contact for licence. <img> needs no CORS (canvas read would be tainted).
- Reddit .json [U dev.to/medium 2026 titles]: multiple 2026 sources report Reddit blocking unauthenticated .json (403). Treat as DEAD for keyless browser use.
- Wikipedia: MediaWiki Manual:CORS page exists (fetching next). Action API anonymous CORS via origin=* is the documented path.

## Batch 4 (t~110s)
- Reddit [V-secondary dev.to article]: Reddit announced 2026-05-28 (r/modnews) shutdown of unauthenticated .json; anonymous requests now 403 / empty redirect. RSS flagged as "next surface to close" (still working at article time, fragile). => DEAD; RSS via proxy only, fragile.
- mediawiki Manual:CORS fetch failed (url_not_found). Wikipedia CORS = [U]; well-known pattern: https://en.wikipedia.org/w/api.php?...&format=json&origin=* (anonymous CORS) and /api/rest_v1/page/summary|html/<title>.

## Batch 5 (t~130s)
- thum.io [V thum.io/documentation/api/url]: <img src="https://image.thum.io/get/width/800/crop/1200/noanimate/<url>"> (or /get/?url=<enc>). Options width (def 600), crop (def 1200), noanimate, maxAge, png, allowJPG unrestricted; fullpage/wait/viewportWidth = paid. Docs do NOT confirm keyless free quota/referrer rules -> unknown; treat as fallback.
- SearXNG [V docs.searxng.org search_api]: GET <instance>/search?q=..&format=json ; format must be enabled in settings.yml else 403; "many public instances have these formats disabled". CORS not documented -> unknown/varies. Low reliability for keyless use.

## Batch 6 (t~150s)
- Jina Reader [V github.com/jina-ai/reader README]: GET https://r.jina.ai/<url>; headers x-respond-with (markdown|html|text|screenshot|frontmatter), x-target-selector, x-wait-for-selector, x-timeout (<=180), x-no-cache:true, x-with-images-summary, x-retain-links/images, x-engine, x-preset. Anonymous traffic "most aggressively rate-limited" (no number; 20 RPM per Willison 2024 [U]). s.jina.ai search prefix shown w/o key in README [V] but current key requirement unverified. CORS not stated in README -> unknown (custom headers trigger preflight; prefer plain GET without custom headers from file:// to avoid preflight failure).
- arXiv [V info.arxiv.org basics]: http://export.arxiv.org/api/query?search_query=all:x (Atom XML). CORS not mentioned; ToU applies. Rate guideline not on that page. Unknown CORS -> route via proxy.

## Batch 7 (t~170s)
- HN [V github.com/HackerNews/API]: https://hacker-news.firebaseio.com/v0/{topstories,item/<id>,user/<id>}.json ; "There is currently no rate limit." CORS not stated in README [U: Firebase RTDB REST is widely used from browsers].
- codetabs: https://api.codetabs.com/v1/proxy?quest=<url> — primary page fetch failed; limits unverified [U].
- Stack Exchange / npm registry: search only, no primary read [U]. Known patterns: https://api.stackexchange.com/2.3/search?intitle=..&site=stackoverflow (keyless daily IP quota), https://registry.npmjs.org/<pkg>.

## Batch 8 (t~185s)
- Stack Exchange [U-secondary apis.io/API Evangelist profile, self-labelled unverified]: keyless 300 req/day/IP (resets UTC midnight); free app key 10k/day; throttle = HTTP 503 (error_id 502); MUST honour `backoff` field or risk IP ban. CORS not stated there.
- npm registry [V-secondary npm-in-browser README]: "the official npm registry allows CORS"; caveat: 404 responses lack ACAO header (missing package looks like network error).
- thum.io [V thum.io/docs]: docs don't state keyless free tier/quota/referrer; has signup + /get/auth/{key}. Paid-only: fullpage, wait, viewportWidth, device emulation. => keyless status UNKNOWN; mShots safer.

## Batch 9 (t~200s)
- allOrigins [V README allorigins@2.0.2]: https://api.allorigins.win/get?url=<enc>[&charset=..][&callback=fn] -> JSON {contents,...} (JSONP supported!), https://api.allorigins.win/raw?url=<enc> -> raw body with CORS. No documented limits; public instance uptime historically flaky [U]. Self-hostable (npm start, port 1458).
- Framing [V MDN X-Frame-Options]: no client-side way to override XFO/CSP frame-ancestors; meta tags ineffective; sandbox doesn't lift it. Only route to "show" a blocked site = re-render fetched HTML (srcdoc in sandboxed iframe, with <base href>) or screenshot <img> (mShots/thum.io/microlink). srcdoc of proxied HTML loses cookies/login, scripts often break.

## Recommended ladder (file:// on iOS, origin "null")
1. Special-case keyless CORS APIs first: Wikipedia (action API &origin=*, REST summary/html) [U], HN Firebase [V no rate limit], npm registry [V CORS, 404 lacks ACAO], GitHub raw/REST [U, 60/h unauth], Stack Exchange (300/day/IP, honour backoff) [U], Wayback availability (JSONP callback=) [V].
2. r.jina.ai/<url> plain GET (markdown) — best general reader; ~20 RPM/IP anon [U]; avoid custom x- headers unless preflight confirmed OK.
3. api.allorigins.win/get?url=&callback= (JSONP works regardless of CORS) -> /raw fallback [V README].
4. cors.lol, api.codetabs.com/v1/proxy?quest= — rate-limited/non-commercial, unverified [U].
5. web.archive.org/web/2/<url> (id_ raw) via proxy for dead/blocked pages — CORS on id_ undocumented.
6. Visual fallback <img>: s0.wordpress.com/mshots/v1/<enc>?w=1024 (307 placeholder -> retry) ; image.thum.io/get/width/1024/<url> (keyless status unknown); microlink 25/day.
DEAD/avoid: corsproxy.io (free = dev-only/localhost), CORS Anywhere demo, cors.sh/Corsfix (key/paid), Reddit .json (403 since 2026-05-28), SearXNG public JSON (mostly disabled).
