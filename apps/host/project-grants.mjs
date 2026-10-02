import { isDeepStrictEqual } from "node:util";
import { ACTION_SCHEMAS } from "./service-provisioning.mjs";
import { ApiError, now, uid } from "./security.mjs";
import { assertPersonalAccess } from "./personal-access.mjs";

export const GRANT_ACTIONS = Object.freeze({
  github: ["repository.create"],
  vercel: [
    "project.create",
    "deployment.create",
    "environment.set",
    "domain.add",
  ],
  render: ["service.create", "environment.set", "deployment.create"],
  neon: ["project.create", "connection.store"],
  namecheap: ["nameservers.set"],
});
const selectors = [
  "name",
  "organization",
  "remoteProjectId",
  "serviceId",
  "domain",
  "sld",
  "tld",
  "teamId",
  "ownerId",
  "orgId",
  "repository",
];
const object = (body, allowed) => {
  if (
    !body ||
    typeof body !== "object" ||
    Array.isArray(body) ||
    Object.keys(body).some((k) => !allowed.includes(k))
  )
    throw new ApiError(400, "Unexpected project grant fields.");
};
function primarySelector(provider, action) {
  if (provider === "namecheap") return ["sld", "tld"];
  if (action.endsWith(".create") && !action.startsWith("deployment"))
    return ["name"];
  return [provider === "render" ? "serviceId" : "remoteProjectId"];
}
export class ProjectGrants {
  constructor(host) {
    this.host = host;
  }
  access(principal) {
    assertPersonalAccess(this.host.store.state, principal);
  }
  public(principal) {
    try {
      this.access(principal);
    } catch {
      return [];
    }
    return structuredClone(this.host.store.state.projectGrants || []).map(
      ({ projectPath, workspaceRoot, ...grant }) => grant,
    );
  }
  async request(body, principal) {
    this.access(principal);
    object(body, ["projectId", "scopes", "hours", "maxOperations"]);
    const project = this.host.project(body.projectId);
    if (
      !Number.isSafeInteger(body.hours) ||
      body.hours < 1 ||
      body.hours > 24 ||
      !Number.isSafeInteger(body.maxOperations) ||
      body.maxOperations < 1 ||
      body.maxOperations > 30
    )
      throw new ApiError(
        400,
        "Choose a 1–24 hour grant for at most 30 operations.",
      );
    if (
      !Array.isArray(body.scopes) ||
      !body.scopes.length ||
      body.scopes.length > 12
    )
      throw new ApiError(400, "Choose 1–12 exact service scopes.");
    const scopes = body.scopes.map((scope) => {
      object(scope, ["provider", "accountId", "action", "match"]);
      if (!GRANT_ACTIONS[scope.provider]?.includes(scope.action))
        throw new ApiError(
          403,
          "This service action cannot be granted. Service deletion, purchases and arbitrary requests are never supported.",
        );
      if (
        !this.host.store.state.connections
          .find((c) => c.id === scope.provider)
          ?.accounts?.some((a) => a.id === scope.accountId)
      )
        throw new ApiError(404, "Choose a saved service account.");
      object(
        scope.match,
        ACTION_SCHEMAS[`${scope.provider}.${scope.action}`] || [],
      );
      if (
        primarySelector(scope.provider, scope.action).some(
          (key) => !scope.match[key],
        )
      )
        throw new ApiError(
          400,
          "Bind each grant to an exact resource ID, new resource name or domain.",
        );
      const scalar = (value) =>
        (typeof value === "string" &&
          value.length > 0 &&
          value.length <= 2000 &&
          !/[\x00-\x1f]/.test(value)) ||
        typeof value === "boolean" ||
        (typeof value === "number" && Number.isSafeInteger(value));
      for (const value of Object.values(scope.match))
        if (
          !(Array.isArray(value)
            ? value.length > 0 && value.length <= 10 && value.every(scalar)
            : scalar(value))
        )
          throw new ApiError(
            400,
            "Grant selectors must be bounded exact values.",
          );
      return structuredClone(scope);
    });
    return this.host.approval(
      "project_grant",
      `Authorize service work for ${project.name}`,
      `Allow up to ${body.maxOperations} operations over ${body.hours} hours, limited to the accounts, actions and exact resource selectors below. This may include production deployment or DNS changes. Each operation still appears in delivery receipts. No service deletion or purchases are granted. Revoke at any time.\n\n${JSON.stringify(scopes, null, 2)}`,
      {
        projectId: project.id,
        projectPath: project.path,
        workspaceRoot: this.host.store.state.config.workspaceRoot,
        scopes,
        hours: body.hours,
        maxOperations: body.maxOperations,
      },
      principal,
    );
  }
  async approved(operation, approval) {
    const project = this.host.project(operation.projectId);
    if (
      project.path !== operation.projectPath ||
      this.host.store.state.config.workspaceRoot !== operation.workspaceRoot
    )
      throw new ApiError(
        409,
        "The project folder changed before authorization.",
      );
    const grant = {
      id: uid(),
      ...structuredClone(operation),
      status: "active",
      used: 0,
      operationIds: [],
      approvalId: approval.id,
      requestedBy: approval.requestedBy,
      createdAt: now(),
      expiresAt: new Date(Date.now() + operation.hours * 3600000).toISOString(),
    };
    await this.host.store.change((s) => {
      s.projectGrants ||= [];
      s.projectGrants.push(grant);
      this.host.store.audit(
        s,
        "project.grant",
        { kind: "owner", id: "desktop" },
        `Bounded service grant ${grant.id}`,
      );
    });
    return { id: grant.id, status: grant.status, expiresAt: grant.expiresAt };
  }
  authorize(plan, authority) {
    object(authority, ["grantId"]);
    const grant = (this.host.store.state.projectGrants || []).find(
      (g) => g.id === authority.grantId,
    );
    if (
      !grant ||
      grant.status !== "active" ||
      Date.parse(grant.expiresAt) <= Date.now() ||
      (grant.used >= grant.maxOperations &&
        !grant.operationIds.includes(plan.id))
    )
      throw new ApiError(
        403,
        "The project grant is missing, expired, exhausted or revoked.",
      );
    const requester =
      grant.requestedBy === "desktop"
        ? { kind: "owner", id: "desktop" }
        : { kind: "device", id: grant.requestedBy };
    this.access(requester);
    const project = this.host.project(grant.projectId);
    if (
      plan.projectId !== grant.projectId ||
      project.path !== grant.projectPath ||
      this.host.store.state.config.workspaceRoot !== grant.workspaceRoot
    )
      throw new ApiError(
        403,
        "This grant belongs to another project location.",
      );
    const action = plan.action.startsWith(`${plan.provider}.`)
      ? plan.action.slice(plan.provider.length + 1)
      : plan.action;
    if (
      !grant.scopes.some(
        (scope) =>
          scope.provider === plan.provider &&
          scope.accountId === plan.accountId &&
          scope.action === action &&
          Object.entries(scope.match).every(([key, value]) =>
            isDeepStrictEqual(plan.settings[key], value),
          ),
      )
    )
      throw new ApiError(
        403,
        "The operation is outside the approved account, action or resource scope.",
      );
    return { id: grant.id, requestedBy: grant.requestedBy };
  }
  async consume(plan, authority) {
    return this.host.store.change(() => {
      const approved = this.authorize(plan, authority);
      const grant = this.host.store.state.projectGrants.find(
        (g) => g.id === approved.id,
      );
      if (!grant.operationIds.includes(plan.id)) {
        grant.used++;
        grant.operationIds.push(plan.id);
      }
      return approved;
    });
  }
  async revoke(id, principal) {
    this.access(principal);
    return this.host.store.change((s) => {
      this.access(principal);
      const grant = (s.projectGrants || []).find((g) => g.id === id);
      if (!grant) throw new ApiError(404, "Grant not found.");
      grant.status = "revoked";
      grant.revokedAt = now();
      this.host.store.audit(s, "project.grant.revoked", principal, id);
      return { id, status: "revoked" };
    });
  }
}
