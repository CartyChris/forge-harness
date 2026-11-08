// Aggregated free-model catalog: OpenRouter (:free / zero-priced) + Pollinations. Edge-cached.
import { json, preflight, env } from './_lib/guard.js';
export const config = { runtime: 'edge' };
const OR = () => env('FORGE_MODELS_OPENROUTER_URL') || 'https://openrouter.ai/api/v1/models';
const PO = () => env('FORGE_MODELS_POLLINATIONS_URL') || 'https://text.pollinations.ai/models';

async function getJSON(url, ms = 8000) {
  const ac = new AbortController(); const t = setTimeout(() => ac.abort(), ms);
  try { const r = await fetch(url, { signal: ac.signal, headers: { accept: 'application/json' } }); if (!r.ok) throw new Error('HTTP ' + r.status); return await r.json(); }
  finally { clearTimeout(t); }
}
export function normOpenRouter(j) {
  const list = Array.isArray(j?.data) ? j.data : [];
  return list.filter((m) => m && typeof m.id === 'string').map((m) => {
    const p = m.pricing || {};
    const free = m.id.endsWith(':free') || (Number(p.prompt) === 0 && Number(p.completion) === 0);
    return { provider: 'openrouter', id: m.id, label: m.name || m.id, free, context: Number(m.context_length) || null };
  }).filter((m) => m.free);
}
export function normPollinations(j) {
  const list = Array.isArray(j) ? j : Array.isArray(j?.models) ? j.models : [];
  return list.map((m) => typeof m === 'string' ? { name: m } : m).filter((m) => m && (m.name || m.id)).map((m) => ({
    provider: 'pollinations', id: String(m.name || m.id), label: m.description || String(m.name || m.id), free: true,
    context: Number(m.context_length || m.contextWindow) || null,
  }));
}
export default async function handler(req) {
  if (req.method === 'OPTIONS') return preflight();
  const [a, b] = await Promise.allSettled([getJSON(OR()), getJSON(PO())]);
  const models = [...(a.status === 'fulfilled' ? normOpenRouter(a.value) : []), ...(b.status === 'fulfilled' ? normPollinations(b.value) : [])];
  const errors = {};
  if (a.status === 'rejected') errors.openrouter = String(a.reason?.message || a.reason);
  if (b.status === 'rejected') errors.pollinations = String(b.reason?.message || b.reason);
  const ok = models.length > 0;
  return json({ ok, time: new Date().toISOString(), count: models.length, models, errors }, ok ? 200 : 502,
    { 'cache-control': ok ? 'public, s-maxage=600, stale-while-revalidate=3600' : 'no-store' });
}
