// Run after npm run build. All data and files use a disposable local fixture.
const fs = require("node:fs/promises");
const path = require("node:path");
const assert = require("node:assert/strict");
const playwrightPath =
  process.env.NAKAMA_PLAYWRIGHT ||
  require("node:path").join(require("node:os").homedir(), ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright");
const { _electron } = require(playwrightPath);

(async () => {
  const root = path.resolve(__dirname, "..");
  const testRoot = path.join(root, "tmp", `electron-${Date.now()}`);
  const projects = path.join(testRoot, "projects");
  await fs.mkdir(projects, { recursive: true });
  await fs.mkdir(path.join(root, "output"), { recursive: true });
  const env = {
    ...process.env,
    NAKAMA_SMOKE_TEST: "1",
    NAKAMA_TEST_DATA_DIR: path.join(testRoot, "profile"),
  };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await _electron.launch({
    executablePath: path.join(root, "node_modules/electron/dist/electron.exe"),
    args: [root],
    env,
    timeout: 30000,
  });
  try {
    const page = await app.firstWindow();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.waitForSelector("body");
    const result = await page.evaluate(async (folder) => {
      if (!window.nakama) throw new Error("Native preload bridge missing.");
      await window.nakama.api("PATCH", "/api/settings", {
        workspaceRoot: folder,
      });
      const project = await window.nakama.api("POST", "/api/projects", {
        name: "Desktop integration fixture",
        description: "Disposable native IPC test",
      });
      await window.nakama.api("PUT", `/api/projects/${project.id}/file`, {
        path: "test.txt",
        content: "native bridge works",
      });
      const file = await window.nakama.api(
        "GET",
        `/api/projects/${project.id}/file?path=test.txt`,
      );
      const ticket = await window.nakama.api("POST", "/api/pairing/tickets", {
        platform: "android",
      });
      const deletion = await window.nakama.api(
        "POST",
        `/api/projects/${project.id}/delete-request`,
      );
      await window.nakama.api("POST", `/api/approvals/${deletion.id}/resolve`, {
        approved: false,
      });
      return {
        projectId: project.id,
        content: file.content,
        fingerprint: ticket.fingerprint,
        projects: (await window.nakama.api("GET", "/api/state")).projects
          .length,
      };
    }, projects);
    assert.equal(result.content, "native bridge works");
    assert.equal(result.projects, 1);
    assert.match(result.fingerprint, /^(?:[0-9A-F]{2}:){31}[0-9A-F]{2}$/);
    await page.reload();
    const nav = page.getByRole("navigation", { name: "Main navigation" });
    await nav.getByRole("button", { name: "Projects", exact: true }).click();
    await page
      .getByRole("button", {
        name: /Desktop integration fixture Disposable native IPC test/,
      })
      .click();
    await page.getByRole("button", { name: "test.txt", exact: true }).click();
    const editor = page.getByRole("textbox", {
      name: "Edit test.txt",
      exact: true,
    });
    assert.equal(await editor.inputValue(), "native bridge works");
    await editor.fill("saved through the native file editor");
    await page.getByRole("button", { name: "Save file", exact: true }).click();
    await page.getByText("1 lines · Saved", { exact: true }).waitFor();
    const saved = await page.evaluate(
      async (id) =>
        window.nakama.api("GET", `/api/projects/${id}/file?path=test.txt`),
      result.projectId,
    );
    assert.equal(saved.content, "saved through the native file editor");
    await page
      .getByRole("button", { name: "Open assistant", exact: true })
      .click();
    assert.equal(
      await page
        .getByRole("combobox", { name: "Conversation project" })
        .inputValue(),
      result.projectId,
    );
    await page
      .getByRole("combobox", { name: /Working mode/ })
      .selectOption("build");
    assert.equal(
      await page.getByRole("combobox", { name: /Working mode/ }).inputValue(),
      "build",
    );

    await nav.getByRole("button", { name: "Devices", exact: true }).click();
    await page
      .getByRole("button", { name: "Pair a device", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Create pairing ticket", exact: true })
      .click();
    const payload = await page
      .getByRole("textbox", { name: /Pairing information/ })
      .inputValue();
    const parsed = JSON.parse(payload);
    assert.ok(parsed.ticket && parsed.fingerprint && parsed.expiresAt);
    if (process.env.NAKAMA_TEST_CLIPBOARD === "1") {
      console.warn(
        "Opt-in clipboard test: temporarily replaces the Windows clipboard. Do not copy anything while it runs.",
      );
      // Keep existing clipboard contents in Electron's memory, never logs or files.
      // The desktop denies clipboard web permissions, so this exercises the Copy
      // button through its native IPC implementation and restores all read items.
      await app.evaluate(async ({ clipboard, ClipboardItem }) => {
        const items = await clipboard.read();
        globalThis.__nakamaClipboardBackup = await Promise.all(
          items.map(async (item) => {
            const entries = await Promise.all(
              item.types.map(async (type) => [type, await item.getType(type)]),
            );
            return new ClipboardItem(Object.fromEntries(entries));
          }),
        );
        // Check the restoration API before changing clipboard contents.
        if (globalThis.__nakamaClipboardBackup.length)
          await clipboard.write(globalThis.__nakamaClipboardBackup);
      });
      try {
        await page
          .getByRole("button", {
            name: "Copy pairing information",
            exact: true,
          })
          .click();
        await page
          .getByText("Pairing information copied. Keep it private.", {
            exact: true,
          })
          .waitFor();
        const copied = await app.evaluate(({ clipboard }) =>
          clipboard.readText(),
        );
        assert.ok(
          copied === payload,
          "Native Copy did not copy the displayed pairing ticket.",
        );
      } finally {
        await app.evaluate(async ({ clipboard }) => {
          if (globalThis.__nakamaClipboardBackup.length) {
            await clipboard.write(globalThis.__nakamaClipboardBackup);
          } else {
            clipboard.clear();
          }
          delete globalThis.__nakamaClipboardBackup;
        });
      }
    }
    await page.getByRole("button", { name: "Done", exact: true }).click();
    await nav.getByRole("button", { name: "Settings", exact: true }).click();
    assert.equal(
      await page
        .getByRole("checkbox", { name: /Keep running when I close the window/ })
        .isChecked(),
      true,
    );
    assert.equal(
      await page
        .getByRole("checkbox", { name: /Start with Windows/ })
        .isChecked(),
      false,
    );
    assert.equal(
      await page
        .getByRole("checkbox", { name: /Allow configured paid APIs/ })
        .isChecked(),
      false,
    );
    await nav.getByRole("button", { name: "Overview", exact: true }).click();
    await page.screenshot({
      path: path.join(root, "output", "desktop-native-smoke.png"),
      fullPage: true,
    });
    assert.equal(errors.length, 0, errors.join("\n"));
    console.log(
      JSON.stringify({
        passed: true,
        checks: [
          "native preload IPC",
          "workspace setup",
          "project creation",
          "file round trip",
          "HTTPS identity",
          "reject deletion preserves project",
          "native editor save",
          "assistant project and build mode",
          "pair ticket creation through UI",
          process.env.NAKAMA_TEST_CLIPBOARD === "1"
            ? "native Copy button (opt-in)"
            : "clipboard mutation skipped (default)",
          "tray and startup defaults",
          "paid APIs disabled",
          "renderer screenshot",
        ],
        ...result,
        testRoot,
      }),
    );
  } finally {
    await app.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
