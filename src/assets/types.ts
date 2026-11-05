// Asset sources (Phase 6, docs/ASSETS.md §4): the normalized search hit every adapter returns, and the adapter
// interface. Local folders and the free APIs (Iconify, Poly Haven, ambientCG, Pexels, Pixabay, Openverse,
// Fontsource) are all adapters; a hosted library of our own would be one more.

export type AssetKind = 'icon' | 'photo' | 'video' | 'texture' | 'hdri' | 'model' | 'font' | 'audio';
export const ASSET_KINDS: AssetKind[] = ['icon', 'photo', 'video', 'texture', 'hdri', 'model', 'font', 'audio'];

export interface AssetLicense {
  /** Normalized id: SPDX where one exists ("CC0-1.0", "MIT", "CC-BY-4.0", "OFL-1.1"), else "Pexels", "Pixabay", "PDM", "local". */
  id: string;
  url: string;
  commercial: boolean;
  /** The license asks for a credit (CREDITS.md gets one either way). */
  attribution: boolean;
  /** Adaptations must use the same license (CC BY-SA). Flagged in every result. */
  shareAlike?: boolean;
  /** A brand logo: the license covers the drawing, not the trademark. Flagged in every result. */
  trademark?: boolean;
}

export interface AssetFile {
  /** Path inside the asset's folder ("model.gltf", "textures/x_diff_1k.jpg"). */
  path: string;
  url: string;
  bytes?: number;
}

export interface AssetVariant {
  /** Short, stable label used to pick it: "1k-hdr", "2k-jpg", "1080p", "large", "700", "svg". */
  label: string;
  url: string;
  /** Expected format (extension without the dot): jpg, png, mp4, hdr, exr, gltf, zip, ttf, mp3, svg… */
  format: string;
  width?: number;
  height?: number;
  bytes?: number;
  /** Extra files downloaded with the main one into the same folder (a glTF's .bin and textures). */
  files?: AssetFile[];
}

export interface AssetHit {
  /** "<source>:<source id>", e.g. "pexels:12345", "iconify:lucide:rocket", "local:<hash>". */
  id: string;
  source: string;
  kind: AssetKind;
  title: string;
  tags: string[];
  /** Thumbnail URL or local path. */
  preview: string;
  width?: number;
  height?: number;
  /** Seconds (video, audio). */
  duration?: number;
  author?: string;
  authorUrl?: string;
  license: AssetLicense;
  /** The line written to CREDITS.md (without the file path, which fetch adds). */
  credit: string;
  /** The asset's own page. */
  page: string;
  /** Size variants, best default first. May be empty until `details()` fills them (Poly Haven, Fontsource). */
  variants: AssetVariant[];
  /** Source-specific notes worth showing (e.g. "Freesound preview, 128 kbps"). */
  notes?: string[];
}

export interface SearchQuery {
  query: string;
  kind?: AssetKind;
  orientation?: 'landscape' | 'portrait' | 'square';
  minWidth?: number;
  /** Seconds (video, audio). */
  minDuration?: number;
  /** 'cc0' = public domain only (no attribution); 'commercial' (default) = the whole allowlist. */
  license?: 'cc0' | 'commercial';
  limit?: number;
}

/** What an adapter is allowed to use: polite HTTP with a response cache, keys, and the cache folder. */
export interface AdapterContext {
  getJson<T = any>(url: string, opts?: { source: string; ttlMs?: number; headers?: Record<string, string> }): Promise<T>;
  getText(url: string, opts?: { source: string; ttlMs?: number; headers?: Record<string, string> }): Promise<string>;
  key(source: string): string | undefined;
}

export interface Adapter {
  /** Short id used in asset ids and `sources` filters. */
  id: string;
  /** Kinds this source can return. */
  kinds: AssetKind[];
  /** Needs an API key (from env or ~/.ae-compose/keys.json)? 'optional' = works anonymously with lower limits. */
  key?: 'required' | 'optional';
  /** One line: where to get a key, or why the source is off. */
  keyHelp?: string;
  /** Is the source usable right now? (e.g. local roots reachable). Undefined = yes when a required key is present. */
  available?(ctx: AdapterContext): Promise<{ ok: boolean; detail: string }>;
  search(q: SearchQuery, ctx: AdapterContext): Promise<AssetHit[]>;
  /** Full record for one id (the part after "<source>:"), with variants: used by fetch and `asset:` refs. */
  get(sourceId: string, ctx: AdapterContext): Promise<AssetHit>;
  /** Called once per fetch, before downloading (Unsplash requires pinging its download endpoint). */
  onFetch?(hit: AssetHit, variant: AssetVariant, ctx: AdapterContext): Promise<void>;
  /** Extra request headers for downloads (Pexels/Unsplash want the key on API calls only, not on CDN files). */
  downloadHeaders?(ctx: AdapterContext): Record<string, string>;
}
