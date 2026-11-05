// Quality-bar check (GOAL §6): the kinetic typography spec rendered by Remotion and by ae-compose in After Effects,
// at the same times, stacked side by side (top: AE, bottom: Remotion) → docs/quality/kinetic-compare.png.
// Run: npx tsx tests/quality/compare.ts
import path from 'node:path';
import sharp, { type OverlayOptions } from 'sharp';
import { bundle } from '@remotion/bundler';
import { renderStill, selectComposition } from '@remotion/renderer';
import { buildScene } from '../../src/api/build.ts';
import { snapshot } from '../../src/api/index.ts';

const TIMES = [0.6, 1.1, 2.15, 3.1, 4.6, 6.4, 8.4];
const out = path.resolve('docs/quality');
const serve = await bundle({ entryPoint: path.resolve('tests/quality/remotion/index.tsx') });
const comp = await selectComposition({ serveUrl: serve, id: 'KineticType' });
const rem: string[] = [];
for (const t of TIMES) {
  const f = path.join(out, `_remotion_${t}.png`);
  await renderStill({ composition: comp, serveUrl: serve, output: f, frame: Math.round(t * 30) });
  rem.push(f);
}
await buildScene({ file: 'examples/01-kinetic-type/scene.tsx' }, { frames: 0, resetControls: true });
const ae = (await snapshot('KineticType_v001', TIMES)).files;
const W = 480, H = 270, pad = 6;
const tiles: OverlayOptions[] = [];
for (let i = 0; i < TIMES.length; i++) {
  tiles.push({ input: await sharp(ae[i]).resize(W, H).toBuffer(), left: i * (W + pad), top: 0 });
  tiles.push({ input: await sharp(rem[i]).resize(W, H).toBuffer(), left: i * (W + pad), top: H + pad });
}
await sharp({ create: { width: TIMES.length * (W + pad) - pad, height: 2 * H + pad, channels: 3, background: '#000000' } }).composite(tiles).png().toFile(path.join(out, 'kinetic-compare.png'));
console.log('wrote docs/quality/kinetic-compare.png (top row: After Effects via ae-compose, bottom row: Remotion) at', TIMES.join(', '), 's');
