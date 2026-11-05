// apply_cut_edits: edit any sequence as a new version. The sequence is adopted from Premiere's own XML (adopt.ts),
// the dialogue spine (V1 clips) is edited by words or time with ripple, everything else (B-roll, graphics, music)
// stays anchored to the source moment it sat on, and the result is imported as "Name v00N" in one undo step.
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { parseTime, ticksPerFrame, TICKS_PER_SECOND, framesToTimecode } from '@ae-mcp/core/time/timecode.ts';
import { cachedTranscript, transcribe } from '@ae-mcp/core/transcribe/index.ts';
import { findQuote } from '@ae-mcp/core/transcribe/match.ts';
import type { Transcript } from '@ae-mcp/core/transcribe/types.ts';
import { probe } from '@ae-mcp/core/media/probe.ts';
import { libraryPath } from '@ae-mcp/core/library/db.ts';
import { formatIssues, summarizeIssues } from '@ae-mcp/core/lint/report.ts';
import { adoptSequence } from './adopt.ts';
import { addCaptions, CUTS_DIR, placeTitles, type BuildReport } from './build.ts';
import { cutStrips, sequenceContactSheet } from './frames.ts';
import { importTimeline } from './importxml.ts';
import { lintCut } from './lint.ts';
import { DEF, duckKeys, speechSpans, tightenSegment, type Compiled, type Piece } from './plan/compile.ts';
import { projectInfo } from './project.ts';
import { motionScale, type Grade, type TLClip, type Timeline } from './timeline.ts';

export const EDIT_OPS_HELP = `Edits run in order; each is { op, ... }. Targets: path ids from inspect_sequence ("V1/3"), pr-cut segment/piece ids ("proof", "proof.2"), or { quote: "words spoken in the clip" }.
- { op: "delete", target }  ripple delete (picture and sound; later clips move up)
- { op: "trim", target, start?: Δ, end?: Δ }  move an edge: "+3w"/"-2w" by words (cuts stay in gaps), "+12f", "-0.5s"; positive = later
- { op: "move", target, before?: target, after?: target }
- { op: "replace", target, quote? | words?: [a,b] | from?/to?, src? }  swap the source range (same media unless src)
- { op: "insert", before? | after?: target, src?, quote? | words? | from?/to? }
- { op: "cut-words", target, quote? | words?: [a,b] }  remove words inside a clip
- { op: "tighten", target?: target | "*", fillers?, repeats?, maxPause?, keepPause? }
- { op: "grade", target?: target | "*", exposure?, contrast?, highlights?, shadows?, whites?, blacks?, temperature?, tint?, saturation?, vibrance? }
- { op: "level", target: "music" | "dialogue" | target, db?: absolute dB, delta?: ±dB }
- { op: "broll", src, over: target, offset?, duration?, in?, audio?: dB, track? }
- { op: "transition", target, kind: "dissolve" | "dip-black" | "cut", frames? }
- { op: "punch-in", target, scale }
- { op: "remove", target }  remove a B-roll/graphic/music clip without rippling
- { op: "title", mogrt, at?: time | { target, offset? }, duration?, track?, fields?: { "Name": "…" } }  place a .mogrt on the new version and fill its fields
- { op: "rename", name }
- { op: "captions", maxChars?, maxLines? } | { op: "captions", captions: false }  caption track from the new cut's words (automatic when the cut was built with captions)`;

const Target = z.union([z.string().min(1), z.object({ quote: z.string().min(3) }).strict()]);
const Tm = z.union([z.number(), z.string()]);
const Range = { quote: z.string().optional(), words: z.tuple([z.number().int(), z.number().int()]).optional(), sentences: z.union([z.string(), z.tuple([z.string(), z.string()])]).optional(), from: Tm.optional(), to: Tm.optional() };
const GradeKeys = { exposure: z.number().optional(), contrast: z.number().optional(), highlights: z.number().optional(), shadows: z.number().optional(), whites: z.number().optional(), blacks: z.number().optional(), temperature: z.number().optional(), tint: z.number().optional(), saturation: z.number().optional(), vibrance: z.number().optional(), fadedFilm: z.number().optional(), sharpen: z.number().optional() };
/** Every op is checked before anything is touched; unknown fields are refused (a typo must not widen an edit). */
export const EditOpSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('delete'), target: Target }).strict(),
  z.object({ op: z.literal('trim'), target: Target, start: Tm.optional(), end: Tm.optional() }).strict(),
  z.object({ op: z.literal('move'), target: Target, before: Target.optional(), after: Target.optional() }).strict(),
  z.object({ op: z.literal('replace'), target: Target, src: z.string().optional(), ...Range }).strict(),
  z.object({ op: z.literal('insert'), before: Target.optional(), after: Target.optional(), src: z.string().optional(), ...Range }).strict(),
  z.object({ op: z.literal('cut-words'), target: Target, quote: z.string().optional(), words: z.tuple([z.number().int(), z.number().int()]).optional() }).strict(),
  z.object({ op: z.literal('tighten'), target: Target.optional(), fillers: z.boolean().optional(), repeats: z.boolean().optional(), maxPause: Tm.optional(), keepPause: Tm.optional(), handles: Tm.optional(), minPiece: Tm.optional() }).strict(),
  z.object({ op: z.literal('grade'), target: Target.optional(), ...GradeKeys }).strict(),
  z.object({ op: z.literal('level'), target: Target, db: z.number().optional(), delta: z.number().optional() }).strict(),
  z.object({ op: z.literal('broll'), src: z.string(), over: Target, offset: Tm.optional(), duration: Tm.optional(), in: Tm.optional(), audio: z.number().optional(), track: z.number().int().min(2).optional() }).strict(),
  z.object({ op: z.literal('transition'), target: Target, kind: z.enum(['dissolve', 'dip-black', 'dip-white', 'cut']), frames: z.number().int().min(2).max(120).optional() }).strict(),
  z.object({ op: z.literal('punch-in'), target: Target, scale: z.number().min(100).max(200).optional() }).strict(),
  z.object({ op: z.literal('remove'), target: Target }).strict(),
  z.object({ op: z.literal('title'), mogrt: z.string(), at: z.union([Tm, z.object({ target: Target.optional(), seg: z.string().optional(), offset: Tm.optional() }).strict()]).optional(), duration: Tm.optional(), track: z.number().int().min(2).optional(), fields: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional() }).strict(),
  z.object({ op: z.literal('rename'), name: z.string().min(1) }).strict(),
  z.object({ op: z.literal('captions'), captions: z.literal(false).optional(), maxChars: z.number().int().optional(), maxLines: z.number().int().optional() }).strict(),
]);

/** Check every op before anything happens: shapes, required targets, and one-of choices. */
export function parseEdits(edits: unknown[]): any[] {
  return edits.map((e, i) => {
    const r = EditOpSchema.safeParse(e);
    const fail = (m: string) => { throw new Error(`edit #${i + 1} (${(e as any)?.op ?? 'no op'}) is invalid: ${m}`); };
    if (!r.success) fail(r.error.issues.map((x) => `${x.path.join('.') || 'op'}: ${x.message}`).join('; '));
    const d: any = r.data;
    if ((d.op === 'move' || d.op === 'insert') && !!d.before === !!d.after) fail('give exactly one of before / after');
    if (d.op === 'cut-words' && !!d.quote === !!d.words) fail('give quote or words');
    if (d.op === 'level' && (d.db === undefined) === (d.delta === undefined)) fail('give db or delta');
    if ((d.op === 'replace' || d.op === 'insert') && [d.quote, d.words, d.sentences, d.from ?? d.to].filter((x) => x !== undefined).length !== 1 && !(d.op === 'insert' && d.src && d.from === undefined && d.to === undefined && !d.quote && !d.words && !d.sentences)) fail('give exactly one of quote, words, sentences or from/to');
    return d;
  });
}

/** A dialogue piece on the spine. `origin` is the original spine clip it came from (anchors hang off it). */
interface SP { clip: TLClip; origin: number; gapBefore: number; tr?: Transcript | null; label: string; /** Made by splitting in this batch (tighten, cut-words): a new jump cut. */ fresh?: boolean }

const T = (x: string | number, fps: number) => parseTime(x, { num: Math.round(fps * 1000), den: 1000 });
/** A source path, or a library id "lib:41". */
const srcPath = (src: string) => {
  if (src.startsWith('lib:')) { const p = libraryPath(src.slice(4)); if (!p) throw new Error(`${src} is not in the media library`); return p; }
  return path.resolve(src);
};

export interface EditResult { report: BuildReport; summary: string }

export async function applyCutEdits(seqId: string, editsIn: unknown[], o: { name?: string } = {}): Promise<EditResult> {
  const edits = parseEdits(editsIn);
  const { timeline: t0, warnings, spine: spineIds } = await adoptSequence(seqId);
  const R = t0.rate, fps = R.num / R.den, tpf = ticksPerFrame(R);
  const log: string[] = [];
  // Sidecar (pr-cut built this sequence): piece and segment ids by start frame.
  let sidecar: any = null;
  try { sidecar = JSON.parse(fs.readFileSync(path.join(CUTS_DIR, `${seqId}.json`), 'utf8')); } catch { /* hand cut */ }
  const trOf = (c: TLClip) => { const m = t0.media[c.media]; return m?.path ? cachedTranscript(m.path) : null; };
  // ---- spine and anchors ----
  let spine: SP[] = spineIds.map((id, k) => {
    const c = t0.clips.find((x) => x.id === id)!;
    const prev = k ? t0.clips.find((x) => x.id === spineIds[k - 1])! : null;
    const label = sidecar?.pieces?.find((p: any) => p.start === c.start)?.id ?? id;
    return { clip: c, origin: k, gapBefore: c.start - (prev ? prev.end : c.start), tr: trOf(c), label };
  });
  if (!spine.length) {
    const opaque = t0.clips.filter((c) => c.vTrack === 1 && c.raw?.item).length;
    throw new Error(opaque ? `V1 holds only nested sequences, multicam clips or graphics (${opaque}); pr-cut edits need media clips on V1 (flatten the multicam or edit inside the nest)` : 'the sequence has no dialogue clips on V1 to edit');
  }
  const firstStart = spine[0].clip.start;
  const oldEnd = spine[spine.length - 1].clip.end;
  const was = (oldEnd - firstStart) / fps;
  const others = t0.clips.filter((c) => !spineIds.includes(c.id));
  const anchorOf = (frame: number) => {
    // Inside a dialogue clip: that clip at that source moment. In a gap on V1 (or before the first clip): the next
    // clip's start, with the distance kept. After the last clip: the last clip's end.
    let k = spine.findIndex((s) => frame >= s.clip.start && frame < s.clip.end);
    if (k < 0) { k = spine.findIndex((s) => s.clip.start > frame); if (k < 0) k = spine.length - 1; }
    const s = spine[k].clip;
    return { origin: k, tick: s.inTicks + (Math.min(Math.max(frame, s.start), s.end) - s.start) * tpf, before: frame < s.start, after: frame >= s.end, offset: frame - (frame < s.start ? s.start : s.end) };
  };
  const anchors = new Map(others.map((c) => [c, { a: anchorOf(c.start), b: anchorOf(c.end) }]));
  const origOf = new Map(others.map((c) => [c, { start: c.start, end: c.end, inTicks: c.inTicks, outTicks: c.outTicks }]));

  // ---- target resolution ----
  const resolve = (target: any, what = 'target'): SP[] => {
    if (target === '*' || target === undefined) return spine;
    if (typeof target === 'object' && target?.quote) {
      const hits = spine.filter((s) => {
        if (!s.tr) return false;
        const [a, b] = wordsIn(s);
        if (a > b) return false;
        const m = findQuote(s.tr.words, target.quote, { from: a, to: b });
        return !!m && m.score >= 0.8;
      });
      if (!hits.length) throw new Error(`${what}: no clip says "${target.quote}"`);
      return hits;
    }
    const id = String(target);
    const bySeg = spine.filter((s) => s.label === id || s.label.startsWith(id + '.') || s.clip.id === id);
    if (bySeg.length) return bySeg;
    throw new Error(`${what} "${id}" not found; spine clips: ${spine.map((s) => s.label).join(', ')}`);
  };
  const other = (target: any): TLClip[] => {
    if (target === 'music') return others.filter((c) => !c.vTrack && c.aTrack);
    const id = String(target);
    const hit = others.filter((c) => c.id === id);
    if (!hit.length) throw new Error(`no B-roll/graphic/music clip "${id}"; have ${others.map((c) => c.id).join(', ')}`);
    return hit;
  };
  const wordsIn = (s: SP): [number, number] => {
    if (!s.tr) return [0, -1];
    const a = s.clip.inTicks / TICKS_PER_SECOND, b = s.clip.outTicks / TICKS_PER_SECOND;
    const ws = s.tr.words.filter((w) => w.start >= a - 0.03 && w.end <= b + 0.03);
    return ws.length ? [ws[0].i, ws[ws.length - 1].i] : [0, -1];
  };
  const needTr = async (s: SP) => {
    if (s.tr) return s.tr;
    const m = t0.media[s.clip.media];
    s.tr = await transcribe(m.path);
    return s.tr;
  };
  const setRange = (c: TLClip, inS: number, outS: number) => {
    const len = Math.max(1, Math.round((outS - inS) * fps));
    c.inTicks = Math.round(inS * TICKS_PER_SECOND);
    c.outTicks = c.inTicks + len * tpf;
    c.end = c.start + len;
    delete c.video; // a split edit doesn't survive a re-trim
  };
  // A cut point in the gap before word i (or after word i): midpoint of the gap, frame-quantized, never into a word.
  const gapBefore = (tr: Transcript, i: number) => { const prev = tr.words[i - 1]; const w = tr.words[i]; const p = prev ? prev.end : 0; return Math.max(p, Math.min(w.start - 0.04, (p + w.start) / 2)); };
  const gapAfter = (tr: Transcript, i: number) => { const next = tr.words[i + 1]; const w = tr.words[i]; const n = next ? next.start : tr.duration; return Math.min(n, Math.max(w.end + 0.06, (w.end + n) / 2)); };
  const fq = (s: number, mode: 'floor' | 'ceil') => (mode === 'floor' ? Math.floor(s * fps + 1e-6) : Math.ceil(s * fps - 1e-6)) / fps;
  // The in point at or before the first kept word's first frame, the out point at or after the last word's last.
  const rangeFromWords = (tr: Transcript, a: number, b: number) => [Math.min(fq(gapBefore(tr, a), 'ceil'), fq(tr.words[a].start, 'floor')), Math.max(fq(gapAfter(tr, b), 'floor'), fq(tr.words[b].end, 'ceil'))] as [number, number];
  const newPiece = async (src: string | undefined, like: SP, e: any): Promise<SP> => {
    const media = src ? srcPath(src) : t0.media[like.clip.media].path;
    let key = like.clip.media;
    if (src) {
      key = `f_${path.basename(media).replace(/[^\w.-]+/g, '_')}_new`;
      if (!t0.media[key]) t0.media[key] = await probe(media);
    }
    const tr = cachedTranscript(media) ?? ((e.quote || e.words || e.sentences) ? await transcribe(media) : null);
    let inS: number, outS: number;
    if (e.quote || e.words || e.sentences) {
      if (!tr) throw new Error(`no transcript for ${path.basename(media)}`);
      let a: number, b: number;
      if (e.words) [a, b] = e.words;
      else if (e.sentences) { const [x, y] = typeof e.sentences === 'string' ? [e.sentences, e.sentences] : e.sentences; const sx = tr.sentences.find((s) => s.id === x), sy = tr.sentences.find((s) => s.id === y); if (!sx || !sy) throw new Error(`no sentence ${x}/${y}`); [a, b] = [sx.from, sy.to]; }
      else { const m = findQuote(tr.words, e.quote); if (!m || m.score < 0.7) throw new Error(`quote not found: "${e.quote}"${m ? ` (best ${Math.round(m.score * 100)} %: "${m.text}")` : ''}`); [a, b] = [m.from, m.to]; log.push(`  quote matched ${Math.round(m.score * 100)} %: "${m.text}"`); }
      [inS, outS] = rangeFromWords(tr, a, b);
    } else {
      inS = T(e.from ?? 0, fps); outS = T(e.to ?? t0.media[key].duration, fps);
    }
    const c: TLClip = { ...like.clip, id: `new${Math.random().toString(36).slice(2, 6)}`, media: key, name: undefined, raw: { video: (like.clip.raw?.video ?? []).filter((f) => /Lumetri/.test(f)), audio: [] }, transitionIn: undefined, motion: undefined, start: 0, end: 0, inTicks: 0, outTicks: 0 };
    setRange(c, inS, outS);
    return { clip: c, origin: -1, gapBefore: 0, tr, label: 'new' };
  };

  let name = o.name;
  const titles: { op: any; anchor: SP | null; n: number }[] = [];
  // A caption track doesn't travel through XML: rebuild it from the new cut's words when the cut had captions.
  let captions: false | { maxChars?: number; maxLines?: number } = sidecar?.plan?.captions ? (typeof sidecar.plan.captions === 'object' ? sidecar.plan.captions : {}) : false;
  for (const [n, e] of edits.entries()) {
    const tag = `#${n + 1} ${e.op}`;
    switch (e.op) {
      case 'delete': {
        const ts = resolve(e.target, tag);
        spine = spine.filter((s) => !ts.includes(s));
        log.push(`${tag}: removed ${ts.map((s) => s.label).join(', ')}`);
        break;
      }
      case 'trim': {
        for (const s of resolve(e.target, tag)) {
          const c = s.clip;
          let inS = c.inTicks / TICKS_PER_SECOND, outS = c.outTicks / TICKS_PER_SECOND;
          for (const edge of ['start', 'end'] as const) {
            const d = e[edge];
            if (d === undefined) continue;
            const m = /^([+-]?\d+)\s*w$/.exec(String(d));
            if (m) {
              const tr = await needTr(s);
              const [a, b] = wordsIn(s);
              const k = +m[1];
              if (edge === 'start') { const i = Math.max(0, Math.min(tr.words.length - 1, a + k)); inS = rangeFromWords(tr, i, i)[0]; }
              else { const i = Math.max(0, Math.min(tr.words.length - 1, b + k)); outS = rangeFromWords(tr, i, i)[1]; }
            } else {
              const dt = T(String(d).replace(/^\+/, ''), fps);
              if (edge === 'start') inS += dt; else outS += dt;
            }
          }
          if (outS - inS < 0.3) throw new Error(`${tag}: ${s.label} would be ${(outS - inS).toFixed(2)} s long`);
          inS = Math.max(0, inS);
          outS = Math.min(t0.media[c.media].duration, outS);
          setRange(c, inS, outS);
          log.push(`${tag}: ${s.label} now ${inS.toFixed(2)}–${outS.toFixed(2)} s of source`);
        }
        break;
      }
      case 'move': {
        const ts = resolve(e.target, tag);
        spine = spine.filter((s) => !ts.includes(s));
        const ref = resolve(e.before ?? e.after, tag);
        const at = e.before ? spine.indexOf(ref[0]) : spine.indexOf(ref[ref.length - 1]) + 1;
        spine.splice(at, 0, ...ts);
        log.push(`${tag}: moved ${ts.map((s) => s.label).join(', ')} ${e.before ? 'before' : 'after'} ${ref.map((s) => s.label).join(', ')}`);
        break;
      }
      case 'replace': {
        const ts = resolve(e.target, tag);
        const np = await newPiece(e.src, ts[0], e);
        np.origin = ts[0].origin; np.label = ts[0].label; np.gapBefore = ts[0].gapBefore;
        np.clip.raw = ts[0].clip.raw?.item ? undefined : { video: ts[0].clip.raw?.video, audio: ts[0].clip.raw?.audio };
        np.clip.transitionIn = ts[0].clip.transitionIn;
        const at = spine.indexOf(ts[0]);
        spine = spine.filter((s) => !ts.includes(s));
        spine.splice(at, 0, np);
        log.push(`${tag}: ${ts.map((s) => s.label).join(', ')} → ${(np.clip.inTicks / TICKS_PER_SECOND).toFixed(2)}–${(np.clip.outTicks / TICKS_PER_SECOND).toFixed(2)} s of ${t0.media[np.clip.media].name}`);
        break;
      }
      case 'insert': {
        const ref = resolve(e.before ?? e.after ?? '*', tag);
        const np = await newPiece(e.src, ref[0], e);
        const at = e.before ? spine.indexOf(ref[0]) : spine.indexOf(ref[ref.length - 1]) + 1;
        np.label = `ins${n + 1}`;
        spine.splice(at, 0, np);
        log.push(`${tag}: inserted ${((np.clip.end - np.clip.start) / fps).toFixed(2)} s ${e.before ? 'before' : 'after'} ${ref[0].label}`);
        break;
      }
      case 'cut-words':
      case 'tighten': {
        const out: SP[] = [];
        const targets = new Set(resolve(e.target, tag));
        let total = 0;
        for (const s of spine) {
          if (!targets.has(s)) { out.push(s); continue; }
          const tr = await needTr(s);
          const [a, b] = wordsIn(s);
          if (a > b) { out.push(s); continue; }
          let opt = { ...DEF, ...(e.op === 'tighten' ? e : { fillers: false, repeats: false, maxPause: 1e9 }) } as any;
          if (e.op === 'cut-words') {
            let cut: [number, number];
            if (e.words) cut = e.words;
            else { const m = findQuote(tr.words, e.quote, { from: a, to: b }); if (!m || m.score < 0.75) throw new Error(`${tag}: "${e.quote}" not in ${s.label}`); cut = [m.from, m.to]; }
            opt = { ...opt, cut: [cut] };
          }
          const removed = { fillers: 0, repeats: 0, pauses: 0, pauseSeconds: 0 };
          const pcs = tightenSegment(s.label, { src: t0.media[s.clip.media].path }, s.clip.media, tr, a, b, opt, false, fps, removed, warnings);
          const inS0 = s.clip.inTicks / TICKS_PER_SECOND, outS0 = s.clip.outTicks / TICKS_PER_SECOND;
          pcs.forEach((p, k) => {
            const c: TLClip = { ...s.clip, id: `${s.clip.id}.${k + 1}`, raw: s.clip.raw ? { ...s.clip.raw } : undefined, transitionIn: k ? undefined : s.clip.transitionIn };
            // Keep the editor's own head and tail where the first/last words are unchanged.
            setRange(c, k === 0 && p.words![0] === a ? Math.min(p.inS, inS0) : p.inS, k === pcs.length - 1 && p.words![1] === b ? Math.max(p.outS, outS0) : p.outS);
            out.push({ ...s, clip: c, label: pcs.length > 1 ? `${s.label}.${k + 1}` : s.label, fresh: k > 0 });
          });
          total += (s.clip.end - s.clip.start) - pcs.reduce((x, p) => x + Math.round((p.outS - p.inS) * fps), 0);
          if (removed.fillers + removed.repeats + removed.pauses) log.push(`  ${s.label}: −${removed.fillers} fillers, −${removed.repeats} repeats, −${removed.pauses} pauses`);
        }
        spine = out;
        log.push(`${tag}: ${(total / fps).toFixed(2)} s shorter`);
        break;
      }
      case 'grade': {
        const g: Grade = {};
        for (const k of ['exposure', 'contrast', 'highlights', 'shadows', 'whites', 'blacks', 'temperature', 'tint', 'saturation', 'vibrance', 'fadedFilm', 'sharpen'] as const) if (e[k] !== undefined) (g as any)[k] = e[k];
        const ts = resolve(e.target ?? '*', tag);
        for (const s of ts) s.clip.grade = { ...(s.clip.grade ?? {}), ...g };
        log.push(`${tag}: ${JSON.stringify(g)} on ${ts.length} clip(s)`);
        break;
      }
      case 'level': {
        const cs = e.target === 'all' ? [...spine.map((s) => s.clip), ...others.filter((c) => c.aTrack)]
          : e.target === 'dialogue' ? spine.map((s) => s.clip) : e.target === 'music' ? other('music') : (() => { try { return resolve(e.target, tag).map((s) => s.clip); } catch { return other(e.target); } })();
        let flattened = 0;
        for (const c of cs) {
          if (e.db === undefined && e.delta !== undefined) {
            // Relative change: shift keyframes (ducking, fades) instead of flattening them.
            if (c.levelKeys?.length) { c.levelKeys = c.levelKeys.map((k) => ({ ...k, db: k.db + e.delta })); if (c.level !== undefined) c.level += e.delta; continue; }
            const rawLv = c.raw?.audio?.findIndex((f) => /<effectid>audiolevels<\/effectid>/.test(f)) ?? -1;
            if (rawLv >= 0 && /<keyframe>/.test(c.raw!.audio![rawLv])) { c.raw!.audio![rawLv] = scaleRawLevels(c.raw!.audio![rawLv], e.delta); continue; }
            c.level = (c.level ?? levelFromRaw(c) ?? 0) + e.delta;
          } else {
            if (c.levelKeys?.length || c.raw?.audio?.some((f) => /<keyframe>/.test(f) && /audiolevels/.test(f))) flattened++;
            c.level = e.db;
            delete c.levelKeys;
          }
        }
        log.push(`${tag}: ${cs.length} clip(s) ${e.db !== undefined ? `to ${e.db} dB` : `${e.delta > 0 ? '+' : ''}${e.delta} dB`}${flattened ? ` (${flattened} had level keyframes; an absolute level replaced them; use delta to keep them)` : ''}`);
        break;
      }
      case 'broll': {
        const ref = resolve(e.over, tag);
        const info = await probe(srcPath(e.src));
        const key = `f_${path.basename(e.src).replace(/[^\w.-]+/g, '_')}_b${n}`;
        t0.media[key] = info;
        const c: TLClip = { id: `b${n + 1}`, media: key, vTrack: e.track ?? 2, start: 0, end: 0, inTicks: 0, outTicks: 0, label: 'Mango', ...(e.audio !== undefined && info.audio ? { aTrack: 3, level: e.audio } : {}) };
        others.push(c);
        (c as any)._over = { ref: ref[0], offset: e.offset !== undefined ? T(e.offset, fps) : 0, duration: e.duration !== undefined ? T(e.duration, fps) : undefined, in: e.in !== undefined ? T(e.in, fps) : undefined, dur: info.duration };
        log.push(`${tag}: ${path.basename(e.src)} over ${ref[0].label}`);
        break;
      }
      case 'transition': {
        for (const s of resolve(e.target, tag)) s.clip.transitionIn = e.kind === 'cut' ? undefined : { kind: e.kind, frames: e.frames ?? Math.round(fps / 2) };
        log.push(`${tag}: ${e.kind} into ${e.target}`);
        break;
      }
      case 'punch-in': {
        for (const s of resolve(e.target, tag)) s.clip.motion = { scale: e.scale ?? 112 };
        log.push(`${tag}: ${e.scale ?? 112} % on ${e.target}`);
        break;
      }
      case 'remove': {
        const cs = other(e.target);
        for (const c of cs) others.splice(others.indexOf(c), 1);
        log.push(`${tag}: removed ${cs.map((c) => c.id).join(', ')}`);
        break;
      }
      case 'title': {
        // Placed live on the new version after its import (mogrts can't travel in XML).
        const at = e.at === undefined ? 0 : typeof e.at === 'object' ? (() => { const s = resolve(e.at.target ?? e.at.seg, tag)[0]; return s; })() : null;
        titles.push({ op: e, anchor: at && typeof at === 'object' ? at : null, n });
        log.push(`${tag}: ${path.basename(e.mogrt)}${e.fields ? ` ${JSON.stringify(e.fields)}` : ''}`);
        break;
      }
      case 'rename': name = e.name; break;
      case 'captions': captions = e.captions === false ? false : { maxChars: e.maxChars, maxLines: e.maxLines }; log.push(`${tag}: ${captions ? 'caption track from the words of the new cut' : 'no captions'}`); break;
      default: throw new Error(`${tag}: unknown op (use ${EDIT_OPS_HELP.match(/op: "[a-z-]+"/g)?.map((x) => x.slice(5)).join(', ')})`);
    }
  }

  // ---- re-layout the spine ----
  let cursor = firstStart;
  const prevOrigin: number[] = [];
  spine.forEach((s, k) => {
    const len = s.clip.end - s.clip.start;
    const firstOfOrigin = k === 0 || spine[k - 1].origin !== s.origin;
    if (firstOfOrigin && k > 0) cursor += Math.max(0, s.gapBefore);
    const shift = cursor - s.clip.start;
    s.clip.start = cursor; s.clip.end = cursor + len;
    if (s.clip.video) { s.clip.video.start += shift; s.clip.video.end += shift; }
    cursor += len;
    // A transition survives only when the clip before it is still the one it was made for.
    if (s.clip.transitionIn && k > 0 && spineIds[s.origin - 1] !== undefined && spine[k - 1].origin !== s.origin - 1 && spine[k - 1].origin !== s.origin) { warnings.push(`${s.label}: its transition was dropped (the clip before it changed)`); delete s.clip.transitionIn; }
    prevOrigin.push(s.origin);
  });
  // Split edits (J/L) survive only where picture edges still meet; otherwise both sides snap to the sound's edges.
  for (let pass = 0, changed = true; changed && pass < 5; pass++) {
    changed = false;
    for (let k = 0; k + 1 < spine.length; k++) {
      const A = spine[k].clip, B = spine[k + 1].clip;
      const aEnd = A.video?.end ?? A.end, bStart = B.video?.start ?? B.start;
      if (aEnd !== bStart) {
        if (A.video || B.video) { warnings.push(`${spine[k].label} → ${spine[k + 1].label}: the J/L cut no longer fits after the edit; it is a straight cut now`); changed = true; }
        delete A.video; delete B.video;
      }
    }
  }
  const end = cursor;
  // ---- re-place anchored clips ----
  const mapAnchor = (an: ReturnType<typeof anchorOf>): number | null => {
    const pieces = spine.filter((s) => s.origin === an.origin);
    if (!pieces.length) {
      const next = spine.find((s) => s.origin > an.origin);
      return next ? next.clip.start : end;
    }
    if (an.before) return pieces[0].clip.start + an.offset;
    if (an.after) return pieces[pieces.length - 1].clip.end + an.offset;
    const hit = pieces.find((p) => an.tick >= p.clip.inTicks && an.tick < p.clip.outTicks);
    if (hit) return hit.clip.start + Math.round((an.tick - hit.clip.inTicks) / tpf);
    const nextP = pieces.find((p) => p.clip.inTicks > an.tick);
    return nextP ? nextP.clip.start : pieces[pieces.length - 1].clip.end;
  };
  const kept: TLClip[] = [];
  for (const c of others) {
    const ov = (c as any)._over;
    if (ov) {
      const s0 = ov.ref.clip.start + Math.round(ov.offset * fps);
      const len = Math.min(ov.duration !== undefined ? Math.round(ov.duration * fps) : ov.ref.clip.end - s0, Math.floor(ov.dur * fps) - 1);
      const inS = ov.in ?? Math.max(0, (ov.dur - len / fps) / 2);
      c.start = s0; c.end = s0 + len; c.inTicks = Math.round(inS * TICKS_PER_SECOND); c.outTicks = c.inTicks + len * tpf;
      delete (c as any)._over;
      kept.push(c);
      continue;
    }
    const an = anchors.get(c)!;
    const s = mapAnchor(an.a), e2 = mapAnchor(an.b);
    if (s === null || e2 === null || e2 - s < Math.round(fps / 2)) { warnings.push(`${c.id} (${t0.media[c.media]?.name}) was dropped: what it covered is gone`); continue; }
    const oldLen = c.end - c.start, newLen = e2 - s;
    // Head trimmed when its start fell in removed material; the tail follows the new length.
    const headCut = Math.max(0, oldLen - newLen) && an.a.origin >= 0 && !spine.some((p) => p.origin === an.a.origin && an.a.tick >= p.clip.inTicks && an.a.tick < p.clip.outTicks) ? oldLen - newLen : 0;
    const shift = s - c.start;
    c.inTicks += headCut * tpf;
    c.start = s; c.end = e2; c.outTicks = c.inTicks + newLen * tpf;
    if (c.video) { c.video.start += shift; c.video.end = Math.min(c.video.end + shift, e2); }
    if (c.levelKeys) c.levelKeys = c.levelKeys.map((k) => ({ ...k, frame: k.frame + shift }));
    kept.push(c);
  }
  // Music beds (audio-only clips that span dialogue): a bed that ran to the end of the cut still does; a backtimed
  // bed (ending on the track's own ending) keeps that ending by moving its in point; ducking is redone against the
  // words of the new cut.
  const transcriptsBy: Record<string, Transcript> = {};
  const spans = speechSpans(spine.map((sp) => {
    const inS = sp.clip.inTicks / TICKS_PER_SECOND, outS = sp.clip.outTicks / TICKS_PER_SECOND;
    const ws = sp.tr ? sp.tr.words.filter((w) => w.start >= inS - 0.03 && w.end <= outS + 0.03) : [];
    if (sp.tr) transcriptsBy[sp.clip.media] = sp.tr;
    return { media: sp.clip.media, words: ws.length ? [ws[0].i, ws[ws.length - 1].i] as [number, number] : null, inS, outS, start: sp.clip.start, end: sp.clip.end };
  }), transcriptsBy, t0, fps);
  for (const c of kept) {
    const m = t0.media[c.media], o = origOf.get(c);
    if (c.vTrack || !c.aTrack || !m || !o || (m.kind !== 'audio' && o.end - o.start < (oldEnd - firstStart) * 0.5)) continue;
    const durT = Math.round(m.duration * TICKS_PER_SECOND);
    if (o.end >= oldEnd - Math.round(fps / 2)) c.end = Math.max(c.start + 1, end + (o.end - oldEnd));
    const len = c.end - c.start;
    if (Math.abs(o.outTicks - durT) < TICKS_PER_SECOND / 2) {
      c.outTicks = durT; c.inTicks = durT - len * tpf;
      if (c.inTicks < 0) { c.inTicks = 0; c.outTicks = len * tpf; warnings.push(`${c.id} (${m.name}) is now shorter than the cut; it starts at its beginning and no longer ends on its own ending`); }
    } else {
      c.outTicks = c.inTicks + len * tpf;
      if (c.outTicks > durT) { const fit = Math.floor((durT - c.inTicks) / tpf); c.end = c.start + fit; c.outTicks = c.inTicks + fit * tpf; warnings.push(`${c.id} (${m.name}) runs out at ${framesToTimecode(c.end, R)}, before the new end of the cut`); }
    }
    const lv = c.raw?.audio?.find((f) => /<effectid>audiolevels<\/effectid>/.test(f) && /<keyframe>/.test(f));
    if (lv && c.levelKeys === undefined && c.level === undefined) {
      const dbs = [...lv.matchAll(/<keyframe>[\s\S]*?<value>([\d.]+)<\/value>/g)].map((x) => 20 * Math.log10(Math.max(1e-6, Number(x[1]))));
      if (dbs.length >= 2) {
        const under = Math.round(Math.min(...dbs) * 10) / 10, open = Math.round(Math.max(...dbs) * 10) / 10;
        c.levelKeys = duckKeys(spans, c.start, c.end, under, open, fps);
        delete c.video;
      }
    }
  }

  const p = await projectInfo();
  const base = (name ?? t0.name).replace(/\s+v\d{3}$/i, '');
  let v = 2;
  while (p.sequences.some((s) => s.name === `${base} v${String(v).padStart(3, '0')}`)) v++;
  const timeline: Timeline = { ...t0, name: name ?? `${base} v${String(v).padStart(3, '0')}`, clips: [...spine.map((s) => s.clip), ...kept], markers: t0.markers.map((m) => { const an = anchorOf(m.frame); const f = mapAnchor(an); return { ...m, frame: f ?? m.frame }; }) };
  // Jump cuts this batch created (tighten, cut-words) get the alternating punch-in a build would give them.
  for (let k = 1; k < spine.length; k++) {
    const A = spine[k - 1], B = spine[k];
    if (!B.fresh || A.clip.media !== B.clip.media || Math.abs(A.clip.outTicks - B.clip.inTicks) <= tpf) continue;
    if (motionScale(A.clip) === motionScale(B.clip)) B.clip.motion = { scale: motionScale(A.clip) === 100 ? 112 : 100 };
  }
  // Dialogue audio not linked to its picture doesn't follow word edits.
  const wordOps = edits.some((e) => ['tighten', 'cut-words'].includes(e.op) || (e.op === 'trim' && /w$/.test(String(e.start ?? e.end ?? ''))));
  if (wordOps) {
    const loose = kept.filter((c) => !c.vTrack && c.aTrack && t0.media[c.media]?.kind !== 'audio' && spine.some((sp) => c.start < sp.clip.end && c.end > sp.clip.start));
    if (loose.length) warnings.push(`${loose.map((c) => c.id).join(', ')}: audio under the dialogue that isn't linked to its picture; word edits moved the picture only. Link it in Premiere (select picture and sound, Clip > Link) and edit again.`);
  }
  // Only media the new version uses (a deleted clip's missing file must not block the import).
  const used = new Set(timeline.clips.map((c) => c.media));
  timeline.media = Object.fromEntries(Object.entries(timeline.media).filter(([k]) => used.has(k)));
  const imp = await importTimeline(timeline);
  // The version's own sidecar, so segment ids and captions carry on to its next version.
  fs.mkdirSync(CUTS_DIR, { recursive: true });
  fs.writeFileSync(path.join(CUTS_DIR, `${imp.sequenceId}.json`), JSON.stringify({ sequenceId: imp.sequenceId, name: imp.name, builtAt: new Date().toISOString(), parent: seqId, edits, plan: { captions: captions || undefined }, pieces: spine.map((sp) => ({ id: sp.label, start: sp.clip.start, end: sp.clip.end })), rate: R }, null, 1));

  // Report + lint on the new spine (clips take their piece labels as ids so lint can match framing per piece).
  const seen = new Set<string>();
  for (const s of spine) { let id = s.label, k = 2; while (seen.has(id)) id = `${s.label}#${k++}`; seen.add(id); s.label = id; s.clip.id = id; }
  const transcripts: Record<string, Transcript> = {};
  const pieces: Piece[] = spine.map((s) => {
    if (s.tr) transcripts[s.clip.media] = s.tr;
    const inS = s.clip.inTicks / TICKS_PER_SECOND, outS = s.clip.outTicks / TICKS_PER_SECOND;
    const ws = s.tr ? s.tr.words.filter((w) => w.start >= inS - 0.03 && w.end <= outS + 0.03) : [];
    return { id: s.label, seg: s.label.split('.')[0], src: t0.media[s.clip.media].path, media: s.clip.media, words: ws.length ? [ws[0].i, ws[ws.length - 1].i] : null, inS, outS, start: s.clip.start, end: s.clip.end, jump: false };
  });
  pieces.forEach((pc, k) => { const prev = pieces[k - 1]; pc.jump = !!prev && prev.media === pc.media && Math.abs(prev.outS - pc.inS) > 1 / fps; });
  const compiled: Compiled = { plan: { name: timeline.name, segments: [{ src: '-', from: 0 }] } as any, timeline, pieces, segments: [], titles: [], transcripts, warnings, stats: { sourceSeconds: 0, cutSeconds: (end - firstStart) / fps, removed: { fillers: 0, repeats: 0, pauses: 0, pauseSeconds: 0 } } };
  const issues = lintCut(compiled);
  let liveSteps = 0;
  if (captions) liveSteps += await addCaptions(imp.sequenceId, compiled, captions);
  if (titles.length) {
    const resolved = titles.map(({ op, anchor, n: k }) => {
      const s0 = anchor ? anchor.clip.start + (op.at.offset !== undefined ? Math.round(T(op.at.offset, fps) * fps) : 0) : Math.round(T(op.at ?? 0, fps) * fps);
      const used = Math.max(1, ...kept.map((c) => c.vTrack ?? 0));
      return { id: `t${k + 1}`, mogrt: srcPath(op.mogrt), start: s0, end: s0 + Math.round(T(op.duration ?? 4, fps) * fps), track: op.track ?? used + 1, fields: op.fields ?? {} };
    });
    const t = await placeTitles(imp.sequenceId, resolved, tpf);
    liveSteps += t.steps;
    warnings.push(...t.missing.map((m) => `title ${m}`));
  }
  const contact = await sequenceContactSheet(imp.sequenceId, pieces.slice(0, 16).map((pc) => ({ frame: Math.floor((pc.start + pc.end) / 2), label: pc.id })), R, `${imp.name} — ${framesToTimecode(end, R)}`).catch(() => null);
  const strips = pieces.length > 1 && pieces.length <= 13 ? await cutStrips(imp.sequenceId, pieces.slice(1).map((pc) => ({ frame: pc.start, label: pc.id })), R, imp.name).catch(() => null) : null;
  const report: BuildReport = {
    sequence: { id: imp.sequenceId, name: imp.name }, path: 'fcp7-xml', durationSeconds: Math.round(((end - firstStart) / fps) * 100) / 100, timecode: framesToTimecode(end, R), undoSteps: imp.undoSteps + liveSteps,
    segments: [], stats: { ...compiled.stats, pieces: pieces.length, jumpCuts: pieces.filter((x) => x.jump).length, broll: kept.filter((c) => (c.vTrack ?? 0) >= 2).length, music: kept.filter((c) => !c.vTrack).length, titles: 0 },
    lint: formatIssues(issues), lintSummary: summarizeIssues(issues), warnings: [...warnings, ...imp.warnings], contactSheet: contact, strips, xml: imp.xmlFile,
  };
  const summary = [`edited "${t0.name}" → new version "${imp.name}" (${imp.sequenceId}); the original is untouched. ${was.toFixed(2)} s → ${report.durationSeconds} s, ${imp.undoSteps} undo step.`, ...log].join('\n');
  return { report, summary };
}

/** Multiply every gain value (static and keyframes) of a carried Audio Levels filter by a dB change. */
function scaleRawLevels(filter: string, deltaDb: number): string {
  const k = Math.pow(10, deltaDb / 20);
  return filter.replace(/(<value>)([\d.]+)(<\/value>)/g, (_m, a, v, b) => `${a}${Math.min(3.98109, Math.round(Number(v) * k * 1e6) / 1e6)}${b}`);
}

function levelFromRaw(c: TLClip): number | undefined {
  const f = c.raw?.audio?.find((x) => /<effectid>audiolevels<\/effectid>/.test(x));
  const v = f && /<parameterid>level<\/parameterid>[\s\S]*?<value>([\d.]+)<\/value>/.exec(f)?.[1];
  return v ? Math.round(20 * Math.log10(Number(v)) * 100) / 100 : undefined;
}
