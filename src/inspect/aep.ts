// Gradient stops read from a saved .aep (D72). AE 26.5 can't read shape-gradient colors by script (touching the
// Colors property crashes it, D15), but the saved project holds them: the file is RIFX ("Egg!") chunks, items are
// LIST "Item" (name in a Utf8 chunk), layers LIST "Layr", property groups LIST "tdgp" in which each "tdmn" names the
// property that follows; "ADBE Vector Grad Colors" is followed by a LIST "GCst" whose "GCky" Utf8 holds
// <prop.map> XML (one per keyframe) with Alpha Stops [location, midpoint, alpha] and Color Stops
// [location, midpoint, r, g, b, a]. Verified against known gradients (tests/integration/aep-gradients.ts).
import fs from 'node:fs';

interface Chunk { id: string; type?: string; start: number; size: number; kids?: Chunk[] }

function parse(buf: Buffer, off: number, end: number): Chunk[] {
  const out: Chunk[] = [];
  while (off + 8 <= end) {
    const id = buf.toString('latin1', off, off + 4);
    const size = buf.readUInt32BE(off + 4);
    const body = off + 8;
    if (body + size > end + 1) break; // truncated / not a chunk
    if (id === 'LIST' || id === 'RIFX') out.push({ id, type: buf.toString('latin1', body, body + 4), start: body + 4, size: size - 4, kids: parse(buf, body + 4, body + size) });
    else out.push({ id, start: body, size });
    off = body + size + (size & 1);
  }
  return out;
}

const str = (buf: Buffer, c: Chunk) => buf.toString('utf8', c.start, c.start + c.size).replace(/\0+$/, '');
/** A tdsn (group name) chunk wraps a Utf8 chunk; "-_0_/-" means AE's default name. */
function tdsnName(buf: Buffer, c: Chunk): string | undefined {
  const inner = parse(buf, c.start, c.start + c.size).find((k) => k.id === 'Utf8');
  const s = inner ? str(buf, inner) : undefined;
  return s && s !== '-_0_/-' ? s : undefined;
}

export interface GradientStop { offset: number; midpoint: number; color: [number, number, number]; }
export interface AlphaStop { offset: number; midpoint: number; opacity: number }
export interface AepGradient {
  /** Composition name and its layer, 1-based in stacking order (as in AE). */
  comp: string; layerIndex: number; layer: string;
  /** Path from the layer to the Gradient Fill/Stroke group: "matchName[k]/…" (k-th group with that matchName). */
  path: string; names: string[];
  kind: 'fill' | 'stroke';
  colors: GradientStop[]; alphas: AlphaStop[];
  /** More than one when the gradient is animated (one set per keyframe); 0 for AE's default gradient. */
  keyframes: number;
  /** AE's untouched default (white → black): the file stores no Colors property then. */
  default?: boolean;
}

/** A new Gradient Fill/Stroke in AE: white at 0 → black at 1, fully opaque, midpoints 0.5. */
export const DEFAULT_GRADIENT = {
  colors: [{ offset: 0, midpoint: 0.5, color: [1, 1, 1] as [number, number, number] }, { offset: 1, midpoint: 0.5, color: [0, 0, 0] as [number, number, number] }],
  alphas: [{ offset: 0, midpoint: 0.5, opacity: 1 }, { offset: 1, midpoint: 0.5, opacity: 1 }],
};

function floats(xml: string, key: string): number[][] {
  // <key>Stop-N</key> <prop.list> <prop.pair> <key>Stops Color|Alpha</key> <array> <float>…
  const out: number[][] = [];
  const re = new RegExp(`<key>Stop-(\\d+)</key>\\s*<prop.list>\\s*<prop.pair>\\s*<key>${key}</key>\\s*<array>([\\s\\S]*?)</array>`, 'g');
  for (const m of xml.matchAll(re)) out[+m[1]] = [...m[2].matchAll(/<float>([^<]*)<\/float>/g)].map((f) => parseFloat(f[1]));
  return out.filter(Boolean);
}
const size = (xml: string, section: string) => {
  const s = xml.indexOf(`<key>${section}</key>`);
  const m = /<key>Stops Size<\/key>\s*<int[^>]*>(\d+)<\/int>/.exec(xml.slice(s));
  return m ? +m[1] : Infinity;
};

export function parseGradientXml(xml: string): { colors: GradientStop[]; alphas: AlphaStop[] } {
  const a = xml.indexOf('<key>Alpha Stops</key>'), c = xml.indexOf('<key>Color Stops</key>');
  const alphaXml = a >= 0 ? xml.slice(a, c > a ? c : undefined) : '';
  const colorXml = c >= 0 ? xml.slice(c) : '';
  const nA = size(xml, 'Alpha Stops'), nC = size(xml, 'Color Stops');
  const alphas = floats(alphaXml, 'Stops Alpha').slice(0, nA).map((v) => ({ offset: v[0], midpoint: v[1], opacity: v[2] }));
  const colors = floats(colorXml, 'Stops Color').slice(0, nC).map((v) => ({ offset: v[0], midpoint: v[1], color: [v[2], v[3], v[4]] as [number, number, number] }));
  return { colors: colors.sort((x, y) => x.offset - y.offset), alphas: alphas.sort((x, y) => x.offset - y.offset) };
}

/** Every shape gradient in a saved .aep, with the comp, layer and property path it belongs to. */
export function readAepGradients(file: string): AepGradient[] {
  const buf = fs.readFileSync(file);
  if (buf.toString('latin1', 0, 4) !== 'RIFX' || buf.toString('latin1', 8, 12) !== 'Egg!') throw new Error(`${file} is not a binary .aep (RIFX/Egg!)`);
  const root = parse(buf, 12, 8 + buf.readUInt32BE(4));
  const out: AepGradient[] = [];

  // Inside a layer: walk tdgp groups. A segment is "matchName[k]": the k-th sub-group with that matchName. AE saves
  // only properties that differ from their defaults, so plain indices can't be counted from the file, but groups
  // are always saved, so the k-th group of a matchName is stable (the runtime computes the same, gradientPath()).
  const walkGroup = (g: Chunk, path: string[], names: string[], ctx: { comp: string; layerIndex: number; layer: string }) => {
    const kids = g.kids ?? [];
    const seen: Record<string, number> = {};
    let mn: string | null = null;
    for (const k of kids) {
      if (k.id === 'tdmn') { mn = str(buf, k); continue; }
      if (!mn || k.id !== 'LIST' || k.type !== 'tdgp') { if (k.id === 'LIST') mn = null; continue; }
      seen[mn] = (seen[mn] ?? 0) + 1;
      const seg = `${mn}[${seen[mn]}]`;
      const nm = (k.kids ?? []).find((x) => x.id === 'tdsn');
      const label = (nm && tdsnName(buf, nm)) ?? mn;
      if (mn === 'ADBE Vector Graphic - G-Fill' || mn === 'ADBE Vector Graphic - G-Stroke') {
        // Its Colors property (absent when the gradient is AE's default white → black).
        let xmls: string[] = [];
        const gk = k.kids ?? [];
        for (let i = 0; i < gk.length - 1; i++) {
          if (gk[i].id === 'tdmn' && str(buf, gk[i]) === 'ADBE Vector Grad Colors' && gk[i + 1].id === 'LIST' && gk[i + 1].type === 'GCst') {
            xmls = (gk[i + 1].kids ?? []).filter((x) => x.id === 'LIST' && x.type === 'GCky').map((x) => (x.kids ?? []).find((y) => y.id === 'Utf8')).filter(Boolean).map((u) => str(buf, u!));
          }
        }
        const stops = xmls.length ? parseGradientXml(xmls[0]) : DEFAULT_GRADIENT;
        out.push({ ...ctx, path: [...path, seg].join('/'), names: [...names, label], kind: mn.endsWith('G-Stroke') ? 'stroke' : 'fill', colors: stops.colors, alphas: stops.alphas, keyframes: xmls.length, default: !xmls.length });
      } else walkGroup(k, [...path, seg], [...names, label], ctx);
      mn = null;
    }
  };
  const walkItems = (chunks: Chunk[]) => {
    for (const c of chunks) {
      if (c.id !== 'LIST') continue;
      if (c.type === 'Item') {
        const name = (c.kids ?? []).find((k) => k.id === 'Utf8');
        const comp = name ? str(buf, name) : '';
        let layerIndex = 0;
        for (const L of c.kids ?? []) {
          if (L.id === 'LIST' && L.type === 'Layr') {
            layerIndex++;
            const ln = (L.kids ?? []).find((k) => k.id === 'Utf8');
            const ctx = { comp, layerIndex, layer: ln ? str(buf, ln) : '' };
            for (const g of L.kids ?? []) if (g.id === 'LIST' && g.type === 'tdgp') walkGroup(g, [], [], ctx);
          }
        }
      }
      if (c.kids) walkItems(c.kids);
    }
  };
  walkItems(root);
  return out;
}

// ---- Attaching stops to inspector output ----

const cache = new Map<string, { mtime: number; list: AepGradient[] }>();
function gradientsOf(file: string): AepGradient[] {
  const mtime = fs.statSync(file).mtimeMs;
  const hit = cache.get(file);
  if (hit && hit.mtime === mtime) return hit.list;
  const list = readAepGradients(file);
  cache.set(file, { mtime, list });
  return list;
}

const hex = (c: number[]) => '#' + c.map((x) => Math.round(Math.max(0, Math.min(1, x)) * 255).toString(16).padStart(2, '0')).join('');
/** ae-compose writes the stops into the group name: "Gradient Fill [#ff0000@0 #0000ff@1]". */
export function stopsFromName(name: string): { offset: number; color: string }[] | null {
  const m = /\[((?:#[0-9a-f]{6}@[\d.]+\s*)+)\]\s*$/i.exec(name ?? '');
  return m ? m[1].trim().split(/\s+/).map((t) => { const [c, o] = t.split('@'); return { offset: +o, color: c }; }) : null;
}

/**
 * Fills in `stops` on the gradient nodes of an inspector result: from the saved .aep when there is one (exact, with
 * opacity and midpoints), else from the stop tag ae-compose writes in the group name. Sets `gradientNote` when
 * the saved file may be out of date or the stops can't be known.
 */
export function attachGradients(j: any): void {
  if (!j?.ok || !j.layers) return;
  const nodes: { L: any; n: any }[] = [];
  const walk = (L: any, n: any) => { if (!n) return; if (n.gradient) nodes.push({ L, n }); for (const c of n.c ?? []) walk(L, c); };
  for (const L of j.layers) for (const p of L.props ?? []) walk(L, p);
  if (!nodes.length) return;
  let list: AepGradient[] | null = null;
  const file: string | null = j.projectFile ?? null;
  if (file && /\.aep$/i.test(file) && fs.existsSync(file)) { try { list = gradientsOf(file); } catch (e: any) { j.gradientNote = `could not read gradients from ${file}: ${e.message}`; } }
  let unknown = 0;
  for (const { L, n } of nodes) {
    const g = list?.find((x) => x.comp === j.comp.name && x.layerIndex === L.index && x.layer === L.name && x.path === n.gp);
    if (g) {
      n.stops = g.colors.map((c) => ({ offset: +c.offset.toFixed(4), color: hex(c.color), ...(Math.abs(c.midpoint - 0.5) > 1e-3 ? { midpoint: +c.midpoint.toFixed(4) } : {}) }));
      if (g.alphas.some((a) => a.opacity < 0.999)) n.alphaStops = g.alphas.map((a) => ({ offset: +a.offset.toFixed(4), opacity: +a.opacity.toFixed(4) }));
      if (g.keyframes > 1) n.animatedStops = g.keyframes;
      n.stopsFrom = 'saved file';
      continue;
    }
    const tagged = stopsFromName(n.n);
    if (tagged) { n.stops = tagged; n.stopsFrom = 'name tag'; continue; }
    unknown++;
  }
  if (list && j.dirty) j.gradientNote = 'gradient stops are read from the saved project file: changes since the last save are not included';
  if (unknown) j.gradientNote = `${unknown} gradient(s) without readable stops: ${file ? (/\.aepx$/i.test(file) ? 'the project is saved as .aepx (only .aep is read)' : 'not in the saved file yet (save the project)') : 'save the project (AE can\'t read gradient stops by script; the saved file has them)'}`;
}
