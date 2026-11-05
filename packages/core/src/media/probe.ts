// Technical facts about a media file from ffprobe: kind, duration, video size/rate/timecode, audio channels.
// Used by the media library, pr-cut's interchange writer (file elements need rate, duration and channels) and
// validation (offline media, mixed frame rates, VFR).
import { execFile } from 'node:child_process';
import path from 'node:path';
import { rate as parseRate, type Rate } from '../time/timecode.ts';

export interface MediaInfo {
  path: string;
  name: string;
  kind: 'video' | 'audio' | 'image';
  duration: number;
  bytes: number;
  container: string;
  video?: { width: number; height: number; rate: Rate; fps: number; frames: number; codec: string; pixFmt?: string; colorSpace?: string; vfr: boolean; rotation?: number; sar?: string };
  audio?: { channels: number; sampleRate: number; codec: string; layout?: string; streams: number };
  /** Start timecode from the container or video stream (camera originals). */
  timecode?: string;
  created?: string;
}

const IMAGE = /^(png|mjpeg|jpeg|bmp|tiff|webp|gif|exr|dpx)$/i;

export function probe(file: string): Promise<MediaInfo> {
  return new Promise((resolve, reject) => {
    execFile('ffprobe', ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', file], { windowsHide: true, maxBuffer: 16 << 20 }, (err, stdout, stderr) => {
      if (err) return reject(new Error(`ffprobe failed on ${file}: ${String(stderr || err.message).slice(-300)}`));
      try { resolve(fromFfprobe(file, JSON.parse(stdout))); } catch (e) { reject(e); }
    });
  });
}

export function fromFfprobe(file: string, j: any): MediaInfo {
  const streams: any[] = j.streams ?? [];
  const v = streams.find((s) => s.codec_type === 'video' && !(s.disposition?.attached_pic));
  const as = streams.filter((s) => s.codec_type === 'audio');
  const fmt = j.format ?? {};
  const duration = Number(fmt.duration ?? v?.duration ?? as[0]?.duration ?? 0);
  const isImage = !!v && (IMAGE.test(v.codec_name) && (!duration || duration < 0.05 || fmt.format_name === 'image2' || /_pipe$/.test(fmt.format_name)));
  const info: MediaInfo = {
    path: path.resolve(file), name: path.basename(file), kind: v ? (isImage ? 'image' : 'video') : 'audio',
    duration, bytes: Number(fmt.size ?? 0), container: fmt.format_name ?? '',
  };
  if (v) {
    const r = v.r_frame_rate && v.r_frame_rate !== '0/0' ? v.r_frame_rate : v.avg_frame_rate;
    const rr = parseRate(r && r !== '0/0' ? r : '25');
    const avg = v.avg_frame_rate && v.avg_frame_rate !== '0/0' ? parseRate(v.avg_frame_rate) : rr;
    const fps = rr.num / rr.den;
    const rotation = Number(v.tags?.rotate ?? v.side_data_list?.find((d: any) => d.rotation !== undefined)?.rotation ?? 0) || undefined;
    info.video = {
      width: v.width, height: v.height, rate: rr, fps, frames: Number(v.nb_frames) || Math.round(duration * fps), codec: v.codec_name,
      pixFmt: v.pix_fmt, colorSpace: v.color_space, vfr: Math.abs(avg.num / avg.den - fps) > 0.05, rotation, sar: v.sample_aspect_ratio,
    };
  }
  if (as.length) info.audio = { channels: as.reduce((n, s) => n + (s.channels ?? 0), 0), sampleRate: Number(as[0].sample_rate ?? 48000), codec: as[0].codec_name, layout: as[0].channel_layout, streams: as.length };
  info.timecode = v?.tags?.timecode ?? fmt.tags?.timecode ?? streams.find((s) => s.codec_tag_string === 'tmcd')?.tags?.timecode;
  info.created = fmt.tags?.creation_time;
  return info;
}
