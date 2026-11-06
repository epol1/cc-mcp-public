// Regression specs for the independent review of pr-cut (each names the finding it guards).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { MediaInfo } from '@cc-mcp/core/media/probe.ts';
import { buildTranscript, joinTokens } from '@cc-mcp/core/transcribe/index.ts';
import { rate, ticksPerFrame } from '@cc-mcp/core/time/timecode.ts';
import { compilePlan } from '@cc-mcp/pr-cut/plan/compile.ts';
import { mediaResolver, type MediaResolver } from '@cc-mcp/pr-cut/plan/media.ts';
import { pathUrl, writeFcp7 } from '@cc-mcp/pr-cut/xml/fcp7.ts';
import { adoptXml, fileUrlToPath } from '@cc-mcp/pr-cut/adopt.ts';
import { parseEdits } from '@cc-mcp/pr-cut/edit.ts';
import { lintCut } from '@cc-mcp/pr-cut/lint.ts';
import type { Timeline } from '@cc-mcp/pr-cut/timeline.ts';

const R = rate('25');
const vid = (p: string, d: number): MediaInfo => ({ path: p, name: path.basename(p), kind: 'video', duration: d, bytes: 1, container: 'mp4', video: { width: 1920, height: 1080, rate: R, fps: 25, frames: d * 25, codec: 'h264', vfr: false }, audio: { channels: 2, sampleRate: 48000, codec: 'aac', streams: 1 } });

/** Words that touch (gap 0), as refinement produces for connected speech; "|" = 1.5 s pause. */
function touching(text: string, start = 1.028) {
  const out: { text: string; start: number; end: number; p: number }[] = [];
  let t = start;
  for (const tok of text.split(' ')) { if (tok === '|') { t += 1.5; continue; } out.push({ text: tok, start: t, end: t + 0.29, p: 0.9 }); t += 0.29; }
  return out;
}

function resolverFor(words: { text: string; start: number; end: number; p: number }[]): MediaResolver {
  const tr = buildTranscript('D:/iv.mp4', 'h', { engine: 't', duration: 60, words });
  const info = vid('D:/iv.mp4', 60);
  return { path: () => info.path, key: () => 'iv', info: async () => info, transcript: async () => tr };
}

describe('review #1: media keys never collide', () => {
  it('gives two files with the same name different keys', () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'prc-keys-'));
    for (const cam of ['A', 'B']) { fs.mkdirSync(path.join(d, cam)); fs.writeFileSync(path.join(d, cam, 'C0001.MP4'), cam); }
    const m = mediaResolver({}, { baseDir: d });
    expect(m.key(path.join(d, 'A', 'C0001.MP4'))).not.toBe(m.key(path.join(d, 'B', 'C0001.MP4')));
    const aliased = mediaResolver({ acam: path.join(d, 'A', 'C0001.MP4') }, { baseDir: d });
    expect(aliased.key('acam')).toBe('acam');
  });
});

describe('review #6/#7: tightening keeps what the plan keeps', () => {
  it('never clips a kept word, even when words touch and cuts fall between frames', async () => {
    const c = await compilePlan({ name: 't', segments: [{ src: 'iv', words: [0, 6] }] }, resolverFor(touching('We um really really need this now.')));
    expect(lintCut(c).filter((i) => i.rule === 'mid-word')).toEqual([]);
    const tr = (await resolverFor(touching('We um really really need this now.')).transcript('iv'));
    for (const p of c.pieces) {
      expect(p.inS).toBeLessThanOrEqual(tr.words[p.words![0]].start + 1e-9);
      expect(p.outS).toBeGreaterThanOrEqual(tr.words[p.words![1]].end - 1e-9);
    }
  });
  it('does not remove a "repeat" whose second copy is outside the segment or across a sentence end', async () => {
    const words = touching('We doubled revenue in a year. In a year we hired ten people.');
    const c = await compilePlan({ name: 't', segments: [{ src: 'iv', sentences: 's1' }] }, resolverFor(words));
    expect(c.stats.removed.repeats).toBe(0);
    expect(c.segments[0].text).toBe('We doubled revenue in a year.');
    expect(c.pieces).toHaveLength(1);
  });
  it('honours an explicit cut even when the leftover is shorter than minPiece', async () => {
    const words = touching('The thing that, that bothered me most was guilt.');
    const c = await compilePlan({ name: 't', segments: [{ src: 'iv', words: [0, 8], tighten: { repeats: false, cut: [2], minPiece: '1s' } }] }, resolverFor(words));
    const tr = await resolverFor(words).transcript('iv');
    const kept = c.pieces.flatMap((p) => tr.words.slice(p.words![0], p.words![1] + 1).map((w) => w.text));
    expect(kept.join(' ')).toBe('The thing that bothered me most was guilt.'); // "The thing" (0.58 s < minPiece) stays apart from the cut
  });
  it('keeps "But" at a segment start (only filler-like words are dropped at edges, and it is reported)', async () => {
    const c = await compilePlan({ name: 't', segments: [{ src: 'iv', words: [0, 4] }] }, resolverFor(touching('But um we never shipped.')));
    const tr = await resolverFor(touching('But um we never shipped.')).transcript('iv');
    expect(tr.words.slice(c.pieces[0].words![0], c.pieces[0].words![1] + 1)[0].text).toBe('But');
    const c2 = await compilePlan({ name: 't', segments: [{ src: 'iv', words: [0, 4] }] }, resolverFor(touching('So um we never shipped.')));
    expect(c2.warnings.some((w) => /dropped "So"/.test(w))).toBe(true);
  });
});

describe('review #11: music fades combine with ducking', () => {
  it('starts a faded-in bed at -60 dB even when a duck key shares the frame', async () => {
    const info = vid('D:/iv.mp4', 60);
    const music: MediaInfo = { path: 'D:/m.wav', name: 'm.wav', kind: 'audio', duration: 200, bytes: 1, container: 'wav', audio: { channels: 2, sampleRate: 48000, codec: 'pcm', streams: 1 } };
    const tr = buildTranscript('D:/iv.mp4', 'h', { engine: 't', duration: 60, words: touching('Hello there everyone. | This matters.') });
    const r: MediaResolver = { path: (s) => (s === 'm' ? music.path : info.path), key: (s) => s, info: async (s) => (s === 'm' ? music : info), transcript: async () => tr };
    const c = await compilePlan({ name: 'm', segments: [{ src: 'iv', from: 0, to: 6 }], music: [{ src: 'm', fadeIn: '1s', fadeOut: '1s', ending: 'fade' }] }, r);
    const k = c.timeline.clips.find((x) => x.id === 'm1')!.levelKeys!;
    expect(k[0].db).toBe(-60);
    expect(k[k.length - 1].db).toBe(-60);
    expect(Math.max(...k.filter((x) => x.frame > 25 && x.frame < 120).map((x) => x.db))).toBeLessThanOrEqual(-12);
  });
});

describe('review #12: edit ops are validated', () => {
  it('refuses unknown fields and missing targets instead of editing everything', () => {
    expect(() => parseEdits([{ op: 'delete', clip: 'V1/3' }])).toThrow(/invalid/);
    expect(() => parseEdits([{ op: 'transition', target: 'V1/2', kind: 'wipe' }])).toThrow(/invalid/);
    expect(() => parseEdits([{ op: 'move', target: 'V1/2' }])).toThrow(/before \/ after/);
    expect(parseEdits([{ op: 'tighten' }, { op: 'grade', temperature: 10 }])).toHaveLength(2);
  });
});

describe('review #15 and fresh-session findings', () => {
  it('writes and reads network paths', () => {
    expect(pathUrl('\\\\goblin\\depot\\Work\\a b.mp4')).toBe('file://goblin/depot/Work/a%20b.mp4');
    expect(fileUrlToPath('file://goblin/depot/Work/a%20b.mp4')).toBe('\\\\goblin\\depot\\Work\\a b.mp4');
    expect(fileUrlToPath('file://localhost/C%3a/Users/x.mp4').replace(/\\/g, '/')).toBe('C:/Users/x.mp4');
  });
  it('joins split number and contraction tokens', () => {
    const j = joinTokens([{ text: '200', start: 1, end: 1.2, p: 1 }, { text: ',000', start: 1.2, end: 1.4, p: 1 }, { text: 'people', start: 1.5, end: 1.9, p: 1 }, { text: 'it', start: 2, end: 2.1, p: 1 }, { text: "'s", start: 2.1, end: 2.2, p: 1 }]);
    expect(j.map((w) => w.text)).toEqual(['200,000', 'people', "it's"]);
  });
  it('round-trips head and tail fades (start-black / end-black)', () => {
    const tpf = ticksPerFrame(R);
    const t: Timeline = { name: 'f', rate: R, width: 1920, height: 1080, media: { iv: vid('D:/iv.mp4', 60) }, markers: [],
      clips: [{ id: 'a', media: 'iv', vTrack: 1, aTrack: 1, start: 0, end: 100, inTicks: 0, outTicks: 100 * tpf, fadeIn: { kind: 'dip-black', frames: 12 }, fadeOut: { kind: 'dissolve', frames: 18 } }] };
    const xml = writeFcp7(t).xml;
    expect(xml).toContain('<alignment>start-black</alignment>');
    expect(xml).toContain('<alignment>end-black</alignment>');
    const back = adoptXml(xml).timeline.clips.find((c) => c.vTrack === 1)!;
    expect([back.start, back.end, back.inTicks]).toEqual([0, 100, 0]);
    expect(back.fadeIn).toEqual({ kind: 'dip-black', frames: 12 });
    expect(back.fadeOut).toEqual({ kind: 'dissolve', frames: 18 });
  });
});

describe('titles get their track before the import', () => {
  it('creates the empty title track in the XML (importMGT on a missing track lands on V1, over the picture)', async () => {
    const c = await compilePlan({ name: 't', segments: [{ id: 's', src: 'iv', words: [0, 4] }], titles: [{ mogrt: 'D:/lt.mogrt', at: { seg: 's' }, fields: { Name: 'A' } }] }, resolverFor(touching('We never shipped it then.')));
    expect(c.titles[0].track).toBe(3);
    expect(c.timeline.minVideoTracks).toBe(3);
    const w = writeFcp7(c.timeline);
    expect(w.videoTracks).toBe(3);
    expect(w.xml.match(/<track>/g)?.length).toBe(3); // video tracks are bare <track>; audio tracks carry attributes
  });
});

describe('a presenter cutout over slides (a hand cut of the user)', () => {
  const tpf = ticksPerFrame(R);
  const file = (id: string, name: string, extra = '') => `<file id="${id}"><name>${name}</name><pathurl>file://localhost/D%3a/${encodeURIComponent(name)}</pathurl><rate><timebase>25</timebase><ntsc>FALSE</ntsc></rate><duration>2500</duration>${extra}</file>`;
  const motion = '<filter><effect><name>Basic Motion</name><effectid>basic</effectid><effectcategory>motion</effectcategory><effecttype>motion</effecttype><mediatype>video</mediatype><parameter authoringApp="PremierePro"><parameterid>scale</parameterid><name>Scale</name><valuemin>0</valuemin><valuemax>1000</valuemax><value>43</value></parameter><parameter authoringApp="PremierePro"><parameterid>center</parameterid><name>Center</name><value><horiz>-0.73</horiz><vert>0.28</vert></value></parameter></effect></filter>';
  const item = (id: string, f: string, s: number, e: number, inF: number, kind: 'video' | 'audio', extra = '') => `<clipitem id="${id}"><name>x</name><enabled>TRUE</enabled><duration>2500</duration><rate><timebase>25</timebase><ntsc>FALSE</ntsc></rate><start>${s}</start><end>${e}</end><in>${inF}</in><out>${inF + e - s}</out><pproTicksIn>${inF * tpf}</pproTicksIn><pproTicksOut>${(inF + e - s) * tpf}</pproTicksOut>${kind === 'video' ? '<alphatype>' + (f.includes('"f2"') ? 'straight' : 'none') + '</alphatype>' : ''}${f}${extra}${kind === 'audio' ? '<sourcetrack><mediatype>audio</mediatype><trackindex>1</trackindex></sourcetrack>' : ''}</clipitem>`;
  const xml = `<?xml version="1.0"?><xmeml version="4"><sequence id="s"><name>talk</name><duration>200</duration><rate><timebase>25</timebase><ntsc>FALSE</ntsc></rate><media><video><format><samplecharacteristics><rate><timebase>25</timebase><ntsc>FALSE</ntsc></rate><width>1920</width><height>1080</height></samplecharacteristics></format>
<track>${item('v1', file('f1', 'slide.png'), 0, 200, 0, 'video')}</track>
<track>${item('v2', file('f2', 'cutout.mov'), 0, 100, 50, 'video', motion)}${item('v3', '<file id="f2"/>', 100, 200, 160, 'video', motion)}</track>
</video><audio><track>${item('a1', file('f3', 'take.mov', '<media><audio><channelcount>2</channelcount></audio></media>'), 0, 100, 50, 'audio')}${item('a2', '<file id="f3"/>', 100, 200, 160, 'audio')}</track></audio></media></sequence></xmeml>`;
  it('takes the cutout with its sound as the speaker, keeps its alpha, and a punch-in keeps its position', () => {
    const a = adoptXml(xml);
    expect(a.spine).toEqual(['V2/1', 'V2/2']);
    const sp = a.timeline.clips.find((c) => c.id === 'V2/1')!;
    expect(sp.aTrack).toBe(1);
    expect(a.timeline.media[sp.media].name).toBe('take.mov');
    expect(a.timeline.media[sp.videoMedia!].name).toBe('cutout.mov');
    expect(sp.alpha).toBe('straight');
    sp.motion = { scale: 48.2 };
    const out = writeFcp7(a.timeline).xml;
    expect(out).toContain('<alphatype>straight</alphatype>');
    expect(out).toContain('<value>48.2</value>');
    expect(out).toContain('<horiz>-0.73</horiz>');
    expect(out.match(/<file id="[^"]+">\s*<name>cutout\.mov<\/name>/)).toBeTruthy();
  });
});

describe('switched programs: no cut stays on one camera (the user note on the KATG cut)', () => {
  const words = touching('One two three. | Four five six. | Seven eight nine.');
  const probe = (program: boolean, same: boolean) => ({ ensure: async () => {}, isProgram: () => program, sameCamera: () => same, cutaway: () => 40 });
  const resolver = (p: ReturnType<typeof probe>): MediaResolver => ({ ...resolverFor(words), cameras: () => p });
  it('keeps a pause inside a segment when both sides show the same camera, and covers a same-camera join with a cutaway', async () => {
    const c = await compilePlan({ name: 'show', segments: [{ id: 'a', src: 'iv', sentences: ['s1', 's2'] }, { id: 'b', src: 'iv', sentences: 's3' }] }, resolver(probe(true, true)));
    expect(c.pieces.filter((p) => p.seg === 'a')).toHaveLength(1);
    expect(c.warnings.some((w) => /kept 1 pause/.test(w))).toBe(true);
    const ca = c.timeline.clips.filter((x) => /^ca\d/.test(x.id));
    expect(ca).toHaveLength(1);
    expect(ca[0].vTrack).toBe(2);
    expect(ca[0].aTrack).toBeUndefined();
    expect(ca[0].inTicks).toBe(40 * 254016000000);
    expect(c.timeline.clips.some((x) => x.motion)).toBe(false);
  });
  it('cuts normally when the camera changes, and a single-camera source keeps its punch-ins', async () => {
    const c = await compilePlan({ name: 'show', segments: [{ id: 'a', src: 'iv', sentences: ['s1', 's2'] }] }, resolver(probe(true, false)));
    expect(c.pieces).toHaveLength(2);
    expect(c.timeline.clips.some((x) => /^ca\d/.test(x.id))).toBe(false);
    const single = await compilePlan({ name: 'iv', segments: [{ id: 'a', src: 'iv', sentences: ['s1', 's2'] }] }, resolver(probe(false, true)));
    expect(single.pieces).toHaveLength(2);
    expect(single.timeline.clips.some((x) => x.motion?.scale === 112)).toBe(true);
  });
});

describe('multicam: angles synced by sound, cut on angle changes (the user note: edit like an editor)', () => {
  const words = touching('One two three. | Four five six. | Seven eight nine.');
  const tr = buildTranscript('D:/iv.mp4', 'h', { engine: 't', duration: 60, words });
  const offsets: Record<string, number> = { camA: 0, camB: -12.5, mic: 0 }; // camB started rolling 12.5 s before the recorder
  const r: MediaResolver = {
    path: (s) => `D:/${s}.mp4`, key: (s) => s, info: async (s) => vid(`D:/${s}.mp4`, 60), transcript: async () => tr,
    sync: async (_ref, other) => ({ offset: offsets[other], score: 0.5, confidence: 4 }),
  };
  it('takes words and sound from the audio, picture from the angles, and changes angle at every cut', async () => {
    const c = await compilePlan({ name: 'mc', multicam: { show: { audio: 'mic', angles: { wide: 'camA', close: 'camB' } } }, segments: [{ id: 'a', src: 'show', sentences: ['s1', 's2'] }, { id: 'b', src: 'show', sentences: 's3' }] }, r);
    const a1 = c.timeline.clips.filter((x) => x.vTrack === 1);
    expect(a1.map((x) => x.videoMedia)).toEqual(['camA', 'camB', 'camA']);
    expect(a1.every((x) => x.media === 'mic' && !x.motion)).toBe(true);
    expect(a1[1].videoShift).toBe(12.5 * 254016000000);
    expect(c.pieces.slice(1).every((p) => p.camera === 'changes')).toBe(true);
    const xml = writeFcp7(c.timeline).xml;
    const fid = /<file id="([^"]+)">\s*<name>camB\.mp4<\/name>/.exec(xml)![1];
    const item = xml.split('<clipitem').find((b) => b.includes(`<file id="${fid}"`))!;
    expect(Number(/<pproTicksIn>(-?\d+)<\/pproTicksIn>/.exec(item)![1])).toBe(a1[1].inTicks + 12.5 * 254016000000);
  });
  it('honours a segment angle and refuses angles that are not in the group', async () => {
    const c = await compilePlan({ name: 'mc', multicam: { show: { audio: 'mic', angles: { wide: 'camA', close: 'camB' } } }, segments: [{ id: 'a', src: 'show', sentences: 's1', angle: 'close' }] }, r);
    expect(c.timeline.clips.find((x) => x.vTrack === 1)!.videoMedia).toBe('camB');
    await expect(compilePlan({ name: 'x', segments: [{ id: 'a', src: 'mic', sentences: 's1', angle: 'close' }] }, r)).rejects.toThrow(/not a multicam group/);
  });
});
