// Source surgery on scene files (pure, text level, no TS parser): find the `scene({...})` config object and its
// top-level properties (to rewrite `name` and `params`), serialize values back to JS literals, and find the files
// a scene reaches by relative path (module imports, and string literals that name an existing asset) so they can
// be copied with it and the paths rewritten.
import fs from 'node:fs';
import path from 'node:path';

const PAIRS: Record<string, string> = { '(': ')', '[': ']', '{': '}' };

function skipString(src: string, i: number): number {
  const q = src[i];
  for (let j = i + 1; j < src.length; j++) {
    if (src[j] === '\\') { j++; continue; }
    if (src[j] === q) return j + 1;
    if (src[j] === '\n') return j; // unterminated: stop at the line end
  }
  return src.length;
}

function skipTemplate(src: string, i: number): number {
  for (let j = i + 1; j < src.length; j++) {
    if (src[j] === '\\') { j++; continue; }
    if (src[j] === '`') return j + 1;
    if (src[j] === '$' && src[j + 1] === '{') { const e = matching(src, j + 1); if (e < 0) return src.length; j = e; }
  }
  return src.length;
}

function skipRegex(src: string, i: number): number {
  let cls = false;
  for (let j = i + 1; j < src.length; j++) {
    const c = src[j];
    if (c === '\\') { j++; continue; }
    if (c === '\n') return j;
    if (cls) { if (c === ']') cls = false; continue; }
    if (c === '[') cls = true;
    else if (c === '/') { j++; while (j < src.length && /[a-z]/i.test(src[j])) j++; return j; }
  }
  return src.length;
}

/**
 * Walks code characters from `from` (strings, templates, comments and regex literals are skipped), calling
 * `cb(i, c, depth)` with the bracket depth before the character. Stops when cb returns true or the brackets
 * opened at `from` close. Returns the index where it stopped (-1 on unbalanced input).
 */
function walk(src: string, from: number, cb: (i: number, c: string, depth: number) => boolean | void): number {
  const stack: string[] = [];
  let prev = '';
  let i = from;
  while (i < src.length) {
    const c = src[i];
    if (c === '/' && src[i + 1] === '/') { const e = src.indexOf('\n', i); if (e < 0) return -1; i = e; continue; }
    if (c === '/' && src[i + 1] === '*') { const e = src.indexOf('*/', i + 2); if (e < 0) return -1; i = e + 2; continue; }
    if (c === '"' || c === "'") { i = skipString(src, i); prev = 'x'; continue; }
    if (c === '`') { i = skipTemplate(src, i); prev = 'x'; continue; }
    if (c === '/' && (prev === '' || /[(,=:[!&|?{};+\-*%<>~^]/.test(prev))) { i = skipRegex(src, i); prev = 'x'; continue; }
    if (cb(i, c, stack.length)) return i;
    if (PAIRS[c]) stack.push(PAIRS[c]);
    else if (c === ')' || c === ']' || c === '}') {
      if (stack.pop() !== c) return -1;
      if (!stack.length) return i;
    }
    if (!/\s/.test(c)) prev = c;
    i++;
  }
  return -1;
}

/** Index of the bracket closing the one at `open`, or -1. */
export function matching(src: string, open: number): number {
  return walk(src, open, () => false);
}

export interface Span { start: number; end: number }
export interface Prop { key: string; spread?: boolean; shorthand?: boolean; span: Span; value: Span }

/** Top-level properties of the object literal whose braces are at [open, close]. */
export function objectProps(src: string, open: number, close: number): Prop[] {
  const cuts: number[] = [open];
  walk(src, open, (i, c, depth) => { if (c === ',' && depth === 1) cuts.push(i); return i >= close; });
  cuts.push(close);
  const props: Prop[] = [];
  for (let k = 0; k + 1 < cuts.length; k++) {
    let a = cuts[k] + 1, b = cuts[k + 1];
    const seg = src.slice(a, b);
    const lead = seg.length - seg.trimStart().length, trail = seg.length - seg.trimEnd().length;
    a += lead; b -= trail;
    // leading comments
    while (src.startsWith('//', a) || src.startsWith('/*', a)) {
      const e = src.startsWith('//', a) ? src.indexOf('\n', a) : src.indexOf('*/', a) + 2;
      if (e <= a) break;
      a = e; while (a < b && /\s/.test(src[a])) a++;
    }
    if (a >= b) continue;
    const text = src.slice(a, b);
    if (text.startsWith('...')) { props.push({ key: '...', spread: true, span: { start: a, end: b }, value: { start: a + 3, end: b } }); continue; }
    const m = /^(?:'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"|([A-Za-z_$][\w$]*)|(\d+(?:\.\d+)?))/.exec(text);
    if (!m) continue;
    const key = m[1] ?? m[2] ?? m[3] ?? m[4];
    let colon = -1;
    walk(src, a, (i, c, depth) => { if (i >= b) return true; if (c === ':' && depth === 0) { colon = i; return true; } });
    if (colon < 0) { props.push({ key, shorthand: true, span: { start: a, end: b }, value: { start: a, end: b } }); continue; }
    let v = colon + 1;
    while (v < b && /\s/.test(src[v])) v++;
    props.push({ key, span: { start: a, end: b }, value: { start: v, end: b } });
  }
  return props;
}

/** The `scene({ ... })` config object of a scene file (the default-exported one when there are several). */
export function findSceneConfig(src: string): Span | null {
  const re = /\bscene\s*(?:<[^>()]*>)?\s*\(\s*\{/g;
  const all = [...src.matchAll(re)];
  if (!all.length) return null;
  const def = all.find((m) => /export\s+default\s+$/.test(src.slice(Math.max(0, m.index! - 40), m.index!)));
  const m = def ?? all[all.length - 1];
  const open = m.index! + m[0].length - 1;
  const close = matching(src, open);
  return close < 0 ? null : { start: open, end: close };
}

const IDENT = /^[A-Za-z_$][\w$]*$/;

/** A JS string literal (single quotes; \n, \r and \t escaped). */
export function strLit(s: string): string {
  return `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t')}'`;
}

/** A value as a JS literal. Arrays of objects go one row per line, indented under `indent`. */
export function toLiteral(v: unknown, indent = ''): string {
  if (v === undefined) return 'undefined';
  if (v === null) return 'null';
  if (typeof v === 'string') return strLit(v);
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'NaN';
  if (typeof v === 'boolean') return String(v);
  if (Array.isArray(v)) {
    const items = v.map((x) => toLiteral(x, indent + '  '));
    const one = `[${items.join(', ')}]`;
    if (one.length <= 100 && !one.includes('\n')) return one;
    return `[\n${items.map((x) => `${indent}  ${x},`).join('\n')}\n${indent}]`;
  }
  if (typeof v === 'object') {
    const entries = Object.entries(v as Record<string, unknown>).filter(([, x]) => x !== undefined);
    if (!entries.length) return '{}';
    return `{ ${entries.map(([k, x]) => `${IDENT.test(k) ? k : strLit(k)}: ${toLiteral(x, indent)}`).join(', ')} }`;
  }
  return 'undefined';
}

export interface Edit { start: number; end: number; text: string }
export function applyEdits(src: string, edits: Edit[]): string {
  let out = src;
  for (const e of [...edits].sort((a, b) => b.start - a.start)) out = out.slice(0, e.start) + e.text + out.slice(e.end);
  return out;
}

/** Edits that set config.name and merge `params` into config.params (keeping the source text of untouched keys). */
export function configEdits(src: string, set: { name?: string; params?: Record<string, unknown> }): Edit[] {
  const cfg = findSceneConfig(src);
  if (!cfg) throw new Error('no `scene({ ... })` config object found in the scene file');
  const props = objectProps(src, cfg.start, cfg.end);
  const edits: Edit[] = [];
  const lineIndent = (at: number) => /^[ \t]*/.exec(src.slice(src.lastIndexOf('\n', at - 1) + 1))![0];
  if (set.name !== undefined) {
    const p = props.find((x) => x.key === 'name' && !x.spread);
    if (p) edits.push({ start: p.value.start, end: p.value.end, text: strLit(set.name) });
    else edits.push({ start: cfg.start + 1, end: cfg.start + 1, text: ` name: ${strLit(set.name)},` });
  }
  const params = set.params && Object.keys(set.params).length ? set.params : null;
  if (params) {
    const p = props.find((x) => x.key === 'params' && !x.spread);
    if (!p) {
      const last = props[props.length - 1];
      const at = last ? last.span.end : cfg.start + 1;
      edits.push({ start: at, end: at, text: `${last ? ',' : ''} params: ${toLiteral(params, lineIndent(cfg.end))}${last ? '' : ' '}` });
    } else if (src[p.value.start] === '{') {
      const close = matching(src, p.value.start);
      const inner = objectProps(src, p.value.start, close);
      const ind = lineIndent(p.value.start);
      const added: string[] = [];
      for (const [k, v] of Object.entries(params)) {
        const q = inner.find((x) => x.key === k && !x.spread);
        if (q && !q.shorthand) edits.push({ start: q.value.start, end: q.value.end, text: toLiteral(v, ind) });
        else if (q) edits.push({ start: q.span.start, end: q.span.end, text: `${IDENT.test(k) ? k : strLit(k)}: ${toLiteral(v, ind)}` });
        else added.push(`${IDENT.test(k) ? k : strLit(k)}: ${toLiteral(v, ind)}`);
      }
      if (added.length) {
        const last = inner[inner.length - 1];
        const at = last ? last.span.end : p.value.start + 1;
        edits.push({ start: at, end: at, text: last ? `, ${added.join(', ')}` : ` ${added.join(', ')} ` });
      }
    } else {
      // params is an expression (a constant): spread it and override
      edits.push({ start: p.value.start, end: p.value.end, text: `{ ...${src.slice(p.value.start, p.value.end)}, ${Object.entries(params).map(([k, v]) => `${IDENT.test(k) ? k : strLit(k)}: ${toLiteral(v)}`).join(', ')} }` });
    }
  }
  return edits;
}

import { ASSET_EXT, relRef } from '@ae-mcp/core/templates/files.ts';
export { ASSET_EXT, relRef };
const MODULE_EXT = ['', '.ts', '.tsx', '.mts', '.js', '.mjs', '.jsx', '/index.ts', '/index.tsx', '/index.js'];

export interface Ref { start: number; end: number; value: string; kind: 'import' | 'asset'; abs: string }

const isFile = (p: string) => { try { return fs.statSync(p).isFile(); } catch { return false; } };

/** Relative module imports and string literals that name an existing file, in a scene or module at `file`. */
export function scanRefs(src: string, file: string): Ref[] {
  const dir = path.dirname(file);
  const refs: Ref[] = [];
  const taken: Span[] = [];
  const imp = /(\bfrom\s*|\bimport\s*\(\s*|\bimport\s+|\bexport\s*\*\s*from\s*)(['"])(\.{1,2}\/[^'"\r\n]+)\2/g;
  for (const m of src.matchAll(imp)) {
    const start = m.index! + m[1].length + 1, end = start + m[3].length;
    const base = path.resolve(dir, m[3]);
    const abs = MODULE_EXT.map((e) => base + e).find(isFile);
    if (!abs) continue;
    refs.push({ start, end, value: m[3], kind: 'import', abs });
    taken.push({ start, end });
  }
  // Every quote is tried as an opener (the closing quote isn't consumed), so an apostrophe in JSX text or an empty
  // string can't shift the pairing; whatever lies between two literals is filtered out by the existence check.
  const str = /(['"`])([^'"`\r\n]{1,400}?)(?=\1)/g;
  for (const m of src.matchAll(str)) {
    const v = m[2];
    if (!ASSET_EXT.test(v) || /^[a-z][\w+.-]*:\/\//i.test(v) || v.startsWith('data:') || v.includes('${')) continue;
    const start = m.index! + 1, end = start + v.length;
    if (taken.some((t) => start < t.end && end > t.start)) continue;
    const abs = path.isAbsolute(v) ? v : path.resolve(dir, v);
    if (!isFile(abs)) continue;
    refs.push({ start, end, value: v, kind: 'asset', abs: path.resolve(abs) });
  }
  return refs.sort((a, b) => a.start - b.start);
}
