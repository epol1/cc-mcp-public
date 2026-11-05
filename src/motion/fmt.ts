// Text helpers shared by the motion summary and the style lint: times, ranges and layer names written the way the
// text lint (src/lint/index.ts) writes them.

/** "1.2s" */
export const fmtT = (t: number): string => `${(Math.round(t * 10) / 10).toFixed(1)}s`;
/** "at 1.2s" or "at 1.2–3.4s" */
export const fmtRange = (t: [number, number]): string => (t[1] - t[0] < 0.05 ? `at ${fmtT(t[0])}` : `at ${fmtT(t[0])}–${fmtT(t[1])}`);
/** "0.80–1.45 s" with two decimals, for the summary. */
export const fmtSpan = (t0: number, t1: number): string => `${t0.toFixed(2)}–${t1.toFixed(2)} s`;
/** Seconds as "2.4 s". */
export const fmtDur = (s: number): string => `${s.toFixed(1)} s`;
/** A quoted, shortened layer name. */
export const q = (s: string): string => `"${s.length > 40 ? s.slice(0, 37) + '…' : s}"`;
/** Up to `max` quoted names, then "and N more". */
export function names(list: string[], max = 3): string {
  const shown = list.slice(0, max).map(q).join(', ');
  return list.length > max ? `${shown} and ${list.length - max} more` : shown;
}
/** Round a speed for display: 1900, 85, 4.2. */
export const fmtSpeed = (v: number): string => (v >= 100 ? String(Math.round(v / 10) * 10) : v >= 10 ? String(Math.round(v)) : v.toFixed(1));
