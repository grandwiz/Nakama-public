import test from "node:test";
import assert from "node:assert/strict";
import { ServiceConnections } from "../apps/host/services.mjs";

const SHA = "a".repeat(40),
  OWNER = { kind: "owner", id: "desktop" };

test("GitHub repository identity uses the chosen account at the fixed API origin and rejects renamed or malformed identities", async () => {
  const f = fixture([
    {
      id: 42,
      full_name: "Owner/Repo",
      default_branch: "main",
      private: true,
      clone_url: "https://untrusted.invalid/ignored",
    },
    { id: 42, full_name: "Someone/Else", default_branch: "main" },
    { id: "bad", full_name: "Owner/Repo", default_branch: "main" },
  ]);
  const result = await f.services.githubRepository("account-1", "owner/repo");
  assert.deepEqual(result, {
    repositoryId: "42",
    repository: "Owner/Repo",
    defaultBranch: "main",
    private: true,
    url: "https://github.com/Owner/Repo",
  });
  assert.equal(f.calls[0].url, "https://api.github.com/repos/owner/repo");
  assert.equal(f.calls[0].options.redirect, "error");
  assert.ok(!JSON.stringify(result).includes("PRIVATE-CREDENTIAL"));
  await assert.rejects(
    f.services.githubRepository("account-1", "Owner/Repo"),
    /identity/,
  );
  await assert.rejects(
    f.services.githubRepository("account-1", "Owner/Repo"),
    /identity/,
  );
  await assert.rejects(
    f.services.githubRepository("account-1", "../escape"),
    /owner\/repository/,
  );
});
function fixture(responses = []) {
  const calls = [],
    secrets = new Map(
      ["github", "vercel", "render", "neon", "resend"].map((provider) => [
        `${provider}:account-1`,
        `${provider}-PRIVATE-CREDENTIAL`,
      ]),
    );
  const state = {
    config: { confirmOrdinaryActions: false },
    connections: [...secrets.keys()].map((key) => ({
      id: key.split(":")[0],
      accounts: [{ id: "account-1", accountLabel: "Test account" }],
    })),
    projects: [{ id: "local-project", name: "Local project" }],
    devices: [{ id: "phone-1" }],
    approvals: [],
    audit: [],
  };
  let queue = Promise.resolve();
  const store = {
    state,
    change(fn) {
      const work = queue.then(() => fn(state));
      queue = work.catch(() => {});
      return work;
    },
    audit(s, type, actor, detail) {
      s.audit.push({ type, actor: actor.id, detail });
    },
  };
  const services = new ServiceConnections({
    store,
    vault: { get: async (key) => secrets.get(key) },
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      const next = responses.shift();
      if (next instanceof Error) throw next;
      if (typeof next === "function") return next(url, options);
      return new Response(JSON.stringify(next ?? {}), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  });
  return { services, state, calls, secrets, store };
}
function approve(f, operation, type = "deploy") {
  const approval = {
    id: `approval-${f.state.approvals.length}`,
    type,
    status: "executing",
    operation: structuredClone(operation),
    requestedBy: "desktop",
    expiresAt: new Date(Date.now() + 600000).toISOString(),
  };
  f.state.approvals.push(approval);
  return approval;
}
const renderOperation = {
  provider: "render",
  accountId: "account-1",
  projectId: "local-project",
  serviceId: "srv-test",
  commitId: SHA,
};
const vercelOperation = {
  provider: "vercel",
  accountId: "account-1",
  projectId: "local-project",
  vercelProjectId: "prj_test",
  deploymentName: "test-project",
  repoId: "123456",
  ref: "main",
  commitId: SHA,
  target: "preview",
  teamId: "team_test",
};
const emailOperation = {
  accountId: "account-1",
  requestId: "email-request-12345",
  from: "owner@example.com",
  to: ["friend@example.com"],
  subject: "An explicit test",
  text: "The exact requested message.\nSecond line.",
};

test("service lists use fixed HTTPS origins, protected bearer headers, timeouts and no redirects", async () => {
  const f = fixture([
    [
      {
        id: 7,
        full_name: "owner/project",
        private: true,
        html_url: "https://github.com/owner/project",
        default_branch: "main",
        token: "must-not-leak",
      },
    ],
  ]);
  const result = await f.services.list("github", "account-1", "repositories");
  assert.equal(result.items[0].name, "owner/project");
  assert.equal(result.items[0].private, true);
  assert.equal(result.items[0].token, undefined);
  assert.equal(new URL(f.calls[0].url).origin, "https://api.github.com");
  assert.equal(
    f.calls[0].options.headers.Authorization,
    "Bearer github-PRIVATE-CREDENTIAL",
  );
  assert.equal(f.calls[0].options.redirect, "error");
  assert.ok(f.calls[0].options.signal instanceof AbortSignal);
  assert.ok(!JSON.stringify(result).includes("PRIVATE-CREDENTIAL"));
});
test("all five integrations map metadata and omit credentials/environment/connection strings", async () => {
  const f = fixture([
    {
      projects: [
        {
          id: "prj_a",
          name: "a",
          env: [{ value: "private" }],
          link: { repoId: 12, repo: "a", type: "github" },
        },
      ],
    },
    [
      {
        cursor: "cursor-1",
        service: {
          id: "srv-a",
          name: "a",
          serviceDetails: { url: "https://a.onrender.com", env: "private" },
        },
      },
    ],
    {
      projects: [
        { id: "neon-a", name: "a", connection_uri: "postgres://private" },
      ],
    },
    {
      data: [
        {
          id: "domain-1",
          name: "example.com",
          status: "verified",
          secret: "private",
        },
      ],
    },
  ]);
  for (const [provider, resource] of [
    ["vercel", "projects"],
    ["render", "services"],
    ["neon", "projects"],
    ["resend", "domains"],
  ]) {
    const result = await f.services.list(provider, "account-1", resource);
    assert.equal(result.items.length, 1);
    assert.ok(!JSON.stringify(result).includes("private"));
  }
});
test("Neon database list requests exact project/branch path and never returns passwords", async () => {
  const f = fixture([
    {
      databases: [
        {
          id: 1,
          name: "nakama",
          owner_name: "owner",
          branch_id: "br-a",
          password: "secret",
        },
      ],
    },
  ]);
  const result = await f.services.list("neon", "account-1", "databases", {
    remoteProjectId: "project-a",
    branchId: "br-a",
  });
  assert.equal(
    f.calls[0].url,
    "https://console.neon.tech/api/v2/projects/project-a/branches/br-a/databases",
  );
  assert.equal(result.items[0].name, "nakama");
  assert.equal(result.items[0].password, undefined);
});
test("unknown accounts, arbitrary resources, path injection and unknown parameters fail before network", async () => {
  const f = fixture();
  for (const args of [
    ["github", "missing", "repositories"],
    ["github", "account-1", "https://evil.example"],
    ["render", "account-1", "deployments", { serviceId: "../../evil" }],
    ["vercel", "account-1", "projects", { url: "https://evil.example" }],
  ])
    await assert.rejects(f.services.list(...args));
  assert.equal(f.calls.length, 0);
});
test("HTTP errors, redirects and echoed credentials never become public provider error details", async () => {
  const f = fixture([
    () => new Response("vercel-PRIVATE-CREDENTIAL", { status: 401 }),
    new Error("Bearer vercel-PRIVATE-CREDENTIAL"),
    { projects: [{ id: "a", name: "vercel-PRIVATE-CREDENTIAL" }] },
  ]);
  await assert.rejects(
    f.services.list("vercel", "account-1", "projects"),
    (error) =>
      error.status === 502 && !error.message.includes("PRIVATE-CREDENTIAL"),
  );
  await assert.rejects(
    f.services.list("vercel", "account-1", "projects"),
    (error) => !error.message.includes("PRIVATE-CREDENTIAL"),
  );
  assert.equal(
    (await f.services.list("vercel", "account-1", "projects")).items[0].name,
    "[credential removed]",
  );
});
test("oversized provider responses are rejected", async () => {
  const f = fixture([
    () => new Response("x".repeat(2 * 1024 * 1024 + 1), { status: 200 }),
  ]);
  await assert.rejects(f.services.list("github", "account-1", "repositories"), {
    status: 502,
  });
});
test("Render deployment needs saved executing fresh approval and exact commit", async () => {
  const f = fixture([{ id: "dep-test", status: "build_in_progress" }]);
  await assert.rejects(f.services.deploy("not-stored"), { status: 403 });
  const operation = f.services.prepareDeployment(renderOperation),
    approval = approve(f, operation);
  approval.status = "pending";
  await assert.rejects(f.services.deploy(approval.id), { status: 403 });
  approval.status = "executing";
  const result = await f.services.deploy(approval.id);
  assert.equal(result.status, "submitted");
  assert.equal(result.providerStatus, "build_in_progress");
  assert.equal(
    f.calls[0].url,
    "https://api.render.com/v1/services/srv-test/deploys",
  );
  assert.deepEqual(JSON.parse(f.calls[0].options.body), {
    commitId: SHA,
    clearCache: "do_not_clear",
  });
  await assert.rejects(f.services.deploy(approval.id), { status: 409 });
  assert.equal(f.calls.length, 1);
});
test("deployment does not accept a fake approval object, expired approval or missing commit", async () => {
  const f = fixture();
  assert.throws(
    () =>
      f.services.prepareDeployment({ ...renderOperation, commitId: "main" }),
    { status: 400 },
  );
  assert.throws(
    () =>
      f.services.prepareDeployment({
        ...renderOperation,
        serviceId: "//evil.example",
      }),
    { status: 400 },
  );
  await assert.rejects(
    f.services.deploy({
      id: "fake",
      status: "executing",
      operation: renderOperation,
    }),
    { status: 403 },
  );
  const approval = approve(f, renderOperation);
  approval.expiresAt = new Date(Date.now() - 1).toISOString();
  await assert.rejects(f.services.deploy(approval.id), { status: 409 });
  assert.equal(f.calls.length, 0);
});
test("concurrent approval execution dispatches at most one deployment", async () => {
  const f = fixture([{ id: "dep-once", status: "queued" }]),
    approval = approve(f, f.services.prepareDeployment(renderOperation));
  const results = await Promise.allSettled([
    f.services.deploy(approval.id),
    f.services.deploy(approval.id),
  ]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(f.calls.length, 1);
});
test("Vercel deployment pins GitHub commit and project; preview does not request production", async () => {
  const f = fixture([
      { id: "dpl-test", readyState: "QUEUED", url: "test-project.vercel.app" },
    ]),
    approval = approve(f, f.services.prepareDeployment(vercelOperation));
  const result = await f.services.deploy(approval.id),
    body = JSON.parse(f.calls[0].options.body);
  assert.equal(new URL(f.calls[0].url).pathname, "/v13/deployments");
  assert.equal(new URL(f.calls[0].url).searchParams.get("teamId"), "team_test");
  assert.equal(body.project, "prj_test");
  assert.equal(body.target, undefined);
  assert.deepEqual(body.gitSource, {
    type: "github",
    repoId: "123456",
    ref: "main",
    sha: SHA,
  });
  assert.equal(result.url, "https://test-project.vercel.app/");
  assert.equal(result.status, "submitted");
});
test("lost deployment response is recorded unconfirmed and never retried automatically", async () => {
  const f = fixture([new Error("timeout")]),
    approval = approve(f, f.services.prepareDeployment(renderOperation));
  await assert.rejects(f.services.deploy(approval.id), { status: 502 });
  assert.equal(approval.serviceExecution.status, "unconfirmed");
  await assert.rejects(f.services.deploy(approval.id), { status: 409 });
  assert.equal(f.calls.length, 1);
});
test("Resend email requires authenticated direct request and honours confirmation policy", async () => {
  const f = fixture();
  await assert.rejects(f.services.sendEmail(emailOperation), { status: 403 });
  await assert.rejects(
    f.services.sendEmail(emailOperation, {
      principal: { kind: "device", id: "revoked" },
    }),
    { status: 403 },
  );
  f.state.config.confirmOrdinaryActions = true;
  await assert.rejects(
    f.services.sendEmail(emailOperation, { principal: OWNER }),
    { status: 403 },
  );
  assert.equal(f.calls.length, 0);
});
test("approved Resend content cannot be swapped; successful repeat returns same result with no resend", async () => {
  const f = fixture([{ id: "email-1" }]);
  f.state.config.confirmOrdinaryActions = true;
  const operation = f.services.prepareEmail(emailOperation),
    approval = approve(f, operation, "service_email");
  await assert.rejects(
    f.services.sendEmail(
      { ...operation, to: ["other@example.com"] },
      { principal: OWNER, approvalId: approval.id },
    ),
    { status: 403 },
  );
  const result = await f.services.sendEmail(operation, {
    principal: OWNER,
    approvalId: approval.id,
  });
  assert.equal(result.status, "accepted");
  assert.match(result.message, /Delivery has not been verified/);
  assert.deepEqual(
    await f.services.sendEmail(operation, {
      principal: OWNER,
      approvalId: approval.id,
    }),
    result,
  );
  assert.equal(f.calls.length, 1);
  assert.match(
    f.calls[0].options.headers["Idempotency-Key"],
    /^nakama-[a-f0-9]{64}$/,
  );
  assert.equal(JSON.parse(f.calls[0].options.body).text, emailOperation.text);
});
test("Resend request IDs cannot be reused for another message and timeouts block blind retries", async () => {
  const f = fixture([new Error("timeout")]);
  await assert.rejects(
    f.services.sendEmail(emailOperation, { principal: OWNER }),
    { status: 502 },
  );
  await assert.rejects(
    f.services.sendEmail(emailOperation, { principal: OWNER }),
    { status: 409 },
  );
  await assert.rejects(
    f.services.sendEmail(
      { ...emailOperation, text: "Different" },
      { principal: OWNER },
    ),
    { status: 409 },
  );
  assert.equal(f.calls.length, 1);
  assert.equal(f.state.serviceRequests[0].status, "unconfirmed");
  assert.ok(
    !JSON.stringify(f.state.serviceRequests).includes(emailOperation.text),
  );
});
test("email validation rejects header injection, attachments and implicit recipients", () => {
  const f = fixture();
  for (const body of [
    { ...emailOperation, subject: "Hello\r\nBcc: hidden@example.com" },
    { ...emailOperation, to: [] },
    { ...emailOperation, to: ["Someone <x@example.com>"] },
    { ...emailOperation, attachments: [] },
    { ...emailOperation, requestId: "short" },
  ])
    assert.throws(() => f.services.prepareEmail(body), { status: 400 });
});
