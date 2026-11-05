// Plan → scene .tsx (pure): a readable, buildable scaffold. A <Series> of named beats (scene markers, ripple
// targets), the beat lengths and overlaps as constants at the top, placeholder elements per beat (headline and
// sublines with per-word reveals and exits anchored to the beat's end, a placeholder card for each visual, an end
// card), each beat's purpose as a comment, transitions as small native placeholder components named by kind
// (TODO: swap for the K4 transitions library), and live controls for the key timings.
import { TIMING, transitionDur } from './timing.ts';
import type { BrandInfo } from './brand.ts';
import type { BeatSheet, PlanBeat, PlanElement, PlanTimeline } from './types.ts';

export interface ScaffoldInput {
  sheet: BeatSheet;
  tl: PlanTimeline;
  /** Brand tokens and the import specifier to reach the brand file from the scene. */
  brand?: { info: BrandInfo; spec: string };
  /** src for the end card logo (<Svg>), when it resolved to a file. */
  logoSrc?: string;
  /** src for a music track (<Audio> + beatsOf + <BeatMarkers>). */
  musicSrc?: string;
}

const LINE_SEPS = new RegExp('[' + String.fromCharCode(0x2028, 0x2029) + ']', 'g');
/** A JS string literal (single quotes). */
export const lit = (s: string) => `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\r\n|\r|\n/g, '\\r').replace(LINE_SEPS, ' ')}'`;
/** A JSX attribute: "plain" when safe, {'escaped'} otherwise. */
const attr = (s: string) => (/^[\w .,:!?()+#/@%-]*$/.test(s) ? `"${s}"` : `{${lit(s)}}`);
/** Text for inside a comment. */
const cm = (s: string) => s.replace(/\*\//g, '* /').replace(/\s*[\r\n]+\s*/g, ' ').trim();
const num = (x: number) => String(Math.round(x * 1000) / 1000);
const s1 = (x: number) => `${(Math.round(x * 10) / 10).toFixed(1)} s`;

const PALETTE = { bg: '#0b0d12', fg: '#eef1f6', muted: '#8b95a5', accent: '#4683c4' };
const FONTS = { display: 'Inter-Black', body: 'Inter-Medium', bold: 'Inter-Bold' };

/** Native placeholder components by transition kind. Each covers or carries across the cut at `at` (comp seconds). */
const TRANSITIONS: Record<string, { fn: string; uses: string[]; code: string }> = {
  'shape-wipe': {
    fn: 'ShapeWipe', uses: ['Shape', 'Rect', 'Fill', 'keys'], code: `/**
 * shape-wipe (placeholder). TODO(K4): wipe with a shape that is already on screen in the outgoing beat (its card or
 * accent bar), matting the next beat to it; swap for the transitions library (src/dsl/transitions) when it lands.
 * Now: an accent band sweeps left to right and covers the cut at \`at\`.
 */
function ShapeWipe({ at, color }: { at: number; color: any }) {
  return (
    <Shape name={\`Shape Wipe \${at.toFixed(2)}s\`} tags={['transition:shape-wipe']} rotation={-12} from={at - 0.45} duration={0.9}
      animate={{ x: keys({ t: 0, v: -W * 0.75, easing: 'easeInCubic' }, { t: 0.42, v: W / 2, hold: true }, { t: 0.48, v: W / 2, easing: 'easeOutCubic' }, { t: 0.9, v: W * 1.75 }) }}>
      <Rect size={[W * 1.3, Math.hypot(W, H) * 1.2]} />
      <Fill color={color} />
    </Shape>
  );
}` },
  'hand-off': {
    fn: 'HandOff', uses: ['Shape', 'Rect', 'Fill', 'keys'], code: `/**
 * hand-off (placeholder). TODO(K4): carry one element of the outgoing beat into the incoming one as ONE layer across
 * the boundary (the underline becomes the next divider, the card becomes the next background).
 * Now: an accent line stretches out and back across the cut at \`at\`.
 */
function HandOff({ at, color }: { at: number; color: any }) {
  return (
    <Shape name={\`Hand-off \${at.toFixed(2)}s\`} tags={['transition:hand-off']} y={H * 0.74} from={at - 0.5} duration={1}
      animate={{ scale: keys({ t: 0, v: [0, 100], easing: 'easeOutExpo' }, { t: 0.45, v: [100, 100], easing: 'easeInOutCubic' }, { t: 1, v: [0, 100] }) }}>
      <Rect size={[W * 0.5, 8]} roundness={4} />
      <Fill color={color} />
    </Shape>
  );
}` },
  'match-cut': {
    fn: 'MatchCut', uses: ['Shape', 'Ellipse', 'Stroke', 'keys'], code: `/**
 * match-cut (placeholder). TODO(K4): cut on a shape both beats share (same position, size and motion), so the eye
 * stays on it across the cut. Now: a ring that holds its place across the cut at \`at\`.
 */
function MatchCut({ at, color }: { at: number; color: any }) {
  return (
    <Shape name={\`Match Cut \${at.toFixed(2)}s\`} tags={['transition:match-cut']} from={at - 0.3} duration={0.6}
      animate={{ scale: keys({ t: 0, v: 80, easing: 'easeOutCubic' }, { t: 0.6, v: 110 }), opacity: keys({ t: 0, v: 0, easing: 'easeOutCubic' }, { t: 0.15, v: 100, hold: true }, { t: 0.45, v: 100, easing: 'easeInCubic' }, { t: 0.6, v: 0 }) }}>
      <Ellipse size={[H * 0.5, H * 0.5]} />
      <Stroke color={color} width={8} />
    </Shape>
  );
}` },
  'zoom-through': {
    fn: 'ZoomThrough', uses: ['Shape', 'Ellipse', 'Fill', 'keys'], code: `/**
 * zoom-through (placeholder). TODO(K4): push into an element of the outgoing beat until it fills the frame, and come
 * out of the zoom in the next beat (scale + blur). Now: an accent disc grows to cover the cut at \`at\`, then opens.
 */
function ZoomThrough({ at, color }: { at: number; color: any }) {
  const d = Math.hypot(W, H) * 1.05;
  return (
    <Shape name={\`Zoom Through \${at.toFixed(2)}s\`} tags={['transition:zoom-through']} from={at - 0.4} duration={0.8}
      animate={{ scale: keys({ t: 0, v: 0, easing: 'easeInCubic' }, { t: 0.4, v: 100, easing: 'easeOutCubic' }, { t: 0.8, v: 160 }), opacity: keys({ t: 0.4, v: 100, easing: 'easeOutCubic' }, { t: 0.8, v: 0 }) }}>
      <Ellipse size={[d, d]} />
      <Fill color={color} />
    </Shape>
  );
}` },
  'push-through': {
    fn: 'PushThrough', uses: ['Shape', 'Rect', 'Stroke', 'keys'], code: `/**
 * push-through (placeholder). TODO(K4): move the camera through an element of the outgoing beat (a 3D layer, or a
 * scale through a precomp) into the next one. Now: a frame flies past the camera across the cut at \`at\`.
 */
function PushThrough({ at, color }: { at: number; color: any }) {
  return (
    <Shape name={\`Push Through \${at.toFixed(2)}s\`} tags={['transition:push-through']} from={at - 0.4} duration={0.8}
      animate={{ scale: keys({ t: 0, v: 100, easing: 'easeInCubic' }, { t: 0.8, v: 1400 }), opacity: keys({ t: 0, v: 0, easing: 'easeOutCubic' }, { t: 0.15, v: 100, hold: true }, { t: 0.55, v: 100, easing: 'easeInCubic' }, { t: 0.8, v: 0 }) }}>
      <Rect size={[W * 0.25, H * 0.25]} roundness={24} />
      <Stroke color={color} width={10} />
    </Shape>
  );
}` },
  'parallax-split': {
    fn: 'ParallaxSplit', uses: ['Shape', 'Rect', 'Fill', 'keys'], code: `/**
 * parallax-split (placeholder). TODO(K4): split the outgoing beat's layers apart in depth (foreground faster than
 * background) to reveal the next beat. Now: two bands slide in from opposite sides, cover the cut at \`at\`, slide on.
 */
function ParallaxSplit({ at, color }: { at: number; color: any }) {
  return (
    <>
      {[0, 1].map((i) => (
        <Shape name={\`Parallax Split \${at.toFixed(2)}s \${i + 1}\`} tags={['transition:parallax-split']} y={H * (0.25 + 0.5 * i)} from={at - 0.45} duration={0.9}
          animate={{ x: keys({ t: 0, v: i ? W * 1.6 : -W * 0.6, easing: 'easeInCubic' }, { t: 0.42, v: W / 2, hold: true }, { t: 0.48, v: W / 2, easing: 'easeOutCubic' }, { t: 0.9, v: i ? -W * 0.6 : W * 1.6 }) }}>
          <Rect size={[W * 1.2, H / 2 + 2]} />
          <Fill color={color} />
        </Shape>
      ))}
    </>
  );
}` },
  'liquid-wipe': {
    fn: 'LiquidWipe', uses: ['Shape', 'Ellipse', 'Fill', 'keys'], code: `/**
 * liquid-wipe (placeholder). TODO(K4): a blob from the outgoing beat's palette floods the frame and drains into the
 * next beat (morphing path). Now: a disc grows from the bottom-left corner, covers the cut at \`at\`, drains top-right.
 */
function LiquidWipe({ at, color }: { at: number; color: any }) {
  const d = Math.hypot(W, H) * 1.1;
  return (
    <Shape name={\`Liquid Wipe \${at.toFixed(2)}s\`} tags={['transition:liquid-wipe']} from={at - 0.45} duration={0.9}
      animate={{ position: keys({ t: 0, v: [0, H], easing: 'easeInOutCubic' }, { t: 0.42, v: [W / 2, H / 2], hold: true }, { t: 0.48, v: [W / 2, H / 2], easing: 'easeInOutCubic' }, { t: 0.9, v: [W, 0] }),
        scale: keys({ t: 0, v: 0, easing: 'easeOutCubic' }, { t: 0.42, v: 100, hold: true }, { t: 0.48, v: 100, easing: 'easeInCubic' }, { t: 0.9, v: 0 }) }}>
      <Ellipse size={[d, d]} />
      <Fill color={color} />
    </Shape>
  );
}` },
  'slice-wipe': {
    fn: 'SliceWipe', uses: ['Shape', 'Rect', 'Fill', 'keys'], code: `/**
 * slice-wipe (placeholder). TODO(K4): slices cut from the outgoing frame (07 pack). Now: six slices grow top-down
 * with a stagger, cover the cut at \`at\`, and retract.
 */
function SliceWipe({ at, color }: { at: number; color: any }) {
  const n = 6, sw = W / n;
  return (
    <>
      {Array.from({ length: n }, (_, i) => (
        <Shape name={\`Slice Wipe \${at.toFixed(2)}s \${i + 1}\`} tags={['transition:slice-wipe']} position={[sw * i + sw / 2, 0]} anchor={[0, 0]} from={at - 0.4} duration={0.8}
          animate={{ scale: keys({ t: i * 0.025, v: [100, 0], easing: 'easeInCubic' }, { t: 0.4, v: [100, 100], hold: true }, { t: 0.43 + i * 0.02, v: [100, 100], easing: 'easeOutCubic' }, { t: 0.8, v: [100, 0] }) }}>
          <Rect size={[sw + 2, H]} position={[0, H / 2]} />
          <Fill color={color} />
        </Shape>
      ))}
    </>
  );
}` },
};
const GENERIC = {
  fn: 'TransitionTodo', uses: ['Shape', 'Rect', 'Fill', 'keys'], code: `/**
 * A transition kind the planner doesn't know (placeholder). TODO: build it from an element of the outgoing beat.
 * Now: an accent band sweeps across and covers the cut at \`at\`.
 */
function TransitionTodo({ at, color, kind }: { at: number; color: any; kind: string }) {
  return (
    <Shape name={\`\${kind} \${at.toFixed(2)}s\`} tags={[\`transition:\${kind}\`]} rotation={12} from={at - 0.45} duration={0.9}
      animate={{ x: keys({ t: 0, v: W * 1.75, easing: 'easeInCubic' }, { t: 0.42, v: W / 2, hold: true }, { t: 0.48, v: W / 2, easing: 'easeOutCubic' }, { t: 0.9, v: -W * 0.75 }) }}>
      <Rect size={[W * 1.3, Math.hypot(W, H) * 1.2]} />
      <Fill color={color} />
    </Shape>
  );
}` };

export function scaffold(input: ScaffoldInput): string {
  const { sheet, tl } = input;
  const used = new Set<string>(['scene', 'Composition', 'Series', 'Solid']);
  const use = (...n: string[]) => n.forEach((x) => used.add(x));
  const ctl = new Set<string>();
  const B = input.brand;
  const R = B?.info.roles ?? {};
  const bn = B?.info.exportName ?? 'BRAND';
  const beats = tl.beats;
  const T = TIMING;

  // ---- constants
  const consts: string[] = [];
  consts.push(`const W = ${tl.width}, H = ${tl.height}, FPS = ${tl.fps};`);
  const color = (role: 'bg' | 'fg' | 'muted') => (R[role] ? `${bn}.value(${lit(R[role]!)})` : lit(PALETTE[role]));
  consts.push(`const INK = ${color('bg')}, WHITE = ${color('fg')}, MUTED = ${color('muted')};`);
  const font = (role: 'display' | 'body' | 'bold') => (R[role] ? `${bn}.fonts.${R[role]}` : lit(FONTS[role]));
  consts.push(`const DISPLAY = ${font('display')}, BODY = ${font('body')}, BOLD = ${font('bold')};`);
  consts.push('', `/** Beat lengths (s). Need more time? Lengthen the beat (or ripple its scene in AE); don't speed the animation up. */`);
  consts.push(`const T = { ${beats.map((b) => `${b.key}: ${num(b.duration)}`).join(', ')} };`);
  const later = beats.slice(1);
  if (later.length) {
    consts.push(`/** Overlap with the previous beat (s): the transition plays across it (0.2–0.4 s; 0 for a hard cut). */`);
    consts.push(`const O = { ${later.map((b) => `${b.key}: ${num(b.overlap)}`).join(', ')} };`);
  }
  consts.push(`const f = (s: number) => Math.round(s * FPS) / FPS;`);
  consts.push(`/** Beat start times (s), from T and O. */`);
  consts.push(`const AT = { ${beats.map((b) => `${b.key}: 0`).join(', ')} };`);
  beats.forEach((b, i) => { if (i) consts.push(`AT.${b.key} = f(AT.${beats[i - 1].key} + T.${beats[i - 1].key} - O.${b.key});`); });
  consts.push(`const TOTAL = f(AT.${beats[beats.length - 1].key} + T.${beats[beats.length - 1].key});`);
  const anyExit = beats.some((b) => b.exits);
  if (anyExit) consts.push(`/** Exits start this long before their beat ends (text exits read the Exit Lead control live; visuals use this value). */`, `const EXIT = ${num(tl.exitLead)};`);

  // ---- body
  const body: string[] = [];
  const ind = (n: number) => ' '.repeat(n);
  const push = (n: number, s: string) => body.push(s.split('\n').map((l) => ind(n) + l).join('\n'));

  const titleTag = (b: PlanBeat, e: PlanElement, left: boolean, n: number) => {
    use('Text', 'perWord'); ctl.add('titleDelay'); ctl.add('stagger');
    const visualLead = b.layout === 'text+visual';
    const delay = visualLead ? `plus(titleDelay, ${num(T.visualLead)})` : 'titleDelay';
    if (visualLead) use('plus');
    const from = Math.max(30, Math.round((e.size ?? 100) * 0.6));
    const reveal = `perWord({ from: { y: ${from}, opacity: 0 }, easing: 'easeOutExpo', duration: '${T.titleUnit}s', each: stagger, delay: ${delay} })`;
    const exit = `perWord({ from: { y: -40, opacity: 0 }, easing: 'easeInCubic', duration: '${T.titleExitUnit}s', each: '${Math.round(T.titleExitEach * 1000)}ms', delay: exitLead, anchor: 'end', direction: 'out' })`;
    if (b.exits) ctl.add('exitLead');
    const anim = b.exits ? `[\n  ${reveal},\n  ${exit},\n]` : reveal;
    push(n, `<Text id=${attr(e.id)} name=${attr(`${b.name} Title`)} font={DISPLAY} size={${e.size}}${e.tracking ? ` tracking={${e.tracking}}` : ''} color={WHITE}${left ? ' align="left" anchor="left"' : ''}\n  animate={{ text: ${anim.replace(/\n/g, '\n  ')} }}>\n  {${lit(e.layout ?? e.text ?? '')}}\n</Text>`);
  };
  const subTag = (b: PlanBeat, e: PlanElement, left: boolean, n: number) => {
    use('Text', 'perWord', 'plus'); ctl.add('titleDelay');
    const off = e.arrive[0] - b.start - T.titleDelay;
    const reveal = `perWord({ from: { y: 30, opacity: 0 }, easing: 'easeOutCubic', duration: '${T.subUnit}s', each: '${Math.round(T.subEach * 1000)}ms', delay: plus(titleDelay, ${num(off)}) })`;
    const exit = `perWord({ from: { opacity: 0 }, easing: 'easeInCubic', duration: '${T.subExitUnit}s', each: '${Math.round(T.subExitEach * 1000)}ms', delay: exitLead, anchor: 'end', direction: 'out' })`;
    if (b.exits) ctl.add('exitLead');
    const anim = b.exits ? `[\n  ${reveal},\n  ${exit},\n]` : reveal;
    push(n, `<Text id=${attr(e.id)} name=${attr(`${b.name} ${e.id.endsWith('sub') ? 'Sub' : 'Line ' + e.id.replace(/.*-sub/, '')}`)} font={BODY} size={${e.size}} color={MUTED}${left ? ' align="left" anchor="left"' : ''}\n  animate={{ text: ${anim.replace(/\n/g, '\n  ')} }}>\n  {${lit(e.layout ?? e.text ?? '')}}\n</Text>`);
  };
  const visualTag = (b: PlanBeat, e: PlanElement, n: number) => {
    use('Shape', 'Rect', 'Stroke', 'Fill', 'spring'); ctl.add('accent');
    const d0 = T.titleDelay;
    let op: string;
    if (b.exits) { use('keys'); op = `keys({ t: ${d0}, v: 0, easing: 'easeOutCubic' }, { t: ${num(d0 + 0.3)}, v: 100, hold: true }, { t: T.${b.key} - EXIT, v: 100, easing: 'easeInCubic' }, { t: T.${b.key} - EXIT + ${T.visualExit}, v: 0 })`; }
    else { use('tween'); op = `tween({ from: 0, to: 100, duration: 0.3, delay: ${d0}, easing: 'easeOutCubic' })`; }
    push(n, `{/* TODO visual: ${cm(e.text ?? '')}. Replace this placeholder card with the real element (Svg, Footage, Model, Cloner, a chart...), keeping its arrive → hold → leave timing. */}`);
    push(n, `<Shape id=${attr(e.id)} name=${attr(`${b.name} Visual (placeholder)`)}\n  animate={{ y: spring({ from: 60, delay: ${d0}, damping: 16, stiffness: 150 }), opacity: ${op} }}>\n  <Rect size={[${e.box[0]}, ${e.box[1]}]} roundness={${Math.round(Math.min(e.box[0], e.box[1]) * 0.06)}} />\n  <Stroke color={accent} width={4} />\n  <Fill color={accent} opacity={12} />\n</Shape>`);
  };
  const logoTag = (e: PlanElement, n: number) => {
    const d0 = T.titleDelay;
    if (input.logoSrc) {
      use('Svg', 'tween');
      push(n, `<Svg id="end-logo" name="Logo" src={${lit(input.logoSrc)}} width={${e.box[0]}} color={WHITE} stroke={{ color: WHITE, width: 2 }}\n  draw={tween({ from: 0, to: 100, duration: 0.9, delay: ${d0}, easing: 'easeInOutCubic' })}\n  fillOpacity={tween({ from: 0, to: 100, duration: 0.45, delay: ${num(d0 + 0.75)}, easing: 'easeOutCubic' })} />`);
    } else {
      use('Shape', 'Ellipse', 'Stroke', 'spring'); ctl.add('accent');
      const d = e.box[0];
      push(n, `{/* TODO logo: replace this mark with the brand logo, e.g. <Svg src="logo.svg" width={${Math.round(tl.width * 0.29)}} draw={tween({ from: 0, to: 100, duration: 0.9, delay: ${d0} })} /> (end.logo in the beat sheet). */}`);
      push(n, `<Shape id="end-logo" name="Logo (placeholder)" animate={{ scale: spring({ from: 0, delay: ${d0}, damping: 14, stiffness: 160 }) }}>\n  <Ellipse size={[${d}, ${d}]} />\n  <Stroke color={accent} width={${Math.max(4, Math.round(d / 14))}} />\n</Shape>`);
    }
  };
  const ctaTag = (b: PlanBeat, e: PlanElement, n: number) => {
    use('Text', 'perWord');
    push(n, `<Text id="end-cta" name="End CTA" font={BOLD} size={${e.size}} tracking={${e.tracking ?? 0}} color={WHITE}\n  animate={{ text: perWord({ from: { y: 24, opacity: 0 }, easing: 'easeOutCubic', duration: '${T.ctaUnit}s', each: '${Math.round(T.ctaEach * 1000)}ms', delay: ${num(e.arrive[0] - b.start)} }) }}>\n  {${lit(e.layout ?? e.text ?? '')}}\n</Text>`);
  };

  const sheetBeat = (b: PlanBeat) => sheet.beats.find((x) => x.name === b.name);
  const vertical = tl.height > tl.width * 1.15;
  beats.forEach((b, i) => {
    const titles = b.elements.filter((e) => e.role === 'title' || e.role === 'sub');
    const vis = b.elements.find((e) => e.role === 'visual');
    const title = titles.find((e) => e.role === 'title');
    const head = `${i + 1} · ${b.name} (${s1(b.start)}–${s1(b.end)}${b.transitionIn ? `, in: ${b.transitionIn}${b.overlap ? ` over ${s1(b.overlap)}` : ''}` : ''})`;
    const lines = [head, `Purpose: ${cm(b.endCard ? 'payoff: the logo and the call to action, held still' : sheetBeat(b)?.purpose || 'TODO: what does the viewer learn or feel here?')}`];
    const timing = b.elements.filter((e) => e.role !== 'visual').map((e) => `${e.role} lands ${s1(e.arrive[1])}, readable ${s1(e.readable[0])}–${s1(e.readable[1])}${e.role !== 'logo' ? ` (needs ${s1(e.needs)})` : ''}`);
    if (timing.length) lines.push(`Timing: ${timing.join('; ')}${b.exits ? `; exits from ${s1(b.end - tl.exitLead)}` : b.final ? '; holds to the end' : '; holds to the beat end'}.`);
    if (sheetBeat(b)?.holdTo === 'end' && !b.final) lines.push('Holds to its end (no exit): the element that carries over should continue into the next beat.');
    push(8, `{/* ${lines.join('\n   ')} */}`);
    const offset = i ? ` offset={-O.${b.key}}` : '';
    push(8, `<Series.Sequence name=${attr(b.name)} duration={T.${b.key}}${offset}>`);
    const wrapV = (fn: (n: number) => void) => (vertical ? (n: number) => { use('SafeArea'); push(n, '<SafeArea kind="title">'); fn(n + 2); push(n, '</SafeArea>'); } : fn);
    if (b.layout === 'end') {
      const logo = b.elements.find((e) => e.role === 'logo')!;
      const cta = b.elements.find((e) => e.role === 'cta');
      wrapV((n) => {
        if (cta) { use('Column'); push(n, `<Column gap={${Math.round(tl.height * 0.04)}}>`); logoTag(logo, n + 2); ctaTag(b, cta, n + 2); push(n, '</Column>'); }
        else logoTag(logo, n);
      })(10);
    } else if (b.layout === 'empty') {
      push(10, `{/* TODO: this beat has no text or visual yet. */}`);
    } else if (b.layout === 'visual') {
      wrapV((n) => visualTag(b, vis!, n))(10);
    } else {
      const gap = title ? Math.round((title.size ?? 100) * 0.24) : 24;
      const row = b.layout === 'text+visual' && !vertical && tl.width > tl.height * 1.15;
      wrapV((n) => {
        if (row) {
          use('Row', 'Column');
          push(n, `<Row gap={${Math.round(tl.width * 0.047)}}>`);
          visualTag(b, vis!, n + 2);
          push(n + 2, `<Column gap={${gap}} align="start">`);
          for (const e of titles) (e.role === 'title' ? titleTag : subTag)(b, e, true, n + 4);
          push(n + 2, '</Column>');
          push(n, '</Row>');
        } else {
          const kids = (vis ? 1 : 0) + titles.length;
          if (kids > 1) { use('Column'); push(n, `<Column gap={${gap}}>`); }
          const m = kids > 1 ? n + 2 : n;
          if (vis) visualTag(b, vis, m);
          for (const e of titles) (e.role === 'title' ? titleTag : subTag)(b, e, false, m);
          if (kids > 1) push(n, '</Column>');
        }
      })(10);
    }
    push(8, '</Series.Sequence>');
  });

  // ---- transitions
  const trans: string[] = [];
  const defs = new Map<string, string>();
  for (const x of tl.transitions) {
    const to = beats.find((b) => b.name === x.to)!;
    const at = `AT.${to.key} + O.${to.key} / 2`;
    if (x.kind === 'cut') { trans.push(`{/* cut into "${cm(x.to)}" at ${s1(x.at)}: a hard cut on the beat. */}`); continue; }
    const def = TRANSITIONS[x.kind] ?? GENERIC;
    use(...def.uses); ctl.add('accent');
    defs.set(def.fn, def.code);
    trans.push(`{/* ${x.kind}: "${cm(x.from)}" → "${cm(x.to)}" at ${s1(x.at)} (${s1(transitionDur(x.kind))}). */}`);
    trans.push(def === GENERIC ? `<TransitionTodo at={${at}} color={accent} kind=${attr(x.kind)} />` : `<${def.fn} at={${at}} color={accent} />`);
  }

  // ---- music
  const music: string[] = [];
  if (input.musicSrc) {
    use('Audio', 'BeatMarkers', 'beatsOf');
    music.push(`{/* Music: the beat grid is written as comp markers. TODO: snap the beat boundaries to it, e.g. T.<beat> = BEATS.bars(2) or AT.<beat> = BEATS.snap(AT.<beat>). */}`);
    music.push(`<Audio id="music" src={${lit(input.musicSrc)}} />`);
    music.push(`<BeatMarkers beats={BEATS} every="bar" />`);
  }

  // ---- controls
  const controls: string[] = [];
  if (ctl.has('accent')) {
    if (B && R.accent) controls.push(`const accent = ${bn}.colors.${R.accent};${B.info.live.includes(R.accent) ? ` // live "${R.accent[0].toUpperCase() + R.accent.slice(1)} Color" control (brand)` : ''}`);
    else { use('control'); controls.push(`const accent = control('Accent Color', ${lit(PALETTE.accent)});`); }
  }
  if (ctl.has('titleDelay')) { use('control'); controls.push(`const titleDelay = control('Title Delay', ${T.titleDelay}, { min: 0, max: 1.5 });`); }
  if (ctl.has('stagger')) { use('control'); controls.push(`const stagger = control('Word Stagger', ${T.titleEach}, { min: 0, max: 0.3 });`); }
  if (ctl.has('exitLead')) { use('control'); controls.push(`const exitLead = control('Exit Lead', EXIT, { min: 0.2, max: 2 });`); }
  const ctlNames = [ctl.has('accent') ? (B && R.accent ? `${R.accent[0].toUpperCase() + R.accent.slice(1)} Color` : 'Accent Color') : '', ctl.has('titleDelay') ? 'Title Delay' : '', ctl.has('stagger') ? 'Word Stagger' : '', ctl.has('exitLead') ? 'Exit Lead' : ''].filter(Boolean);

  // ---- assemble
  const order = ['scene', 'Composition', 'Series', 'Solid', 'Shape', 'Rect', 'Ellipse', 'Fill', 'Stroke', 'Text', 'Svg', 'Audio', 'BeatMarkers', 'Column', 'Row', 'SafeArea', 'keys', 'spring', 'tween', 'perWord', 'control', 'plus', 'beatsOf'];
  const imports = order.filter((n) => used.has(n));
  const story = beats.map((b) => `${b.name} ${s1(b.duration)}${b.transitionIn ? ` (${b.transitionIn})` : ''}`).join(' → ');
  const out: string[] = [];
  out.push(`// ${cm(tl.name)}: scaffolded by plan_scene from a beat sheet. Replace the TODO placeholders with the real elements`);
  out.push(`// and keep the timing; then build_scene and look at the contact sheet.`);
  out.push(`// Message: ${cm(sheet.message)}`);
  out.push(`// Story: ${cm(story)}. ${s1(tl.duration)} at ${tl.width}×${tl.height}, ${tl.fps} fps.`);
  out.push(`// Each beat is a named scene (a ripple target in AE).${ctlNames.length ? ` Live controls: ${ctlNames.join(', ')}.` : ''}`);
  out.push(`import { ${imports.join(', ')} } from 'ae-compose';`);
  if (B) out.push(`import { ${bn} } from ${lit(B.spec)};`);
  out.push('');
  out.push(...consts);
  if (input.musicSrc) out.push(`const BEATS = beatsOf(${lit(input.musicSrc)});`);
  for (const code of defs.values()) out.push('', code);
  out.push('');
  out.push(`export default scene({ name: ${lit(tl.name)}, width: W, height: H, fps: FPS, duration: TOTAL, bg: INK }, () => {`);
  for (const c of controls) out.push(`  ${c}`);
  out.push('  return (', '    <Composition>', `      <Solid id="bg" name="BG" color={INK} tags={['bg']} />`);
  for (const m of music) out.push(`      ${m}`);
  out.push('      <Series>', ...body, '      </Series>');
  if (trans.length) out.push(`      {/* Transitions across the beat boundaries (the middle of each overlap). */}`, ...trans.map((t) => `      ${t}`));
  out.push('    </Composition>', '  );', '});', '');
  return out.join('\n');
}
