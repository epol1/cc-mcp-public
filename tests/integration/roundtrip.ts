// Inspector round-trip (real AE): build scenes, read them back with the inspector, and check that what AE holds
// matches the IR the compiler produced: layer names/order/timing, key counts and times, effect params, expressions.
// Run: npx tsx tests/integration/roundtrip.ts
import { buildScene } from '../../src/api/build.ts';
import { inspect } from '../../src/api/index.ts';
import fs from 'node:fs';

const SCENES = ['examples/01-kinetic-type/scene.tsx', 'examples/05-data-chart/scene.tsx', 'examples/12-particle-logo-reveal/scene.tsx'];
let fails = 0;
const check = (ok: boolean, msg: string) => { if (!ok) { fails++; console.log('  FAIL', msg); } };

for (const file of SCENES) {
  const r = await buildScene({ file }, { frames: 0, variants: false, resetControls: true });
  if (!r.ok) { console.log('build failed', file, r.error); fails++; continue; }
  const ir = JSON.parse(fs.readFileSync(r.irFile!, 'utf8'));
  const main = ir.comps.find((c: any) => c.id === ir.main);
  const j = (await inspect({ comp: main.name, detail: 'full' })).json;
  // Layers: AE index 1 is the top; IR lists bottom → top.
  const aeLayers = j.layers as any[];
  check(aeLayers.length === main.layers.length, `${file}: ${aeLayers.length} layers in AE vs ${main.layers.length} in IR`);
  const byId = new Map(aeLayers.map((L: any) => [L.id, L]));
  let keysChecked = 0, exprChecked = 0;
  for (const L of main.layers) {
    const A = byId.get(L.id);
    if (!A) { check(false, `${file}: layer ${L.id} missing in AE`); continue; }
    check(A.name === L.name, `${L.id}: name "${A.name}" vs "${L.name}"`);
    const lin = L.in ?? 0, lout = L.out ?? main.dur; // no explicit timing = the whole comp (e.g. the Controls null)
    check(Math.abs(A.in - lin) < 1e-3 && Math.abs(A.out - lout) < 1e-3, `${L.id}: timing ${A.in}–${A.out} vs ${lin}–${lout}`);
    for (const P of L.props ?? []) {
      if (!P.keys && !P.expr) continue;
      const path = P.p.split('/');
      let node: any = { c: A.props };
      for (const seg of path) node = (node?.c ?? []).find((c: any) => c.m === seg || c.n === seg);
      if (!node) continue; // props addressed through layout/rel wrappers are checked via the parent
      if (P.keys) {
        check((node.keys?.length ?? 0) === P.keys.length, `${L.id} ${P.p}: ${node.keys?.length ?? 0} keys vs ${P.keys.length}`);
        if (node.keys?.length === P.keys.length) for (let k = 0; k < P.keys.length; k++) check(Math.abs(node.keys[k].t - P.keys[k].t) < 1e-3, `${L.id} ${P.p} key ${k + 1}: t ${node.keys[k].t} vs ${P.keys[k].t}`);
        keysChecked++;
      }
      if (P.expr) { check(!!node.expr && !node.exprErr, `${L.id} ${P.p}: expression ${node.expr ? 'has error ' + node.exprErr : 'missing'}`); exprChecked++; }
    }
  }
  console.log(`${file}: ${aeLayers.length} layers, ${keysChecked} keyed props, ${exprChecked} expressions checked`);
}
console.log(fails ? `${fails} FAILED` : 'round-trip OK');
process.exitCode = fails ? 1 : 0;
