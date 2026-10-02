// Run after npm run build. Native Electron regression with a disposable profile.
// Only local state reads and provider preference writes reach the real host.
// Provider probes, model discovery, inference and all other mutations are blocked.
// No saved account credentials or installed-app state are read or modified.
const fs = require("node:fs/promises");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const assert = require("node:assert/strict");
const playwrightPath =
  process.env.NAKAMA_PLAYWRIGHT ||
  require("node:path").join(require("node:os").homedir(), ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright");
const { _electron } = require(playwrightPath);
const { expect } = require(path.join(playwrightPath, "test"));

(async () => {
  const root = path.resolve(__dirname, "..");
  const profile = path.join(root, "tmp", "claude-model-ui-" + Date.now());
  const stateFile = path.join(profile, "private", "state.json");
  const { initialState } = await import(
    pathToFileURL(path.join(root, "apps/host/store.mjs")).href
  );
  const { argumentsFor } = await import(
    pathToFileURL(path.join(root, "apps/host/providers.mjs")).href
  );
  const state = initialState();
  state.config.workspaceRoot = path.join(profile, "projects");
  const claude = state.providers.find((provider) => provider.id === "claude");
  claude.selectedModel = "opus";
  claude.status = "connected";
  claude.detail = "Disposable UI fixture. No account or model request is made.";
  await fs.mkdir(path.dirname(stateFile), { recursive: true });
  await fs.mkdir(state.config.workspaceRoot);
  await fs.writeFile(stateFile, JSON.stringify(state));
  const env = {
    ...process.env,
    NAKAMA_SMOKE_TEST: "1",
    NAKAMA_TEST_DATA_DIR: profile,
  };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await _electron.launch({
    executablePath: path.join(root, "node_modules/electron/dist/electron.exe"),
    args: [root],
    env,
    timeout: 30000,
  });
  const deadline = setTimeout(() => {
    console.error("Claude model selection fixture exceeded its deadline.");
    app.process().kill();
  }, 150000);
  try {
    const page = await app.firstWindow();
    page.setDefaultTimeout(10000);
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.getByRole("navigation", { name: "Main navigation" }).waitFor();
    await app.evaluate(({ BrowserWindow, ipcMain }) => {
      const original = ipcMain._invokeHandlers?.get("nakama:api");
      if (typeof original !== "function")
        throw new Error("Fixture API interceptor unavailable.");
      const data = { writes: [], blocked: [] };
      globalThis.__nakamaClaudeModelFixture = data;
      ipcMain.removeHandler("nakama:api");
      ipcMain.handle("nakama:api", (event, method, route, body) => {
        if (method === "GET" && route === "/api/state")
          return original(event, method, route, body);
        if (method === "GET" && route === "/api/kling/status")
          return {
            installed: false,
            enabled: false,
            mcpConfigured: false,
            detail: "UI fixture only.",
          };
        if (method === "GET" && route === "/api/kling/jobs")
          return { jobs: [] };
        if (
          method === "POST" &&
          /^\/api\/providers\/(claude|codex)\/settings$/.test(route) &&
          Object.keys(body || {}).every((key) =>
            ["selectedModel", "effort", "connectionType"].includes(key),
          )
        ) {
          data.writes.push({ route, body: structuredClone(body) });
          return original(event, method, route, body);
        }
        data.blocked.push({ method, route });
        throw new Error(
          "Unexpected request blocked in model fixture: " + route,
        );
      });
      BrowserWindow.getAllWindows()[0].webContents.setBackgroundThrottling(
        false,
      );
    });
    const nav = page.getByRole("navigation", { name: "Main navigation" });
    const openAgents = () =>
      nav.getByRole("button", { name: "AI team", exact: true }).click();
    const card = (name) =>
      page.locator(".agent-card").filter({
        has: page.getByRole("heading", { name, exact: true }),
      });
    const claudeCard = card("Claude");
    const preferred = claudeCard.getByLabel("Preferred model", { exact: true });
    const saved = async (id = "claude") =>
      JSON.parse(await fs.readFile(stateFile, "utf8")).providers.find(
        (provider) => provider.id === id,
      );
    const saveClaude = async (expected) => {
      await claudeCard
        .getByRole("button", { name: "Save preferences", exact: true })
        .click();
      await expect
        .poll(async () => (await saved()).selectedModel)
        .toBe(expected);
      const args = argumentsFor(await saved());
      if (expected) {
        assert.equal(args[args.indexOf("--model") + 1], expected);
        assert.equal(args.filter((arg) => arg === "--model").length, 1);
      } else assert.equal(args.includes("--model"), false);
    };
    const reloadAgents = async () => {
      await page.reload();
      await nav.waitFor();
      await openAgents();
    };

    await openAgents();
    await expect(preferred).toHaveValue("opus");
    await expect(preferred).toHaveJSProperty("tagName", "SELECT");
    for (const id of ["claude-opus-5", "claude-opus-4-8", "claude-opus-5-5"]) {
      await preferred.selectOption(id);
      await saveClaude(id);
      await reloadAgents();
      await expect(preferred).toHaveValue(id);
    }
    await claudeCard.scrollIntoViewIfNeeded();
    await fs.mkdir(path.join(root, "output"), { recursive: true });
    const screenshot = await app.evaluate(async ({ BrowserWindow }) => {
      const image =
        await BrowserWindow.getAllWindows()[0].webContents.capturePage();
      if (image.isEmpty()) throw new Error("Empty model selector screenshot.");
      return image.toPNG().toString("base64");
    });
    await fs.writeFile(
      path.join(root, "output", "claude-model-selection.png"),
      Buffer.from(screenshot, "base64"),
    );

    await preferred.selectOption("__custom__");
    const exact = claudeCard.getByLabel("Exact model ID", { exact: true });
    await exact.fill("claude-opus-fixture-20260929");
    await saveClaude("claude-opus-fixture-20260929");
    await reloadAgents();
    await expect(preferred).toHaveValue("__custom__");
    await expect(exact).toHaveValue("claude-opus-fixture-20260929");
    await preferred.selectOption("");
    await saveClaude("");
    await reloadAgents();
    await expect(preferred).toHaveValue("");
    await expect(exact).toHaveCount(0);
    await preferred.selectOption("opus");
    await saveClaude("opus");
    await reloadAgents();
    await expect(preferred).toHaveValue("opus");

    const codexCard = card("ChatGPT / Codex");
    const codexModel = codexCard.getByLabel("Preferred model", { exact: true });
    await expect(codexModel).toHaveJSProperty("tagName", "INPUT");
    await codexModel.fill("codex-fixture-exact-version");
    await codexCard
      .getByRole("button", { name: "Save preferences", exact: true })
      .click();
    await expect
      .poll(async () => (await saved("codex")).selectedModel)
      .toBe("codex-fixture-exact-version");
    await reloadAgents();
    await expect(codexModel).toHaveValue("codex-fixture-exact-version");

    await nav.getByRole("button", { name: "Assistant", exact: true }).click();
    await page
      .getByRole("checkbox", { name: "Override AI for this chat" })
      .check();
    const primary = page.getByRole("combobox", {
      name: "Primary assistant",
      exact: true,
    });
    await primary.selectOption("claude");
    const model = page.getByLabel("Model", { exact: true });
    await expect(model).toHaveValue("opus");
    await model.selectOption("claude-opus-5-5");
    await expect(model).toHaveValue("claude-opus-5-5");
    assert.equal(
      (await saved()).selectedModel,
      "opus",
      "Task-only choice must not overwrite preferences.",
    );
    await model.selectOption("");
    await expect(model).toHaveValue("");
    const team = page.getByRole("checkbox", { name: /^Claude\b/ });
    await team.check();
    await expect(model).toBeDisabled();
    await team.uncheck();
    await expect(model).toBeEnabled();
    await primary.selectOption("codex");
    await expect(model).toHaveJSProperty("tagName", "INPUT");
    await expect(model).toHaveValue("codex-fixture-exact-version");
    const calls = await app.evaluate(
      () => globalThis.__nakamaClaudeModelFixture,
    );
    assert.deepEqual(calls.blocked, []);
    assert.ok(calls.writes.length >= 7);
    assert.deepEqual(errors, []);
    console.log(
      JSON.stringify(
        {
          passed: true,
          checks: [
            "Existing opus alias remains selected",
            "Opus 5, 5.5 and 4.8 persist after reload and reach --model unchanged",
            "Custom exact model IDs survive reload",
            "Account default removes --model",
            "Codex free-text model selection is unchanged",
            "Assistant model choice is separate from saved preferences",
            "Parallel teams disable the per-task model override",
            "No renderer exceptions or unexpected requests",
          ],
          profile,
          screenshot: "output/claude-model-selection.png",
          realAccountRequests: 0,
          realInferenceCalls: 0,
        },
        null,
        2,
      ),
    );
  } finally {
    clearTimeout(deadline);
    await app.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
