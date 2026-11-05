// The AdapterContext every adapter gets: cached polite GETs (http.ts) and key lookup (config.ts).
import { getJson, getText } from './http.ts';
import { apiKey } from './config.ts';
import type { AdapterContext } from './types.ts';

export function adapterContext(): AdapterContext {
  return {
    getJson: (url, opts) => getJson(url, { source: opts?.source ?? 'unknown', ttlMs: opts?.ttlMs, headers: opts?.headers }),
    getText: (url, opts) => getText(url, { source: opts?.source ?? 'unknown', ttlMs: opts?.ttlMs, headers: opts?.headers }),
    key: (source) => apiKey(source),
  };
}
