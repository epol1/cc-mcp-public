// Blank-frame check on rendered frames: a frame with no visible detail (only a flat or smoothly graded
// background) in the middle of a comp usually means a gap in the timing. Detail = mean absolute difference
// between the frame and a blurred copy at 256×144 (0–255 scale). Calibrated on real frames: empty backgrounds,
// gradients and vignettes measure 0.00–0.07; a frame showing only one small dim word measures 0.78.
import sharp from 'sharp';
import { normalizeCapture } from '@cc-mcp/core/visual/images.ts';
import type { LintIssue } from './index.ts';

const BLANK_DETAIL = 0.35;

export async function frameDetail(file: string, bpc: number): Promise<number> {
  const base = sharp(await normalizeCapture(file, bpc)).flatten({ background: '#000' }).toColourspace('b-w').resize(256, 144, { fit: 'fill' });
  const [a, b] = await Promise.all([base.clone().raw().toBuffer(), base.clone().blur(4).raw().toBuffer()]);
  let s = 0;
  for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]);
  return s / a.length;
}

/**
 * Frames (sorted by time) that look empty, ignoring the first and last frame (fades from and to black are
 * normal). Consecutive blank frames are reported as one range.
 */
export async function blankFrames(frames: { t: number; file: string }[], bpc: number): Promise<LintIssue[]> {
  const fs = [...frames].sort((x, y) => x.t - y.t);
  if (fs.length < 3) return [];
  const blank: boolean[] = [];
  for (let i = 0; i < fs.length; i++) blank[i] = i > 0 && i < fs.length - 1 && (await frameDetail(fs[i].file, bpc).catch(() => Infinity)) < BLANK_DETAIL;
  const issues: LintIssue[] = [];
  for (let i = 0; i < fs.length; i++) {
    if (!blank[i]) continue;
    let j = i;
    while (j + 1 < fs.length && blank[j + 1]) j++;
    const t: [number, number] = [fs[i].t, fs[j].t];
    const when = i === j ? `at ${fs[i].t.toFixed(1)}s` : `from ${fs[i].t.toFixed(1)}s to ${fs[j].t.toFixed(1)}s`;
    issues.push({ rule: 'blank-frame', severity: 'warn', t, message: `the frame is almost empty ${when} (background only): if the pause is deliberate keep it short and purposeful, otherwise something that should be on screen is missing or hidden` });
    i = j;
  }
  return issues;
}
