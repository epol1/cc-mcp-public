// Dialog watchdog: finds modal dialogs blocking After Effects or Premiere Pro, captures them as images, answers them.
// Both apps draw their own dialog controls, so the PNG capture is the reliable way for an agent to read one.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import type { DialogInfo } from './types.ts';

const PS1 = path.join(path.dirname(fileURLToPath(import.meta.url)), 'appwin.ps1');
export const DIALOG_DIR = path.join(os.homedir(), '.ae-compose', 'dialogs');

/** Which app the watchdog looks at: After Effects or Premiere Pro. */
export type HostApp = 'ae' | 'pr';

export interface AeWindowState {
  running: boolean;
  /** Windows reports the app's UI thread as not responding (busy script or render). */
  hung: boolean;
  main: { hwnd: number; title: string; enabled: boolean } | null;
  dialogs: DialogInfo[];
}

function ps(args: string[], timeoutMs = 20_000): Promise<string> {
  return new Promise((res, rej) => {
    execFile('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', PS1, ...args], { timeout: timeoutMs, windowsHide: true, maxBuffer: 8 << 20 }, (err, stdout) => {
      if (err && !stdout) rej(err); else res(String(stdout).trim());
    });
  });
}

export type AppWindowState = AeWindowState;

export function aeWindows(opts: { capture?: boolean } = {}): Promise<AeWindowState> {
  return appWindows('ae', opts);
}

export async function appWindows(app: HostApp, opts: { capture?: boolean } = {}): Promise<AppWindowState> {
  if (process.platform !== 'win32') return { running: false, hung: false, main: null, dialogs: [] };
  if (opts.capture) fs.mkdirSync(DIALOG_DIR, { recursive: true });
  const raw = await ps(['-Action', 'list', '-App', app, ...(opts.capture ? ['-OutDir', DIALOG_DIR] : [])]);
  const j = JSON.parse(raw || '{}');
  const dialogs = ([] as any[]).concat(j.dialogs || []).map((d) => ({ hwnd: d.hwnd, title: d.title || '', cls: d.cls, owned: !!d.owned, capture: d.capture, buttons: d.buttons || [], texts: d.texts || [] }));
  return { running: !!j.running, hung: !!j.hung, main: j.main || null, dialogs };
}

export async function pressDialog(hwnd: number, button: string, app: HostApp = 'ae'): Promise<{ pressed: boolean; via?: string; error?: string }> {
  const raw = await ps(['-Action', 'press', '-App', app, '-Hwnd', String(hwnd), '-Button', button]);
  return JSON.parse(raw || '{"pressed":false}');
}

/** Dialogs we answer automatically because there is only one sensible answer. Matched on UIA text when available. */
const AUTO_ANSWERS: { match: RegExp; button: string }[] = [
  { match: /Crash Repair Options/i, button: 'Continue' },
];

export async function autoAnswerKnown(state?: AeWindowState, app: HostApp = 'ae'): Promise<string[]> {
  const s = state ?? (await appWindows(app));
  const done: string[] = [];
  for (const d of s.dialogs) {
    const text = [d.title, ...(d.texts ?? [])].join(' ');
    const rule = AUTO_ANSWERS.find((r) => r.match.test(text));
    if (rule) { await pressDialog(d.hwnd, rule.button, app); done.push(`${rule.button} on "${text.slice(0, 60)}"`); }
  }
  return done;
}
