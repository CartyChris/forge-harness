// Shared hardening helpers for Forge Edge functions. Files under api/_lib are not routed by Vercel.
export const VERSION = '2.0.0';
const env = (k) => (typeof process !== 'undefined' && process.env ? process.env[k] : undefined);

export const BASE_HOSTS = [
  'text.pollinations.ai', 'openrouter.ai', 'api.deepseek.com', 'integrate.api.nvidia.com', 'api.venice.ai',
  'api.meganova.ai', 'api.orcarouter.ai', 'control.dulus.ai', 'uncloseai.com', 'g4f.dev', 'api.openai.com',
  'api.groq.com', 'generativelanguage.googleapis.com', 'api.mistral.ai', 'api.together.xyz', 'api.cerebras.ai',
  'api.x.ai', 'api.anthropic.com', 'r.jina.ai', 'html.duckduckgo.com',
];
// host -> env var holding a server-side key, and how to send it
export const SERVER_KEYS = {
  'openrouter.ai': ['FORGE_KEY_OPENROUTER', 'bearer'], 'api.deepseek.com': ['FORGE_KEY_DEEPSEEK', 'bearer'],
  'integrate.api.nvidia.com': ['FORGE_KEY_NVIDIA', 'bearer'], 'api.venice.ai': ['FORGE_KEY_VENICE', 'bearer'],
  'api.openai.com': ['FORGE_KEY_OPENAI', 'bearer'], 'api.groq.com': ['FORGE_KEY_GROQ', 'bearer'],
  'api.mistral.ai': ['FORGE_KEY_MISTRAL', 'bearer'], 'api.together.xyz': ['FORGE_KEY_TOGETHER', 'bearer'],
  'api.cerebras.ai': ['FORGE_KEY_CEREBRAS', 'bearer'], 'api.x.ai': ['FORGE_KEY_XAI', 'bearer'],
  'api.anthropic.com': ['FORGE_KEY_ANTHROPIC', 'x-api-key'], 'generativelanguage.googleapis.com': ['FORGE_KEY_GEMINI', 'x-goog-api-key'],
};
export const serverKeyNames = () => Object.values(SERVER_KEYS).map(([k]) => k).filter((k) => !!env(k));

export const testLocal = () => env('FORGE_TEST_ALLOW_LOCAL') === '1';
export function allowedHosts() {
  const extra = (env('FORGE_EXTRA_HOSTS') || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  return new Set([...BASE_HOSTS, ...extra]);
}

export const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization,Content-Type,Accept,HTTP-Referer,X-Title,X-Forge-Token,X-Forge-Use-Server-Key,X-Forge-Client,X-Api-Key,Anthropic-Version,X-Goog-Api-Key',
  'Access-Control-Expose-Headers': 'Content-Type,X-Forge-Upstream-Status,X-Forge-Final-Url',
  'Access-Control-Max-Age': '86400',
};
export function json(obj, status = 200, extra = {}) {
  return new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json; charset=utf-8', ...CORS, ...extra } });
}
export const fail = (status, error) => json({ ok: false, error }, status);
export const preflight = () => new Response(null, { status: 204, headers: CORS });

const isIPv4 = (h) => /^\d{1,3}(\.\d{1,3}){3}$/.test(h) || /^0x[0-9a-f]+$/i.test(h) || /^\d+$/.test(h);
const isIPv6 = (h) => h.startsWith('[') || h.includes(':');
const BAD_SUFFIX = ['.internal', '.local', '.localhost', '.localdomain', '.lan', '.home', '.intranet', '.corp'];

/** Validate a target URL. mode 'allowlist' (proxy) or 'public' (fetch). Returns {url} or {error,status}. */
export function checkTarget(raw, mode = 'allowlist') {
  let u;
  try { u = new URL(raw); } catch { return { status: 400, error: 'invalid url' }; }
  const host = u.hostname.toLowerCase().replace(/\.$/, '');
  const local = testLocal() && (host === '127.0.0.1' || host === 'localhost');
  if (local) return { url: u };
  if (u.protocol !== 'https:') return { status: 400, error: 'https only' };
  if (u.username || u.password) return { status: 400, error: 'credentials in url not allowed' };
  if (u.port && u.port !== '443') return { status: 400, error: 'non-standard port not allowed' };
  if (isIPv4(host) || isIPv6(host)) return { status: 403, error: 'ip literal not allowed' };
  if (host === 'localhost' || !host.includes('.') || BAD_SUFFIX.some((s) => host.endsWith(s))) return { status: 403, error: 'private host not allowed' };
  if (mode === 'allowlist' && !allowedHosts().has(host)) return { status: 403, error: 'host not in allowlist: ' + host };
  return { url: u };
}

const HOP = ['connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer', 'trailers',
  'transfer-encoding', 'upgrade', 'host', 'cookie', 'set-cookie', 'content-length', 'forwarded', 'origin', 'referer'];
export function cleanHeaders(h, { request = false } = {}) {
  const out = new Headers();
  for (const [k, v] of h) {
    const l = k.toLowerCase();
    if (HOP.includes(l) || l.startsWith('x-forwarded-') || l.startsWith('x-vercel-') || l.startsWith('x-real-ip') || l.startsWith('cf-')) continue;
    if (request && l.startsWith('x-forge-')) continue;
    if (!request && (l === 'content-encoding' || l.startsWith('access-control-'))) continue;
    out.set(k, v);
  }
  return out;
}

/** Token gate: if FORGE_ACCESS_TOKEN is set, require x-forge-token to match. */
export function tokenOk(req) {
  const want = env('FORGE_ACCESS_TOKEN');
  if (!want) return { ok: true, configured: false };
  const got = req.headers.get('x-forge-token') || '';
  let diff = got.length ^ want.length;
  for (let i = 0; i < want.length; i++) diff |= want.charCodeAt(i) ^ (got.charCodeAt(i) || 0);
  return { ok: diff === 0, configured: true };
}

/** fetch with manual redirect following, re-validating every hop. */
export async function safeFetch(url, init, mode, maxHops = 5) {
  let cur = url;
  for (let i = 0; i <= maxHops; i++) {
    const r = await fetch(cur, { ...init, redirect: 'manual' });
    if (r.status >= 300 && r.status < 400 && r.headers.get('location')) {
      const next = new URL(r.headers.get('location'), cur).toString();
      const chk = checkTarget(next, mode);
      if (chk.error) { try { await r.body?.cancel(); } catch {} return { error: 'redirect blocked: ' + chk.error, status: 403 }; }
      try { await r.body?.cancel(); } catch {}
      if (r.status === 303 || ((r.status === 301 || r.status === 302) && init.method === 'POST')) init = { ...init, method: 'GET', body: undefined };
      cur = chk.url.toString();
      continue;
    }
    return { response: r, finalUrl: cur.toString() };
  }
  return { error: 'too many redirects', status: 508 };
}

/** Read a request body with a byte cap. Returns Uint8Array or null (too large). */
export async function readCapped(stream, cap) {
  if (!stream) return new Uint8Array(0);
  const reader = stream.getReader(); const parts = []; let n = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    n += value.byteLength;
    if (n > cap) { try { await reader.cancel(); } catch {} return null; }
    parts.push(value);
  }
  const out = new Uint8Array(n); let o = 0;
  for (const p of parts) { out.set(p, o); o += p.byteLength; }
  return out;
}
export const envNum = (k, d) => { const v = Number(env(k)); return Number.isFinite(v) && v > 0 ? v : d; };
export { env };
