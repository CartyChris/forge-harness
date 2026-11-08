// Failable self-check: stdio + HTTP handler + mocked network tools. Exit 1 on any failure.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { strict as assert } from 'node:assert';
import { handle, setFetch } from '../http.mjs';
const here = fileURLToPath(new URL('..', import.meta.url));
let pass = 0, fail = 0;
const t = async (name, fn) => { try { await fn(); pass++; console.log('ok  ', name); } catch (e) { fail++; console.log('FAIL', name, '-', e.message); } };
const INIT = { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'selfcheck', version: '0' } } };

// ---- stdio ----
await t('stdio initialize → tools/list → tools/call', async () => {
  const p = spawn(process.execPath, ['stdio.mjs'], { cwd: here, stdio: ['pipe', 'pipe', 'pipe'] });
  let buf = ''; const got = new Map();
  p.stdout.on('data', (d) => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { const l = buf.slice(0, i); buf = buf.slice(i + 1); if (l.trim()) { const m = JSON.parse(l); if (m.id != null) got.set(m.id, m); } } });
  const send = (m) => p.stdin.write(JSON.stringify(m) + '\n');
  const wait = (id) => new Promise((res, rej) => { const s = Date.now(); const iv = setInterval(() => { if (got.has(id)) { clearInterval(iv); res(got.get(id)); } else if (Date.now() - s > 5000) { clearInterval(iv); rej(new Error('timeout id ' + id)); } }, 20); });
  try {
    send(INIT); const init = await wait(1); assert.equal(init.result.serverInfo.name, 'forge-mcp');
    send({ jsonrpc: '2.0', method: 'notifications/initialized' });
    send({ jsonrpc: '2.0', id: 2, method: 'tools/list' }); const tl = await wait(2);
    const names = tl.result.tools.map((x) => x.name);
    for (const n of ['forge_provider_catalog', 'forge_free_models', 'forge_web_fetch', 'forge_web_search', 'forge_github_repo', 'forge_github_search', 'forge_npm_package', 'forge_cdn_check']) assert.ok(names.includes(n), 'missing ' + n);
    assert.ok(tl.result.tools.every((x) => x.annotations && x.annotations.readOnlyHint === true && 'openWorldHint' in x.annotations), 'annotations');
    send({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'forge_provider_catalog', arguments: { route: 'direct', keyless: true } } }); const c = await wait(3);
    assert.deepEqual(c.result.structuredContent.items.map((x) => x.id), ['pollinations']);
    assert.deepEqual(JSON.parse(c.result.content[0].text), c.result.structuredContent);
    send({ jsonrpc: '2.0', id: 4, method: 'resources/read', params: { uri: 'forge://catalog/providers' } }); const r = await wait(4);
    assert.equal(JSON.parse(r.result.contents[0].text).providers.length, 10);
    send({ jsonrpc: '2.0', id: 5, method: 'prompts/list' }); const pl = await wait(5);
    assert.deepEqual(pl.result.prompts.map((x) => x.name).sort(), ['forge_build_app', 'forge_research_repos']);
  } finally { p.kill(); }
});

// ---- HTTP handler ----
const post = (body, headers = {}) => handle(new Request('https://x.test/api/mcp', { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) }));
const rpc = async (res) => { const txt = await res.text(); const ct = res.headers.get('content-type') || ''; if (ct.includes('event-stream')) { const d = txt.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim()).filter(Boolean); return JSON.parse(d[d.length - 1]); } return JSON.parse(txt); };
await t('http initialize', async () => { const r = await post(INIT); assert.equal(r.status, 200); assert.equal(r.headers.get('access-control-allow-origin'), '*'); assert.equal((await rpc(r)).result.serverInfo.name, 'forge-mcp'); });
await t('http tools/list', async () => { const r = await post({ jsonrpc: '2.0', id: 2, method: 'tools/list' }, { 'mcp-protocol-version': '2025-06-18' }); assert.equal((await rpc(r)).result.tools.length, 8); });
await t('http tools/call provider_catalog paging', async () => { const j = await rpc(await post({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'forge_provider_catalog', arguments: { limit: 3, offset: 0 } } }, { 'mcp-protocol-version': '2025-06-18' })); assert.equal(j.result.structuredContent.count, 3); assert.equal(j.result.structuredContent.next_offset, 3); assert.equal(j.result.structuredContent.total, 10); });
await t('http bad method → -32601', async () => { const j = await rpc(await post({ jsonrpc: '2.0', id: 4, method: 'nope/nope' }, { 'mcp-protocol-version': '2025-06-18' })); assert.equal(j.error.code, -32601); });
await t('http bad JSON → 400 parse error', async () => { const r = await post('{not json', { 'mcp-protocol-version': '2025-06-18' }); assert.ok(r.status >= 400 && r.status < 500, 'status ' + r.status); const j = await r.json(); assert.equal(j.error.code, -32700); });
await t('http GET (browser) → info 200', async () => { const r = await handle(new Request('https://x.test/api/mcp')); assert.equal(r.status, 200); assert.equal((await r.json()).name, 'forge-mcp'); });
await t('http GET SSE → 405 (stateless)', async () => { const r = await handle(new Request('https://x.test/api/mcp', { headers: { accept: 'text/event-stream' } })); assert.equal(r.status, 405); });
await t('http CORS preflight → 204', async () => { const r = await handle(new Request('https://x.test/api/mcp', { method: 'OPTIONS' })); assert.equal(r.status, 204); assert.match(r.headers.get('access-control-allow-headers'), /Mcp-Protocol-Version/); });
await t('http bearer auth when FORGE_MCP_TOKEN set', async () => { process.env.FORGE_MCP_TOKEN = 's3cret'; try { assert.equal((await post(INIT)).status, 401); assert.equal((await post(INIT, { authorization: 'Bearer s3cret' })).status, 200); } finally { delete process.env.FORGE_MCP_TOKEN; } });

// ---- mocked network tools ----
const call = async (name, args) => (await rpc(await post({ jsonrpc: '2.0', id: 9, method: 'tools/call', params: { name, arguments: args } }, { 'mcp-protocol-version': '2025-06-18' }))).result;
const mock = (routes) => setFetch(async (url) => { for (const [re, fn] of routes) if (re.test(url)) return fn(url); return new Response('nf', { status: 404 }); });
await t('web_fetch SSRF blocks localhost/IP/http', async () => { for (const u of ['https://127.0.0.1/', 'https://localhost/', 'http://example.com/', 'https://a.internal/', 'https://example.com:8443/']) { const r = await call('forge_web_fetch', { url: u }); assert.ok(r.isError, 'not blocked: ' + u); } });
await t('web_fetch blocks redirect to private host', async () => { mock([[/example\.com/, () => new Response('', { status: 302, headers: { location: 'https://10.0.0.1/' } })]]); const r = await call('forge_web_fetch', { url: 'https://example.com/' }); assert.ok(r.isError); assert.match(r.content[0].text, /Blocked/); });
await t('web_fetch extracts readable text + paging', async () => { mock([[/example\.com/, () => new Response('<html><title>Hi &amp; bye</title><script>x()</script><h1>Head</h1><p>' + 'a'.repeat(500) + '</p></html>', { headers: { 'content-type': 'text/html' } })]]); const s = (await call('forge_web_fetch', { url: 'https://example.com/', max_chars: 200 })).structuredContent; assert.equal(s.title, 'Hi & bye'); assert.ok(!s.text.includes('x()')); assert.equal(s.next_start_char, 200); });
await t('free_models merges OpenRouter+Pollinations', async () => { mock([[/openrouter/, () => Response.json({ data: [{ id: 'a/b:free', name: 'B', context_length: 8000 }, { id: 'c/d', pricing: { prompt: '0.1', completion: '0.1' } }] })], [/pollinations/, () => Response.json([{ name: 'openai', description: 'GPT' }])]]); const s = (await call('forge_free_models', {})).structuredContent; assert.deepEqual(s.items.map((x) => x.id), ['a/b:free', 'openai']); });
await t('github_repo + 404 is actionable', async () => { mock([[/releases\/latest/, () => Response.json({ tag_name: 'v1', published_at: 'p', html_url: 'u' })], [/repos\/o\/r$/, () => Response.json({ full_name: 'o/r', stargazers_count: 5, pushed_at: 'z', license: { spdx_id: 'MIT' } })]]); const s = (await call('forge_github_repo', { repo: 'o/r' })).structuredContent; assert.equal(s.stars, 5); assert.equal(s.latest_release.tag, 'v1'); const e = await call('forge_github_repo', { repo: 'o/missing' }); assert.ok(e.isError); assert.match(e.content[0].text, /404/); });
await t('npm_package + cdn_check + web_search', async () => { mock([[/registry\.npmjs/, () => Response.json({ name: 'zod', 'dist-tags': { latest: '4.6.7' }, time: { modified: 'm' }, versions: { '4.6.7': { license: 'MIT', dist: { unpackedSize: 99 } } } })], [/jsdelivr/, () => new Response(null, { status: 200, headers: { 'content-length': '1234' } })], [/duckduckgo/, () => new Response('<a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fzod.dev%2F">Zod</a><a class="result__snippet">TS schemas</a>')]]); assert.equal((await call('forge_npm_package', { name: 'zod' })).structuredContent.unpacked_size, 99); assert.equal((await call('forge_cdn_check', { url: 'https://cdn.jsdelivr.net/npm/zod@4.6.7' })).structuredContent.bytes, 1234); const w = (await call('forge_web_search', { query: 'zod' })).structuredContent; assert.equal(w.results[0].url, 'https://zod.dev/'); });
setFetch(null);
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
