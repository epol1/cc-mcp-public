// AE-made Motion Graphics templates through edits. Premiere's XML carries a clip of an After Effects .mogrt only as a
// plain clip of its .aegraphic (no Graphic Parameters: the fields are gone and it renders the template's defaults),
// while its own Essential Graphics titles travel intact. So an edit reads the AE templates of the source sequence
// (track, times, project item, field values), leaves them out of the XML, and places them again on the new version
// from the template's own project item (overwriteClip gives a live instance) with their values (D124).
import { lit, runEs } from './bridge.ts';

export interface AeTemplateClip {
  /** 1-based video track. */
  track: number;
  start: number;
  end: number;
  inPoint: number;
  nodeId: string;
  name: string;
  /** Field values as Premiere returns them (text documents as JSON strings, colors as packed numbers). */
  values: Record<string, string | number | boolean>;
}

const TICKS = 254016000000;

export async function readAeTemplates(seqId: string): Promise<AeTemplateClip[]> {
  const r = await runEs<any[]>(`var s = prcSeq(${lit(seqId)}), out = [];
for (var t = 0; t < s.videoTracks.numTracks; t++) for (var i = 0; i < s.videoTracks[t].clips.numItems; i++) {
  var c = s.videoTracks[t].clips[i];
  if (!c.isMGT()) continue;
  var pi = c.projectItem, p = pi ? String(pi.getMediaPath()) : '';
  if (!/\\.aegraphic$/i.test(p)) continue;
  var mg = c.getMGTComponent(), vals = {};
  if (mg) for (var k = 0; k < mg.properties.numItems; k++) { var v = mg.properties[k].getValue(); vals[mg.properties[k].displayName] = typeof v === 'number' || typeof v === 'boolean' ? v : String(v); }
  out.push({ track: t + 1, start: c.start.ticks, end: c.end.ticks, inPoint: c.inPoint.ticks, nodeId: pi.nodeId, name: c.name, values: vals });
}
prcJson(out)`);
  return r.map((x) => ({ ...x, start: Number(x.start), end: Number(x.end), inPoint: Number(x.inPoint) }));
}

/** Places templates again from their project items with their values; one undo step each. */
export async function placeAeTemplates(seqId: string, jobs: AeTemplateClip[], tpf: number): Promise<{ steps: number; missing: string[] }> {
  if (!jobs.length) return { steps: 0, missing: [] };
  const r = await runEs<{ missing: string[] }>(`
function prcNode(item, id) { if (item.nodeId === id) return item; if (item.children) for (var i = 0; i < item.children.numItems; i++) { var f = prcNode(item.children[i], id); if (f) return f; } return null; }
var s = prcSeq(${lit(seqId)}); app.project.openSequence(s.sequenceID);
var jobs = ${JSON.stringify(jobs.map((j) => ({ ...j, start: String(j.start), end: String(j.end), inPoint: String(j.inPoint), sec: j.start / TICKS })))}, missing = [];
for (var i = 0; i < jobs.length; i++) {
  var j = jobs[i], tr = s.videoTracks[j.track - 1], pi = prcNode(app.project.rootItem, j.nodeId);
  if (!tr || !pi) { missing.push(j.name + ': ' + (tr ? 'its template is no longer in the project' : 'no track V' + j.track)); continue; }
  tr.overwriteClip(pi, j.sec);
  var ti = null;
  for (var k = 0; k < tr.clips.numItems; k++) if (Math.abs(Number(tr.clips[k].start.ticks) - Number(j.start)) <= ${Math.round(tpf / 2)}) ti = tr.clips[k];
  if (!ti) { missing.push(j.name + ': not placed'); continue; }
  if (Number(j.inPoint) > 0) { try { var ip = new Time(); ip.ticks = j.inPoint; ti.inPoint = ip; } catch (e) { missing.push(j.name + ': in point not kept'); } }
  var e = new Time(); e.ticks = j.end; try { ti.end = e; } catch (err) {}
  var mg = ti.getMGTComponent();
  for (var f in j.values) if (j.values.hasOwnProperty(f)) { var p = mg ? mg.properties.getParamForDisplayName(f) : null; if (p) p.setValue(j.values[f], true); else missing.push(j.name + ': no field "' + f + '"'); }
}
prcJson({ missing: missing })`, { timeoutMs: 60_000 + jobs.length * 10_000 });
  return { steps: jobs.length, missing: r.missing };
}
