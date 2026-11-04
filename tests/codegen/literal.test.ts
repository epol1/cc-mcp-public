// Spec for src/codegen/literal.ts: IR/data → ES3 object literal (the request-script payload).
import { describe, expect, it } from 'vitest';
import { parse } from 'acorn';
import { es3String, toEs3Literal } from '../../src/codegen/literal.ts';

const ES3 = { ecmaVersion: 3, sourceType: 'script', allowReserved: 'never' } as const;
const parsesAsEs3 = (lit: string) => parse(`var x = ${lit};`, ES3 as any);

describe('toEs3Literal', () => {
  it('quotes every key and emits no trailing commas', () => {
    expect(toEs3Literal({ a: 1, b: [1, 2], c: { d: 'x' } })).toBe('{"a":1,"b":[1,2],"c":{"d":"x"}}');
    expect(toEs3Literal({ class: 1, default: 2, if: 3 })).toBe('{"class":1,"default":2,"if":3}'); // reserved words are fine quoted
    expect(() => parsesAsEs3(toEs3Literal({ class: 1, default: 2, if: 3 }))).not.toThrow();
  });
  it('non-ASCII → \\uXXXX (output is pure ASCII), astral chars as surrogate pairs, DEL escaped', () => {
    expect(toEs3Literal('é')).toBe('"\\u00e9"');
    expect(toEs3Literal('→ ×')).toBe('"\\u2192 \\u00d7"');
    expect(toEs3Literal('😀')).toBe('"\\ud83d\\ude00"');
    expect(toEs3Literal('\u007f')).toBe('"\\u007f"');
    expect(toEs3Literal('日本語')).toBe('"\\u65e5\\u672c\\u8a9e"');
    const lit = toEs3Literal({ name: 'Título — “quotes”', text: 'naïve café' });
    expect(lit).toMatch(/^[\x20-\x7e]*$/);
  });
  it('U+2028 / U+2029 (line terminators inside ES3 strings) are escaped', () => {
    const lit = toEs3Literal({ s: 'a\u2028b\u2029c' });
    expect(lit).toBe('{"s":"a\\u2028b\\u2029c"}');
    expect(lit).not.toMatch(/[\u2028\u2029]/);
    expect(() => parsesAsEs3(lit)).not.toThrow();
  });
  it('control characters, quotes and backslashes are escaped (JSON rules)', () => {
    expect(toEs3Literal('a"b\\c\n\t\u0001')).toBe('"a\\"b\\\\c\\n\\t\\u0001"');
  });
  it('__proto__ keys are dropped at any depth', () => {
    const evil = JSON.parse('{"a":1,"__proto__":{"polluted":true},"n":{"__proto__":{"x":1},"k":2},"l":[{"__proto__":5}]}');
    const lit = toEs3Literal(evil);
    expect(lit).toBe('{"a":1,"n":{"k":2},"l":[{}]}');
    expect(lit).not.toContain('__proto__');
  });
  it('non-finite numbers → null; undefined fields dropped; top-level undefined → "undefined"', () => {
    expect(toEs3Literal({ a: NaN, b: Infinity, c: -Infinity, d: undefined, e: [undefined, 1] })).toBe('{"a":null,"b":null,"c":null,"e":[null,1]}');
    expect(toEs3Literal(undefined)).toBe('undefined');
    expect(toEs3Literal(null)).toBe('null');
    expect(toEs3Literal(-0)).toBe('0');
    expect(toEs3Literal(1e-7)).toBe('1e-7');
  });
  it('round-trips through JSON.parse and parses as ES3', () => {
    const data = { irVersion: 1, s: 'Ünïcödé \u2028 ok', n: [0.1, -2.5e-9, 1e21], nested: { deep: [{ x: true, y: false, z: null }] } };
    const lit = toEs3Literal(data);
    expect(JSON.parse(lit)).toEqual(data);
    expect(() => parsesAsEs3(lit)).not.toThrow();
  });
  it('es3String quotes and escapes arbitrary text', () => {
    expect(es3String('C:/path/naïve "x".jsx')).toBe('"C:/path/na\\u00efve \\"x\\".jsx"');
    expect(es3String(42 as any)).toBe('"42"');
  });
});
