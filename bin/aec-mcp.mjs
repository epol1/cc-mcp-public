#!/usr/bin/env node
// ae-compose MCP server entry (stdio). Runs the TypeScript sources through tsx.
import { register } from 'tsx/esm/api';
register();
await import('../src/mcp/server.ts');
