// Run after npm run build. Uses a disposable native profile and a simulated
// paired browser on the host's ephemeral loopback port. It verifies queueing
// and approvals only: no website is opened or changed, and no account calls,
// model calls, screenshot captures, or clipboard operations are performed.
const fs = require("node:fs/promises");
const path = require("node:path");
const assert = require("node:assert/strict");
const playwrightPath =
  process.env.NAKAMA_PLAYWRIGHT ||
  require("node:path").join(require("node:os").homedir(), ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright");
const { _electron } = require(playwrightPath);

(async () => {
  const root = path.resolve(__dirname, "..");
  const testRoot = path.join(root, "tmp", `browser-select-ui-${Date.now()}`);
  const projects = path.join(testRoot, "projects");
  await fs.mkdir(projects, { recursive: true });
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
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].webContents.setBackgroundThrottling(
        false,
      ),
    );
    page.setDefaultTimeout(20000);
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const ticket = await page.evaluate(async (folder) => {
      await window.nakama.api("PATCH", "/api/settings", {
        workspaceRoot: folder,
        confirmOrdinaryActions: false,
      });
      return window.nakama.api("POST", "/api/pairing/tickets", {
        platform: "chrome",
      });
    }, projects);
    assert.ok(Number.isSafeInteger(ticket.port) && ticket.port > 0);
    const request = async (
      route,
      token,
      body,
      method = body ? "POST" : "GET",
    ) => {
      const response = await fetch(`http://127.0.0.1:${ticket.port}${route}`, {
        method,
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(10000),
      });
      const result = await response.json();
      assert.equal(
        response.status,
        200,
        result.error || "Local fixture request failed.",
      );
      return result;
    };
    const paired = await request("/api/pair", undefined, {
      ticket: ticket.ticket,
      platform: "chrome",
      name: "Dropdown UI fixture",
      capabilities: ["browser_select"],
    });
    const queue = () => request("/api/device/actions", paired.token);
    const acknowledgeFixture = (id) =>
      request(`/api/device/actions/${id}/result`, paired.token, {
        status: "blocked",
        message: "Local UI fixture only; no website action was performed.",
      });
    await page.reload();
    const nav = page.getByRole("navigation", { name: "Main navigation" });
    const openComposer = async () => {
      await nav.getByRole("button", { name: "Devices", exact: true }).click();
      await page
        .getByRole("combobox", { name: "Action", exact: true })
        .selectOption("browser_select");
      await page
        .getByRole("spinbutton", { name: "Browser tab ID", exact: true })
        .fill("7");
      await page
        .getByRole("textbox", { name: "Dropdown selector", exact: true })
        .fill('[data-nakama-control="2"]');
    };
    const send = () =>
      page.getByRole("button", { name: "Send action", exact: true }).click();
    await openComposer();
    const value = page.getByRole("textbox", {
      name: "Exact option value",
      exact: true,
    });
    assert.equal(await value.getAttribute("maxlength"), "200");
    assert.equal(await value.getAttribute("required"), null);
    assert.equal(await value.inputValue(), "");
    assert.equal(
      await page
        .getByRole("textbox", { name: "Dropdown selector", exact: true })
        .getAttribute("maxlength"),
      "300",
    );

    await page
      .getByRole("spinbutton", { name: "Browser tab ID", exact: true })
      .fill("0");
    await send();
    await page
      .getByText("Enter a positive whole-number browser tab ID.", {
        exact: true,
      })
      .waitFor();
    assert.equal((await queue()).actions.length, 0);
    await page
      .getByRole("spinbutton", { name: "Browser tab ID", exact: true })
      .fill("7");
    await page
      .getByRole("textbox", { name: "Dropdown selector", exact: true })
      .fill("   ");
    await send();
    await page
      .getByText("Enter the dropdown selector from a recent page read.", {
        exact: true,
      })
      .waitFor();
    assert.equal((await queue()).actions.length, 0);
    await page
      .getByRole("textbox", { name: "Dropdown selector", exact: true })
      .fill('[data-nakama-control="2"]');

    await send();
    await page
      .getByText("Action queued. Wait for the device to report its result.", {
        exact: true,
      })
      .waitFor();
    const direct = (await queue()).actions;
    assert.equal(direct.length, 1);
    assert.equal(direct[0].type, "browser_select");
    assert.deepEqual(direct[0].args, {
      tabId: 7,
      selector: '[data-nakama-control="2"]',
      value: "",
    });
    await acknowledgeFixture(direct[0].id);

    await page.evaluate(() =>
      window.nakama.api("PATCH", "/api/settings", {
        confirmOrdinaryActions: true,
      }),
    );
    await page.reload();
    await openComposer();
    const exactValue = "  option:β/2  ";
    await value.fill(exactValue);
    await send();
    await page
      .getByText("Device request sent for desktop approval.", { exact: true })
      .waitFor();
    assert.equal(
      (await queue()).actions.length,
      0,
      "Approval must precede dispatch.",
    );
    await nav.getByRole("button", { name: /^Activity & approvals/ }).click();
    await page
      .getByRole("button", { name: "Approve this action", exact: true })
      .click();
    await page
      .getByText(
        "Approval recorded. Check the resulting activity for its outcome.",
        { exact: true },
      )
      .waitFor();
    const approved = (await queue()).actions;
    assert.equal(approved.length, 1);
    assert.equal(approved[0].type, "browser_select");
    assert.deepEqual(approved[0].args, {
      tabId: 7,
      selector: '[data-nakama-control="2"]',
      value: exactValue,
    });
    await acknowledgeFixture(approved[0].id);

    await openComposer();
    await value.fill("");
    await send();
    await page
      .getByText("Device request sent for desktop approval.", { exact: true })
      .waitFor();
    assert.equal((await queue()).actions.length, 0);
    await nav.getByRole("button", { name: /^Activity & approvals/ }).click();
    await page.getByRole("button", { name: "Decline", exact: true }).click();
    await page.getByText("Action declined.", { exact: true }).waitFor();
    assert.equal(
      (await queue()).actions.length,
      0,
      "Declined dropdown changes must not dispatch.",
    );
    assert.equal(errors.length, 0, errors.join("\n"));
    console.log(
      JSON.stringify({
        passed: true,
        checks: [
          "native dropdown composer",
          "safe integer tab ID and nonblank selector",
          "explicit empty value",
          "exact whitespace and Unicode value",
          "no dispatch before approval",
          "approved argument shape",
          "decline prevents dispatch",
          "no renderer errors",
          "no real website or account actions",
          "no clipboard access",
        ],
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
