// Spec for pr-cut's compiler, interchange writer, adopt and lint, with synthetic media (no Premiere).
import { describe, expect, it } from 'vitest';
import type { MediaInfo } from '@cc-mcp/core/media/probe.ts';
import { buildTranscript } from '@cc-mcp/core/transcribe/index.ts';
import { rate, ticksPerFrame, TICKS_PER_SECOND } from '@cc-mcp/core/time/timecode.ts';
import { compilePlan } from '@cc-mcp/pr-cut/plan/compile.ts';
import type { MediaResolver } from '@cc-mcp/pr-cut/plan/media.ts';
import { writeFcp7, dbToGain, pathUrl } from '@cc-mcp/pr-cut/xml/fcp7.ts';
import { adoptXml } from '@cc-mcp/pr-cut/adopt.ts';
import { lintCut } from '@cc-mcp/pr-cut/lint.ts';
import { words } from './helpers/words.ts';

const R = rate('23.976');
const tpf = ticksPerFrame(R);
const video = (path: string, duration: number, audio = true): MediaInfo => ({
  path, name: path.split('/').pop()!, kind: 'video', duration, bytes: 1, container: 'mp4',
  video: { width: 1920, height: 1080, rate: R, fps: 23.976, frames: Math.round(duration * 23.976), codec: 'h264', vfr: false },
  ...(audio ? { audio: { channels: 2, sampleRate: 48000, codec: 'aac', streams: 1 } } : {}),
});
const music: MediaInfo = { path: 'D:/m/bed.wav', name: 'bed.wav', kind: 'audio', duration: 120, bytes: 1, container: 'wav', audio: { channels: 2, sampleRate: 48000, codec: 'pcm', streams: 1 } };

const TEXT = 'So, um, the first thing we learned is that customers really care about speed. | And, uh, the second thing, the second thing is trust. | We built the whole launch around that idea.';
const iv = buildTranscript('D:/iv.mp4', 'h1', { engine: 't', duration: 30, words: words(TEXT).map(({ text, start, end, p }) => ({ text, start, end, p })) });

function resolver(): MediaResolver {
  const infos: Record<string, MediaInfo> = { iv: video('D:/iv.mp4', 30), broll: video('D:/b/desk.mp4', 12, false), music };
  return {
    path: (s) => infos[s]?.path ?? s,
    key: (s) => s,
    info: async (s) => { if (!infos[s]) throw new Error(`no ${s}`); return infos[s]; },
    transcript: async (s) => { if (s !== 'iv') throw new Error('no transcript'); return iv; },
  };
}

describe('compilePlan', () => {
  it('resolves sentences, quotes and word ranges, lays pieces end to end on the sequence grid', async () => {
    const c = await compilePlan({ name: 't', segments: [
      { id: 'hook', src: 'iv', quote: 'we built the whole launch around that idea', tighten: false },
      { id: 'a', src: 'iv', sentences: 's1', tighten: false },
      { id: 'b', src: 'iv', words: [17, 21], tighten: false },
    ] }, resolver());
    expect(c.segments.map((s) => s.words)).toEqual([[24, 31], [0, 13], [17, 21]]);
    let cursor = 0;
    for (const p of c.pieces) { expect(p.start).toBe(cursor); cursor = p.end; }
    for (const cl of c.timeline.clips) expect((cl.outTicks - cl.inTicks) / tpf).toBe(cl.end - cl.start);
    expect(c.timeline.markers.map((m) => m.name)).toEqual(['hook', 'a', 'b']);
  });

  it('tightens: removes fillers, repeats and long pauses with cuts in the gaps, never inside a word', async () => {
    const c = await compilePlan({ name: 't', segments: [{ id: 'all', src: 'iv', sentences: ['s1', 's3'] }] }, resolver());
    expect(c.stats.removed.fillers).toBeGreaterThanOrEqual(2);
    expect(c.stats.removed.repeats).toBe(3);
    expect(c.stats.removed.pauses).toBeGreaterThanOrEqual(1);
    const kept = c.pieces.flatMap((p) => iv.words.slice(p.words![0], p.words![1] + 1).map((w) => w.text));
    expect(kept).not.toContain('um,');
    expect(kept).not.toContain('uh,');
    expect(kept.join(' ')).toContain('the second thing is trust.');
    for (const p of c.pieces) {
      for (const w of iv.words) {
        expect(p.inS <= w.start + 1e-6 || p.inS >= w.end - 1e-6).toBe(true);
        expect(p.outS <= w.start + 1e-6 || p.outS >= w.end - 1e-6).toBe(true);
      }
      expect(Math.abs(p.inS * 23.976 - Math.round(p.inS * 23.976))).toBeLessThan(1e-6 * 23.976 + 1e-9 + 0.001);
    }
    expect(lintCut(c).filter((i) => i.rule === 'mid-word')).toEqual([]);
  });

  it('covers jump cuts by alternating a punch-in, and lint accepts it', async () => {
    const c = await compilePlan({ name: 't', segments: [{ id: 'all', src: 'iv', sentences: ['s1', 's3'] }] }, resolver());
    const v1 = c.timeline.clips.filter((x) => x.vTrack === 1);
    for (let k = 1; k < v1.length; k++) if (c.pieces[k].jump) expect((v1[k].motion?.scale ?? 100) !== (v1[k - 1].motion?.scale ?? 100)).toBe(true);
    expect(lintCut(c).filter((i) => i.rule === 'jump-cut')).toEqual([]);
    const bare = await compilePlan({ name: 't', jumpCuts: 'none', segments: [{ id: 'all', src: 'iv', sentences: ['s1', 's3'] }] }, resolver());
    expect(lintCut(bare).some((i) => i.rule === 'jump-cut')).toBe(true);
  });

  it('J-cut moves only the picture edge; lint flags it on the same camera', async () => {
    const c = await compilePlan({ name: 't', segments: [{ id: 'a', src: 'iv', sentences: 's1', tighten: false }, { id: 'b', src: 'iv', sentences: 's3', tighten: false, j: '6f' }] }, resolver());
    const [A, B] = c.timeline.clips;
    expect(A.end).toBe(B.start);
    expect(A.video!.end).toBe(A.end + 6);
    expect(B.video!.start).toBe(B.start + 6);
    expect(lintCut(c).some((i) => i.rule === 'lip-sync')).toBe(true);
  });

  it('places B-roll over a jump cut and music backtimed and ducked', async () => {
    const c = await compilePlan({ name: 't', segments: [{ id: 'all', src: 'iv', sentences: ['s1', 's3'] }], broll: [{ src: 'broll', over: 'all/2' }], music: [{ src: 'music' }] }, resolver());
    const b = c.timeline.clips.find((x) => x.id === 'b1')!;
    const cut = c.pieces[1].start;
    expect(b.vTrack).toBe(2);
    expect(b.start).toBeLessThan(cut);
    expect(b.end).toBeGreaterThan(cut);
    expect(b.aTrack).toBeUndefined();
    const m = c.timeline.clips.find((x) => x.id === 'm1')!;
    const len = (m.end - m.start) / 23.976;
    expect(m.inTicks / TICKS_PER_SECOND).toBeCloseTo(120 - len, 1); // ends on the track's own ending
    expect(m.levelKeys!.some((k) => k.db === -20)).toBe(true);
    expect(m.levelKeys!.some((k) => k.db === -12)).toBe(true);
  });

  it('refuses bad plans before touching Premiere', async () => {
    await expect(compilePlan({ name: 't', segments: [{ src: 'iv', words: [0, 999] }] }, resolver())).rejects.toThrow(/out of range/);
    await expect(compilePlan({ name: 't', segments: [{ src: 'iv', quote: 'pricing is our biggest problem today' }] }, resolver())).rejects.toThrow(/quote not found/);
    await expect(compilePlan({ name: 't', segments: [{ src: 'iv', words: [0, 3], quote: 'x y z' }] }, resolver())).rejects.toThrow(/exactly one of/);
    await expect(compilePlan({ name: 't', segments: [{ src: 'iv', sentences: 's1' }], broll: [{ src: 'broll', over: 'nope' }] }, resolver())).rejects.toThrow(/no segment "nope"/);
  });
});

describe('FCP7 writer and adopt', () => {
  it('writes linked exploded stereo, exact ticks, transitions with -1 edges, levels as linear gain', async () => {
    const c = await compilePlan({ name: 'w', segments: [{ id: 'a', src: 'iv', sentences: 's1', tighten: false, level: -6 }, { id: 'b', src: 'iv', sentences: 's3', tighten: false, transition: 'dissolve' }] }, resolver());
    const { xml, audioTracks } = writeFcp7(c.timeline);
    expect(audioTracks % 2).toBe(0);
    expect(xml).toContain('currentExplodedTrackIndex="1"');
    expect(xml).toContain(`<pproTicksIn>${c.timeline.clips[0].inTicks}</pproTicksIn>`);
    expect(xml).toContain('<start>-1</start>');
    expect(xml).toContain('<end>-1</end>');
    expect(xml).toContain(`<value>${Math.round(dbToGain(-6) * 1e6) / 1e6}</value>`);
    expect(pathUrl('C:/Users/Public/My Clip.mp4')).toBe('file://localhost/C%3a/Users/Public/My%20Clip.mp4');
  });

  it('adopt reads back what the writer wrote: edges, tracks, transitions, grade and motion filters', async () => {
    const c = await compilePlan({ name: 'r', segments: [{ id: 'a', src: 'iv', sentences: 's1', tighten: false, grade: { exposure: 0.5 } }, { id: 'b', src: 'iv', sentences: 's3', tighten: false, transition: 'dissolve', punchIn: 115 }], broll: [{ src: 'broll', over: 'b' }] }, resolver());
    const a = adoptXml(writeFcp7(c.timeline).xml);
    const spine = a.timeline.clips.filter((x) => a.spine.includes(x.id));
    const want = c.timeline.clips.filter((x) => x.vTrack === 1);
    expect(spine.map((x) => [x.start, x.end, x.inTicks, x.outTicks])).toEqual(want.map((x) => [x.start, x.end, x.inTicks, x.outTicks]));
    expect(spine[1].transitionIn).toEqual({ kind: 'dissolve', frames: want[1].transitionIn!.frames });
    expect(spine[0].raw!.video!.some((f) => /Lumetri/.test(f) && /0\.5,/.test(f))).toBe(true);
    expect(spine[1].raw!.video!.some((f) => /basic/.test(f) && /<value>115<\/value>/.test(f))).toBe(true);
    const b = a.timeline.clips.find((x) => x.vTrack === 2)!;
    expect([b.start, b.end]).toEqual([c.timeline.clips.find((x) => x.id === 'b1')!.start, c.timeline.clips.find((x) => x.id === 'b1')!.end]);
    expect(a.warnings).toEqual([]);
    // Writing the adopted timeline again gives the same clip edges.
    const again = adoptXml(writeFcp7(a.timeline).xml);
    expect(again.timeline.clips.map((x) => [x.start, x.end, x.inTicks])).toEqual(a.timeline.clips.map((x) => [x.start, x.end, x.inTicks]));
  });
});
