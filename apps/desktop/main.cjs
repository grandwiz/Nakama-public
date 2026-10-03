const {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  shell,
  safeStorage,
  clipboard,
  Tray,
  Menu,
  screen,
  desktopCapturer,
  powerMonitor,
  session,
  nativeImage,
  Notification,
} = require("electron");
const path = require("node:path");
const fs = require("node:fs/promises");
const { pathToFileURL } = require("node:url");
let window,
  host,
  tray,
  desktopAttention,
  quitting = false;
const smokeTest = !app.isPackaged && process.env.NAKAMA_SMOKE_TEST === "1";
if (smokeTest && process.env.NAKAMA_TEST_DATA_DIR)
  app.setPath("userData", process.env.NAKAMA_TEST_DATA_DIR);
if (!app.requestSingleInstanceLock()) app.quit();
app.on("second-instance", () => {
  if (window) {
    window.show();
    window.focus();
  }
});
app
  .whenReady()
  .then(async () => {
    const dataDir = path.join(app.getPath("userData"), "private");
    await fs.mkdir(dataDir, { recursive: true });
    const vaultFile = path.join(dataDir, "vault.bin.json");
    let vaultData = {};
    try {
      vaultData = JSON.parse(await fs.readFile(vaultFile, "utf8"));
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
    }
    let vaultQueue = Promise.resolve();
    const vault = {
      async get(key) {
        if (!safeStorage.isEncryptionAvailable())
          throw new Error("Windows protected storage is unavailable.");
        return vaultData[key]
          ? safeStorage.decryptString(Buffer.from(vaultData[key], "base64"))
          : null;
      },
      async set(key, value) {
        if (!safeStorage.isEncryptionAvailable())
          throw new Error("Windows protected storage is unavailable.");
        const operation = vaultQueue.then(async () => {
          const next = {
            ...vaultData,
            [key]: safeStorage.encryptString(value).toString("base64"),
          };
          const temp = vaultFile + ".tmp";
          await fs.writeFile(temp, JSON.stringify(next));
          await fs.rename(temp, vaultFile);
          vaultData = next;
        });
        vaultQueue = operation.catch(() => {});
        return operation;
      },
      async delete(key) {
        const operation = vaultQueue.then(async () => {
          const next = { ...vaultData };
          delete next[key];
          const temp = vaultFile + ".tmp";
          await fs.writeFile(temp, JSON.stringify(next));
          await fs.rename(temp, vaultFile);
          vaultData = next;
        });
        vaultQueue = operation.catch(() => {});
        return operation;
      },
      async deletePrefix(prefix) {
        for (const key of Object.keys(vaultData))
          if (key.startsWith(prefix)) await this.delete(key);
      },
    };
    const { NakamaHost } = await import(
      pathToFileURL(path.join(__dirname, "../host/host.mjs")).href
    );
    const mcpPath = app.isPackaged
      ? path.join(process.resourcesPath, "kling-mcp", "server.mjs")
      : path.join(__dirname, "../../output/kling-mcp/server.mjs");
    const { createWindowsRemoteAdapter } = require("./remote-desktop.cjs");
    const { createBrowserStudioAdapter } = require("./browser-studio.cjs");
    const browserStudioAdapter = createBrowserStudioAdapter({
      BrowserWindow,
      session,
    });
    const { createMonitoringAdapter } = require("./browser-monitor.cjs");
    const monitorAdapter = createMonitoringAdapter({
      browserAdapter: browserStudioAdapter,
    });
    const remoteDesktopAdapter = createWindowsRemoteAdapter({
      screen,
      desktopCapturer,
      BrowserWindow,
      ipcMain,
      powerMonitor,
    });
    const { createProjectReportAdapter } = require("./project-reports.cjs");
    const reportAdapter = createProjectReportAdapter({
      BrowserWindow,
      session,
      nativeImage,
    });
    const { createSelfMaintenanceAdapter } = require("./self-maintenance.cjs");
    const maintenanceAdapter = createSelfMaintenanceAdapter({
      app,
      shell,
      session,
      BrowserWindow,
    });
    const alarmSoundDecoder = require("./alarm-audio.cjs").createAlarmAudioDecoder({ BrowserWindow, session });
    host = await new NakamaHost({
      dataDir,
      vault,
      mcpPath,
      remoteDesktopAdapter,
      browserStudioAdapter,
      reportAdapter,
      monitorAdapter,
      maintenanceAdapter,
      alarmSoundDecoder,
    }).init();
    try {
      await host.listen(smokeTest ? { port: 0 } : {});
    } catch (e) {
      dialog.showErrorBox(
        "Nakama connection service",
        `The desktop is available, but device connections could not start: ${e.message}`,
      );
    }
    try {
      await host.listenBrowserBridge(smokeTest ? { port: 0 } : {});
    } catch (e) {
      dialog.showErrorBox(
        "Nakama Chrome connection",
        `The Chrome bridge could not start: ${e.message}`,
      );
    }
    const assertSender = (event) => {
      if (
        !window ||
        event.sender !== window.webContents ||
        event.senderFrame !== window.webContents.mainFrame
      )
        throw new Error("Untrusted sender.");
    };
    ipcMain.handle("nakama:api", async (event, method, url, body) => {
      assertSender(event);
      if (
        typeof method !== "string" ||
        typeof url !== "string" ||
        !url.startsWith("/api/")
      )
        throw new Error("Invalid request.");
      return host.dispatch(method, url, body || {}, {
        kind: "owner",
        id: "desktop",
      });
    });
    ipcMain.handle("nakama:choose-folder", async (event) => {
      assertSender(event);
      const result = await dialog.showOpenDialog(window, {
        title: "Choose Nakama project folder",
        properties: ["openDirectory", "createDirectory"],
      });
      return result.canceled ? null : result.filePaths[0];
    });
    ipcMain.handle("nakama:copy-text", async (event, value) => {
      assertSender(event);
      if (typeof value !== "string" || value.length > 100000)
        throw new Error("Copy text is too large.");
      await clipboard.writeText(value);
      return { copied: true };
    });
    ipcMain.handle("nakama:open-project-folder", async (event, projectId) => {
      assertSender(event);
      const { projectRoot } = await import(
        pathToFileURL(path.join(__dirname, "../host/security.mjs")).href
      );
      const folder = await projectRoot(
        host.store.state.config.workspaceRoot,
        host.project(projectId),
      );
      const error = await shell.openPath(folder);
      if (error) throw new Error(error);
      return { opened: true };
    });
    ipcMain.handle("nakama:external", async (event, url) => {
      assertSender(event);
      const target = new URL(url);
      if (target.protocol !== "https:" || target.username || target.password)
        throw new Error("Only HTTPS links are supported.");
      await shell.openExternal(target.toString());
    });
    ipcMain.handle(
      "nakama:save-project-report",
      async (event, projectId, reportId) => {
        assertSender(event);
        const report = await host.reports.file(projectId, reportId, {
          kind: "owner",
          id: "desktop",
        });
        const selected = await dialog.showSaveDialog(window, {
          title: "Save project report",
          defaultPath: report.fileName,
          filters: [{ name: "PDF report", extensions: ["pdf"] }],
        });
        if (selected.canceled || !selected.filePath) return { saved: false };
        // The native save dialog supplies the destination; API callers never choose a host path.
        const current = await host.reports.file(projectId, reportId, {
          kind: "owner",
          id: "desktop",
        });
        await fs.writeFile(
          selected.filePath,
          Buffer.from(current.base64, "base64"),
        );
        return { saved: true };
      },
    );
    ipcMain.handle(
      "nakama:open-project-report",
      async (event, projectId, reportId) => {
        assertSender(event);
        if (typeof reportId !== "string" || !/^[a-f0-9-]{36}$/.test(reportId))
          throw new Error("Invalid report identity.");
        await host.reports.file(projectId, reportId, {
          kind: "owner",
          id: "desktop",
        });
        const error = await shell.openPath(
          path.join(dataDir, "project-reports", `${reportId}.pdf`),
        );
        if (error) throw new Error(error);
        return { opened: true };
      },
    );
    const icon = path.join(__dirname, "assets/icon.png");
    window = new BrowserWindow({
      width: 1440,
      height: 960,
      minWidth: 1000,
      minHeight: 720,
      title: "Nakama Control Center",
      icon,
      backgroundColor: "#10131d",
      show: false,
      autoHideMenuBar: true,
      webPreferences: {
        preload: path.join(__dirname, "preload.cjs"),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
      },
    });
    window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    window.webContents.on("will-navigate", (event) => event.preventDefault());
    window.webContents.session.setPermissionRequestHandler(
      (_webContents, _permission, callback) => callback(false),
    );
    if (!smokeTest) {
      tray = new Tray(icon);
      tray.setToolTip("Nakama Control Center");
      tray.setContextMenu(
        Menu.buildFromTemplate([
          {
            label: "Open Nakama",
            click: () => {
              window.show();
              window.focus();
            },
          },
          {
            label: "Stop remote desktop",
            click: () =>
              host.remoteDesktop?.stopAll("Stopped from the Windows tray."),
          },
          {
            label: "Quit Nakama and disconnect devices",
            click: () => {
              quitting = true;
              app.quit();
            },
          },
        ]),
      );
      tray.on("double-click", () => {
        window.show();
        window.focus();
      });
      window.on("close", (event) => {
        if (!quitting && host.store.state.config.closeToTray !== false) {
          event.preventDefault();
          window.hide();
        }
      });
      let startup = host.store.state.config.startWithWindows === true;
      if (app.isPackaged)
        app.setLoginItemSettings({
          openAtLogin: startup,
          path: process.execPath,
        });
      host.store.on("changed", () => {
        const requested = host.store.state.config.startWithWindows === true;
        if (app.isPackaged && requested !== startup) {
          app.setLoginItemSettings({
            openAtLogin: requested,
            path: process.execPath,
          });
          startup = requested;
        }
      });
    }
    host.store.on("changed", () => {
      if (window && !window.isDestroyed())
        window.webContents.send("nakama:event", { type: "state.changed" });
    });
    if (!smokeTest) {
      const { createDesktopAttention } = require("./desktop-attention.cjs");
      desktopAttention = createDesktopAttention({
        Notification,
        onOpen: (attentionId) => {
          if (window && !window.isDestroyed()) {
            window.show();
            window.focus();
            window.webContents.send("nakama:event", {
              type: "attention.open",
              attentionId,
            });
          }
        },
      });
      let attentionRead = 0;
      const updateAttention = async () => {
        const token = ++attentionRead;
        try {
          const value = await host.dispatch("GET", "/api/attention");
          if (token === attentionRead) desktopAttention.update(value);
        } catch {
          /* Keep notification failures separate from host operation. */
        }
      };
      host.store.on("changed", () => void updateAttention());
      void updateAttention();
    }
    await window.loadFile(path.join(__dirname, "dist/index.html"));
    if (!smokeTest) window.show();
  })
  .catch((error) => {
    dialog.showErrorBox("Nakama could not start", error.message);
    app.quit();
  });
app.on("window-all-closed", () => app.quit());
app.on("before-quit", () => {
  quitting = true;
  tray?.destroy();
  desktopAttention?.close();
  if (host) {
    host.monitoring?.close();
    host.selfMaintenance?.close();
    host.remoteDesktop?.close();
    host.browserStudio?.close();
    for (const run of host.runs.values()) run.stop();
  }
});
