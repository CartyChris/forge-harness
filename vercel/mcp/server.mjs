// Forge MCP server factory: fresh McpServer per call (required for stateless HTTP).
import { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import { PROVIDERS, ROUTES } from './lib/catalog.js';
import { httpGet, getJson, checkPublicUrl, extractReadable, decode, UpstreamError } from './lib/net.js';
export { setFetch } from './lib/net.js';

export const VERSION = '0.1.0';
const CHARACTER_LIMIT = 25000;
const RO = { readOnlyHint: true, destructiveHint: false, idempotentHint: true };
export const README = `# Forge MCP\nTools: forge_provider_catalog, forge_free_models, forge_web_fetch, forge_web_search, forge_github_repo, forge_github_search, forge_npm_package, forge_cdn_check.\nRoute tags: ${ROUTES.join(', ')}. direct = callable from file://; gateway = needs the Vercel/Edge proxy; origin = needs http(s) origin; local = in-browser WebGPU/WASM; sim = simulated.\nResources: forge://catalog/providers, forge://readme. Prompts: forge_build_app, forge_research_repos.`;

/** Build a JSON result (structuredContent + identical JSON text). */
const ok = (data) => ({ content: [{ type: 'text', text: JSON.stringify(data) }], structuredContent: data });
const err = (e) => ({ isError: true, content: [{ type: 'text', text: 'Error: ' + (e instanceof UpstreamError || e instanceof Error ? e.message : String(e)) }] });
/** Wrap a handler so thrown errors become actionable isError results. */
const safe = (fn) => async (args, ctx) => { try { return await fn(args, ctx); } catch (e) { return err(e); } };
/** Page an array by offset/limit, shrinking until the JSON fits CHARACTER_LIMIT. */
function page(items, offset, limit, extra = {}) {
  let n = Math.min(limit, Math.max(0, items.length - offset));
  for (;;) {
    const slice = items.slice(offset, offset + n);
    const next = offset + n < items.length ? offset + n : null;
    const data = { ...extra, total: items.length, count: slice.length, offset, next_offset: next, items: slice };
    if (JSON.stringify(data).length <= CHARACTER_LIMIT || n <= 1) return data;
    n = Math.floor(n / 2);
  }
}
const Paging = { limit: z.number().int().min(1).max(100).default(20).describe('Max items to return (1-100)'), offset: z.number().int().min(0).default(0).describe('Items to skip, for pagination (use next_offset)') };
const filterProviders = ({ route, keyless, free, default_on }) => PROVIDERS.filter((p) => (!route || p.route === route) && (keyless === undefined || p.keyless === keyless) && (free === undefined || p.free === free) && (default_on === undefined || p.defaultOn === default_on));

/** @returns {McpServer} */
export function createServer() {
  const server = new McpServer({ name: 'forge-mcp', version: VERSION });

  server.registerTool('forge_provider_catalog', {
    title: 'Forge provider catalog',
    description: 'List Forge\'s built-in model providers with honest route tags (direct|gateway|origin|local|sim), key/free flags and base URLs. Static and offline. Use before picking a provider or explaining what works from file://.',
    inputSchema: z.object({
      route: z.enum(ROUTES).optional().describe('Only providers with this route tag'),
      keyless: z.boolean().optional().describe('Only providers that need no API key (true) or that need one (false)'),
      free: z.boolean().optional().describe('Only providers with a free tier'),
      default_on: z.boolean().optional().describe('Only providers enabled by default'),
      ...Paging,
    }),
    annotations: { ...RO, openWorldHint: false },
  }, safe(async (a) => ok(page(filterProviders(a), a.offset, a.limit, { routes: ROUTES }))));

  server.registerTool('forge_free_models', {
    title: 'Free model list',
    description: 'Fetch live free models: OpenRouter models whose id ends in ":free" (or prompt+completion price 0) and Pollinations text models. Filter by substring or min context length.',
    inputSchema: z.object({
      source: z.enum(['all', 'openrouter', 'pollinations']).default('all').describe('Which source(s) to query'),
      query: z.string().max(100).optional().describe('Case-insensitive substring match on model id/name'),
      min_context: z.number().int().min(0).optional().describe('Minimum context length in tokens (OpenRouter only)'),
      ...Paging,
    }),
    annotations: { ...RO, openWorldHint: true },
  }, safe(async (a, ctx) => {
    const out = []; const errors = [];
    const sig = ctx?.mcpReq?.signal;
    if (a.source !== 'pollinations') {
      try {
        const j = await getJson('https://openrouter.ai/api/v1/models', { signal: sig });
        for (const m of j.data || []) {
          const free = /:free$/.test(m.id) || (m.pricing && +m.pricing.prompt === 0 && +m.pricing.completion === 0);
          if (free) out.push({ source: 'openrouter', id: m.id, name: m.name || m.id, context: m.context_length ?? null, route: 'direct', keyless: false });
        }
      } catch (e) { errors.push('openrouter: ' + e.message); }
    }
    if (a.source !== 'openrouter') {
      try {
        const j = await getJson('https://text.pollinations.ai/models', { signal: sig });
        for (const m of Array.isArray(j) ? j : j.data || []) {
          const id = typeof m === 'string' ? m : m.name || m.id; if (!id) continue;
          out.push({ source: 'pollinations', id, name: (m && m.description) || id, context: null, route: 'direct', keyless: true });
        }
      } catch (e) { errors.push('pollinations: ' + e.message); }
    }
    if (!out.length && errors.length) throw new UpstreamError('All sources failed — ' + errors.join('; '));
    const q = (a.query || '').toLowerCase();
    const items = out.filter((m) => (!q || (m.id + ' ' + m.name).toLowerCase().includes(q)) && (!a.min_context || (m.context || 0) >= a.min_context));
    return ok(page(items, a.offset, a.limit, { errors }));
  }));

  server.registerTool('forge_web_fetch', {
    title: 'Fetch web page (readable)',
    description: 'Fetch a public https URL and return readable text (title + markdown-ish body). SSRF-guarded: blocks IPs, localhost, private TLDs, non-443 ports; redirects re-checked. Use max_chars/start_char to page long pages.',
    inputSchema: z.object({
      url: z.string().url().describe('Absolute https:// URL'),
      max_chars: z.number().int().min(200).max(20000).default(8000).describe('Max characters of text to return'),
      start_char: z.number().int().min(0).default(0).describe('Character offset to start from (for paging; use next_start_char)'),
    }),
    annotations: { ...RO, openWorldHint: true },
  }, safe(async (a, ctx) => {
    const c = checkPublicUrl(a.url); if (c.error) throw new UpstreamError(c.error);
    const r = await httpGet(a.url, { guard: true, signal: ctx?.mcpReq?.signal, headers: { accept: 'text/html,text/plain;q=0.9,*/*;q=0.5' } });
    if (r.status >= 400) throw new UpstreamError(`HTTP ${r.status} from ${new URL(r.url).host}.`, r.status);
    const ct = r.headers.get('content-type') || '';
    const { title, text } = /html/i.test(ct) || /<html/i.test(r.text.slice(0, 500)) ? extractReadable(r.text) : { title: '', text: r.text };
    const chunk = text.slice(a.start_char, a.start_char + a.max_chars);
    const next = a.start_char + a.max_chars < text.length ? a.start_char + a.max_chars : null;
    return ok({ url: a.url, final_url: r.url, status: r.status, content_type: ct, title, total_chars: text.length, start_char: a.start_char, next_start_char: next, text: chunk });
  }));

  server.registerTool('forge_web_search', {
    title: 'Web search (DuckDuckGo)',
    description: 'Search the web via DuckDuckGo\'s HTML endpoint; returns title, url and snippet per result. No key needed. Follow up with forge_web_fetch to read a result.',
    inputSchema: z.object({ query: z.string().min(1).max(300).describe('Search query'), limit: z.number().int().min(1).max(25).default(10).describe('Max results') }),
    annotations: { ...RO, idempotentHint: false, openWorldHint: true },
  }, safe(async (a, ctx) => {
    const r = await httpGet('https://html.duckduckgo.com/html/?q=' + encodeURIComponent(a.query), { signal: ctx?.mcpReq?.signal });
    if (r.status !== 200) throw new UpstreamError(`DuckDuckGo returned HTTP ${r.status}; it may be rate limiting — retry later.`, r.status);
    const results = [];
    const re = /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?(?:class="result__snippet"[^>]*>([\s\S]*?)<\/a>)?/g;
    let m;
    while ((m = re.exec(r.text)) && results.length < a.limit) {
      let url = decode(m[1]);
      const ud = url.match(/[?&]uddg=([^&]+)/); if (ud) url = decodeURIComponent(ud[1]);
      if (url.startsWith('//')) url = 'https:' + url;
      const strip = (s) => decode((s || '').replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();
      results.push({ title: strip(m[2]), url, snippet: strip(m[3]) });
    }
    return ok({ query: a.query, count: results.length, results });
  }));

  server.registerTool('forge_github_repo', {
    title: 'GitHub repo facts',
    description: 'Unauthenticated GitHub REST lookup of one repo: stars, forks, pushed_at, license, default branch, archived, latest release. 60 req/h per IP limit.',
    inputSchema: z.object({ repo: z.string().regex(/^[\w.-]+\/[\w.-]+$/, 'Use "owner/name", e.g. "vercel/next.js"').describe('owner/name') }),
    annotations: { ...RO, openWorldHint: true },
  }, safe(async (a, ctx) => {
    const sig = ctx?.mcpReq?.signal; const h = { accept: 'application/vnd.github+json' };
    const j = await getJson('https://api.github.com/repos/' + a.repo, { headers: h, signal: sig });
    let latest = null;
    try { const rel = await getJson(`https://api.github.com/repos/${a.repo}/releases/latest`, { headers: h, signal: sig }); latest = { tag: rel.tag_name, published_at: rel.published_at, url: rel.html_url }; } catch (e) { if (e.status !== 404) latest = { error: e.message }; }
    return ok({ repo: j.full_name, description: j.description ?? null, stars: j.stargazers_count, forks: j.forks_count, open_issues: j.open_issues_count, pushed_at: j.pushed_at, license: j.license ? j.license.spdx_id : null, default_branch: j.default_branch, archived: !!j.archived, url: j.html_url, latest_release: latest });
  }));

  server.registerTool('forge_github_search', {
    title: 'GitHub repo search',
    description: 'Search GitHub repositories (unauthenticated, 10 req/min). Supports GitHub qualifiers like "language:js stars:>100". Returns name, stars, pushed_at, license.',
    inputSchema: z.object({
      query: z.string().min(1).max(256).describe('GitHub search query'),
      sort: z.enum(['best', 'stars', 'updated']).default('best').describe('Sort order'),
      limit: z.number().int().min(1).max(50).default(10).describe('Results per page'),
      page: z.number().int().min(1).max(10).default(1).describe('Page number (1-based)'),
    }),
    annotations: { ...RO, openWorldHint: true },
  }, safe(async (a, ctx) => {
    const qs = new URLSearchParams({ q: a.query, per_page: String(a.limit), page: String(a.page) }); if (a.sort !== 'best') qs.set('sort', a.sort);
    const j = await getJson('https://api.github.com/search/repositories?' + qs, { headers: { accept: 'application/vnd.github+json' }, signal: ctx?.mcpReq?.signal });
    const items = (j.items || []).map((r) => ({ repo: r.full_name, stars: r.stargazers_count, pushed_at: r.pushed_at, license: r.license ? r.license.spdx_id : null, description: r.description ?? null }));
    return ok({ query: a.query, total: j.total_count ?? items.length, page: a.page, has_more: a.page * a.limit < (j.total_count || 0), items });
  }));

  server.registerTool('forge_npm_package', {
    title: 'npm package facts',
    description: 'npm registry metadata for a package: latest (or given) version, last modified, license, unpacked size, file count, deps count, repository.',
    inputSchema: z.object({ name: z.string().regex(/^(@[a-z0-9._~-]+\/)?[a-z0-9._~-]+$/i, 'Invalid npm package name').describe('Package name, e.g. "zod" or "@scope/pkg"'), version: z.string().max(64).optional().describe('Version or dist-tag (default: latest)') }),
    annotations: { ...RO, openWorldHint: true },
  }, safe(async (a, ctx) => {
    const j = await getJson('https://registry.npmjs.org/' + a.name.replace('/', '%2F'), { signal: ctx?.mcpReq?.signal, maxBytes: 20_000_000 });
    const v = (j['dist-tags'] || {})[a.version || 'latest'] || a.version;
    const m = (j.versions || {})[v];
    if (!m) throw new UpstreamError(`Version "${a.version || 'latest'}" not found for ${a.name}. Known tags: ${Object.keys(j['dist-tags'] || {}).join(', ')}`);
    return ok({ name: j.name, version: v, modified: (j.time || {}).modified ?? null, published: (j.time || {})[v] ?? null, license: m.license ?? j.license ?? null, unpacked_size: m.dist?.unpackedSize ?? null, file_count: m.dist?.fileCount ?? null, dependencies: Object.keys(m.dependencies || {}).length, repository: typeof m.repository === 'string' ? m.repository : m.repository?.url ?? null, dist_tags: j['dist-tags'] || {} });
  }));

  server.registerTool('forge_cdn_check', {
    title: 'CDN URL check',
    description: 'Check whether a jsDelivr/unpkg/cdnjs URL exists and its size, via HEAD. Use before referencing a pinned script in a single-file app.',
    inputSchema: z.object({ url: z.string().url().describe('https URL on cdn.jsdelivr.net, unpkg.com or cdnjs.cloudflare.com') }),
    annotations: { ...RO, openWorldHint: true },
  }, safe(async (a, ctx) => {
    const u = new URL(a.url);
    if (!['cdn.jsdelivr.net', 'unpkg.com', 'cdnjs.cloudflare.com'].includes(u.hostname) || u.protocol !== 'https:') throw new UpstreamError('Only https URLs on cdn.jsdelivr.net, unpkg.com or cdnjs.cloudflare.com are checked.');
    const r = await httpGet(a.url, { method: 'HEAD', signal: ctx?.mcpReq?.signal });
    const len = r.headers.get('content-length');
    return ok({ url: a.url, final_url: r.url, exists: r.status >= 200 && r.status < 300, status: r.status, bytes: len ? +len : null, content_type: r.headers.get('content-type') });
  }));

  server.registerResource('forge-providers', 'forge://catalog/providers', { title: 'Forge provider catalog', description: 'Static JSON list of Forge providers with route tags', mimeType: 'application/json' },
    async (uri) => ({ contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify({ routes: ROUTES, providers: PROVIDERS }) }] }));
  server.registerResource('forge-readme', 'forge://readme', { title: 'Forge MCP readme', description: 'What this server offers and what route tags mean', mimeType: 'text/markdown' },
    async (uri) => ({ contents: [{ uri: uri.href, mimeType: 'text/markdown', text: README }] }));

  server.registerPrompt('forge_build_app', {
    title: 'Build a single-file app', description: 'Plan and build a single-file HTML app with pinned CDN deps and a Forge provider',
    argsSchema: z.object({ idea: z.string().describe('What the app should do') }),
  }, async ({ idea }) => ({ messages: [{ role: 'user', content: { type: 'text', text: `Build a single-file HTML app: ${idea}.\n1. Call forge_provider_catalog (route "direct", keyless true) to choose a model provider usable from file://.\n2. For each CDN library, pick an exact version with forge_npm_package and confirm the URL with forge_cdn_check.\n3. Output one self-contained HTML file; state the provider's route tag honestly.` } }] }));
  server.registerPrompt('forge_research_repos', {
    title: 'Research GitHub repos', description: 'Compare open-source repos for a topic by stars, activity and license',
    argsSchema: z.object({ topic: z.string().describe('Topic or library category'), count: z.string().optional().describe('How many repos to compare (default 5)') }),
  }, async ({ topic, count }) => ({ messages: [{ role: 'user', content: { type: 'text', text: `Find the top ${count || 5} GitHub repos for "${topic}" using forge_github_search (sort stars), then call forge_github_repo on each. Produce a table: repo, stars, last push, license, latest release. Flag archived or >12-month-stale repos.` } }] }));

  return server;
}
