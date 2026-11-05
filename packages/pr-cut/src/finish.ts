// Finishing: loudness to a delivery target, social versions + delivery packs, and shot matching.
// Loudness and matching are measured (ffmpeg EBU R128 meter, frame statistics), applied as an edit batch (a new
// version, one undo step), and measured again.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import sharp from 'sharp';
import { loudness } from '@ae-mcp/core/library/index.ts';
import { lit, runEs } from './bridge.ts';
import { recordChange } from './undo.ts';
import { applyCutEdits } from './edit.ts';
import { exportFrames } from './frames.ts';
import { inspectSequenceRaw } from './inspect.ts';
import { exportSequence, projectInfo } from './project.ts';
import { fromTicksPerFrame } from '@ae-mcp/core/time/timecode.ts';
import { PRC_HOME } from './importxml.ts';
import type { BuildReport } from './build.ts';

const AME = 'C:/Program Files/Adobe/Adobe Media Encoder 2026/MediaIO/systempresets';
export const PRESETS = {
  h264: `${AME}/4E49434B_48323634/01 - Match Source - High bitrate.epr`,
  wav: `${AME}/3F3F3F3F_57415645/Waveform Audio 48kHz 16-bit.epr`,
};

export const LOUDNESS_TARGETS: Record<string, number> = { web: -14, social: -14, podcast: -16, broadcast: -23, ebu: -23, atsc: -24 };

/** Measure a sequence's mix: integrated LUFS, true peak, loudness range. */
export async function measureSequence(seqId: string): Promise<{ lufs: number | null; truePeak: number | null; lra: number | null; file: string }> {
  const file = path.join(PRC_HOME, 'loudness', `${seqId.slice(0, 8)}_${Date.now().toString(36)}.wav`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  await exportSequence(seqId, file, PRESETS.wav);
  return { ...(await loudness(file)), file };
}

export async function audioFinish(seqId: string, o: { target?: number | string; truePeak?: number; dryRun?: boolean } = {}): Promise<{ summary: string; report?: BuildReport; sequenceId?: string }> {
  const target = typeof o.target === 'string' ? LOUDNESS_TARGETS[o.target] ?? Number(o.target) : o.target ?? -14;
  if (!Number.isFinite(target)) throw new Error(`loudness target "${o.target}": use a LUFS number or ${Object.keys(LOUDNESS_TARGETS).join(', ')}`);
  const ceiling = o.truePeak ?? -1;
  const m0 = await measureSequence(seqId);
  if (m0.lufs === null) throw new Error('the sequence is silent');
  const delta = Math.round((target - m0.lufs) * 10) / 10;
  const needsLimiter = m0.truePeak !== null && m0.truePeak + delta > ceiling;
  const head = `mix: ${m0.lufs} LUFS integrated, true peak ${m0.truePeak} dBFS, LRA ${m0.lra} LU; target ${target} LUFS, peaks ≤ ${ceiling} dBTP → gain ${delta > 0 ? '+' : ''}${delta} dB${needsLimiter ? ' through a Hard Limiter on every audio clip (the peaks would pass the ceiling)' : ' on every audio clip'}`;
  if (o.dryRun || Math.abs(delta) < 0.3) return { summary: `${head}${Math.abs(delta) < 0.3 ? ' (already within 0.3 LU: nothing to do)' : ''}` };
  if (needsLimiter) return limitTo(seqId, target, ceiling, delta, head);
  const r = await applyCutEdits(seqId, [{ op: 'level', target: 'all', delta }]);
  const m1 = await measureSequence(r.report.sequence!.id);
  const off = m1.lufs !== null ? Math.round((m1.lufs - target) * 10) / 10 : null;
  return { summary: `${head}\n${r.summary}\nafter: ${m1.lufs} LUFS (${off !== null && Math.abs(off) <= 1 ? 'within' : 'OUTSIDE'} ±1 LU of target: ${off} LU), true peak ${m1.truePeak} dBFS${m1.truePeak !== null && m1.truePeak > ceiling ? ' — peaks above the ceiling: lower the loudest clip or add a limiter by hand' : ''}`, report: r.report };
}

/**
 * Loudness through Premiere's stock effects when the gain would push peaks over the ceiling: the next version is a
 * clone of the sequence (one undo step); every audio clip gets Amplify (gain) then Hard Limiter (ceiling just under
 * the true-peak target, true-peak mode). Both effects take normalized 0–1 values; measured on 26.5.2, Amplify and
 * Input Boost map −60…+30 dB (0 dB ↔ 0.667), and the gain is still corrected from measurements (secant steps).
 */
async function limitTo(seqId: string, target: number, ceiling: number, delta: number, head: string): Promise<{ summary: string; sequenceId: string }> {
  const p = await projectInfo();
  const src = p.sequences.find((s) => s.id === seqId)!;
  const base = src.name.replace(/\s+v\d{3}$/i, '');
  let v = 2;
  while (p.sequences.some((s) => s.name === `${base} v${String(v).padStart(3, '0')}`)) v++;
  const name = `${base} v${String(v).padStart(3, '0')}`;
  const norm = (db: number) => Math.max(0, Math.min(1, (db + 60) / 90));
  let ampParam = 1 + (ceiling - 0.3) / 100;
  const r = await runEs<{ id: string; clips: number; u0: number; u1: number; project: string }>(`
var u0 = prcUndo();
var s = prcSeq(${lit(seqId)}), before = prcSeqIds(); s.clone(); var after = prcSeqIds(), id = null;
for (var j = 0; j < after.length; j++) { var seen = false; for (var k = 0; k < before.length; k++) if (before[k] === after[j]) seen = true; if (!seen) id = after[j]; }
var c = prcSeq(id); c.name = ${lit(name)}; app.project.openSequence(id);
var q = qe.project.getActiveSequence();
if (!q || q.guid !== id) throw new Error('Premiere did not activate the new version; nothing was changed in the original');
var amp = qe.project.getAudioEffectByName('Amplify'), lim = qe.project.getAudioEffectByName('Hard Limiter'), n = 0;
for (var t = 0; t < q.numAudioTracks; t++) { var tr = q.getAudioTrackAt(t); for (var i = 0; i < tr.numItems; i++) { var it = tr.getItemAt(i); if (it.type === 'Clip') { it.addAudioEffect(amp); it.addAudioEffect(lim); n++; } } }
prcJson({ id: id, clips: n, u0: u0, u1: prcUndo(), project: app.project.path });
`, { timeoutMs: 300_000 });
  recordChange(r.u0, r.u1, r.id, r.project, name);
  const set = (db: number) => runEs(`var c = prcSeq(${lit(r.id)});
for (var a = 0; a < c.audioTracks.numTracks; a++) { var at = c.audioTracks[a]; for (var m = 0; m < at.clips.numItems; m++) { var cl = at.clips[m];
  for (var x = 0; x < cl.components.numItems; x++) { var cp = cl.components[x], P = cp.properties;
    if (cp.displayName === 'Amplify') { P[2].setValue(1, true); P[3].setValue(${norm(db)}, true); P[4].setValue(${norm(db)}, true); }
    if (cp.displayName === 'Hard Limiter') { P[1].setValue(${ampParam}, true); P[2].setValue(${norm(0)}, true); P[7].setValue(1, true); } } } }
prcJson(1)`);
  const tryGain = async (db: number) => { await set(db); return measureSequence(r.id); };
  // Secant search: loudness through a limiter rises monotonically with gain but not linearly.
  let g0 = delta, m0 = await tryGain(g0);
  let g1 = g0 + (target - (m0.lufs ?? target)), m1 = await tryGain(g1);
  let best = Math.abs((m1.lufs ?? -99) - target) < Math.abs((m0.lufs ?? -99) - target) ? { g: g1, m: m1 } : { g: g0, m: m0 };
  for (let i = 0; i < 2 && Math.abs((best.m.lufs ?? -99) - target) > 0.4; i++) {
    const slope = ((m1.lufs ?? 0) - (m0.lufs ?? 0)) / (g1 - g0 || 1);
    const g2 = Math.max(-60, Math.min(30, g1 + (target - (m1.lufs ?? target)) / (Math.abs(slope) > 0.05 ? slope : 1)));
    const m2 = await tryGain(g2);
    [g0, m0, g1, m1] = [g1, m1, g2, m2];
    if (Math.abs((m2.lufs ?? -99) - target) < Math.abs((best.m.lufs ?? -99) - target)) best = { g: g2, m: m2 };
  }
  // Clips that overlap (dialogue, music, nat sound) add up past their own limiters, and scripts can't reach the
  // master track: lower the per-clip ceiling by the measured overshoot (taken as a −60…0 dB scale), then re-trim the
  // gain for loudness, at most three rounds.
  let last = best.g === g1 ? g1 : g0;
  for (let i = 0; i < 3 && best.m.truePeak !== null && best.m.truePeak > ceiling; i++) {
    ampParam = Math.max(0.5, ampParam - (best.m.truePeak - ceiling + 0.3) / 60);
    let mm = await tryGain(best.g);
    last = best.g;
    if (mm.lufs !== null && Math.abs(mm.lufs - target) > 0.4) { const g = Math.max(-60, Math.min(30, best.g + (target - mm.lufs))); mm = await tryGain(g); best = { g, m: mm }; last = g; }
    else best = { g: best.g, m: mm };
  }
  if (best.g !== last) await set(best.g);
  const m = best.m;
  const off = m.lufs !== null ? Math.round((m.lufs - target) * 10) / 10 : null;
  return {
    sequenceId: r.id,
    summary: `${head}
new version "${name}" (${r.id}): clone + Amplify and Hard Limiter on ${r.clips} audio clip(s), gain ${best.g > 0 ? '+' : ''}${Math.round(best.g * 10) / 10} dB, true-peak limiting at ${ceiling} dBTP
after: ${m.lufs} LUFS (${off !== null && Math.abs(off) <= 1 ? 'within' : 'OUTSIDE'} ±1 LU of target: ${off} LU), true peak ${m.truePeak} dBFS${m.truePeak !== null && m.truePeak > ceiling ? ' — still above the ceiling' : ''}`,
  };
}

export interface DeliverOptions { aspects?: string[]; outDir?: string; master?: boolean; credits?: string[] }
const SIZES: Record<string, [number, number, number, number]> = { '9:16': [9, 16, 1080, 1920], '1:1': [1, 1, 1080, 1080], '4:5': [4, 5, 1080, 1350], '16:9': [16, 9, 1920, 1080] };

/** Master + social versions (Auto Reframe, editable sequences named "<name> 9x16") as files in one folder. */
export async function deliver(seqId: string, o: DeliverOptions = {}): Promise<{ summary: string; files: string[] }> {
  const p = await projectInfo();
  const seq = p.sequences.find((s) => s.id === seqId)!;
  const safe = seq.name.replace(/[^\w.-]+/g, '_');
  const dir = o.outDir ?? path.join(os.homedir(), 'Videos', 'pr-cut', safe);
  fs.mkdirSync(dir, { recursive: true });
  const files: string[] = [], lines: string[] = [];
  if (o.master !== false) {
    const f = path.join(dir, `${safe}_16x9.mp4`);
    const r = await exportSequence(seqId, f, PRESETS.h264);
    const l = await loudness(f);
    files.push(f);
    lines.push(`master ${path.basename(f)} (${(r.ms / 1000).toFixed(1)} s, ${l.lufs} LUFS, peak ${l.truePeak} dBFS)`);
  }
  for (const a of o.aspects ?? ['9:16', '1:1']) {
    const sz = SIZES[a];
    if (!sz) throw new Error(`aspect "${a}": use ${Object.keys(SIZES).join(', ')}`);
    const label = `${sz[0]}x${sz[1]}`;
    const name = `${seq.name} ${label}`;
    // Reuse an existing reframed version (the editor may have adjusted it), else Auto Reframe a new one.
    let ver = p.sequences.find((s) => s.name === name);
    if (!ver) {
      const r = await runEs<{ id: string }>(`var s = prcSeq(${lit(seqId)}); var r = s.autoReframeSequence(${sz[0]}, ${sz[1]}, 'default', ${lit(name)}, false); prcJson({ id: r ? r.sequenceID : null })`, { timeoutMs: 600_000 });
      if (!r.id) throw new Error(`Auto Reframe ${a} failed`);
      ver = { id: r.id, name, seconds: seq.seconds, size: '' };
      lines.push(`new sequence "${name}" (Auto Reframe; adjust it in Premiere and deliver again to re-export)`);
    }
    const raw = path.join(PRC_HOME, 'deliver', `${safe}_${label}_native.mp4`);
    fs.mkdirSync(path.dirname(raw), { recursive: true });
    await exportSequence(ver.id, raw, PRESETS.h264);
    const f = path.join(dir, `${safe}_${label}.mp4`);
    // Scale the native-size export (Auto Reframe keeps the source height) to the platform size.
    execFileSync('ffmpeg', ['-nostdin', '-v', 'error', '-y', '-i', raw, '-vf', `scale=${sz[2]}:${sz[3]}:flags=lanczos:force_original_aspect_ratio=increase,crop=${sz[2]}:${sz[3]},setsar=1`, '-c:v', 'libx264', '-preset', 'slow', '-crf', '17', '-pix_fmt', 'yuv420p', '-c:a', 'copy', '-movflags', '+faststart', f]);
    files.push(f);
    lines.push(`${a} ${path.basename(f)} (${sz[2]}×${sz[3]})`);
  }
  const credits = o.credits?.length ? o.credits : findCredits();
  if (credits.length) { const c = path.join(dir, 'CREDITS.md'); fs.writeFileSync(c, `# Credits\n\n${credits.map((x) => `- ${x}`).join('\n')}\n`); files.push(c); }
  return { summary: `delivered to ${dir}:\n${lines.map((l) => `- ${l}`).join('\n')}${credits.length ? '\n- CREDITS.md' : ''}`, files };
}

/** Credit lines recorded by fetch_asset next to the open project (shared CREDITS.md), if any. */
function findCredits(): string[] {
  try {
    const projDir = path.dirname(fs.readFileSync(path.join(PRC_HOME, 'last-project.txt'), 'utf8'));
    const f = path.join(projDir, 'CREDITS.md');
    return fs.readFileSync(f, 'utf8').split('\n').filter((l) => l.startsWith('- ')).map((l) => l.slice(2));
  } catch { return []; }
}

/** Frame statistics for matching: mean luma (Rec. 709), channel means, chroma spread. */
async function stats(file: string) {
  const { data, info } = await sharp(file).resize(320).raw().toBuffer({ resolveWithObject: true });
  let r = 0, g = 0, b = 0, c = 0, n = 0;
  for (let i = 0; i < data.length; i += info.channels) {
    const R = data[i] / 255, G = data[i + 1] / 255, B = data[i + 2] / 255;
    r += R; g += G; b += B; c += Math.max(R, G, B) - Math.min(R, G, B); n++;
  }
  r /= n; g /= n; b /= n; c /= n;
  return { r, g, b, luma: 0.2126 * r + 0.7152 * g + 0.0722 * b, chroma: c };
}

/**
 * Match clips to a reference clip: exposure from the luma ratio, temperature from the red–blue balance, tint from
 * green against magenta, saturation from the chroma spread. Applied as a grade edit (new version).
 */
export async function matchShots(seqId: string, reference: string, targets: string[] | '*', o: { dryRun?: boolean } = {}): Promise<{ summary: string; report?: BuildReport; before?: string; after?: string }> {
  const s = await inspectSequenceRaw(seqId);
  const R = fromTicksPerFrame(s.timebase);
  const v1 = s.clips.filter((c) => c.track === 'V1');
  const pick = (id: string) => { const m = /^V1\/(\d+)$/.exec(id); const c = m ? v1[+m[1] - 1] : undefined; if (!c) throw new Error(`clip ${id}: use V1/<n> (inspect_sequence)`); return c; };
  const ref = pick(reference);
  const tgt = targets === '*' ? v1.filter((c) => c !== ref) : targets.map(pick);
  const idx = (c: typeof ref) => v1.indexOf(c);
  const mid = (c: { start: number; end: number }) => Math.round((c.start + c.end) / 2 / s.timebase);
  const measure = async (sid: string, clips: { start: number; end: number }[]) => {
    const files = await exportFrames(sid, clips.map(mid), R, path.join(PRC_HOME, 'match', `${sid.slice(0, 8)}_${Date.now().toString(36)}`));
    return Promise.all(files.map(stats));
  };
  const [st0, ...sts] = await measure(seqId, [ref, ...tgt]);
  // The change each clip needs, on top of its own current grade (exposure and temperature/tint add, saturation scales).
  const base = (c: typeof ref) => ({ exposure: c.lumetri?.exposure ?? 0, temperature: c.lumetri?.temperature ?? 0, tint: c.lumetri?.tint ?? 0, saturation: c.lumetri?.saturation ?? 100 });
  const want = (st: Awaited<ReturnType<typeof stats>>, b: ReturnType<typeof base>) => ({
    exposure: clamp(b.exposure + Math.log2(st0.luma / Math.max(1e-3, st.luma)), -5, 5),
    // Lumetri's temperature moves the red–blue balance by about 0.25 % per unit (refined below from measurement).
    temperature: clamp(b.temperature + ((st0.r - st0.b) - (st.r - st.b)) * 400, -100, 100),
    tint: clamp(b.tint + ((st.g - (st.r + st.b) / 2) - (st0.g - (st0.r + st0.b) / 2)) * 400, -100, 100),
    saturation: clamp(b.saturation * (st0.chroma / Math.max(1e-3, st.chroma)), 0, 200),
  });
  const plans = tgt.map((c, k) => ({ id: `V1/${idx(c) + 1}`, n: idx(c), g: want(sts[k], base(c)) }));
  const lines = plans.map((p) => `${p.id} → ${JSON.stringify(round(p.g))}`);
  if (o.dryRun) return { summary: `match to ${reference}:\n${lines.join('\n')}` };
  const r = await applyCutEdits(seqId, plans.map((p) => ({ op: 'grade', target: p.id, ...round(p.g) })));
  const vid = r.report.sequence!.id;
  // Refine on the new version from its own frames (two rounds): Lumetri's response isn't linear, so each round
  // re-measures and corrects what is left. Writes go to the new version's Lumetri directly (indices as inspect).
  const vs = await inspectSequenceRaw(vid);
  const vv1 = vs.clips.filter((c) => c.track === 'V1');
  const dist = (a: Awaited<ReturnType<typeof stats>>, b: Awaited<ReturnType<typeof stats>>) => Math.abs(a.luma - b.luma) * 255 + Math.abs((a.r - a.b) - (b.r - b.b)) * 255;
  let cur = plans.map((p) => ({ ...p, g: { ...p.g } }));
  let measured = await measure(vid, [vv1[idx(ref)], ...cur.map((p) => vv1[p.n])]);
  const before = sts.map((st) => dist(st0, st));
  for (let round_ = 0; round_ < 2; round_++) {
    const [r0, ...rs] = measured;
    if (rs.every((st) => dist(r0, st) < 6)) break;
    cur = cur.map((p, k) => {
      const st = rs[k];
      return { ...p, g: {
        exposure: clamp(p.g.exposure + Math.log2(r0.luma / Math.max(1e-3, st.luma)), -5, 5),
        temperature: clamp(p.g.temperature + ((r0.r - r0.b) - (st.r - st.b)) * 400, -100, 100),
        tint: clamp(p.g.tint + ((st.g - (st.r + st.b) / 2) - (r0.g - (r0.r + r0.b) / 2)) * 400, -100, 100),
        saturation: clamp(p.g.saturation * (r0.chroma / Math.max(1e-3, st.chroma)), 0, 200),
      } };
    });
    await runEs(`var s = prcSeq(${lit(vid)}); var jobs = ${JSON.stringify(cur.map((p) => ({ n: p.n, g: round(p.g) })))};
for (var i = 0; i < jobs.length; i++) { var c = s.videoTracks[0].clips[jobs[i].n];
  for (var x = 0; x < c.components.numItems; x++) if (c.components[x].matchName === 'AE.ADBE Lumetri') { var P = c.components[x].properties; P[19].setValue(jobs[i].g.exposure, true); P[14].setValue(jobs[i].g.temperature, true); P[15].setValue(jobs[i].g.tint, true); P[16].setValue(jobs[i].g.saturation, true); } }
prcJson(1)`);
    measured = await measure(vid, [vv1[idx(ref)], ...cur.map((p) => vv1[p.n])]);
  }
  const [r0, ...rs] = measured;
  const after = rs.map((st) => dist(r0, st));
  const result = cur.map((p, k) => `${p.id} → ${JSON.stringify(round(p.g))} (difference ${before[k].toFixed(0)} → ${after[k].toFixed(0)})`);
  return { summary: `match to ${reference}:\n${result.join('\n')}\n${r.summary}`, report: r.report };
}

const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));
const round = (g: Record<string, number>) => Object.fromEntries(Object.entries(g).map(([k, v]) => [k, Math.round(v * 100) / 100]));
