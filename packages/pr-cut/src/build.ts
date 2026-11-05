// build_cut: edit plan → native Premiere sequence. Validate and compile (nothing touches Premiere until the plan is
// sound), import the timeline as FCP7 XML (one undo step), place what XML can't carry (mogrt titles, caption
// track) live, save the plan next to the sequence, then return a contact sheet, lint and the ids.
import fs from 'node:fs';
import path from 'node:path';
import { framesToTimecode, ticksPerFrame } from '@ae-mcp/core/time/timecode.ts';
import { captionsFromWords, toSrt } from '@ae-mcp/core/text/captions.ts';
import { formatIssues, summarizeIssues } from '@ae-mcp/core/lint/report.ts';
import { lit, nativePath, runEs } from './bridge.ts';
import { importTimeline, PRC_HOME } from './importxml.ts';
import { cutStrips, sequenceContactSheet } from './frames.ts';
import { lintCut, type EditIssue } from './lint.ts';
import { compilePlan, type Compiled } from './plan/compile.ts';
import { mediaResolver } from './plan/media.ts';

export interface BuildOptions {
  baseDir?: string;
  /** Contact sheet (default true) and cut-point strips (default: only when there are ≤ 12 cuts). */
  sheet?: boolean;
  strips?: boolean | number;
  /** Compile and lint only; don't touch Premiere. */
  dryRun?: boolean;
  bin?: string;
  libraryPath?: (id: string) => string | null;
}

export interface BuildReport {
  sequence?: { id: string; name: string };
  path: 'fcp7-xml';
  durationSeconds: number;
  timecode: string;
  undoSteps: number;
  segments: { id: string; beat?: string; at: string; seconds: number; pieces: number; text: string; match?: { score: number; text: string } }[];
  stats: Compiled['stats'] & { pieces: number; jumpCuts: number; broll: number; music: number; titles: number };
  lint: string[];
  lintSummary: string;
  contactSheet?: string | null;
  strips?: string | null;
  warnings: string[];
  sidecar?: string;
  xml?: string;
}

export const CUTS_DIR = path.join(PRC_HOME, 'cuts');

export async function buildCut(planInput: unknown, o: BuildOptions = {}): Promise<{ report: BuildReport; compiled: Compiled; issues: EditIssue[] }> {
  const aliases = (planInput as any)?.media ?? {};
  const c = await compilePlan(planInput, mediaResolver(aliases, { baseDir: o.baseDir, libraryPath: o.libraryPath }));
  const issues = lintCut(c);
  const t = c.timeline, R = t.rate, fps = R.num / R.den, tpf = ticksPerFrame(R);
  const end = Math.max(...t.clips.map((x) => x.end));
  const report: BuildReport = {
    path: 'fcp7-xml', durationSeconds: Math.round((end / fps) * 100) / 100, timecode: framesToTimecode(end, R), undoSteps: 0,
    segments: c.segments.map((s) => ({ id: s.id, beat: s.beat, at: framesToTimecode(s.start, R), seconds: Math.round(((s.end - s.start) / fps) * 100) / 100, pieces: c.pieces.filter((p) => p.seg === s.id).length, text: s.text.length > 140 ? s.text.slice(0, 140) + '…' : s.text, ...(s.match ? { match: s.match } : {}) })),
    stats: { ...c.stats, pieces: c.pieces.length, jumpCuts: c.pieces.filter((p) => p.jump).length, broll: t.clips.filter((x) => (x.vTrack ?? 0) >= 2).length, music: t.clips.filter((x) => /^m\d/.test(x.id)).length, titles: c.titles.length },
    lint: formatIssues(issues), lintSummary: summarizeIssues(issues), warnings: [...c.warnings],
  };
  if (issues.some((i) => i.severity === 'error')) report.warnings.push('lint found errors: the cut was still built so you can see it; fix them and rebuild');
  if (o.dryRun) return { report, compiled: c, issues };

  const imp = await importTimeline(t, { bin: o.bin });
  report.sequence = { id: imp.sequenceId, name: imp.name };
  report.undoSteps = imp.undoSteps;
  report.xml = imp.xmlFile;
  report.warnings.push(...imp.warnings);

  // Live additions after the import (each adds undo steps; `undo` rolls the whole build back).
  let live = 0;
  if (c.titles.length) { const t = await placeTitles(imp.sequenceId, c.titles, tpf); live += t.steps; c.warnings.push(...t.missing.map((m) => `title ${m}`)); report.warnings.push(...t.missing.map((m) => `title ${m}`)); }
  const capOpt = c.plan.captions;
  if (capOpt) { const w0 = c.warnings.length; live += await addCaptions(imp.sequenceId, c, typeof capOpt === 'object' ? capOpt : {}); report.warnings.push(...c.warnings.slice(w0)); }
  report.undoSteps += live;

  fs.mkdirSync(CUTS_DIR, { recursive: true });
  const sidecar = path.join(CUTS_DIR, `${imp.sequenceId}.json`);
  fs.writeFileSync(sidecar, JSON.stringify({ sequenceId: imp.sequenceId, name: imp.name, builtAt: new Date().toISOString(), plan: c.captionMogrt ? { ...c.plan, captions: { ...(c.plan.captions as object), mogrt: c.captionMogrt.mogrt } } : c.plan, captionTrack: c.captionMogrt?.track, pieces: c.pieces, segments: c.segments, titles: c.titles, rate: R, undoSteps: report.undoSteps }, null, 1));
  report.sidecar = sidecar;

  if (o.sheet !== false) {
    // One frame per segment (its first piece's middle), plus every piece when the cut is short.
    // Montages have no dialogue pieces: their V1 shots stand in.
    const shots = c.pieces.length ? null : t.clips.filter((x) => x.vTrack === 1).map((x) => ({ id: x.id, seg: 'montage', words: null as [number, number] | null, media: x.media, start: x.start, end: x.end }));
    if (shots) report.contactSheet = await sequenceContactSheet(imp.sequenceId, shots.slice(0, 16).map((p) => ({ frame: Math.floor((p.start + p.end) / 2), label: `${p.id} ${t.media[p.media].name}`.slice(0, 48) })), R, `${imp.name} — ${report.timecode}`).catch(() => null);
    else {
    const items = (c.pieces.length <= 12 ? c.pieces : c.segments.map((s) => c.pieces.find((p) => p.seg === s.id)!)).map((p) => ({ frame: Math.floor((p.start + p.end) / 2), label: `${p.id} ${p.words ? c.transcripts[p.media].words.slice(p.words[0], Math.min(p.words[1] + 1, p.words[0] + 6)).map((w) => w.text).join(' ') : ''}`.slice(0, 48) }));
    report.contactSheet = await sequenceContactSheet(imp.sequenceId, items.slice(0, 16), R, `${imp.name} — ${report.timecode}`).catch((e) => { report.warnings.push(`contact sheet failed: ${e.message}`); return null; });
    }
  }
  const cutClips = c.pieces.length ? c.pieces.slice(1).map((p) => ({ frame: p.start, label: `${p.id}${p.jump ? ' (jump)' : ''}${p.removedBefore ? ` −${p.removedBefore.reason} ${p.removedBefore.seconds}s` : ''}` })) : t.clips.filter((x) => x.vTrack === 1 && x.start > 0).map((x) => ({ frame: x.start, label: `${x.id} (beat)` }));
  const nCuts = cutClips.length;
  const wantStrips = o.strips === undefined ? nCuts > 0 && nCuts <= 12 : !!o.strips;
  if (wantStrips && nCuts > 0) {
    const limit = typeof o.strips === 'number' ? o.strips : 12;
    const cuts = cutClips.slice(0, limit);
    report.strips = await cutStrips(imp.sequenceId, cuts, R, imp.name).catch((e) => { report.warnings.push(`cut strips failed: ${e.message}`); return null; });
  }
  return { report, compiled: c, issues };
}

/** Place mogrt titles and fill their Essential Graphics fields (live ExtendScript; one undo step per title). */
export async function placeTitles(seqId: string, titles: Compiled['titles'], tpf: number): Promise<{ steps: number; missing: string[] }> {
  const jobs = titles.map((t) => ({ id: t.id, path: nativePath(t.mogrt), start: String(t.start * tpf), end: String(t.end * tpf), vOff: t.track - 1, fields: t.fields }));
  for (const j of jobs) if (!fs.existsSync(j.path)) throw new Error(`title ${j.id}: no such .mogrt ${j.path}`);
  const r = await runEs<{ undo: number; missing: string[] }>(`
var s = prcSeq(${lit(seqId)}); app.project.openSequence(s.sequenceID);
var jobs = ${JSON.stringify(jobs)}, u0 = prcUndo(), missing = [];
for (var i = 0; i < jobs.length; i++) {
  var j = jobs[i];
  // importMGT on a track that doesn't exist lands on V1, over the picture.
  if (j.vOff >= s.videoTracks.numTracks) { missing.push(j.id + ': no track V' + (j.vOff + 1)); continue; }
  var ti = s.importMGT(j.path, j.start, j.vOff, 0);
  if (!ti) { missing.push(j.id + ': importMGT failed'); continue; }
  var e = new Time(); e.ticks = j.end; try { ti.end = e; } catch (err) {}
  var mg = ti.getMGTComponent();
  for (var k in j.fields) if (j.fields.hasOwnProperty(k)) {
    var p = mg ? mg.properties.getParamForDisplayName(k) : null;
    if (p) p.setValue(j.fields[k], true); else missing.push(j.id + ': no field "' + k + '"');
  }
}
prcJson({ undo: prcUndo() - u0, missing: missing });
`, { timeoutMs: 60_000 + jobs.length * 10_000 });
  return { steps: jobs.length, missing: r.missing }; // one undo step per placed title (field values are not undo steps)
}

/**
 * Captions from the kept words' times in the cut → SRT → Premiere caption track (two undo steps); or, when the cut has
 * a caption template (ae-compose `<Captions template>`), one template per caption on its own track with its
 * "Caption" text and "Word Times" (karaoke) filled in (one undo step each).
 */
export async function addCaptions(seqId: string, c: Compiled, o: { maxChars?: number; maxLines?: number }): Promise<number> {
  const fps = c.timeline.rate.num / c.timeline.rate.den;
  const words: { text: string; start: number; end: number }[] = [];
  for (const p of c.pieces) {
    if (!p.words) continue;
    const tr = c.transcripts[p.media];
    for (let i = p.words[0]; i <= p.words[1]; i++) {
      const w = tr.words[i];
      const s = p.start / fps + (w.start - p.inS), e = p.start / fps + (w.end - p.inS);
      words.push({ text: w.text, start: Math.max(p.start / fps, s), end: Math.min(p.end / fps, e) });
    }
  }
  const caps = captionsFromWords(words as any, { maxChars: o.maxChars ?? 42, maxLines: o.maxLines ?? 2 } as any);
  if (c.captionMogrt) {
    const r3 = (x: number) => Math.round(x * 1000) / 1000;
    const jobs = caps.map((cap, k) => {
      const start = Math.round(cap.start * fps);
      // Back-to-back captions: each ends where the next starts (no one-frame overlap on the same track).
      const end = Math.max(start + 1, Math.min(Math.round(cap.end * fps), caps[k + 1] ? Math.round(caps[k + 1].start * fps) : Infinity));
      return { id: `cap${k + 1}`, mogrt: c.captionMogrt!.mogrt, start, end, track: c.captionMogrt!.track, fields: { Caption: cap.lines.join('\r'), 'Word Times': cap.words.map((w) => r3(Math.max(0, w.start - cap.start))).join(' ') } };
    });
    const t = await placeTitles(seqId, jobs, ticksPerFrame(c.timeline.rate));
    const missing = [...new Set(t.missing.map((m) => m.replace(/^cap\d+: /, '')))];
    if (missing.length) c.warnings.push(...missing.map((m) => `captions: ${m} (build the template with <Captions template>)`));
    return t.steps;
  }
  const srt = path.join(CUTS_DIR, `${seqId}.srt`);
  fs.mkdirSync(CUTS_DIR, { recursive: true });
  fs.writeFileSync(srt, toSrt(caps));
  const r = await runEs<{ undo: number; ok: boolean }>(`
var s = prcSeq(${lit(seqId)}), u0 = prcUndo();
var before = app.project.rootItem.children.numItems;
app.project.importFiles([${lit(nativePath(srt))}], true, app.project.rootItem, false);
var item = null;
for (var i = app.project.rootItem.children.numItems - 1; i >= 0; i--) { var it = app.project.rootItem.children[i]; if (it.name === ${lit(path.basename(srt))}) { item = it; break; } }
var ok = item ? s.createCaptionTrack(item, 0, Sequence.CAPTION_FORMAT_SUBTITLE) : false;
prcJson({ undo: prcUndo() - u0, ok: !!ok });
`);
  if (!r.ok) c.warnings.push('captions: Premiere did not create the caption track');
  return 2; // the SRT import and the caption track
}
