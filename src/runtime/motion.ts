// Motion sampler (A1/A2): comp-space transforms of the top-level layers over time, for motion previews (speed
// graphs) and style lint (src/motion). Like the lint sampler, one temporary text layer carries an expression that
// measures every target with toComp (ExtendScript has no toComp); reading its Source Text at a time gives one row.
// Per layer and sample: anchor point in comp pixels, effective scale (parents included), rotation, opacity, bounds.
import { commentTags, tagOf } from './layers';

export interface MotionSampleOpts { step?: number; maxSamples?: number; maxLayers?: number; clonesPerGroup?: number; budgetMs?: number }

interface Target { L: Layer; kind: string; tags: string[] }

function kindOf(L: any): string {
  if (L instanceof TextLayer) return 'text';
  if (L instanceof ShapeLayer) return 'shape';
  if (L instanceof CameraLayer) return 'camera';
  if (L instanceof LightLayer) return 'light';
  if (L.adjustmentLayer) return 'adjustment';
  if (L.nullLayer) return 'null';
  const src = L.source;
  if (src instanceof CompItem) return 'precomp';
  if (src && src.mainSource instanceof SolidSource) return 'solid';
  if (src) return 'footage';
  return 'other';
}

function targets(c: CompItem, opts: MotionSampleOpts): Target[] {
  const out: Target[] = [];
  const perGroup: { [k: string]: number } = {};
  for (let i = 1; i <= c.numLayers && out.length < (opts.maxLayers || 80); i++) {
    const L: any = c.layer(i);
    if (L.guideLayer || !L.hasVideo && !(L instanceof CameraLayer)) continue;
    const kind = kindOf(L);
    if (kind === 'light') continue;
    const tags: string[] = [];
    const com = String(L.comment || '');
    // Cloner instances move as a group: a few represent it.
    if (com.indexOf(';clone') >= 0) {
      const g = tagOf(L) || L.name;
      perGroup[g] = (perGroup[g] || 0) + 1;
      if (perGroup[g] > (opts.clonesPerGroup || 6)) continue;
      tags[tags.length] = 'cloner';
      tags[tags.length] = 'cloner:' + g;
    }
    if (L.name === 'Controls' && kind === 'null') tags[tags.length] = 'controls';
    const own = commentTags(com);
    for (let j = 0; j < own.length; j++) tags[tags.length] = own[j];
    out[out.length] = { L: L, kind: kind, tags: tags };
  }
  return out;
}

/** Expression code: per target "-" (not on), "!" (error), or "x,y,sx,sy,rot,op[,x0,y0,x1,y1]". */
function probeExpression(ts: Target[]): string {
  const s: string[] = ['function n(v){return Math.round(v*100)/100;}', 'var o=[],K=Math.round(time/thisComp.frameDuration/' + 'STEPF' + ');'];
  for (let k = 0; k < ts.length; k++) {
    const L: any = ts[k].L, d3 = L.threeDLayer === true;
    const v = (x: string, y: string) => (d3 ? '[' + x + ',' + y + ',a.anchorPoint[2]]' : '[' + x + ',' + y + ']');
    // Bounds on every 5th sample only: sourceRectAtTime re-evaluates per-character text selectors.
    const bounds = ts[k].kind === 'camera' || ts[k].kind === 'null' ? '' :
      'if(K%5==0)try{var r=a.sourceRectAtTime(time,false),q1=a.toComp(' + v('r.left', 'r.top') + '),q2=a.toComp(' + v('r.left+r.width', 'r.top') + '),q3=a.toComp(' + v('r.left+r.width', 'r.top+r.height') + '),q4=a.toComp(' + v('r.left', 'r.top+r.height') + ');' +
      'b=","+n(Math.min(q1[0],q2[0],q3[0],q4[0]))+","+n(Math.min(q1[1],q2[1],q3[1],q4[1]))+","+n(Math.max(q1[0],q2[0],q3[0],q4[0]))+","+n(Math.max(q1[1],q2[1],q3[1],q4[1]));}catch(e){}';
    const pos = ts[k].kind === 'camera' ? 'var p=a.toComp([0,0,0]),ex=[p[0]+1,p[1]],ey=[p[0],p[1]+1];' :
      'var c0=a.anchorPoint,p=a.toComp(c0),ex=a.toComp(' + v('c0[0]+1', 'c0[1]') + '),ey=a.toComp(' + v('c0[0]', 'c0[1]+1') + ');';
    s.push('try{var a=thisComp.layer(' + L.index + ');if(!a.active){o.push("-");}else{' + pos +
      'var sx=Math.sqrt((ex[0]-p[0])*(ex[0]-p[0])+(ex[1]-p[1])*(ex[1]-p[1]))*100,sy=Math.sqrt((ey[0]-p[0])*(ey[0]-p[0])+(ey[1]-p[1])*(ey[1]-p[1]))*100;' +
      'var rot=Math.atan2(ex[1]-p[1],ex[0]-p[0])*180/Math.PI,op=' + (ts[k].kind === 'camera' ? '100' : 'a.transform.opacity') + ',b="";' + bounds +
      'o.push(n(p[0])+","+n(p[1])+","+n(sx)+","+n(sy)+","+n(rot)+","+n(op)+b);}}catch(e){o.push("!");}');
  }
  s.push('o.join(";")');
  return s.join('\n');
}

export function motionSample(c: CompItem, opts: MotionSampleOpts): any {
  const t0 = new Date().getTime();
  const fd = c.frameDuration, nFrames = Math.max(1, Math.round(c.duration / fd));
  let stepF = Math.max(1, Math.round((opts.step || 2 * fd) / fd));
  const maxS = opts.maxSamples || 150;
  if (nFrames / stepF > maxS) stepF = Math.ceil(nFrames / maxS);
  const o: any = { ok: true, comp: c.name, itemId: c.id, w: c.width, h: c.height, fps: c.frameRate, dur: c.duration, step: stepF * fd, times: [], layers: [], scenes: [] };
  for (let f = 0; f < nFrames; f += stepF) o.times[o.times.length] = f * fd;
  const mk: any = (c as any).markerProperty;
  o.beats = [];
  for (let k = 1; k <= mk.numKeys; k++) {
    const m = mk.keyValue(k);
    if (m.duration > 0) o.scenes[o.scenes.length] = { name: m.comment, t: mk.keyTime(k), dur: m.duration };
    // Beat grid markers (BeatMarkers, A5): lint checks cuts against them.
    else if (m.comment === 'beat' || /^bar \d+$/.test(m.comment)) o.beats[o.beats.length] = mk.keyTime(k);
  }
  // Transition windows from every layer's tags, nulls included (a transition's controller is often a null, which
  // the sampler skips): the style rules treat those windows as one deliberate move.
  o.transitions = [];
  for (let i = 1; i <= c.numLayers; i++) {
    const tg = commentTags(String(c.layer(i).comment || ''));
    for (let j = 0; j < tg.length; j++) {
      if (tg[j].indexOf('transition:') !== 0) continue;
      const Lt = c.layer(i), kind = tg[j].substring(11);
      let dup = false; // a transition's layers share its tag: one entry per transition
      for (let q = 0; q < o.transitions.length; q++) if (o.transitions[q].kind === kind && Math.abs(o.transitions[q].t - Lt.inPoint) < 0.05) dup = true;
      if (!dup) o.transitions[o.transitions.length] = { kind: kind, t: Lt.inPoint, dur: Lt.outPoint - Lt.inPoint, layer: Lt.name };
    }
  }
  const ts = targets(c, opts);
  for (let k = 0; k < ts.length; k++) {
    const L: any = ts[k].L;
    const info: any = { name: L.name, id: tagOf(L), kind: ts[k].kind, in: L.inPoint, out: L.outPoint, s: [], tags: ts[k].tags };
    if (ts[k].kind !== 'camera' && ts[k].kind !== 'null') info.b = [];
    if (ts[k].kind === 'text') { try { info.text = String(L.property('ADBE Text Properties').property('ADBE Text Document').valueAtTime(0, true).text); } catch (e) {} }
    o.layers[k] = info;
  }
  if (!ts.length) { o.ms = new Date().getTime() - t0; return o; }
  const probe: any = c.layers.addText('');
  try {
    probe.moveToEnd(); // existing layer indices stay put while we sample
    probe.name = '__aec_motion_probe';
    probe.enabled = false;
    const sp: any = probe.property('ADBE Text Properties').property('ADBE Text Document');
    sp.expression = probeExpression(ts).replace('STEPF', String(stepF));
    // Time budget: expression-heavy comps (charts: hundreds of expressions per frame) can take 1–2 s a sample. After
    // two samples, if the whole pass would exceed the budget, start again on an evenly spaced grid m times coarser
    // (the analysis assumes even steps; the report says it was coarse).
    const budget = opts.budgetMs || 40000;
    const tS = new Date().getTime();
    let checked = false;
    for (let i = 0; i < o.times.length; i++) {
      if (i === 2 && !checked) {
        checked = true;
        const per = (new Date().getTime() - tS) / 2, m = Math.ceil((per * o.times.length) / budget);
        if (m > 1) {
          const keep: number[] = [];
          for (let j = 0; j < o.times.length; j += m) keep[keep.length] = o.times[j];
          o.times = keep;
          o.coarse = m;
          o.step = stepF * fd * m;
          for (let k = 0; k < ts.length; k++) { o.layers[k].s = []; if (o.layers[k].b) o.layers[k].b = []; }
          sp.expression = probeExpression(ts).replace('STEPF', String(stepF * m)); // bounds stay on every 5th sample
          i = -1;
          continue;
        }
      }
      const row = String(sp.valueAtTime(o.times[i], false).text);
      if (i === 0 && sp.expressionError) return { ok: false, error: 'motion probe expression failed: ' + sp.expressionError };
      // Rows stay JSON text (see lint.ts: parsing and re-serializing small arrays is very slow in ExtendScript).
      const cells = row.split(';');
      for (let k = 0; k < ts.length; k++) {
        const cell = cells[k];
        const bs = o.layers[k].b;
        if (cell === undefined || cell === '-' || cell === '!' || cell === '' || /[^0-9eE.,+-]/.test(cell)) { o.layers[k].s[i] = 'null'; if (bs) bs[i] = 'null'; continue; }
        const nums = cell.split(',');
        o.layers[k].s[i] = '[' + nums.slice(0, 6).join(',') + ']';
        if (bs) bs[i] = nums.length >= 10 ? '[' + nums.slice(6, 10).join(',') + ']' : 'null';
      }
    }
    for (let k = 0; k < ts.length; k++) {
      o.layers[k].s = { $rawJson: '[' + o.layers[k].s.join(',') + ']' };
      if (o.layers[k].b) o.layers[k].b = { $rawJson: '[' + o.layers[k].b.join(',') + ']' };
    }
  } finally {
    probe.remove();
  }
  o.ms = new Date().getTime() - t0;
  return o;
}
