// Vercel Function: Forge MCP server over stateless Streamable HTTP at /api/mcp. Logic lives in vercel/mcp/.
import { handle } from '../mcp/http.mjs';
export const config = { runtime: 'nodejs', maxDuration: 30 };
export const GET = handle, POST = handle, DELETE = handle, OPTIONS = handle;
