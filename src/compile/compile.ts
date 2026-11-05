// DSL element tree → IR project. One comp per scene (plus precomps); variants compile the scene
// once per param set. Ids are stable (explicit `id` or a path from the tree) so rebuilds replace in place.
import path from 'node:path';
import type { AecElement, SourceLoc } from '../dsl/jsx-runtime.ts';
import { childrenOf, isElement } from '../dsl/jsx-runtime.ts';
import type { SceneDef } from '../dsl/scene.ts';
import { resetAutoIds } from '../dsl/particles.ts';
import { isAnim } from '../dsl/anim.ts';
import type { TextUnitsAnim } from '../dsl/anim.ts';
import { isControl } from '../dsl/control.ts';
import { parseColor, parseTime, rgb } from '../shared/units.ts';
import { parseSvgPath } from '../shared/svgpath.ts';
import { ControlRegistry } from './controls.ts';
import type { PropSpec, ValueCtx } from './values.ts';
import { lowerValue, TOL } from './values.ts';
import { anchorBox, lowerTransform } from './transform.ts';
import { revealRig, textDoc, unitAnimator } from './text.ts';
import { shapeItems, pointsToShape } from './shapes.ts';
import { resolveEffect } from '../catalog/resolve.ts';
import { paramRange, popupIndex } from '../catalog/harvest.ts';
import { cameraProps, featuresOf, geometryProps, lightProps, materialProps } from './threed.ts';
import type { Feature, RendererKey } from './renderers.ts';
import { chooseRenderer, RENDERER_ID, RENDERER_NAME } from './renderers.ts';
import type { LibMode } from '../aeclib/index.ts';
import { LIB_ITEM, libVersion, withLib, writeLibFile } from '../aeclib/index.ts';
import { rigEffectSpec } from './rigfx.ts';
import { drainDslWarnings } from '../dsl/warn.ts';

// Internal names verified from AE's localized UI strings (D36): Calder = Advanced 3D; 'ADBE Advanced 3d' is the legacy ID of Classic 3D.
const RENDERERS = { advanced3d: 'ADBE Calder', cinema4d: 'ADBE Ernst', classic3d: 'ADBE Advanced 3d' } as const;

/**
 * Responsive reframe (A4): build the scene at another frame size as a sibling comp. Layout containers re-solve in
 * AE; static absolute positions map from the old frame to the new one (offsets from the centre scaled per axis);
 * type scales by `typeScale`; with `platform`, title-safe areas become the vertical platform's UI-free zone.
 */
export interface Reframe { width: number; height: number; label?: string; typeScale?: number; platform?: 'reels' | 'none' }
export interface CompileOpts { version?: number; variant?: string; params?: Record<string, any>; sceneFile?: string; reframe?: Reframe }

/** Reframe presets: 9:16 vertical social (platform zones), 1:1, 4:5 feed, 16:9. */
export const REFRAMES: Record<string, Reframe> = {
  '9:16': { width: 1080, height: 1920, label: '9x16', typeScale: 0.8, platform: 'reels' },
  '1:1': { width: 1080, height: 1080, label: '1x1', typeScale: 0.85 },
  '4:5': { width: 1080, height: 1350, label: '4x5', typeScale: 0.85 },
  '16:9': { width: 1920, height: 1080, label: '16x9', typeScale: 1 },
};
export interface CompileResult { ir: any; warnings: string[]; sources: Record<string, SourceLoc | undefined> }

interface CompBuild { id: string; name: string; w: number; h: number; fps: number; dur: number; bg?: number[]; renderer?: string; rendererReq?: RendererKey; features: Set<Feature>; has3D?: boolean; shutterPhase?: number; samples?: number; adaptive?: number; motionBlur?: boolean; shutterAngle?: number; part?: boolean; layers: any[]; controls: ControlRegistry; markers?: any[] }
interface Ctx { comp: CompBuild; start: number; end: number; path: string; seed: number; scene: SceneDef<any>; sceneDir: string; counters: Map<string, number>; threeD: boolean; inLayout?: boolean }

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'x';

export class Compiler {
  warnings: string[] = [];
  sources: Record<string, SourceLoc | undefined> = {};
  comps: CompBuild[] = [];
  assets = new Map<string, { id: string; path?: string; item?: string }>();
  ids = new Set<string>();
  sceneName = '';
  /** Name of the main comp (precomps read controls from its Controls null). */
  mainName = '';
  libMode: LibMode = 'inline';
  libUsed = false;
  /** Active reframe: per-axis scale of static positions around the centre, type scale, source size. */
  rf: { sx: number; sy: number; type: number; w0: number; h0: number; w: number; h: number; platform?: string; cx: number; cy: number; fit: number } | null = null;

  constructor(private def: SceneDef<any>, private opts: CompileOpts = {}) {}

  compile(): CompileResult {
    const cfg = this.def.config;
    const fps = cfg.fps ?? 30;
    const params = { ...(cfg.params ?? {}), ...(this.opts.params ?? {}) } as any;
    const seed = params.seed ?? 1;
    this.sceneName = cfg.name;
    this.libMode = cfg.lib ?? 'inline';
    const version = this.opts.version ?? cfg.version ?? 1;
    const vtag = `v${String(version).padStart(3, '0')}`;
    const rfm = this.opts.reframe;
    const w0 = cfg.width ?? 1920, h0 = cfg.height ?? 1080;
    if (rfm) {
      // Positions map into the target's usable area: the whole frame, or for vertical platforms the zone free of
      // their UI (left 60, top 250, right 120, bottom 400 px at 1080×1920), centred on that zone.
      const z = rfm.platform === 'reels' ? { x0: 60 * rfm.width / 1080, y0: 250 * rfm.height / 1920, x1: rfm.width - 120 * rfm.width / 1080, y1: rfm.height - 400 * rfm.height / 1920 } : { x0: 0, y0: 0, x1: rfm.width, y1: rfm.height };
      this.rf = { sx: (z.x1 - z.x0) / w0, sy: (z.y1 - z.y0) / h0, type: rfm.typeScale ?? Math.min(1, Math.max(0.6, Math.sqrt((rfm.width * rfm.height) / (w0 * h0)) * 1.1)), w0, h0, w: rfm.width, h: rfm.height, platform: rfm.platform, cx: (z.x0 + z.x1) / 2, cy: (z.y0 + z.y1) / 2, fit: Math.round((z.x1 - z.x0) * (rfm.platform === 'reels' ? 0.95 : 0.9)) };
    }
    const suffix = [this.opts.variant, rfm ? rfm.label ?? `${rfm.width}x${rfm.height}` : undefined].filter(Boolean).join('_');
    const compName = `${cfg.name}_${vtag}${suffix ? '_' + suffix : ''}`;
    const mainId = slug(cfg.name) + (suffix ? '-' + slug(suffix) : '');
    const comp: CompBuild = {
      id: mainId, name: compName, w: rfm ? rfm.width : w0, h: rfm ? rfm.height : h0, fps, dur: parseTime(cfg.duration, fps),
      bg: cfg.bg ? rgb(cfg.bg) : undefined, renderer: undefined, motionBlur: undefined,
      layers: [], controls: new ControlRegistry(), features: new Set(), rendererReq: cfg.renderer,
    };
    this.mainName = compName;
    if (cfg.motionBlur !== undefined) applyCompMB(comp, cfg.motionBlur);
    (globalThis as any).__AEC_SCENE_DIR__ = this.opts.sceneFile ? path.dirname(this.opts.sceneFile) : process.cwd();
    resetAutoIds();
    drainDslWarnings(); // components may run in render() (direct calls) or during the walk (JSX)
    const root = this.def.render({ ...params, seed });
    const ctx: Ctx = { comp, start: 0, end: comp.dur, path: mainId, seed, scene: this.def, sceneDir: this.opts.sceneFile ? path.dirname(this.opts.sceneFile) : process.cwd(), counters: new Map(), threeD: false };
    this.walk(root, ctx);
    this.warnings.push(...drainDslWarnings());
    this.finishComp(comp, cfg.name);
    this.comps.push(comp);
    const ir = {
      irVersion: 1,
      scene: cfg.name,
      assets: [...this.assets.values()],
      comps: this.comps.map((c) => this.irComp(c)),
      main: mainId,
      ...(this.libUsed ? { lib: { item: LIB_ITEM, file: writeLibFile(), version: libVersion() } } : {}),
    };
    return { ir, warnings: this.warnings, sources: this.sources };
  }

  private irComp(c: CompBuild): any {
    return { id: c.id, name: c.name, w: c.w, h: c.h, fps: c.fps, dur: c.dur, bg: c.bg, renderer: c.renderer, motionBlur: c.motionBlur, shutterAngle: c.shutterAngle, shutterPhase: c.shutterPhase, samples: c.samples, adaptive: c.adaptive, part: c.part, layers: c.layers, markers: c.markers, mgt: (c as any).mgt, layouts: (c as any).layouts };
  }

  /** Reverses JSX order (later = on top) into AE order (index 0 = top) and adds the Controls null. */
  private finishComp(c: CompBuild, mgtName: string): void {
    c.layers.reverse();
    if (c.has3D || c.rendererReq) {
      const r = chooseRenderer(c.features, c.rendererReq);
      if (r.errors.length) throw new Error(`comp "${c.name}": ${r.errors.join('; ')}`);
      this.warnings.push(...r.warnings.map((w) => `[${c.name}] ${w}`));
      if (r.auto && r.key !== 'classic3d') this.warnings.push(`[${c.name}] renderer set to ${RENDERER_NAME[RENDERER_ID[r.key]]} (needed for: ${[...c.features].join(', ')})`);
      c.renderer = RENDERER_ID[r.key];
    }
    // Resolve __AEC_LAYER(id)__ placeholders in expressions to thisComp.layer("<name>").
    const names = new Map<string, string>(c.layers.map((L: any) => [L.id, L.name]));
    const seen = new Map<string, number>();
    for (const L of c.layers) seen.set(L.name, (seen.get(L.name) ?? 0) + 1);
    const fix = (e: string) => e.replace(/__AEC_LAYER\(([^)]+)\)__/g, (_m, id) => {
      const n = names.get(id);
      if (!n) throw new Error(`expression references unknown layer id "${id}"`);
      if ((seen.get(n) ?? 0) > 1) throw new Error(`layer name "${n}" (id ${id}) is not unique, but an expression references it; give it a unique name`);
      return `thisComp.layer(${JSON.stringify(n)})`;
    });
    // Expressions that call the library (L.spring(...), D73) get it here, inline or from the shared footage item.
    const lib = (e: string) => { const w = withLib(e, this.libMode); if (w !== e && this.libMode === 'footage') this.libUsed = true; return w; };
    const walkFix = (o: any): void => { if (!o || typeof o !== 'object') return; if (Array.isArray(o)) { o.forEach(walkFix); return; } for (const k of Object.keys(o)) { if (k === 'expr' && typeof o[k] === 'string') o[k] = lib(fix(o[k])); else walkFix(o[k]); } };
    walkFix(c.layers);
    const ctlId = `${c.id}.${'controls'}`;
    const ctl = c.controls.layer(ctlId);
    if (ctl) {
      c.layers.unshift(ctl);
      const eg = c.controls.egProps(ctlId);
      if (eg.length && !c.part) (c as any).mgt = { name: mgtName, props: eg };
    }
    const egText = (c as any).egText as any[] | undefined;
    // Precomps too: their text fields become Essential Properties of every layer that uses them (cloner masters).
    if (egText?.length) (c as any).mgt = { name: mgtName, props: [...egText, ...(((c as any).mgt?.props) ?? [])] };
  }

  /** Precomps: renderer selection + layer-ref resolution (controls stay on the main comp). */
  private finishPrecomp(c: CompBuild): void {
    const reg = c.controls;
    c.controls = new ControlRegistry();
    this.finishComp(c, c.name);
    c.controls = reg;
  }

  private uid(ctx: Ctx, kind: string, explicit?: string): string {
    if (explicit) {
      const id = explicit;
      if (this.ids.has(id)) throw new Error(`duplicate id "${id}"`);
      this.ids.add(id);
      return id;
    }
    const n = ctx.counters.get(kind) ?? 0;
    ctx.counters.set(kind, n + 1);
    let id = `${ctx.path}.${kind}${n}`;
    while (this.ids.has(id)) id += '_';
    this.ids.add(id);
    return id;
  }

  private walk(node: any, ctx: Ctx): void {
    for (const c of childrenOf(node)) { // flattens arrays and fragments (components may return either)
      if (typeof c === 'string') { if (c.trim()) this.warnings.push(`stray text "${c.trim().slice(0, 40)}" outside <Text> was ignored`); continue; }
      this.element(c, ctx);
    }
  }

  private element(el: AecElement, ctx: Ctx): void {
    const kind: string | undefined = el.type?.aec;
    if (!kind) {
      if (typeof el.type === 'function') {
        const r = el.type({ ...el.props });
        this.walk(r, ctx);
        return;
      }
      throw new Error(`unknown JSX element type ${String(el.type)}`);
    }
    const p = el.props;
    switch (kind) {
      case 'composition':
        if (p.bg) ctx.comp.bg = rgb(p.bg);
        if (p.renderer) ctx.comp.rendererReq = p.renderer;
        if (p.motionBlur !== undefined) applyCompMB(ctx.comp, p.motionBlur);
        if (p.shutterAngle !== undefined) ctx.comp.shutterAngle = p.shutterAngle;
        if (p.markers) for (const mk of p.markers) (ctx.comp.markers ??= []).push({ t: parseTime(mk.t, ctx.comp.fps), comment: mk.comment, dur: mk.duration !== undefined ? parseTime(mk.duration, ctx.comp.fps) : undefined });
        this.walk(p.children, ctx);
        return;
      case 'sequence': {
        const start = ctx.start + parseTime(p.from, ctx.comp.fps, 0);
        const end = p.duration !== undefined ? start + parseTime(p.duration, ctx.comp.fps) : ctx.end;
        const clipped = Math.max(start, Math.min(end, ctx.end));
        this.sceneMarker(ctx, p.name, start, clipped);
        this.walk(p.children, { ...ctx, start, end: clipped, path: p.name ? `${ctx.path}.${slug(p.name)}` : ctx.path });
        return;
      }
      case 'series': {
        let cursor = ctx.start;
        for (const s of childrenOf(p.children)) {
          if (typeof s === 'string') continue;
          if (s.type?.aec !== 'series.sequence') throw new Error('<Series> children must be <Series.Sequence duration="...">');
          const start = cursor + parseTime(s.props.offset, ctx.comp.fps, 0);
          const end = start + parseTime(s.props.duration, ctx.comp.fps);
          this.sceneMarker(ctx, s.props.name, start, end);
          this.walk(s.props.children, { ...ctx, start, end, path: s.props.name ? `${ctx.path}.${slug(s.props.name)}` : ctx.path });
          cursor = end;
        }
        return;
      }
      case 'series.sequence':
        throw new Error('<Series.Sequence> must be a direct child of <Series>');
      case 'precomp':
        this.precomp(el, ctx);
        return;
      case 'compMarkers':
        for (const mk of p.markers ?? []) (ctx.comp.markers ??= []).push({ t: ctx.start + parseTime(mk.t, ctx.comp.fps), comment: mk.comment, dur: mk.duration !== undefined ? parseTime(mk.duration, ctx.comp.fps) : undefined });
        return;
      case 'effect':
      case 'rigEffect':
      case 'mask':
        throw new Error(`<${el.type.displayName}> must be a child of a layer (Solid, Text, Shape, Footage, Adjustment, ...)`);
      case 'layout.safe': {
        const k = p.kind ?? 'title';
        // Vertical platform reframe: title-safe is the zone free of the platform's UI (top 250, right 120,
        // bottom 400, left 60 px at 1080×1920, scaled), SKILL.md §6.7.
        const reels = this.rf?.platform === 'reels' && k === 'title' ? [250, 120, 400, 60].map((v, i) => v * (i % 2 ? ctx.comp.w / 1080 : ctx.comp.h / 1920)) : null;
        const ins = Array.isArray(k) ? k : reels ? reels : k === 'action' ? [5, 5, 5, 5].map((v, i) => (i % 2 ? ctx.comp.w : ctx.comp.h) * v / 100) : [10, 10, 10, 10].map((v, i) => (i % 2 ? ctx.comp.w : ctx.comp.h) * v / 100);
        const area = { x: ins[3], y: ins[0], w: ctx.comp.w - ins[1] - ins[3], h: ctx.comp.h - ins[0] - ins[2] };
        for (const c of childrenOf(p.children)) if (typeof c !== 'string') for (const root of this.layoutNodes(c, ctx)) this.addLayout(ctx, root, area);
        return;
      }
      default:
        if (kind.startsWith('layout.')) {
          // A vertical-platform reframe lays top-level containers out in the zone free of the platform's UI.
          const zone = this.rf?.platform === 'reels' && ctx.comp.w === this.rf.w && ctx.comp.h === this.rf.h
            ? { x: 60 * this.rf.w / 1080, y: 250 * this.rf.h / 1920, w: this.rf.w - 180 * this.rf.w / 1080, h: this.rf.h - 650 * this.rf.h / 1920 }
            : { x: 0, y: 0, w: ctx.comp.w, h: ctx.comp.h };
          for (const root of this.layoutNodes(el, ctx)) this.addLayout(ctx, root, zone);
          return;
        }
        this.layer(kind, el, ctx);
    }
  }

  private addLayout(ctx: Ctx, root: any, area: { x: number; y: number; w: number; h: number }): void {
    const c: any = ctx.comp;
    (c.layouts ??= []).push({ root, area });
  }

  /** Builds solver nodes for an element; layer leaves are compiled as layers positioned relative to their slot. */
  private layoutNodes(el: AecElement, ctx: Ctx): any[] {
    const kind: string | undefined = el.type?.aec;
    const p = el.props;
    const kids = () => {
      const out: any[] = [];
      for (const c of childrenOf(p.children)) if (typeof c !== 'string') out.push(...this.layoutNodes(c, ctx));
      return out;
    };
    if (!kind) {
      if (typeof el.type === 'function') {
        const r = el.type({ ...p });
        return childrenOf(Array.isArray(r) ? r : [r]).flatMap((c) => (typeof c === 'string' ? [] : this.layoutNodes(c, ctx)));
      }
      throw new Error(`unknown JSX element type ${String(el.type)}`);
    }
    const pad = (v: any) => (v === undefined ? undefined : Array.isArray(v) ? v : [v, v, v, v]);
    const common = (k: string) => {
      const n: any = { id: p.id ?? this.uid(ctx, k.replace('layout.', ''), undefined), kind: k.replace('layout.', '') };
      for (const f of ['gap', 'align', 'justify', 'columns', 'rowGap', 'colGap', 'width', 'height', 'minWidth', 'maxWidth', 'offset', 'grow', 'at', 'direction']) if (p[f] !== undefined) n[f] = p[f];
      if (p.padding !== undefined) n.padding = pad(p.padding);
      return n;
    };
    switch (kind) {
      case 'layout.stack': case 'layout.grid': case 'layout.align': case 'layout.padding': case 'layout.box': case 'layout.overlay':
        return [{ ...common(kind), children: kids() }];
      case 'sequence': {
        const start = ctx.start + parseTime(p.from, ctx.comp.fps, 0);
        const end = p.duration !== undefined ? start + parseTime(p.duration, ctx.comp.fps) : ctx.end;
        const clipped = Math.max(start, Math.min(end, ctx.end));
        this.sceneMarker(ctx, p.name, start, clipped);
        const sub = { ...ctx, start, end: clipped };
        const out: any[] = [];
        for (const c of childrenOf(p.children)) if (typeof c !== 'string') out.push(...this.layoutNodes(c, sub));
        return out;
      }
      case 'layout.safe':
        throw new Error('<SafeArea> must be at the top level of the composition');
      case 'precomp': {
        const before = ctx.comp.layers.length;
        this.precomp(el, { ...ctx, inLayout: true } as any);
        const L = ctx.comp.layers[ctx.comp.layers.length - 1];
        void before;
        return [{ id: L.id, kind: 'leaf', ...(p.layout ?? {}) }];
      }
      default: {
        const id = this.layer(kind, el, { ...ctx, inLayout: true } as any);
        return [{ id, kind: 'leaf', ...(p.layout ?? {}) }];
      }
    }
  }

  /** Named Sequences become comp markers with a duration ("scenes"): visible in AE's timeline, listed by the
   *  inspector, and the handle for ripple edits ({ op: 'ripple', scene: 'Beat 2', by: 1 }). */
  private sceneMarker(ctx: Ctx, name: string | undefined, start: number, end: number): void {
    if (!name) return;
    const e = Math.min(end, ctx.comp.dur);
    if (!(e > start)) return;
    (ctx.comp.markers ??= []).push({ t: start, comment: name, dur: e - start });
  }

  private precomp(el: AecElement, ctx: Ctx): void {
    const p = el.props;
    const id = this.uid(ctx, 'precomp', p.id);
    const fps = ctx.comp.fps;
    const sub: CompBuild = {
      id, name: p.name ?? `${this.sceneName}_${id.split('.').pop()}`, w: p.width ?? ctx.comp.w, h: p.height ?? ctx.comp.h, fps,
      dur: p.compDuration !== undefined ? parseTime(p.compDuration, fps) : ctx.end - ctx.start, bg: p.bg ? rgb(p.bg) : undefined, part: true, layers: [], controls: ctx.comp.controls.scoped(this.mainName), features: new Set(),
    };
    // Precomps share the parent's control registry: controls live on the main comp's Controls null
    // and expressions inside precomps reach it with comp("<main>").layer("Controls").
    const subCtx: Ctx = { ...ctx, comp: sub, start: 0, end: sub.dur, path: id, counters: new Map() };
    this.walk(p.children, subCtx);
    this.finishPrecomp(sub);
    this.comps.push(sub);
    this.layer('precomp', el, ctx, { precompId: id, id });
  }

  private layer(kind: string, el: AecElement, ctx: Ctx, extra: { precompId?: string; id?: string } = {}): string {
    const p = el.props;
    const fps = ctx.comp.fps;
    const id = extra.id ?? this.uid(ctx, kind, p.id);
    this.sources[id] = el.src;
    const inT = ctx.start + parseTime(p.from, fps, 0);
    const outT = p.duration !== undefined ? inT + parseTime(p.duration, fps) : ctx.end;
    const threeD = !!p.threeD;
    const L: any = { id, type: kind === 'adjustment' ? 'adjustment' : kind, name: p.name ?? this.defaultName(kind, p, id), in: inT, out: outT };
    if (threeD) L.threeD = true;
    if (p.blend) L.blend = p.blend;
    const mb = p.motionBlur;
    if (mb === true || mb === 'native' || (mb && typeof mb === 'object' && (mb.mode ?? 'native') === 'native')) { L.motionBlur = true; if (ctx.comp.motionBlur === undefined) ctx.comp.motionBlur = true; }
    else if (mb === false) L.motionBlur = false;
    if (p.hidden) L.enabled = false;
    if (p.shy) L.shy = true;
    if (p.guide) L.guide = true;
    if (p.label !== undefined) L.label = p.label;
    if (p.tags?.length) L.tags = p.tags; // style-lint hints, read back by layer id (src/api/motion.ts)
    if (p.parent) L.parent = p.parent;
    if (p.matte) L.matte = { layer: p.matte.layer, type: p.matte.type ?? 'alpha', ...(p.matte.showSource ? { showSource: true } : {}) };
    if (p.markers) L.markers = p.markers.map((m: any) => ({ t: inT + parseTime(m.t, fps), comment: m.comment, dur: m.duration !== undefined ? parseTime(m.duration, fps) : undefined }));
    const vctx: ValueCtx = { fps, t0: inT, controls: ctx.comp.controls, seed: ctx.seed, warnings: this.warnings };
    const anim: Record<string, any> = { ...(p.animate ?? {}) };
    const textAnims: TextUnitsAnim[] = [];
    if (anim.text) { textAnims.push(...(Array.isArray(anim.text) ? anim.text : [anim.text])); delete anim.text; }
    for (const [k, v] of Object.entries(anim)) if (!isAnim(v) && !isControl(v)) throw new Error(`animate.${k} must be an animation (tween/spring/keys/...) or control()`);
    const groups: any[] = [];
    const props: PropSpec[] = [];
    const rigFx: any[] = []; // rig effects a component adds to this layer (live text reveals), above the authored effects
    switch (kind) {
      case 'solid':
      case 'adjustment':
        L.solid = { color: rgb(p.color ?? (kind === 'adjustment' ? '#ffffff' : '#000000')), w: p.width ?? ctx.comp.w, h: p.height ?? ctx.comp.h };
        // AE renders a layer at its own pixel size: a 30000 px solid needs 3.4 GB per frame and stops renders with
        // a modal memory error. For huge planes (floors), use a smaller solid and scale it.
        if (L.solid.w > 30000 || L.solid.h > 30000) throw new Error(`[${id}] solid ${L.solid.w}×${L.solid.h} exceeds AE's 30000 px limit; use a smaller solid with scale (e.g. width={4000} scale={800})`);
        if (L.solid.w * L.solid.h > 64e6) this.warnings.push(`[${id}] solid ${L.solid.w}×${L.solid.h} is very large (memory per frame); a smaller solid with scale renders the same plane far cheaper`);
        break;
      case 'text': {
        const text = p.text ?? childrenOf(p.children).filter((c) => typeof c === 'string').join('');
        if (!text) this.warnings.push(`[${id}] <Text> has no text`);
        const inFrame = this.rf && ctx.comp.w === this.rf.w && ctx.comp.h === this.rf.h;
        L.text = textDoc(inFrame ? { ...p, size: Math.round((p.size ?? 72) * this.rf!.type) } : p, text);
        // Reframe: a line too wide for the new frame's safe width shrinks to fit (AE measures it).
        if (inFrame && !p.box && !p.path) L.text.fitWidth = this.rf!.fit;
        if (p.eg) ((ctx.comp as any).egText ??= []).push({ layer: id, p: 'ADBE Text Properties/ADBE Text Document', name: p.eg === true ? L.name : String(p.eg) });
        // Per-character 3D: asked for, or needed by a unit animator that rotates letters in X/Y or moves them in z
        // (without it AE silently ignores those).
        const needs3D = textAnims.some((ta: any) => ta.from && (ta.from.rotationX !== undefined || ta.from.rotationY !== undefined || ta.from.z !== undefined));
        if (p.perCharacter3D || needs3D) { L.threeD = true; L.threeDPerChar = true; }
        if (p.path) {
          // Text on a path: the path is a mask (mode None, index 1: built before child masks) that Path Options follow.
          // Comp coordinates (the layer rests at 0,0, see compSpace below) unless the layer is positioned.
          const shape = typeof p.path === 'string' ? parseSvgPath(p.path)[0] : pointsToShape(p.path, false);
          if (!shape) throw new Error(`[${id}] <Text path> needs a path (SVG d or pen points)`);
          groups.push({ at: 'ADBE Mask Parade', items: [{ mn: 'ADBE Mask Atom', name: 'Text Path', attrs: { maskMode: 'NONE', inverted: false }, props: [{ p: 'ADBE Mask Shape', v: shape }] }] });
          const PO = 'ADBE Text Properties/ADBE Text Path Options/';
          props.push({ p: PO + 'ADBE Text Path', v: 1 });
          const po = p.pathOptions ?? {};
          if (po.reverse) props.push({ p: PO + 'ADBE Text Reverse Path', v: 1 });
          if (po.perpendicular === false) props.push({ p: PO + 'ADBE Text Perpendicular To Path', v: 0 });
          if (po.forceAlign) props.push({ p: PO + 'ADBE Text Force Align Path', v: 1 });
          for (const [k, mn] of [['firstMargin', 'ADBE Text First Margin'], ['lastMargin', 'ADBE Text Last Margin']] as const) {
            if (po[k] === undefined) continue;
            const s = lowerValue(po[k], { path: PO + mn, rest: [0], dims: 1, tol: TOL.px }, vctx);
            if (s) props.push(s);
          }
        }
        // (Property values in expressions are array-like, not Arrays: index them, don't call .slice.)
        if (isControl(p.color)) props.push({ p: 'ADBE Text Properties/ADBE Text Document', expr: `var c = ${ctx.comp.controls.use(p.color)}; style.setFillColor([c[0], c[1], c[2]]);` });
        const ab = p.path ? null : anchorBox(p.anchor, 'center');
        if (ab) L.anchorBox = ab;
        for (const ta of textAnims) {
          const r = unitAnimator(ta, vctx, 0, threeD, text, { in: inT, out: outT });
          groups.push({ at: 'ADBE Text Properties/ADBE Text Animators', items: [r.group] });
          props.push(...r.moreOptions);
          if (ta.live) rigFx.push(revealRig(ta, vctx));
        }
        break;
      }
      case 'shape': {
        const items = shapeItems(this.rf && ctx.comp.w === this.rf.w && ctx.comp.h === this.rf.h ? this.reframeShapes(p.children, id) : p.children, vctx, this.warnings);
        if (items.length) groups.push({ at: 'ADBE Root Vectors Group', items });
        const ab = anchorBox(p.anchor, null);
        if (ab) L.anchorBox = ab;
        break;
      }
      case 'footage': {
        let asset: { id: string; path?: string; item?: string };
        if (p.src) {
          const abs = path.isAbsolute(p.src) ? p.src : path.resolve(ctx.sceneDir, p.src);
          const aid = 'asset.' + slug(path.basename(abs));
          asset = this.assets.get(abs) ?? { id: aid, path: abs };
          this.assets.set(abs, asset);
        } else if (p.item) {
          asset = this.assets.get('item:' + p.item) ?? { id: 'item.' + slug(p.item), item: p.item };
          this.assets.set('item:' + p.item, asset);
        } else throw new Error(`[${id}] <Footage> needs src (file path) or item (project item name)`);
        L.footage = { asset: asset.id };
        L.fit = p.fit ?? 'cover';
        if (p.toShapes) { L.toShapes = true; if (p.vectorWidth) L.vectorWidth = p.vectorWidth; }
        const speed = p.speed ?? 1;
        if (p.trim) {
          const s = parseTime(p.trim[0], fps), e = parseTime(p.trim[1], fps);
          L.start = inT - s / speed;
          L.out = Math.min(outT, inT + (e - s) / speed);
        } else L.start = inT;
        if (speed !== 1) L.stretch = 100 / speed;
        if (p.muted) L.muted = true;
        if (p.loop) L.loop = true;
        break;
      }
      case 'precomp':
        L.precomp = { comp: extra.precompId };
        if (p.instances) L.instances = p.instances; // cloner instance 1 (duplicated in AE)
        // Like Remotion: the nested comp's frame 0 plays at the Sequence/layer start.
        L.start = inT;
        if (p.collapse) L.collapse = true;
        break;
      case 'null':
        break;
      case 'camera': {
        L.camera = { twoNode: !p.oneNode };
        L.threeD = true;
        break;
      }
      case 'light': {
        L.light = { kind: p.kind ?? 'point' };
        L.threeD = true;
        if (p.hdri) {
          if ((p.kind ?? 'point') !== 'environment') throw new Error(`[${id}] hdri= is only valid on <Light kind="environment">`);
          const abs = path.isAbsolute(p.hdri) ? p.hdri : path.resolve(ctx.sceneDir, p.hdri);
          const asset = this.assets.get(abs) ?? { id: 'asset.' + slug(path.basename(abs)), path: abs };
          this.assets.set(abs, asset);
          const srcId = `${id}.hdri`;
          // The environment source layer: an HDRI footage layer the light points at (AE flags it as environment).
          ctx.comp.layers.push({ id: srcId, type: 'footage', name: `${L.name} HDRI`, in: inT, out: outT, footage: { asset: asset.id }, fit: 'none' }); // AE flags it as environment when the light's source is set (verified)
          L.light.source = srcId;
        }
        break;
      }
      case 'model': {
        if (!p.src) throw new Error(`[${id}] <Model> needs src (.glb/.gltf/.obj)`);
        const abs = path.isAbsolute(p.src) ? p.src : path.resolve(ctx.sceneDir, p.src);
        const asset = this.assets.get(abs) ?? { id: 'asset.' + slug(path.basename(abs)), path: abs };
        this.assets.set(abs, asset);
        L.footage = { asset: asset.id };
        L.threeD = true;
        break;
      }
      default:
        throw new Error(`<${el.type?.displayName ?? kind}> is not a layer`);
    }
    // Transform
    const isCam = kind === 'camera';
    const camInfo = isCam ? cameraProps(p, vctx, ctx.comp.w, ctx.comp.h) : null;
    // <Shape space="comp"> and text on a path: drawn in comp pixels (like SVG/Remotion), so the layer sits at 0,0.
    const compSpace = (kind === 'shape' && p.space === 'comp') || (kind === 'text' && !!p.path);
    const rest = { x: compSpace ? 0 : ctx.comp.w / 2, y: compSpace ? 0 : ctx.comp.h / 2, z: isCam ? camInfo!.restZ : kind === 'light' ? -600 : 0 };
    if (ctx.inLayout) { rest.x = 0; rest.y = 0; } // laid-out layers: position is an offset from the solved slot
    for (const k of ['x', 'y', 'z'] as const) if (typeof p[k] === 'number') rest[k] = p[k];
    if (Array.isArray(p.position)) { rest.x = p.position[0]; rest.y = p.position[1]; rest.z = p.position[2] ?? rest.z; }
    // Reframe: static absolute positions in the main frame keep their place relative to the centre, per axis.
    if (this.rf && !ctx.inLayout && !compSpace && ctx.comp.w === this.rf.w && ctx.comp.h === this.rf.h && !isCam && kind !== 'light') {
      // Given positions map from the old frame; centred ones move to the usable zone's centre, except layers that
      // fill the frame (solids, adjustment layers, footage, full-frame rectangles), which stay on the frame's centre.
      const fills = kind === 'solid' || kind === 'adjustment' || kind === 'footage' || (kind === 'shape' && this.filledFrame.has(L.id));
      if (typeof p.x === 'number' || Array.isArray(p.position)) rest.x = this.rf.cx + (rest.x - this.rf.w0 / 2) * this.rf.sx;
      else if (!fills) rest.x = this.rf.cx;
      if (typeof p.y === 'number' || Array.isArray(p.position)) rest.y = this.rf.cy + (rest.y - this.rf.h0 / 2) * this.rf.sy;
      else if (!fills) rest.y = this.rf.cy;
    }
    const tProps = { ...p };
    if (typeof p.x === 'number' && !anim.x) delete (tProps as any).x;
    if (typeof p.y === 'number' && !anim.y) delete (tProps as any).y;
    if (typeof p.z === 'number' && !anim.z) delete (tProps as any).z;
    if (Array.isArray(p.position) && !anim.position) delete (tProps as any).position;
    if (isCam || kind === 'light') delete (tProps as any).anchor; // camera/light anchor is the point of interest
    // Ambient and environment lights have no transform in AE (writing it fails).
    const noTransform = (kind === 'light' && (p.kind === 'ambient' || p.kind === 'environment')) || (kind === 'footage' && p.audio === true); // audio-only layers have no transform
    if (!noTransform) props.unshift(...lowerTransform({ props: tProps, anim, rest, threeD: !!L.threeD }, vctx));
    if (ctx.inLayout) {
      for (const s of props) {
        if (s.p === 'ADBE Transform Group/ADBE Position' && !s.sep) (s as any).rel = L.threeD ? [0, 1, 2] : [0, 1];
        else if (/ADBE Position_0$/.test(s.p)) (s as any).rel = [0];
        else if (/ADBE Position_1$/.test(s.p)) (s as any).rel = [1];
      }
      if (!L.anchorBox && !Array.isArray(p.anchor)) L.anchorBox = [0.5, 0.5];
      L.layoutLeaf = true;
    }
    if (camInfo) props.push(...camInfo.props);
    if (kind === 'light') props.push(...lightProps(p, vctx, ctx.comp.w, ctx.comp.h));
    if (L.threeD && kind !== 'camera' && kind !== 'light') {
      props.push(...materialProps(p.material, vctx, kind === 'model'));
      props.push(...geometryProps(p.geometry, vctx, kind));
    }
    if (p.autoOrient) L.autoOrient = { none: 'NO_AUTO_ORIENT', path: 'ALONG_PATH', camera: 'CAMERA_OR_POINT_OF_INTEREST', characters: 'CHARACTERS_TOWARD_CAMERA' }[p.autoOrient as string];
    if (L.threeD) ctx.comp.has3D = true;
    const hasFxChildren = rigFx.length > 0 || (p.effects ?? []).length > 0 || childrenOf(kind === 'precomp' ? [] : p.children).some((c) => typeof c !== 'string' && (c.type?.aec === 'effect' || c.type?.aec === 'rigEffect' || c.type?.aec === 'mask'));
    for (const f of featuresOf(kind, p, !!L.threeD, hasFxChildren)) ctx.comp.features.add(f);
    if (p.motionBlur && ctx.comp.motionBlur !== false && L.threeD) ctx.comp.features.add('motionBlur');
    // Children: effects and masks
    const fx: any[] = [...rigFx], masks: any[] = [];
    for (const c of [...(kind === 'precomp' ? [] : childrenOf(p.children)), ...childrenOf(p.effects ?? [])]) {
      if (typeof c === 'string') continue;
      const ck = c.type?.aec;
      if (ck === 'effect') fx.push(this.effect(c, vctx, id));
      else if (ck === 'rigEffect') fx.push(rigEffectSpec(c.props.def, c.props.name ?? c.props.def.name, c.props.values ?? {}, vctx));
      else if (ck === 'mask') masks.push(this.mask(c, vctx));
      else if (kind !== 'shape') throw new Error(`[${id}] <${c.type?.displayName ?? ck}> can't be a child of <${el.type.displayName}>; only <Effect> and <Mask> can`);
    }
    // Forced motion blur: works where the layer switch doesn't (effects/particles/precomps, Advanced 3D).
    const mbMode = typeof mb === 'string' ? mb : mb && typeof mb === 'object' ? mb.mode ?? 'native' : undefined;
    if (mbMode === 'force') fx.push({ mn: 'CC Force Motion Blur', props: [{ p: 'Motion Blur Samples', v: mb.samples ?? 16 }, { p: 'Override Shutter Settings', v: 1 }, { p: 'Shutter Angle', v: mb.shutterAngle ?? ctx.comp.shutterAngle ?? 180 }, { p: 'Shutter Phase', v: mb.shutterPhase ?? 0 }, { p: 'Native Motion Blur', v: 2 }] });
    else if (mbMode === 'pixel') fx.push({ mn: 'ADBE OFMotionBlur', props: [{ p: 'Shutter Control', v: 1 }, { p: 'Shutter Angle', v: mb.shutterAngle ?? 180 }, { p: 'Shutter Samples', v: mb.samples ?? 8 }] });
    if (masks.length) groups.push({ at: 'ADBE Mask Parade', items: masks });
    if (fx.length) groups.push({ at: 'ADBE Effect Parade', items: fx });
    for (const [k, v] of Object.entries(p.props ?? {})) {
      const s = lowerValue(v, { path: k, rest: [0], dims: Array.isArray(v) ? (v as any[]).length : 1, tol: TOL.generic }, vctx);
      if (s) props.push(s);
    }
    for (const [k, e] of Object.entries(p.expressions ?? {})) props.push({ p: k, expr: String(e) });
    if (groups.length) L.groups = groups;
    if (props.length) L.props = props;
    ctx.comp.layers.push(L);
    return id;
  }


  private effect(el: AecElement, vctx: ValueCtx, layerId: string): any {
    const p = el.props;
    const { mn, name } = resolveEffect(p.name);
    if (mn === 'ADBE Numbers2') throw new Error('the Numbers effect opens a modal options dialog when applied from a script; use a <Text> layer with a sourceText expression for counters (docs/DSL.md "stat count-up")');
    const props: PropSpec[] = [];
    for (const [k, v] of Object.entries(p.params ?? {})) {
      if (v && typeof v === 'object' && 'layer' in (v as any) && !isAnim(v) && !isControl(v)) { props.push({ p: k, v }); continue; }
      const val: any = v;
      if (typeof val === 'string' && !/^(#|rgb|hsl)/i.test(val)) {
        // Popup label ("Screen") → index from the harvested catalog; otherwise it must be a color name.
        const ix = popupIndex(mn, k, val);
        if (ix !== undefined) { props.push({ p: k, v: ix }); continue; }
        let isColor = true;
        try { parseColor(val); } catch { isColor = false; }
        if (!isColor) throw new Error(`${name}: "${val}" is not an option of "${k}" (use describe_effect to list options, or pass the number)`);
      }
      // A percent given for a 0–1 parameter (e.g. the Fill effect's Opacity): scale it, from the harvested range.
      const range = paramRange(mn, k);
      if (typeof v === 'number' && range && range.max === 1 && range.min >= 0 && v > 1 && v <= 100) {
        this.warnings.push(`${name}: "${k}" is 0–1 in AE; ${v} was read as ${v}% → ${v / 100}`);
        props.push({ p: k, v: v / 100 });
        continue;
      }
      const isColorish = typeof val === 'string' || (isControl(val) && val.kind === 'color');
      const dims = isColorish ? 4 : Array.isArray(val) ? val.length : isAnim(val) && Array.isArray((val as any).to ?? (val as any).from) ? ((val as any).to ?? (val as any).from).length : 1;
      const s = lowerValue(val, { path: k, rest: Array(dims).fill(0), dims, tol: TOL.generic, conv: isColorish ? (c: any) => parseColor(c) : undefined }, vctx);
      if (s) props.push(s);
    }
    void layerId;
    void name;
    return { mn, name: p.label, attrs: p.enabled === false ? { enabled: false } : undefined, props };
  }

  private mask(el: AecElement, vctx: ValueCtx): any {
    const p = el.props;
    let shape: any;
    if (p.path) shape = parseSvgPath(p.path)[0];
    else if (p.points) shape = pointsToShape(p.points, true);
    else if (p.rect) {
      const { x, y, width: w, height: h } = p.rect;
      const r = Math.max(0, Math.min(p.rect.roundness ?? 0, w / 2, h / 2));
      if (r > 0) {
        // Rounded rectangle: 8 vertices, corner tangents at the circle-approximation constant.
        const k = r * 0.5523;
        shape = {
          v: [[x + r, y], [x + w - r, y], [x + w, y + r], [x + w, y + h - r], [x + w - r, y + h], [x + r, y + h], [x, y + h - r], [x, y + r]],
          i: [[-k, 0], [0, 0], [0, -k], [0, 0], [k, 0], [0, 0], [0, k], [0, 0]],
          o: [[0, 0], [k, 0], [0, 0], [0, k], [0, 0], [-k, 0], [0, 0], [0, -k]],
          c: true,
        };
      } else shape = { v: [[x, y], [x + w, y], [x + w, y + h], [x, y + h]], i: [[0, 0], [0, 0], [0, 0], [0, 0]], o: [[0, 0], [0, 0], [0, 0], [0, 0]], c: true };
    } else throw new Error('<Mask> needs path, points or rect');
    const props: PropSpec[] = [{ p: 'ADBE Mask Shape', v: shape }];
    if (p.feather !== undefined) { const s = lowerValue(p.feather, { path: 'ADBE Mask Feather', rest: [0, 0], dims: 2, tol: TOL.px, conv: (v: any) => (typeof v === 'number' ? [v, v] : v) }, vctx); if (s) props.push(s); }
    if (p.expansion !== undefined) { const s = lowerValue(p.expansion, { path: 'ADBE Mask Offset', rest: [0], dims: 1, tol: TOL.px }, vctx); if (s) props.push(s); }
    if (p.opacity !== undefined) { const s = lowerValue(p.opacity, { path: 'ADBE Mask Opacity', rest: [100], dims: 1, tol: TOL.opacity }, vctx); if (s) props.push(s); }
    const MODE: Record<string, string> = { add: 'ADD', subtract: 'SUBTRACT', intersect: 'INTERSECT', none: 'NONE', lighten: 'LIGHTEN', darken: 'DARKEN', difference: 'DIFFERENCE' };
    return { mn: 'ADBE Mask Atom', name: p.name, attrs: { maskMode: MODE[p.mode ?? 'add'], inverted: !!p.inverted }, props };
  }

  /** Reframe: rectangles that fill the source frame fill the new one (backgrounds, glows, scrims). */
  private filledFrame = new Set<string>();
  private reframeShapes(children: any, layerId: string): any {
    const rf = this.rf!;
    const fix = (c: any): any => {
      if (!c || typeof c !== 'object' || !c.type) return c;
      const kind = c.type.aec;
      if (kind === 'rect' && Array.isArray(c.props.size) && c.props.size[0] >= rf.w0 - 1 && c.props.size[1] >= rf.h0 - 1) { this.filledFrame.add(layerId); return { ...c, props: { ...c.props, size: [c.props.size[0] * rf.w / rf.w0, c.props.size[1] * rf.h / rf.h0] } }; }
      if (kind === 'group') return { ...c, props: { ...c.props, children: childrenOf(c.props.children).map(fix) } };
      return c;
    };
    return childrenOf(children).map(fix);
  }

  private defaultName(kind: string, p: any, id: string): string {
    if (kind === 'text') {
      const t = (p.text ?? childrenOf(p.children).filter((c: any) => typeof c === 'string').join('')).replace(/\s+/g, ' ').trim();
      return t.length > 28 ? t.slice(0, 27) + '…' : t || 'Text';
    }
    const base: Record<string, string> = { solid: 'Solid', null: 'Null', adjustment: 'Adjustment', shape: 'Shape', footage: 'Footage', precomp: 'Precomp', camera: 'Camera', light: 'Light', model: 'Model' };
    return `${base[kind] ?? kind} ${id.split('.').pop()?.replace(/^\D+/, '') ?? ''}`.trim();
  }
}

/** Comp motion blur: true/false or { shutterAngle, shutterPhase, samples, adaptiveLimit }. */
function applyCompMB(c: CompBuild, mb: any): void {
  if (typeof mb === 'boolean') { c.motionBlur = mb; return; }
  c.motionBlur = mb.enabled !== false;
  if (mb.shutterAngle !== undefined) c.shutterAngle = mb.shutterAngle;
  if (mb.shutterPhase !== undefined) c.shutterPhase = mb.shutterPhase;
  if (mb.samples !== undefined) c.samples = mb.samples;
  if (mb.adaptiveLimit !== undefined) c.adaptive = mb.adaptiveLimit;
}

export function compileScene(def: SceneDef<any>, opts: CompileOpts = {}): CompileResult {
  return new Compiler(def, opts).compile();
}
