// The edit plan: what an agent writes to make a cut. Declarative JSON (cuts are data, D-PR3), validated before
// Premiere is touched. Segments tell the story on V1/A1 and address source by words, sentences, quote or time.
import { z } from 'zod';

/** Seconds, or "3.5s", "250ms", "12f", "1:02.5", "00:00:03:12". */
export const Time = z.union([z.number(), z.string()]);

export const GradeSchema = z.object({
  exposure: z.number().min(-5).max(5).optional(), contrast: z.number().min(-100).max(100).optional(),
  highlights: z.number().min(-100).max(100).optional(), shadows: z.number().min(-100).max(100).optional(),
  whites: z.number().min(-100).max(100).optional(), blacks: z.number().min(-100).max(100).optional(),
  temperature: z.number().min(-100).max(100).optional(), tint: z.number().min(-100).max(100).optional(),
  saturation: z.number().min(0).max(200).optional(), vibrance: z.number().min(-100).max(100).optional(),
  fadedFilm: z.number().min(0).max(100).optional(), sharpen: z.number().min(-100).max(100).optional(),
}).strict();

export const TightenSchema = z.object({
  /** Cut "um", "uh", set-off "you know" / "like" (default true). */
  fillers: z.boolean().optional(),
  /** Cut the first copy of immediate repeats: "the second thing, the second thing" (default true). */
  repeats: z.boolean().optional(),
  /** Pauses longer than this are shortened (default 0.6 s). */
  maxPause: Time.optional(),
  /** How much of a shortened pause to keep, split around the cut (default 0.25 s). */
  keepPause: Time.optional(),
  /** Room kept before a word's onset and after its offset at every cut (default 0.06 s, never into the neighbour). */
  handles: Time.optional(),
  /** Pieces shorter than this are merged back instead of creating a flash cut (default 0.5 s). */
  minPiece: Time.optional(),
  /** Word indices to cut out besides fillers (false starts the agent chose). */
  cut: z.array(z.union([z.number().int(), z.tuple([z.number().int(), z.number().int()])])).optional(),
}).strict();

export const SegmentSchema = z.object({
  id: z.string().regex(/^[A-Za-z][\w-]*$/).optional(),
  /** Media alias from `media`, a file path, or a library id ("lib:<hash>"). */
  src: z.string(),
  words: z.tuple([z.number().int().min(0), z.number().int().min(0)]).optional(),
  sentences: z.union([z.string(), z.tuple([z.string(), z.string()])]).optional(),
  quote: z.string().min(3).optional(),
  from: Time.optional(),
  to: Time.optional(),
  /** Story beat (hook, problem, turn, proof, close…): written to the segment marker. */
  beat: z.string().optional(),
  tighten: z.union([TightenSchema, z.literal(false)]).optional(),
  /** J-cut: this segment's audio starts this much before its picture (heard under the previous shot). */
  j: Time.optional(),
  /** L-cut: this segment's audio runs this much past its picture (heard under the next shot). */
  l: Time.optional(),
  transition: z.enum(['cut', 'dissolve', 'dip-black', 'dip-white']).optional(),
  transitionFrames: z.number().int().min(2).max(120).optional(),
  /** Punch in (scale %) on this segment, e.g. to vary a single-camera interview. */
  punchIn: z.number().min(100).max(200).optional(),
  grade: GradeSchema.optional(),
  /** Dialogue gain, dB. */
  level: z.number().min(-60).max(12).optional(),
  /** Audio channels to use from the source, e.g. [1] for the lav on channel 1 (default: [1, 2] or [1]). */
  channels: z.array(z.number().int().min(1)).min(1).max(2).optional(),
}).strict().superRefine((s, ctx) => {
  const forms = [s.words, s.sentences, s.quote, s.from !== undefined || s.to !== undefined ? true : undefined].filter((x) => x !== undefined).length;
  if (forms !== 1) ctx.addIssue({ code: 'custom', message: 'give exactly one of words, sentences, quote, or from/to' });
});

export const BrollSchema = z.object({
  id: z.string().optional(),
  src: z.string(),
  /** Cover a segment (or [first, last] segments), a jump cut ("seg3/2": the cut before seg3's piece 2), or a sequence time. */
  over: z.union([z.string(), z.tuple([z.string(), z.string()])]).optional(),
  at: Time.optional(),
  /** Offset into the covered span, and length (default: the whole span, or 2.5 s around a jump cut). */
  offset: Time.optional(),
  duration: Time.optional(),
  /** Source in point (default: the media's most stable stretch — its middle). */
  in: Time.optional(),
  track: z.number().int().min(2).max(9).optional(),
  /** Nat sound under the dialogue, dB; omitted = picture only. */
  audio: z.number().min(-60).max(6).optional(),
  grade: GradeSchema.optional(),
  scale: z.number().min(10).max(400).optional(),
  transition: z.enum(['cut', 'dissolve']).optional(),
  /** Snap the B-roll's start and end to the music's beats or bars (needs a music track in the plan). */
  snap: z.enum(['beat', 'bar']).optional(),
}).strict();

export const TitleSchema = z.object({
  id: z.string().optional(),
  /** Path to a .mogrt (ae-compose export_mogrt, or Premiere's Essential Graphics). */
  mogrt: z.string(),
  at: z.union([Time, z.object({ seg: z.string(), offset: Time.optional() })]).optional(),
  duration: Time.optional(),
  track: z.number().int().min(2).max(9).optional(),
  fields: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
}).strict();

export const MusicSchema = z.object({
  id: z.string().optional(),
  src: z.string(),
  /** Sequence time the music starts (default 0). */
  at: Time.optional(),
  /** Where it stops (default: the end of the cut). */
  until: Time.optional(),
  /** Level under dialogue, dB (default -20); `open` is its level where nobody speaks (default -12). */
  level: z.number().min(-60).max(6).optional(),
  open: z.number().min(-60).max(6).optional(),
  /** Duck under dialogue (default true). */
  duck: z.boolean().optional(),
  /** "backtime": choose the in point so the track's own ending lands on the end of the cut (default when the track is long enough); "fade": fade out; "cut": hard out. */
  ending: z.enum(['backtime', 'fade', 'cut']).optional(),
  in: Time.optional(),
  fadeIn: Time.optional(),
  fadeOut: Time.optional(),
  track: z.number().int().min(3).max(15).optional(),
}).strict();

export const MontageSchema = z.object({
  /** The track the montage is cut to. */
  music: z.string(),
  /** Picture sources, used in order and cycled; each shot takes the next stretch of its source. */
  clips: z.array(z.string()).min(1),
  /** Cut every N beats, or on every bar (default "bar"). */
  cut: z.union([z.literal('beat'), z.literal('bar'), z.number().int().min(1).max(32)]).optional(),
  /** Montage length (default 30 s); it ends on the track's own ending, starting on the downbeat that fits. */
  length: Time.optional(),
  /** Music level, dB (default 0). */
  level: z.number().min(-60).max(6).optional(),
}).strict();

export const PlanSchema = z.object({
  name: z.string().min(1),
  /** Sequence rate (default: the first segment's media rate). */
  fps: z.union([z.number(), z.string()]).optional(),
  /** Frame size or aspect (default: the first segment's media size). */
  size: z.union([z.tuple([z.number().int(), z.number().int()]), z.enum(['16:9', '9:16', '1:1', '4:5'])]).optional(),
  media: z.record(z.string(), z.string()).optional(),
  segments: z.array(SegmentSchema).optional(),
  /** A music-driven montage: picture cut to the beats/bars of a track (instead of dialogue segments). */
  montage: MontageSchema.optional(),
  broll: z.array(BrollSchema).optional(),
  titles: z.array(TitleSchema).optional(),
  music: z.array(MusicSchema).optional(),
  /** Default tightening for every segment (segments may override or set false). */
  tighten: z.union([TightenSchema, z.literal(false)]).optional(),
  /** Cover jump cuts left by tightening: alternate punch-ins (default), or leave them for B-roll ("none"). */
  jumpCuts: z.enum(['punch-in', 'none']).optional(),
  /** Grade per media alias, or "*" for every A-roll clip. */
  grade: z.record(z.string(), GradeSchema).optional(),
  /** Segment markers with ids and beats (default true). */
  markers: z.boolean().optional(),
  /** Captions from the transcript as a caption track (default false). */
  captions: z.union([z.boolean(), z.object({ maxChars: z.number().int().min(10).max(80).optional(), maxLines: z.number().int().min(1).max(3).optional() })]).optional(),
}).strict().superRefine((p, ctx) => {
  if (!p.segments?.length && !p.montage) ctx.addIssue({ code: 'custom', message: 'give segments (dialogue) or a montage' });
  if (p.segments?.length && p.montage) ctx.addIssue({ code: 'custom', message: 'a plan is either dialogue segments or a montage; build the montage as its own cut' });
});

export type Plan = z.infer<typeof PlanSchema>;
export type Segment = z.infer<typeof SegmentSchema>;
export type Broll = z.infer<typeof BrollSchema>;
export type Title = z.infer<typeof TitleSchema>;
export type Music = z.infer<typeof MusicSchema>;
export type Tighten = z.infer<typeof TightenSchema>;
export type Montage = z.infer<typeof MontageSchema>;

export function parsePlan(input: unknown): Plan {
  const r = PlanSchema.safeParse(input);
  if (!r.success) throw new Error('edit plan is invalid:\n' + r.error.issues.map((i) => `  ${i.path.join('.') || '(plan)'}: ${i.message}`).join('\n'));
  return r.data;
}
