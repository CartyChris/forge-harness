// Readable extraction for the harness web_fetch tool. GET /api/fetch?url=<encoded>&max=<chars>
import { json, fail, preflight, checkTarget, tokenOk, safeFetch, envNum } from './_lib/guard.js';
export const config = { runtime: 'edge' };

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
const decode = (s) => s.replace(/&(#x?[0-9a-f]+|\w+);/gi, (m, e) => { if (e[0] !== '#') return ENT[e.toLowerCase()] ?? m; const hex = e[1].toLowerCase() === 'x'; const cp = parseInt(hex ? e.slice(2) : e.slice(1), hex ? 16 : 10); return Number.isFinite(cp) && cp >= 0 && cp <= 0x10FFFF ? String.fromCodePoint(cp) : m; });
export function extract(html, base) {
  const title = decode((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '').trim();
  let body = html.replace(/<(script|style|noscript|svg|template|iframe|head)[\s\S]*?<\/\1>/gi, ' ').replace(/<!--[\s\S]*?-->/g, ' ');
  const links = []; const seen = new Set();
  body = body.replace(/<a\b[^>]*href\s*=\s*["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi, (m, href, txt) => {
    const t = decode(txt.replace(/<[^>]+>/g, '')).trim();
    try { const u = new URL(decode(href), base).toString(); if (/^https?:/.test(u) && !seen.has(u) && links.length < 200) { seen.add(u); links.push({ text: t.slice(0, 120), url: u }); } return t ? `[${t}](${u})` : ''; } catch { return t; }
  });
  body = body.replace(/<h([1-6])[^>]*>/gi, (m, n) => '\n\n' + '#'.repeat(+n) + ' ').replace(/<li[^>]*>/gi, '\n- ')
    .replace(/<(br|\/p|\/div|\/h[1-6]|\/li|\/tr|p|div|tr|section|article)\b[^>]*>/gi, '\n').replace(/<[^>]+>/g, ' ');
  const text = decode(body).replace(/[ \t\f\v]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  return { title, text, links };
}
export default async function handler(req) {
  if (req.method === 'OPTIONS') return preflight();
  if (!tokenOk(req).ok) return fail(401, 'bad or missing x-forge-token');
  const sp = new URL(req.url).searchParams; const target = sp.get('url');
  if (!target) return fail(400, 'missing ?url=');
  const chk = checkTarget(target, 'public');
  if (chk.error) return fail(chk.status, chk.error);
  const maxBytes = envNum('FORGE_FETCH_MAX_BYTES', 2 * 1024 * 1024), maxChars = Math.min(Number(sp.get('max')) || 40000, 200000);
  const ac = new AbortController(); const timer = setTimeout(() => ac.abort(), envNum('FORGE_FETCH_TIMEOUT_MS', 10000));
  try {
    const res = await safeFetch(chk.url.toString(), { method: 'GET', signal: ac.signal, headers: { 'user-agent': 'ForgeFetch/2 (+https://vercel.com)', accept: 'text/html,text/plain,text/markdown,application/json;q=0.9,*/*;q=0.5' } }, 'public');
    if (res.error) return fail(res.status, res.error);
    const r = res.response; const ct = r.headers.get('content-type') || '';
    if (!/text\/|json|xml|markdown/i.test(ct)) { try { await r.body?.cancel(); } catch {} return fail(415, 'unsupported content-type: ' + ct); }
    const reader = r.body.getReader(); const chunks = []; let n = 0, truncated = false;
    for (;;) { const { done, value } = await reader.read(); if (done) break; n += value.byteLength; chunks.push(value); if (n >= maxBytes) { truncated = true; try { await reader.cancel(); } catch {} break; } }
    const raw = new TextDecoder().decode(chunks.length === 1 ? chunks[0] : new Uint8Array(await new Blob(chunks).arrayBuffer()));
    const isHtml = /html/i.test(ct);
    const ex = isHtml ? extract(raw, res.finalUrl) : { title: '', text: raw, links: [] };
    if (ex.text.length > maxChars) { ex.text = ex.text.slice(0, maxChars); truncated = true; }
    return json({ ok: r.ok, status: r.status, url: res.finalUrl, contentType: ct, title: ex.title, text: ex.text, links: ex.links, truncated, bytes: n }, 200, { 'cache-control': 'no-store' });
  } catch (e) {
    return fail(e?.name === 'AbortError' ? 504 : 502, 'fetch failed: ' + (e?.message || e));
  } finally { clearTimeout(timer); }
}
