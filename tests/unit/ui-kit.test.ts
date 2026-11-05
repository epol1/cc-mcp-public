// K1 UI kit: components compile to native layers with rig effects, marker-driven state expressions, keys and
// precomps; uiSteps turns a step list into cursor keys/markers and per-component events.
import { describe, expect, it } from 'vitest';
import { compileScene } from '../../src/compile/compile.ts';
import { scene } from '../../src/dsl/scene.ts';
import { jsx } from '../../src/dsl/jsx-runtime.ts';
import { Composition, Solid } from '../../src/dsl/primitives.ts';
import { brand } from '../../src/dsl/brand.ts';
import {
  uiSteps, uiTheme, themeFromBrand, darkTheme, Button, Toggle, Checkbox, Slider, ProgressBar, Input, Tabs, Card, Avatar, Badge,
  Tooltip, Toast, Modal, ListItem, Feed, Cursor, ScrollView, PhoneFrame, TabletFrame, LaptopFrame, BrowserFrame, ScreenInsert,
  modalButtonPoints, sliderPoint, wrapText,
} from '../../src/dsl/ui/index.ts';
import { libObject } from '../../src/aeclib/index.ts';

const build = (...kids: any[]) => compileScene(scene({ name: 'UI', duration: '6s' }, () => jsx(Composition, { children: kids })));
const main = (r: any) => r.ir.comps.find((c: any) => c.id === r.ir.main);
const comp = (r: any, name: string) => r.ir.comps.find((c: any) => c.name === name);
const allLayers = (r: any) => r.ir.comps.flatMap((c: any) => c.layers);
const L = (r: any, id: string) => { const l = allLayers(r).find((x: any) => x.id === id); if (!l) throw new Error(`no layer ${id}`); return l; };
const spec = (l: any, p: string) => (l.props ?? []).find((s: any) => s.p.endsWith(p));
const ex = (l: any, p: string) => spec(l, p)?.expr as string;
const fxOf = (l: any) => (l.groups ?? []).find((g: any) => g.at === 'ADBE Effect Parade')?.items ?? [];
const rig = (l: any, name: string) => fxOf(l).find((f: any) => f.name === name);
/** Expression on a rig param (props are by index "#n"); `n` is the param's 1-based index in the definition. */
const rigExprs = (l: any, name: string) => (rig(l, name)?.props ?? []).filter((s: any) => s.expr).map((s: any) => s.expr as string);
const json = (x: any) => JSON.stringify(x);

describe('theme', () => {
  it('defaults, overrides and brand tokens', () => {
    expect(uiTheme()).toBe(darkTheme);
    expect(uiTheme('light').mode).toBe('light');
    const t = uiTheme({ base: 'light', accent: '#ff5a00', scale: 2, fonts: { bold: 'Inter-Black' } });
    expect(t).toMatchObject({ mode: 'light', accent: '#ff5a00', scale: 2 });
    expect(t.fonts).toMatchObject({ bold: 'Inter-Black', regular: 'Inter-Regular' });
    const b = brand({ colors: { ink: '#0b0d12', accent: '#4683c4' }, fonts: { display: 'Inter-Black', body: 'Inter-Medium' }, live: ['accent'] });
    const o = themeFromBrand(b);
    expect((o.accent as any).$control).toBe(true); // live brand color stays live
    expect(o).toMatchObject({ bg: '#0b0d12', fonts: { bold: 'Inter-Black', regular: 'Inter-Medium' } });
  });
});

describe('uiSteps', () => {
  const targets = { email: [400, 300] as [number, number], buy: [600, 500] as [number, number] };
  const flow = uiSteps([
    { at: 0.8, click: 'email' }, { at: 1.0, type: 'email' },
    { at: 2.5, hover: 'buy' }, { at: 3.0, click: 'buy' },
    { at: 3.2, show: 'toast', hold: 2 }, { at: 3.4, show: 'modal' }, { at: 4.4, hide: 'modal', cue: 'closed' },
    { at: 4.6, click: 'tabs', point: [100, 100], index: 2 }, { at: 5.0, scroll: 'feed', stop: 1 },
  ], { targets, start: [200, 200] });
  it('cursor path: holds, moves that arrive before clicks, clicks', () => {
    const path = flow.cursor.path;
    expect(path[0]).toEqual({ t: 0, p: [200, 200] });
    expect(path[1]).toMatchObject({ t: 0.68, p: [400, 300], easing: 'easeInOutCubic' }); // settles 0.12 s before the click
    expect(path[1].from).toBeLessThan(0.68);
    expect(path[2]).toMatchObject({ t: 2.5, p: [600, 500] });
    expect(flow.cursor.clicks.map((c) => c.t)).toEqual([0.8, 3, 4.6]);
  });
  it('per-component events', () => {
    expect(flow.on('email')).toMatchObject({ clickAt: [0.8], typeAt: [1] });
    const buy = flow.on('buy');
    expect(buy.clickAt).toEqual([3]);
    expect(buy.hover![0][0]).toBe(2.5);
    expect(buy.hover![0][1]).toBeGreaterThan(3); // until the cursor leaves for the tabs
    expect(flow.on('toast').show).toEqual([[3.2, 5.2]]);
    expect(flow.on('modal').show).toEqual([[3.4, 4.4]]);
    expect(flow.on('tabs').selectAt).toEqual([{ t: 4.6, index: 2 }]);
    expect(flow.on('feed').scrollAt).toEqual([{ t: 5, stop: 1, duration: undefined }]);
    expect(flow.cue('closed')).toBe(4.4);
    expect(flow.on('nothing')).toEqual({});
  });
  it('drags press the mouse and key the value; shift moves everything', () => {
    const f = uiSteps([{ at: 1, cursor: [100, 100] }, { at: 1.5, drag: 'vol', to: [300, 100], value: 80, duration: 0.6 }]);
    expect(f.cursor.presses).toEqual([{ t: 1.5, duration: 0.6, target: 'vol' }]);
    expect(f.on('vol')).toMatchObject({ dragging: [[1.5, 2.1]], valueAt: [{ t: 1.5, v: null }, { t: 2.1, v: 80 }] });
    const g = f.shift(2);
    expect(g.on('vol').dragging).toEqual([[3.5, 4.1]]);
    expect(g.cursor.path[0].t).toBe(3);
  });
  it('errors say what to change', () => {
    expect(() => uiSteps([{ at: 1, click: 'nope' }])).toThrow(/targets/);
    expect(() => uiSteps([{ at: 1, hide: 'm' }])).toThrow(/isn't shown/);
  });
});

describe('controls', () => {
  it('Button: shape + label, press/hover markers, Button rig with marker-driven state, live label fit', () => {
    const r = build(Button({ id: 'buy', label: 'Buy now', clickAt: [2], hover: [[1.5, 2.6]], position: [960, 600] }));
    const bg = L(r, 'buy'), label = L(r, 'buy.label');
    expect(bg.type).toBe('shape');
    expect(bg.markers).toEqual([{ t: 2, comment: 'press', dur: undefined }, { t: 1.5, comment: 'hover', dur: 1.1 }]);
    // A component that starts later keeps its states on the flow's times (Sequence-relative), not shifted by `from`.
    const late = build(Button({ id: 'buy', label: 'Buy now', clickAt: [2], position: [960, 600], from: 1.5 }));
    expect(L(late, 'buy')).toMatchObject({ in: 1.5, markers: [{ t: 2, comment: 'press' }] });
    const fx = rig(bg, 'Button');
    expect(fx.mn).toMatch(/^Pseudo\/aec Button /);
    const states = rigExprs(bg, 'Button').join('\n');
    expect(states).toContain('"press"');
    expect(states).toContain('L.spring(');
    expect(states).toMatch(/function aecLib\(\)/); // library inlined
    expect(ex(bg, 'ADBE Scale')).toContain('effect("Button")');
    expect(ex(bg, 'ADBE Vector Rect Size')).toContain('thisComp.layer("Button buy Label").sourceRectAtTime');
    expect(ex(label, 'ADBE Scale')).toContain('thisComp.layer("Button buy").transform.scale');
    expect(label.text.text).toBe('Buy now');
    // absolute position: an Align root with a zero-size box at the point
    const lay = main(r).layouts[0].root;
    expect(lay).toMatchObject({ kind: 'align', at: 'topLeft' });
    expect(lay.children[0]).toMatchObject({ kind: 'box', width: 0, height: 0, offset: [960, 600] });
  });
  it('two instances never collide', () => {
    const r = build(Button({ id: 'a', label: 'OK' }), Button({ id: 'b', label: 'OK' }));
    const names = main(r).layers.map((l: any) => l.name);
    expect(new Set(names).size).toBe(names.length);
  });
  it('Toggle and Checkbox flip on clicks (toggle markers) from their start state', () => {
    const r = build(Toggle({ id: 'wifi', on: true, clickAt: [1], toggleAt: [2], label: 'Wi-Fi', width: 300 }), Checkbox({ id: 'agree', label: 'I agree', clickAt: [1.2] }));
    const tg = L(r, 'wifi');
    expect(tg.markers.map((m: any) => [m.t, m.comment])).toEqual([[1, 'toggle'], [2, 'toggle']]);
    expect(rigExprs(tg, 'Toggle').join()).toContain('effect("Toggle")("Start On")');
    expect(json(tg.groups)).toContain('L.lerp(-10, 10, v)');
    expect(L(r, 'wifi.label').text.text).toBe('Wi-Fi');
    const cb = L(r, 'agree');
    expect(cb.markers[0]).toMatchObject({ t: 1.2, comment: 'toggle' });
    expect(json(cb.groups)).toContain('ADBE Vector Trim End');
  });
  it('Slider and ProgressBar: Value keys on the rig; live value text', () => {
    const r = build(Slider({ id: 'vol', value: 30, valueAt: [{ t: 1, v: null }, { t: 1.6, v: 80 }], dragging: [[1, 1.6]], showValue: true, label: 'Volume' }), ProgressBar({ id: 'up' }));
    const sv = L(r, 'vol');
    const val = rig(sv, 'Slider').props.find((s: any) => s.keys);
    expect(val.keys.map((k: any) => k.v)).toEqual([30, 30, 80]);
    expect(sv.markers[0]).toMatchObject({ comment: 'drag', dur: 0.6 });
    expect(ex(L(r, 'vol.value'), 'ADBE Text Document')).toContain('effect("Slider")("Value")');
    const pk = rig(L(r, 'up'), 'Progress').props.find((s: any) => s.keys);
    expect(pk.keys[0]).toMatchObject({ t: 0.3, v: 0 });
    expect(pk.keys[pk.keys.length - 1]).toMatchObject({ t: 2.6, v: 100 });
    expect(sliderPoint([500, 300], 50, 240)).toEqual([500, 300]);
  });
  it('Input: typing with L.typed from the field\'s type marker, focus ring, placeholder', () => {
    const r = build(Input({ id: 'email', text: 'ada@example.com', placeholder: 'you@company.com', label: 'Email', clickAt: [0.8], typeAt: [1] }));
    const f = L(r, 'email');
    expect(f.markers.map((m: any) => m.comment)).toEqual(['focus', 'type']);
    const typed = ex(L(r, 'email.text'), 'ADBE Text Document');
    expect(typed).toContain('L.typed(s, p,');
    expect(typed).toContain('thisComp.layer("Input email")');
    expect(typed).toMatch(/"typed": function/); // inlined
    expect(ex(L(r, 'email.placeholder'), 'ADBE Opacity')).toContain('"type"');
    expect(L(r, 'email.label').text.text).toBe('Email');
    expect(json(f.groups)).toContain('Focus Color');
    // With an entrance, the placeholder keeps both: the fade keys and the hide-on-typing expression on top of them.
    const ent = build(Input({ id: 'email', text: 'ada@example.com', placeholder: 'you@company.com', typeAt: [1], enterAt: 0.2 }));
    const op = L(ent, 'email.placeholder').props.filter((s: any) => s.p.endsWith('ADBE Opacity'));
    expect(op.find((s: any) => s.keys)?.keys.length).toBeGreaterThan(1);
    expect(op.find((s: any) => s.expr)?.expr).toContain('value * (t0 < 0');
  });
  it('Tabs: "select N" markers (1-based), indicator spring, dimmed labels', () => {
    const r = build(Tabs({ id: 'tabs', tabs: ['A', 'B', 'C'], selected: 1, selectAt: [{ t: 2, index: 2 }] }));
    const tb = L(r, 'tabs');
    expect(tb.markers[0]).toMatchObject({ t: 2, comment: 'select 3' });
    expect(rig(tb, 'Tabs').props.find((s: any) => s.v === 2)).toBeTruthy(); // Start Tab 2 (1-based)
    expect(ex(L(r, 'tabs.tab2'), 'ADBE Opacity')).toContain('Math.abs(x - 2)');
  });
});

describe('display', () => {
  it('Card is a collapsed precomp with a surface and laid-out content', () => {
    const r = build(Card({ id: 'card', title: 'Hello', body: 'World', enterAt: 0.3 }));
    const c = L(r, 'card');
    expect(c.type).toBe('precomp');
    expect(c.collapse).toBe(true);
    expect(fxOf(c)[0].mn).toBeTruthy(); // drop shadow
    const inner = comp(r, 'Card card');
    expect(inner.layers.map((l: any) => l.id)).toEqual(expect.arrayContaining(['card.bg', 'card.title', 'card.body']));
    expect(spec(c, 'ADBE Opacity').keys.length).toBeGreaterThan(1);
  });
  it('Avatar and Badge', () => {
    const r = build(Avatar({ id: 'av', person: 'Ada Lovelace', status: 'online' }), Badge({ id: 'b', label: 'Pro', popAt: 1 }));
    expect(L(r, 'av.initials').text.text).toBe('AL');
    expect(json(L(r, 'av').groups)).toContain('"Status"');
    expect(spec(L(r, 'b'), 'ADBE Scale').keys[0].t).toBe(1);
    expect(ex(L(r, 'b.label'), 'ADBE Scale')).toContain('thisComp.layer("Badge b")');
  });
  it('Toast / Tooltip / Modal: Reveal rig, show markers with durations, spring in / ease out', () => {
    const flow = uiSteps([{ at: 1, show: 'toast', hold: 2.5 }, { at: 2, show: 'modal' }, { at: 4, hide: 'modal' }, { at: 3.5, click: 'modal.primary', point: [960, 700] }]);
    const r = build(Toast({ id: 'toast', flow }), Tooltip({ id: 'tip', text: 'Hi', position: [300, 300], at: 0.5, hold: 2 }), Modal({ id: 'modal', flow }));
    const toast = L(r, 'toast');
    expect(toast.markers).toEqual([{ t: 1, comment: 'show', dur: 2.5 }]);
    expect(rigExprs(toast, 'Reveal').join()).toContain('L.spring(time - T[j]');
    expect(ex(toast, 'ADBE Position')).toContain('effect("Reveal")');
    const tip = L(r, 'tip');
    expect(spec(tip, 'ADBE Anchor Point').v[1]).toBeGreaterThan(30); // the arrow tip is the anchor
    expect(spec(tip, 'ADBE Position').v).toEqual([300, 300]);
    expect(L(r, 'modal.panel').markers).toEqual([{ t: 2, comment: 'show', dur: 2 }]);
    expect(ex(L(r, 'modal.scrim'), 'ADBE Opacity')).toContain('thisComp.layer("Modal modal Panel").effect("Reveal")');
    expect(L(r, 'modal.primary').markers[0]).toMatchObject({ t: 3.5, comment: 'press' });
    const pts = modalButtonPoints({}, [960, 540]);
    expect(pts.primary[0]).toBeGreaterThan(pts.secondary![0]);
  });
  it('Feed: a Cloner of ListItem rows; row data become Essential Properties', () => {
    const r = build(Feed({ id: 'feed', rows: [{ title: 'Ada Lovelace', subtitle: 'Hi', meta: '1m' }, { title: 'Alan Turing', subtitle: 'Yo' }], enterAt: 0.5 }));
    const master = comp(r, 'Feed feed Master');
    expect(master.mgt.props.map((p: any) => p.name)).toEqual(expect.arrayContaining(['Title', 'Subtitle', 'Meta', 'Initials']));
    expect(json(master.layers)).toContain('"eg":"Avatar Color"');
    const inst = L(r, 'feed.inst');
    expect(inst.instances.count).toBe(2);
    expect(ex(inst, 'ADBE Layer Overrides/Title')).toContain('["Ada Lovelace", "Alan Turing"]');
    expect(ex(inst, 'ADBE Layer Overrides/Initials')).toContain('["AL", "AT"]');
    expect(ex(inst, 'ADBE Time Remapping')).toContain('L.stagger(');
    expect(inst.in).toBe(0.5);
    void ListItem;
  });
  it('wrapText breaks long lines', () => {
    expect(wrapText('one two three four five six seven eight', 15, 90).split('\r').length).toBeGreaterThan(2);
  });
});

describe('cursor', () => {
  it('position keys hold at arrivals; click/press markers; ripple and press read them; comp markers', () => {
    const flow = uiSteps([{ at: 1, click: [500, 400], }, { at: 2, cursor: [800, 400] }, { at: 2.5, drag: 'vol', to: [900, 400], duration: 0.5 }], { start: [200, 200] });
    const r = build(Cursor({ id: 'cursor', flow }));
    const c = L(r, 'cursor');
    expect(c.name).toBe('Cursor');
    const pos = spec(c, 'ADBE Position');
    expect(pos.keys[0]).toMatchObject({ t: 0, v: [200, 200], o: 'hold' });
    expect(pos.keys.some((k: any) => Math.abs(k.t - 0.88) < 1e-6)).toBe(true);
    expect(c.markers.map((m: any) => m.comment)).toEqual(['click', 'press vol']);
    expect(c.markers[1].dur).toBe(0.5);
    expect(rigExprs(c, 'Cursor').join()).toContain('m.comment.indexOf("press") == 0');
    const rp = L(r, 'cursor.ripple');
    expect(ex(rp, 'ADBE Position')).toContain('C.transform.position.valueAtTime(T[j])');
    expect(ex(rp, 'ADBE Position')).toContain('var C = thisComp.layer("Cursor");');
    expect(main(r).markers).toEqual([{ t: 1, comment: 'click', dur: undefined }]);
    // the library's typed/since helpers behave as the expressions expect
    const lib = libObject();
    expect(lib.typed('hello', 0.4, '|', 0, 1)).toBe('he|');
  });
  it('touch kind draws a dot', () => {
    const r = build(Cursor({ id: 'finger', kind: 'touch', path: [{ t: 0, p: [100, 100] }] }));
    expect(json(L(r, 'finger').groups)).toContain('"Touch"');
    expect(spec(L(r, 'finger'), 'ADBE Position').v).toEqual([100, 100]);
  });
});

describe('ScrollView, frames, ScreenInsert', () => {
  it('ScrollView: masked viewport precomp, content precomp scrolled by keys between stops', () => {
    const r = build(ScrollView({ id: 'sv', size: [390, 600], contentHeight: 1400, stops: [0, 400, 800], scrollAt: [{ t: 2, stop: 1 }, { t: 4, stop: 2 }], radius: 20, children: jsx(Solid, { id: 'sv.fill', color: '#ff0000' }) }));
    const v = L(r, 'sv');
    expect(json(v.groups)).toContain('ADBE Mask Atom');
    const content = L(r, 'sv.content');
    const ys = spec(content, 'ADBE Position').keys.map((k: any) => k.v[1]);
    expect(ys[0]).toBe(700);
    expect(ys[ys.length - 1]).toBe(700 - 800);
    expect(comp(r, 'ScrollView sv Content').layers.map((l: any) => l.id)).toContain('sv.fill');
  });
  it('frames: device precomp, screen precomp with children and a display mask', () => {
    const r = build(
      PhoneFrame({ id: 'phone', children: jsx(Solid, { id: 'phone.content', color: '#123456' }), enterAt: 0.2 }),
      TabletFrame({ id: 'tab' }), LaptopFrame({ id: 'lap' }), BrowserFrame({ id: 'web', url: 'example.com' }),
    );
    expect(L(r, 'phone').type).toBe('precomp');
    expect(L(r, 'phone').collapse).toBe(true);
    const screen = comp(r, 'Phone phone Screen');
    expect(screen.w).toBe(390);
    expect(screen.layers.map((l: any) => l.id)).toEqual(expect.arrayContaining(['phone.content', 'phone.time', 'phone.home']));
    expect(json(L(r, 'phone.screen').groups)).toContain('ADBE Mask Atom');
    expect(comp(r, 'Phone phone').layers.map((l: any) => l.id)).toEqual(['phone.island', 'phone.screen', 'phone.body']);
    expect(comp(r, 'Tablet tab Screen').w).toBe(1180);
    expect(comp(r, 'Laptop lap').layers.map((l: any) => l.id)).toContain('lap.notch');
    expect(L(r, 'web.url').text.text).toBe('example.com');
  });
  it('ScreenInsert: cover-fit footage zoomed by the Screen Zoom rig around a focus null that follows a cursor', () => {
    const r = build(ScreenInsert({ id: 'rec', src: 'C:/x/rec.mp4', zooms: [{ at: 1, scale: 2 }], follow: 'cursor' }), Cursor({ id: 'cursor', path: [{ t: 0, p: [100, 100] }] }));
    const f = L(r, 'rec');
    expect(f.fit).toBe('cover');
    expect(ex(f, 'ADBE Scale')).toContain('effect("Screen Zoom")("Zoom")');
    expect(ex(f, 'ADBE Position')).toContain('thisComp.layer("Screen rec Focus").transform.position');
    const z = rig(f, 'Screen Zoom').props.find((s: any) => s.keys);
    expect(Math.max(...z.keys.map((k: any) => k.v))).toBe(200);
    expect(ex(L(r, 'rec.focus'), 'ADBE Position')).toContain('thisComp.layer("Cursor")');
  });
});

// The marker-reading expressions, evaluated in Node against a mocked layer (AE's expression engine is JavaScript).
describe('state expressions (evaluated)', () => {
  type Mk = { time: number; comment: string; duration?: number };
  const evalExpr = (code: string, env: { time: number; markers?: Mk[]; fx?: Record<string, Record<string, any>>; value?: any; layers?: Record<string, any> }) => {
    const marker = { numKeys: (env.markers ?? []).length, key: (k: number) => ({ duration: 0, ...env.markers![k - 1] }) };
    const effect = (n: string) => (p: string) => ({ value: env.fx?.[n]?.[p] ?? 0 });
    const thisLayer = { marker, effect };
    const thisComp = { frameDuration: 1 / 30, layer: (n: string) => env.layers?.[n] ?? thisLayer, width: 1920, height: 1080 };
    const mul = (a: any, k: number) => (Array.isArray(a) ? a.map((x) => x * k) : a * k);
    const add = (a: any[], b: any[]) => a.map((x, i) => x + (b[i] ?? 0));
    const sub = (a: any[], b: any[]) => a.map((x, i) => x - (b[i] ?? 0));
    // eslint-disable-next-line no-new-func
    return new Function('time', 'thisLayer', 'thisComp', 'effect', 'value', 'mul', 'add', 'sub', 'return eval(arguments[8]);')(env.time, thisLayer, thisComp, effect, env.value, mul, add, sub, code);
  };
  const r = build(
    Button({ id: 'b', clickAt: [1], hover: [[0.5, 2]] }),
    Toggle({ id: 'tg', clickAt: [1] }),
    Tabs({ id: 'tabs', selectAt: [{ t: 1, index: 2 }] }),
    Toast({ id: 'toast', at: 1, hold: 2 }),
    Input({ id: 'in', text: 'hello', typeAt: [1] }),
  );
  const state = (id: string, fx: string, i: number) => rigExprs(L(r, id), fx)[i];
  it('Button press: down in 90 ms, then springs back; hover ramps in and out', () => {
    const press = state('b', 'Button', 1), hover = state('b', 'Button', 0);
    const m = [{ time: 1, comment: 'press' }, { time: 0.5, comment: 'hover', duration: 1.5 }].sort((a, b) => a.time - b.time);
    expect(evalExpr(press, { time: 0.9, markers: m })).toBe(0);
    expect(evalExpr(press, { time: 1.09, markers: m })).toBeCloseTo(1, 2);
    expect(Math.abs(evalExpr(press, { time: 2.5, markers: m }))).toBeLessThan(0.02);
    expect(evalExpr(hover, { time: 0.4, markers: m })).toBe(0);
    expect(evalExpr(hover, { time: 1.5, markers: m })).toBe(1);
    expect(evalExpr(hover, { time: 2.5, markers: m })).toBe(0);
  });
  it('Toggle flips from its start state; Tabs springs to "select 3"', () => {
    const v = state('tg', 'Toggle', 0);
    const m = [{ time: 1, comment: 'toggle' }];
    expect(evalExpr(v, { time: 0.5, markers: m, fx: { Toggle: { 'Start On': 0 } } })).toBe(0);
    expect(evalExpr(v, { time: 3, markers: m, fx: { Toggle: { 'Start On': 0 } } })).toBeCloseTo(1, 2);
    expect(evalExpr(v, { time: 3, markers: m, fx: { Toggle: { 'Start On': 1 } } })).toBeCloseTo(0, 2);
    const pos = state('tabs', 'Tabs', 0);
    expect(evalExpr(pos, { time: 3, markers: [{ time: 1, comment: 'select 3' }], fx: { Tabs: { 'Start Tab': 1 } } })).toBeCloseTo(2, 2);
  });
  it('Reveal: shows during the marker, hides after it', () => {
    const [show, hide] = rigExprs(L(r, 'toast'), 'Reveal');
    const env = (time: number) => ({ time, markers: [{ time: 1, comment: 'show', duration: 2 }], fx: { Reveal: { Damping: 17, Stiffness: 190, 'Out Duration': 0.28 } } });
    expect(evalExpr(show, env(0.5))).toBe(0);
    expect(evalExpr(show, env(2.5))).toBeCloseTo(1, 2);
    expect(evalExpr(hide, env(2.5))).toBe(0);
    expect(evalExpr(hide, env(3.5))).toBe(1);
  });
  it('Input types the layer\'s own text from the "type" marker', () => {
    const code = ex(L(r, 'in.text'), 'ADBE Text Document');
    const field = { marker: { numKeys: 2, key: (k: number) => [{ time: 0.75, comment: 'focus', duration: 0 }, { time: 1, comment: 'type', duration: 0 }][k - 1] }, effect: (n: string) => (p: string) => ({ value: ({ 'Typing Speed': 10, 'Caret Blink': 1, Focus: 1 } as any)[p] }) };
    const run = (time: number) => evalExpr(code, { time, value: 'hello', layers: { 'Input in': field } });
    expect(run(0.9)).toBe('|');
    expect(run(1.25)).toBe('he|');
    expect(run(2.0).replace('|', '')).toBe('hello');
  });
});
