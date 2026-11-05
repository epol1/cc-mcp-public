// Screen-color detection for keying: the dominant strongly-green or strongly-blue color in a frame.
import sharp from 'sharp';

export interface ScreenSample { color: [number, number, number]; screen: 'green' | 'blue'; coverage: number }

/** Median color of the pixels where green (or blue) clearly dominates; coverage = share of the frame. */
export async function sampleScreenColor(png: string): Promise<ScreenSample | null> {
  const { data, info } = await sharp(png).removeAlpha().resize(320, 320, { fit: 'inside' }).toColourspace('srgb').raw({ depth: 'uchar' }).toBuffer({ resolveWithObject: true });
  const px = info.width * info.height, ch = info.channels;
  const g: number[][] = [], b: number[][] = [];
  for (let i = 0; i < px; i++) {
    const r = data[i * ch], gg = data[i * ch + 1], bb = data[i * ch + 2];
    if (gg - Math.max(r, bb) > 30 && gg > 60) g.push([r, gg, bb]);
    else if (bb - Math.max(r, gg) > 30 && bb > 60) b.push([r, gg, bb]);
  }
  const set = g.length >= b.length ? g : b;
  if (set.length < px * 0.03) return null;
  const med = (k: number) => { const v = set.map((p) => p[k]).sort((x, y) => x - y); return v[v.length >> 1] / 255; };
  return { color: [med(0), med(1), med(2)], screen: set === g ? 'green' : 'blue', coverage: set.length / px };
}
