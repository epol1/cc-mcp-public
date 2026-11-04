// Loads a TSX scene file (or TSX source text) with esbuild: JSX → our runtime, dev mode for source locations.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import type { SceneDef } from '../dsl/scene.ts';
import { isScene } from '../dsl/scene.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DSL = path.join(ROOT, 'src/dsl/index.ts');
const JSX = path.join(ROOT, 'src/dsl/jsx-runtime.ts');
const CACHE = path.join(os.tmpdir(), 'ae-compose-scenes');

export interface LoadedScene { def: SceneDef<any>; file: string }

export async function loadScene(input: { file?: string; source?: string; cwd?: string }): Promise<LoadedScene> {
  let file = input.file ? path.resolve(input.file) : '';
  if (!file && input.source === undefined) throw new Error('loadScene needs a file path or TSX source');
  const stdin = input.source !== undefined ? { contents: input.source, loader: 'tsx' as const, resolveDir: input.cwd ?? process.cwd(), sourcefile: 'scene.tsx' } : undefined;
  const r = await build({
    entryPoints: stdin ? undefined : [file],
    stdin,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    write: false,
    jsx: 'automatic',
    jsxDev: true,
    jsxImportSource: 'ae-compose',
    alias: { 'ae-compose/jsx-dev-runtime': JSX, 'ae-compose/jsx-runtime': JSX, 'ae-compose': DSL },
    sourcemap: 'inline',
    packages: 'external',
    logLevel: 'silent',
  }).catch((e: any) => {
    const msg = (e.errors ?? []).map((x: any) => `${x.location?.file ?? 'scene'}:${x.location?.line ?? '?'}:${x.location?.column ?? '?'}: ${x.text}`).join('\n');
    throw new Error(`scene does not compile:\n${msg || e.message}`);
  });
  const code = r.outputFiles[0].text;
  fs.mkdirSync(CACHE, { recursive: true });
  const tmp = path.join(CACHE, crypto.createHash('sha1').update(code).digest('hex').slice(0, 16) + '.mjs');
  if (!fs.existsSync(tmp)) fs.writeFileSync(tmp, code);
  const mod = await import(pathToFileURL(tmp).href);
  const def = mod.default;
  if (!isScene(def)) throw new Error('the scene file must `export default scene({ name, duration, ... }, () => <Composition>...</Composition>)`');
  if (!file) file = path.join(input.cwd ?? process.cwd(), 'scene.tsx');
  return { def, file };
}
