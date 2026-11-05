import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { beatsOf, BeatMarkers } from '../../src/dsl/beats.ts';
import { compileScene } from '../../src/compile/compile.ts';
import { scene } from '../../src/dsl/scene.ts';
import { jsx } from '../../src/dsl/jsx-runtime.ts';
import { Composition } from '../../src/dsl/primitives.ts';

/** 16-bit mono WAV with a click every 0.5 s (120 BPM), accented every 4th. */
function clickTrack(file: string, seconds = 8, sr = 22050): void {
  const n = seconds * sr, data = Buffer.alloc(n * 2);
  for (let b = 0; b < seconds * 2; b++) {
    const start = Math.round((0.25 + b * 0.5) * sr);
    for (let i = 0; i < 600 && start + i < n; i++) data.writeInt16LE(Math.round(Math.sin(i * 0.3) * Math.exp(-i / 120) * (b % 4 === 0 ? 30000 : 16000)), (start + i) * 2);
  }
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVE', 8); h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(sr, 24); h.writeUInt32LE(sr * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(data.length, 40);
  fs.writeFileSync(file, Buffer.concat([h, data]));
}

describe('beat sync in scenes (A5)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aec-beats-'));
  const wav = path.join(dir, 'clicks.wav');
  clickTrack(wav);
  (globalThis as any).__AEC_ROOT__ = path.resolve('.');
  it('beatsOf analyzes once, caches next to the file, and exposes the grid', () => {
    const B = beatsOf(wav);
    expect(B.bpm).toBeGreaterThan(118); expect(B.bpm).toBeLessThan(122);
    expect(Math.abs(B.beat(1) - B.beat(0) - 0.5)).toBeLessThan(0.02);
    expect(B.bars(2)).toBeCloseTo(4, 1);
    expect(B.snap(B.beat(3) + 0.05)).toBeCloseTo(B.beat(3), 3);
    expect(B.offBeat([B.beat(2) + 0.08, B.beat(4)])).toHaveLength(1);
    expect(fs.existsSync(wav + '.beats.json')).toBe(true);
    const t0 = Date.now(); beatsOf(wav); expect(Date.now() - t0).toBeLessThan(500); // cached
    expect(beatsOf(wav, { offset: 1 }).beat(0)).toBeCloseTo(B.beat(0) + 1, 6);
  }, 60_000);
  it('BeatMarkers writes "bar N" on downbeats and "beat" on the rest', () => {
    const B = beatsOf(wav);
    const r = compileScene(scene({ name: 'B', duration: '4s' }, () => jsx(Composition, { children: [jsx(BeatMarkers, { beats: B, to: 4 })] })));
    const mk = r.ir.comps[0].markers;
    expect(mk.length).toBeGreaterThanOrEqual(7);
    expect(mk.filter((m: any) => /^bar \d+$/.test(m.comment)).length).toBeGreaterThanOrEqual(1);
    expect(mk.every((m: any) => m.t < 4)).toBe(true);
  }, 60_000);
});
