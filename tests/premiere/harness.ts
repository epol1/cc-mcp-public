// Premiere integration harness: PASS/FAIL lines, a throwaway test project (never the user's), test media.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { lit, nativePath, runEs } from '@ae-mcp/pr-cut/bridge.ts';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const SAMPLE = 'C:/Users/Public/Documents/Adobe/Premiere Pro/26.0/Sample Media';
export const TEST_DIR = path.join(ROOT, 'scratch', 'pr', 'tests');
let fails = 0;

export function check(name: string, ok: boolean, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`);
  if (!ok) fails++;
}
export function done() {
  console.log(fails ? `${fails} check(s) FAILED` : 'all checks passed');
  process.exitCode = fails ? 1 : 0;
}

/** Make the throwaway test project the active one (created on first use). */
export async function useTestProject(): Promise<string> {
  fs.mkdirSync(TEST_DIR, { recursive: true });
  const proj = path.join(TEST_DIR, 'pr-cut-tests.prproj');
  const r = await runEs<{ path: string }>(`
var want = ${lit(nativePath(proj))}, found = false;
for (var i = 0; i < app.projects.numProjects; i++) { if (app.projects[i].path === want) { found = true; } }
if (found) app.openDocument(want, true, true, true, true); else if (new File(want).exists) app.openDocument(want, true, true, true, true); else app.newProject(want);
prcJson({ path: app.project.path });
`, { timeoutMs: 120_000 });
  if (path.resolve(r.path) !== path.resolve(proj)) throw new Error(`test project not active (${r.path})`);
  return proj;
}

/** A spoken test interview (Windows TTS over a test pattern with burned-in source time), made once. */
export function testInterview(): string {
  const f = path.join(TEST_DIR, 'interview_tts.mp4');
  if (fs.existsSync(f)) return f;
  const speech = path.join(TEST_DIR, 'tts1');
  execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(ROOT, 'tests', 'premiere', 'tts-fixture.ps1'), '-Out', speech]);
  execFileSync('ffmpeg', ['-nostdin', '-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=1920x1080:rate=24000/1001', '-i', `${speech}.wav`,
    '-filter_complex', "[0:v]drawtext=text='SRC %{pts\\:hms}':x=60:y=60:fontsize=72:fontcolor=white:box=1:boxcolor=black@0.6[v]",
    '-map', '[v]', '-map', '1:a', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-ar', '48000', '-ac', '2', '-shortest', f]);
  return f;
}

/** Sequence count of the test project (by path, whatever project is in focus). */
export async function testProjectSequences(): Promise<number> {
  const proj = path.join(TEST_DIR, 'pr-cut-tests.prproj');
  return runEs<number>(`var n = -1; for (var i = 0; i < app.projects.numProjects; i++) if (app.projects[i].path === ${lit(nativePath(proj))}) n = app.projects[i].sequences.numSequences; n`);
}
