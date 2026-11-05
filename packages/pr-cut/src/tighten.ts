// tighten: fillers, repeats and long pauses out of a sequence's dialogue. The dry run lists every proposed cut
// (words and seconds) so the agent can show it before applying; applying is an apply_cut_edits batch.
import { TICKS_PER_SECOND } from '@ae-mcp/core/time/timecode.ts';
import { cachedTranscript } from '@ae-mcp/core/transcribe/index.ts';
import { adoptSequence } from './adopt.ts';
import type { BuildReport } from './build.ts';
import { applyCutEdits } from './edit.ts';
import { DEF, tightenSegment } from './plan/compile.ts';

export interface TightenOpts { fillers?: boolean; repeats?: boolean; maxPause?: number | string; keepPause?: number | string }

export async function tightenSequence(seqId: string, opts: TightenOpts, o: { dryRun: boolean }): Promise<{ summary: string; report?: BuildReport }> {
  if (!o.dryRun) {
    const r = await applyCutEdits(seqId, [{ op: 'tighten', target: '*', ...opts }]);
    return { summary: r.summary, report: r.report };
  }
  const { timeline: t, spine } = await adoptSequence(seqId);
  const fps = t.rate.num / t.rate.den;
  const lines: string[] = [];
  let saved = 0, missing = 0;
  for (const id of spine) {
    const c = t.clips.find((x) => x.id === id)!;
    const m = t.media[c.media];
    const tr = m.path ? cachedTranscript(m.path) : null;
    if (!tr) { missing++; continue; }
    const a0 = c.inTicks / TICKS_PER_SECOND, b0 = c.outTicks / TICKS_PER_SECOND;
    const ws = tr.words.filter((w) => w.start >= a0 - 0.03 && w.end <= b0 + 0.03);
    if (!ws.length) continue;
    const removed = { fillers: 0, repeats: 0, pauses: 0, pauseSeconds: 0 };
    const pcs = tightenSegment(id, { src: m.path }, c.media, tr, ws[0].i, ws[ws.length - 1].i, { ...DEF, ...(opts as any) }, false, fps, removed, []);
    for (const p of pcs) {
      if (!p.removedBefore) continue;
      const rb = p.removedBefore;
      const words = rb.words ? tr.words.slice(rb.words[0], rb.words[1] + 1).map((w) => w.text).join(' ') : '';
      lines.push(`${id} @ ${p.inS.toFixed(2)} s: cut ${rb.reason}${words ? ` "${words}"` : ''} (${rb.seconds} s)`);
    }
    const before = Math.round((b0 - a0) * fps), after = pcs.reduce((s, p) => s + Math.round((p.outS - p.inS) * fps), 0);
    saved += before - after;
  }
  return { summary: `${lines.length ? lines.join('\n') : 'nothing to tighten'}\n— saves ${(saved / fps).toFixed(2)} s${missing ? `; ${missing} clip(s) have no transcript yet (transcribe their media first)` : ''}. Apply with dryRun: false (new version, one undo step).` };
}
