// Disposable test fixture. No provider run, paid API, email, deployment or real project is touched.
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { NakamaHost } from "../../host/host.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const build = path.resolve(here, "../build");
const dataDir = path.join(build, `integration-host-${Date.now()}`);
await fs.mkdir(path.join(dataDir, "projects"), { recursive: true });
const host = await new NakamaHost({
  dataDir,
  runAgent: async () => {
    throw new Error("No inference in Android smoke tests.");
  },
}).init();
await host.dispatch("PATCH", "/api/settings", {
  workspaceRoot: path.join(dataDir, "projects"),
  hostName: "Nakama Android test host",
  confirmOrdinaryActions: true,
});
// Project-check UI fixtures are metadata only. Never start an npm process here,
// even if a test accidentally acquires an owner context and approves a request.
host.startProjectCheck = async () => {
  throw new Error(
    "Project-check execution is disabled in the Android fixture.",
  );
};
const checkProject = await host.dispatch("POST", "/api/projects", {
  name: "Android check fixture",
  description:
    "Local test scripts and synthetic history only. Nothing is executed.",
});
await fs.writeFile(
  path.join(checkProject.path, "package.json"),
  JSON.stringify({
    private: true,
    scripts: {
      pretest: "node fixture-pre.cjs",
      test: "node fixture-test.cjs",
      posttest: "node fixture-post.cjs",
      lint: "node fixture-lint.cjs",
      deploy: "node fixture-never-deploy.cjs",
    },
  }),
);
const missingProject = await host.dispatch("POST", "/api/projects", {
  name: "Android no-package fixture",
});
const unsupportedProject = await host.dispatch("POST", "/api/projects", {
  name: "Android no-checks fixture",
});
await fs.writeFile(
  path.join(unsupportedProject.path, "package.json"),
  JSON.stringify({
    private: true,
    scripts: {
      dev: "node fixture-dev.cjs",
      deploy: "node fixture-never-deploy.cjs",
    },
  }),
);
await host.store.change((s) => {
  s.tasks.unshift(
    {
      id: "fixture-check-completed",
      projectId: checkProject.id,
      providerId: "terminal",
      kind: "project_check",
      checkName: "test",
      title: "npm run test",
      status: "completed",
      exitCode: 0,
      signal: null,
      createdAt: "2026-09-29T00:00:00.000Z",
      output:
        "SYNTHETIC FIXTURE ONLY: café 🦊 日本語\nExample test output, not a real execution.\n",
    },
    {
      id: "fixture-check-failed",
      projectId: checkProject.id,
      providerId: "terminal",
      kind: "project_check",
      checkName: "lint",
      title: "npm run lint",
      status: "failed",
      exitCode: 7,
      signal: null,
      createdAt: "2026-09-29T00:01:00.000Z",
      output: "SYNTHETIC FIXTURE ONLY: an example lint finding.\n",
      error: "Exit code 7 (synthetic fixture)",
    },
    {
      id: "fixture-check-interrupted",
      projectId: checkProject.id,
      providerId: "terminal",
      kind: "project_check",
      checkName: "test",
      title: "npm run test",
      status: "interrupted",
      exitCode: null,
      signal: null,
      createdAt: "2026-09-29T00:02:00.000Z",
      output: "",
      error: "Synthetic interrupted check; no result is known.",
    },
  );
});
const restrictedTicket = await host.dispatch("POST", "/api/pairing/tickets", {
  platform: "android",
});
const restrictedIdentity = await host.dispatch("POST", "/api/pair", {
  ticket: restrictedTicket.ticket,
  platform: "android",
  name: "Android project-disabled fixture",
});
await host.dispatch("PATCH", `/api/devices/${restrictedIdentity.deviceId}`, {
  projectAccess: false,
});
const privateTicket = await host.dispatch("POST", "/api/pairing/tickets", {
  platform: "android",
});
const privateIdentity = await host.dispatch("POST", "/api/pair", {
  ticket: privateTicket.ticket,
  platform: "android",
  name: "Android Google-disabled fixture",
});
await host.dispatch("PATCH", `/api/devices/${privateIdentity.deviceId}`, {
  googleAccess: false,
});
// Explicit fixture data only: the Android Personal panel can be inspected without a live Google account.
await host.store.change((s) => {
  s.googleAccounts = [
    {
      id: "fixture-personal",
      label: "Personal fixture",
      email: "personal@example.test",
      services: ["gmail", "calendar"],
      status: "connected",
    },
    {
      id: "fixture-work",
      label: "Work fixture",
      email: "work@example.test",
      services: ["calendar"],
      status: "connected",
    },
  ];
});
host.google.fetch = async () => {
  throw new Error(
    "External Google networking is disabled in the Android fixture.",
  );
};
host.google.messages = async () => ({
  messages: [
    {
      id: "fixture-email",
      snippet:
        "Your weekend project is ready to review. This is local test data.",
      headers: [
        { name: "Subject", value: "A little help for your next project" },
        { name: "From", value: "Nakama fixture <fixture@example.test>" },
        { name: "Date", value: "29 September 2026" },
      ],
    },
  ],
});
host.google.calendars = async () => ({
  items: [
    {
      id: "primary",
      summary: "Personal fixture calendar",
      accessRole: "owner",
      primary: true,
    },
  ],
});
host.google.events = async () => ({
  items: [
    {
      id: "fixture-event",
      summary: "Review Nakama",
      start: { dateTime: "2026-09-30T14:00:00+01:00" },
      end: { dateTime: "2026-09-30T15:00:00+01:00" },
      location: "Your desk",
    },
  ],
});
await host.listen({ port: 43120, host: "127.0.0.1" });
async function ticket() {
  const value = await host.dispatch("POST", "/api/pairing/tickets", {
    platform: "android",
  });
  const checks = await host.dispatch("POST", "/api/pairing/tickets", {
    platform: "android",
  });
  const checksUi = await host.dispatch("POST", "/api/pairing/tickets", {
    platform: "android",
  });
  await fs.writeFile(
    path.join(build, "integration-pairing.json"),
    JSON.stringify({
      ...value,
      url: "https://127.0.0.1:43120",
      checksTicket: checks.ticket,
      checksUiTicket: checksUi.ticket,
      restrictedIdentity,
      privateIdentity,
      checksFixture: {
        projectId: checkProject.id,
        missingProjectId: missingProject.id,
        unsupportedProjectId: unsupportedProject.id,
      },
    }),
  );
}
await ticket();
const refresh = setInterval(ticket, 30_000);
console.log(
  "Disposable Android integration host ready on loopback port 43120. Pairing fixture saved locally; no secrets printed.",
);
async function stop() {
  clearInterval(refresh);
  await host.close();
  process.exit(0);
}
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
