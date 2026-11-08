// Forge hardened CORS gateway — Vercel Edge. GET|POST|OPTIONS /api/proxy?url=<encoded>  (alias /api/forge-proxy)
import { CORS, fail, preflight, checkTarget, cleanHeaders, tokenOk, safeFetch, readCapped, envNum, env, SERVER_KEYS } from './_lib/guard.js';
export const config = { runtime: 'edge' };

export default async function handler(req) {
  if (req.method === 'OPTIONS') return preflight();
  if (req.method !== 'GET' && req.method !== 'POST') return fail(405, 'method not allowed');
  const tok = tokenOk(req);
  if (!tok.ok) return fail(401, 'bad or missing x-forge-token');
  const target = new URL(req.url).searchParams.get('url');
  if (!target) return fail(400, 'missing ?url=');
  const chk = checkTarget(target, 'allowlist');
  if (chk.error) return fail(chk.status, chk.error);

  const cap = envNum('FORGE_MAX_BODY', 1024 * 1024);
  let body;
  if (req.method === 'POST') {
    const declared = Number(req.headers.get('content-length') || 0);
    if (declared > cap) return fail(413, 'request body too large');
    body = await readCapped(req.body, cap);
    if (body === null) return fail(413, 'request body too large');
  }

  const headers = cleanHeaders(req.headers, { request: true });
  if (req.headers.get('x-forge-use-server-key') === '1') {
    if (!tok.configured) return fail(403, 'server keys require FORGE_ACCESS_TOKEN to be configured');
    const spec = SERVER_KEYS[chk.url.hostname];
    const key = spec && env(spec[0]);
    if (!key) return fail(404, 'no server key for ' + chk.url.hostname);
    headers.delete('authorization'); headers.delete('x-api-key'); headers.delete('x-goog-api-key');
    if (spec[1] === 'bearer') headers.set('authorization', 'Bearer ' + key); else headers.set(spec[1], key);
  }
  headers.set('accept-encoding', 'identity');

  let res;
  try {
    res = await safeFetch(chk.url.toString(), { method: req.method, headers, body }, 'allowlist');
  } catch (e) {
    return fail(502, 'upstream fetch failed: ' + (e && e.message || e));
  }
  if (res.error) return fail(res.status, res.error);
  const up = res.response;
  const out = cleanHeaders(up.headers);
  for (const [k, v] of Object.entries(CORS)) out.set(k, v);
  out.set('x-forge-upstream-status', String(up.status));
  out.set('x-forge-final-url', res.finalUrl);
  out.set('cache-control', 'no-store');
  if ((up.headers.get('content-type') || '').includes('text/event-stream')) out.set('x-accel-buffering', 'no');
  return new Response(up.body, { status: up.status, headers: out }); // streamed passthrough (SSE-safe)
}
