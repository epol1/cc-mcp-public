// Turns inspector JSON into a compact, agent-readable outline (ARCHITECTURE §0.5).
// Eases are named by inverting AE eases back to a cubic-bezier and matching the nearest preset.
import { resolveEasing, easingNames } from '../shared/easing.ts';

const fmt = (n: number, d = 2) => (Math.abs(n) >= 1000 ? n.toFixed(0) : (+n.toFixed(d)).toString());
const fv = (v: any): string => {
  if (v === null || v === undefined) return '∅';
  if (typeof v === 'number') return fmt(v);
  if (Array.isArray(v)) return v.length === 4 && v.every((x) => x >= 0 && x <= 1) ? hex(v) : `[${v.map((x) => fmt(x, 1)).join(', ')}]`;
  if (typeof v === 'object' && 'text' in v) return `"${String(v.text).slice(0, 60)}"`;
  if (typeof v === 'object' && 'v' in v) return `path(${v.v.length} pts${v.c ? ', closed' : ''})`;
  return JSON.stringify(v).slice(0, 60);
};
const hex = (c: number[]) => '#' + c.slice(0, 3).map((x) => Math.round(x * 255).toString(16).padStart(2, '0')).join('');

let PRESETS: { name: string; b: number[] }[] | null = null;
function presets() {
  if (!PRESETS) PRESETS = easingNames().map((n) => ({ name: n, c: resolveEasing(n) })).filter((x) => x.c.bezier).map((x) => ({ name: x.name, b: [...x.c.bezier!] }));
  return PRESETS;
}

/** Names the easing of the segment k0 → k1 (both with ie/oe arrays). */
export function nameSegment(k0: any, k1: any): string {
  if (k0.o === 'hold') return 'hold';
  if (k0.o === 'linear' && k1.i === 'linear') return 'linear';
  const dt = k1.t - k0.t;
  const v0 = Array.isArray(k0.v) ? k0.v : [k0.v], v1 = Array.isArray(k1.v) ? k1.v : [k1.v];
  if (typeof v0[0] !== 'number') return 'bezier';
  const single = (k0.oe?.length ?? 1) === 1 && v0.length > 1;
  let d = 0;
  let dv = 0;
  if (single) dv = Math.hypot(...v1.map((x: number, i: number) => x - v0[i])) * (v0.length === 4 && v0.every((x: number) => x <= 1) ? 255 : 1);
  else { for (let i = 0; i < v0.length; i++) if (Math.abs(v1[i] - v0[i]) > Math.abs(v1[d] - v0[d])) d = i; dv = v1[d] - v0[d]; }
  const oe = k0.oe?.[single ? 0 : d], ie = k1.ie?.[single ? 0 : d];
  if (!oe || !ie) return 'bezier';
  const avg = dv / dt;
  if (Math.abs(avg) < 1e-9) return Math.abs(oe.speed) < 1e-6 && Math.abs(ie.speed) < 1e-6 ? 'hold-in-place' : 'bulge';
  const x1 = oe.influence / 100, y1 = (oe.speed * x1) / avg, x2 = 1 - ie.influence / 100, y2 = 1 - (ie.speed * (1 - x2)) / avg;
  let best = { name: '', d: Infinity };
  for (const p of presets()) {
    const dd = Math.hypot(p.b[0] - x1, p.b[1] - y1, p.b[2] - x2, p.b[3] - y2);
    if (dd < best.d) best = { name: p.name, d: dd };
  }
  const bz = `cubic-bezier(${[x1, y1, x2, y2].map((x) => fmt(x, 2)).join(', ')})`;
  return best.d < 0.04 ? best.name : best.d < 0.12 ? `${best.name}≈` : bz;
}

function describeKeys(keys: any[]): string {
  const n = keys.length;
  const t0 = keys[0].t, t1 = keys[n - 1].t;
  const from = fv(keys[0].v), to = fv(keys[n - 1].v);
  if (n === 2) return `${from} → ${to}, ${fmt(t0)}–${fmt(t1)}s ${nameSegment(keys[0], keys[1])}`;
  const segs = keys.slice(0, -1).map((k, i) => nameSegment(k, keys[i + 1]));
  const uniq = [...new Set(segs)];
  let overshoot = '';
  const nums = keys.map((k) => (Array.isArray(k.v) ? k.v[0] : k.v));
  if (typeof nums[0] === 'number') {
    const end = nums[n - 1], start = nums[0];
    const past = nums.some((x: number) => (end - start) * (x - end) > 1e-6);
    if (past) overshoot = ', overshoots (spring/bounce)';
  }
  return `${n} keys ${from} → ${to}, ${fmt(t0)}–${fmt(t1)}s [${uniq.length <= 3 ? uniq.join(' | ') : uniq.length + ' easings'}]${overshoot}`;
}

function propLines(node: any, prefix: string, out: string[], depth: number): void {
  if (!node) return;
  const label = node.n;
  if (node.c) {
    // Collapse plain containers (Transform, Text, Contents) into their children.
    const isEffect = /Effect Parade$/.test(prefix);
    const next = node.indexed || isEffect ? `${prefix}${label}` : depth === 0 ? label : `${prefix}${label}`;
    for (const c of node.c) propLines(c, `${next} › `, out, depth + 1);
    return;
  }
  if (/^ADBE Position_\d$/.test(node.m) && !node.keys && !node.expr) return; // hidden separated dims
  if (node.skipped) { out.push(`${prefix}${label}: (${node.skipped})`); return; }
  let s = `${prefix}${label}: `;
  if (node.keys) s += describeKeys(node.keys);
  else s += fv(node.v);
  if (node.expr) {
    const first = String(node.expr).split('\n').find((l: string) => l.trim() && !l.trim().startsWith('function')) ?? '';
    s += ` ⟵ expr${node.exprOff ? ' (disabled)' : ''}: ${first.trim().slice(0, 80)}`;
    if (node.exprErr) s += `  ⚠ ${node.exprErr}`;
  }
  out.push(s);
}

export function outlineComp(j: any): string {
  if (!j.ok) return `error: ${j.error}`;
  const c = j.comp;
  const lines = [`Comp "${c.name}" (item ${c.itemId}${c.id ? `, aec:${c.id}` : ''}) ${c.w}×${c.h} ${fmt(c.fps)}fps ${fmt(c.dur)}s, ${c.numLayers} layers, renderer ${({ 'ADBE Calder': 'Advanced 3D', 'ADBE Ernst': 'Cinema 4D', 'ADBE Advanced 3d': 'Classic 3D' } as Record<string, string>)[c.renderer] ?? c.renderer}${c.motionBlur ? ', motion blur' : ''}${c.mgt ? `, EG "${c.mgt}"` : ''}`];
  for (const L of j.layers) {
    const flags = [L.threeD && '3D', L.enabled === false && 'hidden', L.locked && 'locked', L.solo && 'solo', L.motionBlur && 'mb', L.blend && `blend ${L.blend}`, L.isMatte && 'is matte', L.matte && `matte←"${L.matte.layer}"`, L.parent && `parent "${L.parent.name}"`].filter(Boolean).join(', ');
    lines.push(`${L.index}. [${L.type}] "${L.name}"${L.id ? ` aec:${L.id}` : ''} ${fmt(L.in)}–${fmt(L.out)}s${flags ? ` (${flags})` : ''}${L.source && !['text', 'shape', 'camera', 'light', 'null'].includes(L.type) ? ` src "${L.source.name}"${L.source.w ? ` ${L.source.w}×${L.source.h}` : ''}` : ''}`);
    const pl: string[] = [];
    for (const p of L.props ?? []) propLines(p, '', pl, 0);
    for (const s of pl) lines.push(`    ${s}`);
  }
  return lines.join('\n');
}

export function outlineProject(j: any): string {
  if (!j.ok) return `error: ${j.error}`;
  const lines = [`Project ${j.file ?? '(unsaved)'} — ${j.numItems} items, ${j.bpc} bpc, active: ${j.active ?? 'none'}`];
  for (const it of j.items) {
    if (it.type === 'Folder') continue;
    const where = it.folder ? ` [${it.folder}]` : '';
    if (it.type === 'Composition') lines.push(`  comp "${it.name}" #${it.id} ${it.w}×${it.h} ${fmt(it.fps)}fps ${fmt(it.dur)}s ${it.layers} layers${it.aec ? ` aec:${it.aec}` : ''}${where}`);
    else lines.push(`  ${it.type.toLowerCase()} "${it.name}" #${it.id}${it.w ? ` ${it.w}×${it.h}` : ''}${it.dur ? ` ${fmt(it.dur)}s` : ''}${it.missing ? ' MISSING' : ''}${where}`);
  }
  return lines.join('\n');
}
