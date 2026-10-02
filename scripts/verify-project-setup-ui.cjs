/* Disposable native renderer fixture; no model, account, network or physical input. */
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const assert = require("node:assert/strict");
const playwrightPath =
  process.env.NAKAMA_PLAYWRIGHT ||
  path.join(
    os.homedir(),
    ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright",
  );
const { _electron } = require(playwrightPath);
const { expect } = require(path.join(playwrightPath, "test"));
(async () => {
  const root = path.resolve(__dirname, ".."),
    profile = path.join(root, "tmp", `setup-ui-${Date.now()}`);
  await fs.mkdir(profile, { recursive: true });
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
    page.setDefaultTimeout(10000);
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("dialog", (dialog) => void dialog.dismiss());
    await page.getByRole("navigation", { name: "Main navigation" }).waitFor();
    await app.evaluate(
      ({ ipcMain, nativeImage }, icon) => {
        const original = ipcMain._invokeHandlers.get("nakama:api");
        const fixture = (global.__setupFixture = {
          calls: [],
          session: null,
          image: nativeImage
            .createFromPath(icon)
            .resize({ width: 500 })
            .toJPEG(70)
            .toString("base64"),
        });
        ipcMain.removeHandler("nakama:api");
        ipcMain.handle("nakama:api", async (event, method, route, body) => {
          if (
            /^\/api\/(chat|commands|deployments|providers|kling|device\/actions)/.test(
              route,
            )
          )
            throw Error("External effects disabled in fixture");
          if (route === "/api/browser-studio") {
            const result = structuredClone({
              available: true,
              permitted: true,
              sessions: fixture.session ? [fixture.session] : [],
              detail:
                "Synthetic browser viewport; native Chromium behavior is checked separately.",
            });
            if (fixture.holdNextRead) {
              fixture.holdNextRead = false;
              await new Promise((resolve) => {
                fixture.releaseRead = resolve;
              });
            }
            return result;
          }
          if (route === "/api/browser-studio/sessions" && method === "POST") {
            fixture.session = {
              id: "browser-fixture",
              mode: body.mode,
              status: "ready",
              tainted: false,
              activeTabId: "tab-fixture",
              tabs: [
                {
                  id: "tab-fixture",
                  title: "Pocket Garden preview",
                  url: "https://example.invalid/",
                },
              ],
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            };
            return fixture.session;
          }
          if (route.startsWith("/api/browser-studio/sessions/")) {
            fixture.calls.push({ method, route, body });
            if (route.endsWith("/frame")) {
              const frame = {
                sessionId: "browser-fixture",
                tabId: "tab-fixture",
                frameId: "frame-fixture",
                width: 500,
                height: 500,
                image: `data:image/jpeg;base64,${fixture.image}`,
                capturedAt: new Date().toISOString(),
                expiresAt: new Date(Date.now() + 3000).toISOString(),
              };
              if (fixture.holdNextFrame) {
                fixture.holdNextFrame = false;
                await new Promise((resolve) => {
                  fixture.releaseFrame = resolve;
                });
              }
              return frame;
            }
            if (route.endsWith("/control") && body.kind === "tap")
              assertNormalized(body);
            if (route.endsWith("/takeover")) {
              fixture.session.controller = { kind: "owner", id: "desktop" };
              fixture.session.tainted = true;
              fixture.session.status = "human_control";
            }
            if (route.endsWith("/release")) {
              fixture.session.controller = null;
              fixture.session.status = "ready";
            }
            if (method === "DELETE") {
              fixture.session = null;
              return { closed: true };
            }
            return fixture.session;
          }
          return original(event, method, route, body);
        });
        function assertNormalized(body) {
          if (
            !Number.isFinite(body.x) ||
            !Number.isFinite(body.y) ||
            body.x < 0 ||
            body.x > 1 ||
            body.y < 0 ||
            body.y > 1
          )
            throw Error("Tap coordinates must be normalized to 0..1");
        }
      },
      path.join(root, "apps/desktop/assets/icon.png"),
    );
    await page
      .getByRole("button", { name: "Project setup", exact: true })
      .click();
    await page
      .getByLabel("Describe the website and where it should run")
      .fill(
        "Build a garden website with admin and a shop, hosted on Vercel with a new domain.",
      );
    await page.getByRole("button", { name: "Gather setup questions" }).click();
    const card = page.locator(".setup-card");
    await expect(card).toBeVisible();
    await expect(card.locator("textarea")).toHaveCount(10);
    await card
      .locator("textarea")
      .first()
      .fill("Use a new private repository after reviewing the account.");
    await page
      .getByRole("button", { name: "Nakama browser", exact: true })
      .click();
    await expect(card).toBeVisible(); // Navigation confirmation dismissed: draft survives.
    await expect(card.locator("textarea").first()).toHaveValue(
      /new private repository/,
    );
    await card
      .getByRole("button", { name: "Save answers", exact: true })
      .click();
    await expect(
      card.getByRole("button", { name: "Save answers", exact: true }),
    ).toBeDisabled();
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({
      path: path.join(root, "output/project-setup.png"),
      fullPage: true,
    });
    await page
      .getByRole("button", { name: "Nakama browser", exact: true })
      .click();
    await page.getByLabel("Website address").fill("https://example.invalid/");
    await page
      .getByRole("button", { name: "Open browser", exact: true })
      .click();
    await expect(page.getByAltText("Live browser page")).toBeVisible();
    await page
      .getByRole("button", { name: "Take control", exact: true })
      .click();
    const liveImage = page.getByAltText("Live browser page");
    await expect(liveImage).toBeVisible();
    const imageBounds = await liveImage.boundingBox();
    await liveImage.click({
      position: { x: imageBounds.width * 0.25, y: imageBounds.height * 0.75 },
    });
    await expect(
      page.getByRole("button", { name: "Enter", exact: true }),
    ).toBeEnabled();
    await page
      .getByLabel("Text for the focused field")
      .fill("synthetic typed value");
    assert.equal(
      await page.getByLabel("Text for the focused field").getAttribute("type"),
      "password",
    );
    await page
      .getByRole("button", { name: "Type into page", exact: true })
      .click();
    await expect(page.getByLabel("Text for the focused field")).toHaveValue("");
    await expect(
      page.getByRole("button", { name: "Scroll down", exact: true }),
    ).toBeEnabled();
    await page
      .getByRole("button", { name: "Scroll down", exact: true })
      .click();
    const calls = await app.evaluate(() => global.__setupFixture.calls);
    assert.ok(
      calls.some(
        (c) =>
          c.route.endsWith("/control") &&
          c.body.kind === "text" &&
          c.body.text === "synthetic typed value",
      ),
    );
    assert.ok(
      calls.some((c) => c.route.endsWith("/control") && c.body.deltaY === 5),
    );
    assert.ok(
      calls.some(
        (c) =>
          c.route.endsWith("/control") &&
          c.body.kind === "tap" &&
          Math.abs(c.body.x - 0.25) < 0.01 &&
          Math.abs(c.body.y - 0.75) < 0.01,
      ),
    );
    await expect(liveImage).toBeVisible();
    await liveImage.evaluate(async (image) => {
      await image.decode();
      await new Promise((resolve) => requestAnimationFrame(resolve));
    });
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({
      path: path.join(root, "output/nakama-browser.png"),
      fullPage: true,
    });
    // Return an older owner-controlled snapshot and frame only after release.
    // Neither late response may restore private pixels or active controls.
    await app.evaluate(() => {
      global.__setupFixture.holdNextRead = true;
      global.__setupFixture.holdNextFrame = true;
    });
    await page
      .getByRole("button", { name: "Refresh status", exact: true })
      .click();
    await expect
      .poll(() =>
        app.evaluate(() =>
          Boolean(
            global.__setupFixture.releaseRead &&
            global.__setupFixture.releaseFrame,
          ),
        ),
      )
      .toBe(true);
    await page
      .getByRole("button", { name: "Release control", exact: true })
      .click();
    await expect(page.getByLabel("Text for the focused field")).toHaveCount(0);
    await expect(liveImage).toHaveCount(0);
    await app.evaluate(() => {
      global.__setupFixture.releaseRead();
      global.__setupFixture.releaseFrame();
    });
    await expect(
      page.getByText("Private user session · screen hidden from agents", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(page.getByLabel("Text for the focused field")).toHaveCount(0);
    await expect(liveImage).toHaveCount(0);
    await page
      .getByRole("button", { name: "Close session", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Choose a browser" }),
    ).toBeVisible();
    assert.deepEqual(errors, []);
    await fs.writeFile(
      path.join(root, "output/project-setup-ui-verification.json"),
      JSON.stringify(
        {
          checkedAt: new Date().toISOString(),
          synthetic: true,
          checks: [
            "Real setup intake persistence and partial answers",
            "Dirty answer blocks page navigation",
            "Browser session/create/frame/takeover/release UI",
            "Tap uses normalized coordinates",
            "Password field clears after explicit typing",
            "Scroll uses bounded five-unit gesture",
            "Late snapshot and frame cannot restore private content after release",
            "Closed session no longer rendered",
          ],
          outputs: ["output/project-setup.png", "output/nakama-browser.png"],
        },
        null,
        2,
      ) + "\n",
    );
    console.log("Project setup and browser UI fixture passed.");
  } catch (error) {
    if (page)
      await page
        .screenshot({ path: path.join(profile, "failure.png"), fullPage: true })
        .catch(() => {});
    throw error;
  } finally {
    clearTimeout(deadline);
    await app.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
