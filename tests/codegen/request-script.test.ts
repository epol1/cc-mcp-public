// Codegen: request scripts (preamble + AEC.<fn>(<ES3 literal>)) for compiled scenes must be strict ES3, the
// shipped runtime must be strict ES3, and the IR of a small scene is pinned by a (normalized) snapshot.
import { afterAll, describe, expect, it, vi } from 'vitest';

// Gradient presets are written under the home dir at compile time: use a temp home (set before gradients.ts loads).
const TMP_HOME = vi.hoisted(() => {
  const base = (process.env.TEMP || process.env.TMPDIR || '/tmp').replace(/\\/g, '/');
  const dir = `${base}/aec-test-home-codegen-${process.pid}`;
  const saved = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE };
  process.env.HOME = dir;
  process.env.USERPROFILE = dir;
  return { dir, saved };
});

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'acorn';
import { simple } from 'acorn-walk';
import { jsx } from '../../src/dsl/jsx-runtime.ts';
import {
  scene, Composition, Sequence, Series, Precomp, Solid, Null, Adjustment, Text, Shape, Footage, Camera, Light, Rect, Ellipse, Path, Fill, Stroke,
  GradientFill, GradientStroke, Trim, Repeater, Group, Effect, Mask, Column, SafeArea, Align, Stack, ParticleWorld, PixelPolly, OrbitCamera,
  control, tween, spring, keys, wiggle, perWord, textPresets,
} from '../../src/dsl/index.ts';
import { compileScene } from '../../src/compile/compile.ts';
import type { SceneDef } from '../../src/dsl/scene.ts';
import { toEs3Literal } from '../../src/codegen/literal.ts';
import { ensurePreamble, runtimeVersion, RUNTIME_FILE } from '../../src/bridge/index.ts';
import { compileEditOps } from '../../src/edit/ops.ts';

afterAll(() => {
  fs.rmSync(TMP_HOME.dir, { recursive: true, force: true });
  for (const [k, v] of Object.entries(TMP_HOME.saved)) if (v === undefined) delete process.env[k]; else process.env[k] = v;
});

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ES3 = { ecmaVersion: 3, sourceType: 'script', allowReserved: 'never' } as const;
const h = (type: any, props: Record<string, any> | null = {}, ...children: any[]) =>
  jsx(type, children.length ? { ...(props ?? {}), children: children.length === 1 ? children[0] : children } : { ...(props ?? {}) });

// ---- Realistic scenes (mirroring examples/01-kinetic-type and scratch/p3/test*.tsx) ----
const kinetic = scene({ name: 'KineticType', width: 1920, height: 1080, fps: 30, duration: '6s', bg: '#0b0d12' }, () => {
  const stagger = control('Word Stagger', 0.09, { min: 0, max: 0.5 });
  const delay = control('Title Delay', 0.3, { min: 0, max: 3 });
  const accent = control('Accent Color', '#4683c4');
  return h(Composition, {},
    h(Solid, { name: 'BG', color: '#0b0d12' }),
    h(Shape, { name: 'Accent Bar', x: 960, y: 640, animate: { scale: spring({ from: [0, 100], delay: 0.7, damping: 15, stiffness: 140 }) } }, h(Rect, { size: [560, 10], roundness: 5 }), h(Fill, { color: accent })),
    h(Text, { font: 'Inter-Black', size: 150, tracking: -10, y: 480, animate: { text: perWord({ from: { y: 120, opacity: 0 }, spring: { damping: 12, stiffness: 160 }, each: stagger, delay }) } }, 'MAKE IT MOVE'),
    h(Text, { font: 'Inter-Medium', size: 46, y: 740, color: '#9aa4b2', animate: { text: textPresets.fadeUp('char', { each: '18ms', delay: 1.1, duration: '0.5s' }) } }, 'Native After Effects, written in code — “ünïcödé”'),
  );
});
const layout = scene({ name: 'TestLayout', duration: '3s', bg: '#0e1117' }, () => h(Composition, {},
  h(Solid, { color: '#0e1117' }),
  h(Column, { gap: 28 },
    h(Text, { font: 'Inter-Black', size: 120, animate: { text: perWord({ from: { y: 80, opacity: 0 }, spring: { damping: 13, stiffness: 170 }, each: '80ms' }) } }, 'LAYOUT, SOLVED'),
    h(Text, { font: 'Inter-Regular', size: 44, color: '#8b95a5', animate: { y: spring({ from: 40, delay: 0.5 }), opacity: tween({ from: 0, duration: '0.5s', delay: 0.5 }) } }, 'Measured in After Effects'),
  ),
  h(SafeArea, { kind: 'title' }, h(Align, { at: 'bottomLeft' }, h(Stack, { gap: 10, align: 'start' },
    h(Shape, { animate: { scale: spring({ from: [0, 100], delay: 1 }) }, anchor: 'left' }, h(Rect, { size: [340, 8] }), h(Fill, { color: '#4683c4' })),
    h(Text, { font: 'Inter-Bold', size: 56, align: 'left', anchor: 'left' }, 'Evan'),
  ))),
));
const particles = scene({ name: 'TestParticles', width: 1280, height: 720, duration: '3s', bg: '#07080c' }, () => h(Composition, {},
  h(Solid, { color: '#07080c' }),
  h(ParticleWorld, { id: 'dust', preset: 'dustBokeh' }),
  h(Null, { id: 'comet', name: 'Comet', animate: { position: keys({ t: 0, v: [150, 560], easing: 'easeInOutCubic' }, { t: 2.6, v: [1130, 180] }) } }),
  h(ParticleWorld, { id: 'trail', preset: 'energyTrail', emitter: { follow: 'comet' } }),
  h(ParticleWorld, { id: 'confetti', preset: 'confettiBurst', burst: { at: 1.2, duration: 0.2, rate: 14 } }),
  h(PixelPolly, { params: { Force: 120, Gravity: 1 } }, h(Text, { id: 'title', font: 'Inter-Black', size: 110, y: 360 }, 'BREAK IT')),
));
const threeD = scene({ name: 'Test3D', width: 1280, height: 720, duration: '4s', bg: '#101216' }, () => h(Composition, {},
  h(Solid, { id: 'floor', name: 'Floor', color: '#2a2e36', width: 3000, height: 3000, threeD: true, position: [640, 520, 0], rotationX: 90, material: { acceptsShadows: true } }),
  h(Text, { id: 'logo', name: 'Logo', font: 'Inter-Black', size: 220, color: '#e8833a', threeD: true, position: [640, 400, 0], geometry: { extrusion: 60, bevel: { style: 'convex', depth: 6 } }, material: { castsShadows: true } }, 'AE'),
  h(Light, { id: 'env', kind: 'environment', hdri: '/assets/hdri/studio_small_02_2k.hdr', intensity: 80, backgroundVisible: false }),
  h(Light, { id: 'key', kind: 'spot', intensity: 120, position: [300, 100, -700], lookAt: 'logo', castsShadows: true, shadowDarkness: 60, coneAngle: 60 }),
  h(OrbitCamera, { target: [640, 420, 0], radius: 1100, height: 250, speed: control('Orbit Speed', 18), startAngle: -25, lens: 50, dof: true, focusOn: 'logo', fStop: 2.8 }),
));
const gradients = scene({ name: 'TestGradient', width: 1280, height: 720, duration: '1s' }, () => h(Composition, {},
  h(Shape, { x: 420, y: 360 }, h(Rect, { size: [460, 300], roundness: 36 }), h(GradientFill, { type: 'linear', start: [-230, 0], end: [230, 0], stops: [{ offset: 0, color: '#4683c4' }, { offset: 0.5, color: '#7a3cff' }, { offset: 1, color: '#ff5a8a' }] })),
  h(Shape, { x: 960, y: 360 }, h(Ellipse, { size: [300, 300] }), h(GradientStroke, { type: 'radial', width: 24, start: [0, 0], end: [150, 0], stops: [{ offset: 0, color: '#ffd23f' }, { offset: 1, color: '#ee4266' }] })),
));
const live = scene({ name: 'TestLive', width: 1280, height: 720, duration: '4s' }, () => h(Composition, {},
  h(Solid, { color: '#101216' }),
  h(Text, { id: 't', name: 'Title', font: 'Inter-Bold', size: 90, y: 360, animate: { y: tween({ from: control('Rise', 80), duration: control('Rise Duration', 0.6), delay: control('Rise Delay', 0.2), easing: 'easeOutCubic' }) } }, 'LIVE'),
));
const variants = scene({
  name: 'TestVariants', duration: '3s', params: { accent: '#4683c4', damping: 12, headline: 'SAY IT LOUD' },
  variants: { A: { accent: '#4683c4', damping: 8 }, B: { accent: '#ee4266', damping: 14 }, C: { accent: '#2ec4b6', damping: 22, headline: 'SAY IT CLEAR' } },
}, (p: any) => h(Composition, {},
  h(Solid, { color: '#0e1117' }),
  h(Column, { gap: 30 },
    h(Text, { font: 'Inter-Black', size: 150, animate: { text: perWord({ from: { y: 120, opacity: 0 }, spring: { damping: p.damping, stiffness: 170 }, each: control('Word Stagger', 0.08) }) } }, p.headline),
    h(Shape, { animate: { scale: spring({ from: [0, 100], delay: 0.6, damping: p.damping }) } }, h(Rect, { size: [600, 12], roundness: 6 }), h(Fill, { color: p.accent })),
  ),
));
const kitchenSink = scene({ name: 'Kitchen Sink', duration: 8, motionBlur: { shutterAngle: 270 } }, () => h(Composition, {},
  h(Series, {},
    h(Series.Sequence, { duration: 2, name: 'Intro' }, h(Footage, { id: 'clip', src: '/media/hero.mov', trim: [1, 3], fit: 'cover' }, h(Mask, { path: 'M0 0 L100 0 L100 100 Z', feather: 20, mode: 'add' }))),
    h(Series.Sequence, { duration: 3 },
      h(Precomp, { id: 'card', width: 600, height: 400, bg: '#202020' }, h(Shape, {}, h(Group, { name: 'G' }, h(Path, { d: 'M0 0 C 50 -50 100 50 150 0', name: 'Wave' }), h(Stroke, { width: 3, dash: [10, 4] }), h(Trim, { end: tween({ from: 0, to: 100, duration: 1 }) })), h(Repeater, { copies: 4 })))),
  ),
  h(Sequence, { from: 1 }, h(Adjustment, { motionBlur: 'force' }, h(Effect, { name: 'Glow', params: { 'Glow Radius': wiggle(1, 10) } }))),
  h(Camera, { id: 'cam', lens: 35 }),
  h(Text, { id: 'label', box: { width: 500 }, runs: [{ start: 0, end: 3, color: '#ff0000' }], animate: { rotation: spring({ to: 15, rig: 'expression' }) } }, 'Hello world'),
));

const SCENES: [string, SceneDef<any>, any?][] = [
  ['kinetic type', kinetic], ['layout', layout], ['particles', particles], ['3D', threeD], ['gradients', gradients],
  ['live controls', live], ['variant C', variants, { variant: 'C', params: variants.config.variants!.C }], ['kitchen sink', kitchenSink],
];

function allExpressions(o: any, out: string[] = []): string[] {
  if (!o || typeof o !== 'object') return out;
  if (Array.isArray(o)) { for (const x of o) allExpressions(x, out); return out; }
  for (const [k, v] of Object.entries(o)) { if (k === 'expr' && typeof v === 'string') out.push(v); else allExpressions(v, out); }
  return out;
}

describe('request scripts parse as strict ES3', () => {
  it('the preamble loads the runtime by version and is ES3 on its own', () => {
    const pre = ensurePreamble();
    expect(pre).toContain(`$.global.AEC.version !== ${JSON.stringify(runtimeVersion())}`);
    expect(pre).toContain(JSON.stringify(RUNTIME_FILE.replace(/\\/g, '/')));
    expect(() => parse(pre, ES3 as any)).not.toThrow();
  });
  for (const [label, def, opts] of SCENES) {
    it(`AEC.build(<IR>) for the ${label} scene`, () => {
      const { ir } = compileScene(def, opts);
      const script = ensurePreamble() + 'AEC.build(' + toEs3Literal(ir) + ', {});';
      expect(() => parse(script, ES3 as any)).not.toThrow();
      expect(script).toMatch(/^[\x09\x0a\x0d\x20-\x7e]*$/); // pure ASCII on the wire
      // the literal is the IR, losslessly
      expect(JSON.parse(toEs3Literal(ir))).toEqual(JSON.parse(JSON.stringify(ir)));
    });
    it(`every expression in the ${label} IR is valid JavaScript with no unresolved placeholders`, () => {
      const { ir } = compileScene(def, opts);
      for (const e of allExpressions(ir)) {
        expect(e).not.toMatch(/__AEC_(LAYER|CONTROL)\(/);
        expect(() => parse(e, { ecmaVersion: 2020, sourceType: 'script', allowReturnOutsideFunction: true }), e.slice(0, 200)).not.toThrow();
      }
    });
  }
  it('every variant of a scene compiles to a valid script', () => {
    for (const k of Object.keys(variants.config.variants!)) {
      const { ir } = compileScene(variants, { variant: k, params: variants.config.variants![k] });
      expect(ir.comps.at(-1).name).toBe(`TestVariants_v001_${k}`);
      expect(() => parse(ensurePreamble() + 'AEC.build(' + toEs3Literal(ir) + ', {"replace":true});', ES3 as any)).not.toThrow();
    }
  });
  it('AEC.edit(...) scripts from compiled edit ops parse as ES3', async () => {
    const ops = await compileEditOps({ ops: [
      { op: 'ease', layer: 'promo.text0', prop: 'opacity', easing: 'snappy' },
      { op: 'set', layer: 'Title', prop: 'position', keys: [{ t: 0, v: [0, 0] }, { t: '1s', v: [100, 50], hold: true }, { t: 2, v: [0, 0] }] },
      { op: 'addEffect', layer: 2, effect: 'Glow', params: { 'Glow Colors': 1 } },
      { op: 'text', layer: 't', text: 'Ünïcödé text', color: 'hsl(210, 52%, 52%)' },
      { op: 'path', layer: 's', prop: 'Contents/Path 1/Path', d: 'M0 0 Q 50 100 100 0 Z' },
    ] as any });
    const script = ensurePreamble() + `AEC.edit(${toEs3Literal({ comp: 'Promo_v001' })}, ${toEs3Literal(ops)}, {});`;
    expect(() => parse(script, ES3 as any)).not.toThrow();
  });
});

describe('ES3 runtime (dist/runtime/aec-runtime.jsx)', () => {
  const code = fs.readFileSync(path.join(ROOT, 'dist/runtime/aec-runtime.jsx'), 'utf8');
  it('parses as strict ES3', () => {
    expect(() => parse(code, ES3 as any)).not.toThrow();
  });
  it('declares the AEC entry points the bridge calls, and the version the preamble checks', () => {
    const ast = parse(code, ES3 as any);
    let members: string[] = [];
    let version: string | undefined;
    simple(ast as any, {
      ObjectExpression(n: any) {
        const keys = n.properties.map((p: any) => p.key.name ?? p.key.value);
        const v = n.properties.find((p: any) => (p.key.name ?? p.key.value) === 'version' && p.value.type === 'Literal');
        if (v && keys.includes('build')) { members = keys; version = v.value.value; }
      },
    });
    expect(members).toEqual(expect.arrayContaining(['version', 'build', 'inspect', 'edit', 'ping']));
    expect(version).toBe(runtimeVersion());
  });
  it('has no ES5+ syntax or helpers the ES3 post-pass bans', () => {
    for (const banned of ['_toConsumableArray', '_slicedToArray', '_createForOfIteratorHelper', 'Symbol.iterator', '_asyncToGenerator']) expect(code).not.toContain(banned);
    expect(code).not.toMatch(/^\s*\/\/@/m); // "//@..." lines are ExtendScript preprocessor directives
  });
});

// ---- Snapshot of the normalized IR (numbers rounded, absolute paths reduced to file names) ----
function normalize(o: any): any {
  if (typeof o === 'number') return Number.isInteger(o) ? o : +o.toFixed(6);
  if (typeof o === 'string') return /^([A-Za-z]:)?[\\/]/.test(o) && /[\\/]/.test(o) ? `<path>/${o.split(/[\\/]/).pop()}` : o;
  if (Array.isArray(o)) return o.map(normalize);
  if (o && typeof o === 'object') return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined).map(([k, v]) => [k, normalize(v)]));
  return o;
}

describe('IR snapshots', () => {
  const small = scene({ name: 'Snap', width: 1280, height: 720, fps: 30, duration: '3s', bg: '#101216' }, () => h(Composition, {},
    h(Solid, { id: 'bg', name: 'BG', color: '#101216' }),
    h(Shape, { id: 'bar', x: 640, y: 420, animate: { scale: tween({ from: [0, 100], to: [100, 100], duration: 0.5, easing: 'easeOutCubic' }) } }, h(Rect, { size: [400, 8], roundness: 4 }), h(Fill, { color: control('Accent', '#4683c4') })),
    h(Text, { id: 'title', font: 'Inter-Bold', size: 96, y: 320, animate: { text: perWord({ from: { y: 40, opacity: 0 }, easing: 'easeOutQuart', each: '60ms' }), opacity: tween({ to: 0, delay: 2.5, duration: 0.5, easing: 'easeInCubic' }) } }, 'Hello Snapshot'),
  ));
  it('small scene IR', () => {
    const r = compileScene(small);
    expect(r.warnings).toEqual([]);
    expect(normalize(r.ir)).toMatchSnapshot();
  });
  it('small scene request payload', () => {
    expect(toEs3Literal(normalize(compileScene(small, { variant: 'B', version: 4 }).ir))).toMatchSnapshot();
  });
});
