#!/usr/bin/env node
// Local stdio entry: `node vercel/mcp/stdio.mjs` (Claude Desktop etc.). Never write to stdout.
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { createServer } from './server.mjs';
serveStdio(createServer);
console.error('forge-mcp running on stdio');
