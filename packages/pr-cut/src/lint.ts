// Edit lint: what an editor would flag in a cut, judged on the compiled timeline before and after it lands in
// Premiere. Same report format as ae-compose (core lint/report.ts): errors, warnings, notes, each with a time range.
import type { ReportIssue } from '@ae-mcp/core/lint/report.ts';
import type { Compiled } from './plan/compile.ts';
import { motionScale } from './timeline.ts';

export type EditRule =
  | 'flash-frame' | 'mid-word' | 'offline' | 'gap'
  | 'jump-cut' | 'mixed-rate' | 'vfr' | 'music-loud' | 'title-short' | 'audio-pop'
  | 'talking-head' | 'broll-reuse' | 'monotone' | 'long-pause' | 'slow-hook' | 'lip-sync';

export type EditIssue = ReportIssue<EditRule>;

export interface EditLintOptions { ignore?: EditRule[]; flashFrames?: number; talkingHead?: number; hook?: number }

export function lintCut(c: Compiled, o: EditLintOptions = {}): EditIssue[] {
  const t = c.timeline, fps = t.rate.num / t.rate.den;
  const issues: EditIssue[] = [];
  const sec = (f: number) => Math.round((f / fps) * 100) / 100;
  const add = (i: EditIssue) => { if (!o.ignore?.includes(i.rule)) issues.push(i); };
  const flash = o.flashFrames ?? Math.round(fps / 4);

  for (const cl of t.clips) {
    const len = (cl.video ?? cl).end - (cl.video ?? cl).start;
    if (cl.vTrack && len < flash) add({ rule: 'flash-frame', severity: 'error', message: `${cl.id} is ${len} frames on screen (${sec(len)} s): a flash frame`, t: [sec(cl.start), sec(cl.end)] });
  }
  // A cut must never clip a kept word: the in point at or before the piece's first word, the out point at or after
  // its last (1 ms tolerance). A sliver of a removed neighbour is inaudible; a clipped onset is not.
  for (const p of c.pieces) {
    if (!p.words) continue;
    const tr = c.transcripts[p.media];
    if (!tr) continue;
    const first = tr.words[p.words[0]], last = tr.words[p.words[1]];
    if (p.inS > first.start + 0.001) add({ rule: 'mid-word', severity: 'error', message: `${p.id} starts ${Math.round((p.inS - first.start) * 1000)} ms into "${first.text}" (source ${p.inS.toFixed(3)} s, word starts ${first.start.toFixed(3)} s)`, t: [sec(p.start), sec(p.start)] });
    if (p.outS < last.end - 0.001) add({ rule: 'mid-word', severity: 'error', message: `${p.id} ends ${Math.round((last.end - p.outS) * 1000)} ms before the end of "${last.text}" (source ${p.outS.toFixed(3)} s)`, t: [sec(p.end), sec(p.end)] });
  }
  // Jump cuts: same source, discontinuous, with the same framing and no B-roll over the cut.
  const broll = t.clips.filter((x) => (x.vTrack ?? 0) >= 2);
  const scaleOf = (id: string) => { const c = t.clips.find((x) => x.id === id); return c ? motionScale(c) : 100; };
  for (let k = 1; k < c.pieces.length; k++) {
    const p = c.pieces[k], prev = c.pieces[k - 1];
    if (!p.jump) continue;
    const covered = broll.some((b) => b.start <= p.start - 2 && b.end >= p.start + 2);
    const reframed = Math.abs(scaleOf(p.id) - scaleOf(prev.id)) >= 8;
    if (!covered && !reframed) add({ rule: 'jump-cut', severity: 'warn', message: `jump cut into ${p.id} on the same framing (${p.removedBefore?.reason ?? 'discontinuous'}): cover it with B-roll (over: "${p.seg}/${p.id.split('.')[1] ?? 1}") or a punch-in`, t: [sec(p.start), sec(p.start)] });
  }
  // J/L cuts between two pieces of the same camera show the speaker's lips out of sync with what we hear.
  for (let k = 1; k < c.pieces.length; k++) {
    const p = c.pieces[k], prev = c.pieces[k - 1];
    const A = t.clips.find((x) => x.id === prev.id), B = t.clips.find((x) => x.id === p.id);
    const moved = (A?.video && A.video.end !== A.end) || (B?.video && B.video.start !== B.start);
    if (!moved || p.media !== prev.media) continue;
    const covered = broll.some((b) => b.start <= Math.min(p.start, B?.video?.start ?? p.start) && b.end >= Math.max(p.start, B?.video?.start ?? p.start));
    if (!covered) add({ rule: 'lip-sync', severity: 'warn', message: `J/L cut into ${p.id} on the same camera: the picture shows ${prev.id}'s speaker while ${p.id}'s words play; use it over B-roll or a second angle`, t: [sec(p.start), sec(p.start)] });
  }
  // Media checks.
  for (const [key, m] of Object.entries(t.media)) {
    if (m.video && m.kind === 'video') {
      if (Math.abs(m.video.fps - fps) > 0.01) add({ rule: 'mixed-rate', severity: 'warn', message: `${m.name} is ${m.video.fps.toFixed(3)} fps in a ${fps.toFixed(3)} fps sequence: Premiere will drop or repeat frames (decide: conform with Interpret Footage, or keep for slow motion)` });
      if (m.video.vfr) add({ rule: 'vfr', severity: 'warn', message: `${m.name} has a variable frame rate (phone/screen recording): sound can drift; transcode to constant frame rate for long clips` });
    }
    void key;
  }
  // Music under dialogue.
  for (const cl of t.clips.filter((x) => /^m/.test(x.id) && !x.vTrack)) {
    const under = cl.levelKeys?.length ? Math.max(...cl.levelKeys.filter((k) => c.pieces.some((p) => k.frame > p.start && k.frame < p.end)).map((k) => k.db), -99) : cl.level ?? 0;
    if (under > -14) add({ rule: 'music-loud', severity: 'warn', message: `${cl.id} sits at ${under} dB under dialogue: music usually sits 18–24 dB below speech`, t: [sec(cl.start), sec(cl.end)] });
  }
  // Titles long enough to read: half a second to notice plus 3.5 words a second.
  for (const ti of c.titles) {
    const words = Object.values(ti.fields).filter((v) => typeof v === 'string').join(' ').split(/\s+/).filter(Boolean).length;
    const need = 0.5 + words / 3.5;
    if ((ti.end - ti.start) / fps < need) add({ rule: 'title-short', severity: 'warn', message: `${ti.id} is on screen ${sec(ti.end - ti.start)} s; ${words} words need about ${need.toFixed(1)} s`, t: [sec(ti.start), sec(ti.end)] });
  }
  // Style: long talking-head stretches without a cutaway, reused B-roll, monotone shot lengths, a slow hook.
  const th = (o.talkingHead ?? 20) * fps;
  let runStart = 0;
  const cutsVisible = [...c.pieces.map((p) => p.start), ...broll.flatMap((b) => [b.start, b.end])].sort((a, b) => a - b);
  for (const f of c.pieces.length ? [...cutsVisible, c.pieces.at(-1)!.end] : []) {
    const len = f - runStart;
    if (len > th && !broll.some((b) => b.start < f && b.end > runStart)) add({ rule: 'talking-head', severity: 'info', message: `${sec(len)} s of uninterrupted talking head: consider B-roll or a cutaway`, t: [sec(runStart), sec(f)] });
    runStart = f;
  }
  const seen = new Map<string, string>();
  for (const b of broll) {
    const k = `${b.media}@${Math.round(b.inTicks / 1e9)}`;
    if (seen.has(k)) add({ rule: 'broll-reuse', severity: 'info', message: `${b.id} reuses the same shot as ${seen.get(k)}`, t: [sec(b.start), sec(b.end)] });
    else seen.set(k, b.id);
  }
  const shots = cutsVisible.map((f, i, a) => (i ? f - a[i - 1] : f)).filter((d) => d > 0).map((d) => d / fps);
  if (shots.length >= 8) {
    const mean = shots.reduce((s, x) => s + x, 0) / shots.length;
    const sd = Math.sqrt(shots.reduce((s, x) => s + (x - mean) ** 2, 0) / shots.length);
    if (sd / mean < 0.25) add({ rule: 'monotone', severity: 'info', message: `shot lengths are all about ${mean.toFixed(1)} s (variation ${Math.round((sd / mean) * 100)} %): vary the rhythm` });
  }
  const hook = o.hook;
  if (hook && c.segments[0] && (c.segments[0].end - c.segments[0].start) / fps > hook) add({ rule: 'slow-hook', severity: 'warn', message: `the first segment runs ${sec(c.segments[0].end - c.segments[0].start)} s; social cuts should land the hook within ${hook} s` });
  // Pauses still inside pieces (segments with tightening off, or keepPause set high).
  for (const p of c.pieces) {
    if (!p.words) continue;
    const tr = c.transcripts[p.media];
    for (let i = p.words[0]; i < p.words[1]; i++) {
      const g = tr.words[i + 1].start - tr.words[i].end;
      if (g > 1.2) add({ rule: 'long-pause', severity: 'info', message: `${g.toFixed(1)} s pause inside ${p.id} after "${tr.words[i].text}"`, t: [sec(p.start + (tr.words[i].end - p.inS) * fps), sec(p.start + (tr.words[i + 1].start - p.inS) * fps)] });
    }
  }
  return issues;
}
