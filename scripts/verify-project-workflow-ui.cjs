// Run after npm run build. Native Electron rendering and real local memory / role
// persistence in an isolated profile. Project orchestration is a fixture: no
// provider, account, phone, external-service or command request is permitted.
const fs = require("node:fs/promises");
const path = require("node:path");
const assert = require("node:assert/strict");
const { pathToFileURL } = require("node:url");
const playwrightPath =
  process.env.NAKAMA_PLAYWRIGHT ||
  require("node:path").join(
    require("node:os").homedir(),
    ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright",
  );
const { _electron } = require(playwrightPath);
const { expect } = require(path.join(playwrightPath, "test"));

(async () => {
  const root = path.resolve(__dirname, "..");
  const profile = path.join(root, "tmp", "project-workflow-ui-" + Date.now());
  const stateFile = path.join(profile, "private", "state.json");
  const { initialState } = await import(
    pathToFileURL(path.join(root, "apps/host/store.mjs")).href
  );
  const state = initialState();
  state.config.workspaceRoot = path.join(profile, "projects");
  const project = {
    id: "project-workflow-ui-fixture",
    name: "Private notes project",
    description: "Disposable native interface fixture.",
    path: path.join(state.config.workspaceRoot, "notes"),
    updatedAt: new Date().toISOString(),
    status: "ready",
  };
  state.projects.push(project);
  const workflow = {
    id: "managed-ui-fixture",
    projectId: project.id,
    requestedBy: "desktop",
    message: "Build a private notes app with a calm, accessible interface.",
    status: "awaiting_answers",
    stage: "awaiting_answers",
    createdAt: new Date().toISOString(),
    assignments: {
      manager: state.config.aiRoles.planning,
      peer: state.config.projectTeam.peer,
      development: state.config.aiRoles.development,
    },
    plan: "Plan: build a small local notes interface. Keep storage private. Use semantic forms and keyboard navigation. Confirm audience and appearance before development. Project tests remain unrun in this interface fixture.",
    workItems: [
      { title: "Implement the notes interface", files: ["index.html"] },
    ],
    reviewRound: 0,
    questions: [
      {
        id: "answered-question",
        text: "Should notes stay private?",
        answer: "Yes",
        source: "manager",
      },
      {
        id: "audience-question",
        text: "Who will use the notes app?",
        source: "manager",
      },
      {
        id: "appearance-question",
        text: "Which appearance should the app use?",
        source: "peer",
      },
    ],
  };
  for (const provider of state.providers) {
    provider.status = "connected";
    provider.detail = "Disposable UI fixture; account access is blocked.";
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
  console.log("Launching isolated project workflow UI fixture.");
  const app = await _electron.launch({
    executablePath: path.join(root, "node_modules/electron/dist/electron.exe"),
    args: [root],
    env,
    timeout: 30000,
  });
  const deadline = setTimeout(() => {
    console.error("Project workflow UI fixture exceeded its deadline.");
    app.process().kill();
  }, 180000);
  const screenshots = [];
  try {
    const page = await app.firstWindow();
    page.setDefaultTimeout(10000);
    const errors = [],
      dialogs = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("dialog", (dialog) => {
      dialogs.push(dialog.message());
      void dialog.dismiss().catch(() => {});
    });
    const nav = page.getByRole("navigation", { name: "Main navigation" });
    await nav.waitFor();
    await app.evaluate(({ BrowserWindow, ipcMain }, initialWorkflow) => {
      const original = ipcMain._invokeHandlers?.get("nakama:api");
      if (typeof original !== "function")
        throw new Error("Fixture interceptor unavailable.");
      const fixture = {
        workflow: initialWorkflow,
        approval: undefined,
        answers: [],
        stops: [],
        settings: [],
        memory: [],
        failAnswers: true,
        blocked: [],
      };
      globalThis.__nakamaProjectWorkflowFixture = fixture;
      ipcMain.removeHandler("nakama:api");
      ipcMain.handle("nakama:api", async (event, method, route, body) => {
        if (method === "GET" && route === "/api/state") {
          const result = await original(event, method, route, body);
          result.projectWorkflows = [structuredClone(fixture.workflow)];
          if (fixture.approval)
            result.approvals = [structuredClone(fixture.approval)];
          return result;
        }
        if (
          method === "POST" &&
          route === `/api/project-workflows/${fixture.workflow.id}/answers`
        ) {
          fixture.answers.push(structuredClone(body));
          if (fixture.failAnswers) {
            fixture.failAnswers = false;
            throw new Error(
              "Simulated answer failure; your draft stays available.",
            );
          }
          for (const answer of body.answers)
            fixture.workflow.questions.find(
              (question) => question.id === answer.id,
            ).answer = answer.answer;
          fixture.workflow.status = "running";
          fixture.workflow.stage = "reviewing";
          fixture.workflow.reviews = [
            {
              role: "manager",
              round: 0,
              verdict: "pass",
              summary:
                "Static fixture review found the plan coherent. No project tests ran.",
              findings: [],
            },
            {
              role: "peer",
              round: 0,
              verdict: "changes_requested",
              summary: "The fixture needs one accessibility correction.",
              findings: [
                "Add a visible keyboard focus indicator to the save button.",
              ],
            },
          ];
          return structuredClone(fixture.workflow);
        }
        if (
          method === "POST" &&
          route === `/api/project-workflows/${fixture.workflow.id}/stop`
        ) {
          fixture.stops.push(structuredClone(body));
          fixture.workflow.status = "stopped";
          // Real stop leaves the last stage for history; status must take
          // precedence so a stopped review is not labelled as still running.
          fixture.workflow.error =
            "Stopped by the user. Previously saved files are preserved.";
          return { stopped: true };
        }
        if (
          /^\/api\/companion-memory(?:\/|$)/.test(route) &&
          ["GET", "POST", "PATCH", "DELETE"].includes(method)
        ) {
          fixture.memory.push({ method, route, body: structuredClone(body) });
          return original(event, method, route, body);
        }
        if (method === "PATCH" && route === "/api/settings") {
          const fields = Object.keys(body || {})
            .sort()
            .join();
          if (
            [
              "aiRoles,fastReplies,interactionRole,projectTeam",
              "companionLearningEnabled",
              "memoryEnabled",
            ].includes(fields)
          ) {
            fixture.settings.push(structuredClone(body));
            return original(event, method, route, body);
          }
        }
        fixture.blocked.push({ method, route });
        throw new Error(
          "Unexpected request blocked in managed project fixture: " + route,
        );
      });
      const window = BrowserWindow.getAllWindows()[0];
      window.webContents.setBackgroundThrottling(false);
      window.setSize(1440, 1080);
    }, workflow);
    const fixture = () =>
      app.evaluate(() => globalThis.__nakamaProjectWorkflowFixture);
    const saved = async () => JSON.parse(await fs.readFile(stateFile, "utf8"));
    const capture = async (filename) => {
      if (process.env.NAKAMA_NO_SCREENSHOTS === "1") return;
      await page.evaluate(
        () =>
          new Promise((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(resolve)),
          ),
      );
      const png = await app.evaluate(async ({ BrowserWindow }) => {
        const contents = BrowserWindow.getAllWindows()[0].webContents;
        await contents.capturePage();
        const image = await contents.capturePage();
        if (image.isEmpty()) throw new Error("Empty native screenshot.");
        return image.toPNG().toString("base64");
      });
      await fs.mkdir(path.join(root, "output"), { recursive: true });
      const output = path.join(root, "output", filename);
      await fs.writeFile(output, Buffer.from(png, "base64"));
      screenshots.push(output);
    };
    await page.reload({ timeout: 30000, waitUntil: "domcontentloaded" });
    await nav.waitFor();
    await nav.getByRole("button", { name: "Assistant", exact: true }).click();
    const projectSelector = page.getByRole("combobox", {
      name: "Conversation project",
      exact: true,
    });
    await projectSelector.selectOption(project.id);
    const manager = page.getByRole("article", {
      name: "Project manager",
      exact: true,
    });
    await expect(manager).toContainText("Your manager has questions");
    const audience = page.getByRole("textbox", {
      name: "Who will use the notes app?",
      exact: true,
    });
    const appearance = page.getByRole("textbox", {
      name: "Which appearance should the app use?",
      exact: true,
    });
    const submit = page.getByRole("button", {
      name: "Send answers to manager",
      exact: true,
    });
    await expect(
      page.getByRole("textbox", {
        name: "Should notes stay private?",
        exact: true,
      }),
    ).toHaveCount(0);
    await expect(submit).toBeDisabled();
    console.log("Checking manager question drafts and navigation protection.");
    await audience.fill("  Just me, on my phone and tablet.  ");
    await expect(submit).toBeDisabled();
    await page.evaluate(() => {
      window.__workflowConfirms = [];
      window.confirm = (message) => {
        window.__workflowConfirms.push(message);
        return false;
      };
    });
    await nav.getByRole("button", { name: "Settings", exact: true }).click();
    await expect(audience).toHaveValue("  Just me, on my phone and tablet.  ");
    await projectSelector.selectOption("");
    await expect(projectSelector).toHaveValue(project.id);
    assert.deepEqual(await page.evaluate(() => window.__workflowConfirms), [
      "Discard your unsent assistant draft?",
      "Discard your unsent draft and change conversation project?",
    ]);
    await appearance.fill("  Calm blue, with a dark option.  ");
    await manager
      .getByText("Plan, team & review progress", { exact: true })
      .click();
    await expect(manager).toContainText(
      "Claude · Fable 5.1 · Ultracode request",
    );
    await expect(manager).toContainText("Ultracode request");
    await capture("project-workflow.png");
    console.log(
      "Checking failed answer retention, exact IDs, review stage and stop.",
    );
    await submit.click();
    await expect.poll(async () => (await fixture()).answers.length).toBe(1);
    await expect(
      page.getByText(/Simulated answer failure; your draft stays available/),
    ).toBeVisible();
    await expect(audience).toHaveValue("  Just me, on my phone and tablet.  ");
    await expect(appearance).toHaveValue("  Calm blue, with a dark option.  ");
    await expect(submit).toBeEnabled();
    const expectedAnswers = {
      answers: [
        { id: "audience-question", answer: "Just me, on my phone and tablet." },
        { id: "appearance-question", answer: "Calm blue, with a dark option." },
      ],
    };
    assert.deepEqual((await fixture()).answers[0], expectedAnswers);
    await submit.click();
    await expect.poll(async () => (await fixture()).answers.length).toBe(2);
    assert.deepEqual((await fixture()).answers[1], expectedAnswers);
    await expect(manager).toContainText("Both reviewers checking");
    await expect(audience).toHaveCount(0);
    await expect(manager.locator(".workflow-review")).toHaveCount(2);
    await expect(manager.locator(".workflow-review").first()).toContainText(
      "Manager review · round 0 · pass",
    );
    await expect(manager.locator(".workflow-review").last()).toContainText(
      "Co-planner review · round 0 · changes requested",
    );
    await expect(manager).toContainText(
      "Add a visible keyboard focus indicator to the save button.",
    );
    console.log(
      "Checking PC-only approval navigation and actual check receipts.",
    );
    await app.evaluate(() => {
      const fixture = globalThis.__nakamaProjectWorkflowFixture;
      fixture.approval = {
        id: "managed-dependency-approval-fixture",
        type: "project_dependencies",
        title: "Prepare fixture locked dependencies",
        status: "pending",
        description:
          "Synthetic UI fixture only. Exact npm ci command and package/lockfile hashes. No package command will run.",
        createdAt: new Date().toISOString(),
      };
      Object.assign(fixture.workflow, {
        stage: "awaiting_check_approval",
        checkApprovalId: fixture.approval.id,
        checkSummary:
          "Waiting for fresh PC approval to prepare locked dependencies; lifecycle scripts are disabled.",
        checkReceipts: [
          {
            kind: "project_dependencies",
            checkName: "dependencies",
            round: 0,
            approvalId: fixture.approval.id,
            status: "awaiting_approval",
            createdAt: new Date().toISOString(),
          },
        ],
      });
    });
    await expect(manager).toContainText(
      "Dependency preparation needs your PC approval",
      { timeout: 10000 },
    );
    await expect(manager).toContainText("replaces this project's node_modules");
    await expect(manager).toContainText("Lifecycle scripts are disabled");
    await manager
      .getByText("Project check results (1)", { exact: true })
      .click();
    await expect(manager).toContainText(
      "Locked dependencies (npm ci) · round 0 · awaiting approval",
    );
    await expect(manager).toContainText(
      "Dependency preparation has not started.",
    );
    await expect(manager).not.toContainText("npm run dependencies");
    await manager
      .getByRole("button", { name: "Review dependency approval", exact: true })
      .click();
    await expect(page.locator(".focused-approval")).toContainText(
      "managed-dependency-approval-fixture",
    );
    await nav.getByRole("button", { name: "Assistant", exact: true }).click();
    await projectSelector.selectOption(project.id);
    await app.evaluate(() => {
      const workflow = globalThis.__nakamaProjectWorkflowFixture.workflow;
      workflow.stage = "checking";
      workflow.checkReceipts[0].status = "running";
    });
    await expect(manager).toContainText("Preparing locked dependencies", {
      timeout: 10000,
    });
    await expect(
      manager.getByRole("button", {
        name: "Review dependency approval",
        exact: true,
      }),
    ).toHaveCount(0);
    await app.evaluate(() => {
      const fixture = globalThis.__nakamaProjectWorkflowFixture;
      fixture.approval = {
        id: "managed-check-approval-fixture",
        type: "project_check",
        title: "Approve fixture test rerun",
        status: "pending",
        description:
          "Synthetic UI fixture only. Exact script: test = node fixture-test.cjs. No command will run.",
        createdAt: new Date().toISOString(),
      };
      Object.assign(fixture.workflow, {
        stage: "awaiting_check_approval",
        checkApprovalId: fixture.approval.id,
        checkSummary:
          "Test failed in round 0. The repaired files need a fresh approved test run.",
        checkReceipts: [
          {
            checkName: "test",
            round: 0,
            approvalId: "earlier-fixture",
            status: "failed",
            exitCode: 1,
            output: "Synthetic assertion failure",
            createdAt: new Date().toISOString(),
          },
          {
            checkName: "test",
            round: 1,
            approvalId: fixture.approval.id,
            status: "awaiting_approval",
            createdAt: new Date().toISOString(),
          },
        ],
      });
    });
    await expect(manager).toContainText(
      "Project check needs your PC approval",
      { timeout: 10000 },
    );
    const checkResults = manager.getByRole("region", {
      name: "Workflow project checks",
    });
    await checkResults
      .getByText("Project check results (2)", { exact: true })
      .click();
    await expect(checkResults).toContainText(
      "test · round 0 · failed · exit 1",
    );
    await expect(checkResults).toContainText(
      "test · round 1 · awaiting approval",
    );
    await expect(checkResults).toContainText("This check has not started.");
    await checkResults
      .getByText("Recorded check output", { exact: true })
      .click();
    await expect(checkResults).toContainText("Synthetic assertion failure");
    await capture("project-workflow-checks.png");
    await manager
      .getByRole("button", { name: "Review check approval", exact: true })
      .click();
    await expect(page.locator(".focused-approval")).toContainText(
      "Approve fixture test rerun",
    );
    await expect(page.locator(".focused-approval")).toContainText(
      "managed-check-approval-fixture",
    );
    await nav.getByRole("button", { name: "Assistant", exact: true }).click();
    await projectSelector.selectOption(project.id);
    await expect(manager).toContainText("Project check needs your PC approval");
    await app.evaluate(() => {
      const workflow = globalThis.__nakamaProjectWorkflowFixture.workflow;
      workflow.stage = "checking";
      workflow.checkReceipts[1].status = "running";
    });
    await expect(manager).toContainText("Running project checks", {
      timeout: 10000,
    });
    await expect(
      manager.getByRole("button", {
        name: "Review check approval",
        exact: true,
      }),
    ).toHaveCount(0);
    await manager
      .getByRole("button", { name: "Stop project work", exact: true })
      .click();
    await expect(manager).toContainText("Stopped by the user");
    await expect(manager.locator(".workflow-heading > strong")).toHaveText(
      "Stopped",
    );
    await expect(
      manager.getByRole("button", { name: "Stop project work", exact: true }),
    ).toHaveCount(0);
    assert.deepEqual((await fixture()).stops, [{}]);
    await page.reload({ timeout: 30000, waitUntil: "domcontentloaded" });
    await nav.waitFor();
    await nav.getByRole("button", { name: "Assistant", exact: true }).click();
    await projectSelector.selectOption(project.id);
    await expect(manager).toContainText("Stopped by the user");
    await expect(manager.locator(".workflow-heading > strong")).toHaveText(
      "Stopped",
    );
    await expect(submit).toHaveCount(0);

    console.log("Checking co-planner settings persistence and reload.");
    await nav.getByRole("button", { name: "Settings", exact: true }).click();
    const peerAccount = page.getByRole("combobox", {
      name: "Co-planner account",
      exact: true,
    });
    const peerModel = page.getByRole("textbox", {
      name: "Co-planner model",
      exact: true,
    });
    const peerEffort = page.getByRole("combobox", {
      name: "Co-planner effort",
      exact: true,
    });
    const cycles = page.getByRole("combobox", {
      name: "Automatic fix rounds",
      exact: true,
    });
    await expect(peerAccount).toHaveValue("claude");
    await expect(peerModel).toHaveValue("claude-fable-5-1");
    await peerEffort.selectOption("high");
    await cycles.selectOption("1");
    await page.evaluate(() => {
      window.__roleConfirms = [];
      window.confirm = (message) => {
        window.__roleConfirms.push(message);
        return false;
      };
    });
    await nav.getByRole("button", { name: "Assistant", exact: true }).click();
    await expect(peerEffort).toHaveValue("high");
    assert.deepEqual(await page.evaluate(() => window.__roleConfirms), [
      "Discard your unsaved AI role settings?",
    ]);
    await page
      .getByRole("button", { name: "Save AI roles", exact: true })
      .click();
    await expect
      .poll(async () => (await saved()).config.projectTeam.peer.effort)
      .toBe("high");
    assert.deepEqual((await saved()).config.projectTeam, {
      peer: { providerId: "claude", model: "claude-fable-5-1", effort: "high" },
      maxFixCycles: 1,
    });
    assert.equal(
      (await saved()).config.aiRoles.development.effort,
      "ultracode",
    );
    await expect(
      page.getByRole("button", { name: "Save AI roles", exact: true }),
    ).toBeDisabled();
    await expect(
      page
        .getByRole("button", { name: "Save AI roles", exact: true })
        .locator(".spin"),
    ).toHaveCount(0);
    await page.reload({ timeout: 30000, waitUntil: "domcontentloaded" });
    await nav.waitFor();
    await nav.getByRole("button", { name: "Settings", exact: true }).click();
    await expect(peerEffort).toHaveValue("high");
    await expect(cycles).toHaveValue("1");

    console.log(
      "Checking real local companion note CRUD, learning pause and memory pause.",
    );
    const companion = page.locator(".settings-section").filter({
      has: page.getByRole("heading", {
        name: "Your Nakama companion",
        exact: true,
      }),
    });
    const add = companion.getByRole("textbox", {
      name: "What should Nakama remember?",
      exact: true,
    });
    const addNote = async (text, count) => {
      await add.fill(text);
      await companion
        .getByRole("button", { name: "Save note", exact: true })
        .click();
      await expect
        .poll(async () => (await saved()).companionMemory.entries.length)
        .toBe(count);
      await expect(add).toHaveValue("");
    };
    await addNote("I prefer short, practical answers.", 1);
    await companion
      .getByRole("button", {
        name: "Edit note: I prefer short, practical answers.",
        exact: true,
      })
      .click();
    await companion
      .getByRole("textbox", { name: "Saved note", exact: true })
      .fill("I write my notes after breakfast.");
    await companion
      .getByRole("combobox", { name: "Category", exact: true })
      .selectOption("routine");
    await companion
      .getByRole("button", { name: "Save changes", exact: true })
      .click();
    await expect
      .poll(async () => (await saved()).companionMemory.entries[0].category)
      .toBe("routine");
    await companion
      .getByRole("button", {
        name: "Forget note: I write my notes after breakfast.",
        exact: true,
      })
      .click();
    await expect
      .poll(async () => (await saved()).companionMemory.entries.length)
      .toBe(0);
    await addNote("I prefer concise, friendly explanations.", 1);
    await addNote("Remember my preference for British English.", 2);
    const learning = companion.getByRole("checkbox", {
      name: /^Remember preferences I share in conversation/,
    });
    // These toggles show the persisted host value, so their visual state changes
    // after the async save/refresh rather than synchronously during the click.
    await learning.click();
    await expect
      .poll(async () => (await saved()).config.companionLearningEnabled)
      .toBe(false);
    await expect(learning).not.toBeChecked();
    const history = page.getByRole("checkbox", {
      name: /^Use recent conversation context/,
    });
    await history.click();
    await expect
      .poll(async () => (await saved()).config.memoryEnabled)
      .toBe(false);
    await expect(history).not.toBeChecked();
    await expect(companion).toContainText(
      "learning and reuse of these notes are paused",
    );
    await companion.scrollIntoViewIfNeeded();
    await companion
      .getByRole("heading", { name: "Your Nakama companion", exact: true })
      .scrollIntoViewIfNeeded();
    await capture("companion-memory.png");
    await page.reload({ timeout: 30000, waitUntil: "domcontentloaded" });
    await nav.waitFor();
    await nav.getByRole("button", { name: "Settings", exact: true }).click();
    await expect(learning).not.toBeChecked();
    await expect(history).not.toBeChecked();
    await expect(companion).toContainText("What Nakama remembers (2/50)");
    await companion
      .getByRole("button", { name: "Forget all notes", exact: true })
      .click();
    await expect
      .poll(async () => (await saved()).companionMemory.entries.length)
      .toBe(0);
    await expect(companion).toContainText("No saved companion notes yet.");
    const result = await fixture();
    assert.deepEqual(result.blocked, []);
    assert.deepEqual(errors, []);
    assert.deepEqual(dialogs, []);
    assert.equal(
      result.memory.filter((item) => item.method === "POST").length,
      3,
    );
    assert.equal(
      result.memory.filter((item) => item.method === "PATCH").length,
      1,
    );
    assert.equal(
      result.memory.filter((item) => item.method === "DELETE").length,
      2,
    );
    console.log(
      JSON.stringify(
        {
          passed: true,
          profile,
          screenshots,
          checks: [
            "Manager presents only unanswered questions; all answers required",
            "Declined page and project navigation retain question drafts",
            "Failed response keeps draft; retry sends exact IDs and trimmed answers",
            "Review progress and stop result survive renderer reload",
            "Static review verdicts/findings remain visible and stopped status overrides prior review stage",
            "Check receipts display recorded failure/exit result and pending run; PC approval link targets the exact request without approving it",
            "Dependency preparation shows npm ci, node_modules replacement, disabled lifecycle scripts and exact PC approval navigation",
            "Running check retains Stop and stopped status overrides the previous checking stage",
            "Co-planner role and fix-round settings persist without changing worker effort",
            "Real local companion note add, edit, individual forget and forget all",
            "Learning and memory pause survive reload while saved notes remain editable",
            "No renderer errors or unexpected routes",
          ],
          realProviderRequests: 0,
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
