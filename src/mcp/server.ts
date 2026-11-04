// ae-compose MCP server (stdio). Coarse, expressive tools; every build/edit returns its contact sheet.
// Tool descriptions are written for agents: when to use the tool, what comes back.
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { buildScene, inspect, applyEdits, contactSheet, snapshot, listEffects, describeEffect, listDialogs, answerDialog, runExtendScript, importFootage, undo } from '../api/index.ts';
import { doctor } from '../api/doctor.ts';
import { renderPreview } from '../visual/preview.ts';

const pkg = JSON.parse(fs.readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
const server = new McpServer({ name: 'ae-compose', version: pkg.version }, {
  instructions: 'ae-compose builds native, editable After Effects comps from TSX (Remotion-style) and edits existing comps. Read skills/ae-compose/SKILL.md for the DSL. Typical loop: build_scene → look at the returned contact sheet → apply_edits or rebuild → offer variants. Every build/edit returns a contact sheet image; look at it before calling the work done.',
});

type Content = { type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string };
const text = (t: string): Content => ({ type: 'text', text: t });
async function image(file: string, maxW = 1600): Promise<Content> {
  const buf = await sharp(file).resize({ width: maxW, withoutEnlargement: true }).jpeg({ quality: 82 }).toBuffer();
  return { type: 'image', data: buf.toString('base64'), mimeType: 'image/jpeg' };
}
const fail = (e: any) => ({ isError: true, content: [text(`error: ${e?.message ?? e}${e?.dialogs?.length ? `\nA dialog is blocking After Effects: ${e.dialogs.map((d: any) => `hwnd ${d.hwnd} "${d.title}" capture ${d.capture}`).join('; ')}. Use list_dialogs / answer_dialog.` : ''}`)] });
async function wrap(fn: () => Promise<Content[]>) {
  try { return { content: await fn() }; } catch (e) { return fail(e); }
}

server.registerTool('build_scene', {
  title: 'Build a scene in After Effects',
  description: 'Compile a TSX scene (ae-compose DSL, Remotion-style) into native AE comps and return a build report plus a contact sheet image. Pass `source` (TSX text) or `file` (path to a .tsx). Rebuilding the same scene replaces it in place and keeps live control values. Scene variants (config.variants) build as sibling comps. Use `params` to override scene params. Errors include the TSX line.',
  inputSchema: {
    source: z.string().optional().describe('TSX source: `export default scene({...}, () => <Composition>...</Composition>)`'),
    file: z.string().optional().describe('path to a scene .tsx file'),
    cwd: z.string().optional().describe('directory for resolving relative imports/assets when using `source`'),
    params: z.record(z.string(), z.any()).optional(),
    variants: z.union([z.boolean(), z.array(z.string())]).optional().describe('false = only the default build; or a list of variant keys'),
    frames: z.number().int().min(0).max(24).optional().describe('contact sheet frames (default 8; 0 = none)'),
    times: z.array(z.number()).optional().describe('extra exact snapshot times (seconds)'),
  },
}, async (a) => wrap(async () => {
  const r = await buildScene({ source: a.source, file: a.file, cwd: a.cwd ?? (a.file ? path.dirname(path.resolve(a.file)) : process.cwd()) }, { params: a.params, variants: a.variants, frames: a.frames, times: a.times });
  const lines = [`${r.ok ? 'OK' : 'FAILED'}: ${r.scene} → ${r.comps.map((c) => `"${c.name}" (${c.layers} layers)`).join(', ')} in ${r.ms} ms`];
  if (r.error) lines.push(`error: ${r.error}`);
  if (r.warnings.length) lines.push('warnings:', ...r.warnings.map((w) => `- ${w}`));
  if (r.exprErrors.length) lines.push('expression errors:', ...r.exprErrors.map((e) => `- ${e.node} ${e.prop}${e.src ? ` (${e.src})` : ''}: ${e.error}`));
  if (r.restoredControls) lines.push(`kept ${r.restoredControls} live control value(s) from the previous build`);
  lines.push(`contact sheets: ${r.contactSheets.join(', ') || 'none'}`, `IR: ${r.irFile}`);
  const out: Content[] = [text(lines.join('\n'))];
  for (const s of r.contactSheets.slice(0, 4)) out.push(await image(s));
  return out;
}));

server.registerTool('inspect_project', {
  title: 'List project items',
  description: 'Compact list of every comp/footage/folder in the open AE project (names, sizes, durations, aec ids). Use before editing a project you did not build.',
  inputSchema: {},
}, async () => wrap(async () => [text((await inspect({ project: true })).outline)]));

server.registerTool('list_project_items', {
  title: 'List project items (alias)',
  description: 'Same as inspect_project, optionally filtered by type ("Composition", "Footage", "Folder") or name substring.',
  inputSchema: { type: z.string().optional(), name: z.string().optional() },
}, async (a) => wrap(async () => {
  const r = await inspect({ project: true });
  const items = r.json.items.filter((it: any) => (!a.type || it.type === a.type) && (!a.name || String(it.name).toLowerCase().includes(a.name.toLowerCase())));
  return [text(items.map((it: any) => `${it.type} "${it.name}" #${it.id}${it.w ? ` ${it.w}×${it.h}` : ''}${it.dur ? ` ${it.dur}s` : ''}${it.aec ? ` aec:${it.aec}` : ''}`).join('\n') || 'no matching items')];
}));

server.registerTool('inspect_comp', {
  title: 'Inspect a comp',
  description: 'Readable outline of a comp: every layer with timing, animated properties (key counts, values, inferred easing names like "easeOutCubic≈", overshoot), expressions (with errors), effects with changed params, text, shape contents, 3D/camera/light settings. Works on hand-built comps. detail "full" returns raw JSON (every property) for precise edits. Optionally include a contact sheet.',
  inputSchema: {
    comp: z.union([z.string(), z.number()]).optional().describe('comp name, aec id, or item id; default: active comp'),
    detail: z.enum(['outline', 'full']).optional(),
    layers: z.array(z.union([z.string(), z.number()])).optional().describe('limit to these layers (name, aec id, or index)'),
    sheet: z.boolean().optional().describe('also return a contact sheet'),
  },
}, async (a) => wrap(async () => {
  const r = await inspect({ comp: a.comp, detail: a.detail, layers: a.layers });
  const out: Content[] = [text(a.detail === 'full' ? JSON.stringify(r.json).slice(0, 180_000) : r.outline)];
  if (a.sheet) out.push(await image((await contactSheet(a.comp, 8)).sheet));
  return out;
}));

server.registerTool('apply_edits', {
  title: 'Edit a comp (batched, one undo step)',
  description: 'Apply a batch of edit ops to an existing comp (generated or hand-built) in ONE undo group, then return what changed plus a contact sheet. Ops (see SKILL.md): set {layer, prop, value|keys|expr}; ease {layer, prop, easing: "easeOutBack"|[x1,y1,x2,y2]|"bounce"|"elastic", keys?}; easeKey {layer, prop, key, side, speed?, influence?}; interpolation; retime {layer, shift?, scale?}; layerTiming; addEffect {layer, effect: "Glow", params}; setEffect {layer, effect, params, enabled?}; removeEffect; moveEffect; text {layer, text?, font?, size?, color?}; path {layer, prop, d|points}; layer {layer, set:{parent, blend, matte, threeD, index...}}; addLayer {spec: IR layer}; removeLayer; duplicateLayer; comp {set:{renderer, bg, duration...}}; precompose {layers, name}; duplicateComp {name}; addControls {layer, prop, delay?, speed?}. Layers are aec ids, names or 1-based indices; props are friendly names (position, x, y, scale, rotation, opacity, anchor) or AE paths ("Effects/Glow/Glow Radius").',
  inputSchema: {
    comp: z.union([z.string(), z.number()]).optional(),
    ops: z.array(z.record(z.string(), z.any())).min(1),
    frames: z.number().int().min(0).max(16).optional().describe('contact sheet frames (default 6; 0 = none)'),
  },
}, async (a) => wrap(async () => {
  const r = await applyEdits({ comp: a.comp, ops: a.ops as any }, { frames: a.frames });
  const lines = [`${r.ok ? 'OK' : 'FAILED'}: ${r.comp ?? a.comp} — ${r.changes?.length ?? 0} change(s) in ${r.ms} ms (one undo step: call undo to revert)`];
  if (r.error) lines.push(`error: ${r.error} (${r.at})`);
  for (const c of r.changes ?? []) lines.push(`- ${JSON.stringify(c)}`);
  for (const e of r.exprErrors ?? []) lines.push(`expression error ${e.prop}: ${e.error}`);
  const out: Content[] = [text(lines.join('\n'))];
  if (r.contactSheet) out.push(await image(r.contactSheet));
  return out;
}));

server.registerTool('create_variants', {
  title: 'Build A/B/C variants',
  description: 'Build a scene several times with different params as sibling comps (Name_v001_A, _B, ...), returning one contact sheet per variant. Use for subjective choices (timing, color, type). Each variant is a params object merged over the scene defaults; include `seed` to vary randomness.',
  inputSchema: {
    source: z.string().optional(),
    file: z.string().optional(),
    variants: z.record(z.string(), z.record(z.string(), z.any())).describe('{ A: {...params}, B: {...params} }'),
    frames: z.number().int().min(0).max(16).optional(),
  },
}, async (a) => wrap(async () => {
  const out: Content[] = [];
  const { loadScene } = await import('../scene/load.ts');
  const loaded = await loadScene({ file: a.file, source: a.source });
  loaded.def.config.variants = a.variants as any;
  const r = await buildScene({ def: loaded.def, file: loaded.file }, { frames: a.frames ?? 6 });
  out.push(text(`${r.ok ? 'OK' : 'FAILED'}: ${r.comps.map((c) => c.name).join(', ')}${r.error ? `\nerror: ${r.error}` : ''}`));
  for (const s of r.contactSheets) out.push(await image(s, 1200));
  return out;
}));

server.registerTool('snapshot', {
  title: 'Capture frames',
  description: 'Render exact frames of a comp as images (as AE renders them). Use to check a specific moment (peak of an overshoot, a transition midpoint, the final hold).',
  inputSchema: { comp: z.union([z.string(), z.number()]).optional(), times: z.array(z.number()).min(1).max(12).describe('seconds') },
}, async (a) => wrap(async () => {
  const r = await snapshot(a.comp, a.times);
  const out: Content[] = [text(`${r.comp}: ${r.files.length} frame(s)\n${r.files.join('\n')}`)];
  for (const f of r.files) out.push(await image(f, 1280));
  return out;
}));

server.registerTool('contact_sheet', {
  title: 'Contact sheet',
  description: 'Grid of N evenly spaced frames across the whole comp with timecodes: the fastest way to judge layout, timing, blank frames and overall motion. Particle scenes need more frames (12–16).',
  inputSchema: { comp: z.union([z.string(), z.number()]).optional(), frames: z.number().int().min(2).max(24).optional() },
}, async (a) => wrap(async () => {
  const r = await contactSheet(a.comp, a.frames ?? 12);
  return [text(`${r.comp}: ${r.frames.length} frames → ${r.sheet}`), await image(r.sheet)];
}));

server.registerTool('render_preview', {
  title: 'Render a short preview',
  description: 'Render a short low-res MP4 (or GIF) of a time range to judge motion feel (easing, springs, particles). Returns the file path; GIFs are also returned as images. Captures the live (unsaved) state inside AE; `aerender: true` renders the saved project file instead.',
  inputSchema: { comp: z.union([z.string(), z.number()]).optional(), start: z.number().optional(), end: z.number().optional(), scale: z.number().min(0.1).max(1).optional(), fps: z.number().min(5).max(60).optional(), gif: z.boolean().optional(), aerender: z.boolean().optional() },
}, async (a) => wrap(async () => {
  const r = await renderPreview(a.comp, a);
  const out: Content[] = [text(`${r.method}: ${r.frames} frames → ${r.file} (${r.ms} ms)${r.warnings.length ? '\n' + r.warnings.join('\n') : ''}`)];
  if (a.gif) out.push({ type: 'image', data: fs.readFileSync(r.file).toString('base64'), mimeType: 'image/gif' });
  return out;
}));

server.registerTool('list_effects', {
  title: 'Search effects',
  description: 'Search the vanilla After Effects effects (Red Giant/third-party excluded) by name, matchName or category. Use the display name or matchName in <Effect name=...> or addEffect.',
  inputSchema: { query: z.string().optional(), limit: z.number().int().optional() },
}, async (a) => wrap(async () => [text(listEffects(a.query ?? '', a.limit ?? 50).map((e) => `${e.name} [${e.mn}] — ${e.category}`).join('\n') || 'no matches')]));

server.registerTool('describe_effect', {
  title: 'Describe an effect',
  description: 'Full parameter list of an effect as installed in this AE: names, matchNames, types, defaults, ranges, popup options ("2=Color Channels"), layer-reference params. Use before setting params you are unsure about.',
  inputSchema: { name: z.string().describe('display name ("Glow") or matchName ("ADBE Glo2")') },
}, async (a) => wrap(async () => {
  const r = await describeEffect(a.name);
  if (!r.ok) throw new Error(r.error);
  return [text(`${r.name} (${r.matchName})\n` + r.params.map((p: any) => `${p.index}. ${p.group ? p.group + ' › ' : ''}${p.name} [${p.mn}] ${p.type}${p.default !== undefined ? ` default ${JSON.stringify(p.default)}` : ''}${p.min !== undefined ? ` range ${p.min}..${p.max}` : ''}${p.layerRef ? ' (layer reference: {layer: "<id>"})' : ''}${p.options ? `\n   options: ${p.options.join(' | ')}` : ''}`).join('\n'))];
}));

server.registerTool('import_footage', {
  title: 'Import a file',
  description: 'Import footage/images/audio/3D models (glb/gltf/obj)/HDRIs/SVG into the project. Scenes can also import directly via <Footage src="...">.',
  inputSchema: { path: z.string(), folder: z.string().optional().describe('project folder path, e.g. "ae-compose/Assets"') },
}, async (a) => wrap(async () => [text(JSON.stringify(await importFootage(a.path, a.folder)))]));

server.registerTool('list_dialogs', {
  title: 'Find blocking dialogs',
  description: 'List modal dialogs currently blocking After Effects, each with an image capture (AE draws its own controls, so read the image). Use when a call times out or AE seems stuck. Then answer_dialog.',
  inputSchema: {},
}, async () => wrap(async () => {
  const r = await listDialogs();
  const out: Content[] = [text(r.dialogs.length ? r.dialogs.map((d) => `hwnd ${d.hwnd} "${d.title}"${d.owned ? '' : ' (startup)'} buttons: ${d.buttons?.join(', ') || 'drawn by AE: see image'}`).join('\n') : `no dialogs open${r.hung ? '; AE is busy (not responding)' : ''}${r.running ? '' : '; AE is not running'}`)];
  for (const d of r.dialogs) if (d.capture) out.push(await image(d.capture, 1000));
  return out;
}));

server.registerTool('answer_dialog', {
  title: 'Answer a dialog',
  description: 'Press a button on a dialog from list_dialogs: a button label ("OK", "Continue", "Don\'t Save") is clicked via UI Automation when available; "Cancel"/"Close" closes it; otherwise Enter presses the default button.',
  inputSchema: { hwnd: z.number().int(), button: z.string() },
}, async (a) => wrap(async () => [text(JSON.stringify(await answerDialog(a.hwnd, a.button)))]));

server.registerTool('undo', {
  title: 'Undo',
  description: 'Edit > Undo in After Effects. Each build_scene / apply_edits is exactly one undo step.',
  inputSchema: {},
}, async () => wrap(async () => [text(JSON.stringify(await undo()))]));

server.registerTool('doctor', {
  title: 'Check environment',
  description: 'Check that After Effects, the CEP bridge, the runtime and tools are ready; each failure comes with a fix.',
  inputSchema: {},
}, async () => wrap(async () => {
  const r = await doctor();
  return [text(r.checks.map((c) => `${c.ok ? 'OK ' : c.warn ? 'WARN' : 'FAIL'} ${c.name}: ${c.detail}${!c.ok && c.fix ? ` → fix: ${c.fix}` : ''}`).join('\n'))];
}));

server.registerTool('run_extendscript', {
  title: 'Run raw ExtendScript (escape hatch)',
  description: 'Run raw ExtendScript (ES3) in After Effects and return the string value of the last expression. Logged. Prefer build_scene/apply_edits; never touch shape gradient properties (crashes AE 26.5). Wrap mutations in app.beginUndoGroup/endUndoGroup.',
  inputSchema: { code: z.string(), timeoutMs: z.number().int().optional() },
}, async (a) => wrap(async () => {
  const r = await runExtendScript(a.code, a.timeoutMs);
  return [text(r.ok ? r.result : `error: ${r.error}${r.line ? ` (line ${r.line})` : ''}`)];
}));

await server.connect(new StdioServerTransport());
