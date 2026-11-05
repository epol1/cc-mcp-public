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
  // Child controls by Win32 (fast, unlike UI Automation on a Save dialog's folder view).
  [DllImport("user32.dll")] public static extern bool EnumChildWindows(IntPtr p, EnumProc cb, IntPtr l);
  [DllImport("user32.dll")] public static extern int GetDlgCtrlID(IntPtr h);
  [DllImport("user32.dll")] public static extern IntPtr GetParent(IntPtr h);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern IntPtr SendMessageTimeout(IntPtr h, uint msg, IntPtr w, string l, uint flags, uint timeout, out IntPtr res);
  [DllImport("user32.dll")] public static extern IntPtr SendMessageTimeout(IntPtr h, uint msg, IntPtr w, IntPtr l, uint flags, uint timeout, out IntPtr res);
  public static List<IntPtr> Children(IntPtr p) { var res = new List<IntPtr>(); EnumChildWindows(p, (h, l) => { res.Add(h); return true; }, IntPtr.Zero); return res; }
  // The "File name:" edit of a common Save/Open dialog: an Edit inside the ComboBox with id 1001 (Vista style) or
  // inside ComboBoxEx32 1148 (classic); a bare Edit with id 1001/1152 as a fallback.
  public static IntPtr FileNameEdit(IntPtr dlg) {
    IntPtr loose = IntPtr.Zero;
    foreach (var h in Children(dlg)) {
      if (Cls(h) != "Edit") continue;
      var p = GetParent(h); int pid = GetDlgCtrlID(p), id = GetDlgCtrlID(h);
      if ((Cls(p) == "ComboBox" && (pid == 1001 || GetDlgCtrlID(GetParent(p)) == 1148)) ) return h;
      if (id == 1001 || id == 1152) loose = h;
    }
    return loose;
  }
  public static IntPtr ChildById(IntPtr dlg, int id) { foreach (var h in Children(dlg)) if (GetDlgCtrlID(h) == id && Cls(h) == "Button") return h; return IntPtr.Zero; }
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
  # Cancel-like answers close the dialog directly (no UI Automation search, which is slow on file dialogs).
  if ($Button -match "^(cancel|escape|esc|close)$") { [void][AeWin]::PostMessage($target, 0x0010, [IntPtr]0, [IntPtr]0); '{"pressed":true,"via":"wm_close"}'; exit 0 }
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

if ($Action -eq "dialogs") {
  # Fast Win32-only list of AE's dialogs (no UI Automation, no captures): JSON [{ hwnd, title }].
  $list = @()
  foreach ($h in [AeWin]::ForPids($pids)) { if ([AeWin]::Cls($h) -eq "#32770") { $list += [pscustomobject]@{ hwnd = [int64]$h; title = [AeWin]::Title($h) } } }
  ConvertTo-Json -InputObject @($list) -Compress
  exit 0
}

if ($Action -eq "settext") {
  # Types -Button's text into the "File name:" box of a common Save/Open dialog -Hwnd (Win32 only; never another
  # field: the folder view's items are editable too, and UI Automation over them takes minutes).
  $target = [IntPtr][int64]$Hwnd
  if ([AeWin]::Cls($target) -ne "#32770") { '{"set":false,"error":"not a dialog window"}'; exit 0 }
  $edit = [AeWin]::FileNameEdit($target)
  if ($edit -eq [IntPtr]::Zero) { '{"set":false,"error":"no File name box (not a common file dialog?)"}'; exit 0 }
  $r = [IntPtr]::Zero
  [void][AeWin]::SendMessageTimeout($edit, 0x000C, [IntPtr]0, $Button, 0x0002, 2000, [ref]$r)
  $sb = New-Object System.Text.StringBuilder 1024; [void][AeWin]::SendMessageTimeout($edit, 0x000D, [IntPtr]1024, $sb, 0x0002, 2000, [ref]$r)
  ('{"set":' + ($(if ($sb.ToString() -eq $Button) { 'true' } else { 'false' })) + ',"via":"win32","value":' + (ConvertTo-Json $sb.ToString()) + '}')
  exit 0
}

if ($Action -eq "click") {
  # Clicks the child button with control id -Button (1 = OK/Save, 2 = Cancel) of dialog -Hwnd (BM_CLICK).
  $target = [IntPtr][int64]$Hwnd
  $btn = [AeWin]::ChildById($target, [int]$Button)
  if ($btn -eq [IntPtr]::Zero) { '{"pressed":false,"error":"no such button"}'; exit 0 }
  [void][AeWin]::PostMessage($btn, 0x00F5, [IntPtr]0, [IntPtr]0)
  '{"pressed":true,"via":"bm_click"}'
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
    # A bounded walk: at most 400 elements / 3 s, never into lists, trees or grids (a Save dialog's folder view has
    # thousands of items, and walking them took minutes).
    $walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker
    $stack = New-Object System.Collections.Stack; $stack.Push($el); $n = 0; $sw = [Diagnostics.Stopwatch]::StartNew()
    while ($stack.Count -gt 0 -and $n -lt 400 -and $sw.ElapsedMilliseconds -lt 3000) {
      $e = $stack.Pop(); $n++
      $type = $e.Current.ControlType.ProgrammaticName
      $nm = $e.Current.Name
      if ($nm -and $e -ne $el) { if ($type -eq "ControlType.Button") { $buttons += $nm } elseif ($nm -ne "OS_ViewContainer") { $texts += $nm } }
      if ($type -match "ControlType\.(List|Tree|DataGrid|Table)$") { continue }
      $c = $walker.GetFirstChild($e); $kids = @()
      while ($c) { $kids += $c; $c = $walker.GetNextSibling($c) }
      for ($i = $kids.Count - 1; $i -ge 0; $i--) { $stack.Push($kids[$i]) }
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
