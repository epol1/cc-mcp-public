// pr-cut MCP server (stdio): agent-first editing in Premiere Pro. Coarse calls, automatic feedback: every build or
// edit returns its report, lint, a contact sheet and cut strips from Premiere's own frames.
// Tool descriptions are written for agents: when to use the tool, what comes back.
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { appWindows, pressDialog } from '@ae-mcp/core/bridge/dialogs.ts';
import { transcribe, transcriptView, cachedTranscript, TRANSCRIPTS } from '@ae-mcp/core/transcribe/index.ts';
import { findQuote } from '@ae-mcp/core/transcribe/match.ts';
import { fromTicksPerFrame, parseTime, secondsToFrames } from '@ae-mcp/core/time/timecode.ts';
import { es, uxp } from '../bridge.ts';
import { buildCut, type BuildReport } from '../build.ts';
import { reportText } from '../report.ts';
import { doctor, formatChecks } from '../doctor.ts';
import { cutStrips, sequenceContactSheet } from '../frames.ts';
import { inspectSequenceRaw } from '../inspect.ts';
import { outlineSequence } from '../outline.ts';
import { exportSequence, projectInfo, resolveSequence } from '../project.ts';
import { journaled, undoLast } from '../undo.ts';
import { applyCutEdits, EDIT_OPS_HELP } from '../edit.ts';
import { tightenSequence } from '../tighten.ts';
import { libraryTools } from '../library-tools.ts';
import { audioFinish, deliver, matchShots } from '../finish.ts';
import { libraryPath } from '@ae-mcp/core/library/db.ts';

const server = new McpServer({ name: 'pr-cut', version: '0.1.0' }, {
  instructions: 'pr-cut edits in Premiere Pro: transcript-driven rough cuts, word-level tightening, B-roll, titles (ae-compose .mogrts), music, grade, captions, delivery. Read skills/pr-cut/SKILL.md first. Typical loop: library_search / transcribe → read_transcript → paper edit → build_cut → look at the contact sheet and cut strips → apply_cut_edits (each a new version, one undo) → export. Never edit the user\'s sequences in place: pr-cut builds new sequences and versions.',
});

type Content = { type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string };
const text = (t: string): Content => ({ type: 'text', text: t });
async function image(file: string, maxW = 1600): Promise<Content> {
  const buf = await sharp(file).resize({ width: maxW, withoutEnlargement: true }).jpeg({ quality: 82 }).toBuffer();
  return { type: 'image', data: buf.toString('base64'), mimeType: 'image/jpeg' };
}
async function wrap(fn: () => Promise<Content[]>) {
  try { return { content: await fn() }; } catch (e: any) { return { isError: true, content: [text(`error: ${e?.message ?? e}`)] }; }
}

async function withImages(r: BuildReport): Promise<Content[]> {
  const out: Content[] = [text(reportText(r))];
  if (r.contactSheet) out.push(await image(r.contactSheet));
  if (r.strips) out.push(await image(r.strips, 1400));
  return out;
}

const planDescription = `An edit plan (JSON). Shape:
{ name, fps?, size?: [w,h] | "16:9"|"9:16"|"1:1"|"4:5", media?: { alias: path },
  segments: [{ id?, src, words?: [from,to] | sentences?: "s4" | ["s4","s6"] | quote?: "text" | from?/to?: time,
               beat?, tighten?: {fillers?, repeats?, maxPause?, keepPause?, handles?, minPiece?, cut?: [wordIdx | [a,b]]} | false,
               j?: time, l?: time, transition?: "cut"|"dissolve"|"dip-black", transitionFrames?, punchIn?: %, grade?, level?: dB, channels?: [1] }],
  broll?: [{ src, over?: "seg2" | ["seg2","seg3"] | "seg2/3" (the jump cut before seg2's 3rd piece), at?: time, offset?, duration?, in?, audio?: dB, scale?, grade? }],
  titles?: [{ mogrt, at?: time | { seg, offset? }, duration?, track?, fields?: { "Name": "Ana Ruiz" } }],
  music?: [{ src, at?, until?, level?: dB under dialogue (-20), open?: dB in gaps (-12), duck?, ending?: "backtime"|"fade"|"cut", fadeIn?, fadeOut? }],
  tighten?: {...} | false, jumpCuts?: "punch-in"|"none", grade?: { alias|"*": { exposure, contrast, temperature, tint, saturation, ... } },
  markers?: bool, captions?: bool | { maxChars, maxLines } }
Times: seconds, "3.5s", "250ms", "12f", "1:02.5" or timecode. Tightening is on by default (fillers, repeats, pauses > 0.6 s).`;

server.registerTool('build_cut', {
  title: 'Build a cut in Premiere',
  description: 'Turn an edit plan into a new native Premiere sequence (imported as one undo step; the user\'s sequences are never touched). Segments address source by transcript words, sentence ids, a quote or time; tightening removes fillers, repeated words and long pauses at real gaps between words. Returns the report (segments, what was removed, lint: cuts inside words, flash frames, uncovered jump cuts, lip sync, music too loud…), a contact sheet of the cut and strips of frames around each cut. Look at both images before calling the cut done. Use dryRun to check a plan without touching Premiere.',
  inputSchema: { plan: z.any().describe(planDescription), dryRun: z.boolean().optional(), strips: z.union([z.boolean(), z.number().int()]).optional().describe('cut-point strips: default on for ≤ 12 cuts; a number = first N cuts'), baseDir: z.string().optional().describe('directory for relative media paths') },
}, async ({ plan, dryRun, strips, baseDir }) => wrap(async () => {
  const p = typeof plan === 'string' ? JSON.parse(plan) : plan;
  if (dryRun) return [text(reportText((await buildCut(p, { dryRun: true, baseDir, libraryPath })).report))];
  const r = await journaled('build_cut', p.name, async () => { const b = await buildCut(p, { strips, baseDir, libraryPath }); return { ...b, sequenceId: b.report.sequence?.id }; });
  return withImages(r.report);
}));

server.registerTool('apply_cut_edits', {
  title: 'Edit a sequence (as a new version)',
  description: `Apply a batch of edits to a sequence and import the result as its next version ("Name v002"): one undo step, the original untouched. Works on sequences pr-cut built (edits the plan) and on hand-cut ones (edits Premiere's own XML of it, keeping effects and graphics). Returns the new version's report, contact sheet and cut strips.\n${EDIT_OPS_HELP}`,
  inputSchema: { sequence: z.string().optional().describe('sequence id or name (default: active)'), edits: z.array(z.any()).min(1), name: z.string().optional().describe('name for the new version') },
}, async ({ sequence, edits, name }) => wrap(async () => {
  const seq = await resolveSequence(sequence);
  const r = await journaled('apply_cut_edits', `${seq.name}: ${edits.length} edit(s)`, async () => { const b = await applyCutEdits(seq.id, edits, { name }); return { ...b, sequenceId: b.report.sequence?.id }; });
  return [text(r.summary), ...(await withImages(r.report))];
}));

server.registerTool('tighten', {
  title: 'Tighten a sequence by words',
  description: 'Remove fillers ("um", "uh", set-off "you know"/"like"), repeated words ("we, we built") and long pauses from a sequence\'s dialogue, cutting only in gaps between words. dryRun (default true) lists every proposed cut with its words and seconds saved; apply with dryRun false to import the tightened version (one undo step).',
  inputSchema: { sequence: z.string().optional(), dryRun: z.boolean().optional(), fillers: z.boolean().optional(), repeats: z.boolean().optional(), maxPause: z.union([z.number(), z.string()]).optional(), keepPause: z.union([z.number(), z.string()]).optional() },
}, async ({ sequence, dryRun, ...opts }) => wrap(async () => {
  const seq = await resolveSequence(sequence);
  if (dryRun !== false) return [text((await tightenSequence(seq.id, opts, { dryRun: true })).summary)];
  const r = await journaled('tighten', seq.name, async () => { const b = await tightenSequence(seq.id, opts, { dryRun: false }); return { ...b, sequenceId: b.report?.sequence?.id }; });
  return [text(r.summary), ...(r.report ? await withImages(r.report) : [])];
}));

server.registerTool('inspect_sequence', {
  title: 'Outline a sequence',
  description: 'Readable outline of any sequence (yours or pr-cut\'s): every clip with path id (V1/3), sequence and source times, the words spoken in it (from transcripts), grade/scale/levels, graphics fields, transitions and markers. Use before editing a hand-cut sequence.',
  inputSchema: { sequence: z.string().optional().describe('id or name (default: active)'), words: z.boolean().optional() },
}, async ({ sequence, words }) => wrap(async () => [text((await outlineSequence((await resolveSequence(sequence)).id, { words })).text)]));

server.registerTool('inspect_project', {
  title: 'List sequences in the open project',
  description: 'The open Premiere project and its sequences (id, name, length, size).',
  inputSchema: {},
}, async () => wrap(async () => { const p = await projectInfo(); return [text(p.open ? `${p.name} (${p.path})\n${p.sequences.map((s) => `${s.id === p.active ? '*' : ' '} ${s.name} (${s.id}) ${s.seconds}s ${s.size}`).join('\n')}` : 'no project open')]; }));

server.registerTool('transcribe', {
  title: 'Transcribe media',
  description: 'Word-level transcript of a media file (local faster-whisper on the GPU, cached by content hash; fillers kept and flagged, word boundaries snapped to the audio). Returns the sentence view: "s12 [1:02.5–1:06.0] w210–231: text", fillers in (parentheses). Use the sentence ids and word ranges in edit plans.',
  inputSchema: { file: z.string(), language: z.string().optional(), force: z.boolean().optional(), maxChars: z.number().int().optional() },
}, async ({ file, language, force, maxChars }) => wrap(async () => {
  const t = await transcribe(file, { language, force });
  return [text(`${path.basename(t.media)}: ${t.words.length} words, ${t.sentences.length} sentences, ${Math.round(t.duration)} s, ${t.words.filter((w) => w.filler).length} fillers/repeats flagged (${t.engine})\n` + transcriptView(t, { maxChars: maxChars ?? 30_000 }))];
}));

server.registerTool('read_transcript', {
  title: 'Read part of a transcript',
  description: 'The sentence view of a transcribed file between two times (seconds or m:ss), for reading long interviews in chunks.',
  inputSchema: { file: z.string(), from: z.union([z.number(), z.string()]).optional(), to: z.union([z.number(), z.string()]).optional(), maxChars: z.number().int().optional() },
}, async ({ file, from, to, maxChars }) => wrap(async () => {
  const t = cachedTranscript(path.resolve(file)) ?? await transcribe(file);
  return [text(transcriptView(t, { from: from !== undefined ? parseTime(from) : undefined, to: to !== undefined ? parseTime(to) : undefined, maxChars: maxChars ?? 30_000 }))];
}));

server.registerTool('search_transcript', {
  title: 'Find a quote in transcripts',
  description: 'Fuzzy-find a quote (or words) in one file\'s transcript or in every cached transcript. Returns word ranges, times and match scores to use as `words` in a plan.',
  inputSchema: { query: z.string(), file: z.string().optional() },
}, async ({ query, file }) => wrap(async () => {
  const files: string[] = file ? [path.resolve(file)] : [];
  const hits: string[] = [];
  const ts = file ? [cachedTranscript(files[0]) ?? await transcribe(files[0])] : fs.readdirSync(TRANSCRIPTS).filter((f) => f.endsWith('.json')).map((f) => { try { return JSON.parse(fs.readFileSync(path.join(TRANSCRIPTS, f), 'utf8')); } catch { return null; } }).filter(Boolean);
  for (const t of ts) {
    const m = findQuote(t.words, query);
    if (m && m.score >= 0.6) hits.push(`${Math.round(m.score * 100)} % ${t.media} words [${m.from}, ${m.to}] ${t.words[m.from].start.toFixed(2)}–${t.words[m.to].end.toFixed(2)} s: "${m.text}"${m.runnerUp && m.runnerUp.score > 0.6 ? ` (also ${Math.round(m.runnerUp.score * 100)} % at [${m.runnerUp.from}, ${m.runnerUp.to}])` : ''}`);
  }
  return [text(hits.length ? hits.sort().reverse().join('\n') : 'no match ≥ 60 %')];
}));

server.registerTool('snapshot', {
  title: 'Frames of a sequence',
  description: 'A contact sheet of a sequence at given times (Premiere\'s composited program frames: grade, graphics, captions).',
  inputSchema: { sequence: z.string().optional(), at: z.array(z.union([z.number(), z.string()])).min(1).max(24).describe('sequence times') },
}, async ({ sequence, at }) => wrap(async () => {
  const seq = await resolveSequence(sequence);
  const s = await inspectSequenceRaw(seq.id);
  const r = fromTicksPerFrame(s.timebase);
  const sheet = await sequenceContactSheet(seq.id, at.map((t) => ({ frame: secondsToFrames(parseTime(t, r), r), label: String(t) })), r, seq.name);
  return sheet ? [text(sheet), await image(sheet)] : [text('no frames exported')];
}));

server.registerTool('cut_strips', {
  title: 'Frames around cuts',
  description: 'For each cut in V1 (or the given sequence times), frames at −6, −1, 0 and +6 frames, one row per cut: check that cuts land on thoughts, not mid-word or mid-gesture.',
  inputSchema: { sequence: z.string().optional(), at: z.array(z.union([z.number(), z.string()])).optional(), limit: z.number().int().optional() },
}, async ({ sequence, at, limit }) => wrap(async () => {
  const seq = await resolveSequence(sequence);
  const s = await inspectSequenceRaw(seq.id);
  const r = fromTicksPerFrame(s.timebase);
  const cuts = at ? at.map((t) => ({ frame: secondsToFrames(parseTime(t, r), r), label: String(t) })) : s.clips.filter((c) => c.track === 'V1' && c.start > 0).map((c) => ({ frame: Math.round(c.start / s.timebase), label: `V1/${c.index + 1}` }));
  const f = await cutStrips(seq.id, cuts.slice(0, limit ?? 12), r, seq.name);
  return f ? [text(f), await image(f, 1400)] : [text('no cuts')];
}));

server.registerTool('export', {
  title: 'Export a sequence',
  description: 'Export a sequence directly from Premiere (no Media Encoder queue): H.264 MP4 matching the sequence by default, or any .epr preset. Synchronous; returns the file.',
  inputSchema: { sequence: z.string().optional(), out: z.string().optional(), preset: z.string().optional() },
}, async ({ sequence, out, preset }) => wrap(async () => {
  const seq = await resolveSequence(sequence);
  const file = out ?? path.join(process.env.USERPROFILE ?? '.', 'Videos', 'pr-cut', `${seq.name.replace(/[^\w.-]+/g, '_')}.mp4`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const r = await exportSequence(seq.id, file, preset);
  return [text(`exported ${r.file} in ${(r.ms / 1000).toFixed(1)} s`)];
}));

server.registerTool('audio_finish', {
  title: 'Loudness to a delivery target',
  description: 'Measure the sequence mix (EBU R128: integrated LUFS, true peak, loudness range) and bring it to a target: -14 web/social (default), -16 podcast, -23 broadcast. Applies one gain change to every audio clip (keyframes such as music ducking are kept) as a new version, then measures again and says whether it is within ±1 LU. Peaks are kept under the ceiling (default -1 dBTP) by limiting the gain.',
  inputSchema: { sequence: z.string().optional(), target: z.union([z.number(), z.enum(['web', 'social', 'podcast', 'broadcast', 'ebu', 'atsc'])]).optional(), truePeak: z.number().optional(), dryRun: z.boolean().optional() },
}, async ({ sequence, target, truePeak, dryRun }) => wrap(async () => {
  const seq = await resolveSequence(sequence);
  if (dryRun) return [text((await audioFinish(seq.id, { target, truePeak, dryRun: true })).summary)];
  const r = await journaled('audio_finish', seq.name, async () => audioFinish(seq.id, { target, truePeak }));
  return [text(r.summary), ...(r.report ? await withImages(r.report) : [])];
}));

server.registerTool('match_shots', {
  title: 'Match shots to a reference',
  description: 'Colour-match clips to a reference clip (exposure, temperature, tint, saturation from frame statistics) with Lumetri, as a new version. Use for two cameras on one interview, or a B-roll shot that sticks out. dryRun shows the corrections. Clips are V1/<n> ids from inspect_sequence.',
  inputSchema: { sequence: z.string().optional(), reference: z.string(), targets: z.union([z.array(z.string()), z.literal('*')]).optional(), dryRun: z.boolean().optional() },
}, async ({ sequence, reference, targets, dryRun }) => wrap(async () => {
  const seq = await resolveSequence(sequence);
  if (dryRun) return [text((await matchShots(seq.id, reference, targets ?? '*', { dryRun: true })).summary)];
  const r = await journaled('match_shots', seq.name, async () => { const b = await matchShots(seq.id, reference, targets ?? '*'); return { ...b, sequenceId: b.report?.sequence?.id }; });
  return [text(r.summary), ...(r.report ? await withImages(r.report) : [])];
}));

server.registerTool('deliver', {
  title: 'Delivery pack',
  description: 'Export the master (16:9 H.264) and social versions (9:16, 1:1, 4:5) into one folder. Social versions are editable sequences made with Premiere\'s Auto Reframe ("<name> 9x16"; adjust them in Premiere and deliver again to re-export), exported and scaled to 1080×1920 / 1080×1080 / 1080×1350. Captions travel with Auto Reframe. CREDITS.md is written when the project has asset credits.',
  inputSchema: { sequence: z.string().optional(), aspects: z.array(z.enum(['9:16', '1:1', '4:5'])).optional(), outDir: z.string().optional(), master: z.boolean().optional() },
}, async ({ sequence, aspects, outDir, master }) => wrap(async () => {
  const seq = await resolveSequence(sequence);
  const r = await deliver(seq.id, { aspects, outDir, master });
  return [text(r.summary)];
}));

server.registerTool('undo', {
  title: 'Undo the last pr-cut batch',
  description: 'Revert the last build or edit batch in one call (steps back exactly the undo entries it made). Refuses if the undo history moved since (the editor worked in between) unless force.',
  inputSchema: { force: z.boolean().optional() },
}, async ({ force }) => wrap(async () => [text(await undoLast({ force }))]));

server.registerTool('doctor', {
  title: 'Check the setup',
  description: 'Premiere, the CEP bridge, the UXP plugin, transcription engine, ffmpeg, library and cache sizes, with fixes.',
  inputSchema: {},
}, async () => wrap(async () => [text(formatChecks(await doctor()))]));

server.registerTool('list_dialogs', {
  title: 'Dialogs blocking Premiere',
  description: 'Modal dialogs open in Premiere, each with an image (Premiere draws its own controls) and its window handle.',
  inputSchema: {},
}, async () => wrap(async () => {
  const w = await appWindows('pr', { capture: true });
  if (!w.dialogs.length) return [text(w.running ? 'no dialogs' : 'Premiere is not running')];
  const out: Content[] = [text(w.dialogs.map((d) => `hwnd ${d.hwnd} "${d.title}"`).join('\n'))];
  for (const d of w.dialogs) if (d.capture) out.push(await image(d.capture, 900));
  return out;
}));

server.registerTool('answer_dialog', {
  title: 'Answer a Premiere dialog',
  description: 'Press a button on a dialog from list_dialogs ("OK", "Cancel", …; Enter/Escape when the button can\'t be found).',
  inputSchema: { hwnd: z.number().int(), button: z.string() },
}, async ({ hwnd, button }) => wrap(async () => [text(JSON.stringify(await pressDialog(hwnd, button, 'pr')))]));

server.registerTool('run_script', {
  title: 'Run raw script in Premiere (escape hatch)',
  description: 'Run ExtendScript (default) or UXP JavaScript (uxp: true; an async function body with `ppro` = require("premierepro")) in Premiere and return its value. Logged. Prefer the typed tools; use this for one-off reads.',
  inputSchema: { script: z.string(), uxp: z.boolean().optional() },
}, async ({ script, uxp: useUxp }) => wrap(async () => {
  fs.appendFileSync(path.join(process.env.USERPROFILE ?? '.', '.ae-compose', 'pr-cut', 'run_script.log'), `${new Date().toISOString()} ${useUxp ? 'uxp' : 'es'}\n${script}\n\n`);
  const r = await (useUxp ? uxp : es).eval(script);
  return [text(r.ok ? r.result : `error: ${r.error}`)];
}));

libraryTools(server, { text, image, wrap });

await server.connect(new StdioServerTransport());
