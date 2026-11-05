// Background library worker: drains the index queue, one file at a time, then exits. Started by startWorker();
// a lock file holds its pid so only one runs.
import fs from 'node:fs';
import { runQueue, WORKER_LOCK } from './index.ts';

fs.writeFileSync(WORKER_LOCK, String(process.pid));
const log = (s: string) => console.log(`${new Date().toISOString()} ${s}`);
try {
  const n = await runQueue(log);
  log(`queue empty after ${n} file(s)`);
} finally {
  try { if (fs.readFileSync(WORKER_LOCK, 'utf8') === String(process.pid)) fs.rmSync(WORKER_LOCK); } catch { /* gone */ }
}
