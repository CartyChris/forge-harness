import { json, preflight, serverKeyNames, VERSION, env } from './_lib/guard.js';
export const config = { runtime: 'edge' };
export default async function handler(req) {
  if (req.method === 'OPTIONS') return preflight();
  return json({
    ok: true, version: VERSION, time: new Date().toISOString(),
    features: { proxy: true, models: true, fetch: true, search: true, mcp: true },
    tokenRequired: !!env('FORGE_ACCESS_TOKEN'),
    serverKeys: serverKeyNames(),
  }, 200, { 'cache-control': 'no-store' });
}
