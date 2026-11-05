#!/usr/bin/env node
// pr-cut CLI entry. Runs the TypeScript sources through tsx.
import { register } from 'tsx/esm/api';
register();
process.removeAllListeners('warning');
await import('../packages/pr-cut/src/cli.ts');
