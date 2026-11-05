#!/usr/bin/env node
// pr-cut MCP server entry (stdio). Runs the TypeScript sources through tsx.
import { register } from 'tsx/esm/api';
register();
process.removeAllListeners('warning'); // node:sqlite's experimental warning would go to stderr on every start
await import('../packages/pr-cut/src/mcp/server.ts');
