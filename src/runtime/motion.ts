// Motion sampler (A1/A2): comp-space transforms of the top-level layers over time, for motion previews (speed
// graphs) and style lint (src/motion). Like the lint sampler, one temporary text layer carries an expression that
// measures every target with toComp (ExtendScript has no toComp); reading its Source Text at a time gives one row.
// Per layer and sample: anchor point in comp pixels, effective scale (parents included), rotation, opacity, bounds.
import { tagOf } from './layers';

export interface MotionSampleOpts { step?: number; maxSamples?: number; maxLayers?: number; clonesPerGroup?: number }

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
  for (let k = 1; k <= mk.numKeys; k++) {
    const m = mk.keyValue(k);
    if (m.duration > 0) o.scenes[o.scenes.length] = { name: m.comment, t: mk.keyTime(k), dur: m.duration };
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
    for (let i = 0; i < o.times.length; i++) {
      const row = String(sp.valueAtTime(o.times[i], false).text);
      if (i === 0 && sp.expressionError) return { ok: false, error: 'motion probe expression failed: ' + sp.expressionError };
      const cells = row.split(';');
      for (let k = 0; k < ts.length; k++) {
        const cell = cells[k];
        const bs = o.layers[k].b;
        if (cell === undefined || cell === '-' || cell === '!' || cell === '') { o.layers[k].s[i] = null; if (bs) bs[i] = null; continue; }
        const nums = cell.split(','), v: number[] = [];
        for (let j = 0; j < 6; j++) v[j] = +nums[j];
        o.layers[k].s[i] = v;
        if (bs) bs[i] = nums.length >= 10 ? [+nums[6], +nums[7], +nums[8], +nums[9]] : null;
      }
    }
  } finally {
    probe.remove();
  }
  o.ms = new Date().getTime() - t0;
  return o;
}
