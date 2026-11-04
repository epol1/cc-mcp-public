// Emits IR/data as an ES3 object literal: quoted keys, no trailing commas, non-ASCII escaped,
// U+2028/2029 escaped (line terminators in ES3 string literals). Not JSON.parse'd in AE (absent/slow).

export function toEs3Literal(value: unknown): string {
  const json = JSON.stringify(value, (k, v) => {
    if (k === '__proto__') return undefined;
    if (typeof v === 'number' && !Number.isFinite(v)) return null;
    return v;
  });
  if (json === undefined) return 'undefined';
  return json.replace(/[\u007f-￿]/g, (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
}

/** ES3 string literal for arbitrary text. */
export function es3String(s: string): string {
  return toEs3Literal(String(s));
}
