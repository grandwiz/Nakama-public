import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { NakamaHost } from "../apps/host/host.mjs";
import { navigationOutcome } from "../apps/desktop/renderer/src/agent-office-model.ts";
const OWNER = { kind: "owner", id: "desktop" };
async function fixture(t) {
  const dir = await fs.mkdtemp(
    path.join(os.tmpdir(), "nakama-monitor-integration-"),
  );
  let calls = 0;
  const host = await new NakamaHost({
    dataDir: dir,
    runAgent() {
      calls++;
      throw new Error("Live inference forbidden in fixture");
    },
    monitorAdapter: {
      windowsAvailable: true,
      checkWindows: async () => ({ outcome: "match" }),
    },
  }).init();
  clearInterval(host.monitoring.timer);
  t.after(async () => {
    await host.close();
    await fs.rm(dir, { recursive: true, force: true });
  });
  return { host, calls: () => calls };
}
test("host monitoring and upgrade requests remain local, privacy gated and current-record notifications", async (t) => {
  const { host, calls } = await fixture(t);
  const created = await host.dispatch("POST", "/api/monitors", {
    title: "Fixture process",
    kind: "windows_app",
    processName: "fixture.exe",
    condition: { contains: "Ready" },
  });
  const row = created.monitor || created;
  await host.dispatch("POST", `/api/monitors/${row.id}/resume`, {
    revision: row.revision,
  });
  await host.monitoring.tick();
  const snapshot = await host.dispatch("GET", "/api/state");
  assert.equal(snapshot.monitoring.monitors[0].lastOutcome, "match");
  assert.equal(snapshot.monitors, undefined);
  const notice = snapshot.attention.items.find(
    (item) => item.kind === "monitor",
  );
  assert.ok(notice);
  assert.equal(JSON.stringify(notice).includes("Fixture process"), false);
  assert.deepEqual(
    (await host.dispatch("POST", "/api/attention/open", { id: notice.id }))
      .outcome,
    { type: "navigate", target: "monitoring" },
  );
  const fresh = host.monitoring.list(OWNER).monitors[0];
  await host.dispatch("POST", `/api/monitors/${row.id}/acknowledge`, {
    revision: fresh.revision,
  });
  await assert.rejects(
    host.dispatch("POST", "/api/attention/open", { id: notice.id }),
    /ended|available/,
  );
  const upgrade = await host.localAssistant.handle(
    { message: "Nakama, improve yourself with a clearer settings page" },
    OWNER,
  );
  assert.equal(upgrade.outcome.target, "self-maintenance");
  assert.equal(host.selfMaintenance.list(OWNER).requests[0].status, "held");
  await host.store.change((state) =>
    state.devices.push({
      id: "blocked",
      platform: "android",
      permissions: {
        projectAccess: false,
        googleAccess: false,
        browserControl: true,
      },
    }),
  );
  const phone = { kind: "device", id: "blocked" };
  const privateView = await host.dispatch("GET", "/api/state", {}, phone);
  assert.deepEqual(privateView.monitoring.monitors, []);
  assert.deepEqual(privateView.selfMaintenance.requests, []);
  await assert.rejects(
    host.dispatch("GET", "/api/monitors", {}, phone),
    /unavailable|disabled/,
  );
  assert.equal(calls(), 0);
});
test("direct stock navigation creates paused locale-independent monitor without provider calls", async (t) => {
  const { host, calls } = await fixture(t);
  const result = await host.localAssistant.handle(
    { message: "monitor https://shop.example/fr/produit for restock" },
    OWNER,
  );
  assert.equal(result.outcome.target, "monitoring");
  const [row] = host.monitoring.list(OWNER).monitors;
  assert.equal(result.outcome.monitorId, row.id);
  assert.deepEqual(row.condition, { type: "stock" });
  assert.equal(row.status, "paused");
  assert.equal(calls(), 0);
  assert.equal(row.profileId, undefined);
  const response = await host.localAssistant.handle(
    { message: "Nakama, open up that captcha for me to fill in" },
    OWNER,
  );
  assert.equal(response.outcome.target, "monitoring");
  assert.match(response.reply, /No current/);
});
test("browser handoff navigation accepts only an opaque session ID for the browser target", () => {
  assert.deepEqual(
    navigationOutcome(
      { type: "navigate", target: "browser", browserSessionId: "session-123" },
      [],
    ),
    { target: "browser", browserSessionId: "session-123" },
  );
  for (const value of ["https://private.example/checkout", "../path", ""])
    assert.equal(
      navigationOutcome(
        { type: "navigate", target: "browser", browserSessionId: value },
        [],
      ),
      null,
    );
  assert.equal(
    navigationOutcome(
      { type: "navigate", target: "settings", browserSessionId: "session-123" },
      [],
    ),
    null,
  );
});
