// Zero-dependency test: node test/run.mjs  (Node >= 20)
import http from 'node:http';
import assert from 'node:assert/strict';
const env = process.env;
const results = []; const t = async (name, fn) => { try { await fn(); results.push(['PASS', name]); } catch (e) { results.push(['FAIL', name, e.message]); } };

const srv = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/sse') {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'set-cookie': 'a=b' });
    let i = 0; const iv = setInterval(() => { res.write(`data: ${i}\n\n`); if (++i === 3) { clearInterval(iv); res.end(); } }, 150);
  } else if (u.pathname === '/echo') {
    let b = ''; req.on('data', (c) => b += c); req.on('end', () => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ auth: req.headers.authorization || null, cookie: req.headers.cookie || null, forge: req.headers['x-forge-token'] || null, body: b })); });
  } else if (u.pathname === '/redir-private') { res.writeHead(302, { location: 'https://10.0.0.1/x' }); res.end(); }
  else if (u.pathname === '/redir-ok') { res.writeHead(302, { location: '/echo' }); res.end(); }
  else if (u.pathname === '/or') { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ data: [{ id: 'meta/llama:free', name: 'Llama Free', context_length: 8192, pricing: { prompt: '0', completion: '0' } }, { id: 'openai/gpt-x', name: 'Paid', pricing: { prompt: '0.001', completion: '0.002' } }] })); }
  else if (u.pathname === '/po') { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify([{ name: 'openai', description: 'OpenAI GPT', context_length: 128000 }, 'mistral'])); }
  else if (u.pathname === '/page') { res.writeHead(200, { 'content-type': 'text/html' }); res.end('<html><head><title>Hi &amp; bye</title><script>evil()</script></head><body><h1>Head</h1><p>Para <a href="/next">Next</a></p></body></html>'); }
  else { res.writeHead(404); res.end(); }
});
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${srv.address().port}`;
const { default: proxy } = await import('../api/proxy.js');
const { default: health } = await import('../api/health.js');
const { default: models, normOpenRouter } = await import('../api/models.js');
const { default: fetchFn } = await import('../api/fetch.js');
const P = (url, init) => proxy(new Request('https://forge.test/api/proxy?url=' + encodeURIComponent(url), init));

// --- escape hatch disabled ---
delete env.FORGE_TEST_ALLOW_LOCAL;
await t('local blocked when FORGE_TEST_ALLOW_LOCAL unset', async () => { const r = await P(BASE + '/echo'); assert.equal(r.status, 400); });
await t('allowlist blocks unknown host', async () => { const r = await P('https://evil.example.com/x'); assert.equal(r.status, 403); assert.match((await r.json()).error, /allowlist/); });
for (const bad of ['https://127.0.0.1/', 'https://[::1]/', 'https://2130706433/', 'https://localhost/', 'https://metadata.google.internal/', 'https://printer.local/', 'https://u:p@openrouter.ai/', 'http://openrouter.ai/', 'https://openrouter.ai:8443/'])
  await t('SSRF block ' + bad, async () => { const r = await P(bad); assert.ok(r.status === 400 || r.status === 403, 'status ' + r.status); });
await t('FORGE_EXTRA_HOSTS extends allowlist', async () => {
  const { checkTarget } = await import('../api/_lib/guard.js');
  assert.ok(checkTarget('https://my.host.dev/').error); env.FORGE_EXTRA_HOSTS = 'my.host.dev'; assert.ok(!checkTarget('https://my.host.dev/').error); delete env.FORGE_EXTRA_HOSTS;
});
await t('CORS preflight', async () => { const r = await P('https://openrouter.ai/', { method: 'OPTIONS' }); assert.equal(r.status, 204); assert.equal(r.headers.get('access-control-allow-origin'), '*'); assert.match(r.headers.get('access-control-allow-headers'), /HTTP-Referer/); assert.match(r.headers.get('access-control-allow-headers'), /X-Forge-Token/); });

// --- escape hatch enabled ---
env.FORGE_TEST_ALLOW_LOCAL = '1';
await t('SSE streams incrementally', async () => {
  const t0 = Date.now(); const r = await P(BASE + '/sse'); assert.equal(r.status, 200); assert.equal(r.headers.get('set-cookie'), null);
  const rd = r.body.getReader(); const dec = new TextDecoder(); const stamps = []; let txt = '';
  for (;;) { const { done, value } = await rd.read(); if (done) break; txt += dec.decode(value); stamps.push(Date.now() - t0); }
  assert.equal((txt.match(/data:/g) || []).length, 3); assert.ok(stamps.length >= 2, 'chunks ' + stamps.length); assert.ok(stamps[stamps.length - 1] - stamps[0] >= 200, 'spread ' + stamps);
});
await t('POST passthrough strips cookie + x-forge-*', async () => { const r = await P(BASE + '/echo', { method: 'POST', body: '{"a":1}', headers: { cookie: 'sid=1', authorization: 'Bearer user', 'content-type': 'application/json' } }); const j = await r.json(); assert.equal(j.body, '{"a":1}'); assert.equal(j.cookie, null); assert.equal(j.auth, 'Bearer user'); });
await t('size cap 413', async () => { env.FORGE_MAX_BODY = '100'; const r = await P(BASE + '/echo', { method: 'POST', body: 'x'.repeat(500) }); assert.equal(r.status, 413); delete env.FORGE_MAX_BODY; });
await t('redirect to private blocked', async () => { const r = await P(BASE + '/redir-private'); assert.equal(r.status, 403); assert.match((await r.json()).error, /redirect blocked/); });
await t('redirect to same allowed host followed', async () => { const r = await P(BASE + '/redir-ok'); assert.equal(r.status, 200); assert.ok(r.headers.get('x-forge-final-url').endsWith('/echo')); });
await t('token gate', async () => {
  env.FORGE_ACCESS_TOKEN = 's3cret';
  assert.equal((await P(BASE + '/echo')).status, 401);
  assert.equal((await P(BASE + '/echo', { headers: { 'x-forge-token': 'nope' } })).status, 401);
  const r = await P(BASE + '/echo', { headers: { 'x-forge-token': 's3cret' } }); assert.equal(r.status, 200); assert.equal((await r.json()).forge, null);
  delete env.FORGE_ACCESS_TOKEN;
});
await t('server key injection gate', async () => {
  const { SERVER_KEYS } = await import('../api/_lib/guard.js'); SERVER_KEYS['127.0.0.1'] = ['FORGE_KEY_TESTHOST', 'bearer']; env.FORGE_KEY_TESTHOST = 'srvkey';
  const H = { 'x-forge-use-server-key': '1' };
  assert.equal((await P(BASE + '/echo', { headers: H })).status, 403, 'no token configured -> refuse');
  env.FORGE_ACCESS_TOKEN = 'tok';
  assert.equal((await P(BASE + '/echo', { headers: H })).status, 401, 'token missing');
  let j = await (await P(BASE + '/echo', { headers: { ...H, 'x-forge-token': 'tok', authorization: 'Bearer user' } })).json(); assert.equal(j.auth, 'Bearer srvkey');
  j = await (await P(BASE + '/echo', { headers: { 'x-forge-token': 'tok' } })).json(); assert.equal(j.auth, null, 'no header -> no injection');
  delete env.FORGE_ACCESS_TOKEN; delete env.FORGE_KEY_TESTHOST; delete SERVER_KEYS['127.0.0.1'];
});
await t('health JSON', async () => { env.FORGE_KEY_OPENROUTER = 'x'; const j = await (await health(new Request('https://f/api/health'))).json(); assert.equal(j.ok, true); assert.deepEqual(Object.keys(j.features), ['proxy', 'models', 'fetch', 'search', 'mcp']); assert.deepEqual(j.serverKeys, ['FORGE_KEY_OPENROUTER']); assert.ok(!JSON.stringify(j).includes('"x"')); delete env.FORGE_KEY_OPENROUTER; });
await t('models normalization + cache header', async () => {
  env.FORGE_MODELS_OPENROUTER_URL = BASE + '/or'; env.FORGE_MODELS_POLLINATIONS_URL = BASE + '/po';
  const r = await models(new Request('https://f/api/models')); const j = await r.json();
  assert.match(r.headers.get('cache-control'), /s-maxage=600/);
  assert.deepEqual(j.models, [{ provider: 'openrouter', id: 'meta/llama:free', label: 'Llama Free', free: true, context: 8192 }, { provider: 'pollinations', id: 'openai', label: 'OpenAI GPT', free: true, context: 128000 }, { provider: 'pollinations', id: 'mistral', label: 'mistral', free: true, context: null }]);
  assert.equal(normOpenRouter({}).length, 0);
});
await t('fetch extraction', async () => { const j = await (await fetchFn(new Request('https://f/api/fetch?url=' + encodeURIComponent(BASE + '/page')))).json(); assert.equal(j.title, 'Hi & bye'); assert.match(j.text, /# Head/); assert.ok(!j.text.includes('evil')); assert.equal(j.links[0].url, BASE + '/next'); });
delete env.FORGE_TEST_ALLOW_LOCAL;
await t('fetch SSRF guard', async () => { assert.equal((await fetchFn(new Request('https://f/api/fetch?url=' + encodeURIComponent(BASE + '/page')))).status, 400); assert.equal((await fetchFn(new Request('https://f/api/fetch?url=https://169.254.169.254/'))).status, 403); });

await t('search parse + validation', async () => {
  const { parseDdg, default: search } = await import('../api/search.js');
  const r = parseDdg('<a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fex.com%2Fa&amp;r=1">Ex <b>A</b></a><a class="result__snippet">S &amp; t</a><a class="result__a" href="javascript:alert(1)">bad</a>');
  assert.deepEqual(r, [{ title: 'Ex A', url: 'https://ex.com/a', snippet: 'S & t' }]);
  assert.equal((await search(new Request('https://f/api/search'))).status, 400);
  assert.deepEqual(parseDdg('<a class="result__a" href="https://x.org/">A &#abc; &#99999999; &#x41;</a>'), [{ title: 'A &#abc; &#99999999; A', url: 'https://x.org/', snippet: '' }]);
});
srv.close();
for (const r of results) console.log(r.join('  '));
const failed = results.filter((r) => r[0] === 'FAIL').length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
