// Timeline → FCP7 XML (xmeml v4) in Premiere's own dialect, as Premiere 26.5 exports it (spike, D106): linked
// A/V clipitems, stereo exploded to two mono tracks, exact `pproTicksIn/Out`, transitions centred on cuts with the
// FCP7 "-1" start/end convention, Audio Levels as linear gain, Basic Motion, and Lumetri copied from Premiere's own
// filter block. Importing the file is one undo step and lands as a new sequence that reuses existing master clips.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { framesToTimecode, ticksPerFrame, timecodeToFrames, xmlRate, type Rate } from '@ae-mcp/core/time/timecode.ts';
import type { MediaInfo } from '@ae-mcp/core/media/probe.ts';
import { timelineEnd, type Grade, type TLClip, type Timeline } from '../timeline.ts';
import { el, parseXml, serialize, setText, txt, type XEl } from './dom.ts';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** file://localhost/C%3a/path%20with%20spaces/x.mp4, as Premiere writes it. */
export function pathUrl(p: string): string {
  // Network paths (\\server\share\x.mp4) are file://server/share/x.mp4: "localhost" would point at a local folder.
  const unc = /^[\\/]{2}([^\\/]+)[\\/](.*)$/.exec(p);
  if (unc) return `file://${unc[1]}/${unc[2].replace(/\\/g, '/').split('/').map(encodeURIComponent).join('/')}`;
  const abs = path.resolve(p).replace(/\\/g, '/');
  const enc = abs.split('/').map((seg, i) => (i === 0 && /^[A-Za-z]:$/.test(seg) ? `${seg[0]}%3a` : encodeURIComponent(seg))).join('/');
  return `file://localhost/${enc.replace(/^\/+/, '')}`;
}

const rateXml = (r: Rate, ind: string) => {
  const x = xmlRate(r);
  return `${ind}<rate>\n${ind}\t<timebase>${x.timebase}</timebase>\n${ind}\t<ntsc>${x.ntsc ? 'TRUE' : 'FALSE'}</ntsc>\n${ind}</rate>`;
};

/** Premiere's dB ↔ linear gain in XML Audio Levels (1 = 0 dB, max 3.98109 = +12 dB). */
export const dbToGain = (db: number) => Math.min(3.98109, Math.pow(10, db / 20));

const LUMETRI_TEMPLATE = () => fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'lumetri-default.xml'), 'utf8');

/** Grade field → Lumetri parameter name in Premiere's XML (the Basic Correction and Creative sliders). */
const LUMETRI_PARAM: Record<keyof Grade, { id: string; name: string }> = {
  temperature: { id: '7', name: 'Temperature' }, tint: { id: '8', name: 'Tint' }, saturation: { id: '20', name: 'Saturation' },
  exposure: { id: '11', name: 'Exposure' }, contrast: { id: '12', name: 'Contrast' }, highlights: { id: '13', name: 'Highlights' },
  shadows: { id: '14', name: 'Shadows' }, whites: { id: '15', name: 'Whites' }, blacks: { id: '16', name: 'Blacks' },
  fadedFilm: { id: '28', name: 'Faded Film' }, sharpen: { id: '29', name: 'Sharpen' }, vibrance: { id: '30', name: 'Vibrance' },
};

export function lumetriFilter(g: Grade, ind: string): string {
  return patchLumetri(LUMETRI_TEMPLATE(), g).trim().split('\n').map((l) => ind + l).join('\n');
}

/** Set Basic Correction / Creative values inside a Lumetri filter block (Premiere's own or the template). */
export function patchLumetri(block: string, g: Grade): string {
  for (const [k, v] of Object.entries(g) as [keyof Grade, number][]) {
    if (v === undefined) continue;
    const p = LUMETRI_PARAM[k];
    if (!p) throw new Error(`grade: unknown control "${k}" (use ${Object.keys(LUMETRI_PARAM).join(', ')})`);
    const re = new RegExp(`(<parameterid>${p.id}</parameterid>\\s*<name>${p.name}</name>[\\s\\S]*?<value>)(-?\\d+,)(-?[\\d.]+)(,[^<]*</value>)`);
    if (!re.test(block)) throw new Error(`grade: Lumetri template has no ${p.name} parameter`);
    block = block.replace(re, (_m, a, t, _old, b) => `${a}${t}${Number(v)}${b}`);
  }
  return block;
}

const effectId = (filter: string) => /<effectid>([^<]*)<\/effectid>/.exec(filter)?.[1] ?? '';

/** Set the scale of a Basic Motion filter block; keyframed scale is scaled by the same ratio. */
export function patchScale(block: string, scale: number): string {
  return block.replace(/(<parameter[^>]*>\s*<parameterid>scale<\/parameterid>)([\s\S]*?)(<\/parameter>)/, (_m, head, body: string, tail) => {
    const base = Number(/<value>(-?[\d.]+)<\/value>/.exec(body)?.[1] ?? 100) || 100;
    const k = scale / base;
    return head + body.replace(/<value>(-?[\d.]+)<\/value>/g, (_v, x) => `<value>${Math.round(Number(x) * k * 1000) / 1000}</value>`) + tail;
  });
}

interface Ids { clip: number; file: Map<string, string>; master: Map<string, string> }

function fileXml(key: string, m: MediaInfo, seqRate: Rate, ids: Ids, ind: string): string {
  const existing = ids.file.get(key);
  if (existing) return `${ind}<file id="${existing}"/>`;
  const id = `file-${ids.file.size + 1}`;
  ids.file.set(key, id);
  const r = m.video?.rate ?? seqRate;
  const durFrames = Math.round(m.duration * (r.num / r.den));
  const lines = [`${ind}<file id="${id}">`, `${ind}\t<name>${esc(m.name)}</name>`, `${ind}\t<pathurl>${pathUrl(m.path)}</pathurl>`, rateXml(r, ind + '\t'), `${ind}\t<duration>${durFrames}</duration>`];
  if (m.timecode) {
    let frame = 0;
    try { frame = timecodeToFrames(m.timecode, r); } catch { /* odd timecode: start at 0 */ }
    lines.push(`${ind}\t<timecode>`, rateXml(r, ind + '\t\t'), `${ind}\t\t<string>${esc(m.timecode)}</string>`, `${ind}\t\t<frame>${frame}</frame>`, `${ind}\t\t<displayformat>${/;/.test(m.timecode) ? 'DF' : 'NDF'}</displayformat>`, `${ind}\t</timecode>`);
  }
  lines.push(`${ind}\t<media>`);
  if (m.video && m.kind !== 'audio') lines.push(`${ind}\t\t<video>`, `${ind}\t\t\t<samplecharacteristics>`, rateXml(r, ind + '\t\t\t\t'), `${ind}\t\t\t\t<width>${m.video.width}</width>`, `${ind}\t\t\t\t<height>${m.video.height}</height>`, `${ind}\t\t\t\t<anamorphic>FALSE</anamorphic>`, `${ind}\t\t\t\t<pixelaspectratio>square</pixelaspectratio>`, `${ind}\t\t\t\t<fielddominance>none</fielddominance>`, `${ind}\t\t\t</samplecharacteristics>`, `${ind}\t\t</video>`);
  if (m.audio) lines.push(`${ind}\t\t<audio>`, `${ind}\t\t\t<samplecharacteristics>`, `${ind}\t\t\t\t<depth>16</depth>`, `${ind}\t\t\t\t<samplerate>${m.audio.sampleRate}</samplerate>`, `${ind}\t\t\t</samplecharacteristics>`, `${ind}\t\t\t<channelcount>${m.audio.channels}</channelcount>`, `${ind}\t\t</audio>`);
  lines.push(`${ind}\t</media>`, `${ind}</file>`);
  return lines.join('\n');
}

interface Edges { start: number; end: number; inTicks: number; outTicks: number }
interface Item {
  clip: TLClip;
  /** This item's own edges: the clip's, or its picture's for a split edit. */
  e: Edges;
  kind: 'video' | 'audio';
  track: number;
  sourceTrack?: number;
  xmlId: string;
  /** Clip index within its track (1-based), for <link>. */
  index?: number;
  links: Item[];
}

const TRANSITION: Record<string, { name: string; id: string; cat: string; media: 'video' | 'audio' }> = {
  dissolve: { name: 'Cross Dissolve', id: 'Cross Dissolve', cat: 'Dissolve', media: 'video' },
  'dip-black': { name: 'Dip to Black', id: 'Dip to Black', cat: 'Dissolve', media: 'video' },
  'dip-white': { name: 'Dip to White', id: 'Dip to White', cat: 'Dissolve', media: 'video' },
  'audio-crossfade': { name: 'Constant Power', id: 'KGAudioTransCrossFade3dB', cat: 'Crossfade', media: 'audio' },
};

export interface WriteResult { xml: string; videoTracks: number; audioTracks: number; durationFrames: number; warnings: string[] }

export function writeFcp7(t: Timeline): WriteResult {
  const warnings: string[] = [];
  const tpf = ticksPerFrame(t.rate);
  const ids: Ids = { clip: 0, file: new Map(), master: new Map() };
  const vTracks = Math.max(1, t.minVideoTracks ?? 0, ...t.clips.map((c) => c.vTrack ?? 0));
  // Audio tracks: every audio use takes its channel count of tracks starting at aTrack.
  const chans = (c: TLClip) => {
    const m = t.media[c.media];
    if (!m?.audio) return [];
    return c.channels ?? (m.audio.channels >= 2 ? [1, 2] : [1]);
  };
  const aTracksUsed = Math.max(2, ...t.clips.map((c) => (c.aTrack ? c.aTrack + chans(c).length - 1 : 0)));
  const aTracks = aTracksUsed + (aTracksUsed % 2); // whole stereo pairs

  // Items per track, sorted by start.
  const items: Item[] = [];
  for (const c of t.clips) {
    const m = t.media[c.media];
    if (!m) throw new Error(`clip ${c.id}: unknown media "${c.media}"`);
    if (c.end <= c.start) throw new Error(`clip ${c.id}: empty or negative duration (${c.start}–${c.end})`);
    const group: Item[] = [];
    const ve = c.video ?? c;
    if (ve.end <= ve.start) throw new Error(`clip ${c.id}: empty picture range (${ve.start}–${ve.end})`);
    const mv = t.media[c.videoMedia ?? c.media];
    if (c.videoMedia && !mv) throw new Error(`clip ${c.id}: unknown picture media "${c.videoMedia}"`);
    if (c.vTrack && mv.kind !== 'audio') group.push({ clip: c, e: ve, kind: 'video', track: c.vTrack, xmlId: `clipitem-${++ids.clip}`, links: [] });
    if (c.aTrack && m.audio) chans(c).forEach((ch, k) => group.push({ clip: c, e: c, kind: 'audio', track: c.aTrack! + k, sourceTrack: ch, xmlId: `clipitem-${++ids.clip}`, links: [] }));
    for (const it of group) it.links = group;
    items.push(...group);
  }
  const byTrack = (kind: 'video' | 'audio', n: number) => items.filter((i) => i.kind === kind && i.track === n).sort((a, b) => a.e.start - b.e.start);
  for (let n = 1; n <= vTracks; n++) byTrack('video', n).forEach((it, k) => (it.index = k + 1));
  for (let n = 1; n <= aTracks; n++) byTrack('audio', n).forEach((it, k) => (it.index = k + 1));
  // Overlap check per track (Premiere would silently overwrite).
  for (const kind of ['video', 'audio'] as const) for (let n = 1; n <= (kind === 'video' ? vTracks : aTracks); n++) {
    const tr = byTrack(kind, n);
    for (let k = 1; k < tr.length; k++) if (tr[k].e.start < tr[k - 1].e.end) throw new Error(`${kind} track ${n}: ${tr[k].clip.id} (${tr[k].e.start}) overlaps ${tr[k - 1].clip.id} (ends ${tr[k - 1].e.end})`);
  }

  const clipItem = (it: Item, ind: string, trIn?: number, trOut?: number, edgeIn = false, edgeOut = false): string => {
    const c = it.clip, key = it.kind === 'video' ? c.videoMedia ?? c.media : c.media, m = t.media[key];
    if (c.raw?.item) return rawItem(c, it, ind);
    const masterKey = key;
    if (!ids.master.has(masterKey)) ids.master.set(masterKey, `masterclip-${ids.master.size + 1}`);
    const r = m.video?.rate ?? t.rate;
    const durFrames = Math.round(m.duration * (r.num / r.den));
    // Under a transition the clip's edge becomes -1 and its source range extends by the overlap (FCP7 convention).
    let inT = it.e.inTicks, outT = it.e.outTicks, start: number = it.e.start, end: number = it.e.end;
    if (trIn) { start = -1; inT -= trIn * tpf; }
    if (trOut) { end = -1; outT += trOut * tpf; }
    if (edgeIn) start = -1; // a head fade: the edge comes from the transition, the source range stays
    if (edgeOut) end = -1;
    if (inT < 0) { warnings.push(`${c.id}: not enough source before the in point for the transition; it starts at the media start`); inT = 0; }
    const lines = [
      `${ind}<clipitem id="${it.xmlId}"${it.kind === 'audio' ? ` premiereChannelType="${chans(c).length >= 2 ? 'stereo' : 'mono'}"` : ''}>`,
      `${ind}\t<masterclipid>${ids.master.get(masterKey)}</masterclipid>`,
      `${ind}\t<name>${esc(c.name ?? m.name)}</name>`,
      `${ind}\t<enabled>${c.disabled && it.kind === 'video' ? 'FALSE' : 'TRUE'}</enabled>`,
      `${ind}\t<duration>${durFrames}</duration>`,
      rateXml(t.rate, ind + '\t'),
      `${ind}\t<start>${start}</start>`, `${ind}\t<end>${end}</end>`,
      `${ind}\t<in>${Math.round(inT / tpf)}</in>`, `${ind}\t<out>${Math.round(outT / tpf)}</out>`,
      `${ind}\t<pproTicksIn>${inT}</pproTicksIn>`, `${ind}\t<pproTicksOut>${outT}</pproTicksOut>`,
    ];
    const alpha = c.alpha ?? (/^(yuva|rgba|argb|bgra|abgr|gbrap|ya)/.test(m.video?.pixFmt ?? '') ? 'straight' : 'none');
    if (it.kind === 'video') lines.push(`${ind}\t<alphatype>${alpha}</alphatype>`, `${ind}\t<pixelaspectratio>square</pixelaspectratio>`, `${ind}\t<anamorphic>FALSE</anamorphic>`);
    lines.push(fileXml(key, m, t.rate, ids, ind + '\t'));
    if (it.kind === 'audio') lines.push(`${ind}\t<sourcetrack>`, `${ind}\t\t<mediatype>audio</mediatype>`, `${ind}\t\t<trackindex>${it.sourceTrack}</trackindex>`, `${ind}\t</sourcetrack>`);
    // Filters carried from an adopted sequence, minus the ones this clip now sets itself.
    const raws = (it.kind === 'video' ? c.raw?.video : c.raw?.audio) ?? [];
    // A carried Basic Motion keeps its position, rotation, anchor and crop: only its scale is patched (a punch-in).
    const rawBasic = it.kind === 'video' && !!c.motion && !c.motion.center && raws.some((f) => effectId(f) === 'basic');
    for (const f of raws) {
      const id = effectId(f);
      if (it.kind === 'video' && c.motion && id === 'basic') { if (rawBasic) lines.push(ind + '\t' + patchScale(f, c.motion.scale ?? 100)); continue; }
      if (it.kind === 'audio' && (c.level !== undefined || c.levelKeys?.length) && id === 'audiolevels') continue;
      lines.push(ind + '\t' + (it.kind === 'video' && c.grade && id === 'Lumetri' ? patchLumetri(f, c.grade) : f));
    }
    const rawLumetri = it.kind === 'video' && raws.some((f) => effectId(f) === 'Lumetri');
    if (it.kind === 'video' && c.motion && !rawBasic) {
      const [h, v] = c.motion.center ?? [0, 0];
      lines.push(`${ind}\t<filter>`, `${ind}\t\t<effect>`, `${ind}\t\t\t<name>Basic Motion</name>`, `${ind}\t\t\t<effectid>basic</effectid>`, `${ind}\t\t\t<effectcategory>motion</effectcategory>`, `${ind}\t\t\t<effecttype>motion</effecttype>`, `${ind}\t\t\t<mediatype>video</mediatype>`,
        `${ind}\t\t\t<parameter authoringApp="PremierePro">`, `${ind}\t\t\t\t<parameterid>scale</parameterid>`, `${ind}\t\t\t\t<name>Scale</name>`, `${ind}\t\t\t\t<valuemin>0</valuemin>`, `${ind}\t\t\t\t<valuemax>10000</valuemax>`, `${ind}\t\t\t\t<value>${c.motion.scale ?? 100}</value>`, `${ind}\t\t\t</parameter>`,
        `${ind}\t\t\t<parameter authoringApp="PremierePro">`, `${ind}\t\t\t\t<parameterid>center</parameterid>`, `${ind}\t\t\t\t<name>Center</name>`, `${ind}\t\t\t\t<value>`, `${ind}\t\t\t\t\t<horiz>${h}</horiz>`, `${ind}\t\t\t\t\t<vert>${v}</vert>`, `${ind}\t\t\t\t</value>`, `${ind}\t\t\t</parameter>`,
        `${ind}\t\t</effect>`, `${ind}\t</filter>`);
    }
    if (it.kind === 'video' && c.grade && Object.keys(c.grade).length && !rawLumetri) lines.push(lumetriFilter(c.grade, ind + '\t'));
    if (it.kind === 'audio' && (c.level || c.levelKeys?.length)) {
      lines.push(`${ind}\t<filter>`, `${ind}\t\t<effect>`, `${ind}\t\t\t<name>Audio Levels</name>`, `${ind}\t\t\t<effectid>audiolevels</effectid>`, `${ind}\t\t\t<effectcategory>audiolevels</effectcategory>`, `${ind}\t\t\t<effecttype>audiolevels</effecttype>`, `${ind}\t\t\t<mediatype>audio</mediatype>`,
        `${ind}\t\t\t<parameter authoringApp="PremierePro">`, `${ind}\t\t\t\t<parameterid>level</parameterid>`, `${ind}\t\t\t\t<name>Level</name>`, `${ind}\t\t\t\t<valuemin>0</valuemin>`, `${ind}\t\t\t\t<valuemax>3.98109</valuemax>`, `${ind}\t\t\t\t<value>${round6(dbToGain(c.level ?? 0))}</value>`);
      // Keyframe <when> is in frames from the clip's source in point (FCP7), so sequence frame f → in + (f − start).
      const inFrame = Math.round(inT / tpf), startFrame = it.e.start;
      for (const k of c.levelKeys ?? []) lines.push(`${ind}\t\t\t\t<keyframe>`, `${ind}\t\t\t\t\t<when>${inFrame + (k.frame - startFrame)}</when>`, `${ind}\t\t\t\t\t<value>${round6(dbToGain(k.db))}</value>`, `${ind}\t\t\t\t</keyframe>`);
      lines.push(`${ind}\t\t\t</parameter>`, `${ind}\t\t</effect>`, `${ind}\t</filter>`);
    }
    for (const l of it.links) {
      lines.push(`${ind}\t<link>`, `${ind}\t\t<linkclipref>${l.xmlId}</linkclipref>`, `${ind}\t\t<mediatype>${l.kind}</mediatype>`, `${ind}\t\t<trackindex>${l.track}</trackindex>`, `${ind}\t\t<clipindex>${l.index}</clipindex>`);
      if (l.kind === 'audio') lines.push(`${ind}\t\t<groupindex>1</groupindex>`);
      lines.push(`${ind}\t</link>`);
    }
    if (c.label) lines.push(`${ind}\t<labels>`, `${ind}\t\t<label2>${c.label}</label2>`, `${ind}\t</labels>`);
    lines.push(`${ind}</clipitem>`);
    return lines.join('\n');
  };

  /** A graphic carried from an adopted sequence: its own clipitem, re-timed, with a unique file id and no stale links. */
  const rawItem = (c: TLClip, it: Item, ind: string): string => {
    const { root } = parseXml(c.raw!.item!);
    root.attrs = root.attrs.map(([k, v]) => [k, k === 'id' ? it.xmlId : v] as [string, string]);
    const len = it.e.end - it.e.start;
    const inF = Number(txt(el(root, 'in')) || 0);
    setText(root, 'start', it.e.start);
    setText(root, 'end', it.e.end);
    setText(root, 'out', inF + len);
    const pin = txt(el(root, 'pproTicksIn'));
    if (pin) setText(root, 'pproTicksOut', Number(pin) + len * tpf);
    if (c.disabled) setText(root, 'enabled', 'FALSE');
    root.kids = root.kids.filter((k) => typeof k === 'string' || k.tag !== 'link');
    // Everything inside (a graphic's file, a nested sequence with its own clips and files) gets ids of its own so
    // nothing collides with the ids this writer hands out (file-N, masterclip-N, clipitem-N, sequence-N).
    const pre = `g${it.xmlId.replace(/\D/g, '')}-`;
    const walk = (e: XEl) => {
      for (const k of e.kids) {
        if (typeof k === 'string' || k.tag === '#comment') continue;
        if (['file', 'sequence', 'clipitem', 'generatoritem'].includes(k.tag)) k.attrs = k.attrs.map(([a, v]) => [a, a === 'id' ? pre + v : v] as [string, string]);
        if (k.tag === 'masterclipid' || k.tag === 'linkclipref') k.kids = [pre + txt(k)];
        walk(k);
      }
    };
    walk(root);
    return ind + serialize(root);
  };

  const trackXml = (kind: 'video' | 'audio', n: number, ind: string): string => {
    const tr = byTrack(kind, n);
    const out: string[] = [];
    // Audio tracks come in exploded stereo pairs, marked as Premiere marks them; without the exploded-track
    // attributes Premiere drops the clips (spike).
    out.push(kind === 'audio'
      ? `${ind}<track TL.SQTrackAudioKeyframeStyle="0" PannerCurrentValue="0.5" PannerIsInverted="true" PannerName="Balance" currentExplodedTrackIndex="${(n - 1) % 2}" totalExplodedTrackCount="2" premiereTrackType="Stereo">`
      : `${ind}<track>`);
    for (let k = 0; k < tr.length; k++) {
      const it = tr[k], prev = tr[k - 1], next = tr[k + 1];
      const want = it.clip.transitionIn;
      const isAudioTr = want?.kind === 'audio-crossfade';
      // A transition applies on video items for video kinds and on audio items for the audio crossfade; video
      // dissolves also crossfade the linked dialogue (Premiere's default "both" behaviour is not in XML).
      const trHere = want && prev && prev.e.end === it.e.start && ((kind === 'video' && !isAudioTr) || (kind === 'audio' && (isAudioTr || want.kind === 'dissolve')));
      const half = trHere ? Math.floor(want!.frames / 2) : 0;
      const nextTr = next?.clip.transitionIn;
      const nextHere = nextTr && next.e.start === it.e.end && ((kind === 'video' && nextTr.kind !== 'audio-crossfade') || (kind === 'audio' && (nextTr.kind === 'audio-crossfade' || nextTr.kind === 'dissolve')));
      const nextHalf = nextHere ? nextTr!.frames - Math.floor(nextTr!.frames / 2) : 0;
      const transitionItem = (k: keyof typeof TRANSITION, start: number, frames: number, align: string, cutFrames: number) => {
        const tdef = TRANSITION[k];
        out.push(`${ind}\t<transitionitem>`, `${ind}\t\t<start>${start}</start>`, `${ind}\t\t<end>${start + frames}</end>`, `${ind}\t\t<alignment>${align}</alignment>`, `${ind}\t\t<cutPointTicks>${cutFrames * tpf}</cutPointTicks>`, rateXml(t.rate, ind + '\t\t'),
          `${ind}\t\t<effect>`, `${ind}\t\t\t<name>${tdef.name}</name>`, `${ind}\t\t\t<effectid>${tdef.id}</effectid>`, `${ind}\t\t\t<effectcategory>${tdef.cat}</effectcategory>`, `${ind}\t\t\t<effecttype>transition</effecttype>`, `${ind}\t\t\t<mediatype>${tdef.media}</mediatype>`, `${ind}\t\t</effect>`, `${ind}\t</transitionitem>`);
      };
      if (trHere) transitionItem(kind === 'audio' ? 'audio-crossfade' : want!.kind, it.e.start - half, want!.frames, 'center', half);
      // Fades at the clip's own head/tail (Premiere: start-black / end-black, the clip edge -1, in/out unchanged).
      const fadeOk = (f?: TLClip['fadeIn']) => !!f && ((kind === 'video') === (f.kind !== 'audio-crossfade') || (kind === 'audio' && f.kind === 'dissolve'));
      const fin = !trHere && fadeOk(it.clip.fadeIn) ? it.clip.fadeIn! : undefined;
      const fout = !nextHere && fadeOk(it.clip.fadeOut) ? it.clip.fadeOut! : undefined;
      if (fin) transitionItem(kind === 'audio' ? 'audio-crossfade' : fin.kind, it.e.start, Math.min(fin.frames, it.e.end - it.e.start), 'start-black', 0);
      out.push(clipItem(it, ind + '\t', trHere ? half : undefined, nextHere ? nextHalf : undefined, !!fin, !!fout));
      if (fout) { const f = Math.min(fout.frames, it.e.end - it.e.start); transitionItem(kind === 'audio' ? 'audio-crossfade' : fout.kind, it.e.end - f, f, 'end-black', f); }
    }
    out.push(`${ind}\t<enabled>TRUE</enabled>`, `${ind}\t<locked>FALSE</locked>`);
    if (kind === 'audio') out.push(`${ind}\t<outputchannelindex>${((n - 1) % 2) + 1}</outputchannelindex>`);
    out.push(`${ind}</track>`);
    return out.join('\n');
  };

  const dur = timelineEnd(t);
  const sr = t.sampleRate ?? 48000;
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>', '<!DOCTYPE xmeml>', '<xmeml version="4">',
    `\t<sequence id="sequence-1" explodedTracks="true">`,
    `\t\t<name>${esc(t.name)}</name>`, `\t\t<duration>${dur}</duration>`, rateXml(t.rate, '\t\t'),
    `\t\t<timecode>`, rateXml(t.rate, '\t\t\t'), `\t\t\t<string>${framesToTimecode(0, t.rate)}</string>`, `\t\t\t<frame>0</frame>`, `\t\t\t<displayformat>${framesToTimecode(0, t.rate).includes(';') ? 'DF' : 'NDF'}</displayformat>`, `\t\t</timecode>`,
    `\t\t<media>`, `\t\t\t<video>`, `\t\t\t\t<format>`, `\t\t\t\t\t<samplecharacteristics>`, rateXml(t.rate, '\t\t\t\t\t\t'),
    `\t\t\t\t\t\t<width>${t.width}</width>`, `\t\t\t\t\t\t<height>${t.height}</height>`, `\t\t\t\t\t\t<anamorphic>FALSE</anamorphic>`, `\t\t\t\t\t\t<pixelaspectratio>square</pixelaspectratio>`, `\t\t\t\t\t\t<fielddominance>none</fielddominance>`, `\t\t\t\t\t\t<colordepth>24</colordepth>`,
    `\t\t\t\t\t</samplecharacteristics>`, `\t\t\t\t</format>`,
  ];
  for (let n = 1; n <= vTracks; n++) lines.push(trackXml('video', n, '\t\t\t\t'));
  lines.push(`\t\t\t</video>`, `\t\t\t<audio>`, `\t\t\t\t<numOutputChannels>2</numOutputChannels>`, `\t\t\t\t<format>`, `\t\t\t\t\t<samplecharacteristics>`, `\t\t\t\t\t\t<depth>16</depth>`, `\t\t\t\t\t\t<samplerate>${sr}</samplerate>`, `\t\t\t\t\t</samplecharacteristics>`, `\t\t\t\t</format>`,
    `\t\t\t\t<outputs>`, ...[1, 2].map((g) => `\t\t\t\t\t<group>\n\t\t\t\t\t\t<index>${g}</index>\n\t\t\t\t\t\t<numchannels>1</numchannels>\n\t\t\t\t\t\t<downmix>0</downmix>\n\t\t\t\t\t\t<channel>\n\t\t\t\t\t\t\t<index>${g}</index>\n\t\t\t\t\t\t</channel>\n\t\t\t\t\t</group>`), `\t\t\t\t</outputs>`);
  for (let n = 1; n <= aTracks; n++) lines.push(trackXml('audio', n, '\t\t\t\t'));
  lines.push(`\t\t\t</audio>`, `\t\t</media>`);
  for (const mk of t.markers) {
    lines.push(`\t\t<marker>`, `\t\t\t<comment>${esc(mk.comment ?? '')}</comment>`, `\t\t\t<name>${esc(mk.name)}</name>`, `\t\t\t<in>${mk.frame}</in>`, `\t\t\t<out>${mk.duration ? mk.frame + mk.duration : -1}</out>`, `\t\t</marker>`);
  }
  lines.push(`\t</sequence>`, '</xmeml>', '');
  return { xml: lines.join('\n'), videoTracks: vTracks, audioTracks: aTracks, durationFrames: dur, warnings };
}

const round6 = (x: number) => Math.round(x * 1e6) / 1e6;
