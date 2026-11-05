// MCP tools for the shared media library (packages/core/src/library). Shot descriptions are written by the agent:
// library_shots shows a numbered grid of a clip's shots, library_annotate stores what each one shows.
import fs from 'node:fs';
import path from 'node:path';
import sharp, { type OverlayOptions } from 'sharp';
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { annotateShot, library, LIBRARY_DIR, mediaById, mediaByPath, shotsOf } from '@cc-mcp/core/library/db.ts';
import { addFolder, startWorker, status } from '@cc-mcp/core/library/index.ts';
import { formatHits, hitGrid, search } from '@cc-mcp/core/library/search.ts';
import { cachedTranscript, transcriptView } from '@cc-mcp/core/transcribe/index.ts';

type Content = { type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string };
interface Helpers { text: (t: string) => Content; image: (f: string, w?: number) => Promise<Content>; wrap: (fn: () => Promise<Content[]>) => Promise<any> }

const ref = (id: string | number) => {
  const s = String(id).replace(/^lib:/, '');
  const m = /^\d+$/.test(s) ? mediaById(+s) : mediaByPath(s);
  if (!m) throw new Error(`no library item ${id} (ids look like lib:12; library_search finds them)`);
  return m;
};

async function shotGrid(mediaId: number): Promise<string | null> {
  const shots = shotsOf(mediaId).filter((s) => s.thumb && fs.existsSync(s.thumb));
  if (!shots.length) return null;
  const cw = 240, ch = 135, lab = 18, gap = 4, cols = Math.min(6, shots.length), rows = Math.ceil(shots.length / cols);
  const layers: OverlayOptions[] = [];
  for (let i = 0; i < shots.length; i++) {
    const s = shots[i], x = gap + (i % cols) * (cw + gap), y = gap + Math.floor(i / cols) * (ch + lab + gap);
    layers.push({ input: await sharp(s.thumb!).resize(cw, ch, { fit: 'contain', background: '#000' }).png().toBuffer(), left: x, top: y });
    layers.push({ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${cw}" height="${lab}"><rect width="100%" height="100%" fill="#161b22"/><text x="4" y="13" font-family="Consolas, monospace" font-size="11" fill="#c9d1d9">${s.n}. ${s.start.toFixed(1)}–${s.end.toFixed(1)}s${s.description ? ' ✓' : ''}</text></svg>`), left: x, top: y + ch });
  }
  const file = path.join(LIBRARY_DIR, `shots_${mediaId}.png`);
  await sharp({ create: { width: cols * (cw + gap) + gap, height: rows * (ch + lab + gap) + gap, channels: 3, background: '#0d1117' } }).composite(layers).png().toFile(file);
  return file;
}

export function libraryTools(server: McpServer, h: Helpers) {
  server.registerTool('library_add', {
    title: 'Index a folder into the media library',
    description: 'Add a folder (only folders the user named) to the shared media library and index it in the background: technical facts, loudness, transcripts (speech), shots with thumbnails (picture), tempo (music). Incremental and resumable; never touches the media. Poll with library_status.',
    inputSchema: { folder: z.string(), recursive: z.boolean().optional() },
  }, async ({ folder, recursive }) => h.wrap(async () => {
    const r = addFolder(folder, { recursive });
    const w = r.queued ? startWorker() : { started: false };
    return [h.text(`${r.files} media files: ${r.queued} queued, ${r.unchanged} already indexed${r.queued ? `; worker ${w.started ? 'started' : 'already running'}` : ''}`)];
  }));

  server.registerTool('library_status', {
    title: 'Media library progress',
    description: 'Indexing progress (queued / transcribing / done / errors), roles found (interview, broll, music…), folders.',
    inputSchema: {},
  }, async () => h.wrap(async () => {
    const s = status();
    return [h.text(`${s.total} items: ${Object.entries(s.byStatus).map(([k, v]) => `${v} ${k}`).join(', ')}${s.current ? `; now: ${s.current}` : ''}; worker ${s.worker ? 'running' : 'idle'}\nroles: ${Object.entries(s.byRole).map(([k, v]) => `${v} ${k}`).join(', ') || '—'}\nfolders: ${s.folders.join(', ') || '—'}${s.errors.length ? `\nerrors:\n${s.errors.map((e) => `- ${e.name}: ${e.error}`).join('\n')}` : ''}`)];
  }));

  server.registerTool('library_search', {
    title: 'Search the media library',
    description: 'Find footage by what is said (transcripts) and what is seen (shot descriptions, tags, file names), with filters. Returns numbered hits with lib:<id> ids and time ranges (use them as `src` and `in` in edit plans) and a numbered thumbnail grid. An empty query lists by filters.',
    inputSchema: {
      query: z.string(), kind: z.enum(['video', 'audio']).optional(), role: z.string().optional().describe('interview, talking, broll, music'),
      minDuration: z.number().optional(), maxDuration: z.number().optional(), orientation: z.enum(['horizontal', 'vertical', 'square']).optional(), folder: z.string().optional(),
      minTempo: z.number().optional(), maxTempo: z.number().optional(), limit: z.number().int().min(1).max(50).optional(),
    },
  }, async ({ query, limit, ...f }) => h.wrap(async () => {
    const hits = search(query, f, limit ?? 15);
    if (!hits.length) return [h.text('no hits')];
    const grid = await hitGrid(hits);
    return [h.text(formatHits(hits)), ...(grid ? [await h.image(grid, 1300)] : [])];
  }));

  server.registerTool('library_describe', {
    title: 'Everything about one library item',
    description: 'Full record of a library item: technical facts, loudness, role, shots with descriptions, and the transcript (sentence view).',
    inputSchema: { id: z.union([z.string(), z.number()]), maxChars: z.number().int().optional() },
  }, async ({ id, maxChars }) => h.wrap(async () => {
    const m = ref(id);
    const shots = shotsOf(m.id);
    const t = m.kind !== 'audio' ? cachedTranscript(m.path) : null;
    const facts = `lib:${m.id} ${m.path}\n${m.kind} ${m.duration.toFixed(1)} s${m.width ? `, ${m.width}x${m.height} @ ${m.fps?.toFixed(3)} fps${m.vfr ? ' (VFR)' : ''}` : ''}${m.audio_channels ? `, ${m.audio_channels} ch` : ''}, ${m.lufs !== null ? `${m.lufs} LUFS, peak ${m.true_peak} dBFS` : 'no audio'}${m.tempo ? `, ${m.tempo} BPM` : ''}, role ${m.role ?? '?'}${m.timecode ? `, TC ${m.timecode}` : ''}, status ${m.status}${m.error ? ` (${m.error})` : ''}`;
    const sh = shots.map((s) => `shot ${s.n} ${s.start.toFixed(1)}–${s.end.toFixed(1)} s${s.shot_type ? ` ${s.shot_type}` : ''}${s.description ? `: ${s.description}` : ''}${s.tags ? ` [${s.tags}]` : ''}`).join('\n');
    return [h.text(`${facts}\n${sh}${t ? `\ntranscript:\n${transcriptView(t, { maxChars: maxChars ?? 12_000 })}` : ''}`)];
  }));

  server.registerTool('library_shots', {
    title: 'Look at a clip\'s shots',
    description: 'Numbered grid of a library clip\'s shots (✓ = already described). Look at it, then store what each shot shows with library_annotate so "what is seen" becomes searchable.',
    inputSchema: { id: z.union([z.string(), z.number()]) },
  }, async ({ id }) => h.wrap(async () => {
    const m = ref(id);
    const g = await shotGrid(m.id);
    return g ? [h.text(`lib:${m.id} ${m.name}: ${shotsOf(m.id).length} shots`), await h.image(g, 1500)] : [h.text('no shots (audio, or not indexed yet)')];
  }));

  server.registerTool('library_annotate', {
    title: 'Describe shots',
    description: 'Store shot descriptions after looking at library_shots: per shot a short description (subject, action, setting, camera move), tags, shot type (wide/medium/close/insert/aerial) and quality flags (soft, shaky, overexposed, underexposed, noisy audio).',
    inputSchema: { id: z.union([z.string(), z.number()]), shots: z.array(z.object({ n: z.number().int(), description: z.string(), tags: z.array(z.string()).optional(), type: z.string().optional(), quality: z.string().optional() })).min(1) },
  }, async ({ id, shots }) => h.wrap(async () => {
    const m = ref(id);
    for (const s of shots) annotateShot(m.id, s.n, { description: s.description, tags: s.tags, shot_type: s.type, quality: s.quality });
    return [h.text(`stored ${shots.length} shot description(s) for lib:${m.id} ${m.name}`)];
  }));
  void library;
}
