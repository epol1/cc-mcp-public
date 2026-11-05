// Captions (K3): subtitles from an SRT/VTT/word-JSON file, inline cues or an inline word list, as native text.
// One Text layer per cue (not one layer with keyed Source Text): a designer fixes a typo by double-clicking the
// cue in the timeline, retimes a cue by dragging its layer, and lint and the motion preview see every cue as its
// own text. Lines are re-flowed at build time (balanced breaks, src/text) to fit the title-safe area (or, on
// vertical frames, the zone free of platform UI), and the cues sit bottom-centre through a <SafeArea>/<Align>
// layout solved with AE's real metrics. One "aec Captions" rig effect on a controller null holds the look: text
// and highlight colors, pop scale, fade, karaoke sync, box color/opacity/padding. With word timing, a karaoke
// highlight: a per-word animator whose selector reads the cue's word start times and lights the current word
// (or every word spoken so far); an optional underline follows the current word, measured in AE (./measure.ts).
// Reading speed is checked with readingIssues (warnings, or an error with reading: 'error').
import path from 'node:path';
import { Fragment, jsx } from '../jsx-runtime.ts';
import type { AecElement } from '../jsx-runtime.ts';
import { Effect, Fill, Null, Rect, RigEffect, Shape, Text } from '../primitives.ts';
import { Align, SafeArea } from '../layout.ts';
import { expr, perWord } from '../anim.ts';
import type { ControlRef } from '../control.ts';
import type { ColorSpec, Time } from '@cc-mcp/core/units.ts';
import { dslWarn } from '../warn.ts';
import { captionsFromWords, distributeWordTimes, loadCaptions, parseCaptions, readingIssues, reflow } from '@cc-mcp/core/text/captions.ts';
import type { Caption, CaptionFormat, CaptionWord, ReadingIssue, ReadingOptions } from '@cc-mcp/core/text/captions.ts';
import type { PseudoEffectDef, PseudoParam } from '../../compile/ffx/pseudo.ts';
import { SOURCE_TEXT, amountPath, animatorPath, colorParam, compFrame, fxOf, hexOf, secs, slider, textMeasure } from './common.ts';
import type { Frame } from './common.ts';
import { boundsCode, measureHelpers } from './measure.ts';
import type { MeasureOptions } from './measure.ts';

export type CaptionStyle = 'clean' | 'boxed' | 'karaoke' | 'boldPop';

export interface CaptionCueInput {
  start: Time;
  end: Time;
  text: string;
  /** Word timing (absolute, like start/end) for karaoke; estimated from characters when omitted. */
  words?: { text: string; start: Time; end: Time }[];
}

export interface KaraokeOptions {
  /** 'current' lights only the word being spoken (default for boldPop); 'past' every word spoken so far. */
  mode?: 'current' | 'past';
  /** Highlight color (default the style's). Live: "Highlight". */
  color?: ColorSpec | ControlRef;
  /** Scale of the current word, % ('current' mode; default boldPop 112, else 100). Live: "Pop Scale". */
  scale?: number;
  /** A bar under the current word, measured in AE (adds 3 hidden measuring layers + 1 shape layer). */
  underline?: boolean | { thickness?: number };
  /** Highlight fade-in per word (default 0.06 s). Live: "Ramp". */
  ramp?: Time;
  /** Shift the highlight earlier (+) or later (−) against the word times (default 0). Live: "Sync Offset". */
  sync?: Time;
}

export interface CaptionBox { color?: ColorSpec | ControlRef; opacity?: number; padding?: [number, number]; roundness?: number }

export interface CaptionsProps {
  /** Unique id: cues are `<id>.cue1…`, boxes `<id>.box1…`, the controller `<id>.ctl`. */
  id: string;
  /** Controller layer name and cue-name prefix (default "Captions"; cues "Caption 01"…). Unique per comp. */
  name?: string;
  /** Caption file (.srt, .vtt, .json word timing; relative to the scene file) or SRT/VTT text itself. */
  src?: string;
  format?: CaptionFormat;
  /** Inline cues (seconds or time strings). */
  cues?: CaptionCueInput[];
  /** Inline timed words (Whisper-style); grouped into cues by pauses, sentences and line fit. */
  words?: { text: string; start: number; end: number; speaker?: string }[];
  /** Look preset (default 'clean'). Any prop below overrides it. */
  style?: CaptionStyle;
  font?: string;
  size?: number;
  /** Text color (live: "Text Color"; brand tokens link). */
  color?: ColorSpec | ControlRef;
  tracking?: number;
  uppercase?: boolean;
  stroke?: ColorSpec;
  strokeWidth?: number;
  /** Drop shadow under the text (default on for clean, karaoke and boldPop). */
  shadow?: boolean;
  /** Backing box per cue (default on for boxed). */
  box?: boolean | CaptionBox;
  /** Karaoke highlight from word times (default on for karaoke and boldPop). */
  karaoke?: boolean | KaraokeOptions;
  /** Lines per cue (default 2); longer cues are split. */
  maxLines?: number;
  /** Line width px (default: the caption area's width × 0.92). */
  maxWidth?: number;
  /** Comp size [w, h] the captions are for (default: the comp being built, else 1920×1080). */
  frame?: [number, number];
  /** 'vertical' keeps captions out of the platform UI (top 250, right 120, bottom 400, left 60 px at 1080×1920). Default: from the frame. */
  platform?: 'landscape' | 'vertical';
  /** Extra space under the captions px (default 0). */
  lift?: number;
  /** Fade in/out of a cue next to a gap (default 0.12 s; back-to-back cues cut). Live: "Fade". */
  fade?: Time;
  /** Shift every cue by this much (s). */
  offset?: Time;
  /** Reading-speed check: warn (default), error (throw) or off. */
  reading?: 'warn' | 'error' | 'off';
  readingOptions?: ReadingOptions;
  /**
   * A caption template for Premiere (export_mogrt): one caption spanning the comp (the first cue is the placeholder)
   * whose text and word start times are Essential Graphics fields, "Caption" and "Word Times" (seconds from the
   * caption's start, space-separated). The text keeps its bottom centre in the caption area as it is retyped.
   * pr-cut places one per caption with `captions: { mogrt }`.
   */
  template?: boolean;
}

interface StyleSpec {
  font: string; size: number; vsize: number; color: string; shadow?: boolean; uppercase?: boolean; stroke?: string; strokeWidth?: number;
  box?: CaptionBox; karaoke?: { mode: 'current' | 'past'; color: string; scale: number }; maxLines?: number;
}

/** Look presets (sizes at 1920×1080, `vsize` on vertical frames; SKILL.md §6.7). */
export const captionStyles: Record<CaptionStyle, StyleSpec> = {
  clean: { font: 'Inter-SemiBold', size: 54, vsize: 52, color: '#ffffff', shadow: true },
  boxed: { font: 'Inter-Medium', size: 50, vsize: 48, color: '#ffffff', box: { color: '#000000', opacity: 72, padding: [22, 12], roundness: 10 } },
  karaoke: { font: 'Inter-Bold', size: 58, vsize: 56, color: '#ffffff', shadow: true, karaoke: { mode: 'past', color: '#ffd23f', scale: 100 } },
  boldPop: { font: 'Inter-Black', size: 72, vsize: 68, color: '#ffffff', uppercase: true, stroke: '#000000', strokeWidth: 10, shadow: true, karaoke: { mode: 'current', color: '#ffd23f', scale: 112 }, maxLines: 2 },
};

export interface CaptionPlan {
  cues: Caption[];
  issues: ReadingIssue[];
  /** Line width the cues were broken to (px). */
  maxWidth: number;
  /** SafeArea insets [t, r, b, l] px, or 'title'. */
  area: 'title' | [number, number, number, number];
  frame: Frame;
  /** Some word times were estimated from characters (no word timing in the source). */
  estimated: boolean;
  font: string;
  size: number;
}

function captionArea(frame: Frame, platform: CaptionsProps['platform'], lift = 0): { area: CaptionPlan['area']; width: number } {
  const vertical = platform ? platform === 'vertical' : frame.vertical;
  let ins: [number, number, number, number];
  if (vertical) {
    const sx = frame.w / 1080, sy = frame.h / 1920;
    ins = [250 * sy, 120 * sx, 400 * sy, 60 * sx];
  } else ins = [frame.h * 0.1, frame.w * 0.1, frame.h * 0.1, frame.w * 0.1];
  const width = frame.w - ins[1] - ins[3];
  if (!vertical && !lift) return { area: 'title', width };
  ins[2] += lift;
  return { area: ins, width };
}

function styleOf(p: CaptionsProps): StyleSpec {
  const s = captionStyles[p.style ?? 'clean'];
  if (!s) throw new Error(`Captions "${p.id}": unknown style "${p.style}" (styles: ${Object.keys(captionStyles).join(', ')})`);
  return s;
}

const fps30 = (t: Time, fps: number) => secs(t, 0, fps);

function cuesFrom(p: CaptionsProps, frame: Frame, breakOpts: any): Caption[] {
  const sources = [p.src !== undefined, p.cues !== undefined, p.words !== undefined].filter(Boolean).length;
  if (sources !== 1) throw new Error(`Captions "${p.id}": give exactly one of src (file or SRT/VTT text), cues or words`);
  if (p.src !== undefined) {
    if (/-->/.test(p.src) || /^\s*[[{]/.test(p.src)) return parseCaptions(p.src, p.format);
    const dir = (globalThis as any).__AEC_SCENE_DIR__ ?? process.cwd();
    return loadCaptions(path.isAbsolute(p.src) ? p.src : path.resolve(dir, p.src));
  }
  if (p.words !== undefined) {
    const ws: CaptionWord[] = p.words.map((w) => ({ text: w.text, start: w.start, end: w.end, speaker: w.speaker }));
    return captionsFromWords(ws, breakOpts);
  }
  return p.cues!.map((c, i) => {
    const start = fps30(c.start, frame.fps), end = fps30(c.end, frame.fps);
    if (!(end > start)) throw new Error(`Captions "${p.id}": cue ${i + 1} ("${c.text}") ends before it starts`);
    const text = c.text.replace(/\s+/g, ' ').trim();
    const cap: Caption = { index: i + 1, start, end, text, lines: [text], words: [], wordsTimed: !!c.words };
    cap.words = c.words ? c.words.map((w) => ({ text: w.text, start: fps30(w.start, frame.fps), end: fps30(w.end, frame.fps) })) : distributeWordTimes(cap);
    return cap;
  }).sort((a, b) => a.start - b.start).map((c, i) => ({ ...c, index: i + 1 }));
}

/**
 * The cues as they will be built: parsed, re-flowed to the caption area, shifted, with reading issues. Pure (no
 * AE); use it to preview line breaks or to check reading speed before building.
 */
export function captionPlan(p: CaptionsProps): CaptionPlan {
  const frame = compFrame(p.frame);
  const st = styleOf(p);
  const font = p.font ?? st.font;
  const size = p.size ?? (frame.vertical ? st.vsize : st.size);
  const upper = p.uppercase ?? st.uppercase ?? false;
  const { area, width } = captionArea(frame, p.platform, p.lift);
  const maxWidth = p.maxWidth ?? Math.round(width * 0.92);
  const maxLines = p.maxLines ?? st.maxLines ?? 2;
  const opts = { maxWidth, measure: textMeasure({ font, size, tracking: p.tracking, caps: upper }), maxLines };
  let cues = reflow(cuesFrom(p, frame, opts), opts);
  const off = secs(p.offset, 0, frame.fps);
  if (off) cues = cues.map((c) => ({ ...c, start: c.start + off, end: c.end + off, words: c.words.map((w) => ({ ...w, start: w.start + off, end: w.end + off })) }));
  const issues = readingIssues(cues, { fps: frame.fps, ...(p.readingOptions ?? {}) });
  return { cues, issues, maxWidth, area, frame, estimated: cues.some((c) => !c.wordsTimed), font, size };
}

const r3 = (t: number) => Math.round(t * 1000) / 1000;

/** "aec Captions": the controller's rig effect for these options. */
function captionsDef(o: { box: boolean; karaoke: boolean; underline: boolean; color: ColorSpec | ControlRef; hl: ColorSpec | ControlRef; boxColor: ColorSpec | ControlRef; scale: number }): PseudoEffectDef {
  const params: PseudoParam[] = [colorParam('Text Color', o.color), slider('Fade', 0.12, 0, 2, 2)];
  if (o.karaoke) params.push(colorParam('Highlight', o.hl), slider('Pop Scale', o.scale, 50, 250, 1), slider('Ramp', 0.06, 0, 1, 2), slider('Sync Offset', 0, -2, 2, 2));
  if (o.underline) params.push(slider('Underline', 8, 0, 60, 1));
  if (o.box) params.push(colorParam('Box Color', o.boxColor), slider('Box Opacity', 72, 0, 100, 0), slider('Box Pad X', 22, 0, 200, 1), slider('Box Pad Y', 12, 0, 200, 1), slider('Box Roundness', 10, 0, 200, 1));
  return { name: 'aec Captions', params };
}

/**
 * <Captions id="subs" src="talk.srt" style="karaoke" />: one native text layer per cue, bottom-centre in the safe
 * area, with fades, an optional backing box and a karaoke highlight driven by word times. Put it at the top level
 * of the composition (or in a <Sequence>), not inside a layout container.
 */
export function Captions(p: CaptionsProps) {
  if (!p.id) throw new Error('Captions: an id is required');
  const plan = captionPlan(p);
  const { cues, frame } = plan;
  if (!cues.length) throw new Error(`Captions "${p.id}": no cues`);
  const st = styleOf(p);
  const mode = p.reading ?? 'warn';
  if (plan.issues.length && mode !== 'off') {
    const msgs = plan.issues.map((i) => `cue ${i.index} (${i.t[0].toFixed(2)}–${i.t[1].toFixed(2)} s) ${i.rule}: ${i.message}`);
    if (mode === 'error') throw new Error(`Captions "${p.id}" reading issues:\n${msgs.join('\n')}`);
    for (const m of msgs) dslWarn(`Captions "${p.id}": ${m}`);
  }
  const kOpt: KaraokeOptions | null = p.karaoke === false ? null : p.karaoke === true ? {} : p.karaoke ?? (st.karaoke ? {} : null);
  const karaoke = !!kOpt;
  const kMode = kOpt?.mode ?? st.karaoke?.mode ?? 'past';
  const kScale = kMode === 'current' ? kOpt?.scale ?? st.karaoke?.scale ?? 100 : 100;
  const hl = kOpt?.color ?? st.karaoke?.color ?? '#ffd23f';
  const tpl = !!p.template;
  if (tpl && cues.length > 1) dslWarn(`Captions "${p.id}": a template builds one caption (the first cue as placeholder); Premiere fills each caption's text and word times`);
  if (tpl && kOpt?.underline) dslWarn(`Captions "${p.id}": the karaoke underline isn't available in a template`);
  const underline = !!kOpt?.underline && !tpl;
  if (karaoke && plan.estimated && !tpl) dslWarn(`Captions "${p.id}": karaoke word times are estimated from characters (the source has no word timing); give word JSON, VTT inline timestamps or cues[].words for exact sync`);
  const boxOpt: CaptionBox | null = p.box === false ? null : p.box === true ? {} : p.box ?? st.box ?? null;
  const color = p.color ?? st.color;
  const shadow = p.shadow ?? st.shadow ?? false;
  const upper = p.uppercase ?? st.uppercase ?? false;
  const base = p.name ?? 'Captions';
  const cueBase = p.name ?? 'Caption';
  const ctlId = `${p.id}.ctl`;
  const C = fxOf('Captions', ctlId);
  const def = captionsDef({ box: !!boxOpt, karaoke, underline, color, hl, boxColor: boxOpt?.color ?? '#000000', scale: kScale });
  const values: Record<string, any> = { 'Text Color': color, Fade: secs(p.fade, 0.12, frame.fps) };
  if (karaoke) Object.assign(values, { Highlight: hl, 'Pop Scale': kScale, Ramp: secs(kOpt?.ramp, 0.06, frame.fps), 'Sync Offset': secs(kOpt?.sync, 0, frame.fps) });
  if (underline) values.Underline = typeof kOpt?.underline === 'object' ? kOpt.underline.thickness ?? 8 : 8;
  if (boxOpt) Object.assign(values, { 'Box Color': boxOpt.color ?? '#000000', 'Box Opacity': boxOpt.opacity ?? 72, 'Box Pad X': boxOpt.padding?.[0] ?? 22, 'Box Pad Y': boxOpt.padding?.[1] ?? 12, 'Box Roundness': boxOpt.roundness ?? 10 });
  const ctl = jsx(Null, { id: ctlId, name: base, tags: ['controls'], children: jsx(RigEffect, { def, name: 'Captions', values }) });

  const nn = (i: number) => String(i + 1).padStart(cues.length >= 100 ? 3 : 2, '0');
  const cueId = (i: number) => `${p.id}.cue${i + 1}`;
  const cueName = (i: number) => `${cueBase} ${nn(i)}`;
  const gap = 2 / frame.fps;
  const texts: AecElement[] = [];
  const boxes: AecElement[] = [];
  const wordStarts: number[][] = [];
  // A template's caption spans the comp; Premiere trims each instance, so it cuts in and out (no fades). Its text is
  // retyped in Premiere, so instead of the build-time layout it keeps its bottom centre at the caption area's bottom
  // centre (live anchor from the text's bounds).
  const span = (c: Caption) => (tpl ? { from: 0 } : { from: c.start, duration: c.end - c.start });
  const ins = plan.area === 'title' ? [frame.h * 0.1, frame.w * 0.1, frame.h * 0.1, frame.w * 0.1] : plan.area;
  const tplAt = [Math.round(ins[3] + (frame.w - ins[1] - ins[3]) / 2), Math.round(frame.h - ins[2])];
  const TPL_ANCHOR = '// ae-compose caption template: bottom centre of the text, so a longer caption grows upward\nvar r = sourceRectAtTime(time, false);\n[r.left + r.width / 2, r.top + r.height];';
  (tpl ? cues.slice(0, 1) : cues).forEach((c, i) => {
    const prev = cues[i - 1], next = cues[i + 1];
    const fin = !tpl && (!prev || c.start - prev.end > gap) ? 1 : 0;
    const fout = !tpl && (!next || next.start - c.end > gap) ? 1 : 0;
    const ws = c.words.map((w) => r3(Math.max(0, w.start - c.start)));
    wordStarts.push(ws);
    const ex: Record<string, string> = {
      [SOURCE_TEXT]: `// ae-compose captions: text color from the Captions effect (edit the text freely)\nvar c = ${C}("Text Color").value; style.setFillColor([c[0], c[1], c[2]]);`,
    };
    if (tpl) ex['ADBE Transform Group/ADBE Anchor Point'] = TPL_ANCHOR;
    let animate: any;
    if (karaoke) {
      const from: any = { fill: hexOf(hl) };
      if (kScale !== 100) from.scale = kScale;
      animate = { text: perWord({ name: 'Karaoke', from, each: 0, duration: 0.1 }) };
      ex[amountPath('Karaoke')] = [
        `// ae-compose karaoke (${kMode} word): word starts in s from this caption's in point; look and sync in the Captions effect`,
        tpl
          ? `var e = ${C}, W = [], WT = String(__AEC_LAYER(${p.id}.times)__.text.sourceText).split(/[\\s,]+/);\nfor (var q0 = 0; q0 < WT.length; q0++) { var v0 = parseFloat(WT[q0]); if (!isNaN(v0)) W.push(v0); }`
          : `var e = ${C}, W = [${ws.join(', ')}];`,
        'var t = time - inPoint + e("Sync Offset").value, r = Math.max(e("Ramp").value, 0.001), i = textIndex - 1, n = W.length;',
        'if (textTotal !== n) { W = []; for (var q = 0; q < textTotal; q++) W.push(q * (outPoint - inPoint) / Math.max(textTotal, 1)); n = textTotal; }',
        'var a = L.smooth(0, 1, (t - W[i]) / r);',
        ...(kMode === 'current' ? ['if (i + 1 < n) a -= L.smooth(0, 1, (t - W[i + 1]) / r);'] : []),
        'a *= 100;',
        '[a, a, a];',
      ].join('\n');
      ex[animatorPath('Karaoke', 'ADBE Text Animator Properties/ADBE Text Fill Color')] = `${C}("Highlight").value;`;
      if (kScale !== 100) ex[animatorPath('Karaoke', 'ADBE Text Animator Properties/ADBE Text Scale 3D')] = `var s = ${C}("Pop Scale").value; [s, s, 100];`;
    }
    texts.push(jsx(Text, {
      id: cueId(i),
      name: cueName(i),
      text: c.lines.join('\r'),
      font: plan.font,
      size: plan.size,
      color: hexOf(color),
      tracking: p.tracking,
      caps: upper ? 'all' : undefined,
      stroke: p.stroke ?? st.stroke,
      strokeWidth: p.strokeWidth ?? st.strokeWidth,
      align: 'center',
      ...span(c),
      ...(tpl ? { eg: 'Caption', x: tplAt[0], y: tplAt[1] } : {}),
      tags: ['caption'],
      opacity: expr(`// ae-compose captions: fades next to gaps (Fade in the Captions effect); back-to-back cues cut\nvar f = Math.max(${C}("Fade").value, 0.001);\n100 * Math.min(${fin ? 'L.clamp((time - inPoint) / f, 0, 1)' : '1'}, ${fout ? 'L.clamp((outPoint - time) / f, 0, 1)' : '1'});`),
      animate,
      expressions: ex,
      effects: shadow ? [jsx(Effect, { name: 'Drop Shadow', params: { Opacity: 150, Direction: 180, Distance: Math.max(2, Math.round(plan.size / 18)), Softness: Math.round(plan.size / 4) } })] : undefined,
    }));
    if (boxOpt) {
      const r = `var T = __AEC_LAYER(${cueId(i)})__, r = T.sourceRectAtTime(T.inPoint, false), e = ${C};`;
      boxes.push(jsx(Shape, {
        id: `${p.id}.box${i + 1}`,
        name: `${cueName(i)} Box`,
        space: 'comp',
        parent: cueId(i),
        ...span(c),
        tags: ['caption'],
        opacity: expr(`__AEC_LAYER(${cueId(i)})__.transform.opacity.value;`),
        children: [
          jsx(Rect, {
            name: 'Box',
            size: expr(`// ae-compose captions: box around the cue (padding in the Captions effect)\n${r}\n[r.width + 2 * e("Box Pad X").value, r.height + 2 * e("Box Pad Y").value];`),
            position: expr(`${r}\n[r.left + r.width / 2, r.top + r.height / 2];`),
            roundness: expr(`${C}("Box Roundness").value;`),
          }),
          jsx(Fill, { color: expr(`${C}("Box Color").value;`), opacity: expr(`${C}("Box Opacity").value;`) }),
        ],
      }));
    }
  });

  const out: AecElement[] = [ctl, ...boxes];
  if (underline) {
    const t0 = Math.min(...cues.map((c) => c.start)), t1 = Math.max(...cues.map((c) => c.end));
    const pick = [
      `var NM = ${JSON.stringify(cues.map((_c, i) => cueName(i)))}, WS = ${JSON.stringify(wordStarts)}, T = null, ci = -1, kk = 0;`,
      'for (var pq = 0; pq < NM.length; pq++) { var cl = thisComp.layer(NM[pq]); if (time >= cl.inPoint && time < cl.outPoint) { T = cl; ci = pq; } }',
      `if (T) { var tt = time - T.inPoint + ${C}("Sync Offset").value, WW = WS[ci]; for (var pw = 0; pw < WW.length; pw++) if (tt >= WW[pw]) kk = pw; }`,
    ];
    const m: MeasureOptions = { id: `${p.id}.uline`, name: `${base} Underline`, style: { font: plan.font, size: plan.size, tracking: p.tracking, caps: upper ? 'all' : undefined }, align: 'center', pick, sample: cues[0].text, from: t0, duration: t1 - t0 };
    const head = [`// ae-compose karaoke underline: follows the current word of the active caption (measured live)`, ...pick, ...boundsCode(m), `var th = ${C}("Underline").value, y = base + fs * 0.16 + th / 2;`, 'var a = T ? T.toComp([x0, y]) : [0, 0], b = T ? T.toComp([x1, y]) : [0, 0];'];
    out.push(...measureHelpers(m), jsx(Shape, {
      id: `${p.id}.uline`,
      name: `${base} Underline`,
      space: 'comp',
      from: t0,
      duration: t1 - t0,
      tags: ['caption'],
      opacity: expr([...pick, 'T ? T.transform.opacity.value : 0;'].join('\n')),
      children: [
        jsx(Rect, { name: 'Underline', size: expr([...head, '[T ? Math.abs(b[0] - a[0]) : 0, T ? th : 0];'].join('\n')), position: expr([...head, '[(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];'].join('\n')), roundness: 4 }),
        jsx(Fill, { color: expr(`${C}("Highlight").value;`) }),
      ],
    }));
  }
  if (tpl) {
    // The word start times as an editable field, read by the karaoke selector (a hidden layer: never rendered).
    out.push(...texts, jsx(Text, { id: `${p.id}.times`, name: 'Word Times', text: wordStarts[0].join(' '), font: plan.font, size: 24, hidden: true, eg: 'Word Times', tags: ['caption'] }));
  } else out.push(jsx(SafeArea, { kind: plan.area, children: jsx(Align, { at: 'bottom', children: texts }) }));
  return jsx(Fragment, { children: out });
}
(Captions as any).displayName = 'Captions';
