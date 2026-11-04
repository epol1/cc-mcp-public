// IR schema: every showcase compiles to an IR that validates; malformed IRs fail with a readable path; every
// generated request script is valid ES3.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadScene } from '../../src/scene/load.ts';
import { compileScene } from '../../src/compile/compile.ts';
import { validateIr } from '../../src/ir/schema.ts';
import { assertEs3 } from '../../src/bridge/index.ts';
import { toEs3Literal } from '../../src/codegen/literal.ts';

const scenes = fs.readdirSync('examples').map((d) => path.join('examples', d, 'scene.tsx')).filter((f) => fs.existsSync(f));

describe('showcase IRs validate', () => {
  for (const file of scenes) {
    it(file, async () => {
      const { def, file: f } = await loadScene({ file });
      const variants = def.config.variants ? Object.keys(def.config.variants) : [undefined];
      for (const v of variants) {
        const { ir } = compileScene(def, { sceneFile: f, variant: v, params: v ? def.config.variants![v] : undefined });
        expect(() => validateIr(ir)).not.toThrow();
        // the request the bridge would send is valid ES3
        expect(() => assertEs3(`AEC.build(${toEs3Literal(ir)}, {});`)).not.toThrow();
      }
    }, 30_000);
  }
});

describe('malformed IR is rejected with a path', () => {
  const base = () => ({ irVersion: 1, scene: 'T', main: 'm', comps: [{ id: 'm', name: 'T_v001', w: 640, h: 360, fps: 30, dur: 2, layers: [
    { id: 'a', type: 'solid', name: 'A', solid: { color: [1, 0, 0] } },
    { id: 'b', type: 'null', name: 'B', props: [{ p: 'ADBE Transform Group/ADBE Opacity', keys: [{ t: 0, v: 0 }, { t: 1, v: 100 }] }] },
  ] }] });
  it('accepts the base IR', () => expect(() => validateIr(base())).not.toThrow());
  it('duplicate layer ids', () => { const ir: any = base(); ir.comps[0].layers[1].id = 'a'; expect(() => validateIr(ir)).toThrow(/comps\[0\]\.layers\[1\]\.id: duplicate layer id "a"/); });
  it('unknown parent', () => { const ir: any = base(); ir.comps[0].layers[0].parent = 'zzz'; expect(() => validateIr(ir)).toThrow(/parent "zzz"/); });
  it('decreasing key times', () => { const ir: any = base(); ir.comps[0].layers[1].props[0].keys[1].t = -1; expect(() => validateIr(ir)).toThrow(/keys\[1\]\.t: key times must not decrease/); });
  it('NaN values', () => { const ir: any = base(); ir.comps[0].dur = NaN; expect(() => validateIr(ir)).toThrow(/comps\[0\]\.dur/); });
  it('footage without a declared asset', () => { const ir: any = base(); ir.comps[0].layers.push({ id: 'f', type: 'footage', name: 'F', footage: { asset: 'nope' } }); expect(() => validateIr(ir)).toThrow(/asset "nope"/); });
  it('precomp listed after its user', () => { const ir: any = base(); ir.comps[0].layers.push({ id: 'p', type: 'precomp', name: 'P', precomp: { comp: 'late' } }); ir.comps.push({ id: 'late', name: 'L', w: 10, h: 10, fps: 30, dur: 1, layers: [] }); expect(() => validateIr(ir)).toThrow(/must be listed before/); });
  it('non-ES3 request', () => expect(() => assertEs3('AEC.build({a: 1,}, {});')).toThrow(/not valid ES3/));
});
