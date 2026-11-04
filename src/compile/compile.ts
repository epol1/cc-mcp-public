// DSL element tree → IR project. One comp per scene (plus precomps); variants compile the scene
// once per param set. Ids are stable (explicit `id` or a path from the tree) so rebuilds replace in place.
import path from 'node:path';
import type { AecElement, SourceLoc } from '../dsl/jsx-runtime.ts';
import { childrenOf, isElement } from '../dsl/jsx-runtime.ts';
import type { SceneDef } from '../dsl/scene.ts';
import { isAnim } from '../dsl/anim.ts';
import type { TextUnitsAnim } from '../dsl/anim.ts';
import { isControl } from '../dsl/control.ts';
import { parseColor, parseTime, rgb } from '../shared/units.ts';
import { parseSvgPath } from '../shared/svgpath.ts';
import { ControlRegistry } from './controls.ts';
import type { PropSpec, ValueCtx } from './values.ts';
import { lowerValue, TOL } from './values.ts';
import { anchorBox, lowerTransform } from './transform.ts';
import { textDoc, unitAnimator } from './text.ts';
import { shapeItems, pointsToShape } from './shapes.ts';
import { resolveEffect } from '../catalog/resolve.ts';

const RENDERERS = { advanced3d: 'ADBE Advanced 3d', cinema4d: 'ADBE Ernst', classic3d: 'ADBE Calder' } as const;

export interface CompileOpts { version?: number; variant?: string; params?: Record<string, any>; sceneFile?: string }
export interface CompileResult { ir: any; warnings: string[]; sources: Record<string, SourceLoc | undefined> }

interface CompBuild { id: string; name: string; w: number; h: number; fps: number; dur: number; bg?: number[]; renderer?: string; motionBlur?: boolean; shutterAngle?: number; part?: boolean; layers: any[]; controls: ControlRegistry; markers?: any[] }
interface Ctx { comp: CompBuild; start: number; end: number; path: string; seed: number; scene: SceneDef; sceneDir: string; counters: Map<string, number>; threeD: boolean }

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'x';

export class Compiler {
  warnings: string[] = [];
  sources: Record<string, SourceLoc | undefined> = {};
  comps: CompBuild[] = [];
  assets = new Map<string, { id: string; path?: string; item?: string }>();
  ids = new Set<string>();
  sceneName = '';

  constructor(private def: SceneDef, private opts: CompileOpts = {}) {}

  compile(): CompileResult {
    const cfg = this.def.config;
    const fps = cfg.fps ?? 30;
    const params = { ...(cfg.params ?? {}), ...(this.opts.params ?? {}) } as any;
    const seed = params.seed ?? 1;
    this.sceneName = cfg.name;
    const version = this.opts.version ?? cfg.version ?? 1;
    const vtag = `v${String(version).padStart(3, '0')}`;
    const compName = `${cfg.name}_${vtag}${this.opts.variant ? '_' + this.opts.variant : ''}`;
    const mainId = slug(cfg.name) + (this.opts.variant ? '-' + slug(this.opts.variant) : '');
    const comp: CompBuild = {
      id: mainId, name: compName, w: cfg.width ?? 1920, h: cfg.height ?? 1080, fps, dur: parseTime(cfg.duration, fps),
      bg: cfg.bg ? rgb(cfg.bg) : undefined, renderer: cfg.renderer ? RENDERERS[cfg.renderer] : undefined, motionBlur: cfg.motionBlur,
      layers: [], controls: new ControlRegistry(),
    };
    const root = this.def.render({ ...params, seed });
    const ctx: Ctx = { comp, start: 0, end: comp.dur, path: mainId, seed, scene: this.def, sceneDir: this.opts.sceneFile ? path.dirname(this.opts.sceneFile) : process.cwd(), counters: new Map(), threeD: false };
    this.walk(root, ctx);
    this.finishComp(comp, cfg.name);
    this.comps.push(comp);
    const ir = {
      irVersion: 1,
      scene: cfg.name,
      assets: [...this.assets.values()],
      comps: this.comps.map((c) => this.irComp(c)),
      main: mainId,
    };
    return { ir, warnings: this.warnings, sources: this.sources };
  }

  private irComp(c: CompBuild): any {
    return { id: c.id, name: c.name, w: c.w, h: c.h, fps: c.fps, dur: c.dur, bg: c.bg, renderer: c.renderer, motionBlur: c.motionBlur, shutterAngle: c.shutterAngle, part: c.part, layers: c.layers, markers: c.markers, mgt: (c as any).mgt };
  }

  /** Reverses JSX order (later = on top) into AE order (index 0 = top) and adds the Controls null. */
  private finishComp(c: CompBuild, mgtName: string): void {
    c.layers.reverse();
    const ctlId = `${c.id}.${'controls'}`;
    const ctl = c.controls.layer(ctlId);
    if (ctl) {
      c.layers.unshift(ctl);
      const eg = c.controls.egProps(ctlId);
      if (eg.length && !c.part) (c as any).mgt = { name: mgtName, props: eg };
    }
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
    for (const c of Array.isArray(node) ? childrenOf(node) : isElement(node) ? [node] : childrenOf(node)) {
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
        if (p.renderer) ctx.comp.renderer = (RENDERERS as any)[p.renderer];
        if (p.motionBlur !== undefined) ctx.comp.motionBlur = p.motionBlur;
        if (p.shutterAngle !== undefined) ctx.comp.shutterAngle = p.shutterAngle;
        this.walk(p.children, ctx);
        return;
      case 'sequence': {
        const start = ctx.start + parseTime(p.from, ctx.comp.fps, 0);
        const end = p.duration !== undefined ? start + parseTime(p.duration, ctx.comp.fps) : ctx.end;
        this.walk(p.children, { ...ctx, start, end: Math.min(end, Math.max(end, start)), path: p.name ? `${ctx.path}.${slug(p.name)}` : ctx.path });
        return;
      }
      case 'series': {
        let cursor = ctx.start;
        for (const s of childrenOf(p.children)) {
          if (typeof s === 'string') continue;
          if (s.type?.aec !== 'series.sequence') throw new Error('<Series> children must be <Series.Sequence duration="...">');
          const start = cursor + parseTime(s.props.offset, ctx.comp.fps, 0);
          const end = start + parseTime(s.props.duration, ctx.comp.fps);
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
      case 'effect':
      case 'mask':
        throw new Error(`<${el.type.displayName}> must be a child of a layer (Solid, Text, Shape, Footage, Adjustment, ...)`);
      default:
        this.layer(kind, el, ctx);
    }
  }

  private precomp(el: AecElement, ctx: Ctx): void {
    const p = el.props;
    const id = this.uid(ctx, 'precomp', p.id);
    const fps = ctx.comp.fps;
    const sub: CompBuild = {
      id, name: p.name ?? `${this.sceneName}_${id.split('.').pop()}`, w: p.width ?? ctx.comp.w, h: p.height ?? ctx.comp.h, fps,
      dur: p.compDuration !== undefined ? parseTime(p.compDuration, fps) : ctx.end - ctx.start, bg: p.bg ? rgb(p.bg) : undefined, part: true, layers: [], controls: ctx.comp.controls,
    };
    // Precomps share the parent's control registry: controls live on the main comp's Controls null
    // and expressions inside precomps reach it with comp("<main>").layer("Controls").
    const subCtx: Ctx = { ...ctx, comp: sub, start: 0, end: sub.dur, path: id, counters: new Map() };
    this.walk(p.children, subCtx);
    sub.layers.reverse();
    this.comps.push(sub);
    this.layer('precomp', el, ctx, { precompId: id, id });
  }

  private layer(kind: string, el: AecElement, ctx: Ctx, extra: { precompId?: string; id?: string } = {}): void {
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
    if (p.motionBlur !== undefined) L.motionBlur = p.motionBlur;
    if (p.hidden) L.enabled = false;
    if (p.shy) L.shy = true;
    if (p.guide) L.guide = true;
    if (p.label !== undefined) L.label = p.label;
    if (p.parent) L.parent = p.parent;
    if (p.matte) L.matte = { layer: p.matte.layer, type: p.matte.type ?? 'alpha' };
    if (p.markers) L.markers = p.markers.map((m: any) => ({ t: inT + parseTime(m.t, fps), comment: m.comment, dur: m.duration !== undefined ? parseTime(m.duration, fps) : undefined }));
    const vctx: ValueCtx = { fps, t0: inT, controls: ctx.comp.controls, seed: ctx.seed };
    const anim: Record<string, any> = { ...(p.animate ?? {}) };
    const textAnims: TextUnitsAnim[] = [];
    if (anim.text) { textAnims.push(...(Array.isArray(anim.text) ? anim.text : [anim.text])); delete anim.text; }
    for (const [k, v] of Object.entries(anim)) if (!isAnim(v) && !isControl(v)) throw new Error(`animate.${k} must be an animation (tween/spring/keys/...) or control()`);
    const groups: any[] = [];
    const props: PropSpec[] = [];
    switch (kind) {
      case 'solid':
      case 'adjustment':
        L.solid = { color: rgb(p.color ?? (kind === 'adjustment' ? '#ffffff' : '#000000')), w: p.width ?? ctx.comp.w, h: p.height ?? ctx.comp.h };
        break;
      case 'text': {
        const text = p.text ?? childrenOf(p.children).filter((c) => typeof c === 'string').join('');
        if (!text) this.warnings.push(`[${id}] <Text> has no text`);
        L.text = textDoc(p, text);
        if (p.perCharacter3D) { L.threeD = true; L.threeDPerChar = true; }
        if (isControl(p.color)) props.push({ p: 'ADBE Text Properties/ADBE Text Document', expr: `style.setFillColor((${ctx.comp.controls.use(p.color)}).slice(0, 3));` });
        const ab = anchorBox(p.anchor, 'center');
        if (ab) L.anchorBox = ab;
        for (const ta of textAnims) {
          const r = unitAnimator(ta, vctx, 0, threeD);
          groups.push({ at: 'ADBE Text Properties/ADBE Text Animators', items: [r.group] });
          props.push(...r.moreOptions);
        }
        break;
      }
      case 'shape': {
        const items = shapeItems(p.children, vctx, this.warnings);
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
        if (p.collapse) L.collapse = true;
        break;
      case 'null':
        break;
      default:
        throw new Error(`<${el.type?.displayName ?? kind}> is not a layer`);
    }
    // Transform
    const rest = { x: ctx.comp.w / 2, y: ctx.comp.h / 2, z: 0 };
    for (const k of ['x', 'y', 'z'] as const) if (typeof p[k] === 'number') rest[k] = p[k];
    if (Array.isArray(p.position)) { rest.x = p.position[0]; rest.y = p.position[1]; rest.z = p.position[2] ?? 0; }
    const tProps = { ...p };
    if (typeof p.x === 'number' && !anim.x) delete (tProps as any).x;
    if (typeof p.y === 'number' && !anim.y) delete (tProps as any).y;
    if (typeof p.z === 'number' && !anim.z) delete (tProps as any).z;
    if (Array.isArray(p.position) && !anim.position) delete (tProps as any).position;
    props.unshift(...lowerTransform({ props: tProps, anim, rest, threeD: !!L.threeD }, vctx));
    // Children: effects and masks
    const fx: any[] = [], masks: any[] = [];
    for (const c of childrenOf(p.children)) {
      if (typeof c === 'string') continue;
      const ck = c.type?.aec;
      if (ck === 'effect') fx.push(this.effect(c, vctx, id));
      else if (ck === 'mask') masks.push(this.mask(c, vctx));
      else if (kind !== 'shape') throw new Error(`[${id}] <${c.type?.displayName ?? ck}> can't be a child of <${el.type.displayName}>; only <Effect> and <Mask> can`);
    }
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
  }


  private effect(el: AecElement, vctx: ValueCtx, layerId: string): any {
    const p = el.props;
    const { mn, name } = resolveEffect(p.name);
    const props: PropSpec[] = [];
    for (const [k, v] of Object.entries(p.params ?? {})) {
      if (v && typeof v === 'object' && 'layer' in (v as any) && !isAnim(v) && !isControl(v)) { props.push({ p: k, v }); continue; }
      const val: any = v;
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
      shape = { v: [[x, y], [x + w, y], [x + w, y + h], [x, y + h]], i: [[0, 0], [0, 0], [0, 0], [0, 0]], o: [[0, 0], [0, 0], [0, 0], [0, 0]], c: true };
    } else throw new Error('<Mask> needs path, points or rect');
    const props: PropSpec[] = [{ p: 'ADBE Mask Shape', v: shape }];
    if (p.feather !== undefined) { const s = lowerValue(p.feather, { path: 'ADBE Mask Feather', rest: [0, 0], dims: 2, tol: TOL.px, conv: (v: any) => (typeof v === 'number' ? [v, v] : v) }, vctx); if (s) props.push(s); }
    if (p.expansion !== undefined) { const s = lowerValue(p.expansion, { path: 'ADBE Mask Offset', rest: [0], dims: 1, tol: TOL.px }, vctx); if (s) props.push(s); }
    if (p.opacity !== undefined) { const s = lowerValue(p.opacity, { path: 'ADBE Mask Opacity', rest: [100], dims: 1, tol: TOL.opacity }, vctx); if (s) props.push(s); }
    const MODE: Record<string, string> = { add: 'ADD', subtract: 'SUBTRACT', intersect: 'INTERSECT', none: 'NONE', lighten: 'LIGHTEN', darken: 'DARKEN', difference: 'DIFFERENCE' };
    return { mn: 'ADBE Mask Atom', name: p.name, attrs: { maskMode: MODE[p.mode ?? 'add'], inverted: !!p.inverted }, props };
  }

  private defaultName(kind: string, p: any, id: string): string {
    if (kind === 'text') {
      const t = (p.text ?? childrenOf(p.children).filter((c: any) => typeof c === 'string').join('')).replace(/\s+/g, ' ').trim();
      return t.length > 28 ? t.slice(0, 27) + '…' : t || 'Text';
    }
    const base: Record<string, string> = { solid: 'Solid', null: 'Null', adjustment: 'Adjustment', shape: 'Shape', footage: 'Footage', precomp: 'Precomp' };
    return `${base[kind] ?? kind} ${id.split('.').pop()?.replace(/^\D+/, '') ?? ''}`.trim();
  }
}

export function compileScene(def: SceneDef, opts: CompileOpts = {}): CompileResult {
  return new Compiler(def, opts).compile();
}
