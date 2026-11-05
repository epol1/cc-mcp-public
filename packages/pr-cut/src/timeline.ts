// The resolved timeline pr-cut writes into Premiere: every clip with exact source ticks and sequence frames.
// Edit plans (plan/schema.ts) compile to this; the FCP7 writer (xml/fcp7.ts) and the inspector speak it.
import type { MediaInfo } from '@ae-mcp/core/media/probe.ts';
import type { Rate } from '@ae-mcp/core/time/timecode.ts';

export interface Grade {
  exposure?: number; contrast?: number; highlights?: number; shadows?: number; whites?: number; blacks?: number;
  temperature?: number; tint?: number; saturation?: number; vibrance?: number; fadedFilm?: number; sharpen?: number;
}

export interface TLClip {
  /** pr-cut id: "seg3" for a segment, "seg3.2" for its second piece after tightening, "b1" B-roll, "m1" music. */
  id: string;
  /** Key into Timeline.media. */
  media: string;
  /** Picture from another file with the same source timing (a keyed cutout, dual-system sound); `media` is the sound. */
  videoMedia?: string;
  /** Alpha interpretation of the picture as Premiere had it ('straight' for a cutout with transparency). */
  alpha?: string;
  /** 1-based video track, or undefined for audio-only use. */
  vTrack?: number;
  /** 1-based first audio track (stereo takes this and the next), or undefined for picture only. */
  aTrack?: number;
  /** Sequence frames, end exclusive. */
  start: number;
  end: number;
  /** Source range in Premiere ticks (exact), end exclusive. */
  inTicks: number;
  outTicks: number;
  /** Split edit (J/L cut): the picture's own edges when they differ from the sound's (sequence frames, source ticks). */
  video?: { start: number; end: number; inTicks: number; outTicks: number };
  /** Clip gain, dB (0 = unchanged). */
  level?: number;
  /** Level keyframes at sequence frames, dB (ducking, fades). */
  levelKeys?: { frame: number; db: number }[];
  /** Basic Motion: scale % and center offset as a fraction of the frame (punch-ins, reframing). */
  motion?: { scale?: number; center?: [number, number] };
  grade?: Grade;
  /** Transition into this clip from the previous clip on the same track (centered on the cut). */
  transitionIn?: { kind: 'dissolve' | 'dip-black' | 'dip-white' | 'audio-crossfade'; frames: number };
  /** Fade from/to black or silence at the clip's own head or tail (no neighbour involved). */
  fadeIn?: { kind: 'dissolve' | 'dip-black' | 'dip-white' | 'audio-crossfade'; frames: number };
  fadeOut?: { kind: 'dissolve' | 'dip-black' | 'dip-white' | 'audio-crossfade'; frames: number };
  /** Source audio channels to use (1-based); default [1, 2] for stereo sources, [1] for mono. */
  channels?: number[];
  label?: 'Iris' | 'Violet' | 'Caribbean' | 'Lavender' | 'Cerulean' | 'Forest' | 'Rose' | 'Mango' | 'Purple' | 'Blue' | 'Teal' | 'Magenta' | 'Tan' | 'Green' | 'Brown' | 'Yellow';
  name?: string;
  disabled?: boolean;
  /**
   * Adopted from Premiere's XML: filter blocks carried verbatim (patched in place when grade/motion/level are set),
   * and for graphics the whole clipitem (re-timed only).
   */
  raw?: { video?: string[]; audio?: string[]; item?: string };
}

export interface TLMarker { frame: number; duration?: number; name: string; comment?: string; color?: number }

export interface Timeline {
  name: string;
  rate: Rate;
  width: number;
  height: number;
  sampleRate?: number;
  media: Record<string, MediaInfo>;
  clips: TLClip[];
  markers: TLMarker[];
  /** Video tracks to create even when empty: titles are placed on them after the import (importMGT on a missing track lands on V1). */
  minVideoTracks?: number;
}

/** A clip's framing scale: its own motion, else the Basic Motion filter carried from Premiere, else 100 %. */
export function motionScale(c: TLClip): number {
  if (c.motion?.scale !== undefined) return c.motion.scale;
  const f = c.raw?.video?.find((x) => /<effectid>basic<\/effectid>/.test(x));
  const m = f && /<parameterid>scale<\/parameterid>[\s\S]*?<value>([\d.]+)<\/value>/.exec(f);
  return m ? Number(m[1]) : 100;
}

export const timelineEnd =(t: Timeline) => t.clips.reduce((m, c) => Math.max(m, c.end, c.video?.end ?? 0), 0);
