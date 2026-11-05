param([string]$Action = "list", [string]$OutDir = "", [string]$Hwnd = "", [string]$Button = "", [string]$App = "ae")
# App window/dialog helper for the ae-compose and pr-cut watchdogs (Windows). -App ae (After Effects) or pr (Premiere Pro).
# Uses only non-blocking Win32 calls on AE's main window (UIA/PrintWindow on a busy UI thread hang).
# Dialogs (#32770) run their own modal loop, so capture/UIA on them is safe.
#   list   -> JSON { running, hung, main: {...}, dialogs: [...] }   (+ captures when -OutDir is given)
#   press  -> presses -Button on dialog -Hwnd (UIA invoke, else WM_CLOSE for cancel-like, else Enter)
#   windows -> JSON list of every visible top-level window of the app (class, title, owner) for discovery
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing
Add-Type @"
using System; using System.Text; using System.Runtime.InteropServices; using System.Collections.Generic;
public class AeWin {
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr l);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsWindowEnabled(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsHungAppWindow(IntPtr h);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern IntPtr SendMessageTimeout(IntPtr h, uint msg, IntPtr w, StringBuilder l, uint flags, uint timeout, out IntPtr res);
  [DllImport("user32.dll")] public static extern IntPtr GetWindow(IntPtr h, uint cmd);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h, IntPtr hdc, uint flags);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h, uint msg, IntPtr w, IntPtr l);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  public struct RECT { public int L, T, R, B; }
  public static List<IntPtr> ForPids(HashSet<uint> pids) {
    var res = new List<IntPtr>();
    EnumWindows((h, l) => { uint pid; GetWindowThreadProcessId(h, out pid); if (pids.Contains(pid) && IsWindowVisible(h)) res.Add(h); return true; }, IntPtr.Zero);
    return res;
  }
  public static string Cls(IntPtr h) { var sb = new StringBuilder(256); GetClassName(h, sb, 256); return sb.ToString(); }
  // WM_GETTEXT with a timeout so a busy AE never blocks us.
  public static string Title(IntPtr h) { var sb = new StringBuilder(512); IntPtr r; SendMessageTimeout(h, 0x000D, (IntPtr)512, sb, 0x0002, 300, out r); return sb.ToString(); }
}
"@
[void][AeWin]::SetProcessDPIAware()
$pids = New-Object 'System.Collections.Generic.HashSet[uint32]'
$procName = if ($App -eq "pr") { "Adobe Premiere Pro" } else { "AfterFX" }
Get-Process -Name $procName -ErrorAction SilentlyContinue | ForEach-Object { [void]$pids.Add([uint32]$_.Id) }

if ($Action -eq "windows") {
  $list = @()
  foreach ($h in [AeWin]::ForPids($pids)) {
    $r = New-Object AeWin+RECT; [void][AeWin]::GetWindowRect($h, [ref]$r)
    $list += [pscustomobject][ordered]@{ hwnd = [int64]$h; cls = [AeWin]::Cls($h); title = [AeWin]::Title($h); owner = [int64][AeWin]::GetWindow($h, 4); enabled = [AeWin]::IsWindowEnabled($h); rect = @($r.L, $r.T, ($r.R - $r.L), ($r.B - $r.T)) }
  }
  ConvertTo-Json -InputObject $list -Depth 4 -Compress
  exit 0
}

if ($Action -eq "press") {
  $target = [IntPtr][int64]$Hwnd
  $tcls = [AeWin]::Cls($target)
  if ($tcls -ne "#32770" -and -not ($App -eq "pr" -and $tcls -eq "DroverLord - Window Class")) { '{"pressed":false,"error":"not a dialog window"}'; exit 0 }
  try {
    Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
    $el = [System.Windows.Automation.AutomationElement]::FromHandle($target)
    $nameCond = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::NameProperty, $Button)
    $typeCond = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::Button)
    $btn = $el.FindFirst([System.Windows.Automation.TreeScope]::Descendants, (New-Object System.Windows.Automation.AndCondition($nameCond, $typeCond)))
    if ($btn) { $btn.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke(); '{"pressed":true,"via":"uia"}'; exit 0 }
  } catch {}
  if ($Button -match "^(cancel|escape|esc|close)$") { [void][AeWin]::PostMessage($target, 0x0010, [IntPtr]0, [IntPtr]0); '{"pressed":true,"via":"wm_close"}'; exit 0 }
  [void][AeWin]::SetForegroundWindow($target)
  $key = if ($Button -match "^(no)$") { 0x1B } else { 0x0D }
  [void][AeWin]::PostMessage($target, 0x0100, [IntPtr]$key, [IntPtr]0); [void][AeWin]::PostMessage($target, 0x0101, [IntPtr]$key, [IntPtr]0)
  '{"pressed":true,"via":"key"}'
  exit 0
}

$out = [ordered]@{ running = ($pids.Count -gt 0); hung = $false; main = $null; dialogs = @() }
if ($pids.Count -eq 0) { $out | ConvertTo-Json -Depth 5 -Compress; exit 0 }
$wins = [AeWin]::ForPids($pids)
# Premiere draws its dialogs and floating panels as owned "DroverLord - Window Class" windows; one counts as a
# dialog only while the main window is disabled (a modal is up). AE dialogs are standard #32770 windows.
$mainCls = if ($App -eq "pr") { "Premiere Pro" } else { "AE_CApplication*" }
$modal = $false
foreach ($h in $wins) { if ([AeWin]::Cls($h) -like $mainCls) { $modal = -not [AeWin]::IsWindowEnabled($h) } }
foreach ($h in $wins) {
  $cls = [AeWin]::Cls($h)
  if ($cls -like $mainCls) {
    $out.hung = [AeWin]::IsHungAppWindow($h)
    $out.main = [ordered]@{ hwnd = [int64]$h; title = [AeWin]::Title($h); enabled = [AeWin]::IsWindowEnabled($h) }
    continue
  }
  $isDialog = ($cls -eq "#32770") -or ($App -eq "pr" -and $modal -and $cls -eq "DroverLord - Window Class" -and [AeWin]::GetWindow($h, 4) -ne [IntPtr]::Zero)
  if (-not $isDialog) { continue }
  $r = New-Object AeWin+RECT; [void][AeWin]::GetWindowRect($h, [ref]$r)
  $owner = [AeWin]::GetWindow($h, 4)
  $d = [ordered]@{ hwnd = [int64]$h; title = [AeWin]::Title($h); cls = $cls; owned = ($owner -ne [IntPtr]::Zero); rect = @($r.L, $r.T, ($r.R - $r.L), ($r.B - $r.T)) }
  try {
    Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
    $el = [System.Windows.Automation.AutomationElement]::FromHandle($h)
    $buttons = @(); $texts = @()
    foreach ($e in $el.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)) {
      $nm = $e.Current.Name; if (-not $nm) { continue }
      if ($e.Current.ControlType.ProgrammaticName -eq "ControlType.Button") { $buttons += $nm } elseif ($nm -ne "OS_ViewContainer") { $texts += $nm }
    }
    $d.buttons = $buttons; $d.texts = $texts
  } catch {}
  if ($OutDir -and $d.rect[2] -gt 0 -and $d.rect[3] -gt 0) {
    $bmp = New-Object System.Drawing.Bitmap $d.rect[2], $d.rect[3]
    $g = [System.Drawing.Graphics]::FromImage($bmp); $hdc = $g.GetHdc(); $ok = [AeWin]::PrintWindow($h, $hdc, 2); $g.ReleaseHdc($hdc); $g.Dispose()
    if (-not $ok) { $g2 = [System.Drawing.Graphics]::FromImage($bmp); $g2.CopyFromScreen($d.rect[0], $d.rect[1], 0, 0, $bmp.Size); $g2.Dispose() }
    $p = Join-Path $OutDir ("dialog_" + $d.hwnd + ".png"); $bmp.Save($p); $bmp.Dispose(); $d.capture = $p
  }
  $out.dialogs += [pscustomobject]$d
}
$out | ConvertTo-Json -Depth 5 -Compress
