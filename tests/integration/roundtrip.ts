// Inspector round-trip (real AE, GOAL §6): build scenes, read them back with the inspector (detail "full"), and
// check that what AE holds matches the IR the compiler produced:
//  - layers: names, order, in/out
//  - every property the IR sets, including inside shape groups, effects, masks and text animators:
//    static values, key times, key values, and ease influence/speed (1D)
// Scenes: the primitive matrix (tests/integration/matrix-scene.tsx) plus showcases (2D, 3D, particles).
// Run: npx tsx tests/integration/roundtrip.ts
import fs from 'node:fs';
import { buildScene } from '../../src/api/build.ts';
import { inspect } from '../../src/api/index.ts';

const DEFAULT_SCENES = [
  'tests/integration/matrix-scene.tsx',
  'examples/01-kinetic-type/scene.tsx',
  'examples/05-data-chart/scene.tsx',
  'examples/10-3d-product-hero/scene.tsx',
  'examples/12-particle-logo-reveal/scene.tsx',
];
const SCENES = process.argv.slice(2).length ? process.argv.slice(2) : DEFAULT_SCENES;

let fails = 0;
const failures: string[] = [];
const check = (ok: boolean, msg: string) => { if (!ok) { fails++; if (failures.length < 60) failures.push(msg); } return ok; };

const close = (a: any, b: any, tol: number): boolean => {
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) <= tol * Math.max(1, Math.abs(b));
  if (Array.isArray(a) && Array.isArray(b)) { const n = Math.min(a.length, b.length); for (let i = 0; i < n; i++) if (!close(a[i], b[i], tol)) return false; return true; }
  if (typeof a === 'number' && Array.isArray(b) && b.length === 1) return close(a, b[0], tol);
  if (typeof b === 'number' && Array.isArray(a) && a.length === 1) return close(a[0], b, tol);
  return JSON.stringify(a) === JSON.stringify(b);
};

/** Child of an AE node by matchName or display name; for indexed groups the k-th occurrence of that matchName. */
function child(node: any, seg: string, occurrence = 0, name?: string): any {
  if (name) { const byName = (node?.c ?? []).find((c: any) => c.m === seg && c.n === name); if (byName) return byName; }
  let k = 0;
  for (const c of node?.c ?? []) if (c.m === seg || c.n === seg) { if (k === occurrence) return c; k++; }
  return undefined;
}
function byPath(node: any, path: string): any {
  for (const seg of path.split('/')) { node = child(node, seg); if (!node) return undefined; }
  return node;
}

let props = 0, values = 0, keyed = 0, eases = 0, skipped = 0;
function compareProp(where: string, spec: any, ae: any) {
  if (!ae) { skipped++; return; } // hidden in this state/renderer, or only addressable through a wrapper
  props++;
  if (spec.rel || ae.skipped) { skipped++; return; } // layout-relative values, or opaque (gradient colors)
  if (spec.keys) {
    keyed++;
    if (!check(!!ae.keys && ae.keys.length === spec.keys.length, `${where}: ${ae.keys?.length ?? 0} keys in AE vs ${spec.keys.length}`)) return;
    spec.keys.forEach((k: any, i: number) => {
      const a = ae.keys[i];
      check(Math.abs(a.t - k.t) < 1e-3, `${where} key ${i + 1}: t ${a.t} vs ${k.t}`);
      if (k.v !== undefined && typeof k.v !== 'object' || Array.isArray(k.v)) check(close(a.v, k.v, 2e-3), `${where} key ${i + 1}: v ${JSON.stringify(a.v)} vs ${JSON.stringify(k.v)}`);
      // Eases: influence always; speed for 1D properties (multi-dim/spatial/color collapse to one ease in AE).
      for (const side of ['ie', 'oe'] as const) {
        // The first key's in-ease and the last key's out-ease shape no segment (AE normalizes them): skip.
        if ((side === 'ie' && i === 0) || (side === 'oe' && i === spec.keys.length - 1)) continue;
        const want = k[side]?.[0], got = a[side]?.[0];
        if (!want || !got || (k[side === 'ie' ? 'i' : 'o'] && k[side === 'ie' ? 'i' : 'o'] !== 'bezier')) continue;
        eases++;
        check(Math.abs(got.influence - Math.max(0.1, Math.min(100, want.influence))) < 0.6, `${where} key ${i + 1} ${side}: influence ${got.influence} vs ${want.influence}`);
        if (k[side].length === 1 && a[side].length === 1 && typeof k.v === 'number') check(Math.abs(got.speed - want.speed) <= 0.02 * Math.max(1, Math.abs(want.speed)), `${where} key ${i + 1} ${side}: speed ${got.speed} vs ${want.speed}`);
      }
    });
  } else if (spec.v !== undefined && !spec.expr) {
    values++;
    const v = spec.v;
    if (v && typeof v === 'object' && !Array.isArray(v)) { skipped++; return; } // shapes, text docs, layer refs: compared elsewhere
    check(close(ae.v, v, 2e-3), `${where}: value ${JSON.stringify(ae.v)} vs ${JSON.stringify(v)}`);
  }
  if (spec.expr) check(!!ae.expr && !ae.exprErr, `${where}: expression ${ae.expr ? 'error: ' + ae.exprErr : 'missing'}`);
}

function compareGroups(where: string, parent: any, items: any[]) {
  const seen = new Map<string, number>();
  for (const g of items ?? []) {
    const occ = seen.get(g.mn) ?? 0; seen.set(g.mn, occ + 1);
    const node = child(parent, g.mn, occ, g.name);
    if (!check(!!node, `${where}: group ${g.mn} #${occ + 1} missing in AE`)) continue;
    const w = `${where}/${g.name ?? g.mn}`;
    if (g.set) compareProp(w, g.set, node);
    for (const p of g.props ?? []) compareProp(`${w}/${p.p}`, p, byPath(node, p.p));
    for (const k of g.kids ?? []) compareGroups(w, byPath(node, k.at), k.items);
  }
}

for (const file of SCENES) {
  const r = await buildScene({ file }, { frames: 0, variants: false, resetControls: true });
  if (!r.ok) { check(false, `${file}: build failed: ${r.error}`); continue; }
  const ir = JSON.parse(fs.readFileSync(r.irFile!, 'utf8'));
  for (const comp of ir.comps) {
    const j = (await inspect({ comp: comp.name, detail: 'full' })).json;
    const ae = j.layers as any[];
    check(ae.length === comp.layers.length, `${comp.name}: ${ae.length} layers in AE vs ${comp.layers.length} in IR`);
    // IR lists layers top → bottom, like AE (index 1 = top).
    comp.layers.forEach((L: any, i: number) => {
      const A = ae.find((x: any) => x.id === L.id);
      if (!check(!!A, `${comp.name}: layer ${L.id} missing`)) return;
      check(A.index === i + 1, `${L.id}: index ${A.index} vs ${i + 1}`);
      check(A.name === L.name, `${L.id}: name "${A.name}" vs "${L.name}"`);
      const lin = L.in ?? 0, lout = L.out ?? comp.dur;
      check(Math.abs(A.in - lin) < 1e-3 && Math.abs(A.out - lout) < 1e-3, `${L.id}: timing ${A.in}–${A.out} vs ${lin}–${lout}`);
      if (L.threeD !== undefined) check(!!A.threeD === !!L.threeD, `${L.id}: threeD ${A.threeD} vs ${L.threeD}`);
      const root = { c: A.props };
      for (const p of L.props ?? []) compareProp(`${L.id}/${p.p}`, p, byPath(root, p.p));
      for (const g of L.groups ?? []) compareGroups(`${L.id}/${g.at}`, byPath(root, g.at), g.items);
      if (L.text) {
        const doc = byPath(root, 'ADBE Text Properties/ADBE Text Document');
        check(doc?.v?.text === L.text.text, `${L.id}: text "${doc?.v?.text}" vs "${L.text.text}"`);
        if (L.text.size) check(Math.abs((doc?.v?.size ?? 0) - L.text.size) < 0.01, `${L.id}: font size ${doc?.v?.size} vs ${L.text.size}`);
        if (L.text.font) check(doc?.v?.font === L.text.font, `${L.id}: font ${doc?.v?.font} vs ${L.text.font}`);
      }
    });
    if (comp.renderer) check(j.comp.renderer === comp.renderer, `${comp.name}: renderer ${j.comp.renderer} vs ${comp.renderer}`);
  }
  console.log(`${file}: ok so far (${fails} failures total)`);
}
console.log(`checked ${props} properties: ${values} static values, ${keyed} keyed (${eases} eases); ${skipped} skipped (layout-relative, opaque or state-hidden)`);
for (const f of failures) console.log('  FAIL', f);
console.log(fails ? `${fails} FAILED` : 'round-trip OK');
process.exitCode = fails ? 1 : 0;
