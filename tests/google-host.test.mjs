import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { NakamaHost } from "../apps/host/host.mjs";
import { within } from "../apps/host/security.mjs";
test("Google writes honour the confirmation toggle and account-bound single-use approval", async (t) => {
  const base = await fs.realpath(os.tmpdir()),
    dir = await fs.mkdtemp(path.join(base, "nakama-google-")),
    host = await new NakamaHost({ dataDir: dir }).init();
  t.after(async () => {
    await host.close();
    assert.ok(
      within(base, dir) && path.basename(dir).startsWith("nakama-google-"),
    );
    await fs.rm(dir, { recursive: true, force: true });
  });
  const sent = [];
  host.google.account = (id, service) => {
    assert.equal(id, "personal");
    assert.equal(service, "gmail");
    return { email: "personal@example.com" };
  };
  host.google.send = async (id, body) => {
    sent.push({ id, body });
    return { id: "mail-id" };
  };
  const body = {
    to: "someone@example.com",
    subject: "User requested message",
    body: "Hello",
  };
  await host.dispatch("PATCH", "/api/settings", {
    confirmOrdinaryActions: true,
  });
  const approval = await host.dispatch(
    "POST",
    "/api/google/personal/send-email",
    body,
  );
  body.body = "tampered";
  assert.equal(sent.length, 0);
  await host.dispatch("POST", `/api/approvals/${approval.id}/resolve`, {
    approved: true,
  });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].body.body, "Hello");
  await assert.rejects(
    host.dispatch("POST", `/api/approvals/${approval.id}/resolve`, {
      approved: true,
    }),
    { status: 409 },
  );
  await host.dispatch("PATCH", "/api/settings", {
    confirmOrdinaryActions: false,
  });
  const result = await host.dispatch(
    "POST",
    "/api/google/personal/send-email",
    { ...body, body: "Explicit second message" },
  );
  assert.equal(result.completed, true);
  assert.equal(sent.length, 2);
});
