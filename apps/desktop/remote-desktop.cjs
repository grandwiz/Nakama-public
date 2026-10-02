const { spawn } = require("node:child_process");
const path = require("node:path");

function inputPoint(screen, monitor, x, y) {
  return screen.dipToScreenPoint({
    x: monitor.bounds.x + Math.round(x * (monitor.bounds.width - 1)),
    y: monitor.bounds.y + Math.round(y * (monitor.bounds.height - 1)),
  });
}

function createWindowsRemoteAdapter(electron, { helperPath, spawnProcess = spawn } = {}) {
  const { screen, desktopCapturer, BrowserWindow, ipcMain, powerMonitor } = electron;
  let child = null, overlay = null, active = null, buffer = "", serial = 0;
  const pending = new Map();
  const helper = helperPath || path.join(__dirname.replace(/app\.asar(?=[\\/])/, "app.asar.unpacked"), "remote-input.ps1");
  const failPending = (error) => {
    for (const call of pending.values()) { clearTimeout(call.timer); call.reject(error); }
    pending.clear();
  };
  const stop = () => {
    const previous = child;
    child = null;
    active = null;
    previous?.stdin.end();
    previous?.kill();
    failPending(new Error("Remote desktop stopped."));
    const oldOverlay = overlay;
    overlay = null;
    oldOverlay?.destroy();
  };
  const request = (message, timeout = 2000) => new Promise((resolve, reject) => {
    if (!child || !active) return reject(new Error("The Windows input helper is unavailable."));
    const id = ++serial;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error("The Windows desktop did not respond. Start a fresh session."));
      active?.stop();
    }, timeout);
    pending.set(id, { resolve, reject, timer });
    // JSON goes through stdin. User text is never interpolated into PowerShell.
    child.stdin.write(JSON.stringify({ ...message, id, ownerPid: process.pid }) + "\n", (error) => {
      if (error) { clearTimeout(timer); pending.delete(id); reject(error); }
    });
  });
  const endSession = () => active?.stop();
  powerMonitor.on("lock-screen", endSession);
  powerMonitor.on("suspend", endSession);
  screen.on("display-removed", endSession);
  screen.on("display-metrics-changed", endSession);
  ipcMain.on("nakama:remote-stop", (event) => {
    if (overlay && event.sender === overlay.webContents && event.senderFrame === overlay.webContents.mainFrame) endSession();
  });
  return {
    available: process.platform === "win32",
    async monitors() {
      const primary = screen.getPrimaryDisplay().id;
      return screen.getAllDisplays().map((d, index) => ({
        id: String(d.id), name: d.label || `Monitor ${index + 1}`,
        width: d.size.width, height: d.size.height, primary: d.id === primary,
        bounds: { ...d.bounds }, scaleFactor: d.scaleFactor, rotation: d.rotation,
      }));
    },
    async start(session) {
      stop();
      active = session;
      buffer = "";
      const windowsRoot = process.env.SystemRoot || "C:\\Windows";
      const executable = path.join(windowsRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
      const proc = child = spawnProcess(executable, ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", helper], {
        windowsHide: true, shell: false, stdio: ["pipe", "pipe", "pipe"],
      });
      proc.stdin.on("error", () => { if (child === proc) endSession(); });
      proc.stderr.on("data", () => {}); // Native diagnostics never echo input text.
      proc.stdout.setEncoding("utf8");
      proc.stdout.on("data", (data) => {
        if (child !== proc) return;
        buffer += data;
        if (buffer.length > 65536) { endSession(); return; }
        let newline;
        while ((newline = buffer.indexOf("\n")) !== -1) {
          const line = buffer.slice(0, newline).trim();
          buffer = buffer.slice(newline + 1);
          if (!line) continue;
          let reply;
          try { reply = JSON.parse(line); } catch { endSession(); return; }
          const call = pending.get(reply.id);
          if (!call) continue;
          clearTimeout(call.timer);
          pending.delete(reply.id);
          if (reply.ok) call.resolve(reply); else call.reject(new Error(reply.error || "Windows blocked this operation."));
        }
      });
      const failed = () => {
        if (child !== proc) return;
        failPending(new Error("The Windows remote desktop helper closed."));
        endSession();
      };
      proc.on("error", failed);
      proc.on("exit", failed);
      await request({ kind: "probe", deadline: Date.now() + 10_000 }, 10_000);
      if (active !== session) throw new Error("Remote desktop was stopped while starting.");
      overlay = new BrowserWindow({
        width: 440, height: 132, resizable: false, maximizable: false, minimizable: false,
        alwaysOnTop: true, autoHideMenuBar: true, title: "Nakama • Remote desktop active",
        backgroundColor: "#151d31", show: false,
        webPreferences: { preload: path.join(__dirname, "remote-session-preload.cjs"), contextIsolation: true, nodeIntegration: false, sandbox: true },
      });
      const sessionWindow = overlay;
      sessionWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
      sessionWindow.webContents.on("will-navigate", (event) => event.preventDefault());
      sessionWindow.on("close", () => { if (active === session) session.stop(); });
      await sessionWindow.loadFile(path.join(__dirname, "remote-session.html"), { query: { expiresAt: session.expiresAt, device: session.deviceName } });
      if (active !== session || overlay !== sessionWindow) throw new Error("Remote desktop session ended.");
      sessionWindow.showInactive();
    },
    async capture(monitor) {
      await request({ kind: "probe", deadline: Date.now() + 3000 });
      const sources = await desktopCapturer.getSources({ types: ["screen"], thumbnailSize: { width: 1280, height: 1280 }, fetchWindowIcons: false });
      await request({ kind: "probe", deadline: Date.now() + 3000 });
      const source = sources.find((s) => s.display_id === monitor.id);
      if (!source || source.thumbnail.isEmpty()) throw new Error("This monitor cannot be captured. Check that Windows is unlocked.");
      const size = source.thumbnail.getSize();
      if (size.width > 1600 || size.height > 1600) throw new Error("The desktop image exceeds the supported size.");
      return { ...size, jpeg: source.thumbnail.toJPEG(65) };
    },
    async input(input, monitor, { deadline }) {
      const message = { ...input, deadline };
      if (input.x !== undefined) Object.assign(message, inputPoint(screen, monitor, input.x, input.y));
      if (input.endX !== undefined) {
        const end = inputPoint(screen, monitor, input.endX, input.endY);
        message.endX = end.x; message.endY = end.y;
      }
      await request(message);
    },
    stop,
  };
}
module.exports = { createWindowsRemoteAdapter, inputPoint };
