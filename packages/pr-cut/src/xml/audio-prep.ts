// Sound Premiere can't decode: current Premiere has no Dolby (AC-3, E-AC-3, TrueHD) or DTS decoder, so a file whose
// only sound is in one of those comes in with no audio, and an XML clip that uses its sound takes the whole file
// offline ("Media Mismatch"; seen with an AVCHD camcorder's .MTS). Before the import, such a clip's sound is replaced
// by a WAV extracted from the file once (cached, the original untouched); the picture stays the original file, shifted
// by the difference of the two streams' start times so they stay in sync.
import { execFile } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { probe } from '@cc-mcp/core/media/probe.ts';
import { TICKS_PER_SECOND } from '@cc-mcp/core/time/timecode.ts';
import { PRC_HOME } from '../bridge.ts';
import type { Timeline } from '../timeline.ts';

const UNDECODABLE = /^(ac3|eac3|truehd|dts)$/i;
const DIR = path.join(PRC_HOME, 'audio');

const run = (cmd: string, args: string[]) => new Promise<string>((res, rej) => execFile(cmd, args, { windowsHide: true, maxBuffer: 64 << 20, timeout: 3_600_000 }, (e, so, se) => (e ? rej(new Error(`${cmd}: ${String(se).slice(-300)}`)) : res(String(so)))));

/** Rewrites the timeline in place; returns one note per file whose sound was extracted. */
export async function prepareAudio(t: Timeline): Promise<string[]> {
  const notes: string[] = [];
  const files = new Map<string, { wav: string; shiftTicks: number } | null>();
  // Per file: null when Premiere decodes its sound; else the extracted WAV's media key and the picture shift.
  const fileOf = async (key: string) => {
    if (files.has(key)) return files.get(key)!;
    const m = t.media[key];
    if (!m?.audio || !UNDECODABLE.test(m.audio.codec) || !m.path) { files.set(key, null); return null; }
    const st = fs.statSync(m.path);
    const wav = path.join(DIR, `${crypto.createHash('sha1').update(`${path.resolve(m.path)}|${st.size}|${Math.round(st.mtimeMs)}`).digest('hex').slice(0, 16)}_${path.basename(m.path).replace(/[^\w.-]+/g, '_')}.wav`);
    if (!fs.existsSync(wav)) {
      fs.mkdirSync(DIR, { recursive: true });
      await run('ffmpeg', ['-v', 'error', '-y', '-i', m.path, '-map', '0:a:0', '-vn', '-c:a', 'pcm_s24le', wav + '.part.wav']);
      fs.renameSync(wav + '.part.wav', wav);
    }
    // Transcripts and sync were measured on the decoded sound (time 0 = its first sample); Premiere's picture starts
    // at the first video frame.
    const streams = JSON.parse(await run('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type,start_time', '-of', 'json', m.path])).streams as { codec_type: string; start_time?: string }[];
    const vs = Number(streams.find((x) => x.codec_type === 'video')?.start_time ?? 0), as = Number(streams.find((x) => x.codec_type === 'audio')?.start_time ?? 0);
    const wkey = `${key}~wav`;
    t.media[wkey] = { ...(await probe(wav)), name: `${m.name} (sound)` };
    const r = { wav: wkey, shiftTicks: Math.round((as - vs) * TICKS_PER_SECOND) };
    files.set(key, r);
    notes.push(`${m.name}: its ${m.audio.codec.toUpperCase()} sound can't be decoded by Premiere; the cut uses a WAV extracted from it (${wav})`);
    return r;
  };
  for (const c of t.clips) {
    const a = c.aTrack ? await fileOf(c.media) : null;
    // Picture whose timing came from that file's sound: this clip's own (now from the WAV) or a multicam angle's.
    if (a && c.vTrack && !c.videoMedia) c.videoMedia = c.media;
    if (a) c.media = a.wav;
    if (c.vTrack && c.videoMedia && (a || c.videoShift !== undefined)) {
      const v = await fileOf(c.videoMedia);
      if (v) c.videoShift = (c.videoShift ?? 0) + v.shiftTicks;
    }
  }
  // Those files are picture only now, as Premiere sees them.
  for (const [k, r] of files) if (r && t.media[k]) t.media[k] = { ...t.media[k], audio: undefined };
  return notes;
}
