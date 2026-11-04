// Finds the installed After Effects (newest "Adobe After Effects <year>") and its tools.
import fs from 'node:fs';
import path from 'node:path';

export interface AeInstall { dir: string; exe: string; com: string; aerender: string; year: number }

let cached: AeInstall | null | undefined;

export function findAfterEffects(): AeInstall | null {
  if (cached !== undefined) return cached;
  const root = process.env.AEC_AE_DIR ? path.dirname(process.env.AEC_AE_DIR) : 'C:\\Program Files\\Adobe';
  let best: AeInstall | null = null;
  try {
    for (const name of fs.readdirSync(root)) {
      const m = /^Adobe After Effects (\d{4})$/.exec(name);
      if (!m) continue;
      const dir = path.join(root, name, 'Support Files');
      const exe = path.join(dir, 'AfterFX.exe');
      if (!fs.existsSync(exe)) continue;
      const cand = { dir, exe, com: path.join(dir, 'AfterFX.com'), aerender: path.join(dir, 'aerender.exe'), year: +m[1] };
      if (!best || cand.year > best.year) best = cand;
    }
  } catch { /* not Windows / no Adobe dir */ }
  cached = best;
  return best;
}
