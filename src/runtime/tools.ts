// Small runtime tools for the CLI/MCP: effect description, file import, contact-sheet frames.
import { findComp } from './inspect';
import { snapshotComp } from './snapshot';
import { ensureFolder } from './project';
import { isOpaqueValueType } from './safety';

const VTN: { [k: number]: string } = {};
(function () {
  const names = ['NO_VALUE', 'ThreeD_SPATIAL', 'ThreeD', 'TwoD_SPATIAL', 'TwoD', 'OneD', 'COLOR', 'CUSTOM_VALUE', 'MARKER', 'LAYER_INDEX', 'MASK_INDEX', 'SHAPE', 'TEXT_DOCUMENT'];
  for (let i = 0; i < names.length; i++) { const v = (PropertyValueType as any)[names[i]]; if (v !== undefined) VTN[v] = names[i]; }
})();

/** Applies a (vanilla) effect to a temp layer in a temp comp, dumps its parameters, removes everything. */
export function describeEffect(matchName: string): any {
  const comp = app.project.items.addComp('__aec_describe', 64, 64, 1, 1, 30);
  try {
    const L = comp.layers.addSolid([0, 0, 0], 'host', 64, 64, 1);
    const fx = (L.property('ADBE Effect Parade') as PropertyGroup).addProperty(matchName) as PropertyGroup;
    const params: any[] = [];
    let group = '';
    for (let i = 1; i <= fx.numProperties; i++) {
      const p: any = fx.property(i);
      if (p.matchName === 'ADBE Effect Built In Params') continue;
      if (p.propertyType !== PropertyType.PROPERTY) continue;
      const vt = p.propertyValueType;
      if (vt === PropertyValueType.NO_VALUE) { group = p.name; continue; } // topic header (flat groups)
      const o: any = { index: i, name: p.name, mn: p.matchName, type: VTN[vt] };
      if (group) o.group = group;
      if (!isOpaqueValueType(vt)) { try { const v = p.value; o.default = v && v.length !== undefined ? toArr(v) : v; } catch (e) {} }
      try { if (p.hasMin) o.min = p.minValue; if (p.hasMax) o.max = p.maxValue; } catch (e) {}
      try { if (p.isDropdownEffect) o.dropdown = true; } catch (e) {}
      if (vt === PropertyValueType.LAYER_INDEX) o.layerRef = true;
      // Popup labels: integer OneD params with small ranges are usually popups; probe display text.
      if (vt === PropertyValueType.OneD && o.min === 1 && o.max !== undefined && o.max <= 40 && Math.floor(o.default) === o.default) {
        try {
          const labels: string[] = [];
          const orig = p.value;
          for (let k = 1; k <= o.max; k++) { p.setValue(k); labels.push(String(k) + '=' + (p.valueText !== undefined ? p.valueText : '?')); }
          p.setValue(orig);
          if (labels.length && labels[0].indexOf('?') < 0) o.options = labels;
        } catch (e) {}
      }
      params.push(o);
    }
    return { ok: true, matchName: matchName, name: fx.name, params: params };
  } finally {
    comp.remove();
  }
}

function toArr(v: any): any[] { const o: any[] = []; for (let i = 0; i < v.length; i++) o[i] = v[i]; return o; }

export function importFile(path: string, folderName?: string): any {
  const f = new File(path);
  if (!f.exists) return { ok: false, error: 'file not found: ' + path };
  const io = new ImportOptions(f);
  const item = app.project.importFile(io);
  if (folderName) item.parentFolder = ensureFolder(folderName.split('/'));
  const o: any = { ok: true, id: item.id, name: item.name, type: item.typeName };
  try { o.w = (item as any).width; o.h = (item as any).height; o.dur = (item as any).duration; } catch (e) {}
  return o;
}

/** Evenly spaced frames across a comp (first..last frame) for contact sheets. */
export function contactFrames(ref: any, n: number, dir: string, times?: number[]): any {
  const c = findComp(ref);
  if (!c) return { ok: false, error: 'comp not found: ' + ref };
  let ts = times;
  if (!ts || !ts.length) {
    ts = [];
    const last = Math.max(0, c.duration - c.frameDuration);
    for (let i = 0; i < n; i++) ts.push(n === 1 ? last / 2 : Math.round((last * i) / (n - 1) / c.frameDuration) * c.frameDuration);
  }
  const r = snapshotComp(c, ts, dir, c.name);
  return { ok: true, comp: c.name, fps: c.frameRate, dur: c.duration, bpc: r.bpc, frames: r.frames };
}
