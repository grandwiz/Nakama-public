/* Disposable native UI fixture: only local preparation and pending approvals.
 * No external service write, model execution, provider test, or real device. */
const fs = require("node:fs/promises"),
  path = require("node:path"),
  os = require("node:os"),
  assert = require("node:assert/strict"),
  { pathToFileURL } = require("node:url");
const runtime =
  process.env.NAKAMA_PLAYWRIGHT ||
  path.join(
    os.homedir(),
    ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright",
  );
const { _electron } = require(runtime),
  { expect } = require(path.join(runtime, "test"));
(async () => {
  const root = path.resolve(__dirname, ".."),
    profile = path.join(root, "tmp", `delivery-ui-${Date.now()}`),
    stamp = new Date().toISOString();
  const { initialState } = await import(
      pathToFileURL(path.join(root, "apps/host/store.mjs")).href
    ),
    state = initialState();
  state.config.workspaceRoot = path.join(profile, "projects");
  state.projects = [
    {
      id: "fixture-garden",
      name: "Pocket Garden · synthetic fixture",
      description: "Disposable UI example",
      path: path.join(profile, "projects", "garden"),
      status: "ready",
      updatedAt: stamp,
    },
  ];
  state.devices = [
    {
      id: "fixture-phone",
      name: "Fixture phone",
      platform: "android",
      pairedAt: stamp,
      lastSeen: stamp,
      permissions: {
        projectAccess: true,
        googleAccess: true,
        browserControl: true,
      },
    },
  ];
  state.projectWorkflows = [
    {
      id: "fixture-workflow",
      projectId: "fixture-garden",
      status: "completed",
      stage: "completed",
      message: "Build a garden planner (synthetic fixture)",
      createdAt: stamp,
      updatedAt: stamp,
      requestedBy: "desktop",
      assignments: {
        manager: { providerId: "codex", model: "fixture", effort: "low" },
        peer: { providerId: "claude", model: "fixture", effort: "high" },
        development: { providerId: "claude", model: "fixture", effort: "high" },
      },
      reviews: [],
      taskIds: [],
      workItems: [],
    },
  ];
  state.projectDeliveries = [
    {
      id: "fixture-delivery",
      projectId: "fixture-garden",
      workflowId: "fixture-workflow",
      status: "review_required",
      round: 1,
      taskIds: [],
      summary:
        "Synthetic manager receipt: service settings are ready for owner review. No deployment or live acceptance has been performed.",
      liveVerified: false,
      questions: [],
      acceptance: [],
      createdAt: stamp,
      requestedBy: "desktop",
    },
  ];
  state.provisioningOperations = [
    {
      id: "fixture-operation",
      planId: "fixture-historical-plan",
      planHash: "synthetic",
      provider: "vercel",
      action: "vercel.deployment.create",
      accountId: "fixture-vercel",
      projectId: "fixture-garden",
      status: "submitted",
      startedAt: stamp,
      result: {
        resourceId: "dpl_synthetic",
        providerStatus: "BUILDING",
        message: "Synthetic fixture, not a live provider request.",
      },
    },
  ];
  await fs.mkdir(path.join(profile, "private"), { recursive: true });
  await fs.mkdir(state.projects[0].path, { recursive: true });
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
  const deadline = setTimeout(() => app.process().kill(), 90000);
  let page;
  try {
    page = await app.firstWindow();
    await page.waitForLoadState("domcontentloaded");
    await expect(
      page
        .getByText("Pocket Garden · synthetic fixture", { exact: true })
        .first(),
    ).toBeVisible();
    await page.evaluate(() =>
      window.nakama.api("POST", "/api/connections/github", {
        accountLabel: "Synthetic GitHub account",
        token: "fixture-only-not-a-real-provider-credential",
      }),
    );
    await page.getByRole("button", { name: "Delivery", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Let Nakama coordinate delivery" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Start delivery", exact: true }),
    ).toBeEnabled();
    await page
      .getByLabel("Repository name", { exact: true })
      .fill("garden-fixture");
    await expect(
      page.getByRole("checkbox", { name: "Private repository", exact: true }),
    ).toBeChecked();
    await page
      .getByRole("button", { name: "Prepare for review", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Create a repository", exact: true }),
    ).toBeVisible();
    const list = await page.evaluate(() =>
      window.nakama.api("GET", "/api/projects/fixture-garden/provisioning"),
    );
    assert.equal(list.plans.length, 1);
    assert.equal(list.plans[0].settings.private, true);
    assert.equal(list.operations.length, 1);
    assert.equal(list.plans[0].accountBinding, undefined);
    await page
      .getByRole("button", { name: "Authorize a bounded scope", exact: true })
      .click();
    await expect(page.getByLabel("Duration in hours")).toHaveValue("1");
    await expect(page.getByLabel("Maximum operations")).toHaveValue("1");
    await page
      .getByRole("button", {
        name: "Review scope in Windows approvals",
        exact: true,
      })
      .click();
    await expect(
      page.getByText(
        "Authorize service work for Pocket Garden · synthetic fixture",
        { exact: true },
      ),
    ).toBeVisible();
    const after = await page.evaluate(() =>
      window.nakama.api("GET", "/api/state"),
    );
    const approval = after.approvals.find((a) => a.type === "project_grant");
    assert.equal(approval.status, "pending");
    assert.equal(after.projectGrants.length, 0);
    await page.getByRole("button", { name: "Delivery", exact: true }).click();
    await page
      .getByLabel("Secret label", { exact: true })
      .fill("Synthetic database");
    await page
      .getByLabel("Secret value", { exact: true })
      .fill("synthetic-password-never-a-real-secret");
    await page
      .getByRole("button", { name: "Save secret", exact: true })
      .click();
    await expect(page.getByLabel("Secret value", { exact: true })).toHaveValue(
      "",
    );
    await expect(
      page.getByRole("listitem").filter({ hasText: "Synthetic database" }),
    ).toBeVisible();
    const secrets = await page.evaluate(() =>
      window.nakama.api("GET", "/api/projects/fixture-garden/provisioning"),
    );
    assert.equal(secrets.secrets.length, 1);
    assert.ok(!JSON.stringify(secrets).includes("synthetic-password"));
    await page
      .getByLabel("Secret value", { exact: true })
      .fill("discarded-fixture-value");
    page.once("dialog", (dialog) => dialog.dismiss());
    await page.getByRole("button", { name: "Overview", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Delivery", exact: true }),
    ).toBeVisible();
    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "Overview", exact: true }).click();
    await page.getByRole("button", { name: "Delivery", exact: true }).click();
    await expect(page.getByLabel("Secret value", { exact: true })).toHaveValue(
      "",
    );
    await page
      .getByRole("combobox", { name: "Trusted phone", exact: true })
      .selectOption("fixture-phone");
    await page
      .getByLabel("New account label", { exact: true })
      .fill("Synthetic mobile account");
    await page
      .getByRole("button", { name: "Send connection request", exact: true })
      .click();
    await expect(
      page.getByText("Waiting on Fixture phone", { exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", {
        name: "Cancel Synthetic mobile account connection request",
        exact: true,
      })
      .click();
    await expect(
      page.getByText("Waiting on Fixture phone", { exact: true }),
    ).toHaveCount(0);
    await page
      .getByRole("combobox", { name: "Provider", exact: true })
      .selectOption("render");
    await expect(
      page.getByText(
        /Render immediately starts the first build and deployment/,
      ),
    ).toBeVisible();
    await expect(
      page.getByRole("combobox", { name: "Compute plan", exact: true }),
    ).toHaveValue("free");
    await page
      .getByRole("combobox", { name: "Provider", exact: true })
      .selectOption("github");
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({
      path: path.join(root, "output/project-delivery.png"),
      fullPage: true,
    });
    assert.equal(
      (
        await page.evaluate(() =>
          window.nakama.api("GET", "/api/projects/fixture-garden/provisioning"),
        )
      ).operations.length,
      1,
    );
    await fs.writeFile(
      path.join(root, "output/project-delivery-verification.json"),
      JSON.stringify(
        {
          checkedAt: new Date().toISOString(),
          synthetic: true,
          externalWrites: 0,
          modelRuns: 0,
          checks: [
            "Friendly provider/action forms",
            "Local private-default plan preparation",
            "Pending Windows grant approval only",
            "Password field clearing and private DTO",
            "Unsaved secret navigation cancel/discard",
            "Synthetic phone handoff/cancel",
            "Render initial deployment disclosure",
            "Coordinator status/start control and honest provider receipts",
          ],
          outputs: ["output/project-delivery.png"],
        },
        null,
        2,
      ),
    );
    console.log(
      "Delivery native UI fixture passed; no provider or model calls.",
    );
  } catch (error) {
    if (page) {
      await page
        .screenshot({ path: path.join(profile, "failure.png") })
        .catch(() => {});
      await fs.writeFile(
        path.join(profile, "failure.txt"),
        await page
          .locator("body")
          .innerText()
          .catch(() => "Unavailable"),
      );
    }
    console.error(`Fixture evidence: ${profile}`);
    throw error;
  } finally {
    clearTimeout(deadline);
    await app
      .evaluate(({ BrowserWindow }) => {
        for (const window of BrowserWindow.getAllWindows()) window.destroy();
      })
      .catch(() => {});
    await app.close().catch(() => {});
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
