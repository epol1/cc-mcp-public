// Spec for montage plans: picture cut on the bars of a synthesized 120 BPM click track (accented downbeats), music
// ending on the track's own end, and B-roll snapped to beats.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { MediaInfo } from '@ae-mcp/core/media/probe.ts';
import { rate } from '@ae-mcp/core/time/timecode.ts';
import { compilePlan } from '@ae-mcp/pr-cut/plan/compile.ts';
import type { MediaResolver } from '@ae-mcp/pr-cut/plan/media.ts';

/** 16-bit mono WAV: a click on every beat at `bpm`, louder and lower on every 4th (the downbeat). */
function clickTrack(file: string, bpm: number, seconds: number, sr = 22050) {
  const n = Math.round(seconds * sr), data = Buffer.alloc(44 + n * 2);
  data.write('RIFF', 0); data.writeUInt32LE(36 + n * 2, 4); data.write('WAVEfmt ', 8); data.writeUInt32LE(16, 16); data.writeUInt16LE(1, 20); data.writeUInt16LE(1, 22);
  data.writeUInt32LE(sr, 24); data.writeUInt32LE(sr * 2, 28); data.writeUInt16LE(2, 32); data.writeUInt16LE(16, 34); data.write('data', 36); data.writeUInt32LE(n * 2, 40);
  const period = 60 / bpm;
  for (let i = 0; i < n; i++) {
    const t = i / sr, k = Math.floor(t / period), dt = t - k * period;
    const down = k % 4 === 0;
    const env = dt < 0.08 ? Math.exp(-dt * (down ? 30 : 60)) : 0;
    const v = env * (down ? 0.9 : 0.45) * Math.sin(2 * Math.PI * (down ? 80 : 1500) * dt) + (dt < 0.002 ? 0.3 : 0);
    data.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(v * 32767))), 44 + i * 2);
  }
  fs.writeFileSync(file, data);
}

const R = rate('23.976');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'prc-montage-'));
const music = path.join(dir, 'click120.wav');
clickTrack(music, 120, 40);
const vid = (p: string, d: number): MediaInfo => ({ path: p, name: path.basename(p), kind: 'video', duration: d, bytes: 1, container: 'mp4', video: { width: 1920, height: 1080, rate: R, fps: 23.976, frames: Math.round(d * 23.976), codec: 'h264', vfr: false } });
const infos: Record<string, MediaInfo> = { a: vid('D:/b/a.mp4', 20), b: vid('D:/b/b.mp4', 20), music: { path: music, name: 'click120.wav', kind: 'audio', duration: 40, bytes: 1, container: 'wav', audio: { channels: 1, sampleRate: 22050, codec: 'pcm', streams: 1 } } };
const resolver: MediaResolver = { path: (s) => infos[s].path, key: (s) => s, info: async (s) => infos[s], transcript: async () => { throw new Error('none'); } };

describe('montage', () => {
  it('cuts picture on bars and ends on the track end', async () => {
    const c = await compilePlan({ name: 'm', montage: { music: 'music', clips: ['a', 'b'], cut: 'bar', length: 16 } }, resolver);
    const shots = c.timeline.clips.filter((x) => x.vTrack === 1);
    const m = c.timeline.clips.find((x) => x.id === 'm1')!;
    const fps = 24000 / 1001;
    // 120 BPM in 4/4: a bar is 2 s; every cut lands within a frame of a bar line of the music.
    const inS = m.inTicks / 254016000000;
    for (const s of shots.slice(1)) {
      const musicT = inS + s.start / fps;
      const offBar = Math.abs(musicT / 2 - Math.round(musicT / 2)) * 2;
      expect(offBar).toBeLessThan(1.5 / fps + 0.03);
    }
    expect(shots.length).toBeGreaterThanOrEqual(7);
    expect(shots.map((s) => s.media).slice(0, 4)).toEqual(['a', 'b', 'a', 'b']);
    expect(Math.abs((m.end - m.start) / fps + inS - 40)).toBeLessThan(0.1); // runs to the track's own end
    expect(shots.every((s) => s.aTrack === undefined)).toBe(true);
  });
  it('rejects a plan with both dialogue and a montage', async () => {
    await expect(compilePlan({ name: 'x', segments: [{ src: 'a', from: 0, to: 2 }], montage: { music: 'music', clips: ['a'] } }, resolver)).rejects.toThrow(/either dialogue segments or a montage/);
  });
});
