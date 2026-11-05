// Radix-2 FFT for the beat analyzer: a reusable power spectrum of real frames (no dependencies).
// A real frame of n samples is packed into an n/2-point complex FFT and unpacked, which halves the work.

/** Writes |X[k]|² for k = 0..n/2 of the real frame `x` (length n) into `out` (length n/2 + 1). */
export type PowerSpectrum = (x: Float64Array, out: Float64Array) => void;

export const isPowerOfTwo = (n: number): boolean => n >= 2 && (n & (n - 1)) === 0;

function bitReversal(m: number): Uint32Array {
  const bits = Math.round(Math.log2(m));
  const rev = new Uint32Array(m);
  for (let i = 0; i < m; i++) {
    let r = 0;
    for (let b = 0, v = i; b < bits; b++, v >>= 1) r = (r << 1) | (v & 1);
    rev[i] = r;
  }
  return rev;
}

/** In-place iterative complex FFT (forward, unnormalized) on inputs already in bit-reversed order. */
function butterflies(re: Float64Array, im: Float64Array, cos: Float64Array, sin: Float64Array): void {
  const m = re.length;
  for (let size = 2; size <= m; size <<= 1) {
    const half = size >> 1, step = m / size;
    for (let start = 0; start < m; start += size) {
      for (let k = 0, w = 0; k < half; k++, w += step) {
        const a = start + k, b = a + half;
        const tr = cos[w], ti = sin[w];
        const xr = re[b] * tr - im[b] * ti, xi = re[b] * ti + im[b] * tr;
        re[b] = re[a] - xr; im[b] = im[a] - xi;
        re[a] += xr; im[a] += xi;
      }
    }
  }
}

/** Power spectrum function for real frames of length n (a power of two ≥ 4). Not reentrant: one per caller. */
export function realPowerSpectrum(n: number): PowerSpectrum {
  if (!isPowerOfTwo(n) || n < 4) throw new Error(`FFT size must be a power of two >= 4, got ${n}`);
  const m = n >> 1;
  const rev = bitReversal(m);
  const cos = new Float64Array(m >> 1), sin = new Float64Array(m >> 1);
  for (let k = 0; k < m >> 1; k++) { cos[k] = Math.cos((2 * Math.PI * k) / m); sin[k] = -Math.sin((2 * Math.PI * k) / m); }
  const wc = new Float64Array(m + 1), ws = new Float64Array(m + 1);
  for (let k = 0; k <= m; k++) { wc[k] = Math.cos((2 * Math.PI * k) / n); ws[k] = -Math.sin((2 * Math.PI * k) / n); }
  const re = new Float64Array(m), im = new Float64Array(m);
  return (x, out) => {
    for (let i = 0; i < m; i++) { const j = rev[i]; re[j] = x[2 * i]; im[j] = x[2 * i + 1]; }
    butterflies(re, im, cos, sin);
    for (let k = 0; k <= m; k++) {
      const a = k === m ? 0 : k, b = k === 0 ? 0 : m - k;
      const zr = re[a], zi = im[a], cr = re[b], ci = -im[b];
      const er = (zr + cr) / 2, ei = (zi + ci) / 2; // even samples' spectrum
      const or = (zi - ci) / 2, oi = -(zr - cr) / 2; // odd samples' spectrum
      const xr = er + or * wc[k] - oi * ws[k], xi = ei + or * ws[k] + oi * wc[k];
      out[k] = xr * xr + xi * xi;
    }
  };
}
