// MCP wiring for plan_scene (registered in src/mcp/server.ts): the zod input shape, the description and a handler
// that plans, scaffolds, compiles the scaffold (no After Effects) and returns an agent-readable report.
import path from 'node:path';
import { z } from 'zod';
import { formatPlan, planScene, verifyScaffold } from './index.ts';
import type { BeatSheet } from './types.ts';
import { TRANSITION_KINDS } from './types.ts';

export const PLAN_SCENE_DESCRIPTION = 'Storyboard first: give a beat sheet (the one message, then beats with purpose, duration, text, visual, transitionIn) and get the plan checked against the direction rules before writing any TSX (reading time per text vs. the beat length, a final hold of at least 2 s, the same transition twice in a row, no hook in the first second, beats without a purpose, overlaps outside 0.2–0.4 s, slide furniture, crowded entrances, dead air) plus a buildable scene scaffold: a <Series> of named beats (scene markers), headline/subline texts with per-word reveals and exits anchored to each beat\'s end, a placeholder card per visual, an end card, transitions as placeholder components named by kind, and live controls (Title Delay, Word Stagger, Exit Lead, Accent Color). Fix the warnings in the beat sheet and re-plan, then replace the TODO placeholders and build_scene the file.';

const beat = z.object({
  name: z.string().describe('scene name (a named Sequence: marker and ripple target); unique'),
  purpose: z.string().describe('what the viewer learns or feels in this beat'),
  duration: z.number().positive().describe('beat length in seconds, including the overlap with the previous beat'),
  text: z.union([z.string(), z.array(z.string())]).optional().describe('the copy: a headline, or [headline, subline]'),
  visual: z.string().optional().describe('what the beat shows besides text; becomes a placeholder card'),
  transitionIn: z.string().optional().describe(`how this beat comes in: ${TRANSITION_KINDS.join(' | ')} (others become a generic placeholder)`),
  overlap: z.number().optional().describe('overlap with the previous beat in seconds (default 0.3; 0 for cut/match-cut)'),
  hold: z.number().min(0).optional().describe('requested hold once the copy has landed, seconds'),
  holdTo: z.literal('end').optional().describe('elements stay to the beat end (no exit), e.g. for a hand-off'),
});

export const planSceneInput = {
  name: z.string().describe('scene / comp name'),
  message: z.string().describe('the one message of the piece'),
  width: z.number().int().positive().optional().describe('default 1920'),
  height: z.number().int().positive().optional().describe('default 1080 (1920 for vertical 9:16, 1080 for 1:1)'),
  fps: z.number().positive().optional().describe('default 30'),
  brand: z.string().optional().describe('path to a brand.ts whose tokens the scaffold uses (e.g. examples/brand.ts)'),
  music: z.string().optional().describe('path to a music track: the scaffold places it and writes its beat grid as markers'),
  overlap: z.number().optional().describe('default overlap between beats, seconds (0.3)'),
  beats: z.array(beat).min(1),
  end: z.object({
    text: z.string().optional().describe('CTA or closing line'),
    logo: z.string().optional().describe('path to a logo .svg (draws on); a placeholder mark otherwise'),
    hold: z.number().min(0).optional().describe('final hold after everything lands, seconds (default 2.5, at least 2)'),
    transitionIn: z.string().optional(),
    overlap: z.number().optional(),
  }).optional().describe('an end card after the beats (logo + CTA)'),
  file: z.string().optional().describe('write the scaffold here (.tsx); without it the TSX is returned inline'),
  cwd: z.string().optional().describe('base for relative brand/logo/music/file paths (default: the server cwd)'),
  overwrite: z.boolean().optional().describe('replace an existing file'),
};

type Args = { [K in keyof typeof planSceneInput]?: any } & { name: string; message: string; beats: any[] };

/** Handler for plan_scene: returns the report text (and the TSX inline when no file was given). */
export async function planSceneTool(a: Args): Promise<string> {
  const { file, cwd, overwrite, ...sheet } = a;
  const base = cwd ?? process.cwd();
  const out = file ? path.resolve(base, file) : undefined;
  const r = planScene(sheet as BeatSheet, { file: out, cwd: base, overwrite });
  const check = await verifyScaffold(out ? { file: out } : { source: r.tsx, cwd: base });
  const lines = formatPlan(r, check);
  if (out) lines.push(`scaffold: ${out}`, 'next: fix the plan warnings (re-plan with overwrite: true), replace the TODO placeholders, then build_scene { file } and look at the contact sheet.');
  else lines.push('scaffold (pass `file` to write it):', '```tsx', r.tsx, '```');
  return lines.join('\n');
}
