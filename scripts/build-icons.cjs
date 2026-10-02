// Deterministic SVG -> PNG/ICO build, using the installed Electron renderer.
const { app, BrowserWindow } = require("electron");
const fs = require("node:fs/promises");
const path = require("node:path");
app
  .whenReady()
  .then(async () => {
    const dir = path.resolve(__dirname, "../apps/desktop/assets");
    const window = new BrowserWindow({
      width: 256,
      height: 256,
      show: false,
      transparent: true,
      frame: false,
      webPreferences: { sandbox: true },
    });
    const svg = await fs.readFile(path.join(dir, "mascot.svg"), "utf8");
    await window.loadURL(
      "data:text/html;charset=utf-8," +
        encodeURIComponent(
          `<style>html,body{margin:0;background:transparent}</style>${svg}`,
        ),
    );
    const image = await window.webContents.capturePage();
    await fs.writeFile(path.join(dir, "icon.png"), image.toPNG());
    const sizes = [16, 24, 32, 48, 64, 128, 256],
      images = sizes.map((size) =>
        image.resize({ width: size, height: size, quality: "best" }).toPNG(),
      );
    const header = Buffer.alloc(6 + 16 * sizes.length);
    header.writeUInt16LE(1, 2);
    header.writeUInt16LE(sizes.length, 4);
    let offset = header.length;
    sizes.forEach((size, i) => {
      const p = 6 + 16 * i;
      header[p] = size === 256 ? 0 : size;
      header[p + 1] = header[p];
      header.writeUInt16LE(1, p + 4);
      header.writeUInt16LE(32, p + 6);
      header.writeUInt32LE(images[i].length, p + 8);
      header.writeUInt32LE(offset, p + 12);
      offset += images[i].length;
    });
    await fs.writeFile(
      path.join(dir, "icon.ico"),
      Buffer.concat([header, ...images]),
    );
    window.destroy();
    app.quit();
  })
  .catch((error) => {
    console.error(error.message);
    app.exit(1);
  });
