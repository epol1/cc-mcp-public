// Reads a Premiere sequence completely (one ExtendScript call): settings, every clip with exact source/sequence
// ticks and media path, Motion/Lumetri/volume values, transitions and markers. Used by inspect_sequence, the
// round-trip tests, and edits (which read the sequence, change the plan, and import the next version).
import { runEs, lit } from './bridge.ts';

export interface PrClip {
  track: string; // "V1", "A2"
  index: number;
  name: string;
  nodeId: string;
  start: number; end: number; inTicks: number; outTicks: number; // ticks
  media?: string;
  mgt?: boolean;
  disabled?: boolean;
  speed?: number;
  scale?: number; position?: [number, number];
  opacity?: number;
  volumeDb?: number;
  lumetri?: Record<string, number>;
  mgtFields?: Record<string, unknown>;
}
export interface PrSequence {
  id: string; name: string; timebase: number; width: number; height: number; end: number;
  videoTracks: number; audioTracks: number;
  clips: PrClip[];
  transitions: { track: string; start: number; end: number; name: string }[];
  markers: { start: number; end: number; name: string; comment: string; guid: string }[];
}

const LUMETRI_INDEX: Record<string, number> = { temperature: 14, tint: 15, saturation: 16, exposure: 19, contrast: 20, highlights: 21, shadows: 22, whites: 23, blacks: 24 };

export function inspectScript(seqId?: string): string {
  return `
var seq = ${seqId ? `prcSeq(${lit(seqId)})` : 'app.project.activeSequence'};
if (!seq) throw new Error(${lit(`no sequence ${seqId ?? '(none active)'}`)});
var s = seq.getSettings();
var out = { id: seq.sequenceID, name: seq.name, timebase: Number(seq.timebase), width: s.videoFrameWidth, height: s.videoFrameHeight, end: Number(seq.end),
  videoTracks: seq.videoTracks.numTracks, audioTracks: seq.audioTracks.numTracks, clips: [], transitions: [], markers: [] };
var LUM = ${JSON.stringify(LUMETRI_INDEX)};
function readClip(c, tr, k) {
  var o = { track: tr, index: k, name: c.name, nodeId: c.nodeId, start: Number(c.start.ticks), end: Number(c.end.ticks), inTicks: Number(c.inPoint.ticks), outTicks: Number(c.outPoint.ticks) };
  try { var pi = c.projectItem; if (pi) o.media = pi.getMediaPath(); } catch (e) {}
  try { o.mgt = c.isMGT(); } catch (e) {}
  try { if (c.disabled) o.disabled = true; } catch (e) {}
  try { var sp = c.getSpeed(); if (sp !== 1) o.speed = sp; } catch (e) {}
  for (var i = 0; i < c.components.numItems; i++) {
    var comp = c.components[i], mn = comp.matchName, P = comp.properties;
    try {
      if (mn === 'AE.ADBE Motion') { o.scale = P[1].getValue(); var pos = P[0].getValue(); o.position = [pos[0], pos[1]]; }
      else if (mn === 'AE.ADBE Opacity') { o.opacity = P[0].getValue(); }
      else if (mn === 'AE.ADBE Lumetri') { o.lumetri = {}; for (var key in LUM) if (LUM.hasOwnProperty(key)) o.lumetri[key] = P[LUM[key]].getValue(); }
      else if (comp.displayName === 'Volume' && P.numItems > 1) { var v = P[1].getValue(); o.volumeDb = Math.round((20 * Math.log(v) / Math.LN10 + 15) * 100) / 100; }
    } catch (e) {}
  }
  if (o.mgt) { try { var mg = c.getMGTComponent(); if (mg) { o.mgtFields = {}; for (var q = 0; q < mg.properties.numItems; q++) { var pp = mg.properties[q]; var val; try { val = pp.getValue(); } catch (e2) { val = null; } if (typeof val === 'string' && val.length > 400) val = val.slice(0, 400); o.mgtFields[pp.displayName] = val; } } } catch (e) {} }
  return o;
}
for (var t = 0; t < seq.videoTracks.numTracks; t++) {
  var vt = seq.videoTracks[t];
  for (var k = 0; k < vt.clips.numItems; k++) out.clips.push(readClip(vt.clips[k], 'V' + (t + 1), k));
  for (var j = 0; j < vt.transitions.numItems; j++) { var tr = vt.transitions[j]; out.transitions.push({ track: 'V' + (t + 1), start: Number(tr.start.ticks), end: Number(tr.end.ticks), name: tr.name }); }
}
for (var a = 0; a < seq.audioTracks.numTracks; a++) {
  var at = seq.audioTracks[a];
  for (var k2 = 0; k2 < at.clips.numItems; k2++) out.clips.push(readClip(at.clips[k2], 'A' + (a + 1), k2));
  for (var j2 = 0; j2 < at.transitions.numItems; j2++) { var tr2 = at.transitions[j2]; out.transitions.push({ track: 'A' + (a + 1), start: Number(tr2.start.ticks), end: Number(tr2.end.ticks), name: tr2.name }); }
}
var m = seq.markers.getFirstMarker();
var guard = 0;
while (m && guard++ < 5000) { out.markers.push({ start: Number(m.start.ticks), end: Number(m.end.ticks), name: m.name, comment: m.comments, guid: m.guid }); m = seq.markers.getNextMarker(m); }
prcJson(out);
`;
}

export function inspectSequenceRaw(seqId?: string): Promise<PrSequence> {
  return runEs<PrSequence>(inspectScript(seqId));
}
