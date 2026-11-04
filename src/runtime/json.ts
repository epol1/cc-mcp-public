// Private JSON serializer (AE 26.5 ExtendScript has no JSON; another panel may install a global one).
// Strings are built with array join: `+=` is pathologically slow in ExtendScript (measured).
import { has, isArray } from './util';

function quote(s: string, out: string[]): void {
  out[out.length] = '"';
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    let esc = '';
    if (c === 34) esc = '\\"';
    else if (c === 92) esc = '\\\\';
    else if (c === 10) esc = '\\n';
    else if (c === 13) esc = '\\r';
    else if (c === 9) esc = '\\t';
    else if (c < 32 || c > 126) esc = '\\u' + ('0000' + c.toString(16)).slice(-4);
    if (esc) {
      if (i > start) out[out.length] = s.substring(start, i);
      out[out.length] = esc;
      start = i + 1;
    }
  }
  if (start < s.length) out[out.length] = s.substring(start);
  out[out.length] = '"';
}

function write(v: any, out: string[], depth: number): void {
  if (depth > 64) { out[out.length] = 'null'; return; }
  if (v === null || v === undefined) { out[out.length] = 'null'; return; }
  const t = typeof v;
  if (t === 'number') { out[out.length] = isFinite(v) ? String(v) : 'null'; return; }
  if (t === 'boolean') { out[out.length] = v ? 'true' : 'false'; return; }
  if (t === 'string') { quote(v, out); return; }
  if (t === 'function') { out[out.length] = 'null'; return; }
  if (isArray(v)) {
    out[out.length] = '[';
    for (let i = 0; i < v.length; i++) {
      if (i) out[out.length] = ',';
      write(v[i], out, depth + 1);
    }
    out[out.length] = ']';
    return;
  }
  out[out.length] = '{';
  let first = true;
  for (const k in v) {
    if (!has(v, k)) continue;
    const x = v[k];
    if (x === undefined || typeof x === 'function') continue;
    if (!first) out[out.length] = ',';
    first = false;
    quote(k, out);
    out[out.length] = ':';
    write(x, out, depth + 1);
  }
  out[out.length] = '}';
}

export function stringify(v: any): string {
  const out: string[] = [];
  write(v, out, 0);
  return out.join('');
}
