const { randomUUID } = require("node:crypto");

/** A dedicated offline renderer. No project HTML, script, preload or remote URL runs here. */
function createProjectReportAdapter({ BrowserWindow, session, nativeImage }) {
  const windows = new Set();
  let queue = Promise.resolve();
  return {
    async image(bytes) {
      const image = nativeImage.createFromBuffer(bytes);
      if (image.isEmpty())
        throw new Error("The selected image could not be decoded.");
      const size = image.getSize();
      if (size.width * size.height > 8_000_000)
        throw new Error("Image dimensions exceed the report limit.");
      const resized =
        size.width > 1200 || size.height > 850
          ? image.resize({
              width: Math.min(
                1200,
                Math.round(
                  size.width * Math.min(1200 / size.width, 850 / size.height),
                ),
              ),
              quality: "good",
            })
          : image;
      const png = resized.toPNG();
      if (png.length <= 262144)
        return `data:image/png;base64,${png.toString("base64")}`;
      let output = resized.toJPEG(75);
      if (output.length > 262144) output = resized.toJPEG(40);
      if (output.length > 262144)
        throw new Error(
          "The selected image cannot fit the report image limit.",
        );
      return `data:image/jpeg;base64,${output.toString("base64")}`;
    },
    render(html) {
      const task = queue.then(async () => {
        if (typeof html !== "string" || Buffer.byteLength(html) > 1024 * 1024)
          throw new Error("Report HTML exceeds the limit.");
        const isolated = session.fromPartition(
          `nakama-report-${randomUUID()}`,
          { cache: false },
        );
        isolated.setPermissionCheckHandler(() => false);
        isolated.setPermissionRequestHandler(
          (_webContents, _permission, callback) => callback(false),
        );
        isolated.webRequest.onBeforeRequest((details, callback) =>
          callback({
            cancel:
              !details.url.startsWith("data:") && details.url !== "about:blank",
          }),
        );
        const window = new BrowserWindow({
          show: false,
          width: 900,
          height: 1200,
          webPreferences: {
            session: isolated,
            sandbox: true,
            contextIsolation: true,
            nodeIntegration: false,
            javascript: false,
            webSecurity: true,
            allowRunningInsecureContent: false,
            spellcheck: false,
          },
        });
        windows.add(window);
        window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
        window.webContents.on("will-navigate", (event) =>
          event.preventDefault(),
        );
        let timer;
        try {
          return await Promise.race([
            (async () => {
              await window.loadURL(
                `data:text/html;charset=utf-8,${encodeURIComponent(html)}`,
              );
              return window.webContents.printToPDF({
                printBackground: true,
                pageSize: "A4",
                preferCSSPageSize: true,
                displayHeaderFooter: true,
                headerTemplate: "<span></span>",
                footerTemplate:
                  '<div style="font-family:Arial;font-size:8px;width:100%;padding:0 55px;color:#70808d;display:flex;justify-content:space-between"><span>Nakama - saved project evidence</span><span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>',
                generateTaggedPDF: true,
              });
            })(),
            new Promise((_, reject) => {
              timer = setTimeout(() => {
                if (!window.isDestroyed()) window.destroy();
                reject(new Error("Report rendering timed out."));
              }, 30000);
            }),
          ]);
        } finally {
          clearTimeout(timer);
          windows.delete(window);
          if (!window.isDestroyed()) window.destroy();
          await isolated.clearStorageData();
        }
      });
      queue = task.catch(() => {});
      return task;
    },
    async close() {
      for (const window of windows) if (!window.isDestroyed()) window.destroy();
      await queue;
    },
  };
}
module.exports = { createProjectReportAdapter };
