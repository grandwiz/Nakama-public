const fs = require("node:fs/promises");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { spawn } = require("node:child_process");
const { pathToFileURL } = require("node:url");

// The local signed manifest authenticates the exact bytes. Windows also requires
// valid Authenticode. Neither check claims that an installer successfully ran.
function authenticode(file) {
  const literal = file.replaceAll("'", "''");
  const script = `$ErrorActionPreference='Stop'; $s=Get-AuthenticodeSignature -LiteralPath '${literal}'; if($s.Status -ne 'Valid'){throw 'A valid Windows publisher signature is required.'}; Write-Output $s.SignerCertificate.Thumbprint`;
  return new Promise((resolve, reject) => {
    const processHandle = spawn(
      path.join(
        process.env.SystemRoot || "C:\\Windows",
        "System32",
        "WindowsPowerShell",
        "v1.0",
        "powershell.exe",
      ),
      [
        "-NoProfile",
        "-NonInteractive",
        "-EncodedCommand",
        Buffer.from(script, "utf16le").toString("base64"),
      ],
      { windowsHide: true, shell: false, stdio: ["ignore", "pipe", "ignore"] },
    );
    let output = "",
      timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      processHandle.kill();
    }, 15000);
    processHandle.stdout.on("data", (data) => {
      if (output.length < 1024) output += data.toString();
    });
    processHandle.on("error", () => {
      clearTimeout(timer);
      reject(new Error("Windows signature verification could not start."));
    });
    processHandle.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0 || timedOut || !/^[A-Fa-f0-9]{40,64}\s*$/.test(output))
        reject(
          new Error(
            "A valid Windows Authenticode publisher signature is required. The unsigned engineering preview cannot self-install.",
          ),
        );
      else resolve(output.trim());
    });
  });
}
function createSelfMaintenanceAdapter({ app, shell, session, BrowserWindow }) {
  const sessions = new Set([session.defaultSession]);
  app.on("session-created", (value) => sessions.add(value));
  const files = () =>
    import(
      pathToFileURL(path.join(__dirname, "../host/self-maintenance-files.mjs"))
        .href
    );
  return {
    async preflight() {
      if (process.platform !== "win32")
        throw new Error(
          "Windows update handoff is unavailable on this platform.",
        );
      if (BrowserWindow.getAllWindows().length > 1)
        throw new Error(
          "Close internal browser and preview windows before updating.",
        );
    },
    async backup({ destination }) {
      for (const value of sessions) {
        await value.cookies.flushStore();
        value.flushStorageData();
      }
      const { ordinaryPath, backupPrivateState } = await files();
      const userData = await ordinaryPath(app.getPath("userData"), true);
      if (path.resolve(app.getPath("sessionData")) !== path.resolve(userData))
        throw new Error(
          "A custom browser session directory requires a separately reviewed backup before updating.",
        );
      const result = await backupPrivateState(
        userData,
        path.join(destination, "browser-data"),
        {
          excludeRoot: [
            "private",
            "Cache",
            "Code Cache",
            "GPUCache",
            "DawnCache",
            "ShaderCache",
            "Crashpad",
          ],
        },
      );
      return {
        complete: true,
        detail:
          "Dedicated browser partitions, Local State encryption metadata, renderer preferences and local storage copied after storage flush. Rebuildable caches are omitted.",
        ...result,
      };
    },
    async verifyArtifact({ artifactPath, platform }) {
      if (platform === "windows") await authenticode(artifactPath);
    },
    async handoff({ artifactPath, platform, sha256 }) {
      const { readOrdinary } = await files();
      if (platform === "windows") await authenticode(artifactPath);
      const data = await readOrdinary(artifactPath, 768 * 1024 * 1024);
      if (createHash("sha256").update(data).digest("hex") !== sha256)
        throw new Error("The staged update changed before platform handoff.");
      if (platform === "android") {
        // Android's package installer enforces its existing signing identity.
        // Windows only reveals the verified APK for deliberate user transfer.
        shell.showItemInFolder(artifactPath);
        return {
          handedOff: true,
          detail:
            "Verified APK shown for manual transfer and Android package installation. No device was contacted.",
        };
      }
      const error = await shell.openPath(artifactPath);
      if (error)
        throw new Error("Windows could not open the verified installer.");
      return {
        handedOff: true,
        detail:
          "Windows installer launched for the user's platform flow; completion is unverified.",
      };
    },
  };
}
module.exports = { createSelfMaintenanceAdapter };
