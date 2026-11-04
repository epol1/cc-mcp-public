// Verifies live controls: retimable-keys rig (delay/duration/distance) and sticky controls on rebuild.
import fs from 'node:fs';
import { buildScene, applyEdits, runExtendScript } from '../../src/api/index.ts';
import { resolveEasing } from '../../src/shared/easing.ts';

const SRC = `import { scene, Composition, Solid, Text, tween, control } from 'ae-compose';
export default scene({ name: 'TestLive', width: 1280, height: 720, fps: 30, duration: '4s' }, () => (
  <Composition>
    <Solid color="#101216" />
    <Text id="t" name="Title" font="Inter-Bold" size={90} y={360}
      animate={{ y: tween({ from: control('Rise', 80), duration: control('Rise Duration', 0.6), delay: control('Rise Delay', 0.2), easing: 'easeOutCubic' }) }}>LIVE</Text>
  </Composition>
));`;
fs.writeFileSync('tests/integration/testlive.tsx', SRC);
const ease = resolveEasing('easeOutCubic').fn;
const expected = (t: number, rise: number, dur: number, delay: number) => 360 + rise * (1 - ease(Math.min(1, Math.max(0, (t - delay) / dur))));
const sample = async (): Promise<number[]> => {
  const r = await runExtendScript(`(function(){var c=null;for(var i=1;i<=app.project.numItems;i++){var it=app.project.item(i);if(it instanceof CompItem&&it.name=="TestLive_v001")c=it;} var L=c.layer("Title"); var p=L.property("ADBE Transform Group").property("ADBE Position_1"); var o=[]; for(var f=0;f<=90;f+=3) o.push(p.valueAtTime(f/30,false)); return o.join(",");})()`);
  if (!r.ok) throw new Error(r.error);
  return r.result.split(',').map(Number);
};
const check = (vals: number[], rise: number, dur: number, delay: number, label: string) => {
  let maxErr = 0;
  vals.forEach((v, i) => { maxErr = Math.max(maxErr, Math.abs(v - expected((i * 3) / 30, rise, dur, delay))); });
  console.log(`${maxErr < 0.6 ? 'PASS' : 'FAIL'} ${label}: max |y - expected| = ${maxErr.toFixed(3)} px`);
  return maxErr;
};

const b1 = await buildScene({ file: 'tests/integration/testlive.tsx' }, { frames: 0, resetControls: true }); // start from the code defaults
if (!b1.ok) throw new Error(b1.error);
check(await sample(), 80, 0.6, 0.2, 'defaults (Rise 80, Duration 0.6, Delay 0.2)');
const e = await applyEdits({ comp: 'TestLive_v001', ops: [
  { op: 'setEffect', layer: 'Controls', effect: 'Rise', params: { Slider: 200 } },
  { op: 'setEffect', layer: 'Controls', effect: 'Rise Duration', params: { Slider: 1.2 } },
  { op: 'setEffect', layer: 'Controls', effect: 'Rise Delay', params: { Slider: 1.0 } },
] }, { frames: 0 });
if (!e.ok) throw new Error(e.error);
check(await sample(), 200, 1.2, 1.0, 'after changing controls in AE (Rise 200, Duration 1.2, Delay 1.0) — no rebuild');
const b2 = await buildScene({ file: 'tests/integration/testlive.tsx' }, { frames: 0 });
console.log(`rebuild: restoredControls=${b2.restoredControls}`);
check(await sample(), 200, 1.2, 1.0, 'after rebuilding from code (sticky controls kept the tweaks)');
