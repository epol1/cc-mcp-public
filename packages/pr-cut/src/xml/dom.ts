// Minimal XML DOM for Premiere's FCP7 exports: elements, attributes, text, comments and the prolog, serialized back
// byte-for-byte equivalent (whitespace inside elements is kept as text nodes). Enough to read sequences and carry
// unknown filters and graphics through an edit unchanged.

export interface XEl { tag: string; attrs: [string, string][]; kids: XNode[] }
export type XNode = XEl | string;

const decode = (s: string) => s.replace(/&(lt|gt|amp|quot|apos|#\d+|#x[0-9a-f]+);/gi, (m, e) =>
  e === 'lt' ? '<' : e === 'gt' ? '>' : e === 'amp' ? '&' : e === 'quot' ? '"' : e === 'apos' ? "'" : e[1] === 'x' || e[1] === 'X' ? String.fromCodePoint(parseInt(e.slice(2), 16)) : String.fromCodePoint(parseInt(e.slice(1), 10)));
const encText = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const encAttr = (s: string) => encText(s).replace(/"/g, '&quot;');

/** Parse a document; returns the prolog (declaration, doctype, comments before the root) and the root element. */
export function parseXml(src: string): { prolog: string; root: XEl } {
  let i = 0;
  const n = src.length;
  let prolog = '';
  const parseEl = (): XEl => {
    // at '<'
    const m = /^<([^\s/>]+)/.exec(src.slice(i, i + 200));
    if (!m) throw new Error(`XML: expected a tag at ${i}`);
    const el: XEl = { tag: m[1], attrs: [], kids: [] };
    i += m[0].length;
    for (;;) {
      while (/\s/.test(src[i])) i++;
      if (src.startsWith('/>', i)) { i += 2; return el; }
      if (src[i] === '>') { i++; break; }
      const a = /^([^\s=/>]+)\s*=\s*("([^"]*)"|'([^']*)')/.exec(src.slice(i, i + 100000));
      if (!a) throw new Error(`XML: bad attribute in <${el.tag}> at ${i}`);
      el.attrs.push([a[1], decode(a[3] ?? a[4] ?? '')]);
      i += a[0].length;
    }
    for (;;) {
      if (i >= n) throw new Error(`XML: <${el.tag}> is not closed`);
      if (src.startsWith('</', i)) {
        const e = src.indexOf('>', i);
        const name = src.slice(i + 2, e).trim();
        if (name !== el.tag) throw new Error(`XML: </${name}> closes <${el.tag}> at ${i}`);
        i = e + 1;
        return el;
      }
      if (src.startsWith('<!--', i)) { const e = src.indexOf('-->', i) + 3; el.kids.push({ tag: '#comment', attrs: [], kids: [src.slice(i, e)] }); i = e; continue; }
      if (src.startsWith('<![CDATA[', i)) { const e = src.indexOf(']]>', i); el.kids.push(src.slice(i + 9, e)); i = e + 3; continue; }
      if (src[i] === '<') { el.kids.push(parseEl()); continue; }
      const e = src.indexOf('<', i);
      el.kids.push(decode(src.slice(i, e < 0 ? n : e)));
      i = e < 0 ? n : e;
    }
  };
  // Prolog: everything before the first element that isn't a declaration/doctype/comment.
  for (;;) {
    while (i < n && /\s/.test(src[i])) prolog += src[i++];
    if (src.startsWith('<?', i)) { const e = src.indexOf('?>', i) + 2; prolog += src.slice(i, e); i = e; continue; }
    if (src.startsWith('<!', i)) { const e = src.indexOf('>', i) + 1; prolog += src.slice(i, e); i = e; continue; }
    break;
  }
  return { prolog, root: parseEl() };
}

export function serialize(node: XNode): string {
  if (typeof node === 'string') return encText(node);
  if (node.tag === '#comment') return node.kids[0] as string;
  const attrs = node.attrs.map(([k, v]) => ` ${k}="${encAttr(v)}"`).join('');
  if (!node.kids.length) return `<${node.tag}${attrs}/>`;
  return `<${node.tag}${attrs}>${node.kids.map(serialize).join('')}</${node.tag}>`;
}

export const els = (e: XEl, tag?: string): XEl[] => e.kids.filter((k): k is XEl => typeof k !== 'string' && k.tag !== '#comment' && (!tag || k.tag === tag));
export const el = (e: XEl, tag: string): XEl | undefined => els(e, tag)[0];
export const txt = (e: XEl | undefined): string => (e ? e.kids.filter((k): k is string => typeof k === 'string').join('').trim() : '');
export const child = (e: XEl, path: string): XEl | undefined => path.split('/').reduce<XEl | undefined>((x, t) => (x ? el(x, t) : undefined), e);
export const attr = (e: XEl, k: string) => e.attrs.find(([a]) => a === k)?.[1];
export function setText(e: XEl, tag: string, value: string | number) {
  const x = el(e, tag);
  if (x) x.kids = [String(value)];
  else e.kids.push({ tag, attrs: [], kids: [String(value)] });
}
/** All descendants with a tag, depth-first. */
export function find(e: XEl, tag: string, out: XEl[] = []): XEl[] {
  for (const k of els(e)) { if (k.tag === tag) out.push(k); find(k, tag, out); }
  return out;
}
