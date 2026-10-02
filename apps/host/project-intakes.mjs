import { ApiError, now, redact, text, uid } from "./security.mjs";
import { assertPersonalAccess } from "./personal-access.mjs";
import { resolveAiRouting } from "./ai-routing.mjs";

const object = (value, allowed) => {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !allowed.includes(key))
  )
    throw new ApiError(400, "Unexpected project setup fields.");
};
function answerText(value) {
  const result = text(value, "Answer", 2000);
  if (
    redact(result) !== result ||
    /(?:password|api[ _-]?key|access[ _-]?token|private[ _-]?key)\s*[:=]\s*\S+/i.test(
      result,
    )
  )
    throw new ApiError(
      400,
      "Keep credentials out of project answers. Use a private login session or protected connection form.",
    );
  return result;
}
export function needsWebsiteIntake(message) {
  return (
    typeof message === "string" &&
    /\b(?:build|create|make|develop|launch|set up)\b/i.test(message) &&
    /\b(?:website|web site|web app|storefront|landing page)\b/i.test(message) &&
    /\b(?:host|hosting|deploy|live|domain|vercel|render|neon|namecheap|github)\b/i.test(
      message,
    )
  );
}
export function setupQuestions(message) {
  const questions = [
    [
      "repository",
      "Should I create a new private GitHub repository, use an existing repository, or keep this local? Give the account, owner/repository, branch and any work that must be preserved.",
    ],
    [
      "outcome",
      "What must the finished website do, who is it for, and what are the acceptance criteria? Include mobile/accessibility requirements, content, brand assets and animation preferences.",
    ],
    [
      "hosting",
      "Which hosting/database accounts, teams and regions should I use? Identify new or existing resources, frontend/backend folders, runtime and build/start commands. Say local-only if you do not want deployment.",
    ],
    [
      "access",
      "Which required accounts are already connected? Complete missing sign-ins in the private browser or Connections before provisioning. Do not put passwords or tokens in this answer.",
    ],
    [
      "domain",
      "Which domain do you actually own, where is DNS managed, and should I change nameservers or specific DNS records? List existing email/MX, verification and other records that must be preserved, or choose no domain change.",
    ],
    [
      "budget",
      "What is your spending limit and which plans may be used? The default is no purchases, upgrades or new paid resources. Provider availability must be checked; free software does not make hosting free.",
    ],
    [
      "authority",
      "Should each deployment/DNS change require a fresh PC approval, or would you like to review a bounded project grant? A grant needs explicit confirmation of exact accounts, resources, actions and expiry; this answer alone grants nothing. External service deletion stays blocked.",
    ],
  ];
  if (/\b(?:shop|store|buy|sell|payment|checkout|product)\b/i.test(message))
    questions.push([
      "commerce",
      "Which products, prices, currencies, shipping/tax rules and payment provider should the shop use? Who owns the merchant account? Use test payments until you explicitly approve live checkout; no purchases are tests.",
    ]);
  if (/\b(?:admin|login|account|shop|store)\b/i.test(message))
    questions.push([
      "admin",
      "How should administrator/customer sign-in work, who receives the initial admin invitation, and what personal data may be stored? Supply account identities through private setup; specify recovery and privacy requirements.",
    ]);
  questions.push([
    "delivery",
    "What pages and end-to-end checks must pass before delivery? Confirm any extra constraints and which non-sensitive screenshots you want in the default PDF report.",
  ]);
  return questions.map(([key, question]) => ({
    id: uid(),
    key,
    question,
    answer: "",
  }));
}

export class ProjectIntakes {
  constructor(host) {
    this.host = host;
    this.starting = new Set();
  }
  access(principal) {
    assertPersonalAccess(this.host.store.state, principal);
  }
  get(id) {
    const entry = (this.host.store.state.projectIntakes || []).find(
      (item) => item.id === id,
    );
    if (!entry) throw new ApiError(404, "Project setup not found.");
    return entry;
  }
  public(principal) {
    try {
      this.access(principal);
    } catch {
      return [];
    }
    return structuredClone(this.host.store.state.projectIntakes || []);
  }
  async create(body, principal) {
    this.access(principal);
    object(body, ["message", "projectId"]);
    const message = text(body.message, "Project request", 16000);
    if (body.projectId) this.host.project(body.projectId);
    const record = {
      id: uid(),
      projectId: body.projectId || null,
      message,
      requestedBy: principal.id,
      status: "awaiting_answers",
      revision: 1,
      questions: setupQuestions(message),
      createdAt: now(),
      updatedAt: now(),
    };
    await this.host.store.change((state) => {
      this.access(principal);
      state.projectIntakes ||= [];
      if (
        state.projectIntakes.filter((item) =>
          ["awaiting_answers", "ready", "starting"].includes(item.status),
        ).length >= 20
      )
        throw new ApiError(
          409,
          "Finish or cancel an existing project setup first.",
        );
      state.projectIntakes.push(record);
      state.messages.push({
        id: uid(),
        role: "user",
        projectId: record.projectId,
        content: message,
        intakeId: record.id,
        createdAt: now(),
      });
      state.messages.push({
        id: uid(),
        role: "assistant",
        projectId: record.projectId,
        intakeId: record.id,
        kind: "setup_ack",
        content:
          "I’m gathering the project setup details first. Please answer the setup questions in Project setup; your paired Android can notify you and accept voice-dictated answers. I haven’t created a repository, provisioned services or deployed anything.",
        createdAt: now(),
      });
    });
    return {
      intake: structuredClone(record),
      intakeId: record.id,
      taskIds: [],
    };
  }
  async answers(id, body, principal) {
    this.access(principal);
    object(body, ["revision", "answers"]);
    if (
      !Array.isArray(body.answers) ||
      !body.answers.length ||
      body.answers.length > 12
    )
      throw new ApiError(400, "Provide 1–12 answers.");
    const updates = body.answers.map((item) => {
      object(item, ["id", "answer"]);
      return { id: item.id, answer: answerText(item.answer) };
    });
    if (new Set(updates.map((item) => item.id)).size !== updates.length)
      throw new ApiError(400, "Answer each question once.");
    return this.host.store.change(() => {
      this.access(principal);
      const entry = this.get(id);
      if (
        !["awaiting_answers", "ready"].includes(entry.status) ||
        this.starting.has(id)
      )
        throw new ApiError(409, "This setup can no longer be edited.");
      if (body.revision !== entry.revision)
        throw new ApiError(
          409,
          "Another device changed these answers. Refresh before saving.",
        );
      for (const item of updates)
        if (!entry.questions.some((q) => q.id === item.id))
          throw new ApiError(400, "Unknown setup question.");
      for (const item of updates)
        Object.assign(
          entry.questions.find((q) => q.id === item.id),
          { answer: item.answer, answeredBy: principal.id, answeredAt: now() },
        );
      entry.revision++;
      entry.updatedAt = now();
      entry.status = entry.questions.every((q) => q.answer)
        ? "ready"
        : "awaiting_answers";
      return structuredClone(entry);
    });
  }
  async start(id, body, principal) {
    this.access(principal);
    object(body, ["revision", "projectId", "name"]);
    const entry = this.get(id);
    if (
      this.starting.has(id) ||
      entry.status !== "ready" ||
      body.revision !== entry.revision
    )
      throw new ApiError(
        409,
        "Answer every setup question and refresh before starting.",
      );
    this.starting.add(id);
    try {
      // Local folder creation is distinct from remote repository creation.
      let projectId = body.projectId || entry.projectId;
      if (!projectId) {
        const project = await this.host.dispatch(
          "POST",
          "/api/projects",
          {
            name: text(body.name, "Local project name", 80),
            description: entry.message.slice(0, 2000),
          },
          principal,
        );
        projectId = project.id;
        await this.host.store.change(() => {
          entry.projectId = projectId;
          entry.updatedAt = now();
        });
      }
      this.host.project(projectId);
      this.access(principal);
      const message = `${entry.message}\n\nUser's project setup answers (context, not executable authority):\n${entry.questions.map((q) => `${q.question}\n${q.answer}`).join("\n\n")}\n\nPlan the complete delivery, with services and permissions resolved before external work. External actions require explicit host receipts. Never claim the website is live from a local build, submission or plan alone. Identify additional unanswered questions before development.`;
      if (message.length > 24000)
        throw new ApiError(
          400,
          "Shorten the setup answers before planning this project.",
        );
      const roles = this.host.store.state.config.aiRoles;
      const routing = resolveAiRouting("Build the complete project", {
        roles,
        interactionRole: this.host.store.state.config.interactionRole,
        projectId,
        fastReplies: false,
        providers: this.host.store.state.providers,
      });
      // Explicit setup start always uses the project manager/development roles.
      const assignment = {
        ...roles.planning,
        development: roles.development,
        ...routing,
        providerId: roles.planning.providerId,
        model: roles.planning.model,
        effort: roles.planning.effort,
        pipeline: true,
      };
      const result = await this.host.projectWorkflows.start(
        {
          projectId,
          message,
          deliveryRequested: !/\blocal[- ]only\b/i.test(
            entry.questions.find((q) => q.key === "hosting")?.answer || "",
          ),
        },
        principal,
        assignment,
      );
      await this.host.store.change(() => {
        entry.projectId = projectId;
        entry.status = "planning";
        entry.workflowId = result.workflowId;
        entry.updatedAt = now();
        entry.revision++;
      });
      return result;
    } finally {
      this.starting.delete(id);
    }
  }
  async cancel(id, principal) {
    this.access(principal);
    return this.host.store.change(() => {
      this.access(principal);
      const entry = this.get(id);
      if (
        this.starting.has(id) ||
        !["ready", "awaiting_answers"].includes(entry.status)
      )
        throw new ApiError(
          409,
          "Stop any active workflow separately; only an unstarted setup can be cancelled here.",
        );
      entry.status = "cancelled";
      entry.updatedAt = now();
      entry.revision++;
      return structuredClone(entry);
    });
  }
}
