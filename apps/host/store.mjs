import { stampDeliveryState } from "./device-delivery.mjs";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { EventEmitter } from "node:events";
import { now, uid } from "./security.mjs";
import {
  defaultAiRoles,
  validateAiRoles,
  defaultInteractionRole,
  validateInteractionRole,
} from "./ai-routing.mjs";
import { defaultAgentOffice, syncAgentOffice } from "./agent-office.mjs";
import {
  defaultProjectTeam,
  validateProjectTeam,
} from "./project-workflows.mjs";
import { defaultClock } from "./clock-timers.mjs";
import { defaultCompanionMemory } from "./companion-memory.mjs";
import { defaultSkillLibrary } from "./learned-skills.mjs";
import {
  defaultTaskBoard,
  defaultRoutineBoard,
  syncTaskBoard,
} from "./personal-boards.mjs";

export function initialState() {
  return {
    version: 1,
    config: {
      workspaceRoot: "",
      hostName: os.hostname(),
      allowLan: false,
      port: 43110,
      voice: "en-GB",
      confirmOrdinaryActions: false,
      memoryEnabled: true,
      closeToTray: true,
      startWithWindows: false,
      aiRoles: defaultAiRoles(),
      interactionRole: defaultInteractionRole(),
      fastReplies: true,
      projectTeam: defaultProjectTeam(),
      companionLearningEnabled: true,
      remoteDesktopEnabled: false,
    },
    providers: [
      {
        id: "codex",
        name: "ChatGPT / Codex",
        status: "not_configured",
        connectionType: "subscription",
        selectedModel: "",
        effort: "high",
        models: [],
        detail:
          "Use your existing ChatGPT plan through the official Codex CLI.",
      },
      {
        id: "claude",
        name: "Claude",
        status: "not_configured",
        connectionType: "subscription",
        selectedModel: "",
        effort: "high",
        models: ["claude-fable-5-1", "claude-opus-4-8", "sonnet", "opus"],
        detail:
          "Use Claude Code signed into your Max account. API billing stays separate.",
      },
    ],
    connections: [
      ["github", "GitHub", "Development"],
      ["vercel", "Vercel", "Hosting"],
      ["render", "Render", "Hosting"],
      ["neon", "Neon", "Database"],
      ["namecheap", "Namecheap", "Domain"],
      ["resend", "Resend", "Email"],
      ["gmail", "Gmail", "Google"],
      ["calendar", "Google Calendar", "Google"],
      ["chrome", "Chrome extension", "Browser"],
    ].map(([id, name, category]) => ({
      id,
      name,
      category,
      status: "not_configured",
      accountLabel: "",
      detail: "Connect in Settings. Credentials stay on this computer.",
      accounts: [],
    })),
    projects: [],
    devices: [],
    tasks: [],
    checkRepairs: [],
    projectWorkflows: [],
    projectReports: [],
    projectIntakes: [],
    projectGrants: [],
    projectDeliveries: [],
    autonomousTasks: [],
    monitors: [],
    companionMemory: defaultCompanionMemory(),
    skillLibrary: defaultSkillLibrary(),
    taskBoard: defaultTaskBoard(),
    routineBoard: defaultRoutineBoard(),
    clock: defaultClock(),
    deviceLocations: [],
    agentOffice: defaultAgentOffice(),
    approvals: [],
    messages: [],
    actions: [],
    audit: [],
  };
}
export class Store extends EventEmitter {
  constructor(dir, { clock = () => new Date() } = {}) {
    super();
    this.dir = dir;
    this.file = path.join(dir, "state.json");
    this.state = initialState();
    this.queue = Promise.resolve();
    this.clock = clock;
  }
  async init() {
    await fs.mkdir(this.dir, { recursive: true });
    try {
      this.state = JSON.parse(await fs.readFile(this.file, "utf8"));
      if (this.state.version !== 1)
        throw new Error("Unsupported Nakama state version.");
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
    }
    this.state.config = { ...initialState().config, ...this.state.config };
    retireLegacyMedia(this.state);
    if (!this.state.connections.some((c) => c.id === "namecheap"))
      this.state.connections.push(
        initialState().connections.find((c) => c.id === "namecheap"),
      );
    this.state.config.aiRoles = validateAiRoles(this.state.config.aiRoles);
    this.state.config.interactionRole = validateInteractionRole(
      this.state.config.interactionRole,
    );
    this.state.agentOffice ||= defaultAgentOffice();
    if (!this.state.projectTeamMigrationVersion) {
      const development = this.state.config.aiRoles.development;
      if (
        development.providerId === "claude" &&
        development.model === "claude-opus-4-8" &&
        development.effort === "max"
      )
        development.effort = "ultracode";
      this.state.projectTeamMigrationVersion = 1;
    }
    this.state.config.projectTeam = validateProjectTeam(
      this.state.config.projectTeam,
    );
    this.state.projectWorkflows ||= [];
    this.state.projectReports ||= [];
    this.state.projectIntakes ||= [];
    this.state.projectGrants ||= [];
    this.state.projectDeliveries ||= [];
    this.state.autonomousTasks ||= [];
    for (const run of this.state.autonomousTasks) {
      if (
        ["running", "awaiting_approval", "awaiting_result"].includes(run.status)
      ) {
        run.status = "interrupted";
        run.stage = "interrupted";
        run.error =
          "Control Center restarted. Review saved receipts before explicitly resuming; attempted actions are never replayed automatically.";
        run.updatedAt = now();
        run.revision = (run.revision || 0) + 1;
      }
      for (const receipt of run.receipts || []) {
        if (
          [
            "attempting",
            "dispatching",
            "running",
            "pending",
            "awaiting_approval",
            "awaiting_result",
          ].includes(receipt.status)
        ) {
          receipt.status = "unconfirmed";
          receipt.summary =
            "Interrupted before a confirmed receipt. Inspect the recorded operation before a new request.";
        }
        if (receipt.verification?.status === "observing") {
          receipt.verification.status = "interrupted";
          receipt.verification.verified = false;
          receipt.verification.completionEligible = false;
        }
      }
    }
    for (const delivery of this.state.projectDeliveries)
      if (["running", "awaiting_approval"].includes(delivery.status)) {
        delivery.status = "interrupted";
        delivery.error =
          "Host restarted. Inspect provider receipts; no delivery work resumes automatically.";
      }
    for (const report of this.state.projectReports)
      if (["queued", "generating"].includes(report.status)) {
        report.status = "interrupted";
        report.error =
          "Control Center restarted before PDF generation completed. Generate a new report; project delivery is unchanged.";
      }
    this.state.companionMemory ||= defaultCompanionMemory();
    this.state.skillLibrary ||= defaultSkillLibrary();
    this.state.skillLibrary.capturedWorkflows ||= [];
    this.state.taskBoard ||= defaultTaskBoard();
    this.state.routineBoard ||= defaultRoutineBoard();
    this.state.clock ||= defaultClock();
    this.state.deviceLocations ||= [];
    for (const workflow of this.state.projectWorkflows)
      if (workflow.status === "running") {
        workflow.status = "interrupted";
        workflow.error =
          "Control Center restarted. No active project stage resumes automatically; review saved files before starting again.";
        workflow.updatedAt = now();
      }
    this.state.checkRepairs ||= [];
    for (const repair of this.state.checkRepairs)
      if (
        ["preparing", "building", "awaiting_approval", "checking"].includes(
          repair.status,
        )
      ) {
        repair.status = "interrupted";
        repair.detail =
          "Control Center restarted. No repair or check will resume automatically.";
        repair.updatedAt = new Date().toISOString();
      }
    for (const task of this.state.tasks)
      if (["queued", "running"].includes(task.status)) {
        task.status = "interrupted";
        task.phase = "interrupted";
        task.updatedAt = now();
        task.error =
          "Control Center restarted. Review this task before restarting it.";
      }
    // Never resume a previously approved side effect automatically after a crash.
    for (const item of this.state.approvals)
      if (
        (item.operation?.repairId ||
          item.operation?.workflowId ||
          item.operation?.autonomousRunId) &&
        item.status === "pending"
      ) {
        item.status = "cancelled";
        item.error =
          "The managed work was interrupted by restart. Request a fresh workflow or check.";
      } else if (item.status === "executing") {
        item.status = "interrupted";
        item.error =
          "Interrupted. Check the result before making a new request.";
      }
    syncTaskBoard(this.state, this.clock());
    syncAgentOffice(this.state);
    stampDeliveryState(this.state);
    await this.save();
    return this;
  }
  async save() {
    const temp = `${this.file}.${uid()}.tmp`;
    try {
      await fs.writeFile(temp, JSON.stringify(this.state, null, 2), {
        mode: 0o600,
      });
      await fs.rename(temp, this.file);
    } finally {
      await fs.unlink(temp).catch((e) => {
        if (e.code !== "ENOENT") throw e;
      });
    }
  }
  change(fn) {
    const operation = this.queue.then(async () => {
      // Retain original object identities: running tasks and provider callbacks hold
      // references into state. A rejected mutation must roll those objects back too.
      const snapshot = (value) =>
        value && typeof value === "object"
          ? {
              ref: value,
              entries: Object.entries(value).map(([key, v]) => [
                key,
                snapshot(v),
              ]),
              array: Array.isArray(value),
            }
          : { value };
      const before = snapshot(this.state);
      const restore = (node) => {
        if (!node.ref) return node.value;
        const keys = new Set(node.entries.map(([key]) => key));
        for (const key of Object.keys(node.ref))
          if (!keys.has(key)) delete node.ref[key];
        for (const [key, child] of node.entries) node.ref[key] = restore(child);
        if (node.array) node.ref.length = node.entries.length;
        return node.ref;
      };
      let result;
      try {
        result = await fn(this.state);
        stampDeliveryState(this.state);
        syncTaskBoard(this.state, this.clock());
        syncAgentOffice(this.state);
        await this.save();
      } catch (error) {
        this.state = restore(before);
        throw error;
      }
      this.emit("changed");
      return result;
    });
    this.queue = operation.catch(() => {});
    return operation;
  }
  audit(state, type, actor, detail) {
    state.audit.push({
      id: uid(),
      createdAt: now(),
      type,
      actor: actor?.id || "desktop",
      detail,
    });
    state.audit = state.audit.slice(-1500);
  }
  publicState(owner = false) {
    const data = structuredClone(this.state);
    delete data.projectReports;
    delete data.projectIntakes;
    delete data.projectGrants;
    delete data.projectDeliveries;
    delete data.autonomousTasks;
    delete data.monitors;
    delete data.selfMaintenance;
    delete data.maintenanceSettings;
    delete data.maintenanceRequests;
    delete data.provisioningPlans;
    delete data.provisioningOperations;
    delete data.provisioningSecrets;
    if (data.skillLibrary) delete data.skillLibrary.capturedWorkflows;
    delete data.klingMcp;
    delete data.klingJobs;
    delete data.taskBoard.removedSourceIds;
    delete data.routineBoard.requestReceipts;
    delete data.clock;
    data.projectWorkflows = data.projectWorkflows.map(
      ({ snapshot, workspaceRoot, projectPath, ...workflow }) => workflow,
    );
    data.devices = data.devices.map(({ tokenHash, ...device }) => device);
    data.approvals = data.approvals.map(
      ({ operation, ...approval }) => approval,
    );
    data.providers = data.providers.map(
      ({ executablePath, ...provider }) => provider,
    );
    if (!owner) {
      delete data.companionMemory;
      delete data.skillLibrary;
      delete data.deviceLocations;
      delete data.audit;
      data.connections = data.connections.map(({ accounts, ...item }) => ({
        ...item,
        accounts: accounts.map(({ id, accountLabel, status }) => ({
          id,
          accountLabel,
          status,
        })),
      }));
    }
    delete data.actions;
    delete data.serviceRequests;
    delete data.retiredMediaJobs;
    delete data.pendingLegacyCredentialRemovals;
    return data;
  }
}

// This is an upgrade migration only: removed providers cannot become active
// again. Preserve past receipts privately rather than misreporting a paid job
// as cancelled when its remote submission may already have happened.
function retireLegacyMedia(state) {
  const legacyConnections = state.connections.filter(
    (item) => item.id === "gemini-media",
  );
  const credentialIds = legacyConnections.flatMap((item) =>
    (item.accounts || []).map((account) => `gemini-media:${account.id}`),
  );
  if (credentialIds.length)
    state.pendingLegacyCredentialRemovals = [
      ...new Set([
        ...(state.pendingLegacyCredentialRemovals || []),
        ...credentialIds,
      ]),
    ];
  state.providers = state.providers.filter((item) => item.id !== "gemini");
  state.connections = state.connections.filter(
    (item) => item.id !== "gemini-media",
  );
  delete state.config.aiRoles.geminiMediaExplicitOnly;
  for (const key of [
    "paidApisEnabled",
    "monthlyBudgetUsd",
    "monthlyBudgetGbp",
    "usdToGbp",
  ])
    delete state.config[key];
  const legacyJobs = state.mediaJobs || [];
  if (legacyJobs.length) {
    state.retiredMediaJobs ||= [];
    for (const job of legacyJobs) {
      const priorStatus = job.status;
      state.retiredMediaJobs.push({
        ...job,
        priorStatus,
        status:
          priorStatus === "quoted"
            ? "cancelled"
            : ["running", "submitting", "unconfirmed"].includes(priorStatus)
              ? "unconfirmed"
              : priorStatus,
        retiredAt: now(),
        retirementDetail:
          "This media integration was removed. Nothing will resume automatically; previously submitted remote work may still have completed.",
      });
    }
  }
  delete state.mediaJobs;
  for (const item of state.approvals)
    if (
      item.type === "media_generation" &&
      ["pending", "executing"].includes(item.status)
    ) {
      item.status = item.status === "pending" ? "cancelled" : "interrupted";
      item.error =
        "This media integration was removed. The old request cannot run again. Check any previously submitted remote work separately.";
    }
}
