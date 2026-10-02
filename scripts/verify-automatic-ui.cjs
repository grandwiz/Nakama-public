// Run after npm run build. Real Electron bridge and local role persistence in
// a disposable profile. All inference, account, usage and unrelated requests
// are intercepted; no installed profile or provider credentials are accessed.
const fs = require("node:fs/promises");
const path = require("node:path");
const assert = require("node:assert/strict");
const { pathToFileURL } = require("node:url");
const playwrightPath =
  process.env.NAKAMA_PLAYWRIGHT ||
  require("node:path").join(require("node:os").homedir(), ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright");
const { _electron } = require(playwrightPath);
const { expect } = require(path.join(playwrightPath, "test"));

(async () => {
  const root = path.resolve(__dirname, "..");
  const profile = path.join(root, "tmp", "automatic-ui-" + Date.now());
  const stateFile = path.join(profile, "private", "state.json");
  const { initialState } = await import(
    pathToFileURL(path.join(root, "apps/host/store.mjs")).href
  );
  const state = initialState();
  // An existing saved profile has no flag; the UI must still default it on.
  delete state.config.fastReplies;
  state.config.workspaceRoot = path.join(profile, "projects");
  const project = {
    id: "automatic-ui-project",
    name: "Automatic UI fixture",
    description: "Disposable interface test project.",
    path: path.join(state.config.workspaceRoot, "automatic-ui-project"),
    updatedAt: new Date().toISOString(),
    status: "ready",
  };
  state.projects.push(project);
  for (const provider of state.providers) {
    provider.status = "connected";
    provider.detail = "Disposable UI fixture; no real provider request.";
  }
  await fs.mkdir(path.dirname(stateFile), { recursive: true });
  await fs.mkdir(project.path, { recursive: true });
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
    console.error("Automatic assistant fixture exceeded its deadline.");
    app.process().kill();
  }, 150000);
  const screenshots = [];
  try {
    const page = await app.firstWindow();
    page.setDefaultTimeout(10000);
    const errors = [];
    const dialogs = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("dialog", (dialog) => {
      dialogs.push({ type: dialog.type(), message: dialog.message() });
      void dialog.dismiss().catch(() => {});
    });
    const nav = page.getByRole("navigation", { name: "Main navigation" });
    await nav.waitFor();
    await app.evaluate(({ BrowserWindow, ipcMain }) => {
      const original = ipcMain._invokeHandlers?.get("nakama:api");
      if (typeof original !== "function")
        throw new Error("Fixture API interceptor unavailable.");
      const data = {
        writes: [],
        chats: [],
        usageReads: 0,
        failUsage: false,
        blocked: [],
      };
      globalThis.__nakamaAutomaticFixture = data;
      ipcMain.removeHandler("nakama:api");
      ipcMain.handle("nakama:api", (event, method, route, body) => {
        if (method === "GET" && route === "/api/state")
          return original(event, method, route, body);
        if (
          method === "PATCH" &&
          route === "/api/settings" &&
          Object.keys(body || {})
            .sort()
            .join() === "aiRoles,fastReplies,interactionRole,projectTeam" &&
          typeof body.fastReplies === "boolean"
        ) {
          data.writes.push(structuredClone(body));
          return original(event, method, route, body);
        }
        if (method === "POST" && route === "/api/chat") {
          data.chats.push(structuredClone(body));
          return {
            routing: { reason: "Fixture accepted the requested route." },
          };
        }
        if (method === "GET" && route === "/api/providers/usage") {
          data.usageReads++;
          if (data.failUsage)
            throw new Error("Simulated usage refresh failure.");
          const checkedAt = new Date().toISOString();
          return {
            checkedAt,
            providers: [
              {
                id: "codex",
                name: "ChatGPT / Codex",
                status: "available",
                windows: [
                  {
                    label: "Codex · 5-hour allowance",
                    usedPercent: 37,
                    remainingPercent: 63,
                    resetsAt: new Date(Date.now() + 7200000).toISOString(),
                  },
                  {
                    label: "Codex · Weekly allowance",
                    usedPercent: 50,
                    remainingPercent: 50,
                    resetsAt: null,
                  },
                ],
                checkedAt,
                detail:
                  "Simulated account snapshot for interface verification only.",
                source: "https://learn.chatgpt.com/docs/app-server",
              },
              {
                id: "claude",
                name: "Claude",
                status: "unavailable",
                windows: [],
                checkedAt: null,
                detail:
                  "Nakama cannot import Claude subscription percentages yet. Type /usage in Claude Code.",
                source:
                  "https://support.claude.com/en/articles/14553413-claude-code-cheatsheet",
              },
            ],
          };
        }
        data.blocked.push({ method, route });
        throw new Error(
          "Unexpected request blocked in automatic fixture: " + route,
        );
      });
      const window = BrowserWindow.getAllWindows()[0];
      window.webContents.setBackgroundThrottling(false);
      window.setSize(1440, 1000);
    });
    const capture = async (filename) => {
      await page.evaluate(
        () =>
          new Promise((resolve) => {
            requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
          }),
      );
      const png = await app.evaluate(async ({ BrowserWindow }) => {
        let timer;
        try {
          const image = await Promise.race([
            (async () => {
              const contents = BrowserWindow.getAllWindows()[0].webContents;
              // Windows can initially return the preceding composited frame.
              await contents.capturePage();
              return contents.capturePage();
            })(),
            new Promise((_, reject) => {
              timer = setTimeout(
                () => reject(new Error("Native capture timed out.")),
                15000,
              );
            }),
          ]);
          if (image.isEmpty()) throw new Error("Empty native screenshot.");
          return image.toPNG().toString("base64");
        } finally {
          clearTimeout(timer);
        }
      });
      await fs.mkdir(path.join(root, "output"), { recursive: true });
      await fs.writeFile(
        path.join(root, "output", filename),
        Buffer.from(png, "base64"),
      );
      screenshots.push("output/" + filename);
    };
    const fixture = () =>
      app.evaluate(() => globalThis.__nakamaAutomaticFixture);
    const savedRoles = async () =>
      JSON.parse(await fs.readFile(stateFile, "utf8")).config.aiRoles;
    const savedFastReplies = async () =>
      JSON.parse(await fs.readFile(stateFile, "utf8")).config.fastReplies;
    const message = page.getByRole("textbox", {
      name: "Message Nakama",
      exact: true,
    });
    const manual = page.getByRole("checkbox", {
      name: "Override AI for this chat",
      exact: true,
    });
    const send = async (text, count) => {
      await message.fill(text);
      await page.getByRole("button", { name: "Send", exact: true }).click();
      await expect.poll(async () => (await fixture()).chats.length).toBe(count);
      await expect(message).toHaveValue("");
      return (await fixture()).chats.at(-1);
    };

    await nav.getByRole("button", { name: "Assistant", exact: true }).click();
    console.log("Checking automatic and manual chat payloads.");
    await expect(manual).not.toBeChecked();
    await expect(
      page.getByRole("combobox", { name: "Primary assistant", exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("combobox", { name: "Model", exact: true }),
    ).toHaveCount(0);
    await expect(page.locator(".ai-role-summary")).toContainText(
      "ChatGPT · Astra 6 · Ultra",
    );
    await expect(page.locator(".ai-role-summary")).toContainText(
      "Claude · Opus 4.8 · Ultra",
    );
    assert.deepEqual(await send("Help me organise my ideas.", 1), {
      message: "Help me organise my ideas.",
      projectId: undefined,
      routing: "auto",
    });
    await page
      .getByRole("combobox", { name: "Conversation project", exact: true })
      .selectOption(project.id);
    const overrideText = "Plan using Claude: a simple private notes app.";
    assert.deepEqual(await send(overrideText, 2), {
      message: overrideText,
      projectId: project.id,
      routing: "auto",
    });
    await manual.check();
    const primary = page.getByRole("combobox", {
      name: "Primary assistant",
      exact: true,
    });
    await primary.selectOption("claude");
    const model = page.getByRole("combobox", { name: "Model", exact: true });
    await model.selectOption("claude-opus-4-8");
    await page
      .getByRole("combobox", { name: /^Thinking effort/ })
      .selectOption("max");
    await page
      .getByRole("combobox", { name: /^Working mode/ })
      .selectOption("build");
    assert.deepEqual(await send("Implement this small fixture.", 3), {
      message: "Implement this small fixture.",
      projectId: project.id,
      providerId: "claude",
      model: "claude-opus-4-8",
      effort: "max",
      mode: "build",
      team: undefined,
    });
    await manual.uncheck();
    const automatic = await send("Review the project plan.", 4);
    assert.deepEqual(automatic, {
      message: "Review the project plan.",
      projectId: project.id,
      routing: "auto",
    });
    for (const key of ["providerId", "model", "effort", "mode", "team"])
      assert.equal(
        Object.hasOwn(automatic, key),
        false,
        `Automatic request leaked ${key}.`,
      );

    await nav.getByRole("button", { name: "Settings", exact: true }).click();
    console.log("Checking saved role defaults and overrides.");
    const planner = page.getByRole("combobox", {
      name: "AI for planning & design",
      exact: true,
    });
    const developer = page.getByRole("combobox", {
      name: "AI for development",
      exact: true,
    });
    const chat = page.getByRole("combobox", {
      name: "AI for detailed conversation",
      exact: true,
    });
    const fastReplies = page.getByRole("checkbox", {
      name: /^Faster everyday replies/,
    });
    await expect(fastReplies).toBeChecked();
    await expect(planner).toHaveValue("codex");
    await expect(developer).toHaveValue("claude");
    await expect(chat).toHaveValue("codex");
    const roles = await savedRoles();
    assert.deepEqual(roles.chat, {
      providerId: "codex",
      model: "gpt-6-astra",
      effort: "ultra",
    });
    assert.deepEqual(roles.development, {
      providerId: "claude",
      model: "claude-opus-4-8",
      effort: "ultracode",
    });
    await fastReplies.uncheck();
    await page.evaluate(() => {
      window.__fixtureConfirms = [];
      window.confirm = (message) => {
        window.__fixtureConfirms.push(message);
        return false;
      };
    });
    await nav.getByRole("button", { name: "Assistant", exact: true }).click();
    await expect(planner).toBeVisible();
    assert.deepEqual(await page.evaluate(() => window.__fixtureConfirms), [
      "Discard your unsaved AI role settings?",
    ]);
    await expect(fastReplies).not.toBeChecked();
    await planner.selectOption("claude");
    await page
      .getByRole("button", { name: "Save AI roles", exact: true })
      .click();
    await expect
      .poll(async () => (await savedRoles()).planning.providerId)
      .toBe("claude");
    assert.deepEqual((await savedRoles()).planning, {
      providerId: "claude",
      model: "claude-opus-4-8",
      effort: "max",
    });
    assert.equal(await savedFastReplies(), false);
    assert.equal((await fixture()).writes[0].fastReplies, false);
    await expect(
      page.getByRole("button", { name: "Save AI roles", exact: true }),
    ).toBeDisabled();
    await expect(
      page
        .getByRole("button", { name: "Save AI roles", exact: true })
        .locator(".spin"),
    ).toHaveCount(0);
    await page.reload({ timeout: 30000, waitUntil: "domcontentloaded" });
    console.log("Reloading saved AI roles.");
    await nav.waitFor();
    await nav.getByRole("button", { name: "Settings", exact: true }).click();
    await expect(planner).toHaveValue("claude");
    await expect(fastReplies).not.toBeChecked();
    await page
      .getByRole("button", { name: "Restore suggested roles", exact: true })
      .click();
    await expect(fastReplies).toBeChecked();
    await page
      .getByRole("button", { name: "Save AI roles", exact: true })
      .click();
    await expect
      .poll(async () => (await savedRoles()).planning.providerId)
      .toBe("codex");
    assert.equal(await savedFastReplies(), true);
    assert.equal((await fixture()).writes[1].fastReplies, true);
    await expect(
      page
        .getByRole("button", { name: "Save AI roles", exact: true })
        .locator(".spin"),
    ).toHaveCount(0);
    await page
      .locator("#ai-roles")
      .getByRole("heading", { name: "AI roles", exact: true })
      .scrollIntoViewIfNeeded();
    await capture("automatic-ai-roles.png");
    console.log("Checking usage snapshots and unavailable allowances.");

    await nav.getByRole("button", { name: "AI usage", exact: true }).click();
    assert.equal(
      (await fixture()).usageReads,
      0,
      "Opening the page must not query accounts.",
    );
    await expect(
      page.getByText("No snapshot yet", { exact: true }),
    ).toHaveCount(2);
    await page
      .getByRole("button", { name: "Check usage", exact: true })
      .click();
    await expect.poll(async () => (await fixture()).usageReads).toBe(1);
    const usageCard = (name) =>
      page
        .locator(".usage-card")
        .filter({ has: page.getByRole("heading", { name, exact: true }) });
    const codexCard = usageCard("ChatGPT / Codex");
    await expect(codexCard.getByText("63%", { exact: true })).toBeVisible();
    await expect(codexCard.getByText("50%", { exact: true })).toBeVisible();
    await expect(codexCard.getByRole("progressbar").first()).toHaveAttribute(
      "value",
      "63",
    );
    await expect(
      codexCard.getByText("Reset time unavailable", { exact: true }),
    ).toBeVisible();
    for (const name of ["Claude"]) {
      const card = usageCard(name);
      await expect(card.getByRole("progressbar")).toHaveCount(0);
      await expect(
        card.getByText("Remaining usage unavailable", { exact: true }),
      ).toBeVisible();
      await expect(card).not.toContainText("100%");
    }
    await capture("ai-usage-preview.png");
    await app.evaluate(() => {
      globalThis.__nakamaAutomaticFixture.failUsage = true;
    });
    await page
      .getByRole("button", { name: "Refresh usage", exact: true })
      .click();
    await expect(page.locator(".usage-panel").getByRole("alert")).toContainText(
      "The previous snapshot remains below.",
    );
    await expect(codexCard.getByText("63%", { exact: true })).toBeVisible();
    const result = await fixture();
    assert.equal(result.usageReads, 2);
    assert.equal(result.chats.length, 4);
    assert.equal(result.writes.length, 2);
    assert.deepEqual(result.blocked, []);
    assert.deepEqual(errors, []);
    assert.deepEqual(dialogs, []);
    console.log(
      JSON.stringify(
        {
          passed: true,
          checks: [
            "Automatic chat hides model selectors and sends only text, project and routing:auto",
            "Natural-language provider overrides are forwarded unchanged",
            "Manual override retains explicit provider, model, effort and working mode",
            "Switching back to automatic removes every manual routing field",
            "Default Astra 6 Ultra, Fable 5.1 peer and Opus 4.8 Ultracode request, saved override, reload and restore",
            "Faster everyday replies defaults on for existing profiles; disabling survives save and reload, restore enables it",
            "Unsaved faster-reply navigation guard retains changes when dismissed",
            "Usage is explicitly requested; available percentages and unknown providers are distinct",
            "Failed refresh retains the previous snapshot with an explicit notice",
            "No renderer errors or unexpected routes",
          ],
          profile,
          screenshots,
          realAccountRequests: 0,
          realInferenceCalls: 0,
        },
        null,
        2,
      ),
    );
  } finally {
    clearTimeout(deadline);
    await app
      .evaluate(({ BrowserWindow }) => {
        for (const window of BrowserWindow.getAllWindows()) window.destroy();
      })
      .catch(() => {});
    await app.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
