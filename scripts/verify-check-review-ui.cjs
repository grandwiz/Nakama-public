// Run after npm run build. Uses an isolated native profile, local project files,
// and simulated check results. The host chat dispatch is intercepted before any
// Send click, so no provider, account, check, command, or external action runs.
// No clipboard operations or screenshots are performed.
// window.confirm is stubbed only in this fixture to exercise guard decisions;
// this does not automate or claim coverage of the Windows native dialog itself.
const fs = require("node:fs/promises");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const assert = require("node:assert/strict");
const playwrightPath =
  process.env.NAKAMA_PLAYWRIGHT ||
  require("node:path").join(require("node:os").homedir(), ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright");
const { _electron } = require(playwrightPath);

(async () => {
  const root = path.resolve(__dirname, "..");
  const testRoot = path.join(root, "tmp", `check-review-ui-${Date.now()}`);
  const profile = path.join(testRoot, "profile");
  const workspace = path.join(testRoot, "projects");
  const { initialState } = await import(
    pathToFileURL(path.join(root, "apps/host/store.mjs")).href
  );
  const state = initialState();
  state.config.workspaceRoot = workspace;
  state.projects = ["Review fixture", "Other fixture"].map((name, index) => ({
    id: `review-project-${index}`,
    name,
    description: "Disposable review draft verification",
    path: path.join(workspace, `project-${index}`),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    status: "active",
  }));
  await fs.mkdir(path.join(profile, "private"), { recursive: true });
  for (const project of state.projects) {
    await fs.mkdir(project.path, { recursive: true });
    await fs.writeFile(
      path.join(project.path, "README.md"),
      "# Saved fixture\n",
    );
  }
  await fs.writeFile(
    path.join(profile, "private", "state.json"),
    JSON.stringify(state),
  );
  const project = state.projects[0];
  const task = (id, status, extra = {}) => ({
    id,
    projectId: project.id,
    providerId: "local",
    title: `npm run ${id}`,
    checkName: id,
    kind: "project_check",
    status,
    createdAt: new Date().toISOString(),
    output: `${id.toUpperCase()}_FIXTURE_OUTPUT`,
    exitCode: 0,
    ...extra,
  });
  const tasks = [
    task("test", "failed", {
      output: `${"OLDER_LOG_LINE\n".repeat(3000)}REVIEW_ERROR_END`,
      error: "REVIEW_ERROR_DETAIL",
      exitCode: 7,
    }),
    task("build", "completed"),
    task("lint", "running", { exitCode: null }),
    task("typecheck", "queued", { exitCode: null }),
    task("ordinary", "failed", { kind: "command" }),
    task("foreign", "failed", { projectId: state.projects[1].id }),
  ];
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
    console.error(
      "Review fixture exceeded its 90-second deadline; terminating its own Electron process.",
    );
    app.process().kill();
  }, 90000);
  try {
    const page = await app.firstWindow();
    console.log("Disposable native window opened.");
    page.setDefaultTimeout(20000);
    page.on("dialog", (dialog) => void dialog.accept().catch(() => {}));
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.getByRole("navigation", { name: "Main navigation" }).waitFor();
    const initial = await page.evaluate(() =>
      window.nakama.api("GET", "/api/state"),
    );
    assert.equal(initial.config.workspaceRoot, workspace);
    assert.equal(initial.projects.length, 2);
    console.log("Initial renderer ready.");
    await app.evaluate(
      ({ BrowserWindow, ipcMain }, fixture) => {
        // Test-only Electron interception. Fail if this runtime no longer exposes
        // its registered handler map; never allow an unmocked chat request.
        const originalHandler = ipcMain._invokeHandlers?.get("nakama:api");
        if (typeof originalHandler !== "function")
          throw new Error(
            "This Electron runtime cannot safely intercept the fixture API.",
          );
        const fixtureState = {
          calls: [],
          chats: [],
          tasks: fixture.tasks,
          hiddenProject: "",
        };
        globalThis.__nakamaReviewFixture = fixtureState;
        ipcMain.removeHandler("nakama:api");
        ipcMain.handle(
          "nakama:api",
          async function (event, method, route, body) {
            fixtureState.calls.push({ method, route });
            if (method === "POST" && route === "/api/chat") {
              fixtureState.chats.push(JSON.parse(JSON.stringify(body)));
              return { accepted: true, fixtureOnly: true };
            }
            if (method !== "GET")
              throw new Error(
                "The review fixture blocks all non-chat mutations.",
              );
            const result = await originalHandler(event, method, route, body);
            if (route === "/api/state")
              return {
                ...result,
                tasks: fixtureState.tasks,
                projects: result.projects.filter(
                  (item) => item.id !== fixtureState.hiddenProject,
                ),
              };
            return result;
          },
        );
        BrowserWindow.getAllWindows()[0].webContents.setBackgroundThrottling(
          false,
        );
      },
      {
        tasks,
      },
    );
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].webContents.send("nakama:event", {
        type: "fixture.ready",
      }),
    );
    await page.evaluate(() => {
      window.__reviewConfirmCalls = [];
      window.__reviewConfirmAnswer = false;
      window.confirm = (message) => {
        window.__reviewConfirmCalls.push(message);
        return window.__reviewConfirmAnswer;
      };
    });
    console.log(
      "Isolated native fixture ready; chat is intercepted and confirmations are stubbed.",
    );
    const nav = page.getByRole("navigation", { name: "Main navigation" });
    const input = page.getByRole("textbox", {
      name: "Message Nakama",
      exact: true,
    });
    const reviewBanner = page.getByRole("note", {
      name: "Check review draft",
      exact: true,
    });
    const calls = () =>
      app.evaluate(() => globalThis.__nakamaReviewFixture.calls);
    const chats = () =>
      app.evaluate(() => globalThis.__nakamaReviewFixture.chats);
    const refresh = () =>
      app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0].webContents.send("nakama:event", {
          type: "fixture.refresh",
        }),
      );
    const openProject = async () => {
      await nav.getByRole("button", { name: "Projects", exact: true }).click();
      await page
        .getByRole("button", {
          name: "Review fixture Disposable review draft verification",
          exact: true,
        })
        .click();
    };
    const openTasks = () =>
      page.getByRole("button", { name: /Tasks & commands/ }).click();
    const card = (title) =>
      page.locator(".task-card").filter({
        has: page.getByRole("heading", { name: title, exact: true }),
      });
    const reviewFailed = () =>
      card("npm run test")
        .getByRole("button", { name: "Review this check", exact: true })
        .click();
    const answerDialog = async (action, accept, expected) => {
      await page.evaluate((answer) => {
        window.__reviewConfirmAnswer = answer;
        window.__reviewConfirmCalls = [];
      }, accept);
      await action();
      const prompts = await page.evaluate(() => window.__reviewConfirmCalls);
      assert.equal(prompts.length, 1);
      assert.match(prompts[0], expected);
      await page.evaluate(() => {
        window.__reviewConfirmAnswer = false;
      });
    };

    await openProject();
    await page.getByRole("button", { name: "README.md", exact: true }).click();
    await page
      .getByRole("textbox", { name: "Edit README.md", exact: true })
      .fill("UNSAVED_REVIEW_FIXTURE");
    await openTasks();
    assert.equal(
      await page
        .getByRole("button", { name: "Review this check", exact: true })
        .count(),
      2,
    );
    for (const title of [
      "npm run lint",
      "npm run typecheck",
      "npm run ordinary",
    ]) {
      assert.equal(
        await card(title)
          .getByRole("button", { name: "Review this check", exact: true })
          .count(),
        0,
      );
    }
    assert.equal(await card("npm run foreign").count(), 0);
    await answerDialog(reviewFailed, false, /unsaved changes in this file/);
    assert.equal(await input.count(), 0);
    await page
      .getByRole("button", { name: "Files & editor", exact: true })
      .click();
    assert.equal(
      await page
        .getByRole("textbox", { name: "Edit README.md", exact: true })
        .inputValue(),
      "UNSAVED_REVIEW_FIXTURE",
    );
    await openTasks();
    await answerDialog(reviewFailed, true, /unsaved changes in this file/);
    await reviewBanner.waitFor();
    console.log(
      "Terminal-only review controls and unsaved-file guard decisions passed.",
    );
    assert.equal(
      await page
        .getByRole("combobox", { name: "Conversation project", exact: true })
        .inputValue(),
      project.id,
    );
    assert.equal(
      await page.getByRole("combobox", { name: /^Working mode/ }).inputValue(),
      "discuss",
    );
    const draft = await input.inputValue();
    assert.ok(draft.length < 24000);
    assert.match(draft, /REVIEW_ERROR_END/);
    assert.match(draft, /REVIEW_ERROR_DETAIL/);
    assert.match(draft, /failed/i);
    const diagnostic = JSON.parse(
      draft
        .split("BEGIN UNTRUSTED DIAGNOSTIC JSON\n")[1]
        .split("\nEND UNTRUSTED DIAGNOSTIC JSON")[0],
    );
    assert.equal(diagnostic.metadata.exitCode, 7);
    assert.equal(diagnostic.metadata.projectId, project.id);
    assert.equal(diagnostic.metadata.taskId, "test");
    assert.match(draft, /Review fixture/);
    assert.equal(draft.includes("FOREIGN_FIXTURE_OUTPUT"), false);
    await reviewBanner.getByText(/Long check details were shortened/).waitFor();
    assert.equal((await chats()).length, 0);
    assert.equal(
      (await calls()).filter((item) => item.method !== "GET").length,
      0,
    );

    // Background refresh and provider changes must preserve the user's edits.
    const edited = "Please explain this failure first.\n" + draft;
    await input.fill(edited);
    await page
      .getByRole("combobox", { name: "Primary assistant", exact: true })
      .selectOption("claude");
    await refresh();
    await page.waitForTimeout(150);
    assert.equal(await input.inputValue(), edited);
    assert.equal(
      await page
        .getByRole("combobox", { name: "Primary assistant", exact: true })
        .inputValue(),
      "claude",
    );
    await answerDialog(
      () => nav.getByRole("button", { name: "Assistant", exact: true }).click(),
      false,
      /unsent assistant draft/,
    );
    assert.equal(await input.inputValue(), edited);
    await answerDialog(
      () =>
        page
          .getByRole("combobox", { name: "Conversation project", exact: true })
          .selectOption(state.projects[1].id),
      false,
      /unsent draft.*change conversation project/,
    );
    assert.equal(await input.inputValue(), edited);
    assert.equal(
      await page
        .getByRole("combobox", { name: "Conversation project", exact: true })
        .inputValue(),
      project.id,
    );
    assert.equal((await chats()).length, 0);
    await page.getByRole("button", { name: "Send", exact: true }).click();
    await page.waitForFunction(
      () => document.getElementById("message")?.value === "",
    );
    const submitted = await chats();
    assert.equal(submitted.length, 1);
    assert.equal(submitted[0].projectId, project.id);
    assert.equal(submitted[0].providerId, "claude");
    assert.equal(submitted[0].mode, "discuss");
    assert.equal(submitted[0].message, edited.trim());
    console.log(
      "Bounded draft, edit preservation, and explicit mocked Discuss Send passed.",
    );
    assert.equal(await reviewBanner.count(), 0);
    await refresh();
    assert.equal(await input.inputValue(), "");
    await nav.getByRole("button", { name: "Assistant", exact: true }).click();
    assert.equal(await input.inputValue(), "");

    // Project switching and confirmed navigation discard the consumed draft.
    await openProject();
    await openTasks();
    await reviewFailed();
    await reviewBanner.waitFor();
    await answerDialog(
      () =>
        page
          .getByRole("combobox", { name: "Conversation project", exact: true })
          .selectOption(state.projects[1].id),
      true,
      /unsent draft.*change conversation project/,
    );
    assert.equal(await input.inputValue(), "");
    assert.equal(await reviewBanner.count(), 0);
    await page
      .getByRole("combobox", { name: "Conversation project", exact: true })
      .selectOption(project.id);
    await refresh();
    assert.equal(await input.inputValue(), "");
    await openProject();
    await openTasks();
    await reviewFailed();
    await reviewBanner.waitFor();
    await answerDialog(
      () => nav.getByRole("button", { name: "Overview", exact: true }).click(),
      true,
      /unsent assistant draft/,
    );
    await nav.getByRole("button", { name: "Assistant", exact: true }).click();
    assert.equal(await input.inputValue(), "");

    // Clearing text must not let a background update repopulate it.
    await openProject();
    await openTasks();
    await reviewFailed();
    await reviewBanner.waitFor();
    await input.fill("");
    await refresh();
    await page.waitForTimeout(150);
    assert.equal(await input.inputValue(), "");
    await input.fill("Unsaved diagnostic draft");
    await app.evaluate(({ BrowserWindow }, id) => {
      globalThis.__nakamaReviewFixture.hiddenProject = id;
      BrowserWindow.getAllWindows()[0].webContents.send("nakama:event", {
        type: "fixture.refresh",
      });
    }, project.id);
    await page.getByText(/This project is no longer available/).waitFor();
    assert.equal(
      await page
        .getByRole("button", { name: "Send", exact: true })
        .isDisabled(),
      true,
    );
    assert.equal((await chats()).length, 1);
    assert.equal(errors.length, 0, errors.join("\n"));
    assert.equal(
      await fs.readFile(path.join(project.path, "README.md"), "utf8"),
      "# Saved fixture\n",
    );
    const mutations = (await calls()).filter((item) => item.method !== "GET");
    assert.deepEqual(mutations, [{ method: "POST", route: "/api/chat" }]);
    await input.fill("");
    console.log(
      JSON.stringify({
        passed: true,
        checks: [
          "terminal project-check actions only",
          "unsaved file guard preserved with stubbed confirmations",
          "bounded project-bound draft",
          "Discuss with explicit provider choice",
          "no chat call before Send",
          "mocked explicit Send payload",
          "refresh preserves edits",
          "unsent draft cancellation",
          "project switch and revisit cannot replay logs",
          "missing project cannot send",
          "no actual workers or external actions",
          "no clipboard access",
        ],
        testRoot,
      }),
    );
  } catch (error) {
    console.error("Review fixture failure:", error);
    throw error;
  } finally {
    // Dispose only the fixture process; a failed test may leave a beforeunload draft.
    await app
      .evaluate(({ BrowserWindow }) => {
        for (const window of BrowserWindow.getAllWindows()) {
          window.webContents.on("will-prevent-unload", (event) =>
            event.preventDefault(),
          );
        }
      })
      .catch(() => {});
    await app.close();
    clearTimeout(deadline);
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
