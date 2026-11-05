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
      // (Never probe LUT/Look/file menus: one of their items is "Browse…", which opens a file picker.)
      if (vt === PropertyValueType.OneD && o.min === 1 && o.max !== undefined && o.max <= 40 && Math.floor(o.default) === o.default && !/LUT|Look|File|Browse/i.test(p.name)) {
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
  // Already in the project: reuse it (no duplicate items on re-runs).
  for (let i = 1; i <= app.project.numItems; i++) {
    const it: any = app.project.item(i);
    try { if (it instanceof FootageItem && it.file && it.file.fsName === f.fsName) return { ok: true, id: it.id, name: it.name, type: it.typeName, w: it.width, h: it.height, dur: it.duration, reused: true }; } catch (e) {}
  }
  const io = new ImportOptions(f);
  const item = app.project.importFile(io);
  if (folderName) item.parentFolder = ensureFolder(folderName.split('/'));
  const o: any = { ok: true, id: item.id, name: item.name, type: item.typeName };
  try { o.w = (item as any).width; o.h = (item as any).height; o.dur = (item as any).duration; } catch (e) {}
  return o;
}

/**
 * fetch_asset: imports downloaded files in one undo step, each item tagged with its asset id in the comment.
 * Files already in the project are reused; when all are, no undo group is opened (an empty one would make the
 * next Edit > Undo revert the previous real step).
 */
export function importAssets(list: { path: string; folder: string; id: string }[]): any {
  const out: any[] = [];
  let fresh = false;
  for (let i = 0; i < list.length; i++) {
    const f = new File(list[i].path);
    if (!f.exists) return { ok: false, error: 'file not found: ' + list[i].path };
    let found = false;
    for (let j = 1; j <= app.project.numItems && !found; j++) {
      const it: any = app.project.item(j);
      try { if (it instanceof FootageItem && it.file && it.file.fsName === f.fsName) found = true; } catch (e) {}
    }
    if (!found) fresh = true;
  }
  if (fresh) app.beginUndoGroup('ae-compose: fetch asset');
  try {
    for (let i = 0; i < list.length; i++) {
      const r = importFile(list[i].path, list[i].folder);
      if (r.ok && !r.reused) { try { (app.project.itemByID(r.id) as any).comment = 'aec:asset=' + list[i].id; } catch (e) {} }
      out.push(r);
    }
  } finally { if (fresh) app.endUndoGroup(); }
  return { ok: true, items: out, undoable: fresh };
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

/** Any project item by item id, exact name, or case-insensitive name/file substring (unique). */
export function findItem(ref: any): Item | null {
  if (typeof ref === 'number') return app.project.itemByID(ref);
  const s = String(ref), low = s.toLowerCase();
  const loose: Item[] = [];
  for (let i = 1; i <= app.project.numItems; i++) {
    const it: any = app.project.item(i);
    if (it.name === s) return it;
    let file = '';
    try { file = it.file ? String(it.file.fsName).toLowerCase() : ''; } catch (e) {}
    if (String(it.name).toLowerCase().indexOf(low) >= 0 || (file && file.indexOf(low) >= 0)) loose[loose.length] = it;
  }
  if (loose.length === 1) return loose[0];
  // Several matches that are the same file imported twice: any of them will do.
  if (loose.length > 1) {
    let same = true, f0 = '';
    for (let i = 0; i < loose.length; i++) {
      let f = '';
      try { f = (loose[i] as any).file ? (loose[i] as any).file.fsName : ''; } catch (e) {}
      if (i === 0) f0 = f; else if (!f || f !== f0) same = false;
    }
    if (same && f0) return loose[0];
  }
  return null;
}

/** Names and ids of items matching a reference loosely (for "ambiguous" errors). */
export function itemCandidates(ref: any): string {
  const low = String(ref).toLowerCase(), out: string[] = [];
  for (let i = 1; i <= app.project.numItems && out.length < 8; i++) { const it: any = app.project.item(i); if (String(it.name).toLowerCase().indexOf(low) >= 0) out[out.length] = '"' + it.name + '" #' + it.id + ' (' + it.typeName + ')'; }
  return out.length ? out.join(', ') : 'none';
}

/**
 * Frames of any footage item or comp (to look at media before using it). Footage goes through a temporary comp
 * that is removed again. `times` are item-local seconds; default: n evenly spaced frames.
 */
export function previewItem(ref: any, n: number, dir: string, times?: number[]): any {
  const it: any = findItem(ref);
  if (!it) return { ok: false, error: 'no unique project item for "' + ref + '"; matches: ' + itemCandidates(ref) + ' (use the #id)' };
  if (it instanceof CompItem) return contactFrames(it.id, n, dir, times);
  if (!(it instanceof FootageItem)) return { ok: false, error: '"' + it.name + '" is a ' + it.typeName + ', not footage or a comp' };
  if (!it.hasVideo) return { ok: false, error: '"' + it.name + '" has no video' };
  const still = it.mainSource && it.mainSource.isStill;
  const fps = still ? 30 : it.frameRate || 30;
  const dur = still || !(it.duration > 0) ? 1 / fps : it.duration;
  const tmp = app.project.items.addComp('__aec_preview', it.width, it.height, it.pixelAspect || 1, Math.max(dur, 1 / fps), fps);
  try {
    tmp.layers.add(it);
    let ts = times;
    if (!ts || !ts.length) {
      ts = [];
      const last = Math.max(0, dur - 1 / fps);
      for (let i = 0; i < n; i++) ts.push(n === 1 || still ? last / 2 : Math.round((last * i) / (n - 1) * fps) / fps);
    }
    const r = snapshotComp(tmp, ts, dir, String(it.name).replace(/\.[^.]+$/, ''));
    return { ok: true, item: it.name, id: it.id, w: it.width, h: it.height, fps: fps, dur: still ? 0 : dur, still: !!still, bpc: r.bpc, frames: r.frames };
  } finally {
    tmp.remove();
  }
}

/** The source frame under a layer at comp time t (for sampling a key color), or null for non-footage layers. */
export function layerSourceFrame(compRef: any, layerRef: any, t: number, dir: string): any {
  const c = findComp(compRef);
  if (!c) return { ok: false, error: 'comp not found: ' + compRef };
  let L: any = null;
  if (typeof layerRef === 'number') L = c.layer(layerRef);
  else for (let i = 1; i <= c.numLayers; i++) { const x: any = c.layer(i); if (x.name === layerRef || x.comment === 'aec:' + layerRef || (x.comment && x.comment.indexOf('aec:' + layerRef + ';') === 0)) { L = x; break; } }
  if (!L || !L.source) return { ok: false, error: 'layer has no footage source: ' + layerRef };
  const tt = t !== undefined && t !== null ? t : (L.inPoint + L.outPoint) / 2;
  const local = Math.max(0, (tt - L.startTime) * 100 / (L.stretch || 100));
  return previewItem(L.source.id, 1, dir, [local]);
}
