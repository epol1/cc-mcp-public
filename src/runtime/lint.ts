// Lint sampler: measures every visible text layer of a comp, and of the precomps it shows, over time in comp
// coordinates. The rules that judge the samples live in Node (src/lint). One temporary text layer carries an
// expression that reads sourceRectAtTime + toComp for all of them (exact for parenting, 3D layers, cameras and
// nested precomps, and sourceRectAtTime follows text animators); sampling it with valueAtTime gives one string
// per time. The probe layer is removed again; AEC.lintSample runs in a counted no-op undo group.
import { findComp } from './inspect';
import { tagOf } from './layers';
import { errText } from './util';

export interface LintSampleOpts { step?: number; maxSamples?: number; maxTexts?: number; maxOccluders?: number }

interface Target { L: TextLayer; chain: AVLayer[]; path: string; in0: number; out0: number; shift: number }
interface Occluder { L: AVLayer; kind: string; chain: AVLayer[]; path: string; in0: number; out0: number; shift: number }

const MAX_DEPTH = 3;

function collect(c: CompItem, chain: AVLayer[], prefix: string, out: Target[], max: number): void {
  for (let i = 1; i <= c.numLayers && out.length < max; i++) {
    const L: any = c.layer(i);
    if (!L.enabled || L.guideLayer) continue;
    if (L instanceof TextLayer) {
      // In/out in top-comp time (approximate for stretched or remapped precomps; the sampler is exact).
      let a = L.inPoint, b = L.outPoint, shift = 0;
      for (let k = chain.length - 1; k >= 0; k--) { a = Math.max(chain[k].inPoint, a + chain[k].startTime); b = Math.min(chain[k].outPoint, b + chain[k].startTime); shift += chain[k].startTime; }
      out[out.length] = { L: L, chain: chain, path: prefix + L.name, in0: a, out0: b, shift: shift };
    } else if (L instanceof AVLayer && L.source instanceof CompItem && chain.length < MAX_DEPTH) {
      // Cloner instances are a pattern, not N messages to read (and sampling hundreds of them is slow).
      if (String(L.comment).indexOf(';clone') >= 0) continue;
      const next: AVLayer[] = [];
      for (let k = 0; k < chain.length; k++) next[k] = chain[k];
      next[next.length] = L;
      collect(L.source as CompItem, next, prefix + L.name + ' > ', out, max);
    }
  }
}

/** Expression code: one entry per target, "-" when inactive, "!" on error, else "op,x1,y1,...,x4,y4". */
function probeExpression(targets: (Target | Occluder)[]): string {
  const s: string[] = [
    'function n(v){return Math.round(v*10)/10;}',
    'function on(L,t){return t>=L.inPoint&&t<L.outPoint;}',
    'var o=[];',
  ];
  for (let k = 0; k < targets.length; k++) {
    const T = targets[k], chain = T.chain, all: Layer[] = [];
    for (let i = 0; i < chain.length; i++) all[i] = chain[i];
    all[all.length] = T.L;
    const code: string[] = [];
    // a0 = top-level layer (by index in this comp), a1.. = layers inside the precomp sources.
    code.push('var a0=thisComp.layer(' + all[0].index + '),t0=time;');
    for (let i = 1; i < all.length; i++) code.push('var a' + i + '=a' + (i - 1) + '.source.layer(' + all[i].index + '),t' + i + '=a' + (i - 1) + '.sourceTime(t' + (i - 1) + ');');
    const act: string[] = [], ops: string[] = [];
    for (let i = 0; i < all.length; i++) { act.push('on(a' + i + ',t' + i + ')'); ops.push('a' + i + '.transform.opacity.valueAtTime(t' + i + ')/100'); }
    const last = all.length - 1;
    // Corner → comp point: through the text layer, then out through each enclosing precomp layer.
    let map = 'function P(x,y){var q=a' + last + '.toComp(' + ((T.L as any).threeDLayer ? '[x,y,0]' : '[x,y]') + ',t' + last + ');';
    for (let i = last - 1; i >= 0; i--) map += 'q=a' + i + '.toComp(' + ((all[i] as any).threeDLayer ? '[q[0],q[1],0]' : '[q[0],q[1]]') + ',t' + i + ');';
    map += 'return n(q[0])+","+n(q[1]);}';
    // A 3D text with any corner behind (or at) its comp's camera has no meaningful projection: report it as not
    // on screen ("-"). The camera's own +z axis points where it looks. No camera: AE's default view, skip.
    let behind = '';
    if ((T.L as any).threeDLayer) {
      const cam = last === 0 ? 'thisComp' : 'a' + (last - 1) + '.source';
      behind = 'var cm=null;try{cm=' + cam + '.activeCamera;}catch(e){}' +
        'function B(x,y){if(!cm)return false;var c=cm.fromWorld(a' + last + '.toWorld([x,y,0],t' + last + '),t' + last + ');return c[2]<=1;}';
    }
    code.push('if(!(' + act.join('&&') + ')){o.push("-");}else{' + map + behind +
      'var r=a' + last + '.sourceRectAtTime(t' + last + ',false),op=100*' + ops.join('*') + ';' +
      (behind ? 'if(B(r.left,r.top)||B(r.left+r.width,r.top)||B(r.left+r.width,r.top+r.height)||B(r.left,r.top+r.height)){o.push("-");}else ' : '') +
      'o.push(n(op)+","+P(r.left,r.top)+","+P(r.left+r.width,r.top)+","+P(r.left+r.width,r.top+r.height)+","+P(r.left,r.top+r.height));}');
    s.push('try{' + code.join('') + '}catch(e){o.push("!");}');
  }
  s.push('o.join(";")');
  return s.join('\n');
}

// Per-unit animators hide text in ways sourceRectAtTime can't see (opacity), so their timing is read too.
// ae-compose's Expression Selectors carry a header and live control references; we read the controls' current
// values (so lint follows tweaks made in AE). Hand-built Range Selectors are judged from their Start/End/Offset keys.
const AEC_HEAD = /\/\/ ae-compose: per-(\w+) (reveal|exit)/;
// Control references: `thisComp.layer("Controls").effect("X")(1)` (expression controls), the same with a param name
// for rig effects (`effect("Group")("Param")`), or a rig effect on the layer itself (`effect("Reveal")("Each")`).
const CTRL_REF = /(?:(thisComp|comp\("((?:[^"\\]|\\.)*)"\))\.layer\("((?:[^"\\]|\\.)*)"\)\.)?effect\("((?:[^"\\]|\\.)*)"\)\((1|"(?:[^"\\]|\\.)*")\)(?:\.value)?/g;
const unq = (s: string) => s.replace(/\\(.)/g, '$1');

const clampFn = function (x: number, a: number, b: number): number { return Math.min(b, Math.max(a, x)); };

/** Top-level comma-separated arguments of the call that starts at `from` (just after its "("). */
function callArgs(code: string, from: number): string[] {
  const out: string[] = [];
  let depth = 0, start = from;
  for (let i = from; i < code.length; i++) {
    const ch = code.charAt(i);
    if (ch === '(') depth++;
    else if (ch === ')') { if (depth === 0) { out[out.length] = code.substring(start, i); return out; } depth--; }
    else if (ch === ',' && depth === 0) { out[out.length] = code.substring(start, i); start = i + 1; }
  }
  return out;
}

/**
 * Value of a number expression written by the compiler: literals, live control references, `+ offset`, and the
 * `clamp(ctrl, min, max)` the compiler wraps controls in. NaN when it is anything else.
 */
function evalNum(code: string, home: CompItem, self?: Layer): number {
  const s: string = (code as any).replace(CTRL_REF, function (_m: string, host: string, cname: string, lname: string, ename: string, param: string): string {
    try {
      let L: any = self;
      if (host) {
        let c: any = home;
        if (host !== 'thisComp') { c = null; for (let i = 1; i <= app.project.numItems; i++) { const it = app.project.item(i); if (it instanceof CompItem && it.name === unq(cname)) { c = it; break; } } }
        L = c.layer(unq(lname));
      }
      const fx: any = L.property('ADBE Effect Parade').property(unq(ename));
      const p: any = param === '1' ? fx.property(1) : fx.property(unq(param.substring(1, param.length - 1)));
      return '(' + p.valueAtTime(0, true) + ')';
    } catch (e) { return 'NaN'; }
  });
  const t = s.replace(/clamp\(/g, 'C(');
  if (!/^[\d\s.+\-*\/()eE,C]+$/.test(t)) return NaN;
  try { return +eval('(function (C) { return (' + t + '); })')(clampFn); } catch (e) { return NaN; }
}

function aecAnim(code: string, home: CompItem, self?: Layer): any {
  const h = AEC_HEAD.exec(code);
  if (!h) return null;
  const o: any = { by: h[1], dir: h[2] === 'exit' ? 'out' : 'in' };
  const m = /var each = (.*), dur = Math\.max\((.*), 0\.0001\), delay = (.*);/.exec(code);
  if (!m) return null;
  o.each = evalNum(m[1], home, self); o.dur = evalNum(m[2], home, self); o.delay = evalNum(m[3], home, self);
  const ord = /var i = (.*);/.exec(code), oi = ord ? ord[1] : '';
  o.order = oi === 'textIndex - 1' ? 'start' : oi === 'textTotal - textIndex' ? 'end' : oi.indexOf('seedRandom') >= 0 ? 'random' : oi.indexOf('(textTotal - 1) / 2 -') === 0 ? 'edges' : 'center';
  const tl = /var t = time - (inPoint|outPoint)(?: - ([\d.]+))?/.exec(code);
  o.anchor = tl && tl[1] === 'outPoint' ? 'end' : 'start';
  o.off = tl && tl[2] ? +tl[2] : 0;
  // Library calls (D73) and the inlined helpers of projects built before the library.
  const SP = ['L.spring(t, 1 / thisComp.frameDuration, ', 'su(t * fps, fps, '];
  for (let k = 0; k < SP.length; k++) {
    const si = code.indexOf(SP[k]);
    if (si >= 0) { const a = callArgs(code, si + SP[k].length); if (a.length === 3) o.spring = [evalNum(a[0], home, self), evalNum(a[1], home, self), evalNum(a[2], home, self)]; break; }
  }
  const bz = /(?:L\.bezier|bz)\(([-\d.e]+), ([-\d.e]+), ([-\d.e]+), ([-\d.e]+), t \/ dur\)/.exec(code);
  if (bz) o.bezier = [+bz[1], +bz[2], +bz[3], +bz[4]];
  return o;
}

/** Intervals (comp time of the layer's comp) where a hand-built range selector hides most of the text by opacity. */
function rangeHidden(S: any, opacity: number): number[][] {
  if (opacity > 50) return [];
  const st = S.property('ADBE Text Percent Start'), en = S.property('ADBE Text Percent End'), of = S.property('ADBE Text Percent Offset');
  const ts: number[] = [];
  const addKeys = (p: any) => { if (p && p.numKeys) for (let k = 1; k <= p.numKeys; k++) ts[ts.length] = p.keyTime(k); };
  addKeys(st); addKeys(en); addKeys(of);
  if (!ts.length) return [];
  ts.sort(function (a, b) { return a - b; });
  const frac = (t: number) => {
    const o = of ? of.valueAtTime(t, true) : 0;
    const a = Math.max(0, Math.min(100, st.valueAtTime(t, true) + o)), b = Math.max(0, Math.min(100, en.valueAtTime(t, true) + o));
    return Math.max(0, b - a) / 100;
  };
  // Hidden where at least half the text is selected (selected = at the animator's low opacity).
  const out: number[][] = [];
  let prevT = -1e9, prevF = frac(ts[0] - 1e-3), start: number | null = prevF >= 0.5 ? -1e9 : null;
  for (let k = 0; k <= ts.length; k++) {
    const t = k < ts.length ? ts[k] : ts[ts.length - 1] + 1e-3, f = frac(t);
    if ((prevF >= 0.5) !== (f >= 0.5)) {
      const x = prevT < -1e8 ? t : prevT + (t - prevT) * (0.5 - prevF) / (f - prevF);
      if (f >= 0.5) start = x; else { out[out.length] = [start === null ? -1e9 : start, x]; start = null; }
    }
    prevT = t; prevF = f;
  }
  if (start !== null) out[out.length] = [start, 1e9];
  return out;
}

function animatorTiming(T: Target, o: any): void {
  const anims: any = T.L.property('ADBE Text Properties').property('ADBE Text Animators');
  if (!anims) return;
  const home = T.L.containingComp;
  for (let i = 1; i <= anims.numProperties; i++) {
    const A: any = anims.property(i);
    if (!A.enabled) continue;
    const sels: any = A.property('ADBE Text Selectors');
    let opacity = 100;
    try { const op = A.property('ADBE Text Animator Properties').property('ADBE Text Opacity'); if (op) opacity = op.valueAtTime(0, true); } catch (e) {}
    for (let j = 1; sels && j <= sels.numProperties; j++) {
      const S: any = sels.property(j);
      if (!S.enabled) continue;
      if (S.matchName === 'ADBE Text Expressible Selector') {
        const amt = S.property('ADBE Text Expressible Amount');
        const a = amt && amt.expressionEnabled ? aecAnim(String(amt.expression), home, T.L) : null;
        if (a) { if (!o.anims) o.anims = []; o.anims[o.anims.length] = a; }
      } else if (S.matchName === 'ADBE Text Selector') {
        const h = rangeHidden(S, opacity);
        for (let k = 0; k < h.length; k++) { if (!o.hidden) o.hidden = []; o.hidden[o.hidden.length] = [h[k][0] + T.shift, h[k][1] + T.shift]; }
      }
    }
  }
}

function textInfo(T: Target, mid: number): any {
  const p: any = T.L.property('ADBE Text Properties').property('ADBE Text Document');
  // in/out: visible range in top-comp time; lin/lout: the layer's own in/out point mapped to top-comp time.
  const o: any = { path: T.path, name: T.L.name, id: tagOf(T.L), in: T.in0, out: T.out0, lin: T.L.inPoint + T.shift, lout: T.L.outPoint + T.shift, threeD: !!(T.L as any).threeDLayer };
  try {
    const d: any = p.expressionEnabled && p.expression ? p.valueAtTime(mid, false) : p.valueAtTime(mid, true);
    const txt = String(d.text);
    o.text = txt.length > 80 ? txt.substring(0, 77) + '...' : txt;
    o.words = 0;
    const parts = txt.split(/\s+/);
    // Words = tokens with a letter or digit (an arrow or a bullet is not read as a word).
    for (let i = 0; i < parts.length; i++) if (/[0-9A-Za-zÀ-ɏͰ-ϿЀ-ӿ֐-ۿ぀-ヿ一-鿿가-힯]/.test(parts[i])) o.words++;
    o.font = d.font;
    o.size = d.fontSize;
    try { if (d.fontObject && d.fontObject.isSubstitute) o.substitute = true; } catch (e) {}
    if (d.boxText) { o.box = true; try { o.overflow = !!d.boxOverflow; } catch (e) {} }
    o.units = { char: txt.length, charNoSpaces: txt.replace(/\s/g, '').length, word: o.words, line: txt.split(/\r\n|\r|\n/).length, firstWord: (txt.replace(/^\s+/, '').split(/\s/)[0] || '').length };
    animatorTiming(T, o);
  } catch (e) { o.err = errText(e); }
  return o;
}

/**
 * 2D layers stacked above the comp's top-level 2D texts that could cover them: normal blend mode, not adjustment,
 * guide or 3D. Solids with effects (particles, generators) and precomps are skipped: their pixels aren't their
 * bounds. Kinds: solid and footage (opaque) are reliable; footage with alpha and shapes only by their bounding box.
 */
function occluders(c: CompItem, texts: Target[], max: number): Occluder[] {
  let top = 0;
  for (let k = 0; k < texts.length; k++) if (!texts[k].chain.length && !(texts[k].L as any).threeDLayer) top = Math.max(top, texts[k].L.index);
  const out: Occluder[] = [];
  for (let i = 1; i < top && out.length < max; i++) {
    const L: any = c.layer(i);
    if (!(L instanceof AVLayer) || L instanceof TextLayer) continue;
    if (!L.enabled || L.guideLayer || L.adjustmentLayer || L.threeDLayer || L.blendingMode !== BlendingMode.NORMAL) continue;
    const fx: any = L.property('ADBE Effect Parade');
    const hasFx = !!fx && fx.numProperties > 0;
    let kind = '';
    if (L instanceof ShapeLayer) kind = 'shape';
    else if (L.source instanceof CompItem) continue; // a precomp's bounds say nothing about its pixels (transitions, overlays)
    else if (L.source && L.source.mainSource instanceof SolidSource) { if (hasFx) continue; kind = 'solid'; }
    else if (L.source && L.source.mainSource) kind = L.source.mainSource.hasAlpha || hasFx ? 'footage-alpha' : 'footage';
    else continue;
    out[out.length] = { L: L, kind: kind, chain: [], path: L.name, in0: L.inPoint, out0: L.outPoint, shift: 0 };
  }
  return out;
}

/** Position/scale keys whose moving segments are all linear (motion that feels mechanical), top-level layers. */
function linearMoves(c: CompItem): any[] {
  const out: any[] = [];
  const names = ['ADBE Position', 'ADBE Position_0', 'ADBE Position_1', 'ADBE Position_2', 'ADBE Scale'];
  for (let i = 1; i <= c.numLayers; i++) {
    const L: any = c.layer(i);
    if (!L.enabled || L.guideLayer) continue;
    const tr = L.property('ADBE Transform Group');
    if (!tr) continue;
    for (let k = 0; k < names.length; k++) {
      let p: any = null;
      try { p = tr.property(names[k]); } catch (e) {}
      if (!p || !p.numKeys || p.numKeys < 2 || (p.expressionEnabled && p.expression)) continue;
      // Separated dimensions: the combined Position is hidden (its keys are stale); otherwise X/Y/Z Position are.
      try { const sep = tr.property('ADBE Position').dimensionsSeparated; if ((names[k] === 'ADBE Position') === !!sep) continue; } catch (e) {}
      let moving = 0, linear = 0;
      for (let j = 1; j < p.numKeys; j++) {
        if (String(p.keyValue(j)) === String(p.keyValue(j + 1))) continue;
        moving++;
        if (p.keyOutInterpolationType(j) === KeyframeInterpolationType.LINEAR && p.keyInInterpolationType(j + 1) === KeyframeInterpolationType.LINEAR) linear++;
      }
      // Dense linear keys are a baked curve (sampled motion), linear on purpose.
      const span = p.keyTime(p.numKeys) - p.keyTime(1);
      const baked = moving >= 4 && span / (p.numKeys - 1) <= 0.15;
      if (moving > 0 && linear === moving && !baked) out[out.length] = { layer: L.name, id: tagOf(L), prop: p.name, segments: moving, t: [p.keyTime(1), p.keyTime(p.numKeys)] };
    }
  }
  return out;
}

export function lintSample(ref: any, opts: LintSampleOpts): any {
  const t0 = new Date().getTime();
  const c = ref instanceof CompItem ? ref : findComp(ref);
  if (!c) return { ok: false, error: 'comp not found: ' + ref };
  const o: any = { ok: true, comp: c.name, itemId: c.id, w: c.width, h: c.height, fps: c.frameRate, dur: c.duration, texts: [], times: [], linear: linearMoves(c) };
  const targets: Target[] = [];
  collect(c, [], '', targets, opts.maxTexts || 60);
  o.truncated = targets.length >= (opts.maxTexts || 60);
  if (!targets.length) { o.ms = new Date().getTime() - t0; return o; }

  // Sample times: every `step` seconds (snapped to frames) while any text can be on screen.
  const fd = c.frameDuration, nFrames = Math.max(1, Math.round(c.duration / fd));
  let stepF = Math.max(1, Math.round((opts.step || 0.1) / fd));
  const maxS = opts.maxSamples || 240;
  if (nFrames / stepF > maxS) stepF = Math.ceil(nFrames / maxS);
  for (let f = 0; f < nFrames; f += stepF) {
    const t = f * fd;
    for (let k = 0; k < targets.length; k++) if (t >= targets[k].in0 - fd / 2 && t < targets[k].out0) { o.times[o.times.length] = t; break; }
  }
  o.step = stepF * fd;
  for (let k = 0; k < targets.length; k++) {
    o.texts[k] = textInfo(targets[k], (targets[k].in0 + targets[k].out0) / 2);
    if (!targets[k].chain.length && !(targets[k].L as any).threeDLayer) o.texts[k].idx = targets[k].L.index;
  }
  const occ = occluders(c, targets, opts.maxOccluders || 30);
  const all: (Target | Occluder)[] = [];
  for (let k = 0; k < targets.length; k++) all[all.length] = targets[k];
  for (let k = 0; k < occ.length; k++) all[all.length] = occ[k];
  o.occluders = [];
  for (let k = 0; k < occ.length; k++) o.occluders[k] = { name: occ[k].L.name, idx: occ[k].L.index, kind: occ[k].kind, s: [] };

  const probe: any = c.layers.addText('');
  try {
    // Bottom of the stack, before anything evaluates: existing layer indices never change, so expressions that
    // address layers by number (thisComp.layer(3)) keep pointing at the right layer while we sample.
    probe.moveToEnd();
    probe.name = '__aec_lint_probe';
    probe.enabled = false;
    const sp: any = probe.property('ADBE Text Properties').property('ADBE Text Document');
    sp.expression = probeExpression(all);
    const rows: string[] = [];
    for (let i = 0; i < o.times.length; i++) {
      rows[i] = String(sp.valueAtTime(o.times[i], false).text);
      if (i === 0 && sp.expressionError) return { ok: false, error: 'lint probe expression failed: ' + sp.expressionError };
    }
    // Per text: one entry per sample time, null when inactive/unmeasurable, else [opacity, x1, y1, ..., x4, y4].
    for (let k = 0; k < targets.length; k++) o.texts[k].s = [];
    for (let i = 0; i < rows.length; i++) {
      const cells = rows[i].split(';');
      for (let k = 0; k < all.length; k++) {
        const dest = k < targets.length ? o.texts[k].s : o.occluders[k - targets.length].s;
        const cell = cells[k];
        if (cell === undefined || cell === '-' || cell === '!' || cell === '') { dest[i] = null; continue; }
        const nums = cell.split(','), v: number[] = [];
        for (let j = 0; j < nums.length; j++) v[j] = +nums[j];
        dest[i] = v;
      }
    }
  } finally {
    probe.remove();
  }
  o.ms = new Date().getTime() - t0;
  return o;
}
