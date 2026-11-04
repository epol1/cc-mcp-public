// ES3-safe helpers (no prototype polyfills: AE panels share one engine). Use these instead of
// [].map/filter/forEach/indexOf, Object.keys, String.trim, JSON.

export function each<T>(a: ArrayLike<T>, f: (x: T, i: number) => void): void {
  for (let i = 0; i < a.length; i++) f(a[i], i);
}

export function map<T, U>(a: ArrayLike<T>, f: (x: T, i: number) => U): U[] {
  const r: U[] = [];
  for (let i = 0; i < a.length; i++) r[r.length] = f(a[i], i);
  return r;
}

export function filter<T>(a: ArrayLike<T>, f: (x: T, i: number) => boolean): T[] {
  const r: T[] = [];
  for (let i = 0; i < a.length; i++) if (f(a[i], i)) r[r.length] = a[i];
  return r;
}

export function indexOf<T>(a: ArrayLike<T>, x: T): number {
  for (let i = 0; i < a.length; i++) if (a[i] === x) return i;
  return -1;
}

export function has(o: any, k: string): boolean {
  return Object.prototype.hasOwnProperty.call(o, k);
}

export function keys(o: any): string[] {
  const r: string[] = [];
  for (const k in o) if (has(o, k)) r[r.length] = k;
  return r;
}

export function isArray(a: any): boolean {
  return Object.prototype.toString.call(a) === '[object Array]';
}

export function trim(s: string): string {
  return String(s).replace(/^\s+|\s+$/g, '');
}

export function now(): number {
  return new Date().getTime();
}

/** Shallow copy of an array-like into a real array (AE returns arrays that are fine, but be explicit). */
export function toArray<T>(a: ArrayLike<T>): T[] {
  const r: T[] = [];
  for (let i = 0; i < a.length; i++) r[r.length] = a[i];
  return r;
}

export function startsWith(s: string, p: string): boolean {
  return s.substring(0, p.length) === p;
}

export function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}
