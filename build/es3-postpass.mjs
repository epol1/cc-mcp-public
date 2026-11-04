// ES3 post-pass for bundled/generated ExtendScript (see docs/research/toolchain.md §6.5).
// - swaps ES5 statics for local ponyfills (never patches globals; AE panels share one engine)
// - parenthesizes nested ?: and mixed ||/&& (ExtendScript parser bugs)
// - strips "//@..." comments (ExtendScript treats them as preprocessor directives)
// - re-parses the result as strict ES3 (hard gate)
import { parse } from 'acorn';
import { simple } from 'acorn-walk';
import MagicString from 'magic-string';

const PONY = {
  'Object.create': '__es3_create',
  'Object.defineProperty': '__es3_defineProperty',
  'Object.keys': '__es3_keys',
  'Array.isArray': '__es3_isArray',
  'Object.freeze': '__es3_identity',
};
const PONY_SRC = {
  __es3_create: 'function __es3_create(p, props) { function F() {} F.prototype = p; var o = new F(); if (props) { for (var k in props) { if (Object.prototype.hasOwnProperty.call(props, k)) { o[k] = props[k].value; } } } return o; }',
  __es3_defineProperty: 'function __es3_defineProperty(o, k, d) { if (d.get || d.set) { throw new Error("ES3: accessor properties are not supported"); } if ("value" in d) { o[k] = d.value; } return o; }',
  __es3_keys: 'function __es3_keys(o) { var r = [], k; for (k in o) { if (Object.prototype.hasOwnProperty.call(o, k)) { r[r.length] = k; } } return r; }',
  __es3_isArray: 'function __es3_isArray(a) { return Object.prototype.toString.call(a) === "[object Array]"; }',
  __es3_identity: 'function __es3_identity(o) { return o; }',
};
const BANNED = ['_objectWithoutProperties', '_toConsumableArray', '_slicedToArray', '_createForOfIteratorHelper', '_regenerator', '_asyncToGenerator', '_wrapNativeSuper', '_taggedTemplateLiteral', 'Symbol.iterator'];
export const ES3 = { ecmaVersion: 3, sourceType: 'script', allowReserved: 'never' };

export function es3PostPass(code, opts = {}) {
  const comments = [];
  const ast = parse(code, { ...ES3, preserveParens: true, onComment: comments });
  const s = new MagicString(code);
  const used = new Set();
  const wrap = (n) => { s.appendLeft(n.start, '('); s.prependRight(n.end, ')'); };
  simple(ast, {
    MemberExpression(n) {
      if (!n.computed && n.object.type === 'Identifier' && n.property.type === 'Identifier') {
        const rep = PONY[n.object.name + '.' + n.property.name];
        if (rep) { s.overwrite(n.start, n.end, rep); used.add(rep); }
      }
    },
    ConditionalExpression(n) {
      for (const c of [n.test, n.consequent, n.alternate]) if (c.type === 'ConditionalExpression') wrap(c);
    },
    LogicalExpression(n) {
      for (const c of [n.left, n.right]) if (c.type === 'LogicalExpression' && c.operator !== n.operator) wrap(c);
    },
  });
  for (const c of comments) if (/^\s*@/.test(c.value)) s.remove(c.start, c.end);
  const at = opts.insertAt ?? code.indexOf('\n') + 1;
  if (used.size) s.appendRight(at, [...used].map((u) => PONY_SRC[u]).join('\n') + '\n');
  const out = s.toString();
  parse(out, ES3);
  return { code: out, map: s.generateMap({ hires: true }), problems: BANNED.filter((b) => out.includes(b)) };
}

/** Throws with a readable message if `code` is not valid ES3. */
export function assertEs3(code, label = 'script') {
  try { parse(code, ES3); } catch (e) {
    const lines = code.split('\n');
    const ln = e.loc ? e.loc.line : 0;
    const ctx = lines.slice(Math.max(0, ln - 3), ln + 2).map((l, i) => `${ln - 2 + i}: ${l}`).join('\n');
    throw new Error(`${label} is not valid ES3: ${e.message}\n${ctx}`);
  }
}

export default function es3() {
  return {
    name: 'es3',
    renderChunk(code) {
      const r = es3PostPass(code);
      for (const p of r.problems) this.error(`ES3: bundle contains ${p} (needs ES5+ runtime support)`);
      return { code: r.code, map: r.map };
    },
  };
}
