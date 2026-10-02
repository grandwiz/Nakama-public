import test from "node:test";
import assert from "node:assert/strict";
import {
  parseServiceRequest,
  serviceAgentAction,
} from "../apps/host/service-agent.mjs";

const OWNER = { kind: "owner", id: "desktop" };
function fixture() {
  const plan = {
    id: "plan",
    hash: "hash",
    projectId: "project",
    provider: "vercel",
    accountId: "account",
    action: "vercel.project.create",
    settings: { name: "fixture" },
    summary: "Create fixture",
    expiresAt: new Date(Date.now() + 60000).toISOString(),
  };
  const writes = [],
    approvals = [],
    operations = [];
  let stopped = false;
  const context = {
    principal: OWNER,
    projectId: "project",
    guard() {
      if (stopped) throw new Error("Stopped");
    },
  };
  const host = {
    store: {
      state: {
        projectGrants: [],
        connections: [
          {
            id: "vercel",
            accounts: [{ id: "account", accountLabel: "Synthetic account" }],
          },
        ],
      },
    },
    project(id) {
      assert.equal(id, "project");
      return { id };
    },
    provisioning: {
      access() {},
      list() {
        return {
          plans: [plan],
          operations,
          secrets: [{ id: "secret-ref", name: "Database reference" }],
        };
      },
      listPlans() {
        return [plan];
      },
      listOperations() {
        return operations;
      },
      async prepare(body) {
        assert.equal(body.projectId, "project");
        return plan;
      },
      async verify(id) {
        return { id, status: "verified" };
      },
      async execute(id, authority, options) {
        options.guard();
        writes.push({ id, authority });
        return { id: "receipt", planId: id, status: "submitted" };
      },
    },
    projectGrants: {
      authorize(p, authority) {
        const grant = host.store.state.projectGrants.find(
          (row) => row.id === authority.grantId,
        );
        if (
          !grant ||
          grant.projectId !== p.projectId ||
          grant.accountId !== p.accountId ||
          grant.name !== p.settings.name
        )
          throw new Error("Unmatched");
        return { id: grant.id };
      },
    },
    async approval(...args) {
      args[5].guard();
      approvals.push(args);
      return { id: "approval" };
    },
  };
  return {
    host,
    context,
    plan,
    writes,
    approvals,
    operations,
    stop() {
      stopped = true;
    },
  };
}
test("service tool grammar excludes arbitrary request/deletion/raw-secret routes", () => {
  assert.equal(parseServiceRequest("Normal answer"), null);
  assert.throws(() =>
    parseServiceRequest(
      '```nakama-service\n{"action":"request","url":"https://arbitrary"}\n```',
    ),
  );
  assert.throws(() =>
    parseServiceRequest(
      '```nakama-service\n{"action":"execute","planId":"p","planHash":"h","grantId":"invented"}\n```',
    ),
  );
});
test("service coordinator prepares canonical project-bound plans and requests exact approval without a matching grant", async () => {
  const f = fixture();
  const prepared = await serviceAgentAction(
    f.host,
    {
      action: "prepare",
      provider: "vercel",
      accountId: "account",
      operation: "vercel.project.create",
      settings: { name: "fixture" },
    },
    f.context,
  );
  assert.equal(prepared.plan.id, "plan");
  f.host.store.state.projectGrants.push({
    id: "wrong",
    projectId: "other",
    accountId: "account",
    name: "fixture",
  });
  const pending = await serviceAgentAction(
    f.host,
    { action: "execute", planId: "plan", planHash: "hash" },
    f.context,
  );
  assert.equal(pending.pendingApprovalId, "approval");
  assert.equal(f.writes.length, 0);
  assert.deepEqual(f.approvals[0][3], { planId: "plan", planHash: "hash" });
});
test("only existing matching project/account/resource grants are consumed and uncertain attempts never repeat", async () => {
  const f = fixture();
  f.host.store.state.projectGrants.push({
    id: "grant",
    projectId: "project",
    accountId: "account",
    name: "fixture",
  });
  const result = await serviceAgentAction(
    f.host,
    { action: "execute", planId: "plan", planHash: "hash" },
    f.context,
  );
  assert.equal(result.operation.status, "submitted");
  assert.deepEqual(f.writes, [{ id: "plan", authority: { grantId: "grant" } }]);
  assert.equal(f.approvals.length, 0);
  f.operations.push({ id: "receipt", planId: "plan", status: "unconfirmed" });
  await assert.rejects(
    serviceAgentAction(
      f.host,
      { action: "execute", planId: "plan", planHash: "hash" },
      f.context,
    ),
    /already attempted/,
  );
});
test("service coordinator cannot cross projects, emit saved secret values or act after its guard stops", async () => {
  const f = fixture();
  const list = await serviceAgentAction(f.host, { action: "list" }, f.context);
  assert.deepEqual(list.secrets, [
    { id: "secret-ref", name: "Database reference" },
  ]);
  assert.deepEqual(list.accounts, [
    { provider: "vercel", id: "account", label: "Synthetic account" },
  ]);
  await assert.rejects(
    serviceAgentAction(
      f.host,
      { action: "verify", operationId: "other-project-operation" },
      f.context,
    ),
    /coordinator's project/,
  );
  f.stop();
  await assert.rejects(
    serviceAgentAction(
      f.host,
      { action: "execute", planId: "plan", planHash: "hash" },
      f.context,
    ),
    /Stopped/,
  );
  assert.equal(f.approvals.length, 0);
  assert.equal(f.writes.length, 0);
});
