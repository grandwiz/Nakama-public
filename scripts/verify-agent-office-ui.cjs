/* Disposable Electron fixture: no provider calls, real accounts, input injection or network actions. */
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
  const profile = path.join(root, "tmp", "agent-office-ui-" + Date.now());
  const { initialState } = await import(
    pathToFileURL(path.join(root, "apps/host/store.mjs")).href
  );
  const state = initialState();
  const stamp = new Date().toISOString();
  state.config.aiRoles.planning.model = "fixture-custom-manager";
  state.config.aiRoles.chat.effort = "high";
  state.projects.push({
    id: "fixture-garden",
    name: "Pocket garden",
    description: "Synthetic UI fixture",
    status: "active",
    path: path.join(profile, "projects", "garden"),
    createdAt: stamp,
    updatedAt: stamp,
  });
  await fs.mkdir(path.join(profile, "private"), { recursive: true });
  await fs.writeFile(
    path.join(profile, "private/state.json"),
    JSON.stringify(state),
  );
  const roleSnapshot = structuredClone(state.config.aiRoles);
  const teamSnapshot = structuredClone(state.config.projectTeam);
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
    console.error("Agent office fixture deadline exceeded.");
    app.process().kill();
  }, 180000);
  const images = [];
  try {
    const page = await app.firstWindow();
    page.setDefaultTimeout(12000);
    const errors = [];
    const dialogs = [];
    let acceptDialog = false;
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("dialog", (dialog) => {
      dialogs.push({ type: dialog.type(), message: dialog.message() });
      const accept = acceptDialog;
      acceptDialog = false;
      void (accept ? dialog.accept() : dialog.dismiss()).catch(() => {});
    });
    await page.getByRole("navigation", { name: "Main navigation" }).waitFor();
    await app.evaluate(({ ipcMain }, stamp) => {
      const original = ipcMain._invokeHandlers.get("nakama:api");
      const base = {
        sourceKind: "task",
        receiptKind: "model_task",
        projectId: "fixture-garden",
        createdAt: stamp,
        updatedAt: stamp,
        model: "claude-opus-4-8",
        requestedEffort: "ultracode",
        effectiveEffort: "xhigh",
      };
      const agents = [
        {
          ...base,
          id: "workflow:garden",
          name: "Momo",
          sourceKind: "workflow",
          receiptKind: "workflow_orchestration",
          providerId: "codex",
          role: "Project manager",
          title: "A pocket garden, one little step at a time",
          status: "running",
          phase: "implementing",
          model: "gpt-6-astra",
          requestedEffort: "ultra",
          effectiveEffort: "ultra",
          summary:
            "Plan agreed. One worker is applying the watering view; the remaining assignments are queued.",
        },
        {
          ...base,
          id: "task:planner",
          name: "Haru",
          parentId: "workflow:garden",
          providerId: "codex",
          role: "Planning",
          title: "Plan the garden companion",
          status: "completed",
          phase: "manager_plan",
          model: "gpt-6-astra",
          summary:
            "The approved plan covers plant cards, watering reminders and local storage.",
        },
        {
          ...base,
          id: "task:peer",
          name: "Yuzu",
          parentId: "workflow:garden",
          providerId: "claude",
          role: "Co-planner",
          title: "Review the garden plan",
          status: "completed",
          phase: "peer_plan",
          model: "claude-fable-5-1",
          output:
            "Synthetic fixture output: agree plant-card accessibility and offline-first storage before implementation.",
        },
        {
          ...base,
          id: "task:worker",
          name: "Sora",
          parentId: "workflow:garden",
          providerId: "claude",
          role: "Development worker",
          title: "Build the watering view",
          status: "running",
          phase: "development",
          output:
            "Synthetic fixture output.\nApplied the watering-view component.\nLocal checks have not finished yet.",
          outputTruncated: true,
        },
        {
          ...base,
          id: "task:queue",
          name: "Kiko",
          parentId: "workflow:garden",
          providerId: "claude",
          role: "Development worker",
          title: "Add accessible plant cards",
          status: "queued",
          phase: "waiting_for_writer",
        },
        {
          ...base,
          id: "task:past",
          name: "Nori",
          providerId: "codex",
          role: "Research",
          title: "Earlier fixture research",
          status: "failed",
          phase: "research",
          model: "gpt-6-astra",
          error: "Fixture account unavailable. No provider was contacted.",
        },
      ];
      const fixture = {
        calls: [],
        blocked: [],
        agents,
        version: 1,
        messages: [
          {
            id: "history-navigation",
            role: "assistant",
            content: "Old navigation receipt must never reopen the office.",
            createdAt: stamp,
            localOutcome: { type: "navigate", target: "agent-office" },
          },
        ],
        nextOutcome: { type: "navigate", target: "agent-office" },
        pause: false,
        release: null,
      };
      globalThis.__officeFixture = fixture;
      ipcMain.removeHandler("nakama:api");
      ipcMain.handle("nakama:api", async (event, method, route, body) => {
        fixture.calls.push({ method, route, body });
        if (method === "GET" && route === "/api/state") {
          const data = await original(event, method, route, body);
          data.agentOffice = {
            version: fixture.version,
            agents: fixture.agents,
          };
          data.messages = [...data.messages, ...fixture.messages];
          data.tasks = fixture.agents
            .filter(
              (item) =>
                item.sourceKind === "task" &&
                ["running", "queued"].includes(item.status),
            )
            .map((item) => ({ ...item, id: item.id.slice(5) }));
          return data;
        }
        if (method === "GET" && route === "/api/actions")
          return { actions: [] };
        if (method === "GET" && route === "/api/kling/status")
          return {
            installed: false,
            enabled: false,
            mcpConfigured: false,
            detail: "Disabled synthetic fixture",
          };
        if (method === "GET" && route === "/api/kling/jobs")
          return { jobs: [] };
        if (
          ["POST", "PATCH"].includes(method) &&
          /^\/api\/companion-memory(?:\/[^/]+)?$/.test(route)
        )
          return original(event, method, route, body);
        if (
          method === "PATCH" &&
          route === "/api/settings" &&
          Object.keys(body).every((key) =>
            [
              "interactionRole",
              "aiRoles",
              "projectTeam",
              "fastReplies",
            ].includes(key),
          )
        )
          return original(event, method, route, body);
        if (method === "POST" && route === "/api/chat") {
          const outcome = fixture.nextOutcome;
          if (fixture.pause)
            await new Promise((resolve) => {
              fixture.release = resolve;
            });
          fixture.messages.push({
            id: `reply-${fixture.calls.length}`,
            role: "assistant",
            content: "Synthetic reply: your other project work continues.",
            createdAt: new Date().toISOString(),
          });
          return {
            local: true,
            taskIds: [],
            reply: "Synthetic reply",
            outcome,
          };
        }
        fixture.blocked.push({ method, route });
        throw new Error("Blocked by isolated Agent office UI fixture.");
      });
    }, stamp);
    await page.reload();
    const nav = page.getByRole("navigation", { name: "Main navigation" });
    const office = () =>
      nav.getByRole("button", { name: "Agent office", exact: true }).click();
    const assistant = () =>
      nav.getByRole("button", { name: "Assistant", exact: true }).click();
    const capture = async (name) => {
      const file = path.join(root, "output", name);
      await page.screenshot({ path: file, fullPage: true });
      images.push(path.relative(root, file));
    };
    const send = async (text) => {
      await page.getByRole("textbox", { name: "Message Nakama" }).fill(text);
      await page.getByRole("button", { name: "Send", exact: true }).click();
    };
    const reply = async (outcome, pause = false) =>
      app.evaluate(
        (_, data) => {
          globalThis.__officeFixture.nextOutcome = data.outcome;
          globalThis.__officeFixture.pause = data.pause;
        },
        { outcome, pause },
      );
    const refresh = async () =>
      app.evaluate(({ BrowserWindow }) => {
        BrowserWindow.getAllWindows()[0].webContents.send("nakama:event", {
          type: "fixture",
        });
      });
    await assistant();
    await expect(
      page.getByText("Old navigation receipt must never reopen the office.", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Talk to Nakama", exact: true }),
    ).toBeVisible();
    await office();
    await expect(page.locator(".office-desk")).toHaveCount(3);
    await expect(
      page.getByText("1 model task running", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("list", { name: "Assignments under Momo" }),
    ).toBeVisible();
    await expect(page.locator(".office-green")).toHaveCount(1);
    await expect(page.locator(".office-orange")).toHaveCount(2);
    console.log("Office hierarchy verified.");
    await capture("agent-office.png");
    await page.getByRole("button", { name: /Including history/ }).click();
    await expect(page.locator(".office-desk")).toHaveCount(6);
    await capture("agent-office-history.png");
    const screen = page.getByRole("button", { name: "Open screen for Sora" });
    await screen.focus();
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText("Applied the watering-view component.");
    await expect(dialog).toContainText("This preview is shortened");
    await expect(dialog).toContainText("xhigh");
    await capture("agent-office-detail.png");
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(screen).toBeFocused();
    await page.getByRole("button", { name: "Open screen for Nori" }).click();
    await expect(dialog).toContainText("Fixture account unavailable");
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Open screen for Kiko" }).click();
    await expect(dialog).toContainText("No output has been recorded");
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: /Current work/ }).click();
    await page.emulateMedia({ reducedMotion: "reduce" });
    assert.equal(
      await page
        .locator(".office-working .office-pet")
        .evaluate((node) => getComputedStyle(node).animationName),
      "none",
    );
    await page.setViewportSize({ width: 760, height: 1000 });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
      "No narrow-view horizontal overflow",
    );
    await capture("agent-office-compact.png");
    await page.setViewportSize({ width: 1440, height: 960 });
    console.log("Screen inspection, focus, motion and compact view verified.");
    await page.getByRole("button", { name: "AI team & connections" }).click();
    await expect(
      page.getByRole("heading", { name: "Meet your AI team" }),
    ).toBeVisible();
    await nav.getByRole("button", { name: "Settings", exact: true }).click();
    await page
      .getByRole("textbox", { name: "Interaction model", exact: true })
      .fill("fixture-custom-interaction");
    await page
      .getByRole("combobox", { name: "Interaction effort", exact: true })
      .selectOption("medium");
    await page
      .getByRole("button", { name: "Save AI roles", exact: true })
      .click();
    const persisted = () =>
      fs
        .readFile(path.join(profile, "private/state.json"), "utf8")
        .then(JSON.parse);
    await expect
      .poll(async () => (await persisted()).config.interactionRole.model)
      .toBe("fixture-custom-interaction");
    await expect(
      page.getByRole("button", { name: "Save AI roles", exact: true }),
    ).toBeDisabled();
    await expect(
      page
        .getByRole("button", { name: "Save AI roles", exact: true })
        .locator(".spin"),
    ).toHaveCount(0);
    assert.deepEqual(
      (await persisted()).config.aiRoles,
      roleSnapshot,
      "Interaction edit preserves custom project/detailed roles",
    );
    assert.deepEqual(
      (await persisted()).config.projectTeam,
      teamSnapshot,
      "Interaction edit preserves project team",
    );
    await nav.getByRole("button", { name: "Overview", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: /Good things start here/ }),
    ).toBeVisible();
    await page.reload();
    await nav.getByRole("button", { name: "Settings", exact: true }).click();
    await expect(
      page.getByRole("textbox", { name: "Interaction model", exact: true }),
    ).toHaveValue("fixture-custom-interaction");
    console.log("Independent interaction settings persist.");
    await nav.getByRole("button", { name: "Core Memory", exact: true }).click();
    const memory = page.getByRole("textbox", {
      name: "What should Nakama remember?",
    });
    await memory.fill("A synthetic unsaved preference.");
    const guardCount = dialogs.length;
    await office();
    await expect.poll(() => dialogs.length).toBe(guardCount + 1);
    assert.match(dialogs.at(-1).message, /unsaved Core Memory/);
    await expect(memory).toHaveValue("A synthetic unsaved preference.");
    await page.getByRole("button", { name: "Save note", exact: true }).click();
    await expect(memory).toHaveValue("");
    await page
      .getByRole("button", {
        name: "Edit note: A synthetic unsaved preference.",
      })
      .click();
    await page
      .getByRole("textbox", { name: "Saved note", exact: true })
      .fill("A changed draft.");
    await office();
    await expect.poll(() => dialogs.length).toBe(guardCount + 2);
    await expect(
      page.getByRole("textbox", { name: "Saved note", exact: true }),
    ).toHaveValue("A changed draft.");
    await page
      .getByRole("button", { name: "Cancel edit", exact: true })
      .click();
    await office();
    await expect(
      page.getByRole("heading", { name: "Agent office", exact: true }),
    ).toBeVisible();
    assert.equal(
      dialogs.length,
      guardCount + 2,
      "Saved/cancelled memory no longer blocks navigation",
    );
    await assistant();
    await reply({ type: "navigate", target: "agent-office" });
    await send("open agent office");
    await expect(
      page.getByRole("heading", { name: "Agent office", exact: true }),
    ).toBeVisible();
    await assistant();
    await reply({ type: "navigate", target: "routines" });
    await send("show routines");
    await expect(
      page.getByRole("tab", { name: /Routines board/ }),
    ).toHaveAttribute("aria-selected", "true");
    await assistant();
    await reply({ type: "navigate", target: "javascript:alert(1)" });
    await send("invalid fixture navigation");
    await expect(
      page.getByRole("textbox", { name: "Message Nakama" }),
    ).toHaveValue("");
    await expect(
      page.getByRole("heading", { name: "Talk to Nakama", exact: true }),
    ).toBeVisible();
    await reply({ type: "navigate", target: "agent-office" }, true);
    await send("open agent office after delayed reply");
    await expect
      .poll(() => app.evaluate(() => typeof globalThis.__officeFixture.release))
      .toBe("function");
    await page
      .getByRole("textbox", { name: "Message Nakama" })
      .fill("Keep this newer question");
    const previousDialogs = dialogs.length;
    await app.evaluate(() => {
      globalThis.__officeFixture.pause = false;
      globalThis.__officeFixture.release();
      globalThis.__officeFixture.release = null;
    });
    await expect.poll(() => dialogs.length).toBe(previousDialogs + 1);
    assert.match(dialogs.at(-1).message, /unsent assistant draft/);
    await expect(
      page.getByRole("textbox", { name: "Message Nakama" }),
    ).toHaveValue("Keep this newer question");
    await expect(
      page.getByRole("button", { name: "Send", exact: true }),
    ).toBeEnabled();
    await reply(undefined);
    await page.getByRole("button", { name: "Send", exact: true }).click();
    await expect(
      page.getByRole("textbox", { name: "Message Nakama" }),
    ).toHaveValue("");
    assert.equal(
      await app.evaluate(
        () =>
          globalThis.__officeFixture.agents.find(
            (agent) => agent.id === "task:worker",
          ).status,
      ),
      "running",
      "Follow-up did not stop worker",
    );
    await reply({ type: "navigate", target: "agent-office" }, true);
    await send("late navigation after leaving chat");
    await expect
      .poll(() => app.evaluate(() => typeof globalThis.__officeFixture.release))
      .toBe("function");
    acceptDialog = true;
    await nav.getByRole("button", { name: "Overview", exact: true }).click();
    await app.evaluate(() => {
      globalThis.__officeFixture.pause = false;
      globalThis.__officeFixture.release();
      globalThis.__officeFixture.release = null;
    });
    await expect(
      page.getByRole("heading", { name: /Good things start here/ }),
    ).toBeVisible();
    console.log(
      "Direct navigation, draft guards and worker follow-ups verified.",
    );
    await office();
    await app.evaluate(() => {
      globalThis.__officeFixture.agents = [];
    });
    await refresh();
    await expect(
      page.getByText("The office is taking a breather.", { exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: /Including history/ }).click();
    await expect(
      page.getByText("A fresh office, full of possibilities.", { exact: true }),
    ).toBeVisible();
    await app.evaluate(() => {
      globalThis.__officeFixture.version = 999;
    });
    await refresh();
    await expect(
      page.getByText("Office status unavailable", { exact: true }),
    ).toBeVisible();
    const fixture = await app.evaluate(() => ({
      blocked: globalThis.__officeFixture.blocked,
      calls: globalThis.__officeFixture.calls,
    }));
    assert.deepEqual(fixture.blocked, [], "No unexpected external routes");
    assert.deepEqual(errors, [], "No renderer exceptions");
    await fs.writeFile(
      path.join(root, "output/agent-office-ui-verification.json"),
      JSON.stringify(
        {
          verifiedAt: new Date().toISOString(),
          profile: path.relative(root, profile),
          result: "passed",
          images,
          checks: [
            "Host-receipt hierarchy, current/history and unique desk names",
            "Keyboard screen open/Escape/focus return, actual output/error/empty/truncated receipt",
            "Reduced motion and narrow viewport",
            "AI team remains a separate connections page",
            "Interaction role persists without changing custom project roles",
            "Standalone Core Memory add/edit draft guards; save and cancel release navigation",
            "Direct response navigation; routines tab; invalid/history outcomes inert",
            "Newer draft protected during delayed navigation; no late unmounted navigation",
            "Follow-up send remains available while synthetic worker is running",
            "Empty and incompatible snapshot states",
          ],
          limitations: [
            "Synthetic fixture only: no provider/account/model calls or real task execution",
            "No real remote desktop input, capture, messaging, calls, deployment or credits",
          ],
        },
        null,
        2,
      ) + "\n",
    );
    console.log("Agent office native UI checks passed.");
  } finally {
    clearTimeout(deadline);
    const cleanupDeadline = setTimeout(() => app.process().kill(), 5000);
    try {
      await app.close();
    } finally {
      clearTimeout(cleanupDeadline);
    }
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
