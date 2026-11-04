// Agent-level edit ops (zod-validated) → runtime ops. Times are comp seconds. Friendly property names:
// position, x, y, z, scale, rotation, rotationX, rotationY, opacity, anchor; otherwise an AE path
// ("ADBE Transform Group/ADBE Position", "Effects/Glow/Glow Radius", "Contents/Card/Contents/Fill 1/Color").
import { z } from 'zod';
import { resolveEasing } from '../shared/easing.ts';
import { parseColor, parseTime } from '../shared/units.ts';
import { parseSvgPath } from '../shared/svgpath.ts';
import { resolveEffect } from '../catalog/resolve.ts';
import { curveKnots, knotsToKeys } from '../compile/keys.ts';
import { callRuntime } from '../bridge/index.ts';
import { sampleScreenColor } from '../visual/keycolor.ts';
import type { ScreenSample } from '../visual/keycolor.ts';
import os from 'node:os';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const toHex = (c: number[]) => '#' + c.map((x) => Math.round(x * 255).toString(16).padStart(2, '0')).join('');

/** Samples the key color from a project item (middle frame) or a file on disk (images directly, videos via ffmpeg). */
async function sampleSource(item?: string | number, file?: string): Promise<ScreenSample | null> {
  const dir = path.join(os.tmpdir(), 'ae-compose', 'key-' + Date.now());
  if (file) {
    if (/\.(png|jpe?g|tiff?|webp|bmp)$/i.test(file)) return sampleScreenColor(file);
    fs.mkdirSync(dir, { recursive: true });
    const out = path.join(dir, 'frame.png');
    const dur = parseFloat(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', file], { encoding: 'utf8' })) || 0;
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-ss', String(dur / 2), '-i', file, '-frames:v', '1', out]);
    return sampleScreenColor(out);
  }
  const r = await callRuntime('previewItem', [item, 1, dir.replace(/\\/g, '/'), null], { timeoutMs: 120_000, cancelDialogs: true });
  if (!r.ok) throw new Error(r.error);
  const f = r.frames.find((x: any) => x.ok);
  return f ? sampleScreenColor(f.file) : null;
}

/** Samples the key color from the layer's source frame (not the comp, so other layers don't interfere). */
async function sampleLayerScreen(comp: any, layer: any, t?: number): Promise<ScreenSample | null> {
  const dir = path.join(os.tmpdir(), 'ae-compose', 'key-' + Date.now()).replace(/\\/g, '/');
  const r = await callRuntime('layerSourceFrame', [comp ?? null, layer, t ?? null, dir], { timeoutMs: 120_000 });
  if (!r.ok) throw new Error(r.error);
  const f = r.frames.find((x: any) => x.ok);
  return f ? sampleScreenColor(f.file) : null;
}

const TG = 'ADBE Transform Group';
export const PROP_ALIASES: Record<string, string> = {
  position: `${TG}/ADBE Position`, x: `${TG}/ADBE Position_0`, y: `${TG}/ADBE Position_1`, z: `${TG}/ADBE Position_2`,
  scale: `${TG}/ADBE Scale`, rotation: `${TG}/ADBE Rotate Z`, rotationX: `${TG}/ADBE Rotate X`, rotationY: `${TG}/ADBE Rotate Y`,
  orientation: `${TG}/ADBE Orientation`, opacity: `${TG}/ADBE Opacity`, anchor: `${TG}/ADBE Anchor Point`,
  sourceText: 'ADBE Text Properties/ADBE Text Document',
};
const propPath = (p: string) => PROP_ALIASES[p] ?? p.replace(/^Effects\//, 'ADBE Effect Parade/').replace(/^Contents\//, 'ADBE Root Vectors Group/').replace(/^Masks\//, 'ADBE Mask Parade/');

const Layer = z.union([z.string(), z.number().int().positive()]).describe('layer aec id, name, or 1-based index');
const Easing = z.union([z.string(), z.tuple([z.number(), z.number(), z.number(), z.number()])]);
const TimeV = z.union([z.number(), z.string()]).describe('seconds, "1.5s", "12f", "1:02"');
const Key = z.object({ t: z.union([z.number(), z.string()]), v: z.any(), easing: Easing.optional(), hold: z.boolean().optional() });

export const AgentOp = z.discriminatedUnion('op', [
  z.object({ op: z.literal('set'), layer: Layer, prop: z.string(), value: z.any().optional(), keys: z.array(Key).optional(), expr: z.string().optional(), removeExpr: z.boolean().optional() }),
  z.object({ op: z.literal('ease'), layer: Layer, prop: z.string(), easing: Easing, keys: z.array(z.number().int().positive()).optional().describe('1-based key indices; default all') }),
  z.object({ op: z.literal('easeKey'), layer: Layer, prop: z.string(), key: z.number().int().positive(), side: z.enum(['in', 'out', 'both']).default('both'), speed: z.number().optional(), influence: z.number().min(0.1).max(100).optional() }),
  z.object({ op: z.literal('interpolation'), layer: Layer, prop: z.string(), type: z.enum(['linear', 'bezier', 'hold']), keys: z.array(z.number().int().positive()).optional() }),
  z.object({ op: z.literal('retime'), layer: Layer, props: z.array(z.string()).optional().describe('default: every animated transform property'), shift: z.number().optional(), scale: z.number().positive().optional(), pivot: z.number().optional() }),
  z.object({ op: z.literal('layerTiming'), layer: Layer, in: z.number().optional(), out: z.number().optional(), start: z.number().optional(), stretch: z.number().optional() }),
  z.object({ op: z.literal('addEffect'), layer: Layer, effect: z.string(), params: z.record(z.string(), z.any()).optional(), label: z.string().optional(), index: z.number().int().positive().optional() }),
  z.object({ op: z.literal('setEffect'), layer: Layer, effect: z.union([z.string(), z.number().int().positive()]).describe('effect name/label in Effect Controls, or index'), params: z.record(z.string(), z.any()).optional(), enabled: z.boolean().optional() }),
  z.object({ op: z.literal('removeEffect'), layer: Layer, effect: z.union([z.string(), z.number().int().positive()]) }),
  z.object({ op: z.literal('moveEffect'), layer: Layer, effect: z.union([z.string(), z.number().int().positive()]), to: z.number().int().positive() }),
  z.object({ op: z.literal('text'), layer: Layer, text: z.string().optional(), font: z.string().optional(), size: z.number().optional(), color: z.any().optional(), tracking: z.number().optional(), leading: z.union([z.number(), z.literal('auto')]).optional() }),
  z.object({ op: z.literal('path'), layer: Layer, prop: z.string().describe('path property, e.g. "Contents/Logo/Contents/Path 1/Path" or "Masks/Mask 1/Mask Path"'), d: z.string().optional(), points: z.array(z.object({ p: z.tuple([z.number(), z.number()]), in: z.tuple([z.number(), z.number()]).optional(), out: z.tuple([z.number(), z.number()]).optional() })).optional(), closed: z.boolean().optional(), t: z.number().optional().describe('set as a key at this time instead of a static value') }),
  z.object({ op: z.literal('layer'), layer: Layer, set: z.object({ name: z.string().optional(), parent: z.union([z.string(), z.number(), z.null()]).optional(), blend: z.string().optional(), enabled: z.boolean().optional(), threeD: z.boolean().optional(), motionBlur: z.boolean().optional(), shy: z.boolean().optional(), locked: z.boolean().optional(), label: z.number().optional(), index: z.number().int().positive().optional(), matte: z.union([z.object({ layer: z.union([z.string(), z.number()]), type: z.enum(['alpha', 'alphaInverted', 'luma', 'lumaInverted']).default('alpha') }), z.null()]).optional() }) }),
  z.object({ op: z.literal('removeLayer'), layer: Layer }),
  z.object({ op: z.literal('duplicateLayer'), layer: Layer, name: z.string().optional() }),
  z.object({ op: z.literal('addLayer'), spec: z.any().describe('IR layer JSON (see docs/DSL.md "IR")'), index: z.number().int().positive().optional() }),
  z.object({ op: z.literal('comp'), set: z.object({ renderer: z.enum(['advanced3d', 'cinema4d', 'classic3d']).optional(), bg: z.any().optional(), width: z.number().optional(), height: z.number().optional(), duration: z.number().optional(), fps: z.number().optional(), motionBlur: z.boolean().optional(), shutterAngle: z.number().optional(), name: z.string().optional() }) }),
  z.object({ op: z.literal('precompose'), layers: z.array(Layer), name: z.string() }),
  z.object({ op: z.literal('duplicateComp'), name: z.string() }),
  z.object({ op: z.literal('addControls'), layer: Layer, prop: z.string(), delay: z.string().optional().describe('slider name for a live delay'), speed: z.string().optional().describe('slider name for live speed (%)') }),
  z.object({
    op: z.literal('ripple'),
    at: TimeV.optional().describe('insert (by > 0) or remove (by < 0) time starting here'),
    span: z.tuple([TimeV, TimeV]).optional().describe('[start, end] to stretch (scale/duration/by)'),
    scene: z.union([z.string(), z.object({ at: TimeV })]).optional().describe('a scene by name, or { at: "1:02" } for the scene containing that time (scenes = named Sequences / comp markers with a duration)'),
    by: TimeV.optional().describe('seconds to add (negative removes); with a scene: added as hold time at its quietest moment'),
    scale: z.number().positive().optional().describe('stretch the span/scene: 1.25 = 25% slower, 0.8 = faster'),
    duration: TimeV.optional().describe('new length of the span/scene'),
    where: z.union([z.enum(['quiet', 'start', 'end']), TimeV]).optional().describe('with scene + by: where the hold goes (default quiet)'),
    deep: z.boolean().optional().describe('ripple inside precomps that span the edit (default true)'),
  }).describe('Ripple edit: everything after the change shifts (layers, keys, markers, comp length); nothing needs retiming by hand'),
  z.object({
    op: z.literal('place'),
    item: z.union([z.string(), z.number()]).optional().describe('existing project item: name, unique name/file substring, or item id (list_project_items)'),
    file: z.string().optional().describe('or import this file first'),
    name: z.string().optional(),
    below: Layer.optional().describe('put the new layer directly under this layer (e.g. a background behind a keyed subject)'),
    above: Layer.optional(),
    index: z.number().int().positive().optional(),
    start: TimeV.optional().describe('comp time where the clip starts'),
    in: TimeV.optional(), out: TimeV.optional(),
    fit: z.enum(['cover', 'contain', 'fill', 'none', 'width', 'height']).optional().describe('default none (native size, centered)'),
    muted: z.boolean().optional(), loop: z.boolean().optional(),
  }).describe('Add project media (footage, still, comp) or a file to the comp as a layer'),
  z.object({
    op: z.literal('key'),
    layer: Layer,
    color: z.string().optional().describe('"auto" (default: sampled from the footage), "green", "blue" or a hex color'),
    strength: z.enum(['soft', 'normal', 'hard']).optional().describe('matte clipping/choke preset (default normal)'),
    at: TimeV.optional().describe('comp time of the frame to sample (default: middle of the layer)'),
    cleanup: z.boolean().optional().describe('add Key Cleaner for hair / soft edges (default false: it softens solid foregrounds)'),
    spill: z.boolean().optional().describe('add Advanced Spill Suppressor (default true)'),
  }).describe('Chroma key a greenscreen/bluescreen layer: Keylight + Advanced Spill Suppressor (+ Key Cleaner with cleanup: true), all built into AE'),
  z.object({ op: z.literal('raw'), runtime: z.any().describe('a runtime op passed through as-is') }),
]);
export type AgentOp = z.infer<typeof AgentOp>;
export interface EditInput { comp?: string | number; ops: AgentOp[]; /** Comp frame rate if known (skips a lookup). */ fps?: number }

const RENDER = { advanced3d: 'ADBE Calder', cinema4d: 'ADBE Ernst', classic3d: 'ADBE Advanced 3d' }; // D36

function conv(v: any): any {
  if (typeof v === 'string' && /^(#|rgb|hsl)/i.test(v)) return parseColor(v);
  return v;
}

function effectPath(effect: string | number): string {
  if (typeof effect === 'number') return `ADBE Effect Parade/#${effect}`;
  return `ADBE Effect Parade/${effect}`;
}

function paramProps(params: Record<string, any> | undefined): any[] {
  return Object.entries(params ?? {}).map(([k, v]) => (v && typeof v === 'object' && 'layer' in v ? { p: k, v } : { p: k, v: conv(v) }));
}

async function keysFor(comp: any, layer: any, prop: string): Promise<any[]> {
  const j = await callRuntime('inspect', [{ comp }, { detail: 'full', layers: [layer] }], { timeoutMs: 120_000 });
  if (!j.ok || !j.layers.length) throw new Error(`layer ${layer} not found`);
  const path = propPath(prop).split('/');
  let node: any = { c: j.layers[0].props };
  for (const seg of path) {
    node = (node.c ?? []).find((c: any) => c.m === seg || c.n === seg);
    if (!node) throw new Error(`property "${prop}" not found on layer ${layer}`);
  }
  if (!node.keys || node.keys.length < 2) throw new Error(`"${prop}" needs at least 2 keyframes to re-ease`);
  return node.keys;
}

/** Validates agent ops and compiles them to runtime ops (may read keys from AE for non-bezier re-easing). */
export async function compileEditOps(input: EditInput, notes?: string[]): Promise<any[]> {
  const out: any[] = [];
  input.ops.forEach((raw, i) => {
    const r = AgentOp.safeParse(raw);
    if (!r.success) throw new Error(`op #${i + 1} (${(raw as any)?.op}): ${r.error.issues.map((x) => `${x.path.join('.')}: ${x.message}`).join('; ')}`);
  });
  // The comp's frame rate (for "12f"-style times and frame-accurate curve fitting), read once when needed.
  let fps: number | null = null;
  const getFps = async (): Promise<number> => {
    if (fps === null && input.fps) fps = input.fps;
    if (fps === null) {
      try {
        const j = await callRuntime('inspect', [{ comp: input.comp }, { detail: 'outline', layers: ['__aec_no_layer__'] }], { timeoutMs: 60_000 });
        fps = j?.comp?.fps ?? 30;
      } catch { fps = 30; }
    }
    return fps!;
  };
  const parsed = input.ops.map((o) => AgentOp.parse(o));
  for (let idx = 0; idx < parsed.length; idx++) {
    const op = parsed[idx];
    try {
    switch (op.op) {
      case 'set': {
        const path = propPath(op.prop);
        const ro: any = { op: 'setProperty', layer: op.layer, path, removeExpr: op.removeExpr };
        if (op.keys) {
          // fps matters only for frame/timecode times and baked (non-bezier) curves: skip the AE round trip otherwise.
          const needFps = op.keys.some((k) => (typeof k.t === 'string' && /f$|:/.test(k.t.trim())) || (k.easing !== undefined && !resolveEasing(k.easing as any).bezier));
          const fr = needFps ? await getFps() : 30;
          const ks = op.keys.map((k) => ({ t: parseTime(k.t, fr), v: conv(k.v), easing: k.easing, hold: k.hold }));
          const lists: any[] = [];
          for (let i = 0; i < ks.length - 1; i++) {
            const a = ks[i], b = ks[i + 1];
            const from = Array.isArray(a.v) ? a.v : [a.v], to = Array.isArray(b.v) ? b.v : [b.v];
            if (a.hold) { lists.push([{ t: a.t, v: a.v, o: 'hold' }, { t: b.t, v: b.v }]); continue; }
            const range = Math.max(...to.map((x: number, d: number) => Math.abs(x - from[d])), 1e-9);
            const seg = knotsToKeys(curveKnots(resolveEasing(a.easing ?? 'easeInOutCubic'), b.t - a.t, fr, Math.min(0.01, 0.06 / range)), from, to, a.t, from.length === 1 ? 'oneD' : 'multi');
            if (from.length === 1) seg.forEach((k) => (k.v = (k.v as number[])[0] ?? k.v));
            lists.push(seg);
          }
          const merged: any[] = [];
          for (const l of lists) for (const k of l) { const last = merged[merged.length - 1]; if (last && Math.abs(last.t - k.t) < 1e-6) { last.oe = k.oe; last.o = k.o; } else merged.push(k); }
          ro.keys = ks.length === 1 ? [{ t: ks[0].t, v: ks[0].v }] : merged;
        } else if (op.value !== undefined) ro.value = conv(op.value);
        if (op.expr !== undefined) ro.expr = op.expr;
        out.push(ro);
        break;
      }
      case 'ease': {
        const c = resolveEasing(op.easing as any);
        if (c.bezier) { out.push({ op: 'setEasing', layer: op.layer, path: propPath(op.prop), bezier: [...c.bezier], keys: op.keys }); break; }
        // Non-bezier curve (spring/bounce/elastic): rebuild the selected segments as baked keys.
        const fr = await getFps();
        const keys = await keysFor(input.comp, op.layer, op.prop);
        const sel = op.keys ?? keys.map((_: any, i: number) => i + 1);
        const rebuilt: any[] = [];
        for (let i = 0; i < keys.length; i++) {
          const k = keys[i];
          if (i < keys.length - 1 && sel.includes(i + 1) && sel.includes(i + 2)) {
            const a = k, b = keys[i + 1];
            const from = Array.isArray(a.v) ? a.v : [a.v], to = Array.isArray(b.v) ? b.v : [b.v];
            const range = Math.max(...to.map((x: number, d: number) => Math.abs(x - from[d])), 1e-9);
            const seg = knotsToKeys(curveKnots(c, b.t - a.t, fr, Math.min(0.01, 0.06 / range)), from, to, a.t, from.length === 1 ? 'oneD' : 'multi');
            if (from.length === 1) seg.forEach((s) => (s.v = (s.v as number[])[0] ?? s.v));
            const last = rebuilt[rebuilt.length - 1];
            if (last && Math.abs(last.t - seg[0].t) < 1e-6) { last.oe = seg[0].oe; seg.shift(); }
            rebuilt.push(...seg);
          } else if (!rebuilt.length || Math.abs(rebuilt[rebuilt.length - 1].t - k.t) > 1e-6) rebuilt.push(k);
        }
        out.push({ op: 'setProperty', layer: op.layer, path: propPath(op.prop), keys: rebuilt });
        break;
      }
      case 'easeKey':
        out.push({ op: 'setEasing', layer: op.layer, path: propPath(op.prop), keys: [op.key], side: op.side, ease: { speed: op.speed, influence: op.influence } });
        break;
      case 'interpolation':
        out.push({ op: 'setEasing', layer: op.layer, path: propPath(op.prop), keys: op.keys, interpolation: op.type });
        break;
      case 'retime': {
        const paths = (op.props ?? ['position', 'x', 'y', 'z', 'scale', 'rotation', 'opacity']).map(propPath);
        out.push({ op: 'retimeKeys', layer: op.layer, paths, shift: op.shift, scale: op.scale, pivot: op.pivot, skipStatic: true });
        break;
      }
      case 'layerTiming':
        out.push({ op: 'setLayer', layer: op.layer, attrs: { in: op.in, out: op.out, start: op.start, stretch: op.stretch } });
        break;
      case 'addEffect': {
        const { mn } = resolveEffect(op.effect);
        out.push({ op: 'addEffect', layer: op.layer, effect: { mn, name: op.label, props: paramProps(op.params) }, index: op.index });
        break;
      }
      case 'setEffect': {
        const ep = effectPath(op.effect);
        out.push({ op: 'setProps', layer: op.layer, owner: ep, props: paramProps(op.params) });
        if (op.enabled !== undefined) out.push({ op: 'setEnabled', layer: op.layer, path: ep, enabled: op.enabled });
        break;
      }
      case 'removeEffect':
        out.push({ op: 'removeProperty', layer: op.layer, path: effectPath(op.effect) });
        break;
      case 'moveEffect':
        out.push({ op: 'moveProperty', layer: op.layer, path: effectPath(op.effect), to: op.to });
        break;
      case 'text':
        out.push({ op: 'setText', layer: op.layer, text: { text: op.text, font: op.font, size: op.size, fill: op.color !== undefined ? parseColor(op.color) : undefined, tracking: op.tracking, leading: op.leading } });
        break;
      case 'path': {
        const shape = op.d ? parseSvgPath(op.d)[0] : op.points ? { v: op.points.map((p) => p.p), i: op.points.map((p) => p.in ?? [0, 0]), o: op.points.map((p) => p.out ?? [0, 0]), c: op.closed !== false } : null;
        if (!shape) throw new Error('path op needs d or points');
        out.push(op.t !== undefined ? { op: 'setProperty', layer: op.layer, path: propPath(op.prop), keys: [{ t: op.t, v: shape }] } : { op: 'setProperty', layer: op.layer, path: propPath(op.prop), value: shape });
        break;
      }
      case 'layer':
        out.push({ op: 'setLayer', layer: op.layer, attrs: op.set });
        break;
      case 'removeLayer':
        out.push({ op: 'removeLayer', layer: op.layer });
        break;
      case 'duplicateLayer':
        out.push({ op: 'duplicateLayer', layer: op.layer, name: op.name });
        break;
      case 'addLayer':
        out.push({ op: 'addLayer', spec: op.spec, index: op.index });
        break;
      case 'comp': {
        const s = op.set;
        out.push({ op: 'setComp', attrs: { renderer: s.renderer ? RENDER[s.renderer] : undefined, bg: s.bg ? parseColor(s.bg) : undefined, w: s.width, h: s.height, dur: s.duration, fps: s.fps, motionBlur: s.motionBlur, shutterAngle: s.shutterAngle, name: s.name } });
        break;
      }
      case 'precompose':
        out.push({ op: 'precompose', layers: op.layers, name: op.name });
        break;
      case 'duplicateComp':
        out.push({ op: 'duplicateComp', name: op.name });
        break;
      case 'addControls':
        out.push({ op: 'rigTiming', layer: op.layer, path: propPath(op.prop), delayName: op.delay, speedName: op.speed });
        break;
      case 'ripple': {
        const { op: _o, ...rest } = op;
        out.push({ op: 'ripple', ...rest });
        break;
      }
      case 'place': {
        // Times stay as given: the runtime parses them with the comp's own fps.
        const t = (v: any) => v;
        if (op.item === undefined && !op.file) throw new Error('place needs item or file');
        out.push({ op: 'placeItem', item: op.item, file: op.file, name: op.name, below: op.below, above: op.above, index: op.index, start: t(op.start), in: t(op.in), out: t(op.out), fit: op.fit, muted: op.muted, loop: op.loop });
        break;
      }
      case 'key': {
        let color: number[] | null = null;
        const c = op.color ?? 'auto';
        if (c === 'green') color = [0.2, 0.75, 0.3];
        else if (c === 'blue') color = [0.1, 0.25, 0.85];
        else if (c !== 'auto') color = parseColor(c).slice(0, 3);
        else {
          // The layer may be placed earlier in this same batch: sample that op's item/file instead of the comp.
          const placed = parsed.slice(0, idx).reverse().find((o: any) => o.op === 'place' && (o.name === op.layer || (!o.name && (o.item === op.layer || (o.file && path.basename(o.file) === op.layer))))) as any;
          const s = placed
            ? await sampleSource(placed.item, placed.file)
            : await sampleLayerScreen(input.comp, op.layer, op.at === undefined ? undefined : parseTime(op.at, await getFps()));
          if (!s) throw new Error(`could not find a green/blue screen in layer ${op.layer}; pass color: "green" | "blue" | "#hex"`);
          color = s.color;
          notes?.push(`key: sampled ${s.screen} screen ${toHex(s.color)} (${Math.round(s.coverage * 100)}% of the frame)`);
        }
        const P = { soft: [5, 95, 0, 1], normal: [10, 90, -0.5, 0.5], hard: [20, 80, -1.5, 0.3] }[op.strength ?? 'normal'];
        out.push({ op: 'addEffect', layer: op.layer, effect: { mn: 'Keylight 906', props: [
          { p: 'Keylight 906-0004', v: [...color, 1] }, { p: 'Keylight 906-0012', v: P[0] }, { p: 'Keylight 906-0013', v: P[1] },
          { p: 'Keylight 906-0015', v: P[2] }, { p: 'Keylight 906-0016', v: P[3] },
        ] } });
        // Key Cleaner is opt-in: on solid foregrounds it softens the matte into a speckled, semi-transparent one
        // (verified in AE 26.5); it helps on hair and motion-blurred edges with a small radius.
        if (op.cleanup === true) out.push({ op: 'addEffect', layer: op.layer, effect: { mn: 'ADBE KeyCleaner', props: [{ p: 'ADBE KeyCleaner-0006', v: 3 }] } });
        if (op.spill !== false) out.push({ op: 'addEffect', layer: op.layer, effect: { mn: 'ADBE Spill2', props: [{ p: 'ADBE Spill2-0003', v: [...color, 1] }] } });
        break;
      }
      case 'raw':
        out.push(op.runtime);
        break;
    }
    } catch (e: any) {
      throw new Error(`op #${idx + 1} (${op.op}): ${e.message}`);
    }
  }
  return out;
}
