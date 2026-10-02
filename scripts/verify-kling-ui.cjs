// Native UI fixture. Uses a disposable profile, simulated Kling data and
// intercepted clipboard/external links. No account, inference or paid call runs.
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
  const profile = path.join(root, "tmp", "kling-ui-" + Date.now());
  const { initialState } = await import(
    pathToFileURL(path.join(root, "apps/host/store.mjs")).href
  );
  const state = initialState();
  state.config.workspaceRoot = path.join(profile, "projects");
  await fs.mkdir(path.join(profile, "private"), { recursive: true });
  await fs.mkdir(state.config.workspaceRoot);
  await fs.writeFile(
    path.join(profile, "private", "state.json"),
    JSON.stringify(state),
  );
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
  const deadline = setTimeout(() => app.process().kill(), 150000);
  try {
    const page = await app.firstWindow();
    page.setDefaultTimeout(12000);
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const nav = page.getByRole("navigation", { name: "Main navigation" });
    await nav.waitFor();
    await app.evaluate(({ BrowserWindow, ipcMain }) => {
      const original = ipcMain._invokeHandlers.get("nakama:api");
      const data = {
        enabled: false,
        mcpConfigured: false,
        balance: null,
        failModels: false,
        calls: [],
        jobs: [],
        copies: [],
        external: [],
        blocked: [],
      };
      globalThis.__nakamaKlingFixture = data;
      const status = () => ({
        installed: true,
        enabled: data.enabled,
        mcpConfigured: data.mcpConfigured,
        detail: "Simulated CLI setup. No real provider connection.",
      });
      ipcMain.removeHandler("nakama:api");
      ipcMain.handle("nakama:api", (event, method, route, body) => {
        if (method === "GET" && route === "/api/state")
          return original(event, method, route, body);
        data.calls.push({ method, route, body });
        if (method === "GET" && route === "/api/kling/status") return status();
        if (method === "GET" && route === "/api/kling/jobs")
          return { jobs: structuredClone(data.jobs) };
        if (method === "GET" && route === "/api/kling/catalogue") {
          if (data.failModels)
            throw new Error("Simulated catalogue unavailable.");
          return {
            models: [
              {
                id: "fixture-video-v1",
                name: "Kling fixture video",
                parameters: {
                  type: "object",
                  properties: {
                    duration: {
                      type: "integer",
                      title: "Duration",
                      enum: [5, 10],
                    },
                    sound: { type: "boolean", title: "Sound" },
                    extra: { type: "object", title: "Advanced fixture" },
                  },
                  required: ["duration"],
                },
              },
            ],
            detail:
              "Simulated live catalogue. These are test-only model names.",
          };
        }
        if (method === "GET" && route === "/api/kling/account")
          return {
            credits: data.balance,
            detail:
              data.balance == null
                ? "Simulated balance unavailable; this is not zero credits."
                : "Simulated available credits.",
          };
        if (method === "POST" && route === "/api/kling/settings") {
          data.enabled = body.enabled;
          return status();
        }
        if (method === "POST" && route === "/api/kling/prepare") {
          const job = {
            id: "fixture-job",
            createdAt: new Date().toISOString(),
            status: "awaiting_approval",
            request: structuredClone(body),
            approvalId: "fixture-approval",
            results: [],
          };
          data.jobs.push(job);
          return {
            job: structuredClone(job),
            approval: { id: job.approvalId },
          };
        }
        if (method === "POST" && route === "/api/kling/jobs/fixture-job/poll")
          return structuredClone(data.jobs[0]);
        if (method === "POST" && route === "/api/kling/mcp-config") {
          data.mcpConfigured = true;
          return {
            config: {
              mcpServers: {
                kling: {
                  command: "fixture-command",
                  args: [],
                  env: { NAKAMA_MCP_TOKEN: "fixture-token-not-real" },
                },
              },
            },
            detail: "Fixture configuration only.",
          };
        }
        if (method === "DELETE" && route === "/api/kling/mcp-config") {
          data.mcpConfigured = false;
          return { revoked: true };
        }
        data.blocked.push({ method, route });
        throw new Error("Unexpected UI fixture request " + route);
      });
      ipcMain.removeHandler("nakama:copy-text");
      ipcMain.handle("nakama:copy-text", (_event, value) => {
        data.copies.push(value);
      });
      ipcMain.removeHandler("nakama:external");
      ipcMain.handle("nakama:external", (_event, value) => {
        data.external.push(value);
      });
      BrowserWindow.getAllWindows()[0].webContents.setBackgroundThrottling(
        false,
      );
    });
    const fixture = () => app.evaluate(() => globalThis.__nakamaKlingFixture);
    await nav.getByRole("button", { name: "AI team", exact: true }).click();
    await expect(page.locator(".agent-card")).toHaveCount(2);
    await expect(page.locator("body")).not.toContainText("Gemini");
    const studio = page.getByRole("region", { name: "Kling video studio" });
    await expect(
      studio.getByText("CLI runtime ready", { exact: true }),
    ).toBeVisible();
    assert.equal(
      (await fixture()).calls.some((call) =>
        ["/api/kling/catalogue", "/api/kling/account"].includes(call.route),
      ),
      false,
    );
    const prepare = studio.getByRole("button", {
      name: "Prepare video for approval",
      exact: true,
    });
    await expect(prepare).toBeDisabled();
    await studio
      .getByRole("button", { name: "Refresh Kling", exact: true })
      .click();
    await expect(studio.getByLabel("Kling model", { exact: true })).toHaveValue(
      "fixture-video-v1",
    );
    await expect(
      studio.getByText("Credit balance unavailable", { exact: true }),
    ).toBeVisible();
    await expect(prepare).toBeDisabled();
    await studio
      .getByRole("checkbox", { name: "Allow Kling video generation" })
      .click();
    await expect(
      studio.getByRole("checkbox", { name: "Allow Kling video generation" }),
    ).toBeChecked();
    await studio
      .getByLabel("Describe your video", { exact: true })
      .fill("A blue companion walking through a calm studio.");
    await studio
      .getByRole("combobox", { name: "Duration · required", exact: true })
      .selectOption("5");
    await studio
      .getByRole("combobox", { name: "Sound", exact: true })
      .selectOption("false");
    await studio
      .getByRole("textbox", { name: "Advanced fixture", exact: true })
      .fill("invalid JSON");
    await prepare.click();
    await expect(studio.getByRole("alert")).toContainText("needs valid JSON");
    assert.equal(
      (await fixture()).calls.filter(
        (call) => call.route === "/api/kling/prepare",
      ).length,
      0,
    );
    await studio
      .getByRole("textbox", { name: "Advanced fixture", exact: true })
      .fill('{"fixture":true}');
    await prepare.click();
    await expect(
      studio.getByText("awaiting approval", { exact: true }),
    ).toBeVisible();
    const prepared = (await fixture()).calls.filter(
      (call) => call.route === "/api/kling/prepare",
    );
    assert.equal(prepared.length, 1);
    assert.deepEqual(prepared[0].body, {
      prompt: "A blue companion walking through a calm studio.",
      model: "fixture-video-v1",
      parameters: { duration: 5, sound: false, extra: { fixture: true } },
    });
    assert.equal(
      (await fixture()).calls.some((call) =>
        call.route.includes("/approvals/"),
      ),
      false,
    );
    await app.evaluate(() => {
      const data = globalThis.__nakamaKlingFixture;
      data.jobs[0].status = "completed";
      data.jobs[0].generationId = "fixture-generation";
      data.jobs[0].results = [
        {
          index: 0,
          url: "https://example.com/fixture-video.mp4",
          contentType: "video/mp4",
        },
      ];
      data.balance = 120;
    });
    await nav.getByRole("button", { name: "Assistant", exact: true }).click();
    await nav.getByRole("button", { name: "AI team", exact: true }).click();
    await expect(
      studio.getByRole("button", { name: "Check video status", exact: true }),
    ).toBeVisible();
    await studio
      .getByRole("button", { name: "Check video status", exact: true })
      .click();
    await studio
      .getByRole("button", { name: "Open result 1 · video/mp4" })
      .click();
    assert.deepEqual((await fixture()).external, [
      "https://example.com/fixture-video.mp4",
    ]);
    await studio
      .getByRole("button", { name: "Create MCP configuration", exact: true })
      .click();
    const modal = page.getByRole("dialog");
    await expect(
      modal.getByLabel("MCP configuration", { exact: true }),
    ).toContainText("fixture-token-not-real");
    await modal
      .getByRole("button", { name: "Copy MCP configuration", exact: true })
      .click();
    assert.equal(
      JSON.parse((await fixture()).copies[0]).mcpServers.kling.env
        .NAKAMA_MCP_TOKEN,
      "fixture-token-not-real",
    );
    await modal.getByRole("button", { name: "Done", exact: true }).click();
    await expect(
      studio.getByRole("button", {
        name: "Replace MCP configuration",
        exact: true,
      }),
    ).toBeVisible();
    await studio
      .getByRole("button", { name: "Revoke MCP access", exact: true })
      .click();
    await expect(
      studio.getByRole("button", {
        name: "Create MCP configuration",
        exact: true,
      }),
    ).toBeVisible();
    await studio
      .getByRole("button", { name: "Kling setup", exact: true })
      .click();
    await expect(modal).toContainText("@klingai/cli-global@0.2.0");
    await modal.getByRole("button", { name: "Done", exact: true }).click();
    await studio
      .getByRole("button", { name: "Refresh Kling", exact: true })
      .click();
    await expect(studio.getByText("120", { exact: true })).toBeVisible();
    await studio.scrollIntoViewIfNeeded();
    const screenshot = await app.evaluate(async ({ BrowserWindow }) =>
      (await BrowserWindow.getAllWindows()[0].webContents.capturePage())
        .toPNG()
        .toString("base64"),
    );
    await fs.writeFile(
      path.join(root, "output", "kling-video-studio.png"),
      Buffer.from(screenshot, "base64"),
    );
    await app.evaluate(() => {
      globalThis.__nakamaKlingFixture.failModels = true;
    });
    await studio
      .getByRole("button", { name: "Refresh Kling", exact: true })
      .click();
    await expect(studio.getByRole("alert")).toContainText(
      "Simulated catalogue unavailable",
    );
    await expect(prepare).toBeDisabled();
    await studio
      .getByRole("checkbox", { name: "Allow Kling video generation" })
      .click();
    await expect(
      studio.getByRole("checkbox", { name: "Allow Kling video generation" }),
    ).not.toBeChecked();
    const result = await fixture();
    assert.equal(result.enabled, false);
    assert.deepEqual(result.blocked, []);
    assert.deepEqual(errors, []);
    console.log(
      JSON.stringify(
        {
          passed: true,
          checks: [
            "Two AI cards and no Gemini UI",
            "No remote Kling requests on mount",
            "Disabled generation until explicit enable",
            "Unknown credits remain unknown",
            "Live schema inputs preserve types and reject invalid JSON",
            "Prepare sends exact request and never approves",
            "Existing generation polling and result links",
            "MCP config copy and revoke through intercepted bridge",
            "Pinned CLI setup command",
            "Catalogue refresh failure clears stale choices",
          ],
          profile,
          screenshot: "output/kling-video-studio.png",
          realKlingCalls: 0,
          paidCalls: 0,
          systemClipboardWrites: 0,
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
