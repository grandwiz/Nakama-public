/* Disposable native UI fixture. GitHub is synthetic; skills use the real local host. */
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
  const profile = path.join(root, "tmp", `github-skills-ui-${Date.now()}`);
  const { initialState } = await import(
    pathToFileURL(path.join(root, "apps/host/store.mjs")).href
  );
  const state = initialState();
  state.config.workspaceRoot = path.join(profile, "projects");
  const stamp = new Date().toISOString();
  state.connections.find((item) => item.id === "github").accounts = [
    {
      id: "fixture-github",
      accountLabel: "Test garden account",
      status: "verified",
    },
  ];
  state.skillLibrary = {
    version: 1,
    learningEnabled: true,
    reuseEnabled: true,
    skills: [
      {
        id: "candidate-garden",
        title: "Review a garden form",
        description: "A method proposed by a reviewed synthetic project.",
        whenToUse: "When reviewing accessible garden forms",
        steps: [
          "Check labels and keyboard focus order",
          "State which browser checks were not run",
        ],
        tags: ["forms", "accessibility"],
        enabled: false,
        status: "candidate",
        source: {
          kind: "reviewed_workflow",
          workflowId: "fixture-workflow",
          detail: "Synthetic review evidence; no real model task.",
        },
        createdAt: stamp,
        updatedAt: stamp,
        useCount: 0,
      },
    ],
    receipts: [],
  };
  await fs.mkdir(path.join(profile, "private"), { recursive: true });
  await fs.mkdir(state.config.workspaceRoot, { recursive: true });
  await fs.writeFile(
    path.join(profile, "private/state.json"),
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
  const deadline = setTimeout(() => {
    console.error("GitHub/skills fixture deadline exceeded");
    app.process().kill();
  }, 180000);
  let fixturePage;
  try {
    const page = await app.firstWindow();
    fixturePage = page;
    page.setDefaultTimeout(12000);
    let acceptDialog = false;
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("dialog", (dialog) => {
      const accept = acceptDialog;
      acceptDialog = false;
      void (accept ? dialog.accept() : dialog.dismiss()).catch(() => {});
    });
    await page.getByRole("navigation", { name: "Main navigation" }).waitFor();
    await app.evaluate(({ ipcMain }) => {
      const original = ipcMain._invokeHandlers.get("nakama:api");
      const ctx = (global.__githubSkillsFixture = {
        calls: [],
        ids: [],
        head: "a".repeat(40),
        dirty: true,
        approvals: [],
        failCommit: false,
      });
      ipcMain.removeHandler("nakama:api");
      ipcMain.handle("nakama:api", async (event, method, route, body) => {
        if (
          /^\/api\/(chat|commands|deployments|device\/actions|providers\/.*\/(probe|settings)|connections\/.*\/test|kling)/.test(
            route,
          )
        )
          throw new Error("External effects disabled in this fixture");
        if (route === "/api/state") {
          const current = await original(event, method, route, body);
          return {
            ...current,
            approvals: [...current.approvals, ...ctx.approvals],
          };
        }
        if (route.startsWith("/api/github/repositories")) {
          ctx.calls.push({ method, route, body });
          return {
            items: [
              {
                id: 1,
                name: "fixture/pocket-garden",
                private: true,
                url: "https://github.com/fixture/pocket-garden",
                defaultBranch: "main",
              },
            ],
            nextPage: null,
          };
        }
        if (route === "/api/github/import") {
          ctx.calls.push({ method, route, body });
          const project = await original(event, "POST", "/api/projects", {
            name: body.name || "Pocket garden",
            description: "Synthetic GitHub UI fixture",
          });
          ctx.ids.push(project.id);
          return { project };
        }
        const match = route.match(
          /^\/api\/projects\/([^/]+)\/(github(?:\/.*)?|git(?:\/diff)?(?:\?.*)?)$/,
        );
        if (match && ctx.ids.includes(match[1])) {
          ctx.calls.push({ method, route, body });
          const entries = ctx.dirty
            ? [{ path: "README.md", indexStatus: " ", worktreeStatus: "M" }]
            : [];
          const status = {
            available: true,
            repository: true,
            branch: "main",
            head: ctx.head,
            entries,
            truncated: false,
            ahead: ctx.head.startsWith("a") ? 0 : 1,
            behind: 0,
            remoteHead: "a".repeat(40),
          };
          if (match[2] === "git") return status;
          if (match[2].startsWith("git/diff?"))
            return {
              path: "README.md",
              staged: false,
              binary: false,
              untracked: false,
              truncated: false,
              content:
                "diff --git a/README.md b/README.md\n--- a/README.md\n+++ b/README.md\n@@ -1 +1,2 @@\n # Pocket garden\n+A little place for plants.\n",
            };
          if (method === "GET")
            return {
              linked: true,
              link: {
                accountId: "fixture-github",
                accountLabel: "Test garden account",
                repository: "fixture/pocket-garden",
                url: "https://github.com/fixture/pocket-garden",
                defaultBranch: "main",
              },
              status,
              busy: false,
            };
          const action = match[2].replace("github/", "");
          if (action === "commit/prepare")
            return {
              id: "fixture-commit-preview",
              projectId: match[1],
              head: ctx.head,
              branch: "main",
              ...body,
              files: [
                {
                  path: "README.md",
                  kind: "modified",
                  before: "# Pocket garden\n",
                  after: "# Pocket garden\nA little place for plants.\n",
                  bytes: 43,
                },
              ],
              expiresAt: new Date(Date.now() + 600000).toISOString(),
              disclosure:
                "Synthetic local commit review. No remote changes, hooks or inference.",
            };
          if (action === "commit") {
            if (ctx.failCommit)
              throw new Error(
                "Selected files changed. Prepare a fresh review.",
              );
            const prior = ctx.head;
            ctx.head = "b".repeat(40);
            ctx.dirty = false;
            return {
              id: "fixture-local-commit",
              commit: ctx.head,
              head: prior,
            };
          }
          if (action === "push/prepare")
            return {
              id: "fixture-push-preview",
              head: ctx.head,
              branch: "main",
              remoteHead: "a".repeat(40),
              repository: "fixture/pocket-garden",
              accountLabel: "Test garden account",
              expiresAt: new Date(Date.now() + 600000).toISOString(),
              disclosure:
                "A push can start GitHub Actions or deployment. Review and approve on the PC.",
            };
          if (action === "push") {
            const approval = {
              id: "fixture-push-approval",
              type: "github_push",
              title: "Push main to fixture/pocket-garden",
              description: `Exact synthetic commit ${ctx.head}. May trigger automation. No push will run in this fixture.`,
              createdAt: new Date().toISOString(),
              status: "pending",
            };
            ctx.approvals.push(approval);
            return { approval };
          }
          if (action === "pull" && ctx.holdPull) {
            await new Promise((resolve) => {
              ctx.completePull = resolve;
            });
            ctx.completePull = null;
          }
          if (["fetch", "pull", "link"].includes(action))
            return { status: "completed" };
          throw new Error(`Unexpected GitHub fixture action ${action}`);
        }
        if (route === "/api/approvals/fixture-push-approval/resolve") {
          ctx.calls.push({ method, route, body });
          assertNeverApprove(body);
          ctx.approvals[0].status = "denied";
          return { status: "denied" };
        }
        return original(event, method, route, body);
      });
      function assertNeverApprove(body) {
        if (body.approved)
          throw new Error("Fixture only declines synthetic push approval");
      }
    });
    const nav = page.getByRole("navigation", { name: "Main navigation" });
    await nav
      .getByRole("button", { name: "Learned skills", exact: true })
      .click();
    await page
      .getByRole("heading", { name: "Learned skills", exact: true })
      .waitFor();
    const editor = page.getByRole("region", { name: "Skill editor" });
    await editor.getByLabel("Skill name").fill("A kind code review");
    await editor
      .getByLabel("What it helps with")
      .fill("Review small UI changes clearly and practically.");
    await editor
      .getByLabel("When to use it")
      .fill("When reviewing user interface code");
    await editor
      .getByLabel("Steps, one per line")
      .fill("Check keyboard access\nExplain what was actually verified");
    await editor
      .getByLabel("Tags, separated by commas")
      .fill("review, interface");
    await nav.getByRole("button", { name: "Projects", exact: true }).click();
    await expect(editor.getByLabel("Skill name")).toHaveValue(
      "A kind code review",
    );
    await editor.getByRole("button", { name: "Save skill" }).click();
    await expect(
      page.getByRole("heading", { name: "A kind code review", exact: true }),
    ).toBeVisible();
    await page.getByRole("checkbox", { name: "Reuse relevant skills" }).click();
    await expect(
      page.getByRole("checkbox", { name: "Reuse relevant skills" }),
    ).not.toBeChecked();
    await page.getByRole("checkbox", { name: "Reuse relevant skills" }).click();
    await expect(
      page.getByRole("checkbox", { name: "Reuse relevant skills" }),
    ).toBeChecked();
    const candidate = page.locator("article").filter({
      has: page.getByRole("heading", {
        name: "Review a garden form",
        exact: true,
      }),
    });
    await candidate.getByRole("button", { name: "Edit", exact: true }).click();
    await expect(
      editor.getByRole("checkbox", { name: "Use when relevant after review" }),
    ).toBeDisabled();
    await editor.getByRole("button", { name: "Cancel edit" }).click();
    await candidate
      .getByText("Read method and source", { exact: true })
      .click();
    await page.screenshot({
      path: path.join(root, "output/learned-skills.png"),
      fullPage: true,
    });
    await candidate
      .getByRole("button", { name: "Accept method", exact: true })
      .click();
    await expect(
      candidate.getByText("Review candidate", { exact: true }),
    ).toBeVisible();
    acceptDialog = true;
    await candidate
      .getByRole("button", { name: "Accept method", exact: true })
      .click();
    await expect(
      candidate.getByText("Ready to reuse", { exact: true }),
    ).toBeVisible();
    await nav.getByRole("button", { name: "Projects", exact: true }).click();
    await page
      .getByRole("button", { name: "Import from GitHub", exact: true })
      .click();
    const modal = page.getByRole("dialog");
    await modal
      .getByRole("button", { name: "Load repositories", exact: true })
      .click();
    await modal.getByRole("button", { name: /fixture\/pocket-garden/ }).click();
    await modal.getByLabel("Local project name").fill("Pocket garden");
    await modal
      .getByRole("button", { name: "Clone project", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Git changes", exact: true })
      .click();
    const git = page.getByRole("region", { name: "GitHub project controls" });
    await expect(
      git.getByRole("button", { name: "Pull fast-forward", exact: true }),
    ).toBeDisabled();
    await git.getByRole("checkbox", { name: /README\.md/ }).check();
    await git
      .getByRole("textbox", { name: "Commit message", exact: true })
      .fill("Describe the pocket garden");
    await git
      .getByLabel("Commit author name", { exact: true })
      .fill("Fixture Gardener");
    await git
      .getByLabel("Commit author email", { exact: true })
      .fill("fixture@example.test");
    await git
      .getByRole("button", { name: "Review commit", exact: true })
      .click();
    await expect(
      git.getByRole("region", { name: "Commit review", exact: true }),
    ).toBeVisible();
    await git
      .getByRole("textbox", { name: "Commit message", exact: true })
      .fill("Describe the garden clearly");
    await expect(
      git.getByRole("region", { name: "Commit review", exact: true }),
    ).toHaveCount(0);
    await git
      .getByRole("button", { name: "Review commit", exact: true })
      .click();
    const review = git.getByRole("region", {
      name: "Commit review",
      exact: true,
    });
    await review.locator("summary").click();
    await page.screenshot({
      path: path.join(root, "output/github-commit-review.png"),
      fullPage: true,
    });
    await review
      .getByRole("checkbox", { name: /I reviewed the selected/ })
      .click();
    await review
      .getByRole("button", { name: "Create local commit", exact: true })
      .click();
    await expect(git.getByText(/Local commit created: b{40}/)).toBeVisible();
    await expect(
      git.getByRole("button", { name: "Pull fast-forward", exact: true }),
    ).toBeEnabled();
    // A confirmed commit keeps the author available without leaving a dirty
    // form. A pull must invalidate an editor even after its Git tab unmounts.
    await page
      .getByRole("button", { name: "Files & editor", exact: true })
      .click();
    await page.getByRole("button", { name: "README.md", exact: true }).click();
    const fileEditor = page.getByRole("textbox", {
      name: "Edit README.md",
      exact: true,
    });
    await expect(fileEditor).toBeEditable();
    await page
      .getByRole("button", { name: "Git changes", exact: true })
      .click();
    await app.evaluate(() => {
      global.__githubSkillsFixture.holdPull = true;
    });
    await git
      .getByRole("button", { name: "Pull fast-forward", exact: true })
      .click();
    await expect
      .poll(() =>
        app.evaluate(() => Boolean(global.__githubSkillsFixture.completePull)),
      )
      .toBe(true);
    acceptDialog = true;
    await page
      .getByRole("button", { name: "Files & editor", exact: true })
      .click();
    await expect(fileEditor).not.toBeEditable();
    await page
      .getByRole("button", { name: "Reload file", exact: true })
      .click();
    await expect(fileEditor).toBeEditable();
    await app.evaluate(() => global.__githubSkillsFixture.completePull());
    await expect(fileEditor).not.toBeEditable();
    await expect(
      page.getByRole("button", { name: "Save file", exact: true }),
    ).toBeDisabled();
    await page
      .getByRole("button", { name: "Reload file", exact: true })
      .click();
    await expect(fileEditor).toBeEditable();
    await page
      .getByRole("button", { name: "Git changes", exact: true })
      .click();
    await git.getByRole("button", { name: "Review push", exact: true }).click();
    const push = git.getByRole("region", { name: "Push review", exact: true });
    await expect(
      push.getByRole("button", { name: "Request PC approval", exact: true }),
    ).toBeDisabled();
    await push
      .getByRole("checkbox", { name: /I reviewed the destination/ })
      .check();
    await page.screenshot({
      path: path.join(root, "output/github-push-review.png"),
      fullPage: true,
    });
    await push
      .getByRole("button", { name: "Request PC approval", exact: true })
      .click();
    await expect(git.getByText(/Push requested. It has not run/)).toBeVisible();
    acceptDialog = true;
    await git
      .getByRole("button", { name: "Open push approval", exact: true })
      .click();
    await expect(
      page.getByText("Push main to fixture/pocket-garden", { exact: true }),
    ).toBeVisible();
    const recorded = await app.evaluate(
      () => global.__githubSkillsFixture.calls,
    );
    assert.deepEqual(
      recorded.find((item) => item.route === "/api/github/import").body,
      {
        accountId: "fixture-github",
        repository: "fixture/pocket-garden",
        name: "Pocket garden",
      },
    );
    const preparation = recorded.filter((item) =>
      item.route.endsWith("/commit/prepare"),
    );
    assert.equal(preparation.length, 2);
    assert.deepEqual(preparation[1].body.paths, ["README.md"]);
    assert.equal(preparation[1].body.message, "Describe the garden clearly");
    assert.equal(
      recorded.filter((item) => item.route.endsWith("/commit")).length,
      1,
    );
    assert.equal(
      recorded.filter((item) => item.route.endsWith("/push")).length,
      1,
    );
    assert.equal(
      recorded.filter((item) => item.route.includes("/resolve")).length,
      0,
    );
    assert.deepEqual(errors, []);
    await fs.writeFile(
      path.join(root, "output/github-skills-ui-verification.json"),
      JSON.stringify(
        {
          verifiedAt: new Date().toISOString(),
          result: "passed",
          checks: [
            "Real local skill CRUD/persistence and reuse toggle",
            "Candidate review required, explicit accept and source detail",
            "Skill draft guard",
            "Account-bound synthetic repository list/import",
            "Dirty pull blocked; exact selected-file commit preview and changed-form invalidation",
            "Pull finishing after Git tab unmount invalidates an editor reloaded during the pending operation",
            "Local commit stays separate from exact push review and PC approval",
          ],
          limitations: [
            "GitHub transport and approval receipt simulated; no live account or push",
            "No provider inference, physical Android operation or external action",
          ],
          images: [
            "output/learned-skills.png",
            "output/github-commit-review.png",
            "output/github-push-review.png",
          ],
        },
        null,
        2,
      ) + "\n",
    );
    console.log("GitHub and learned-skills native UI fixture passed.");
  } catch (error) {
    console.error(error);
    if (fixturePage) {
      await fs.writeFile(
        path.join(profile, "failure.txt"),
        await fixturePage
          .locator("body")
          .innerText()
          .catch(() => "Page unavailable"),
      );
      await fixturePage
        .screenshot({ path: path.join(profile, "failure.png"), timeout: 5000 })
        .catch(() => {});
      console.error(`Fixture failure evidence: ${profile}`);
    }
    throw error;
  } finally {
    clearTimeout(deadline);
    const cleanupDeadline = setTimeout(() => app.process().kill(), 5000);
    try {
      await app
        .evaluate(({ BrowserWindow }) => {
          for (const window of BrowserWindow.getAllWindows()) window.destroy();
        })
        .catch(() => {});
      await app.close().catch(() => {});
    } finally {
      clearTimeout(cleanupDeadline);
    }
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
