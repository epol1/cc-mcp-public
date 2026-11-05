import { it } from 'vitest';
import { jsx } from '../../src/dsl/jsx-runtime.ts';
import { scene, Composition, Text } from '../../src/dsl/index.ts';
import { compileScene } from '../../src/compile/compile.ts';
import { Captions, Emphasis, Decode, Typewriter, SplitFlap, VariableFont, AutoFit } from '../../src/dsl/type/index.ts';
it('smoke', () => {
  const words = [{ text: 'Make', start: 0.2, end: 0.5 }, { text: 'motion', start: 0.5, end: 0.9 }, { text: 'that', start: 1.0, end: 1.2 }, { text: 'reads.', start: 1.2, end: 1.8 }];
  const r = compileScene(scene({ name: 'T', duration: 4 } as any, () => jsx(Composition, { children: [
    jsx(Captions, { id: 'subs', words, style: 'boldPop', karaoke: { underline: true }, box: true }),
    jsx(Emphasis, { id: 'em', word: 'motion', kind: 'circle', wordColor: '#ff0000', children: jsx(Text, { id: 'title', size: 100 , children: 'MAKE MOTION' }) }),
    jsx(Decode, { id: 'dec', children: 'DECODE\rTHIS' }),
    jsx(Typewriter, { id: 'tw', children: 'Hello, world. Typing.' }),
    jsx(SplitFlap, { id: 'sf', children: 'GATE 12' }),
    jsx(VariableFont, { id: 'vf', fonts: ['Inter-Regular', 'Inter-Bold', 'Inter-Black'], children: 'WEIGHT' }),
    jsx(AutoFit, { id: 'af', fit: { width: 600, height: 200 }, size: 120, children: 'A long headline that needs to fit inside a small box' }),
  ] })));
  const m = r.ir.comps[0];
  console.log(r.warnings);
  console.log(m.layers.map((L: any) => `${L.id} | ${L.name} | ${L.type}`).join('\n'));
  const ul = m.layers.find((L: any) => L.id === 'subs.uline');
  console.log(JSON.stringify(ul.groups, null, 1).slice(0, 3000));
  const cue = m.layers.find((L: any) => L.id === 'subs.cue1');
  console.log(JSON.stringify(cue.props, null, 1).slice(0, 4000));
});
