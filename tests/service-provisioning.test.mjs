import test from "node:test";
import assert from "node:assert/strict";
import {
  ServiceProvisioning,
  PROVISIONING_LIMITS,
} from "../apps/host/service-provisioning.mjs";

const OWNER = { kind: "owner", id: "desktop" },
  PHONE = { kind: "device", id: "phone" },
  SHA = "a".repeat(40);
function fixture(responses = [], options = {}) {
  const state = {
    projects: [
      { id: "project", path: "/fixture/project" },
      { id: "other", path: "/fixture/other" },
    ],
    connections: ["github", "vercel", "render", "neon", "namecheap"].map(
      (id) => ({
        id,
        accounts: [{ id: "account", accountLabel: "Synthetic account" }],
      }),
    ),
    devices: [
      {
        id: "phone",
        platform: "android",
        permissions: { googleAccess: true, projectAccess: true },
      },
    ],
    approvals: [],
  };
  const secrets = new Map(
    state.connections.map((c) => [
      `${c.id}:account`,
      `${c.id}-SYNTHETIC-CREDENTIAL`,
    ]),
  );
  secrets.set(
    "namecheap:account",
    JSON.stringify({
      apiUser: "fixture",
      apiKey: "synthetic_namecheap_key_only",
      userName: "fixture",
      clientIp: "192.0.2.10",
    }),
  );
  let queue = Promise.resolve();
  const calls = [];
  const store = {
    state,
    change(fn) {
      const work = queue.then(() => fn(state));
      queue = work.catch(() => {});
      return work;
    },
  };
  const vault = {
    get: async (key) => secrets.get(key),
    set: async (key, value) => {
      secrets.set(key, value);
    },
  };
  const service = new ServiceProvisioning({
    store,
    vault,
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      const next = responses.shift();
      if (next instanceof Error) throw next;
      if (typeof next === "function") return next(url, options);
      if (next instanceof Response) return next;
      return new Response(JSON.stringify(next ?? {}), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
    ...options,
  });
  const body = (action, settings) => ({
    provider: action.split(".")[0],
    action,
    accountId: "account",
    projectId: "project",
    settings,
  });
  const approve = (plan) => {
    const id = `approval-${state.approvals.length}`;
    state.approvals.push({
      id,
      type: "service_provision",
      status: "executing",
      expiresAt: new Date(Date.now() + 60000).toISOString(),
      requestedBy: "desktop",
      operation: { planId: plan.id, planHash: plan.hash },
    });
    return id;
  };
  return { service, state, secrets, store, vault, calls, body, approve };
}
test("preparation is local and canonical, private by default, and all public projections omit binding data", async () => {
  const f = fixture();
  await f.service.init();
  const plan = await f.service.prepare(
    f.body("github.repository.create", { name: "fixture" }),
    OWNER,
  );
  assert.equal(f.calls.length, 0);
  assert.equal(plan.settings.private, true);
  assert.match(plan.hash, /^[a-f0-9]{64}$/);
  assert.equal(plan.accountBinding, undefined);
  assert.equal(plan.projectBinding, undefined);
  assert.equal(plan.requestedBy, undefined);
  assert.equal(f.service.listPlans("project", OWNER).length, 1);
  assert.deepEqual(f.service.listOperations("project", OWNER), []);
  assert.ok(
    !JSON.stringify(f.service.list("project", OWNER)).includes(
      "SYNTHETIC-CREDENTIAL",
    ),
  );
});
test("paired Android permissions and transport are rechecked, while secret creation remains owner only", async () => {
  const f = fixture();
  const input = f.body("github.repository.create", { name: "fixture" });
  await f.service.prepare(input, PHONE);
  await assert.rejects(
    f.service.saveSecret(
      { projectId: "project", name: "DB", value: "private" },
      PHONE,
    ),
    { status: 403 },
  );
  f.state.devices[0].permissions.googleAccess = false;
  await assert.rejects(f.service.prepare(input, PHONE), { status: 403 });
  assert.throws(() => f.service.list("project", PHONE), { status: 403 });
  await assert.rejects(f.service.prepare(input, { kind: "mcp", id: "phone" }), {
    status: 403,
  });
});
test("strict action settings reject arbitrary URLs, purchases, deletion, unsafe refs and extra authority fields", async () => {
  const f = fixture();
  for (const [action, settings] of [
    ["github.repository.delete", { name: "fixture" }],
    ["namecheap.domain.purchase", {}],
    [
      "github.repository.create",
      { name: "fixture", url: "https://bad.invalid" },
    ],
    [
      "vercel.domain.add",
      { remoteProjectId: "prj_1", domain: "https://example.test" },
    ],
    [
      "render.service.create",
      {
        name: "app",
        ownerId: "own_1",
        repository: "fixture/app",
        branch: "main",
        runtime: "node",
        buildCommand: "npm ci",
        startCommand: "npm start",
        region: "oregon",
        plan: "starter",
      },
    ],
    [
      "vercel.deployment.create",
      {
        remoteProjectId: "prj_1",
        name: "app",
        repoId: "1",
        ref: "main/../escape",
        commitId: SHA,
      },
    ],
  ])
    await assert.rejects(f.service.prepare(f.body(action, settings), OWNER), {
      status: 400,
    });
  await assert.rejects(
    f.service.prepare(
      {
        ...f.body("github.repository.create", { name: "fixture" }),
        approved: true,
      },
      OWNER,
    ),
    { status: 400 },
  );
  assert.equal(f.calls.length, 0);
});
test("only the matching fresh stored executing approval can write and each plan has one durable attempt", async () => {
  const f = fixture([{ id: 10, full_name: "fixture/demo", private: true }]);
  const p = await f.service.prepare(
    f.body("github.repository.create", { name: "demo" }),
    OWNER,
  );
  await assert.rejects(f.service.execute(p, "missing"), { status: 403 });
  const approval = f.approve(p);
  f.state.approvals[0].operation.planHash = "bad";
  await assert.rejects(f.service.execute(p, approval), { status: 403 });
  f.state.approvals[0].operation.planHash = p.hash;
  const [a, b] = await Promise.allSettled([
    f.service.execute(p, approval),
    f.service.execute(p, approval),
  ]);
  assert.equal([a, b].filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(f.calls.length, 1);
  assert.equal(f.state.provisioningOperations.length, 1);
  assert.equal(f.state.provisioningOperations[0].status, "submitted");
  assert.equal(f.calls[0].url, "https://api.github.com/user/repos");
  assert.equal(f.calls[0].options.redirect, "error");
  assert.deepEqual(JSON.parse(f.calls[0].options.body), {
    name: "demo",
    private: true,
    description: "",
    auto_init: false,
  });
});
test("account, project, plan object and revoked principal changes fail before network", async () => {
  for (const change of [
    (f) => f.secrets.set("github:account", "rotated"),
    (f) => (f.state.projects[0].path = "/different"),
    (f) => (f.state.devices[0].permissions.projectAccess = false),
  ]) {
    const f = fixture();
    const p = await f.service.prepare(
      f.body("github.repository.create", { name: "demo" }),
      PHONE,
    );
    const a = f.approve(p);
    change(f);
    await assert.rejects(f.service.execute(p, a));
    assert.equal(f.calls.length, 0);
  }
  const f = fixture(),
    p = await f.service.prepare(
      f.body("github.repository.create", { name: "demo" }),
      OWNER,
    );
  await assert.rejects(
    f.service.execute(
      { ...p, settings: { name: "other", private: true } },
      f.approve(p),
    ),
    { status: 409 },
  );
});
test("intent exists before a provider call, uncertain failures persist and restarts never retry writes", async () => {
  let f;
  f = fixture([
    () => {
      assert.equal(f.state.provisioningOperations[0].status, "started");
      throw new Error("SYNTHETIC-CREDENTIAL transport error");
    },
  ]);
  const p = await f.service.prepare(
      f.body("github.repository.create", { name: "demo" }),
      OWNER,
    ),
    a = f.approve(p);
  await assert.rejects(f.service.execute(p, a), /No confirmed/);
  assert.equal(f.state.provisioningOperations[0].status, "unconfirmed");
  await assert.rejects(f.service.execute(p, a), /already attempted/);
  assert.equal(f.calls.length, 1);
  assert.ok(!JSON.stringify(f.state).includes("SYNTHETIC-CREDENTIAL"));
  f.state.provisioningOperations[0].status = "started";
  await f.service.init();
  assert.equal(f.state.provisioningOperations[0].status, "unconfirmed");
  assert.equal(f.calls.length, 1);
});
test("grants require both bounded hooks; reauthorization prevents revoked scopes reaching the provider", async () => {
  const noConsume = fixture([], {
    authorize: () => ({ id: "grant", requestedBy: "desktop" }),
  });
  const p = await noConsume.service.prepare(
    noConsume.body("github.repository.create", { name: "demo" }),
    OWNER,
  );
  await assert.rejects(noConsume.service.execute(p, { grantId: "grant" }), {
    status: 403,
  });
  let consumed = 0,
    live = true;
  const f = fixture([{ id: 1, full_name: "fixture/demo", private: true }], {
    authorize: () => {
      if (!live) throw new Error("revoked");
      return { id: "grant", requestedBy: "desktop" };
    },
    consume: async () => {
      consumed++;
      live = false;
    },
  });
  const plan = await f.service.prepare(
    f.body("github.repository.create", { name: "demo" }),
    OWNER,
  );
  await assert.rejects(
    f.service.execute(plan, { grantId: "grant" }),
    /revoked/,
  );
  assert.equal(consumed, 1);
  assert.equal(f.calls.length, 0);
});
test("Vercel project creation stays unlinked; deployment pins the exact commit and reports provider status only", async () => {
  const f = fixture([
    { id: "prj_fixture", name: "demo" },
    { id: "dpl_fixture", readyState: "BUILDING", secret: "ignored" },
    { id: "dpl_fixture", readyState: "READY" },
  ]);
  const create = await f.service.prepare(
    f.body("vercel.project.create", {
      name: "demo",
      teamId: "team_fixture",
      framework: "vite",
    }),
    OWNER,
  );
  await f.service.execute(create, f.approve(create));
  assert.equal(
    f.calls[0].url,
    "https://api.vercel.com/v11/projects?teamId=team_fixture",
  );
  assert.equal(JSON.parse(f.calls[0].options.body).gitRepository, undefined);
  const deploy = await f.service.prepare(
    f.body("vercel.deployment.create", {
      remoteProjectId: "prj_fixture",
      name: "demo",
      repoId: "42",
      ref: "main",
      commitId: SHA,
      target: "production",
    }),
    OWNER,
  );
  const op = await f.service.execute(deploy, f.approve(deploy));
  assert.equal(op.result.providerStatus, "BUILDING");
  assert.equal(JSON.parse(f.calls[1].options.body).gitSource.sha, SHA);
  assert.equal(deploy.includesDeployment, true);
  const verified = await f.service.verify(op.id, OWNER);
  assert.equal(verified.verification.providerStatus, "READY");
  assert.match(
    verified.verification.message,
    /does not test application health/,
  );
});
test("immutable project secrets are used by env writes but never plans, state, receipts or verification values", async () => {
  const value = "synthetic-sensitive-db-password";
  const f = fixture([
    { created: { id: "env_1", key: "DATABASE_URL", value }, failed: [] },
    { envs: [{ key: "DATABASE_URL", target: ["production"], value }] },
  ]);
  const secret = await f.service.saveSecret(
    { projectId: "project", name: "Database", value },
    OWNER,
  );
  const input = f.body("vercel.environment.set", {
    remoteProjectId: "prj_fixture",
    key: "DATABASE_URL",
    secretRef: secret.id,
    target: ["production"],
  });
  const p = await f.service.prepare(input, OWNER);
  const op = await f.service.execute(p, f.approve(p));
  await f.service.verify(op.id, OWNER);
  assert.equal(JSON.parse(f.calls[0].options.body).value, value);
  assert.match(f.calls[0].url, /upsert=true/);
  assert.ok(!JSON.stringify(f.state).includes(value));
  assert.ok(!JSON.stringify(f.service.list("project", OWNER)).includes(value));
  await assert.rejects(
    f.service.prepare({ ...input, projectId: "other" }, OWNER),
    { status: 403 },
  );
  await assert.rejects(
    f.service.prepare(
      { ...input, settings: { ...input.settings, value } },
      OWNER,
    ),
    { status: 400 },
  );
});
test("Render free creation explicitly includes first deploy and disables future automatic pushes; env update touches one key", async () => {
  const f = fixture([
    { service: { id: "srv_fixture", name: "demo" }, deployId: "dep_initial" },
    { key: "API_KEY", value: "synthetic-env" },
    { id: "dep_next", status: "build_in_progress" },
  ]);
  const p = await f.service.prepare(
    f.body("render.service.create", {
      name: "demo",
      ownerId: "own_fixture",
      repository: "fixture/demo",
      branch: "main",
      runtime: "node",
      buildCommand: "npm ci",
      startCommand: "npm start",
      region: "frankfurt",
      plan: "free",
    }),
    OWNER,
  );
  assert.equal(p.includesDeployment, true);
  assert.match(p.summary, /initial build\/deploy/);
  await f.service.execute(p, f.approve(p));
  const sent = JSON.parse(f.calls[0].options.body);
  assert.equal(sent.autoDeployTrigger, "off");
  assert.equal(sent.serviceDetails.plan, "free");
  assert.equal(sent.repo, "https://github.com/fixture/demo");
  const secret = await f.service.saveSecret(
      { projectId: "project", name: "API", value: "synthetic-env" },
      OWNER,
    ),
    env = await f.service.prepare(
      f.body("render.environment.set", {
        serviceId: "srv_fixture",
        key: "API_KEY",
        secretRef: secret.id,
      }),
      OWNER,
    );
  await f.service.execute(env, f.approve(env));
  assert.equal(
    f.calls[1].url,
    "https://api.render.com/v1/services/srv_fixture/env-vars/API_KEY",
  );
  assert.equal(f.calls[1].options.method, "PUT");
  const deploy = await f.service.prepare(
    f.body("render.deployment.create", {
      serviceId: "srv_fixture",
      commitId: SHA,
    }),
    OWNER,
  );
  await f.service.execute(deploy, f.approve(deploy));
  assert.equal(JSON.parse(f.calls[2].options.body).commitId, SHA);
});
test("Neon create stores returned credential only in vault and verifies every returned operation without connecting", async () => {
  const uri =
    "postgresql://fixture:syntheticpassword@ep-fixture.neon.tech/neondb?sslmode=require";
  const f = fixture([
    {
      project: { id: "fixture-project" },
      connection_uris: [{ connection_uri: uri }],
      roles: [{ password: "ignored" }],
      operations: [{ id: "operation-1" }],
    },
    { project: { id: "fixture-project" } },
    { operation: { id: "operation-1", status: "finished" } },
  ]);
  const p = await f.service.prepare(
      f.body("neon.project.create", {
        name: "demo",
        regionId: "aws-eu-central-1",
        orgId: "org_fixture",
      }),
      OWNER,
    ),
    op = await f.service.execute(p, f.approve(p));
  assert.equal(op.result.secretRefs.length, 1);
  assert.equal(
    f.secrets.get(`provisioning-secret:${op.result.secretRefs[0]}`),
    uri,
  );
  assert.ok(!JSON.stringify(f.state).includes("syntheticpassword"));
  assert.equal(
    JSON.parse(f.calls[0].options.body).project.default_endpoint_settings
      .autoscaling_limit_max_cu,
    0.25,
  );
  const checked = await f.service.verify(op.id, OWNER);
  assert.equal(checked.verification.providerStatus, "operations_finished");
  assert.equal(f.calls.length, 3);
  assert.ok(
    f.calls.every((c) =>
      c.url.startsWith("https://console.neon.tech/api/v2/projects"),
    ),
  );
});
test("Neon explicit connection lookup saves reference and missing optional create URI never loses confirmed project identity", async () => {
  const f = fixture([
    { uri: "postgres://fixture:syntheticpassword@ep-fixture.neon.tech/neondb" },
    { project: { id: "other-neon" }, operations: [] },
  ]);
  const p = await f.service.prepare(
    f.body("neon.connection.store", {
      remoteProjectId: "fixture-neon",
      databaseName: "neondb",
      roleName: "fixture",
      pooled: true,
    }),
    OWNER,
  );
  const op = await f.service.execute(p, f.approve(p));
  assert.equal(op.result.secretRefs.length, 1);
  assert.equal(f.calls[0].options.method, "GET");
  assert.match(f.calls[0].url, /pooled=true/);
  const create = await f.service.prepare(
    f.body("neon.project.create", { name: "other", regionId: "aws-us-east-2" }),
    OWNER,
  );
  const result = await f.service.execute(create, f.approve(create));
  assert.equal(result.status, "submitted");
  assert.equal(result.result.resourceId, "other-neon");
  assert.equal(result.result.connectionUnavailable, true);
});
test("Namecheap limits write to nameservers, sends credential in body only, and verifies registrar settings without propagation claim", async () => {
  const xml = (command) =>
    `<?xml version="1.0"?><ApiResponse Status="OK"><RequestedCommand>namecheap.domains.dns.${command}</RequestedCommand><CommandResponse><${command === "setCustom" ? "DomainDNSSetCustomResult" : "DomainDNSGetListResult"} Domain="example.test" Updated="true"><Nameserver>ns1.example.test</Nameserver><Nameserver>ns2.example.test</Nameserver></${command === "setCustom" ? "DomainDNSSetCustomResult" : "DomainDNSGetListResult"}></CommandResponse></ApiResponse>`;
  const f = fixture([
    new Response(xml("setCustom")),
    new Response(xml("getList")),
  ]);
  const p = await f.service.prepare(
    f.body("namecheap.nameservers.set", {
      sld: "example",
      tld: "test",
      nameservers: ["ns2.example.test", "ns1.example.test"],
    }),
    OWNER,
  );
  const op = await f.service.execute(p, f.approve(p));
  assert.equal(f.calls[0].url, "https://api.namecheap.com/xml.response");
  assert.equal(f.calls[0].options.headers.Authorization, undefined);
  assert.equal(
    new URLSearchParams(f.calls[0].options.body).get("Command"),
    "namecheap.domains.dns.setCustom",
  );
  assert.ok(!JSON.stringify(f.state).includes("synthetic_namecheap_key_only"));
  const checked = await f.service.verify(op.id, OWNER);
  assert.equal(
    checked.verification.providerStatus,
    "registrar_nameservers_match_propagation_unverified",
  );
  assert.equal(
    new URLSearchParams(f.calls[1].options.body).get("Command"),
    "namecheap.domains.dns.getList",
  );
});
test("Vercel domain receipt preserves required verification; provider-owned extra data is discarded", async () => {
  const f = fixture([
    {
      name: "app.example.test",
      verified: false,
      verification: [{ value: "do-not-echo-challenge" }],
    },
    { name: "app.example.test", verified: true },
  ]);
  const p = await f.service.prepare(
    f.body("vercel.domain.add", {
      remoteProjectId: "prj_fixture",
      domain: "app.example.test",
    }),
    OWNER,
  );
  const op = await f.service.execute(p, f.approve(p));
  assert.equal(op.result.providerStatus, "verification_required");
  assert.ok(!JSON.stringify(op).includes("do-not-echo-challenge"));
  const checked = await f.service.verify(op.id, OWNER);
  assert.equal(checked.verification.providerStatus, "domain_verified");
});
test("malformed, oversized, provider failures and partial environment failures do not become success receipts", async () => {
  for (const response of [
    new Response("{"),
    new Response("x".repeat(PROVISIONING_LIMITS.responseBytes + 1)),
    new Response("sensitive error body", { status: 500 }),
    { id: 1, full_name: "wrong/repository", private: true },
  ]) {
    const f = fixture([response]);
    const p = await f.service.prepare(
      f.body("github.repository.create", { name: "demo" }),
      OWNER,
    );
    await assert.rejects(f.service.execute(p, f.approve(p)), /No confirmed/);
    assert.equal(f.state.provisioningOperations[0].status, "unconfirmed");
    assert.equal(f.calls.length, 1);
  }
  const f = fixture([
    { created: { key: "API_KEY" }, failed: [{ value: "sensitive" }] },
  ]);
  const secret = await f.service.saveSecret(
    { projectId: "project", name: "API", value: "hidden" },
    OWNER,
  );
  const p = await f.service.prepare(
    f.body("vercel.environment.set", {
      remoteProjectId: "prj_fixture",
      key: "API_KEY",
      secretRef: secret.id,
      target: ["preview"],
    }),
    OWNER,
  );
  await assert.rejects(f.service.execute(p, f.approve(p)));
  assert.ok(!JSON.stringify(f.state).includes("sensitive"));
});
test("secret vault failure after Neon acceptance retains resource receipt and does not create again", async () => {
  const f = fixture([
    {
      project: { id: "fixture-neon" },
      connection_uris: [
        {
          connection_uri:
            "postgres://fixture:password@ep-fixture.neon.tech/neondb",
        },
      ],
      operations: [],
    },
  ]);
  const p = await f.service.prepare(
    f.body("neon.project.create", { name: "demo", regionId: "aws-us-east-2" }),
    OWNER,
  );
  f.vault.set = async () => {
    throw new Error("vault unavailable");
  };
  const op = await f.service.execute(p, f.approve(p));
  assert.equal(op.status, "submitted");
  assert.equal(op.result.resourceId, "fixture-neon");
  assert.match(op.warning, /do not create the project again/);
  assert.equal(f.calls.length, 1);
});

test("stopping a coordinator during delayed credential reads prevents the provider write", async () => {
  const f = fixture();
  const plan = await f.service.prepare(
    f.body("github.repository.create", { name: "demo" }),
    OWNER,
  );
  const approval = f.approve(plan);
  let stopped = false,
    release;
  const pending = new Promise((resolve) => {
    release = resolve;
  });
  let reads = 0;
  const get = f.vault.get;
  f.vault.get = async (key) => {
    reads++;
    if (reads === 2) await pending;
    return get(key);
  };
  const result = f.service.execute(plan, approval, {
    guard: () => {
      if (stopped) throw new Error("Coordinator stopped");
    },
  });
  while (reads < 2) await new Promise((resolve) => setImmediate(resolve));
  stopped = true;
  release();
  await assert.rejects(result, /before the provider request/);
  assert.equal(f.calls.length, 0);
  assert.equal(f.state.provisioningOperations[0].status, "blocked");
});

test("async reviewed-files preflight is awaited and a stop during it prevents dispatch", async () => {
  const f = fixture(),
    plan = await f.service.prepare(
      f.body("github.repository.create", { name: "demo" }),
      OWNER,
    ),
    approval = f.approve(plan);
  let stopped = false,
    checked = false;
  await assert.rejects(
    f.service.execute(plan, approval, {
      beforeDispatch: async () => {
        await new Promise((resolve) => setImmediate(resolve));
        checked = true;
        stopped = true;
      },
      guard: () => {
        if (stopped) throw new Error("Stopped during project snapshot");
      },
    }),
    /before the provider request/,
  );
  assert.equal(checked, true);
  assert.equal(f.calls.length, 0);
  assert.equal(f.state.provisioningOperations[0].status, "blocked");
});
