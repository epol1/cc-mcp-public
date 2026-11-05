// Storyboard-first planning (Phase 5 A3, docs/TOOLKIT.md §6): the beat sheet an agent writes before any TSX, the
// timeline the planner derives from it (when every element arrives, holds and leaves) and the plan issues (the
// direction rules of skills/ae-compose/SKILL.md §2 and §6 checked on the plan). Pure data.

/** Transition kinds the planner knows (the K4 transitions library names). Other strings are allowed and flagged. */
export const TRANSITION_KINDS = ['hand-off', 'match-cut', 'shape-wipe', 'zoom-through', 'push-through', 'parallax-split', 'liquid-wipe', 'slice-wipe', 'grid-wipe', 'light-leak', 'cut'] as const;
export type KnownTransition = (typeof TRANSITION_KINDS)[number];
export type TransitionKind = KnownTransition | (string & {});
/** Kinds that cut on the boundary: no overlap, and the outgoing beat needs no exit animation. */
export const HARD_CUTS: readonly string[] = ['cut', 'match-cut'];

export interface Beat {
  /** Scene name (a named Sequence: comp marker and ripple target). Unique. */
  name: string;
  /** What the viewer learns or feels in this beat. A beat without one should be cut. */
  purpose: string;
  /** Beat length in seconds (its Series.Sequence duration, including the overlap with the previous beat). */
  duration: number;
  /** The beat's copy: a headline, or [headline, subline, ...]. */
  text?: string | string[];
  /** What the beat shows besides text ("product turns", "bars grow"): becomes a placeholder card. */
  visual?: string;
  /** How this beat comes in from the previous one. */
  transitionIn?: TransitionKind;
  /** Overlap with the previous beat in seconds (default: the sheet's overlap, 0.3; 0 for 'cut' and 'match-cut'). */
  overlap?: number;
  /** Requested hold (s) once the beat's copy has landed; checked against the duration and the reading time. */
  hold?: number;
  /** 'end': the beat's elements stay until the beat ends (no exit), e.g. for a hand-off. */
  holdTo?: 'end';
}

export interface EndCard {
  /** CTA or closing line. */
  text?: string;
  /** Path to a logo SVG (relative to opts.cwd); a placeholder mark when absent or missing. */
  logo?: string;
  /** Final hold after everything has landed, seconds (default 2.5; at least 2). */
  hold?: number;
  transitionIn?: TransitionKind;
  overlap?: number;
}

export interface BeatSheet {
  /** Scene / comp name. */
  name: string;
  /** The one message of the piece. */
  message: string;
  /** Canvas shorthand (the reframe targets): '16:9' (1920×1080, default), '9:16' (1080×1920), '1:1', '4:5'. width/height win. */
  format?: '16:9' | '9:16' | '1:1' | '4:5';
  width?: number;
  height?: number;
  fps?: number;
  /** Path to a brand.ts (relative to opts.cwd) whose tokens the scaffold uses. */
  brand?: string;
  /** Default overlap between beats in seconds (0.3). */
  overlap?: number;
  /** Path to a music track (relative to opts.cwd): the scaffold places it and writes its beat grid as markers. */
  music?: string;
  beats: Beat[];
  end?: EndCard;
}

export type PlanRule =
  | 'purpose' | 'empty-beat' | 'duplicate-beat' | 'hook' | 'reading-time' | 'hold' | 'final-hold' | 'transition-repeat'
  | 'transition-kind' | 'overlap' | 'one-idea' | 'slide-furniture' | 'pacing' | 'long-text' | 'missing-file'
  // synthesized from the planned timing with the style lint (src/motion/style.ts)
  | 'dead-air' | 'crowded-entrance' | 'short-hold' | 'everything-moves';

export interface PlanIssue {
  rule: PlanRule;
  severity: 'warn' | 'info';
  message: string;
  /** Beat name the issue is about. */
  beat?: string;
  /** Comp time range, seconds. */
  t?: [number, number];
}

export type ElementRole = 'title' | 'sub' | 'visual' | 'logo' | 'cta';

/** One planned element. Times are comp seconds. */
export interface PlanElement {
  id: string;
  role: ElementRole;
  text?: string;
  /** The text as laid out (lines joined with \r), font size and tracking. */
  layout?: string;
  size?: number;
  tracking?: number;
  words?: number;
  /** Width and height estimate in px (for synthesized motion and layout). */
  box: [number, number];
  /** Arrival: first unit starts moving → last unit has landed. */
  arrive: [number, number];
  /** Exit: starts → gone, or null when the element holds to the beat's end. */
  leave: [number, number] | null;
  /** Still and readable: landed → exit starts (or the next beat covers it). */
  readable: [number, number];
  /** Reading time it needs (texts), or the minimum hold (visuals), seconds. */
  needs: number;
}

export interface PlanBeat {
  name: string;
  /** Identifier used in the scaffold (T.<key>, AT.<key>) and as the id prefix. */
  key: string;
  purpose: string;
  /** Comp seconds. */
  start: number;
  end: number;
  duration: number;
  /** Overlap with the previous beat, seconds. */
  overlap: number;
  transitionIn?: string;
  /** Elements animate out before the beat ends (false: hold to the end, or a hard cut follows). */
  exits: boolean;
  /** The last beat (its end state is the piece's final hold). */
  final: boolean;
  /** The end card from sheet.end. */
  endCard?: boolean;
  /** Title starts after the visual (visual leads). */
  layout: 'text' | 'visual' | 'text+visual' | 'end' | 'empty';
  elements: PlanElement[];
}

export interface PlanTimeline {
  name: string;
  width: number;
  height: number;
  fps: number;
  /** Total length, seconds. */
  duration: number;
  /** Shared timing the scaffold exposes as controls: exits start this long before a beat ends, title delay, word stagger. */
  exitLead: number;
  titleDelay: number;
  stagger: number;
  beats: PlanBeat[];
  /** Transitions at the beat boundaries: `at` is the middle of the overlap (the cut), comp seconds. */
  transitions: { kind: string; at: number; dur: number; from: string; to: string; overlap: number }[];
}

export interface PlanOptions {
  /** Write the scaffold here (.tsx). Relative brand/logo paths are written relative to it. */
  file?: string;
  /** Base for relative brand/logo paths in the sheet (default process.cwd()). */
  cwd?: string;
  /** Overwrite an existing file (default false). */
  overwrite?: boolean;
}

export interface PlanResult {
  tsx: string;
  file?: string;
  issues: PlanIssue[];
  timeline: PlanTimeline;
}
