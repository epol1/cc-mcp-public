// Adopt any sequence for editing: Premiere exports it as FCP7 XML (its own dialect), which becomes a Timeline:
// linked picture+sound grouped into clips (split edits kept as `video` edges), transitions normalised to cut points,
// and every filter (Lumetri, levels, motion, effects) and graphic carried verbatim so an edited version loses
// nothing Premiere's own round trip keeps.
import fs from 'node:fs';
import path from 'node:path';
import type { MediaInfo } from '@ae-mcp/core/media/probe.ts';
import { rate as toRate, ticksPerFrame, type Rate } from '@ae-mcp/core/time/timecode.ts';
import { lit, nativePath, runEs } from './bridge.ts';
import { PRC_HOME } from './importxml.ts';
import type { TLClip, TLMarker, Timeline } from './timeline.ts';
import { attr, child, el, els, parseXml, serialize, txt, type XEl } from './xml/dom.ts';

export async function exportSequenceXml(seqId: string): Promise<string> {
  const dir = path.join(PRC_HOME, 'adopt');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${seqId.slice(0, 8)}_${Date.now().toString(36)}.xml`);
  await runEs(`var s = prcSeq(${lit(seqId)}); if (!s) throw new Error('no sequence'); s.exportAsFinalCutProXML(${lit(nativePath(file))}, 1); prcJson(1)`);
  const t0 = Date.now();
  while (!fs.existsSync(file) && Date.now() - t0 < 10_000) await new Promise((r) => setTimeout(r, 100));
  return fs.readFileSync(file, 'utf8');
}

export function fileUrlToPath(u: string): string {
  // file://server/share/x is a network path (\\server\share\x); file://localhost/C%3a/x and file:///C:/x are local.
  const host = /^file:\/\/([^/]+)\/(.*)$/i.exec(u);
  if (host && host[1].toLowerCase() !== 'localhost' && !/^[A-Za-z](:|%3a)$/i.test(host[1])) return `\\\\${host[1]}\\${decodeURIComponent(host[2]).replace(/\//g, '\\')}`;
  const s = decodeURIComponent(u.replace(/^file:\/\/localhost\//i, '').replace(/^file:\/\/\//i, '').replace(/^file:\/\//i, ''));
  return path.resolve(s.replace(/^([A-Za-z]):?\//, '$1:/'));
}

const rateOf = (r: XEl | undefined): Rate => {
  const tb = Number(txt(child(r ?? { tag: 'x', attrs: [], kids: [] }, 'timebase')) || 25);
  const ntsc = txt(child(r ?? { tag: 'x', attrs: [], kids: [] }, 'ntsc')).toUpperCase() === 'TRUE';
  return ntsc ? toRate(`${tb * 1000}/1001`) : toRate(tb);
};

export interface Adopted { timeline: Timeline; warnings: string[]; spine: string[] }

/** Premiere FCP7 XML → Timeline. Clip ids are path ids: "V1/3" (picture+sound), "A3/1" (sound only). */
export function adoptXml(xml: string): Adopted {
  const { root } = parseXml(xml);
  const seq = el(root, 'sequence');
  if (!seq) throw new Error('XML has no <sequence>');
  const R = rateOf(el(seq, 'rate'));
  const tpf = ticksPerFrame(R);
  const fmt = child(seq, 'media/video/format/samplecharacteristics');
  const W = Number(txt(child(fmt!, 'width')) || 1920), H = Number(txt(child(fmt!, 'height')) || 1080);
  const warnings: string[] = [];
  // Files: the first <file id> with content defines it.
  const media: Record<string, MediaInfo> = {};
  const fileKey = new Map<string, string>();
  const allFiles: XEl[] = [];
  const walk = (e: XEl) => { for (const k of els(e)) { if (k.tag === 'file') allFiles.push(k); walk(k); } };
  walk(seq);
  for (const f of allFiles) {
    const id = attr(f, 'id')!;
    if (fileKey.has(id) || !els(f).length) continue;
    const url = txt(el(f, 'pathurl'));
    const name = txt(el(f, 'name'));
    const fr = rateOf(el(f, 'rate'));
    const dur = Number(txt(el(f, 'duration')) || 0) * fr.den / fr.num;
    const vs = child(f, 'media/video/samplecharacteristics');
    const au = child(f, 'media/audio');
    const key = url ? `f_${path.basename(fileUrlToPath(url)).replace(/[^\w.-]+/g, '_')}_${id}` : `graphic_${id}`;
    fileKey.set(id, key);
    media[key] = {
      path: url ? fileUrlToPath(url) : '', name, kind: vs ? 'video' : au ? 'audio' : 'video', duration: dur, bytes: 0, container: '',
      ...(vs ? { video: { width: Number(txt(el(vs, 'width')) || W), height: Number(txt(el(vs, 'height')) || H), rate: fr, fps: fr.num / fr.den, frames: Number(txt(el(f, 'duration')) || 0), codec: '', vfr: false } } : {}),
      ...(au ? { audio: { channels: Number(txt(el(au, 'channelcount')) || 2), sampleRate: Number(txt(child(au, 'samplecharacteristics/samplerate')) || 48000), codec: '', streams: 1 } } : {}),
      ...(txt(child(f, 'timecode/string')) ? { timecode: txt(child(f, 'timecode/string')) } : {}),
    };
  }
  // A graphic clipitem whose <file> only references a definition elsewhere gets the definition copied in.
  const defs = new Map(allFiles.filter((f) => els(f).length).map((f) => [attr(f, 'id')!, f]));
  function withFileDef(k: XEl): XEl {
    const f = el(k, 'file');
    if (!f || els(f).length) return k;
    const def = defs.get(attr(f, 'id') ?? '');
    return def ? { ...k, kids: k.kids.map((x) => (x === f ? def : x)) } : k;
  }
  type Item = { id: string; kind: 'video' | 'audio'; track: number; index: number; start: number; end: number; inT: number; outT: number; fileId?: string; links: string[]; filters: string[]; enabled: boolean; sourceTrack?: number; raw?: XEl; name: string; graphic: boolean };
  const items: Item[] = [];
  const prTrack: { video: number[]; audio: number[] } = { video: [], audio: [] };
  const transitions: { kind: 'video' | 'audio'; track: number; start: number; end: number; cut: number; name: string; align: string }[] = [];
  for (const kind of ['video', 'audio'] as const) {
    const tracks = els(child(seq, `media/${kind}`)!, 'track');
    // Premiere shows an exploded stereo pair (currentExplodedTrackIndex 0 and 1) as one track: number audio tracks
    // the way the timeline (and inspect_sequence) does.
    let shown = 0;
    tracks.forEach((tr) => { if (kind === 'audio' && attr(tr, 'currentExplodedTrackIndex') !== '1') shown++; prTrack[kind].push(kind === 'audio' ? shown : prTrack[kind].length + 1); });
    tracks.forEach((tr, ti) => {
      const kids = els(tr).filter((k) => k.tag === 'clipitem' || k.tag === 'transitionitem' || k.tag === 'generatoritem');
      let idx = 0;
      kids.forEach((k, j) => {
        if (k.tag === 'transitionitem') {
          const s = Number(txt(el(k, 'start'))), e = Number(txt(el(k, 'end')));
          const cpt = txt(el(k, 'cutPointTicks'));
          transitions.push({ kind, track: ti + 1, start: s, end: e, cut: cpt ? s + Math.round(Number(cpt) / tpf) : Math.round((s + e) / 2), name: txt(child(k, 'effect/name')), align: txt(el(k, 'alignment')) });
          return;
        }
        const fileEl = el(k, 'file');
        const fid = fileEl ? attr(fileEl, 'id') : undefined;
        const fm = fid ? media[fileKey.get(fid) ?? ''] : undefined;
        const graphic = k.tag === 'generatoritem' || !fm || !fm.path;
        let start = Number(txt(el(k, 'start'))), end = Number(txt(el(k, 'end')));
        const inF = Number(txt(el(k, 'in'))), outF = Number(txt(el(k, 'out')));
        let inT = txt(el(k, 'pproTicksIn')) ? Number(txt(el(k, 'pproTicksIn'))) : inF * tpf;
        let outT = txt(el(k, 'pproTicksOut')) ? Number(txt(el(k, 'pproTicksOut'))) : outF * tpf;
        // FCP7: -1 means "at the neighbouring transition's cut"; the source range was extended under the transition.
        if (start === -1) { const t = kids.slice(0, j).reverse().find((x) => x.tag === 'transitionitem'); if (t) { const ts = Number(txt(el(t, 'start'))); const cpt = txt(el(t, 'cutPointTicks')); const cut = cpt ? ts + Math.round(Number(cpt) / tpf) : Math.round((ts + Number(txt(el(t, 'end')))) / 2); inT += (cut - ts) * tpf; start = cut; } }
        if (end === -1) { const t = kids.slice(j + 1).find((x) => x.tag === 'transitionitem'); if (t) { const ts = Number(txt(el(t, 'start'))), te = Number(txt(el(t, 'end'))); const cpt = txt(el(t, 'cutPointTicks')); const cut = cpt ? ts + Math.round(Number(cpt) / tpf) : Math.round((ts + te) / 2); outT -= (te - cut) * tpf; end = cut; } }
        idx++;
        items.push({
          id: attr(k, 'id') ?? `${kind}${ti}_${j}`, kind, track: ti + 1, index: idx, start, end, inT, outT, fileId: fid, name: txt(el(k, 'name')),
          links: els(k, 'link').map((l) => txt(el(l, 'linkclipref'))), filters: els(k, 'filter').filter((f) => txt(child(f, 'effect/effectid'))).map((f) => serialize(f)), // Premiere exports empty audio filters it can't re-import (D109)
          enabled: txt(el(k, 'enabled')).toUpperCase() !== 'FALSE', sourceTrack: Number(txt(child(k, 'sourcetrack/trackindex')) || 0) || undefined,
          raw: graphic ? withFileDef(k) : undefined, graphic,
        });
      });
    });
  }
  // Group linked items into clips.
  const byId = new Map(items.map((i) => [i.id, i]));
  const done = new Set<string>();
  const clips: TLClip[] = [];
  const spine: string[] = [];
  const sorted = [...items].sort((a, b) => (a.kind === b.kind ? a.track - b.track || a.start - b.start : a.kind === 'video' ? -1 : 1));
  for (const it of sorted) {
    if (done.has(it.id)) continue;
    const group = [it, ...it.links.map((l) => byId.get(l)).filter((x): x is Item => !!x && x.id !== it.id)].filter((x, k, a) => a.indexOf(x) === k);
    for (const g of group) done.add(g.id);
    const v = group.find((g) => g.kind === 'video'), as = group.filter((g) => g.kind === 'audio').sort((a, b) => a.track - b.track);
    const a0 = as[0];
    const lead = a0 ?? v!;
    const key = lead.graphic ? `graphic_${lead.id}` : fileKey.get(lead.fileId!)!;
    if (lead.graphic && !media[key]) media[key] = { path: '', name: lead.name, kind: 'video', duration: (lead.outT - lead.inT) / tpf * R.den / R.num, bytes: 0, container: 'graphic' };
    const id = v ? `V${v.track}/${v.index}` : `A${prTrack.audio[a0.track - 1] ?? a0.track}/${a0.index}`;
    const c: TLClip = {
      id, media: key, name: lead.name, start: lead.start, end: lead.end, inTicks: lead.inT, outTicks: lead.outT,
      ...(v ? { vTrack: v.track } : {}), ...(a0 ? { aTrack: a0.track, channels: as.slice(0, 2).map((x) => x.sourceTrack ?? 1) } : {}),
      raw: { video: v?.filters ?? [], audio: a0?.filters ?? [], ...(lead.graphic ? { item: serialize(lead.raw!) } : {}) },
      ...(v && !v.enabled ? { disabled: true } : {}),
    };
    if (v && a0 && (v.start !== a0.start || v.end !== a0.end || v.inT !== a0.inT)) c.video = { start: v.start, end: v.end, inTicks: v.inT, outTicks: v.outT };
    clips.push(c);
    if (v && v.track === 1 && !v.graphic) spine.push(id);
    if (as.length > 2) warnings.push(`${id}: ${as.length} audio channels linked; pr-cut keeps the first two`);
  }
  // Transitions become transitionIn on the clip that starts at the cut.
  const kindOf = (t: { kind: string; name: string }) => (t.kind === 'audio' ? 'audio-crossfade' : /dip to black/i.test(t.name) ? 'dip-black' : /dip to white/i.test(t.name) ? 'dip-white' : 'dissolve') as 'dissolve';
  for (const t of transitions) {
    const onTrack = (c: TLClip) => (t.kind === 'video' ? c.vTrack === t.track : c.aTrack === t.track || c.aTrack === t.track - 1);
    // Fades at a clip's own head or tail (from/to black or silence): Premiere aligns them start-black / end-black.
    if (t.align === 'start-black' || t.align === 'end-black') {
      const head = t.align === 'start-black';
      const c = clips.find((x) => onTrack(x) && (head ? ((x.video && t.kind === 'video' ? x.video.start : x.start) === t.start) : ((x.video && t.kind === 'video' ? x.video.end : x.end) === t.end)));
      if (!c) { warnings.push(`fade "${t.name}" at frame ${t.start} on ${t.kind[0].toUpperCase()}${t.track} has no clip edge there; dropped`); continue; }
      const f = { kind: kindOf(t), frames: t.end - t.start };
      if (head) { if (!c.fadeIn || t.kind === 'video') c.fadeIn = f; } else if (!c.fadeOut || t.kind === 'video') c.fadeOut = f;
      continue;
    }
    // Audio transitions also appear on the second channel's track of a stereo pair (aTrack + 1).
    const target = clips.find((c) => (t.kind === 'video' ? c.vTrack === t.track : c.aTrack === t.track || c.aTrack === t.track - 1) && (c.video && t.kind === 'video' ? c.video.start : c.start) === t.cut);
    if (target && t.kind === 'video') target.transitionIn = { kind: /dip to black/i.test(t.name) ? 'dip-black' : /dip to white/i.test(t.name) ? 'dip-white' : 'dissolve', frames: t.end - t.start };
    else if (target && t.kind === 'audio' && !target.transitionIn) target.transitionIn = { kind: 'audio-crossfade', frames: t.end - t.start };
    else if (!target) warnings.push(`transition "${t.name}" at frame ${t.cut} on ${t.kind[0].toUpperCase()}${t.track} has no clip starting at its cut; dropped`);
  }
  const markers: TLMarker[] = els(seq, 'marker').map((m) => ({ frame: Number(txt(el(m, 'in'))), duration: Number(txt(el(m, 'out'))) > Number(txt(el(m, 'in'))) ? Number(txt(el(m, 'out'))) - Number(txt(el(m, 'in'))) : undefined, name: txt(el(m, 'name')), comment: txt(el(m, 'comment')) }));
  const name = txt(el(seq, 'name'));
  return { timeline: { name, rate: R, width: W, height: H, media, clips, markers }, warnings, spine };
}

export async function adoptSequence(seqId: string): Promise<Adopted> {
  return adoptXml(await exportSequenceXml(seqId));
}
