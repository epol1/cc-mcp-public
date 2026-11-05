// Files shared with the designer panel (A6/p5-panel): the latest lint report per comp, which the panel lists with
// jump-to-time, and the "Ask Claude" inbox the panel appends to and the designer_inbox tool reads.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.join(os.homedir(), '.ae-compose');
export const LINT_DIR = path.join(ROOT, 'out', '_lint');
export const INBOX = path.join(ROOT, 'inbox.jsonl');

const safe = (s: string) => s.replace(/[^A-Za-z0-9_-]+/g, '_').slice(0, 80);

/** Saves a comp's latest lint issues (text lint + style lint) for the panel. Best-effort. */
export function saveLintForPanel(comp: string, issues: { rule: string; severity: string; message: string; layer?: string; t?: [number, number] }[]): void {
  try {
    fs.mkdirSync(LINT_DIR, { recursive: true });
    fs.writeFileSync(path.join(LINT_DIR, safe(comp) + '.json'), JSON.stringify({ comp, at: new Date().toISOString(), issues }, null, 1));
  } catch { /* the panel just shows nothing */ }
}

export interface InboxMessage { id: string; at: string; text: string; comp?: string; time?: number; layers?: string[]; read?: boolean }

/** Unread designer messages (marks them read). */
export function readInbox(markRead = true): InboxMessage[] {
  if (!fs.existsSync(INBOX)) return [];
  const all = fs.readFileSync(INBOX, 'utf8').split(/\r?\n/).filter(Boolean).map((l) => { try { return JSON.parse(l) as InboxMessage; } catch { return null; } }).filter(Boolean) as InboxMessage[];
  const unread = all.filter((m) => !m.read);
  if (markRead && unread.length) fs.writeFileSync(INBOX, all.map((m) => JSON.stringify({ ...m, read: true })).join('\n') + '\n');
  return unread;
}
