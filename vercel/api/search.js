// Web search for the harness web_search tool. GET /api/search?q=<query>&n=<1..20>
// Uses DuckDuckGo's HTML endpoint server-side (no CORS limits here). Results: [{title,url,snippet}].
import { json, fail, preflight, tokenOk, safeFetch, envNum } from './_lib/guard.js';
export const config = { runtime: 'edge' };

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
const decode = (s) => s.replace(/&(#x?[0-9a-f]+|\w+);/gi, (m, e) => { if (e[0] !== '#') return ENT[e.toLowerCase()] ?? m; const hex = e[1].toLowerCase() === 'x'; const cp = parseInt(hex ? e.slice(2) : e.slice(1), hex ? 16 : 10); return Number.isFinite(cp) && cp >= 0 && cp <= 0x10FFFF ? String.fromCodePoint(cp) : m; });
const strip = (s) => decode(String(s || '').replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();

export function parseDdg(html, n = 8) {
  const out = []; const re = /<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>([\s\S]*?)(?=<a[^>]*class="[^"]*result__a|$)/gi;
  let m;
  while ((m = re.exec(html)) && out.length < n) {
    let url = decode(m[1]); const u = url.match(/uddg=([^&]+)/); if (u) url = decodeURIComponent(u[1]);
    if (url.startsWith('//')) url = 'https:' + url;
    if (!/^https?:\/\//.test(url)) continue;
    const sn = (m[3].match(/class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/(a|div|span)>/i) || [])[1];
    out.push({ title: strip(m[2]), url, snippet: strip(sn) });
  }
  return out;
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') return preflight();
  if (!tokenOk(req).ok) return fail(401, 'bad or missing x-forge-token');
  const sp = new URL(req.url).searchParams; const q = (sp.get('q') || '').trim();
  if (!q) return fail(400, 'missing ?q=');
  if (q.length > 400) return fail(400, 'query too long');
  const n = Math.max(1, Math.min(20, Number(sp.get('n')) || 8));
  const ac = new AbortController(); const timer = setTimeout(() => ac.abort(), envNum('FORGE_FETCH_TIMEOUT_MS', 10000));
  try {
    const res = await safeFetch('https://html.duckduckgo.com/html/?q=' + encodeURIComponent(q), { method: 'GET', signal: ac.signal, headers: { 'user-agent': 'Mozilla/5.0 (compatible; ForgeSearch/1)', accept: 'text/html' } }, 'public');
    if (res.error) return fail(res.status, res.error);
    const html = await res.response.text();
    return json({ ok: true, query: q, engine: 'duckduckgo-html', results: parseDdg(html, n) }, 200, { 'cache-control': 'no-store' });
  } catch (e) {
    return fail(e.name === 'AbortError' ? 504 : 502, 'search failed: ' + (e.message || e));
  } finally { clearTimeout(timer); }
}
