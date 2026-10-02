# Fixed, bundled helper. Requests are JSON on stdin, never executable script text.
# It is created only for a visible, bounded Remote desktop session.
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;

public static class NakamaRemoteInput {
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int x, y; }
  [StructLayout(LayoutKind.Sequential)] struct MOUSEINPUT { public int dx, dy; public uint mouseData, dwFlags, time; public UIntPtr extra; }
  [StructLayout(LayoutKind.Sequential)] struct KEYBDINPUT { public ushort vk, scan; public uint flags, time; public UIntPtr extra; }
  [StructLayout(LayoutKind.Explicit)] struct UNION { [FieldOffset(0)] public MOUSEINPUT mouse; [FieldOffset(0)] public KEYBDINPUT key; }
  [StructLayout(LayoutKind.Sequential)] struct INPUT { public uint type; public UNION data; }
  [StructLayout(LayoutKind.Sequential)] struct GUITHREADINFO { public uint size, flags; public IntPtr active, focus, capture, menuOwner, moveSize, caret; public int left, top, right, bottom; }
  [DllImport("user32.dll")] static extern IntPtr OpenInputDesktop(uint flags, bool inherit, uint access);
  [DllImport("user32.dll")] static extern bool CloseDesktop(IntPtr desktop);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern bool GetUserObjectInformation(IntPtr h, int n, StringBuilder value, uint length, out uint needed);
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern IntPtr WindowFromPoint(POINT point);
  [DllImport("user32.dll")] static extern IntPtr GetAncestor(IntPtr window, uint flags);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr window, out uint pid);
  [DllImport("user32.dll")] static extern bool GetGUIThreadInfo(uint thread, ref GUITHREADINFO info);
  [DllImport("user32.dll")] static extern short GetAsyncKeyState(int key);
  [DllImport("user32.dll")] static extern int GetSystemMetrics(int index);
  [DllImport("user32.dll")] static extern uint SendInput(uint count, INPUT[] inputs, int size);
  [DllImport("user32.dll")] static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
  [DllImport("user32.dll")] static extern uint GetDoubleClickTime();

  static void Deadline(long deadline) {
    long now = (long)(DateTime.UtcNow - new DateTime(1970, 1, 1, 0, 0, 0, DateTimeKind.Utc)).TotalMilliseconds;
    if (deadline < now || deadline > now + 15000) throw new Exception("The remote screen image expired.");
  }
  public static void Probe(long deadline) {
    Deadline(deadline);
    IntPtr desktop = OpenInputDesktop(0, false, 1);
    if (desktop == IntPtr.Zero) throw new Exception("Unlock Windows locally. Secure desktops cannot be controlled.");
    try {
      var name = new StringBuilder(256); uint needed;
      if (!GetUserObjectInformation(desktop, 2, name, 512, out needed) || !String.Equals(name.ToString(), "Default", StringComparison.OrdinalIgnoreCase))
        throw new Exception("Windows is showing a protected desktop. Return to the unlocked desktop locally.");
    } finally { CloseDesktop(desktop); }
  }
  static void CheckWindow(IntPtr window, uint ownerPid) {
    if (window == IntPtr.Zero) throw new Exception("The destination window is unavailable.");
    uint pid; GetWindowThreadProcessId(window, out pid);
    IntPtr root = GetAncestor(window, 3); uint rootPid; GetWindowThreadProcessId(root, out rootPid);
    if (pid == ownerPid || rootPid == ownerPid)
      throw new Exception("Nakama controls and approval windows need local PC input. Touch another application.");
  }
  static void CheckPoint(int x, int y, uint ownerPid) {
    int left=GetSystemMetrics(76), top=GetSystemMetrics(77), width=GetSystemMetrics(78), height=GetSystemMetrics(79);
    if (width < 2 || height < 2 || x < left || y < top || x >= left+width || y >= top+height) throw new Exception("That screen coordinate is no longer available.");
    CheckWindow(WindowFromPoint(new POINT { x=x, y=y }), ownerPid);
  }
  static INPUT Mouse(uint flags, int x=0, int y=0, int wheel=0) {
    return new INPUT { type=0, data=new UNION { mouse=new MOUSEINPUT { dx=x, dy=y, mouseData=unchecked((uint)wheel), dwFlags=flags } } };
  }
  static INPUT Move(int x, int y) {
    int left=GetSystemMetrics(76), top=GetSystemMetrics(77), width=GetSystemMetrics(78), height=GetSystemMetrics(79);
    return Mouse(0x8000 | 0x4000 | 0x0001, (int)Math.Round((x-left)*65535.0/(width-1)), (int)Math.Round((y-top)*65535.0/(height-1)));
  }
  static INPUT Key(ushort vk, ushort scan, uint flags) {
    return new INPUT { type=1, data=new UNION { key=new KEYBDINPUT { vk=vk, scan=scan, flags=flags } } };
  }
  public static void Execute(string kind, int x, int y, int endX, int endY, int deltaY, string key, string text, uint ownerPid, long deadline) {
    Probe(deadline);
    // Never inherit a physically-held modifier, which could transform an ordinary
    // click/key into a privileged shortcut or destructive command.
    foreach (int modifier in new int[] {16,17,18,91,92})
      if ((GetAsyncKeyState(modifier) & 0x8000) != 0) throw new Exception("Release keyboard modifier keys on the PC before remote control.");
    var gui = new GUITHREADINFO(); gui.size=(uint)Marshal.SizeOf(typeof(GUITHREADINFO));
    if (!GetGUIThreadInfo(0, ref gui)) throw new Exception("Windows input focus is unavailable.");
    if (gui.menuOwner != IntPtr.Zero) CheckWindow(gui.menuOwner, ownerPid);
    var inputs = new List<INPUT>();
    IntPtr previousDpi = SetThreadDpiAwarenessContext(new IntPtr(-4));
    try {
      if (kind == "text" || kind == "key") {
        CheckWindow(GetForegroundWindow(), ownerPid);
        if (gui.focus != IntPtr.Zero) CheckWindow(gui.focus, ownerPid);
        if (kind == "text") {
          if (String.IsNullOrEmpty(text) || text.Length > 500) throw new Exception("Invalid remote text.");
          foreach (char c in text) {
            if (Char.IsControl(c)) throw new Exception("Control characters are unavailable.");
            inputs.Add(Key(0,(ushort)c,4)); inputs.Add(Key(0,(ushort)c,6));
          }
        } else {
          var keys = new Dictionary<string, ushort> { {"Enter",13},{"Escape",27},{"Backspace",8},{"Tab",9},{"ArrowLeft",37},{"ArrowRight",39},{"ArrowUp",38},{"ArrowDown",40},{"Home",36},{"End",35},{"PageUp",33},{"PageDown",34},{"Delete",46} };
          ushort code; if (key == null || !keys.TryGetValue(key, out code)) throw new Exception("Unsupported remote key.");
          uint extended = (code >= 33 && code <= 46) ? 1u : 0u;
          inputs.Add(Key(code,0,extended)); inputs.Add(Key(code,0,extended | 2));
        }
      } else {
        CheckPoint(x,y,ownerPid);
        inputs.Add(Move(x,y));
        if (kind == "tap" || kind == "double_tap" || kind == "right_click") {
          uint down = kind == "right_click" ? 8u : 2u, up = kind == "right_click" ? 16u : 4u;
          inputs.Add(Mouse(down)); inputs.Add(Mouse(up));
          if (kind == "double_tap") { inputs.Add(Mouse(down)); inputs.Add(Mouse(up)); }
        } else if (kind == "scroll") {
          if (deltaY == 0 || Math.Abs(deltaY)>10) throw new Exception("Unsupported scroll amount.");
          inputs.Add(Mouse(0x0800,0,0,-deltaY*120));
        } else if (kind == "drag") {
          // Validate every sampled point before queuing a complete down/move/up
          // batch; killing this helper cannot strand a held mouse button.
          for (int i=1; i<=16; i++) CheckPoint(x+(int)Math.Round((endX-x)*i/16.0), y+(int)Math.Round((endY-y)*i/16.0), ownerPid);
          inputs.Add(Mouse(2));
          for (int i=1; i<=16; i++) inputs.Add(Move(x+(int)Math.Round((endX-x)*i/16.0),y+(int)Math.Round((endY-y)*i/16.0)));
          inputs.Add(Mouse(4));
        } else throw new Exception("Unsupported remote gesture.");
      }
      Probe(deadline);
      INPUT[] batch = inputs.ToArray();
      if (SendInput((uint)batch.Length,batch,Marshal.SizeOf(typeof(INPUT))) != batch.Length)
        throw new Exception("Windows blocked input. Elevated applications require local PC control.");
    } finally { SetThreadDpiAwarenessContext(previousDpi); }
  }
}
'@
while ($null -ne ($line = [Console]::ReadLine())) {
  $request = $null
  try {
    if ($line.Length -gt 12000) { throw 'Request too large.' }
    $request = $line | ConvertFrom-Json
    if ($request.kind -eq 'probe') {
      [NakamaRemoteInput]::Probe([long]$request.deadline)
    } else {
      [NakamaRemoteInput]::Execute([string]$request.kind, [int]$request.x, [int]$request.y, [int]$request.endX, [int]$request.endY, [int]$request.deltaY, [string]$request.key, [string]$request.text, [uint32]$request.ownerPid, [long]$request.deadline)
    }
    [Console]::WriteLine((@{ id=$request.id; ok=$true } | ConvertTo-Json -Compress))
  } catch {
    $message = if ($_.Exception.InnerException) { $_.Exception.InnerException.Message } else { 'Windows could not handle this remote request.' }
    [Console]::WriteLine((@{ id=$request.id; ok=$false; error=$message } | ConvertTo-Json -Compress))
  }
}
