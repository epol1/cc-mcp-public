import { describe, expect, it } from 'vitest';
import { pseudoFfxBytes, pseudoMatchName } from '../../src/compile/ffx/pseudo.ts';
import type { PseudoEffectDef } from '../../src/compile/ffx/pseudo.ts';
import { ControlRegistry } from '../../src/compile/controls.ts';
import { control } from '../../src/dsl/control.ts';
import { rigEffectSpec, rigRef } from '../../src/compile/rigfx.ts';

/** Minimal RIFX reader: chunk tree as { id, type?, body, kids? }. */
function tree(buf: Buffer, off = 0, end = buf.length): any[] {
  const out: any[] = [];
  while (off + 8 <= end) {
    const id = buf.toString('latin1', off, off + 4), size = buf.readUInt32BE(off + 4), body = off + 8;
    const node: any = { id, size, body: buf.subarray(body, body + size) };
    if (id === 'RIFX' || id === 'LIST') { node.type = buf.toString('latin1', body, body + 4); node.kids = tree(buf, body + 4, body + size); }
    out.push(node);
    off = body + size + (size & 1);
  }
  return out;
}
const find = (nodes: any[], pred: (n: any) => boolean): any => { for (const n of nodes) { if (pred(n)) return n; const r = n.kids && find(n.kids, pred); if (r) return r; } return null; };

const DEF: PseudoEffectDef = { name: 'aec Test', params: [
  { kind: 'slider', name: 'Speed', default: 1.5, min: 0, max: 5 },
  { kind: 'checkbox', name: 'On', default: true },
  { kind: 'color', name: 'Tint', default: [1, 0.5, 0] },
  { kind: 'popup', name: 'Mode', items: ['A', 'B'], default: 2 },
  { kind: 'group', name: 'More', params: [{ kind: 'angle', name: 'Tilt', default: 12 }, { kind: 'point', name: 'Origin', default: [960, 540] }] },
] };

describe('pseudo-effect presets (D74)', () => {
  it('writes a well-formed RIFX FaFX with the effect definition and values', () => {
    const { bytes, matchName, params } = pseudoFfxBytes(DEF);
    expect(bytes.toString('latin1', 0, 4)).toBe('RIFX');
    expect(bytes.readUInt32BE(4) + 8).toBe(bytes.length);
    const t = tree(bytes);
    expect(t[0].type).toBe('FaFX');
    const sspc = find(t, (n) => n.type === 'sspc');
    expect(sspc.kids[0].id).toBe('fnam');
    const parT = sspc.kids.find((k: any) => k.type === 'parT');
    expect(parT.kids[0].body.readUInt32BE(0)).toBe(params.length + 2); // parn: param 0 + params + compositing options
    const pards = parT.kids.filter((k: any) => k.id === 'pard');
    expect(pards.every((p: any) => p.size === 148)).toBe(true);
    const types = pards.map((p: any) => p.body.readUInt32BE(12));
    expect(types).toEqual([0, 10, 4, 5, 7, 13, 3, 6, 14, 9]);
    const speed = pards[1].body;
    expect(speed.toString('utf8', 16, 21)).toBe('Speed');
    expect(speed.readDoubleBE(56)).toBe(1.5);
    expect(speed.readFloatBE(116)).toBe(5);
    expect([...pards[3].body.subarray(56, 60)]).toEqual([255, 255, 128, 0]); // ARGB
    const popup = pards[4].body;
    expect([popup.readInt32BE(56), popup.readInt16BE(60), popup.readInt16BE(62)]).toEqual([2, 2, 2]);
    expect(parT.kids.find((k: any) => k.id === 'pdnm' && k.body.includes('A|B'))).toBeTruthy();
    expect(matchName).toMatch(/^Pseudo\/aec Test [0-9a-f]{6}$/);
    expect(params.map((p) => [p.name, p.index])).toEqual([['Speed', 1], ['On', 2], ['Tint', 3], ['Mode', 4], ['More', 5], ['Tilt', 6], ['Origin', 7], ['', 8]]);
  });
  it('the matchName follows the definition (a changed rig is a new effect) and fits AE limits', () => {
    expect(pseudoMatchName(DEF)).toBe(pseudoMatchName(JSON.parse(JSON.stringify(DEF))));
    expect(pseudoMatchName({ ...DEF, params: DEF.params.slice(1) })).not.toBe(pseudoMatchName(DEF));
    const long = pseudoMatchName({ name: 'aec A Very Long Rig Name Here', params: [] });
    expect(Buffer.byteLength(long + '-0001')).toBeLessThan(40);
  });
  it('rejects names AE cannot hold or paths cannot address', () => {
    expect(() => pseudoFfxBytes({ name: 'x'.repeat(32), params: [] })).toThrow(/31 bytes/);
    expect(() => pseudoFfxBytes({ name: 'a/b', params: [] })).toThrow(/can't contain/);
    expect(() => pseudoFfxBytes({ name: 'ok', params: [{ kind: 'slider', name: 'S', default: 0 }, { kind: 'slider', name: 'S', default: 1 }] })).toThrow(/duplicate/);
    expect(() => pseudoFfxBytes({ name: 'ok', params: [{ kind: 'popup', name: 'P', items: ['a|b'] }] })).toThrow(/\|/);
  });
});

describe('rig effects and grouped controls', () => {
  it('rigEffectSpec addresses params by index and converts values', () => {
    const spec = rigEffectSpec(DEF, 'Spinner', { Speed: 3, On: false, Tint: '#ff0000', Mode: 'A' }, { fps: 30, t0: 0, controls: new ControlRegistry(), seed: 1 });
    expect(spec.name).toBe('Spinner');
    expect(spec.pseudo).toMatch(/\.ffx$/);
    expect(spec.props).toEqual([{ p: '#1', v: 3 }, { p: '#2', v: 0 }, { p: '#3', v: [1, 0, 0, 1] }, { p: '#4', v: 1 }]);
    expect(() => rigEffectSpec(DEF, 'X', { Nope: 1 }, { fps: 30, t0: 0, controls: new ControlRegistry(), seed: 1 })).toThrow(/no param "Nope"/);
    expect(rigRef('Spinner', 'Speed')).toBe('effect("Spinner")("Speed").value');
    expect(rigRef('Cloner', 'Seed', 'c1')).toBe('__AEC_LAYER(c1)__.effect("Cloner")("Seed").value');
  });
  it('controls with a group become one rig effect on the Controls null', () => {
    const reg = new ControlRegistry();
    const a = reg.use(control('Delay', 0.3, { group: 'Title', min: 0, max: 2 }));
    reg.use(control('Accent', '#4683c4', { group: 'Title' }));
    reg.use(control('Glow', 40));
    const on = reg.use(control('Show', true, { group: 'Title' }));
    expect(a).toBe('thisComp.layer("Controls").effect("Title")("Delay").value');
    expect(on).toBe('(thisComp.layer("Controls").effect("Title")("Show").value ? 1 : 0)');
    const L = reg.layer('c.controls');
    const items = L.groups[0].items;
    expect(items.map((i: any) => i.name)).toEqual(['Title', 'Glow']);
    expect(items[0].mn).toMatch(/^Pseudo\/Title /);
    expect(items[0].props.map((p: any) => p.p)).toEqual(['#1', '#2', '#3']);
    expect(reg.egProps('c.controls').map((e) => e.p)).toEqual(['ADBE Effect Parade/Title/Delay', 'ADBE Effect Parade/Title/Accent', 'ADBE Effect Parade/Glow/#1', 'ADBE Effect Parade/Title/Show']);
    expect(() => new ControlRegistry().layer.call((() => { const r = new ControlRegistry(); r.use(control('P', [1, 2, 3], { group: 'G' })); return r; })(), 'x')).toThrow(/can't be grouped/);
  });
});
