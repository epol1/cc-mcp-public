#!/usr/bin/env node
// ae-compose CLI entry: runs the TypeScript sources directly through tsx (no build step for Node code).
import { register } from 'tsx/esm/api';
register();
await import('../src/cli/main.ts');
