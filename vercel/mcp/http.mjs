// Web-standard (fetch-style) HTTP handler: CORS, optional bearer auth, then the SDK's stateless handler.
import { createMcpHandler } from '@modelcontextprotocol/server';
import { createServer, VERSION } from './server.mjs';
export { setFetch } from './server.mjs';

export const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization,Content-Type,Accept,Mcp-Session-Id,Mcp-Protocol-Version,Last-Event-ID',
  'Access-Control-Expose-Headers': 'Mcp-Session-Id,Mcp-Protocol-Version',
  'Access-Control-Max-Age': '86400',
};
let _h;
const sdk = () => (_h ||= createMcpHandler(createServer, { onerror: (e) => console.error('[forge-mcp]', e) }));
const withCors = (res) => { const h = new Headers(res.headers); for (const [k, v] of Object.entries(CORS)) h.set(k, v); return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h }); };
const jerr = (status, code, message, extra = {}) => withCors(new Response(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code, message } }), { status, headers: { 'content-type': 'application/json', ...extra } }));

/** @param {Request} req @returns {Promise<Response>} */
export async function handle(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  const token = typeof process !== 'undefined' ? process.env.FORGE_MCP_TOKEN : undefined;
  if (token && req.headers.get('authorization') !== 'Bearer ' + token) return jerr(401, -32001, 'Unauthorized: send "Authorization: Bearer <FORGE_MCP_TOKEN>".', { 'www-authenticate': 'Bearer' });
  if (req.method === 'GET' && !(req.headers.get('accept') || '').includes('text/event-stream')) {
    return withCors(new Response(JSON.stringify({ name: 'forge-mcp', version: VERSION, transport: 'streamable-http (stateless)', endpoint: new URL(req.url).pathname, hint: 'POST JSON-RPC here with Accept: application/json, text/event-stream' }), { status: 200, headers: { 'content-type': 'application/json' } }));
  }
  try { return withCors(await sdk().fetch(req)); } catch (e) { console.error('[forge-mcp]', e); return jerr(500, -32603, 'Internal error: ' + (e && e.message)); }
}
