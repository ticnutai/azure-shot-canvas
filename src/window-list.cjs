// Lists the visible top-level windows (front to back, physical pixels) for the region picker's 'click a window'.
// Electron has no API for other programs' windows, so one hidden PowerShell process compiles a tiny user32/dwmapi
// wrapper once and then answers each request in a few milliseconds. Anything going wrong simply means no window
// detection — the picker still works by dragging.
const { spawn } = require('node:child_process');

const SOURCE = String.raw`
using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
public static class AurumWindows {
  delegate bool EnumProc(IntPtr hwnd, IntPtr lParam);
  [StructLayout(LayoutKind.Sequential)] struct RECT { public int Left, Top, Right, Bottom; }
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc callback, IntPtr lParam);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr hwnd);
  [DllImport("user32.dll")] static extern bool IsIconic(IntPtr hwnd);
  [DllImport("user32.dll")] static extern int GetWindowLong(IntPtr hwnd, int index);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr hwnd, out RECT rect);
  [DllImport("user32.dll")] static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
  [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr hwnd, int attribute, out RECT value, int size);
  [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr hwnd, int attribute, out int value, int size);
  [DllImport("user32.dll")] static extern bool EnumChildWindows(IntPtr parent, EnumProc callback, IntPtr lParam);
  [DllImport("user32.dll")] static extern int GetSystemMetrics(int index);
  // The whole desktop (every screen) in physical pixels, straight from Windows: raw BGRA rows into a file.
  // Returns 'x,y,width,height' of the desktop. Tens of milliseconds where the thumbnail route takes seconds.
  public static string Shot(string file) {
    SetThreadDpiAwarenessContext(new IntPtr(-4));
    int x = GetSystemMetrics(76), y = GetSystemMetrics(77), width = GetSystemMetrics(78), height = GetSystemMetrics(79);
    using (var bitmap = new Bitmap(width, height, PixelFormat.Format32bppArgb)) {
      using (var graphics = Graphics.FromImage(bitmap)) graphics.CopyFromScreen(x, y, 0, 0, new Size(width, height), CopyPixelOperation.SourceCopy);
      var data = bitmap.LockBits(new Rectangle(0, 0, width, height), ImageLockMode.ReadOnly, PixelFormat.Format32bppArgb);
      try {
        var bytes = new byte[data.Stride * height];
        Marshal.Copy(data.Scan0, bytes, 0, bytes.Length);
        File.WriteAllBytes(file, bytes);
      } finally { bitmap.UnlockBits(data); }
    }
    return x + "," + y + "," + width + "," + height;
  }
  // Visible inner parts of a window (panels, lists, toolbars, buttons) for 'click a part'.
  // Programs that draw everything themselves (browsers, Electron) simply have none.
  static void AppendParts(StringBuilder output, IntPtr parent, RECT frame) {
    output.Append(",[");
    var count = 0;
    EnumChildWindows(parent, (child, lParam) => {
      if (count >= 400) return false;
      if (!IsWindowVisible(child)) return true;
      RECT rect;
      if (!GetWindowRect(child, out rect)) return true;
      int width = rect.Right - rect.Left, height = rect.Bottom - rect.Top;
      if (width < 16 || height < 12) return true;
      if (rect.Left == frame.Left && rect.Top == frame.Top && rect.Right == frame.Right && rect.Bottom == frame.Bottom) return true;
      if (count > 0) output.Append(',');
      count++;
      output.Append('[').Append(rect.Left).Append(',').Append(rect.Top).Append(',').Append(width).Append(',').Append(height).Append(']');
      return true;
    }, IntPtr.Zero);
    output.Append(']');
  }
  public static string List() {
    // Per-monitor aware: every rectangle comes back in real physical pixels on every screen.
    SetThreadDpiAwarenessContext(new IntPtr(-4));
    var output = new StringBuilder("[");
    var first = true;
    EnumWindows((hwnd, lParam) => {
      if (!IsWindowVisible(hwnd) || IsIconic(hwnd)) return true;
      int exStyle = GetWindowLong(hwnd, -20);
      if ((exStyle & 0x20) != 0) return true; // WS_EX_TRANSPARENT: click-through overlays
      int cloaked;
      if (DwmGetWindowAttribute(hwnd, 14, out cloaked, 4) == 0 && cloaked != 0) return true; // hidden store apps / other desktops
      RECT rect;
      if (DwmGetWindowAttribute(hwnd, 9, out rect, 16) != 0 && !GetWindowRect(hwnd, out rect)) return true; // frame without the invisible shadow
      int width = rect.Right - rect.Left, height = rect.Bottom - rect.Top;
      if (width < 24 || height < 24) return true;
      uint pid;
      GetWindowThreadProcessId(hwnd, out pid);
      if (!first) output.Append(',');
      first = false;
      output.Append('[').Append(rect.Left).Append(',').Append(rect.Top).Append(',').Append(width).Append(',').Append(height).Append(',').Append(pid);
      AppendParts(output, hwnd, rect);
      output.Append(']');
      return true;
    }, IntPtr.Zero);
    return output.Append(']').ToString();
  }
}`;

const SCRIPT = `$ErrorActionPreference='Stop'
Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @'
${SOURCE}
'@
[Console]::Out.WriteLine('ready')
while ($true) {
  $line = [Console]::In.ReadLine()
  if ($null -eq $line) { break }
  if ($line.StartsWith('shot ')) { try { [Console]::Out.WriteLine([AurumWindows]::Shot($line.Substring(5))) } catch { [Console]::Out.WriteLine('error') } }
  else { try { [Console]::Out.WriteLine([AurumWindows]::List()) } catch { [Console]::Out.WriteLine('[]') } }
}`;

class WindowList {
  constructor() {
    this.child = null;
    this.ready = null;
    this.buffer = '';
    this.waiting = [];
  }

  start() {
    if (process.platform !== 'win32') return Promise.resolve(false);
    if (this.ready) return this.ready;
    this.ready = new Promise((resolve) => {
      let settled = false;
      const settle = (value) => { if (!settled) { settled = true; resolve(value); } };
      try {
        const encoded = Buffer.from(SCRIPT, 'utf16le').toString('base64');
        this.child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded], { windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] });
      } catch { this.ready = null; settle(false); return; }
      this.child.stdout.setEncoding('utf8');
      this.child.stdout.on('data', (chunk) => {
        this.buffer += chunk;
        let index;
        while ((index = this.buffer.indexOf('\n')) >= 0) {
          const line = this.buffer.slice(0, index).trim();
          this.buffer = this.buffer.slice(index + 1);
          if (line === 'ready') settle(true);
          else if (line) this.waiting.shift()?.(line);
        }
      });
      const fail = () => {
        this.child = null;
        this.ready = null;
        for (const callback of this.waiting.splice(0)) callback('[]');
        settle(false);
      };
      this.child.on('error', fail);
      this.child.on('exit', fail);
      this.child.stdin.on('error', () => {});
      this.child.unref();
      setTimeout(() => settle(false), 15_000).unref?.();
    });
    return this.ready;
  }

  // One request line → one answer line, in order. A late answer is still consumed by its own request, so the
  // queue stays in step; after the time limit the request resolves to null.
  async request(line, timeoutMs) {
    if (!this.child || !await Promise.race([this.ready, new Promise((resolve) => setTimeout(() => resolve(false), timeoutMs))])) return null;
    return new Promise((resolve) => {
      let done = false;
      this.waiting.push((answer) => { if (!done) { done = true; resolve(answer); } });
      this.child.stdin.write(`${line}\n`);
      setTimeout(() => { if (!done) { done = true; resolve(null); } }, timeoutMs);
    });
  }

  // Front-to-back list of { x, y, width, height, pid, parts } in physical screen pixels; [] when unavailable or slow.
  async list(timeoutMs = 350) {
    const line = await this.request('list', timeoutMs);
    try {
      return JSON.parse(line).map(([x, y, width, height, pid, parts = []]) => ({
        x, y, width, height, pid, parts: parts.map(([px, py, pw, ph]) => ({ x: px, y: py, width: pw, height: ph }))
      }));
    } catch { return []; }
  }

  // The whole desktop as raw BGRA pixels written to filePath; { x, y, width, height } of the desktop in physical
  // pixels, or null (helper unavailable, failed or too slow) so the caller can use another route.
  async shot(filePath, timeoutMs = 2500) {
    const line = await this.request(`shot ${filePath}`, timeoutMs);
    const values = String(line || '').split(',').map(Number);
    return values.length === 4 && values.every(Number.isFinite) && values[2] > 0 && values[3] > 0
      ? { x: values[0], y: values[1], width: values[2], height: values[3] } : null;
  }
  stop() {
    try { this.child?.kill(); } catch {}
    this.child = null;
    this.ready = null;
  }
}

module.exports = { WindowList };
