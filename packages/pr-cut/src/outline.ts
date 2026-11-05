// inspect_sequence: a readable outline of any sequence (pr-cut's or hand cut): tracks, clips with sequence and
// source times, the words spoken inside each clip (from cached transcripts), effects, transitions and markers.
// Clips get path ids ("V1/3") and, for sequences pr-cut built, their segment ids ("seg2.1").
import fs from 'node:fs';
import path from 'node:path';
import { clock, framesToTimecode, fromTicksPerFrame, ticksToSeconds } from '@ae-mcp/core/time/timecode.ts';
import { cachedTranscript } from '@ae-mcp/core/transcribe/index.ts';
import type { Transcript } from '@ae-mcp/core/transcribe/types.ts';
import { CUTS_DIR } from './build.ts';
import { inspectSequenceRaw, type PrClip, type PrSequence } from './inspect.ts';

export interface OutlineClip extends PrClip { id: string; segment?: string; words?: string; wordRange?: [number, number] }

export async function outlineSequence(seqId?: string, opts: { words?: boolean; maxWords?: number } = {}): Promise<{ seq: PrSequence; clips: OutlineClip[]; text: string }> {
  const seq = await inspectSequenceRaw(seqId);
  const r = fromTicksPerFrame(seq.timebase);
  const tc = (ticks: number) => framesToTimecode(Math.round(ticks / seq.timebase), r);
  let sidecar: any = null;
  try { sidecar = JSON.parse(fs.readFileSync(path.join(CUTS_DIR, `${seq.id}.json`), 'utf8')); } catch { /* hand cut */ }
  const transcripts = new Map<string, Transcript | null>();
  const tr = (p?: string) => {
    if (!p || !fs.existsSync(p)) return null;
    if (!transcripts.has(p)) transcripts.set(p, cachedTranscript(p));
    return transcripts.get(p)!;
  };
  const clips: OutlineClip[] = seq.clips.map((c) => {
    const o: OutlineClip = { ...c, id: `${c.track}/${c.index + 1}` };
    if (sidecar && c.track === 'V1') {
      const f = Math.round(c.start / seq.timebase);
      const p = (sidecar.pieces as any[]).find((x) => x.start === f);
      if (p) o.segment = p.id;
    }
    if (opts.words !== false && (c.track === 'V1' || c.track === 'A1')) {
      const t = tr(c.media);
      if (t) {
        const a = ticksToSeconds(c.inTicks), b = ticksToSeconds(c.outTicks);
        const ws = t.words.filter((w) => w.start >= a - 0.05 && w.end <= b + 0.05);
        if (ws.length) {
          const max = opts.maxWords ?? 40;
          o.wordRange = [ws[0].i, ws[ws.length - 1].i];
          o.words = ws.length > max ? ws.slice(0, max / 2).map((w) => w.text).join(' ') + ' … ' + ws.slice(-max / 2).map((w) => w.text).join(' ') : ws.map((w) => w.text).join(' ');
        }
      }
    }
    return o;
  });
  const lines: string[] = [];
  lines.push(`${seq.name} (${seq.id}) ${seq.width}x${seq.height} @ ${(r.num / r.den).toFixed(3)} fps, ${tc(seq.end)} long, ${seq.videoTracks} video / ${seq.audioTracks} audio tracks${sidecar ? ', built by pr-cut' : ''}`);
  for (const c of clips) {
    if (c.track.startsWith('A') && c.track !== 'A1' && clips.some((v) => v.track === 'V1' && v.start === c.start && v.media === c.media)) continue; // linked stereo partner
    const fx: string[] = [];
    if (c.scale && Math.abs(c.scale - 100) > 0.01) fx.push(`scale ${c.scale}`);
    if (c.lumetri && Object.values(c.lumetri).some((v) => v && v !== 100)) fx.push(`grade ${Object.entries(c.lumetri).filter(([k, v]) => v && !(k === 'saturation' && v === 100)).map(([k, v]) => `${k} ${Math.round(v * 100) / 100}`).join(', ')}`);
    if (c.volumeDb !== undefined && Math.abs(c.volumeDb) > 0.05) fx.push(`${c.volumeDb} dB`);
    if (c.mgt) fx.push('graphic');
    if (c.disabled) fx.push('disabled');
    const src = c.media ? `${path.basename(c.media)} [${clock(ticksToSeconds(c.inTicks))}–${clock(ticksToSeconds(c.outTicks))}]` : c.name;
    lines.push(`${c.id}${c.segment ? ` (${c.segment})` : ''} ${tc(c.start)}–${tc(c.end)} ${src}${fx.length ? ` {${fx.join('; ')}}` : ''}${c.words ? `${c.wordRange ? ` w${c.wordRange[0]}–${c.wordRange[1]}` : ''}: "${c.words}"` : ''}`);
    if (c.mgtFields) lines.push(`   fields: ${Object.entries(c.mgtFields).map(([k, v]) => `${k}=${JSON.stringify(v)}`.slice(0, 80)).join(', ')}`);
  }
  for (const t of seq.transitions) lines.push(`transition ${t.track} ${tc(t.start)}–${tc(t.end)} ${t.name}`);
  for (const m of seq.markers) lines.push(`marker ${tc(m.start)} ${m.name}${m.comment ? `: ${m.comment}` : ''}`);
  const noTr = [...new Set(clips.filter((c) => c.track === 'V1' && c.media && !tr(c.media)).map((c) => path.basename(c.media!)))];
  if (noTr.length) lines.push(`(no transcript yet for ${noTr.join(', ')}: run transcribe to see the words)`);
  return { seq, clips, text: lines.join('\n') };
}
