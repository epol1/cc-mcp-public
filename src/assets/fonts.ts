// Fonts (ASSETS §6, D93, D102): read a font's names (incl. a variable font's named instances, which AE lists as
// separate PostScript names), install it per-user on Windows (no admin: %LOCALAPPDATA%\Microsoft\Windows\Fonts
// plus an HKCU value, loaded into the session with AddFontResource), and ask AE whether it sees it. A running AE
// 26.5 picks a font up once it is loaded into the session; no restart needed.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

export interface FontNames { family: string; subfamily: string; full: string; postScript: string; instances: string[] }

/** Names from the OpenType `name` table, plus `fvar` named instances (PostScript names AE will list). */
export function fontNames(buf: Buffer): FontNames {
  const numTables = buf.readUInt16BE(4);
  const tables: Record<string, number> = {};
  for (let i = 0; i < numTables; i++) { const r = 12 + 16 * i; tables[buf.toString('latin1', r, r + 4)] = buf.readUInt32BE(r + 8); }
  const nameOff = tables['name'];
  if (nameOff === undefined) throw new Error('not a TrueType/OpenType font (no name table)');
  const names: Record<number, string> = {};
  const count = buf.readUInt16BE(nameOff + 2), strings = nameOff + buf.readUInt16BE(nameOff + 4);
  for (let i = 0; i < count; i++) {
    const r = nameOff + 6 + 12 * i;
    const pid = buf.readUInt16BE(r), id = buf.readUInt16BE(r + 6), len = buf.readUInt16BE(r + 8), so = buf.readUInt16BE(r + 10);
    const raw = buf.subarray(strings + so, strings + so + len);
    const s = pid === 3 || pid === 0 ? Buffer.from(raw).swap16().toString('utf16le') : raw.toString('latin1');
    if (!(id in names) || pid === 3) names[id] = s;
  }
  const family = names[16] ?? names[1] ?? '', subfamily = names[17] ?? names[2] ?? '';
  const ps = names[6] ?? `${family}-${subfamily}`.replace(/\s+/g, '');
  const instances: string[] = [];
  const fv = tables['fvar'];
  if (fv !== undefined) {
    const axesOff = buf.readUInt16BE(fv + 4), axisCount = buf.readUInt16BE(fv + 8), axisSize = buf.readUInt16BE(fv + 10);
    const instCount = buf.readUInt16BE(fv + 12), instSize = buf.readUInt16BE(fv + 14);
    const psPrefix = names[25] ?? family.replace(/[^A-Za-z0-9]/g, '');
    let r = fv + axesOff + axisCount * axisSize;
    for (let i = 0; i < instCount; i++, r += instSize) {
      const sub = names[buf.readUInt16BE(r)] ?? '';
      const psId = instSize >= axisCount * 4 + 6 ? buf.readUInt16BE(r + 4 + axisCount * 4) : 0xffff;
      instances.push(psId !== 0xffff && names[psId] ? names[psId] : `${psPrefix}-${sub.replace(/[^A-Za-z0-9]/g, '')}`);
    }
  }
  return { family, subfamily, full: names[4] ?? `${family} ${subfamily}`, postScript: ps, instances };
}

export const userFontDir = () => path.join(process.env.LOCALAPPDATA ?? '', 'Microsoft', 'Windows', 'Fonts');
const REG = 'HKCU\\Software\\Microsoft\\Windows NT\\CurrentVersion\\Fonts';

/** Is a font with this file name already installed per-user or system-wide? */
export function installedFontFile(file: string): string | undefined {
  for (const d of [userFontDir(), path.join(process.env.WINDIR ?? 'C:\\Windows', 'Fonts')]) {
    const p = path.join(d, path.basename(file));
    if (fs.existsSync(p)) return p;
  }
  return undefined;
}

/**
 * Installs font files for the current user (Windows, no admin). Returns what was installed with its PostScript
 * names. Only TTF/OTF files are accepted (checked by content). Callers must have the user's OK (GOAL-PHASE6 §2).
 */
export function installFonts(files: string[]): { file: string; names: FontNames; already: boolean }[] {
  if (process.platform !== 'win32') throw new Error('font install is implemented for Windows only; install the files by hand');
  const dir = userFontDir();
  fs.mkdirSync(dir, { recursive: true });
  const out: { file: string; names: FontNames; already: boolean }[] = [];
  for (const f of files) {
    const buf = fs.readFileSync(f);
    const magic = buf.toString('latin1', 0, 4);
    if (!(buf.readUInt32BE(0) === 0x00010000 || magic === 'OTTO' || magic === 'true')) throw new Error(`${path.basename(f)} is not a TTF/OTF font`);
    const names = fontNames(buf);
    const dest = path.join(dir, path.basename(f).replace(/[^A-Za-z0-9._\[\],-]+/g, '_'));
    const already = fs.existsSync(dest) && fs.statSync(dest).size === buf.length;
    if (!already) fs.copyFileSync(f, dest);
    const kind = magic === 'OTTO' ? 'OpenType' : 'TrueType';
    execFileSync('reg', ['add', REG, '/v', `${names.full} (${kind})`, '/t', 'REG_SZ', '/d', dest, '/f'], { stdio: 'ignore', windowsHide: true });
    out.push({ file: dest, names, already });
  }
  // Load the files into this logon session (AddFontResource, as Explorer's Install does), then tell running apps the
  // font list changed. Without the load, a running AE never sees the font, not even after an AE restart (D102).
  const ps = out.map((o) => `[void][W.U]::AddFontResourceW('${o.file.replace(/'/g, "''")}');`).join(' ');
  try {
    execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', `Add-Type -Namespace W -Name U -MemberDefinition '[DllImport("gdi32.dll", CharSet=CharSet.Unicode)] public static extern int AddFontResourceW(string f); [DllImport("user32.dll")] public static extern IntPtr SendMessageTimeout(IntPtr h,uint m,UIntPtr w,IntPtr l,uint f,uint t,out UIntPtr r);'; ${ps} $r=[UIntPtr]::Zero; [W.U]::SendMessageTimeout([IntPtr]0xffff,0x001D,[UIntPtr]::Zero,[IntPtr]::Zero,2,3000,[ref]$r) | Out-Null`], { stdio: 'ignore', windowsHide: true, timeout: 15_000 });
  } catch { /* best effort: the font is still installed for the next logon */ }
  return out;
}

/** ExtendScript that reports which of these PostScript names AE resolves to a real (non-substitute) font. */
export function aeFontCheckScript(postScriptNames: string[]): string {
  return `(function(){var want=${JSON.stringify(postScriptNames)},ok=[],miss=[];for(var i=0;i<want.length;i++){var q=app.fonts.getFontsByPostScriptName(want[i]);var hit=false;for(var j=0;j<q.length;j++)if(!q[j].isSubstitute)hit=true;(hit?ok:miss).push(want[i]);}return ok.join(",")+"|"+miss.join(",");})()`;
}
