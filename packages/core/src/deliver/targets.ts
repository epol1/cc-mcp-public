// Delivery targets shared by ae-compose (reframe as sibling comps) and pr-cut (social versions of a sequence):
// frame sizes per aspect, how much type scales, and which platform UI zones to keep clear.

/**
 * Responsive reframe (A4): build at another frame size. In AE layout containers re-solve and static positions map
 * from the old frame to the new one; in Premiere clips are re-framed by Motion scale/position. Type scales by
 * `typeScale`; with `platform`, title-safe areas become the vertical platform's UI-free zone.
 */
export interface Reframe { width: number; height: number; label?: string; typeScale?: number; platform?: 'reels' | 'none' }

/** Reframe presets: 9:16 vertical social (platform zones), 1:1, 4:5 feed, 16:9. */
export const REFRAMES: Record<string, Reframe> = {
  '9:16': { width: 1080, height: 1920, label: '9x16', typeScale: 0.8, platform: 'reels' },
  '1:1': { width: 1080, height: 1080, label: '1x1', typeScale: 0.85 },
  '4:5': { width: 1080, height: 1350, label: '4x5', typeScale: 0.85 },
  '16:9': { width: 1920, height: 1080, label: '16x9', typeScale: 1 },
};

/**
 * The vertical platforms' UI-free zone for 9:16 (Reels/TikTok/Shorts): fractions of the frame kept clear of
 * captions and titles (top bar, bottom caption/CTA area, right-hand action rail).
 */
export const REELS_ZONE = { top: 0.14, bottom: 0.2, left: 0.06, right: 0.16 } as const;

export function reframeOf(f: string | Reframe): Reframe {
  if (typeof f !== 'string') return f;
  const r = REFRAMES[f];
  if (!r) throw new Error(`reframe "${f}": use ${Object.keys(REFRAMES).join(', ')} or { width, height }`);
  return r;
}
