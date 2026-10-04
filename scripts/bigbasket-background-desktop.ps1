param([Parameter(Mandatory=$true)][string]$BrowserPath, [Parameter(Mandatory=$true)][string]$ProfilePath)
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class QcDesktop {
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
  public struct STARTUPINFO {
    public int cb; public string reserved; public string desktop; public string title;
    public int x; public int y; public int width; public int height;
    public int charsX; public int charsY; public int fill; public int flags;
    public short show; public short reservedCount; public IntPtr reservedPtr;
    public IntPtr input; public IntPtr output; public IntPtr error;
  }
  [StructLayout(LayoutKind.Sequential)]
  public struct PROCESSINFO { public IntPtr process; public IntPtr thread; public int pid; public int tid; }
  [DllImport("user32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
  public static extern IntPtr CreateDesktop(string name, IntPtr device, IntPtr mode, int flags, uint access, IntPtr security);
  [DllImport("user32.dll", SetLastError=true)] public static extern bool CloseDesktop(IntPtr desktop);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
  public static extern bool CreateProcess(string app, StringBuilder command, IntPtr processSecurity,
    IntPtr threadSecurity, bool inherit, uint flags, IntPtr env, string directory,
    ref STARTUPINFO startup, out PROCESSINFO process);
  public delegate bool EnumWindow(IntPtr window, IntPtr data);
  [DllImport("user32.dll")] public static extern bool EnumDesktopWindows(IntPtr desktop, EnumWindow callback, IntPtr data);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr window, out uint pid);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr window);
  public static bool HasBrowserWindow(IntPtr desktop, int pid) {
    bool found = false;
    EnumDesktopWindows(desktop, (window, data) => { uint owner; GetWindowThreadProcessId(window, out owner);
      if (owner == pid && IsWindowVisible(window)) found = true; return true; }, IntPtr.Zero);
    return found;
  }
  [DllImport("kernel32.dll")] public static extern bool TerminateProcess(IntPtr handle, uint code);
  [DllImport("kernel32.dll")] public static extern uint WaitForSingleObject(IntPtr handle, uint timeout);
  [DllImport("kernel32.dll")] public static extern bool CloseHandle(IntPtr handle);
}
"@
# No SwitchDesktop call: this desktop is never presented to the user.
if ($BrowserPath.Contains('"') -or $ProfilePath.Contains('"')) { throw 'Invalid browser path.' }
$name = 'qc-bigbasket-' + [Guid]::NewGuid().ToString('N')
$desktop = [QcDesktop]::CreateDesktop($name, [IntPtr]::Zero, [IntPtr]::Zero, 0, 0x01FF, [IntPtr]::Zero)
if ($desktop -eq [IntPtr]::Zero) { throw 'Could not create isolated browser desktop.' }
$process = New-Object QcDesktop+PROCESSINFO
try {
  $startup = New-Object QcDesktop+STARTUPINFO
  $startup.cb = [Runtime.InteropServices.Marshal]::SizeOf($startup)
  $startup.desktop = 'WinSta0\' + $name
  $command = New-Object Text.StringBuilder
  [void]$command.Append('"' + $BrowserPath + '" --user-data-dir="' + $ProfilePath + '" --remote-debugging-port=0 --remote-debugging-address=127.0.0.1 --no-first-run --no-default-browser-check --disable-backgrounding-occluded-windows --disable-renderer-backgrounding --disable-background-timer-throttling https://www.bigbasket.com')
  if (-not [QcDesktop]::CreateProcess($BrowserPath, $command, [IntPtr]::Zero, [IntPtr]::Zero, $false, 0, [IntPtr]::Zero, [IO.Path]::GetDirectoryName($BrowserPath), [ref]$startup, [ref]$process)) { throw ('Could not launch isolated browser: Win32 ' + [Runtime.InteropServices.Marshal]::GetLastWin32Error()) }
  [void][QcDesktop]::CloseHandle($process.thread)
  $ready = $false
  for ($attempt = 0; $attempt -lt 150 -and -not $ready; $attempt++) {
    $ready = [QcDesktop]::HasBrowserWindow($desktop, $process.pid)
    if (-not $ready) { Start-Sleep -Milliseconds 100 }
  }
  if (-not $ready) {
    [void][QcDesktop]::TerminateProcess($process.process, 1)
    throw 'Browser did not create its window on the isolated desktop.'
  }
  Write-Output '{"kind":"desktop-ready","isolated":true}'
  [void][QcDesktop]::WaitForSingleObject($process.process, [uint32]::MaxValue)
} finally {
  if ($process.process -ne [IntPtr]::Zero) { [void][QcDesktop]::CloseHandle($process.process) }
  [void][QcDesktop]::CloseDesktop($desktop)
}
