// GOAL §5.3 proof: build keys in AE for many curves, read valueAtTime at every half frame, compare with
// the reference curve. Usage: npx tsx tests/integration/ease-verify.ts  (also run from ease.test.ts)
import { callRuntime, evalAE } from '../../src/bridge/index.ts';
import { resolveEasing } from '../../src/shared/easing.ts';
import { springProgress } from '../../src/shared/spring.ts';
import type { EasingCurve } from '../../src/shared/easing.ts';
import { curveKnots, knotsToKeys } from '../../src/compile/keys.ts';
import type { PropKind } from '../../src/compile/keys.ts';

const FPS = 30;
interface Case { name: string; curve: EasingCurve; T: number; path: string; kind: PropKind; from: number[]; to: number[]; layer: 'solid' | 'shape'; tolPx: number }

// Natural springs are asymptotic like in the compiler (src/compile/values.ts): their keys run on past the settle time
// until the rest of the move is within tolerance, so the comparison covers every key.
const spring = (cfg: any): EasingCurve => { const s = springProgress(cfg, FPS); return { name: 'spring', fn: (t: number) => s.fn(t * s.settleSec), asymptotic: true } as EasingCurve; };
const settle = (cfg: any) => springProgress(cfg, FPS).settleSec;

export const CASES: Case[] = [
  { name: 'easeOutCubic opacity', curve: resolveEasing('easeOutCubic'), T: 0.8, path: 'ADBE Transform Group/ADBE Opacity', kind: 'oneD', from: [0], to: [100], layer: 'solid', tolPx: 0.01 },
  { name: 'easeInOutQuart rotation', curve: resolveEasing('easeInOutQuart'), T: 1.2, path: 'ADBE Transform Group/ADBE Rotate Z', kind: 'oneD', from: [-30], to: [45], layer: 'solid', tolPx: 0.01 },
  { name: 'easeOutBack scale (multi)', curve: resolveEasing('easeOutBack'), T: 0.7, path: 'ADBE Transform Group/ADBE Scale', kind: 'multi', from: [0, 0, 100], to: [100, 80, 100], layer: 'solid', tolPx: 0.01 },
  { name: 'snappy position (spatial)', curve: resolveEasing('snappy'), T: 0.9, path: 'ADBE Transform Group/ADBE Position', kind: 'spatial', from: [300, 800], to: [1500, 300], layer: 'solid', tolPx: 0.05 },
  { name: 'spring default x (separated)', curve: spring({}), T: settle({}), path: 'ADBE Transform Group/ADBE Position_0', kind: 'oneD', from: [200], to: [700], layer: 'solid', tolPx: 0.15 },
  { name: 'spring bouncy y (separated)', curve: spring({ damping: 6, stiffness: 180 }), T: settle({ damping: 6, stiffness: 180 }), path: 'ADBE Transform Group/ADBE Position_1', kind: 'oneD', from: [900], to: [400], layer: 'solid', tolPx: 0.15 },
  { name: 'spring scale (multi)', curve: spring({ damping: 12, stiffness: 200 }), T: settle({ damping: 12, stiffness: 200 }), path: 'ADBE Transform Group/ADBE Scale', kind: 'multi', from: [0, 0, 100], to: [100, 100, 100], layer: 'solid', tolPx: 0.05 },
  { name: 'elastic rotation', curve: resolveEasing('elastic'), T: 1.4, path: 'ADBE Transform Group/ADBE Rotate Z', kind: 'oneD', from: [0], to: [90], layer: 'solid', tolPx: 0.05 },
  { name: 'bounce y (separated)', curve: resolveEasing('bounce'), T: 1.2, path: 'ADBE Transform Group/ADBE Position_1', kind: 'oneD', from: [100], to: [900], layer: 'solid', tolPx: 0.15 },
  { name: 'trim end (shape 1D)', curve: resolveEasing('easeInOutCubic'), T: 1.0, path: 'ADBE Root Vectors Group/ADBE Vector Group/ADBE Vectors Group/ADBE Vector Filter - Trim/ADBE Vector Trim End', kind: 'oneD', from: [0], to: [100], layer: 'shape', tolPx: 0.01 },
  { name: 'fill color (color)', curve: resolveEasing('easeOutQuad'), T: 0.6, path: 'ADBE Root Vectors Group/ADBE Vector Group/ADBE Vectors Group/ADBE Vector Graphic - Fill/ADBE Vector Fill Color', kind: 'color', from: [1, 0.2, 0.2, 1], to: [0.2, 0.4, 1, 1], layer: 'shape', tolPx: 0.002 },
];

export async function runEaseVerification(): Promise<{ name: string; keys: number; maxErr: number; tol: number; pass: boolean }[]> {
  const layers: any[] = [];
  const START = 0.5;
  const spans: number[] = [];
  CASES.forEach((c, i) => {
    const range = Math.max(...c.to.map((t, d) => Math.abs(t - c.from[d])));
    const knots = curveKnots(c.curve, c.T, FPS, c.tolPx / Math.max(range, 1e-9) * 0.6);
    const keys = knotsToKeys(knots, c.from, c.to, START, c.kind);
    spans[i] = Math.max(c.T, keys[keys.length - 1].t - START);
    const props: any[] = [];
    if (c.path.includes('ADBE Position_')) props.push({ p: 'ADBE Transform Group/ADBE Position', sep: true });
    props.push({ p: c.path, keys });
    const L: any = { id: `case${i}`, type: c.layer, name: c.name, props };
    if (c.layer === 'solid') L.solid = { color: [0.5, 0.5, 0.5], w: 100, h: 100 };
    else L.groups = [{ at: 'ADBE Root Vectors Group', items: [{ mn: 'ADBE Vector Group', kids: [{ at: 'ADBE Vectors Group', items: [{ mn: 'ADBE Vector Shape - Rect' }, { mn: 'ADBE Vector Graphic - Fill' }, { mn: 'ADBE Vector Filter - Trim' }] }] }] }];
    layers.push(L);
  });
  const project = { irVersion: 1, scene: 'EaseVerify', comps: [{ id: 'easeverify', name: 'EaseVerify', w: 1920, h: 1080, fps: FPS, dur: 4, layers }] };
  const r = await callRuntime('build', [project, { replace: true, open: false }]);
  if (!r.ok) throw new Error('build failed: ' + r.error + ' @' + r.node);
  // Sample valueAtTime in AE at half frames over each animation.
  const samplesScript = `(function(){ var c=null; for(var i=1;i<=app.project.numItems;i++){var it=app.project.item(i); if(it instanceof CompItem && it.comment.indexOf("aec:easeverify")===0) c=it;}
    var out=[]; var cases=${JSON.stringify(CASES.map((c, i) => ({ path: c.path, T: spans[i] })))};
    for (var k=0;k<cases.length;k++){ var L=null; for (var j=1;j<=c.numLayers;j++) if (c.layer(j).comment==="aec:case"+k) L=c.layer(j);
      var segs=cases[k].path.split("/"); var p=L; for (var s=0;s<segs.length;s++) p=p.property(segs[s]);
      var vals=[]; var n=Math.round(cases[k].T*${FPS}*2); for (var f=0; f<=n; f++){ var v=p.valueAtTime(${START}+f/${FPS * 2}, true); vals.push(v instanceof Array ? v.join(",") : String(v)); }
      out.push(p.numKeys + "|" + vals.join(";")); }
    return out.join("\\n"); })()`;
  const sr = await evalAE(samplesScript, { timeoutMs: 60000 });
  if (!sr.ok) throw new Error('sampling failed: ' + sr.error);
  return sr.result.split('\n').map((line, i) => {
    const c = CASES[i];
    const [nk, vals] = line.split('|');
    let maxErr = 0;
    vals.split(';').forEach((s, f) => {
      const got = s.split(',').map(Number);
      const u = (f / (FPS * 2)) / c.T;
      const p = (c.curve as any).asymptotic ? c.curve.fn(u) : c.curve.fn(Math.min(1, u));
      const exp = c.from.map((fv, d) => fv + (c.to[d] - fv) * p);
      for (let d = 0; d < exp.length && d < got.length; d++) maxErr = Math.max(maxErr, Math.abs(got[d] - exp[d]));
    });
    return { name: c.name, keys: +nk, maxErr, tol: c.tolPx, pass: maxErr <= c.tolPx };
  });
}

if (process.argv[1] && process.argv[1].endsWith('ease-verify.ts')) {
  const res = await runEaseVerification();
  for (const r of res) console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name.padEnd(30)} keys=${String(r.keys).padStart(2)}  maxErr=${r.maxErr.toExponential(2)}  tol=${r.tol}`);
}
