#!/usr/bin/env node
// Builds the ES3 runtime: src/runtime/index.ts → dist/runtime/aec-runtime.jsx (Rollup + Babel + ES3 post-pass).
// The bundle publishes itself as $.global.AEC; RUNTIME_VERSION is a content hash so the bridge can reload when stale.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { rollup } from 'rollup';
import { babel } from '@rollup/plugin-babel';
import { nodeResolve } from '@rollup/plugin-node-resolve';
import es3 from './es3-postpass.mjs';
import { es3BabelOptions } from './babel.config.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const extensions = ['.ts', '.js'];
const outDir = path.join(root, 'dist/runtime');
const outFile = path.join(outDir, 'aec-runtime.jsx');

export async function buildRuntime({ quiet = false } = {}) {
  const t0 = Date.now();
  const bundle = await rollup({
    input: path.join(root, 'src/runtime/index.ts'),
    treeshake: true,
    onwarn(w, warn) { if (w.code === 'CIRCULAR_DEPENDENCY') return; warn(w); },
    plugins: [nodeResolve({ extensions }), babel({ ...es3BabelOptions, extensions, babelHelpers: 'bundled' }), es3()],
  });
  const { output } = await bundle.generate({
    format: 'iife', strict: false, freeze: false, esModule: false, externalLiveBindings: false,
    generatedCode: { preset: 'es5', reservedNamesAsProps: false, symbols: false }, indent: false,
  });
  await bundle.close();
  let code = output[0].code;
  const version = crypto.createHash('sha1').update(code).digest('hex').slice(0, 12);
  code = code.replace(/__AEC_RUNTIME_VERSION__/g, version);
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(outFile, `// ae-compose runtime ${version} (generated; do not edit)\n` + code);
  fs.writeFileSync(path.join(outDir, 'version.json'), JSON.stringify({ version, bytes: code.length, builtAt: new Date().toISOString() }, null, 1));
  if (!quiet) console.log(`runtime ${version}: ${(code.length / 1024).toFixed(1)} KB in ${Date.now() - t0} ms → ${path.relative(root, outFile)}`);
  return { version, file: outFile, code };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  buildRuntime().catch((e) => { console.error(e.message || e); process.exit(1); });
}
