// Where asset data lives and how ae-compose identifies itself to the APIs. Keys come from environment variables or
// ~/.ae-compose/keys.json and never reach the repo, scene files, logs or tool output (`redact`).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/** The download cache and response cache (AEC_ASSET_HOME overrides; tests point it at a temp folder). */
export const assetHome = () => process.env.AEC_ASSET_HOME || path.join(os.homedir(), '.ae-compose', 'assets');

/** Download cache cap in bytes (AEC_ASSET_CACHE_GB, default 5 GB). */
export const cacheCapBytes = () => Math.max(0.05, Number(process.env.AEC_ASSET_CACHE_GB) || 5) * 1e9;

let version: string | undefined;
export function aecVersion(): string {
  if (!version) { try { version = fs.readFileSync(path.join(ROOT, 'VERSION'), 'utf8').trim(); } catch { version = 'dev'; } }
  return version;
}

/** Every request carries this (Poly Haven requires a unique User-Agent). */
export const userAgent = () => `ae-compose/${aecVersion()} (motion design for After Effects)`;

const ENV: Record<string, string[]> = {
  pexels: ['AEC_PEXELS_KEY', 'PEXELS_API_KEY'],
  pixabay: ['AEC_PIXABAY_KEY', 'PIXABAY_API_KEY'],
  unsplash: ['AEC_UNSPLASH_KEY', 'UNSPLASH_ACCESS_KEY'],
  openverse: ['AEC_OPENVERSE_TOKEN', 'OPENVERSE_TOKEN'],
};

export const keysFile = () => process.env.AEC_KEYS_FILE || path.join(os.homedir(), '.ae-compose', 'keys.json');

/** A source's key: environment first, then keys.json (`{ "pixabay": "…" }`). Undefined when not set. */
export function apiKey(source: string): string | undefined {
  for (const v of ENV[source] ?? []) if (process.env[v]) return process.env[v];
  try {
    const j = JSON.parse(fs.readFileSync(keysFile(), 'utf8'));
    const k = j[source];
    return typeof k === 'string' && k.trim() ? k.trim() : undefined;
  } catch { return undefined; }
}

/** Replaces every configured key in a string (URLs in errors, cache metadata) with "***". */
export function redact(s: string): string {
  let out = s;
  for (const src of Object.keys(ENV)) {
    const k = apiKey(src);
    if (k && k.length >= 6) out = out.split(k).join('***');
  }
  // Belt and braces: query parameters that carry keys anywhere.
  return out.replace(/([?&](?:key|api_key|apikey|token|access_token)=)[^&\s"]+/gi, '$1***');
}

export const envKeyNames = (source: string) => ENV[source] ?? [];
