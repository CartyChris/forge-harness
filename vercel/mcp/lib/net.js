// Self-contained network helpers for the Forge MCP server (copy of A10's guard pattern; no imports from api/_lib).
/** @type {typeof fetch} */
let _fetch = (...a) => globalThis.fetch(...a);
/** Inject a fetch implementation (tests use a mock). @param {typeof fetch} f */
export function setFetch(f) { _fetch = f || ((...a) => globalThis.fetch(...a)); }
export const UA = 'forge-mcp/0.1 (+https://github.com/)';
const isIPv4 = (h) => /^\d{1,3}(\.\d{1,3}){3}$/.test(h) || /^0x[0-9a-f]+$/i.test(h) || /^\d+$/.test(h);
const isIPv6 = (h) => h.startsWith('[') || h.includes(':');
const BAD_SUFFIX = ['.internal', '.local', '.localhost', '.localdomain', '.lan', '.home', '.intranet', '.corp'];

/** SSRF guard for user-supplied URLs. @param {string} raw @returns {{url?:URL,error?:string}} */
export function checkPublicUrl(raw) {
  let u;
  try { u = new URL(raw); } catch { return { error: 'Invalid URL. Pass an absolute https:// URL, e.g. https://example.com/page' }; }
  const host = u.hostname.toLowerCase().replace(/\.$/, '');
  if (u.protocol !== 'https:') return { error: 'Only https:// URLs are allowed.' };
  if (u.username || u.password) return { error: 'Credentials in the URL are not allowed.' };
  if (u.port && u.port !== '443') return { error: 'Non-standard ports are not allowed.' };
  if (isIPv4(host) || isIPv6(host)) return { error: 'IP-literal hosts are not allowed; use a public hostname.' };
  if (host === 'localhost' || !host.includes('.') || BAD_SUFFIX.some((s) => host.endsWith(s))) return { error: 'Private/internal hostnames are not allowed.' };
  return { url: u };
}

export class UpstreamError extends Error {
  /** @param {string} msg @param {number} [status] */
  constructor(msg, status) { super(msg); this.status = status; }
}

/**
 * Fetch with timeout, size cap, manual redirects (each hop re-checked by the SSRF guard when guard=true).
 * @param {string} url @param {{headers?:Record<string,string>,method?:string,body?:string,timeoutMs?:number,maxBytes?:number,guard?:boolean,signal?:AbortSignal}} [o]
 * @returns {Promise<{status:number,headers:Headers,text:string,url:string,truncated:boolean}>}
 */
export async function httpGet(url, o = {}) {
  const { timeoutMs = 10000, maxBytes = 2_000_000, guard = false } = o;
  let current = url;
  for (let hop = 0; hop < 5; hop++) {
    if (guard) { const c = checkPublicUrl(current); if (c.error) throw new UpstreamError('Blocked URL: ' + c.error, 400); }
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), timeoutMs);
    if (o.signal) o.signal.addEventListener('abort', () => ac.abort(), { once: true });
    let r;
    try {
      r = await _fetch(current, { method: o.method || 'GET', body: o.body, headers: { 'user-agent': UA, ...(o.headers || {}) }, redirect: 'manual', signal: ac.signal });
    } catch (e) {
      clearTimeout(t);
      throw new UpstreamError(ac.signal.aborted ? `Timed out after ${timeoutMs}ms fetching ${new URL(current).host}` : `Network error fetching ${new URL(current).host}: ${e && e.message}`);
    }
    if (r.status >= 300 && r.status < 400 && r.headers.get('location')) { clearTimeout(t); current = new URL(r.headers.get('location'), current).href; continue; }
    let text = await r.text(); clearTimeout(t);
    const truncated = text.length > maxBytes; if (truncated) text = text.slice(0, maxBytes);
    return { status: r.status, headers: r.headers, text, url: current, truncated };
  }
  throw new UpstreamError('Too many redirects (max 5).');
}

/** GET JSON; throws UpstreamError with an actionable message on non-2xx. */
export async function getJson(url, o = {}) {
  const r = await httpGet(url, { ...o, headers: { accept: 'application/json', ...(o.headers || {}) } });
  if (r.status === 404) throw new UpstreamError(`Not found (404): ${url}. Check the name/spelling.`, 404);
  if (r.status === 403 || r.status === 429) throw new UpstreamError(`Rate limited or forbidden (${r.status}) by ${new URL(url).host}. Wait and retry, or reduce calls.`, r.status);
  if (r.status < 200 || r.status >= 300) throw new UpstreamError(`Upstream ${new URL(url).host} returned HTTP ${r.status}.`, r.status);
  try { return JSON.parse(r.text); } catch { throw new UpstreamError(`Upstream ${new URL(url).host} returned non-JSON.`); }
}

/** Crude readable-text extraction from HTML (no deps). @param {string} html */
export function extractReadable(html) {
  const title = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '';
  let body = html.replace(/<(script|style|noscript|svg|nav|footer|header|form|iframe)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr)[^>]*>/gi, '\n')
    .replace(/<h([1-6])[^>]*>/gi, (_, n) => '\n' + '#'.repeat(+n) + ' ')
    .replace(/<li[^>]*>/gi, '\n- ')
    .replace(/<[^>]+>/g, ' ');
  body = decode(body).replace(/[ \t\f\v]+/g, ' ').replace(/\n\s*\n\s*\n+/g, '\n\n').trim();
  return { title: decode(title).trim(), text: body };
}
export function decode(s) {
  return s.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&#x27;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n)).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));
}
