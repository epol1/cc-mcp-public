// The ae-compose expression library (F1, D73). One ES5 source (aec-lib.js, an object literal of functions) is both
// the `aec-lib.jsx` footage item a scene can share (`lib: 'footage'`) and the source the compiler inlines from:
// generated expressions read `var L = aecLib();`, call `L.spring(...)`, and carry only the functions they use (plus
// what those call through `this.`) as one `function aecLib() {…}` line under the header comment. (Not at the bottom:
// AE takes a trailing function declaration as the expression's value.) The call lines are the same in both modes.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'acorn';

export type LibMode = 'inline' | 'footage';

export const LIB_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'aec-lib.js');
export const LIB_SOURCE = fs.readFileSync(LIB_FILE, 'utf8');
/** Project item name expressions look the library up by (footage mode). */
export const LIB_ITEM = 'aec-lib.jsx';
/** Ends the inlined definition line; the inspector recognises it. */
export const LIB_MARK = '// aec-lib';

interface LibFn { name: string; src: string; deps: string[] }
let FNS: Map<string, LibFn> | null = null;
let VERSION = '';

function load(): Map<string, LibFn> {
  if (FNS) return FNS;
  const ast: any = parse(`(${LIB_SOURCE})`, { ecmaVersion: 5 });
  const obj = ast.body[0].expression;
  FNS = new Map();
  for (const p of obj.properties) {
    const name = p.key.type === 'Literal' ? String(p.key.value) : p.key.name;
    if (p.value.type === 'Literal') { if (name === 'version') VERSION = String(p.value.value); continue; }
    if (p.value.type !== 'FunctionExpression') continue;
    // Offsets are into "(" + source + ")".
    const src = `(${LIB_SOURCE})`.slice(p.value.start, p.value.end);
    const deps = [...new Set([...src.matchAll(/this\.([A-Za-z_$][\w$]*)\s*\(/g)].map((m) => m[1]))];
    FNS.set(name, { name, src, deps });
  }
  for (const f of FNS.values()) for (const d of f.deps) if (!FNS.has(d)) throw new Error(`aec-lib: ${f.name} calls unknown this.${d}`);
  return FNS;
}

export function libVersion(): string { load(); return VERSION; }
export function libFunctionNames(): string[] { return [...load().keys()]; }

/** The library as a JS object, for tests and Node-side previews (the same code AE runs). */
export function libObject(): Record<string, any> {
  return new Function(`return (${LIB_SOURCE});`)();
}

/** Library functions an expression calls (`L.name(`), with everything they depend on, in library order. */
export function usedFunctions(expr: string): string[] {
  const fns = load();
  const want = new Set<string>();
  const add = (n: string) => { if (want.has(n)) return; const f = fns.get(n); if (!f) throw new Error(`expression calls L.${n}(), which is not in aec-lib ${VERSION} (functions: ${[...fns.keys()].join(', ')})`); want.add(n); f.deps.forEach(add); };
  for (const m of expr.matchAll(/(?<![\w$.])L\.([A-Za-z_$][\w$]*)\s*\(/g)) add(m[1]);
  return [...fns.keys()].filter((n) => want.has(n));
}

/** One-line definition carrying just these functions (whitespace collapsed; the library has no line comments). */
export function inlineTail(names: string[]): string {
  const fns = load();
  const body = names.map((n) => `${JSON.stringify(n)}: ${fns.get(n)!.src.replace(/\s*\n\s*/g, ' ')}`).join(', ');
  return `function aecLib() { return { ${body} }; } ${LIB_MARK} ${VERSION} (inlined: ${names.join(', ')})`;
}

/** The line that binds L in each mode. */
export function libHeader(mode: LibMode): string {
  return mode === 'footage' ? `var L = footage(${JSON.stringify(LIB_ITEM)}).sourceData;` : 'var L = aecLib();';
}

/**
 * Wraps an expression body that calls `L.*`: after the leading comment lines come (inline) the definition line of
 * the functions it needs, then the line that binds L. Bodies that don't call the library are returned unchanged.
 */
export function withLib(body: string, mode: LibMode = 'inline'): string {
  // Already wrapped, or an expression with its own `L` (var L = thisComp.layer(...)): leave it alone.
  if (/(?<![\w$.])(var|let|const)\s+L\b|(?<![\w$.])L\s*=(?!=)|function aecLib\(/.test(body)) return body;
  const names = usedFunctions(body);
  if (!names.length) return body;
  const lines = body.split('\n');
  let k = 0;
  while (k < lines.length && /^\s*\/\//.test(lines[k])) k++;
  return [...lines.slice(0, k), ...(mode === 'footage' ? [] : [inlineTail(names)]), libHeader(mode), ...lines.slice(k)].join('\n');
}

/** Drops the inlined definition line (for display: the short calls are what a designer reads). */
export function stripLibTail(expr: string): string {
  return expr.split('\n').filter((l) => !(l.startsWith('function aecLib()') && l.includes(LIB_MARK))).join('\n');
}

/** Writes the footage-mode library file (versioned name) and returns its path. */
export function writeLibFile(dir = path.join(os.homedir(), '.ae-compose', 'lib')): string {
  const file = path.join(dir, `aec-lib-${libVersion()}.jsx`);
  if (!fs.existsSync(file) || fs.readFileSync(file, 'utf8') !== LIB_SOURCE) { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(file, LIB_SOURCE); }
  return file.replace(/\\/g, '/');
}
