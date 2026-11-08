# Forge on Vercel — static harness + hardened Edge gateway

`public/index.html` is the single-file Forge harness (copied from `build.py` output). `api/` holds Edge functions.
No build step, no dependencies.

## Deploy (pick one)
1. **Dashboard:** push this `vercel/` folder to a Git repo → vercel.com/new → import → Framework preset *Other*, root = this folder → Deploy.
2. **CLI:** `npm i -g vercel && cd vercel && vercel deploy --prod`
3. **Button:** `https://vercel.com/new/clone?repository-url=<your-repo-url>&root-directory=vercel`

Then open `https://<app>.vercel.app/api/health` — should return `{"ok":true,...}`.

## Endpoints
| Path | Purpose |
|---|---|
| `/` | the harness (`public/index.html`) |
| `/api/proxy?url=<enc>` (alias `/api/forge-proxy`) | allowlisted CORS gateway, GET/POST/OPTIONS, streaming (SSE) passthrough |
| `/api/models` | free models: OpenRouter (`:free`/zero-price) + Pollinations → `[{provider,id,label,free,context}]`, edge-cached 10 min |
| `/api/fetch?url=<enc>&max=<chars>` | readable text/markdown + title + links for the harness `web_fetch` tool |
| `/api/search?q=<query>&n=<1..20>` | DuckDuckGo HTML results parsed server-side for the harness `web_search` tool (`[{title,url,snippet}]`) |
| `/api/health` | `{ok,version,time,features,serverKeys:[names only]}` |
| `/api/mcp` | MCP server (Streamable HTTP) for remote agents — see `api/mcp.js` / `mcp/` |

## Environment variables (all optional)
| Var | Effect |
|---|---|
| `FORGE_ACCESS_TOKEN` | require header `x-forge-token: <value>` on `/api/proxy`, `/api/fetch` and `/api/search`. **Strongly recommended.** |
| `FORGE_EXTRA_HOSTS` | comma list of extra hostnames allowed by the proxy |
| `FORGE_KEY_OPENROUTER`, `FORGE_KEY_DEEPSEEK`, `FORGE_KEY_NVIDIA`, `FORGE_KEY_VENICE`, `FORGE_KEY_OPENAI`, `FORGE_KEY_GROQ`, `FORGE_KEY_MISTRAL`, `FORGE_KEY_TOGETHER`, `FORGE_KEY_CEREBRAS`, `FORGE_KEY_XAI`, `FORGE_KEY_ANTHROPIC`, `FORGE_KEY_GEMINI` | server-side provider keys. Injected **only** if `FORGE_ACCESS_TOKEN` is set, the token matches, and the request sends `x-forge-use-server-key: 1`. Never returned to clients (health lists names only). |
| `FORGE_MAX_BODY` | proxy request-body cap in bytes (default 1 MiB) |
| `FORGE_FETCH_MAX_BYTES` / `FORGE_FETCH_TIMEOUT_MS` | `/api/fetch` caps (default 2 MiB / 10 s) |
| `FORGE_TEST_ALLOW_LOCAL` | **tests only** — allows `http://127.0.0.1`. Never set in production. |

Set them in Project → Settings → Environment Variables, or `vercel env add FORGE_ACCESS_TOKEN`.

## Local
```
cd vercel
node test/run.mjs     # zero-dependency test suite (Node >= 20)
vercel dev            # serves public/ + api/ on http://localhost:3000
```

## How the harness finds the gateway
When the page is served over http(s), it probes same-origin `/api/health`; if `features.proxy` is true it sets the
gateway to `<origin>/api/proxy` automatically (route tag `gateway`). From `file://` nothing is auto-detected: paste your
deployment URL into Settings → Gateway. Providers that send CORS headers keep working `direct` without the gateway.
`file://` cannot bypass CORS — the gateway exists precisely for that.

## Local bridge (files / shell)
Vercel functions cannot touch your machine. File and shell tools go through the optional local bridge running on
your computer (see the harness *Bridge Lab*); the hosted page talks to it on `http://127.0.0.1:<port>` only when you start it.

## Security notes
- **Open-proxy risk.** Without `FORGE_ACCESS_TOKEN` anyone who learns your URL can relay requests to the allowlisted
  APIs through your deployment (using *their* keys, but your bandwidth/quota). Set the token for any public deployment.
- Proxy hosts are a strict allowlist; `/api/fetch` accepts any public https host.
- SSRF guard: https only, port 443, no IP literals (incl. decimal/hex/IPv6), no `localhost`/`.internal`/`.local`/
  single-label hosts, no credentials in URLs; redirects are followed manually (max 5) and every hop is re-validated.
  DNS-level rebinding is not checked (Edge has no resolver API); Vercel's Edge network has no access to your LAN.
- Request: hop-by-hop headers, `Cookie`, `Origin`, `Referer`, `X-Forwarded-*`, and all `x-forge-*` are stripped.
  Response: `Set-Cookie` stripped, CORS `*` added, `Cache-Control: no-store`.
- No strict CSP is set because the single-file harness relies on inline scripts/styles. If you add one, it must allow
  `'unsafe-inline'` for `script-src`/`style-src` plus the CDNs and API hosts the harness uses.
- Functions run on the Edge runtime (`export const config = { runtime: 'edge' }` in each file), which streams responses;
  `package.json` uses `"type": "module"` so the same ES modules run under Node for tests.
