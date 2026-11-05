// Edit plan → Timeline. Segments resolve to word ranges, tightening splits them into pieces at real gaps between
// words (never inside a word), pieces are laid end to end on V1/A1, and B-roll, music, grades, punch-ins, J/L cuts
// and markers are added around them. Everything is in exact frames on the sequence grid.
import { parseTime, rate as toRate, secondsToFrames, ticksPerFrame, TICKS_PER_SECOND, type Rate } from '@ae-mcp/core/time/timecode.ts';
import type { MediaInfo } from '@ae-mcp/core/media/probe.ts';
import { findQuote } from '@ae-mcp/core/transcribe/match.ts';
import { cachedTranscript } from '@ae-mcp/core/transcribe/index.ts';
import type { Transcript } from '@ae-mcp/core/transcribe/types.ts';
import { REFRAMES } from '@ae-mcp/core/deliver/targets.ts';
import { beatsCached } from '@ae-mcp/core/audio/cached.ts';
import { beatGrid } from '@ae-mcp/core/audio/beats.ts';
import type { Grade, TLClip, TLMarker, Timeline } from '../timeline.ts';
import type { MediaResolver } from './media.ts';
import { parsePlan, type Montage, type Plan, type Segment, type Tighten } from './schema.ts';

/** One continuous piece of a segment after tightening. */
export interface Piece {
  id: string;
  seg: string;
  src: string;
  media: string;
  /** Kept transcript words (inclusive), or null for time-addressed segments without a transcript. */
  words: [number, number] | null;
  /** Source seconds (on the sequence frame grid). */
  inS: number;
  outS: number;
  /** Sequence frames. */
  start: number;
  end: number;
  /** The cut into this piece is a jump cut (same source, discontinuous). */
  jump: boolean;
  /** What tightening removed just before this piece. */
  removedBefore?: { words: [number, number] | null; seconds: number; reason: string };
}

export interface ResolvedTitle { id: string; mogrt: string; start: number; end: number; track: number; fields: Record<string, string | number | boolean> }

export interface Compiled {
  plan: Plan;
  timeline: Timeline;
  pieces: Piece[];
  segments: { id: string; beat?: string; src: string; words: [number, number] | null; start: number; end: number; text: string; match?: { score: number; text: string } }[];
  titles: ResolvedTitle[];
  transcripts: Record<string, Transcript>;
  warnings: string[];
  stats: { sourceSeconds: number; cutSeconds: number; removed: { fillers: number; repeats: number; pauses: number; pauseSeconds: number } };
}

export const DEF: Required<Omit<Tighten, 'cut'>> = { fillers: true, repeats: true, maxPause: 0.6, keepPause: 0.25, handles: 0.06, minPiece: 0.5 };
/** Words that may go when a filler removal leaves them alone at a segment edge ("So, um, the…" → "the…"). */
const DISCOURSE = new Set(['so', 'and', 'well', 'okay', 'ok', 'yeah', 'like', 'um', 'uh', 'erm', 'hmm']);
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9']/g, '');

export async function compilePlan(input: unknown, media: MediaResolver): Promise<Compiled> {
  const plan = parsePlan(input);
  const warnings: string[] = [];

  // ---- sequence settings from the first segment's media unless given ----
  const segments = plan.segments ?? [];
  const firstInfo = await media.info(segments[0]?.src ?? plan.montage!.clips[0]);
  const R: Rate = plan.fps !== undefined ? toRate(plan.fps) : firstInfo.video?.rate ?? toRate(25);
  const fps = R.num / R.den, tpf = ticksPerFrame(R);
  let [W, H] = [firstInfo.video?.width ?? 1920, firstInfo.video?.height ?? 1080];
  if (Array.isArray(plan.size)) [W, H] = plan.size;
  else if (typeof plan.size === 'string') { const r = REFRAMES[plan.size]; [W, H] = [r.width, r.height]; }
  const T = (t: string | number) => parseTime(t, R);
  const fr = (s: number, mode: 'round' | 'floor' | 'ceil' = 'round') => secondsToFrames(s, R, mode);
  const toTicks = (s: number) => Math.round(s * TICKS_PER_SECOND);

  const timeline: Timeline = { name: plan.name, rate: R, width: W, height: H, media: {}, clips: [], markers: [] };
  const transcripts: Record<string, Transcript> = {};
  const addMedia = async (src: string): Promise<{ key: string; info: MediaInfo }> => {
    const key = media.key(src), info = await media.info(src);
    timeline.media[key] = info;
    return { key, info };
  };

  const pieces: Piece[] = [];
  const segs: Compiled['segments'] = [];
  const removed = { fillers: 0, repeats: 0, pauses: 0, pauseSeconds: 0 };
  let cursor = 0, sourceSeconds = 0;
  const usedIds = new Set<string>();

  for (let si = 0; si < segments.length; si++) {
    const seg: Segment = segments[si];
    const id = seg.id ?? `seg${si + 1}`;
    if (usedIds.has(id)) throw new Error(`segment id "${id}" is used twice`);
    usedIds.add(id);
    const { key, info } = await addMedia(seg.src);
    if (!info.video && !info.audio) throw new Error(`${id}: ${info.name} has no picture or sound`);
    const needsWords = seg.words || seg.sentences || seg.quote;
    let tr: Transcript | null = null;
    if (needsWords || seg.tighten !== false) {
      try { tr = await media.transcript(seg.src); transcripts[key] = tr; } catch (e: any) { if (needsWords) throw new Error(`${id}: ${e.message}`); warnings.push(`${id}: no transcript (${e.message}); not tightened`); }
    }
    // ---- resolve the word range ----
    let a = -1, b = -1, match: { score: number; text: string } | undefined;
    if (seg.words) {
      [a, b] = seg.words;
      if (!tr || b >= tr.words.length || a > b) throw new Error(`${id}: words [${a}, ${b}] out of range (transcript has ${tr?.words.length ?? 0} words)`);
    } else if (seg.sentences) {
      const [s0, s1] = typeof seg.sentences === 'string' ? [seg.sentences, seg.sentences] : seg.sentences;
      const x = tr!.sentences.find((s) => s.id === s0), y = tr!.sentences.find((s) => s.id === s1);
      if (!x || !y) throw new Error(`${id}: sentence ${!x ? s0 : s1} not in ${info.name} (it has s1–s${tr!.sentences.length})`);
      [a, b] = [x.from, y.to];
    } else if (seg.quote) {
      const m = findQuote(tr!.words, seg.quote);
      if (!m || m.score < 0.7) throw new Error(`${id}: quote not found in ${info.name}${m ? ` (best ${Math.round(m.score * 100)} %: "${m.text}")` : ''}`);
      if (m.runnerUp && m.runnerUp.score > m.score - 0.05) warnings.push(`${id}: quote is ambiguous: also at words ${m.runnerUp.from}–${m.runnerUp.to} (${Math.round(m.runnerUp.score * 100)} %); using ${m.from}–${m.to}. Use words: [${m.from}, ${m.to}] to be explicit.`);
      if (m.score < 0.9) warnings.push(`${id}: quote matched at ${Math.round(m.score * 100)} %: "${m.text}"`);
      [a, b] = [m.from, m.to];
      match = { score: Math.round(m.score * 100) / 100, text: m.text };
    }
    const segStart = cursor;
    let segPieces: Omit<Piece, 'start' | 'end'>[] = [];
    if (a < 0) {
      // Time-addressed: one piece, optionally tightened by the transcript inside the range.
      const from = seg.from !== undefined ? T(seg.from) : 0, to = seg.to !== undefined ? T(seg.to) : info.duration;
      if (to <= from) throw new Error(`${id}: to (${to}) must be after from (${from})`);
      if (to > info.duration + 0.01) throw new Error(`${id}: to ${to.toFixed(2)} s is past the end of ${info.name} (${info.duration.toFixed(2)} s)`);
      if (tr && seg.tighten !== false) {
        const inside = tr.words.filter((w) => w.start >= from - 0.05 && w.end <= to + 0.05);
        if (inside.length) [a, b] = [inside[0].i, inside[inside.length - 1].i];
      }
      if (a < 0) segPieces = [{ id, seg: id, src: seg.src, media: key, words: null, inS: fr(from) / fps, outS: fr(to) / fps, jump: false }];
    }
    if (a >= 0 && tr) segPieces = tightenSegment(id, seg, key, tr, a, b, { ...DEF, ...(plan.tighten || {}), ...(seg.tighten || {}) }, seg.tighten === false || (plan.tighten === false && !seg.tighten), fps, removed, warnings);
    // Time-addressed segments keep their own in and out (pre- and post-roll) where the edge words survived.
    if (a >= 0 && tr && (seg.from !== undefined || seg.to !== undefined) && segPieces.length) {
      const first = segPieces[0], last = segPieces[segPieces.length - 1];
      if (seg.from !== undefined && first.words?.[0] === a) first.inS = Math.min(first.inS, fr(T(seg.from), 'ceil') / fps);
      if (seg.to !== undefined && last.words?.[1] === b) last.outS = Math.max(last.outS, fr(T(seg.to), 'floor') / fps);
    }
    // ---- lay pieces on the timeline ----
    for (const p of segPieces) {
      const d = Math.round((p.outS - p.inS) * fps);
      if (d <= 0) continue;
      pieces.push({ ...p, start: cursor, end: cursor + d });
      sourceSeconds += p.outS - p.inS;
      cursor += d;
    }
    const segText = a >= 0 && tr ? tr.words.slice(a, b + 1).map((w) => w.text).join(' ') : `${info.name} ${seg.from ?? 0}–${seg.to ?? 'end'}`;
    segs.push({ id, beat: seg.beat, src: seg.src, words: a >= 0 ? [a, b] : null, start: segStart, end: cursor, text: segText, ...(match ? { match } : {}) });
  }
  if (!pieces.length && !plan.montage) throw new Error('the plan produced no pieces (every segment was empty)');

  // ---- A-roll clips ----
  const segOf = new Map(segments.map((s, i) => [s.id ?? `seg${i + 1}`, s]));
  const gradeFor = (seg: Segment): Grade | undefined => {
    const g = { ...(plan.grade?.['*'] ?? {}), ...(plan.grade?.[seg.src] ?? {}), ...(seg.grade ?? {}) };
    return Object.keys(g).length ? g : undefined;
  };
  let punchParity = 0;
  for (let k = 0; k < pieces.length; k++) {
    const p = pieces[k], seg = segOf.get(p.seg)!;
    const prev = pieces[k - 1];
    p.jump = !!prev && prev.media === p.media && Math.abs(prev.outS - p.inS) > 1 / fps;
    // Jump cuts alternate a punch-in so each one reads as a change of framing; a cut to another source resets it.
    punchParity = p.jump ? punchParity ^ 1 : 0;
    const clip: TLClip = { id: p.id, media: p.media, vTrack: 1, aTrack: 1, start: p.start, end: p.end, inTicks: toTicks(p.inS), outTicks: toTicks(p.inS) + (p.end - p.start) * tpf, grade: gradeFor(seg), level: seg.level, channels: seg.channels };
    if (seg.punchIn) clip.motion = { scale: seg.punchIn };
    else if (punchParity && (plan.jumpCuts ?? 'punch-in') === 'punch-in') clip.motion = { scale: 112 };
    // Transition into the first piece of a segment.
    if (prev && prev.seg !== p.seg && seg.transition && seg.transition !== 'cut') clip.transitionIn = { kind: seg.transition, frames: seg.transitionFrames ?? Math.round(fps / 2) };
    timeline.clips.push(clip);
  }
  // ---- J/L cuts at segment boundaries: move the picture cut, keep the sound continuous ----
  const firstSeg = segments[0]?.id ?? 'seg1', lastSeg = segments.at(-1)?.id ?? `seg${segments.length}`;
  if (segments[0]?.j !== undefined) warnings.push(`${firstSeg}: j has no effect on the first segment (nothing before it to overlap)`);
  if (segments.at(-1)?.l !== undefined) warnings.push(`${lastSeg}: l has no effect on the last segment (nothing after it to overlap)`);
  for (let k = 1; k < pieces.length; k++) {
    const p = pieces[k], prev = pieces[k - 1];
    if (p.seg === prev.seg) continue;
    const seg = segOf.get(p.seg)!, prevSeg = segOf.get(prev.seg)!;
    const shift = seg.j !== undefined ? fr(T(seg.j)) : prevSeg.l !== undefined ? -fr(T(prevSeg.l)) : 0;
    if (!shift) continue;
    const A = timeline.clips[k - 1], B = timeline.clips[k];
    const Av = A.video ?? { start: A.start, end: A.end, inTicks: A.inTicks, outTicks: A.outTicks };
    const Bv = B.video ?? { start: B.start, end: B.end, inTicks: B.inTicks, outTicks: B.outTicks };
    // Limits: each picture keeps at least a frame, and the picture can't run before its media start or past its end.
    const mA = timeline.media[A.media], mB = timeline.media[B.media];
    const maxJ = Math.min(Bv.end - Bv.start - 1, Math.floor((mA.duration * TICKS_PER_SECOND - Av.outTicks) / tpf));
    const maxL = Math.min(Av.end - Av.start - 1, Math.floor(Bv.inTicks / tpf));
    const s = Math.max(-maxL, Math.min(maxJ, shift));
    if (s !== shift) warnings.push(`${p.seg}: J/L cut limited to ${s} frames (${s > 0 ? 'picture left after the previous segment' : 'picture before this segment'} and clip lengths)`);
    if (!s) continue;
    // J (s > 0): previous picture holds s frames longer, this picture starts s later. L (s < 0): the reverse.
    // Each side keeps a split edit already made at its other boundary.
    A.video = { ...Av, end: Av.end + s, outTicks: Av.outTicks + s * tpf };
    B.video = { ...Bv, start: Bv.start + s, inTicks: Bv.inTicks + s * tpf };
    void mB;
  }
  // ---- markers ----
  if (plan.markers !== false) for (const s of segs) timeline.markers.push({ frame: s.start, name: s.id, comment: [s.beat, `"${s.text.slice(0, 80)}${s.text.length > 80 ? '…' : ''}"`].filter(Boolean).join(' · ') } as TLMarker);

  // ---- montage: picture cut to the music's beats or bars ----
  if (plan.montage) cursor = await montage(plan.montage, { timeline, addMedia, media, fr, fps, tpf, toTicks, T, segs, warnings });

  // ---- B-roll ----
  const dialogueEnd = cursor;
  const occupied = new Map<number, [number, number][]>();
  // Nat sound from B-roll takes the first free stereo pair from A3 up, skipping the music's pair (A5 unless set).
  const musicPairs = new Set((plan.music ?? []).map((m) => m.track ?? 5));
  const audioUsed = new Map<number, [number, number][]>();
  const audioPair = (span: [number, number]) => {
    for (let t = 3; t < 31; t += 2) {
      if (musicPairs.has(t)) continue;
      if ((audioUsed.get(t) ?? []).some(([x, y]) => span[0] < y && span[1] > x)) continue;
      audioUsed.set(t, [...(audioUsed.get(t) ?? []), span]);
      return t;
    }
    throw new Error('more than 13 overlapping B-roll clips with sound');
  };
  let bi = 0;
  for (const b of plan.broll ?? []) {
    const bid = b.id ?? `b${++bi}`;
    const { key, info } = await addMedia(b.src);
    if (!info.video) throw new Error(`${bid}: ${info.name} has no picture`);
    let span: [number, number];
    if (b.over !== undefined) {
      const ref = Array.isArray(b.over) ? b.over : [b.over, b.over];
      const jumpRef = /^(.+)\/(\d+)$/.exec(ref[0]);
      if (jumpRef) {
        const target = pieces.find((p) => p.id === `${jumpRef[1]}.${jumpRef[2]}`) ?? pieces.filter((p) => p.seg === jumpRef[1])[+jumpRef[2] - 1];
        if (!target) throw new Error(`${bid}: no cut "${ref[0]}" (pieces of ${jumpRef[1]}: ${pieces.filter((p) => p.seg === jumpRef[1]).map((p) => p.id).join(', ') || 'none'})`);
        const d = fr(b.duration !== undefined ? T(b.duration) : 2.5);
        const s0 = Math.max(0, target.start - Math.round(d * 0.4));
        span = [s0, Math.min(dialogueEnd, s0 + d)];
      } else {
        const s0 = segs.find((s) => s.id === ref[0]), s1 = segs.find((s) => s.id === ref[1]);
        if (!s0 || !s1) throw new Error(`${bid}: no segment "${!s0 ? ref[0] : ref[1]}" (have ${segs.map((s) => s.id).join(', ')})`);
        span = [s0.start, s1.end];
        if (b.offset !== undefined) span[0] = Math.min(span[1] - 1, span[0] + fr(T(b.offset)));
        if (b.duration !== undefined) span[1] = Math.min(span[1], span[0] + fr(T(b.duration)));
      }
    } else if (b.at !== undefined) {
      const s0 = fr(T(b.at));
      span = [s0, s0 + fr(b.duration !== undefined ? T(b.duration) : 3)];
    } else throw new Error(`${bid}: say where it goes with over (segment or "seg/2" jump cut) or at (sequence time)`);
    const len = span[1] - span[0];
    if (len < fr(0.5)) throw new Error(`${bid}: only ${(len / fps).toFixed(2)} s long; B-roll under 0.5 s reads as a flash frame`);
    const need = len / fps;
    const still = info.kind === 'image';
    if (!still && info.duration < need - 1 / fps) { warnings.push(`${bid}: ${info.name} is ${info.duration.toFixed(1)} s, shorter than the ${need.toFixed(1)} s span; shortened`); span[1] = span[0] + Math.floor(info.duration * fps) - 1; }
    const inS = still ? 0 : b.in !== undefined ? T(b.in) : Math.max(0, (info.duration - need) / 2);
    if (!still && inS + (span[1] - span[0]) / fps > info.duration + 1e-6) throw new Error(`${bid}: in ${inS.toFixed(2)} s + ${((span[1] - span[0]) / fps).toFixed(2)} s runs past the end of ${info.name}`);
    let track = b.track ?? 2;
    while ((occupied.get(track) ?? []).some(([x, y]) => span[0] < y && span[1] > x)) track++;
    occupied.set(track, [...(occupied.get(track) ?? []), span]);
    const inTicks = toTicks(fr(inS, 'floor') / fps);
    timeline.clips.push({
      id: bid, media: key, vTrack: track, ...(b.audio !== undefined && info.audio ? { aTrack: audioPair(span), level: b.audio } : {}),
      start: span[0], end: span[1], inTicks, outTicks: inTicks + (span[1] - span[0]) * tpf,
      grade: b.grade ?? plan.grade?.[b.src], motion: b.scale ? { scale: b.scale } : undefined,
      transitionIn: b.transition === 'dissolve' ? { kind: 'dissolve', frames: Math.round(fps / 3) } : undefined, label: 'Mango',
    });
  }

  // ---- music ----
  let mi = 0;
  for (const m of plan.music ?? []) {
    const mid = m.id ?? `m${++mi}`;
    const { key, info } = await addMedia(m.src);
    if (!info.audio) throw new Error(`${mid}: ${info.name} has no audio`);
    const start = m.at !== undefined ? fr(T(m.at)) : 0;
    const end = m.until !== undefined ? fr(T(m.until)) : dialogueEnd + fr(1.5);
    const len = end - start, need = len / fps;
    let ending = m.ending ?? 'backtime';
    let inS = m.in !== undefined ? T(m.in) : 0;
    if (m.in === undefined && ending === 'backtime') {
      if (info.duration >= need) inS = info.duration - need;
      else { ending = 'fade'; warnings.push(`${mid}: ${info.name} (${info.duration.toFixed(1)} s) is shorter than the cut (${need.toFixed(1)} s): it starts at 0 and fades; pick a longer track or loop it by hand`); }
    }
    const playable = Math.min(len, Math.floor((info.duration - inS) * fps));
    const level = m.level ?? -20, open = m.open ?? -12;
    const keys: { frame: number; db: number }[] = [];
    const mEnd = start + playable;
    if (m.duck !== false) keys.push(...duckKeys(speechSpans(pieces, transcripts, timeline, fps), start, mEnd, level, open, fps));
    const fadeIn = m.fadeIn !== undefined ? fr(T(m.fadeIn)) : inS > 0.05 && ending !== 'backtime' ? fr(0.5) : 0;
    const fadeOut = m.fadeOut !== undefined ? fr(T(m.fadeOut)) : ending === 'fade' ? fr(2) : 0;
    if (fadeIn || fadeOut) {
      // Fades are an envelope on top of the ducking curve (sampled at every duck key and along each fade), so a fade
      // never overwrites a duck key and a long fade-out never opens the bed under the last words.
      if (!keys.length) keys.push({ frame: start, db: level }, { frame: mEnd, db: level });
      const duck = (f: number) => {
        const ks = [...keys].sort((x, y) => x.frame - y.frame);
        if (f <= ks[0].frame) return ks[0].db;
        for (let i = 1; i < ks.length; i++) if (f <= ks[i].frame) { const a = ks[i - 1], b = ks[i]; return a.db + ((b.db - a.db) * (f - a.frame)) / Math.max(1, b.frame - a.frame); }
        return ks[ks.length - 1].db;
      };
      const gain = (f: number) => {
        let g = 1;
        if (fadeIn && f < start + fadeIn) g *= Math.max(0, (f - start) / fadeIn);
        if (fadeOut && f > mEnd - fadeOut) g *= Math.max(0, (mEnd - f) / fadeOut);
        return g;
      };
      const frames = new Set<number>(keys.map((k) => k.frame));
      for (const [a, b] of [[start, start + fadeIn], [mEnd - fadeOut, mEnd]] as [number, number][]) if (b > a) for (let i = 0; i <= 6; i++) frames.add(Math.round(a + ((b - a) * i) / 6));
      const env = [...frames].filter((f) => f >= start && f <= mEnd).sort((x, y) => x - y).map((f) => ({ frame: f, db: Math.max(-60, duck(f) + 20 * Math.log10(Math.max(gain(f), 0.001))) }));
      keys.length = 0;
      keys.push(...env);
    }
    keys.sort((x, y) => x.frame - y.frame);
    const inTicks = toTicks(inS);
    timeline.clips.push({ id: mid, media: key, aTrack: m.track ?? 5, start, end: mEnd, inTicks, outTicks: inTicks + playable * tpf, level: keys.length ? undefined : level, levelKeys: keys.length ? dedupeKeys(keys) : undefined, label: 'Forest' });
  }

  // ---- B-roll snapped to the music's beats or bars ----
  const music0 = timeline.clips.find((c) => /^m\d/.test(c.id));
  const snapping = (plan.broll ?? []).some((b) => b.snap);
  if (snapping && !music0) warnings.push('broll snap: the plan has no music to snap to');
  if (snapping && music0) {
    const ba = await beatsCached(timeline.media[music0.media].path);
    const inS = music0.inTicks / TICKS_PER_SECOND, s0 = music0.start / fps;
    const toSeq = (t: number) => s0 + (t - inS);
    let k = 0;
    for (const b of plan.broll ?? []) {
      const clip = timeline.clips.find((c) => c.id === (b.id ?? `b${++k}`)) ?? timeline.clips.filter((c) => /^b\d/.test(c.id))[k - 1];
      if (!b.snap || !clip) continue;
      const grid = (b.snap === 'bar' ? ba.downbeats : ba.beats).map(toSeq);
      const near = (t: number) => grid.reduce((best, g) => (Math.abs(g - t) < Math.abs(best - t) ? g : best), grid[0] ?? t);
      const a = fr(near(clip.start / fps)), e = fr(near(clip.end / fps));
      if (e - a >= fr(0.5)) { const shift = a - clip.start; clip.inTicks += 0; clip.start = a; clip.end = e; clip.outTicks = clip.inTicks + (e - a) * tpf; void shift; }
    }
  }

  // ---- titles (placed live after the import: mogrts cannot travel in XML) ----
  const titles: ResolvedTitle[] = [];
  let ti = 0;
  for (const t of plan.titles ?? []) {
    const tid = t.id ?? `t${++ti}`;
    let start = 0;
    if (t.at === undefined) start = 0;
    else if (typeof t.at === 'object') {
      const s = segs.find((x) => x.id === (t.at as any).seg);
      if (!s) throw new Error(`${tid}: no segment "${(t.at as any).seg}"`);
      start = s.start + ((t.at as any).offset !== undefined ? fr(T((t.at as any).offset)) : 0);
    } else start = fr(T(t.at));
    const dur = t.duration !== undefined ? fr(T(t.duration)) : fr(4);
    titles.push({ id: tid, mogrt: media.path(t.mogrt), start, end: start + dur, track: t.track ?? Math.max(3, ...[...occupied.keys()].map((k) => k + 1)), fields: t.fields ?? {} });
  }
  if (titles.length) timeline.minVideoTracks = Math.max(...titles.map((t) => t.track));

  return {
    plan, timeline, pieces, segments: segs, titles, transcripts, warnings,
    stats: { sourceSeconds: Math.round(sourceSeconds * 100) / 100, cutSeconds: Math.round((dialogueEnd / fps) * 100) / 100, removed: { ...removed, pauseSeconds: Math.round(removed.pauseSeconds * 100) / 100 } },
  };
}

function dedupeKeys(keys: { frame: number; db: number }[]) {
  const out: { frame: number; db: number }[] = [];
  for (const k of keys) { const last = out.at(-1); if (last && last.frame === k.frame) last.db = k.db; else out.push({ ...k }); }
  return out;
}

/**
 * Split a segment's words into pieces: drop fillers/repeats/chosen words, shorten long pauses, and put every cut
 * in the gap between words (frame-quantized, never past the neighbouring word). Short leftovers merge back.
 */
export function tightenSegment(id: string, seg: Pick<Segment, 'src'>, mediaKey: string, tr: Transcript, a: number, b: number, opt: typeof DEF & { cut?: Tighten['cut'] }, off: boolean, fps: number, removed: Compiled['stats']['removed'], warnings: string[]): Omit<Piece, 'start' | 'end'>[] {
  const W = tr.words;
  const keep: boolean[] = [];
  const why: (string | null)[] = [];
  for (let i = a; i <= b; i++) {
    let k = true, r: string | null = null;
    if (!off) {
      if (opt.fillers && W[i].filler === 'filler') { k = false; r = 'filler'; }
      if (opt.repeats && W[i].filler === 'repeat') { k = false; r = 'repeat'; }
    }
    keep[i] = k; why[i] = r;
  }
  // A repeat is a false start only when its second copy is in the segment too: otherwise the plan keeps those words.
  for (let i = a; i <= b; i++) {
    if (why[i] !== 'repeat') continue;
    let j = i;
    while (j + 1 <= b && why[j + 1] === 'repeat') j++;
    const n = j - i + 1;
    if (j + n > b) for (let x = i; x <= j; x++) { keep[x] = true; why[x] = null; }
    i = j;
  }
  for (const c of opt.cut ?? []) {
    const [x, y] = Array.isArray(c) ? c : [c, c];
    for (let i = Math.max(a, x); i <= Math.min(b, y); i++) { keep[i] = false; why[i] = 'cut'; }
  }
  const maxPause = parseTime(opt.maxPause), keepPause = parseTime(opt.keepPause), handle = parseTime(opt.handles), minPiece = parseTime(opt.minPiece);
  // Runs of kept words, split at removed words (explicit cuts marked: they never merge back) and at long pauses.
  type Run = { from: number; to: number; splitBefore: 'start' | 'removed' | 'cut' | 'pause' };
  let runs: Run[] = [];
  for (let i = a; i <= b; i++) {
    if (!keep[i]) continue;
    const last = runs.at(-1);
    const prevKept = last ? last.to : -1;
    if (last && prevKept === i - 1 && (off || W[i].start - W[i - 1].end <= maxPause)) last.to = i;
    else {
      const gapWhy = last && prevKept !== i - 1 ? why.slice(prevKept + 1, i) : [];
      runs.push({ from: i, to: i, splitBefore: !last ? 'start' : prevKept === i - 1 ? 'pause' : gapWhy.includes('cut') ? 'cut' : 'removed' });
    }
  }
  if (!runs.length) { warnings.push(`${id}: every word was removed by tightening; kept the segment as is`); runs = [{ from: a, to: b, splitBefore: 'start' }]; }
  // Edge leftovers made only of discourse words, cut off by a filler removal ("So," before a removed "um"), go
  // (reported); other short runs merge back with a neighbour, but never across an explicit cut.
  const dur = (r: Run) => W[r.to].end - W[r.from].start;
  const isDiscourse = (r: Run) => W.slice(r.from, r.to + 1).every((w) => DISCOURSE.has(norm(w.text)));
  const dropped: string[] = [];
  if (runs.length > 1 && runs[1].splitBefore === 'removed' && dur(runs[0]) < minPiece && isDiscourse(runs[0])) { dropped.push(W.slice(runs[0].from, runs[0].to + 1).map((w) => w.text).join(' ')); runs.shift(); runs[0].splitBefore = 'start'; }
  if (runs.length > 1 && runs.at(-1)!.splitBefore === 'removed' && dur(runs.at(-1)!) < minPiece && isDiscourse(runs.at(-1)!)) { dropped.push(W.slice(runs.at(-1)!.from, runs.at(-1)!.to + 1).map((w) => w.text).join(' ')); runs.pop(); }
  if (dropped.length) warnings.push(`${id}: also dropped ${dropped.map((d) => `"${d}"`).join(' and ')} (left alone at the segment edge by a filler cut; keep it with tighten.fillers false or words)`);
  for (let k = 0; k < runs.length; k++) {
    if (runs.length < 2 || dur(runs[k]) >= minPiece) continue;
    const canPrev = k > 0 && runs[k].splitBefore !== 'cut';
    const canNext = k + 1 < runs.length && runs[k + 1].splitBefore !== 'cut';
    if (!canPrev && !canNext) continue; // between explicit cuts: the agent asked for exactly this
    const j = !canPrev ? k + 1 : !canNext ? k - 1 : (W[runs[k].from].start - W[runs[k - 1].to].end) < (W[runs[k + 1].from].start - W[runs[k].to].end) ? k - 1 : k + 1;
    const [x, y] = j < k ? [j, k] : [k, j];
    runs[x] = { from: runs[x].from, to: runs[y].to, splitBefore: runs[x].splitBefore };
    runs.splice(y, 1);
    k = -1;
  }
  // What was removed: every word of the range outside the final runs (edge leftovers included).
  for (let i = a; i <= b; i++) {
    if (runs.some((r) => i >= r.from && i <= r.to)) continue;
    if (why[i] === 'filler' || !why[i]) removed.fillers++; else if (why[i] === 'repeat') removed.repeats++;
  }
  // Cut points.
  const fq = (s: number, mode: 'floor' | 'ceil' | 'round') => (mode === 'floor' ? Math.floor(s * fps + 1e-6) : mode === 'ceil' ? Math.ceil(s * fps - 1e-6) : Math.round(s * fps)) / fps;
  const pieces: Omit<Piece, 'start' | 'end'>[] = [];
  runs.forEach((r, k) => {
    const prevEnd = r.from > 0 ? W[r.from - 1].end : 0;
    const nextStart = r.to + 1 < W.length ? W[r.to + 1].start : tr.duration;
    const gapBefore = Math.max(0, W[r.from].start - prevEnd), gapAfter = Math.max(0, nextStart - W[r.to].end);
    const lead = r.splitBefore === 'pause' ? Math.min(keepPause / 2, gapBefore / 2) : Math.min(k === 0 ? Math.max(handle, 0.12) : handle, gapBefore / 2);
    const nextSplit = runs[k + 1]?.splitBefore;
    const tail = nextSplit === 'pause' ? Math.min(keepPause / 2, gapAfter / 2) : Math.min(k === runs.length - 1 ? Math.max(handle, 0.2) : handle, gapAfter / 2);
    // Quantize to frames inside the gap. A kept word is never clipped: the in point is at or before its first frame
    // and the out point at or after its last, even when the gap to the neighbour is under a frame (then a sliver of
    // the neighbour is the lesser evil).
    const firstFrame = fq(W[r.from].start, 'floor'), lastFrame = fq(W[r.to].end, 'ceil');
    let inS = Math.min(fq(W[r.from].start - lead, 'round'), firstFrame);
    if (inS < prevEnd - 1e-6) inS = Math.min(fq(prevEnd, 'ceil'), firstFrame);
    let outS = Math.max(fq(W[r.to].end + tail, 'round'), lastFrame);
    if (outS > nextStart + 1e-6) outS = Math.max(fq(nextStart, 'floor'), lastFrame);
    if (outS <= inS) outS = inS + 1 / fps;
    const prevRun = runs[k - 1];
    let removedBefore: Piece['removedBefore'];
    if (prevRun) {
      const rw: [number, number] | null = prevRun.to + 1 <= r.from - 1 ? [prevRun.to + 1, r.from - 1] : null;
      const secs = W[r.from].start - W[prevRun.to].end;
      const reasons = rw ? [...new Set(why.slice(rw[0], rw[1] + 1).filter(Boolean))] : [];
      removedBefore = { words: rw, seconds: Math.round(secs * 100) / 100, reason: rw ? reasons.join('+') || 'cut' : 'pause' };
      if (!rw) { removed.pauses++; removed.pauseSeconds += secs - keepPause; }
    }
    pieces.push({ id: runs.length > 1 ? `${id}.${k + 1}` : id, seg: id, src: seg.src, media: mediaKey, words: [r.from, r.to], inS, outS, jump: false, ...(removedBefore ? { removedBefore } : {}) });
  });
  return pieces;
}

/**
 * A montage: picture sources cut every N beats (or every bar) of a music track. The montage ends on the track's
 * own ending and starts on the downbeat that gives the asked length; cuts land on the nearest frame to each beat.
 */
async function montage(m: Montage, x: { timeline: Timeline; addMedia: (src: string) => Promise<{ key: string; info: MediaInfo }>; media: MediaResolver; fr: (s: number, mode?: 'round' | 'floor' | 'ceil') => number; fps: number; tpf: number; toTicks: (s: number) => number; T: (t: string | number) => number; segs: Compiled['segments']; warnings: string[] }): Promise<number> {
  const mus = await x.addMedia(m.music);
  if (!mus.info.audio) throw new Error(`montage: ${mus.info.name} has no audio`);
  const ba = await beatsCached(mus.info.path);
  if (ba.beats.length < 8 || ba.confidence < 0.15) x.warnings.push(`montage: ${mus.info.name} has no clear beat (confidence ${ba.confidence.toFixed(2)}); cuts follow the detected grid anyway`);
  const grid = beatGrid(ba);
  const per = m.cut === 'beat' ? 1 : m.cut === undefined || m.cut === 'bar' ? ba.beatsPerBar : m.cut;
  const want = m.length !== undefined ? x.T(m.length) : 30;
  const end = mus.info.duration;
  const downs = ba.downbeats.length ? ba.downbeats : ba.beats;
  const start = downs.reduce((best, d) => (Math.abs(end - d - want) < Math.abs(end - best - want) ? d : best), downs[0] ?? 0);
  if (end - start < want - 2) x.warnings.push(`montage: ${mus.info.name} gives only ${(end - start).toFixed(1)} s from its first downbeat`);
  const k0 = Math.round(grid.indexAt(start));
  const cuts: number[] = [];
  for (let k = k0; grid.beat(k) < end - 0.5; k += per) cuts.push(grid.beat(k));
  const len = x.fr(end - start);
  // Picture: cycle the sources, each shot taking the next stretch of its source.
  const infos = await Promise.all(m.clips.map((c) => x.addMedia(c)));
  const used = new Map<string, number>();
  for (let j = 0; j < cuts.length; j++) {
    const a = x.fr(cuts[j] - start), b = j + 1 < cuts.length ? x.fr(cuts[j + 1] - start) : len;
    if (b - a < 2) continue;
    const src = infos[j % infos.length];
    if (!src.info.video) throw new Error(`montage: ${src.info.name} has no picture`);
    const shot = (b - a) / x.fps;
    const avail = src.info.duration;
    let off = used.get(src.key) ?? Math.max(0, (avail - shot * Math.ceil(cuts.length / infos.length)) / 2);
    if (off + shot > avail) off = 0;
    used.set(src.key, off + shot);
    const inTicks = x.toTicks(Math.floor(off * x.fps) / x.fps);
    x.timeline.clips.push({ id: `mt${j + 1}`, media: src.key, vTrack: 1, start: a, end: b, inTicks, outTicks: inTicks + (b - a) * x.tpf });
  }
  const inTicks = x.toTicks(start);
  x.timeline.clips.push({ id: 'm1', media: mus.key, aTrack: 1, start: 0, end: len, inTicks, outTicks: inTicks + len * x.tpf, level: m.level ?? 0, label: 'Forest' });
  x.segs.push({ id: 'montage', src: m.music, words: null, start: 0, end: len, text: `${cuts.length} shots cut every ${per} beat${per === 1 ? '' : 's'} of ${mus.info.name} (${ba.bpm.toFixed(1)} BPM), ${start.toFixed(2)}–${end.toFixed(2)} s` });
  return len;
}

/**
 * Where words are spoken in the cut (sequence frames), merged across gaps under 1.5 s: what music ducks under.
 * Pieces without a transcript count as speech throughout.
 */
export function speechSpans(pieces: Pick<Piece, 'media' | 'words' | 'inS' | 'outS' | 'start' | 'end'>[], transcripts: Record<string, Transcript>, timeline: Pick<Timeline, 'media'>, fps: number): [number, number][] {
  const raw: [number, number][] = [];
  for (const p of pieces) {
    const tr = transcripts[p.media] ?? (timeline.media[p.media]?.path ? cachedTranscript(timeline.media[p.media].path) : null);
    if (!tr) { raw.push([p.start, p.end]); continue; }
    const inside = p.words ? tr.words.slice(p.words[0], p.words[1] + 1) : tr.words.filter((w) => w.start >= p.inS - 0.02 && w.end <= p.outS + 0.02);
    for (const w of inside) raw.push([Math.max(p.start, p.start + Math.floor((w.start - p.inS) * fps)), Math.min(p.end, p.start + Math.ceil((w.end - p.inS) * fps))]);
  }
  raw.sort((x, y) => x[0] - y[0]);
  const spans: [number, number][] = [];
  const gap = Math.round(1.5 * fps);
  for (const s of raw) { const last = spans.at(-1); if (last && s[0] - last[1] < gap) last[1] = Math.max(last[1], s[1]); else spans.push([...s]); }
  return spans;
}

/** Level keys for a music clip [start, end): `level` dB under speech, `open` dB in gaps of 1.5 s or more, 0.35 s ramps. */
export function duckKeys(spans: [number, number][], start: number, end: number, level: number, open: number, fps: number): { frame: number; db: number }[] {
  const keys: { frame: number; db: number }[] = [];
  const ramp = Math.round(0.35 * fps), gap = Math.round(1.5 * fps);
  let lvl = spans.length && spans[0][0] - start < gap ? level : open;
  keys.push({ frame: start, db: lvl });
  for (const [s, e] of spans) {
    if (e < start || s > end) continue;
    if (lvl !== level) { keys.push({ frame: Math.max(start, s - ramp), db: open }, { frame: Math.max(start, s), db: level }); lvl = level; }
    if (end - e >= gap) { keys.push({ frame: e, db: level }, { frame: Math.min(end, e + ramp), db: open }); lvl = open; }
  }
  return keys;
}
