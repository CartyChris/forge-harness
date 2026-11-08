# Forge MCP server

Stateless Streamable-HTTP MCP server (Vercel, `/api/mcp`) that also runs locally over stdio.
Built on `@modelcontextprotocol/server` 2.4.0 (SDK v2) + `zod` 4. Plain ESM JS, no build step.

| Tool | What it does | Network |
|---|---|---|
| `forge_provider_catalog` | Forge providers + route tags (direct/gateway/origin/local/sim), filters, paging | none (static) |
| `forge_free_models` | OpenRouter `:free`/zero-price + Pollinations models; query/min_context filters | openrouter.ai, pollinations |
| `forge_web_fetch` | Readable text of a public https page; SSRF-guarded, redirects re-checked, char paging | any public https |
| `forge_web_search` | DuckDuckGo HTML search → title/url/snippet | duckduckgo |
| `forge_github_repo` | Stars, forks, pushed_at, license, latest release (unauth, 60/h) | api.github.com |
| `forge_github_search` | Repo search with qualifiers, sort, page | api.github.com |
| `forge_npm_package` | Version, modified, license, unpacked size, deps | registry.npmjs.org |
| `forge_cdn_check` | HEAD a jsDelivr/unpkg/cdnjs URL → exists + bytes | CDN |

Resources: `forge://catalog/providers` (JSON), `forge://readme` (markdown).
Prompts: `forge_build_app(idea)`, `forge_research_repos(topic, count?)`.
All tools are read-only; results carry `structuredContent` plus identical JSON text; errors return `isError` with a fix hint.

## Local (Claude Desktop, stdio)
```bash
cd vercel/mcp && npm i
```
```json
{ "mcpServers": { "forge": { "command": "node", "args": ["/ABSOLUTE/PATH/forge/vercel/mcp/stdio.mjs"] } } }
```

## Remote (Vercel)
Deploy `vercel/`; endpoint is `https://<your-app>.vercel.app/api/mcp`. Clients that take a URL:
```json
{ "mcpServers": { "forge": { "type": "http", "url": "https://<your-app>.vercel.app/api/mcp",
  "headers": { "Authorization": "Bearer <FORGE_MCP_TOKEN>" } } } }
```
`GET /api/mcp` in a browser returns a small info JSON; SSE GET returns 405 (stateless). CORS is open (`*`).

## Auth
Optional: set env `FORGE_MCP_TOKEN` in Vercel. When set, every request needs `Authorization: Bearer <token>` (else 401).
Unset = public endpoint (tools are read-only, but web_fetch/search spend your function quota — set a token for anything public).

## Test
`node test/selfcheck.mjs` — spawns stdio, drives the HTTP handler, mocks all network via `setFetch()` (no internet needed).
`evaluation.xml` — 10 offline-verifiable Q/A pairs over the static catalog.
