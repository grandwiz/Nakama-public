import { useEffect, useRef, useState } from "react";
import {
  Check,
  Cloud,
  KeyRound,
  RefreshCw,
  ShieldCheck,
  Smartphone,
  X,
} from "lucide-react";
import { api, previewMode } from "./bridge";
import {
  Button,
  Empty,
  Mascot,
  SectionTitle,
  Status,
  relativeDate,
} from "./components";
import { useNakama } from "./context";
import "./project-delivery.css";

type Value = string | number | boolean | string[];
interface Plan {
  id: string;
  hash: string;
  provider: string;
  action: string;
  accountId: string;
  projectId: string;
  settings: Record<string, Value>;
  summary: string;
  includesDeployment: boolean;
  createdAt: string;
  expiresAt: string;
}
interface Receipt {
  id: string;
  planId: string;
  provider: string;
  action: string;
  status: string;
  startedAt: string;
  error?: string;
  warning?: string;
  result?: {
    resourceId: string;
    providerStatus: string;
    repository?: string;
    url?: string;
    secretRefs?: string[];
    connectionUnavailable?: boolean;
  };
  verification?: {
    checkedAt: string;
    providerStatus: string;
    message: string;
    operations?: { id: string; status: string }[];
  };
}
interface ProjectSecret {
  id: string;
  name: string;
  createdAt: string;
  source: string;
}
interface Library {
  version: number;
  plans: Plan[];
  operations: Receipt[];
  secrets: ProjectSecret[];
}
interface Grant {
  id: string;
  projectId: string;
  status: string;
  expiresAt: string;
  used: number;
  maxOperations: number;
  scopes: {
    provider: string;
    accountId: string;
    action: string;
    match: Record<string, Value>;
  }[];
}
interface Handoff {
  id: string;
  provider: string;
  deviceId: string;
  status: string;
  accountLabel: string;
  expiresAt: string;
}
interface DeliveryRun {
  id: string;
  projectId: string;
  workflowId: string;
  status: string;
  round: number;
  summary?: string;
  liveVerified: false;
  approvalId?: string;
  reportId?: string;
  questions: { id: string; question: string; answer?: string }[];
  acceptance: unknown[];
}
interface Field {
  key: string;
  label: string;
  help?: string;
  required?: boolean;
  type?:
    "select" | "checkbox" | "targets" | "nameservers" | "secret" | "number";
  options?: string[];
  placeholder?: string;
}
interface Action {
  label: string;
  description: string;
  fields: Field[];
}
const field = (
  key: string,
  label: string,
  help?: string,
  required = true,
): Field => ({ key, label, help, required });
const project = field(
  "remoteProjectId",
  "Provider project ID",
  "The existing provider project, not the Nakama project ID.",
);
const team = field(
  "teamId",
  "Vercel team ID",
  "Optional. Leave blank to use the account's own scope.",
  false,
);
const env = [
  field("key", "Variable name", "For example DATABASE_URL or API_KEY."),
  {
    key: "secretRef",
    label: "Saved project secret",
    type: "secret",
    required: true,
  } satisfies Field,
];
const commit = field(
  "commitId",
  "Exact Git commit",
  "The full 40-character commit SHA to deploy.",
);
const ACTIONS: Record<string, Action> = {
  "github.repository.create": {
    label: "Create a repository",
    description:
      "Create an empty repository on your account or organization. Existing project files are not pushed by this step.",
    fields: [
      field("name", "Repository name"),
      { key: "private", label: "Private repository", type: "checkbox" },
      field("description", "Description", undefined, false),
      field(
        "organization",
        "GitHub organization",
        "Optional. Leave blank for the selected personal account.",
        false,
      ),
    ],
  },
  "vercel.project.create": {
    label: "Create a Vercel project",
    description:
      "Create a project without linking a repository or starting a deployment.",
    fields: [
      field(
        "name",
        "Project name",
        "Use lowercase letters, numbers, hyphens or underscores.",
      ),
      team,
      {
        key: "framework",
        label: "Framework",
        type: "select",
        options: [
          "nextjs",
          "vite",
          "create-react-app",
          "astro",
          "sveltekit",
          "nuxtjs",
          "remix",
        ],
      },
    ],
  },
  "vercel.deployment.create": {
    label: "Deploy an exact commit",
    description:
      "Deploy a GitHub commit to an existing Vercel project. Review the target and commit before approval.",
    fields: [
      project,
      field("name", "Vercel project name"),
      field(
        "repoId",
        "GitHub repository ID",
        "The numeric repository ID linked to Vercel.",
      ),
      field("ref", "Git branch or tag"),
      commit,
      {
        key: "target",
        label: "Deployment target",
        type: "select",
        options: ["preview", "production"],
        required: true,
      },
      team,
    ],
  },
  "vercel.environment.set": {
    label: "Set an environment variable",
    description:
      "Add or replace one variable from a protected project secret. Its value will be sent only to the selected provider project.",
    fields: [
      project,
      ...env,
      {
        key: "target",
        label: "Environment targets",
        type: "targets",
        required: true,
      },
      team,
    ],
  },
  "vercel.domain.add": {
    label: "Attach an existing domain",
    description:
      "Attach a domain you already own. This does not purchase a domain or automatically change DNS.",
    fields: [
      project,
      field(
        "domain",
        "Domain",
        "For example app.example.com. No URL, path or wildcard.",
      ),
      team,
    ],
  },
  "render.service.create": {
    label: "Create a web service and first deploy",
    description:
      "Render immediately starts the first build and deployment. This flow uses the free compute plan and disables later automatic deployments.",
    fields: [
      field("name", "Service name"),
      field("ownerId", "Render workspace ID"),
      field(
        "repository",
        "GitHub repository",
        "Use owner/repository, without a URL.",
      ),
      field("branch", "Git branch"),
      {
        key: "runtime",
        label: "Runtime",
        type: "select",
        options: ["node", "python", "go", "ruby", "rust", "elixir"],
        required: true,
      },
      field(
        "buildCommand",
        "Build command",
        "Executed by Render during its build, not on this PC.",
      ),
      field(
        "startCommand",
        "Start command",
        "Executed by Render to start this service.",
      ),
      {
        key: "region",
        label: "Region",
        type: "select",
        options: ["frankfurt", "oregon", "ohio", "singapore", "virginia"],
        required: true,
      },
      {
        key: "plan",
        label: "Compute plan",
        type: "select",
        options: ["free"],
        required: true,
      },
      field(
        "rootDirectory",
        "Repository subfolder",
        "Optional relative folder for a monorepo.",
        false,
      ),
    ],
  },
  "render.environment.set": {
    label: "Set an environment variable",
    description:
      "Update only the selected variable; other service variables remain in place.",
    fields: [field("serviceId", "Render service ID"), ...env],
  },
  "render.deployment.create": {
    label: "Deploy an exact commit",
    description:
      "Start a deployment on an existing Render service using an exact Git commit.",
    fields: [field("serviceId", "Render service ID"), commit],
  },
  "neon.project.create": {
    label: "Create a database project",
    description:
      "Create a Neon project with a small fixed compute size. Existing account quotas and usage terms apply; this does not change your subscription.",
    fields: [
      field("name", "Database project name"),
      field(
        "regionId",
        "Neon region ID",
        "For example aws-eu-central-1. Choose a region available to your account.",
      ),
      field(
        "orgId",
        "Neon organization ID",
        "Required for personal API keys; organization keys can infer it.",
        false,
      ),
      {
        key: "pgVersion",
        label: "Postgres version",
        type: "select",
        options: ["14", "15", "16", "17", "18"],
        required: true,
      },
      {
        key: "storeConnection",
        label: "Save the returned connection in the protected vault",
        type: "checkbox",
      },
    ],
  },
  "neon.connection.store": {
    label: "Save a database connection",
    description:
      "Retrieve an existing database connection into the Windows vault. Nakama returns a reference, never the password or connection string.",
    fields: [
      project,
      field(
        "branchId",
        "Neon branch ID",
        "Optional. Leave blank for the default branch.",
        false,
      ),
      field("databaseName", "Database name"),
      field("roleName", "Database role"),
      { key: "pooled", label: "Use a pooled connection", type: "checkbox" },
    ],
  },
  "namecheap.nameservers.set": {
    label: "Change existing domain nameservers",
    description:
      "Replace the nameservers for an owned domain. This can affect its website and email. There is no domain purchase or deletion.",
    fields: [
      field(
        "sld",
        "Domain name before the suffix",
        "For example example for example.co.uk.",
      ),
      field("tld", "Domain suffix", "For example com or co.uk."),
      {
        key: "nameservers",
        label: "Nameservers",
        type: "nameservers",
        help: "Enter 2–6 nameservers, one per line.",
        required: true,
      },
    ],
  },
};
const PROVIDERS: Record<string, string> = {
  github: "GitHub",
  vercel: "Vercel",
  render: "Render",
  neon: "Neon",
  namecheap: "Namecheap",
};
const defaults = (action: string): Record<string, string | string[]> => ({
  private: "true",
  storeConnection: "true",
  pooled: "true",
  target: action.endsWith("environment.set") ? ["preview"] : "preview",
  runtime: "node",
  region: "frankfurt",
  plan: "free",
  pgVersion: "17",
  branch: "main",
  ref: "main",
  databaseName: "neondb",
});
function settingsFor(action: string, draft: Record<string, string | string[]>) {
  const result: Record<string, Value> = {};
  for (const f of ACTIONS[action].fields) {
    const v = draft[f.key];
    if (f.type === "checkbox") result[f.key] = v === "true";
    else if (f.type === "targets") result[f.key] = Array.isArray(v) ? v : [];
    else if (f.type === "nameservers")
      result[f.key] = String(v || "")
        .split(/[\n,]/)
        .map((v) => v.trim())
        .filter(Boolean);
    else if (v !== undefined && String(v).trim())
      result[f.key] = f.key === "pgVersion" ? Number(v) : String(v).trim();
  }
  return result;
}
function same(a: unknown, b: unknown) {
  return JSON.stringify(a) === JSON.stringify(b);
}
function matches(grant: Grant, plan: Plan) {
  return (
    grant.projectId === plan.projectId &&
    grant.status === "active" &&
    Date.parse(grant.expiresAt) > Date.now() &&
    grant.used < grant.maxOperations &&
    grant.scopes.some(
      (s) =>
        s.provider === plan.provider &&
        s.accountId === plan.accountId &&
        s.action === plan.action.slice(plan.provider.length + 1) &&
        Object.entries(s.match).every(([k, v]) => same(plan.settings[k], v)),
    )
  );
}

export function ProjectDeliveryPage({
  initialProjectId,
}: {
  initialProjectId?: string;
}) {
  const { state, notify, refresh, openApproval, navigate, setNavigationGuard } =
    useNakama();
  const [projectId, setProjectId] = useState(
    initialProjectId || state.projects[0]?.id || "",
  );
  const [action, setAction] = useState("github.repository.create"),
    [account, setAccount] = useState("");
  const [draft, setDraft] = useState<Record<string, string | string[]>>(
    defaults(action),
  );
  const [edited, setEdited] = useState(false),
    [secretName, setSecretName] = useState(""),
    [secretValue, setSecretValue] = useState("");
  const [data, setData] = useState<Library>(),
    [grants, setGrants] = useState<Grant[]>([]),
    [schemas, setSchemas] = useState<Record<string, string[]>>({});
  const [handoffs, setHandoffs] = useState<Handoff[]>([]),
    [deviceId, setDeviceId] = useState(""),
    [accountLabel, setAccountLabel] = useState("");
  const [deliveries, setDeliveries] = useState<DeliveryRun[]>([]),
    [workflowId, setWorkflowId] = useState(""),
    [answers, setAnswers] = useState<Record<string, string>>({});
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [revision, setRevision] = useState(0),
    [historyLimit, setHistoryLimit] = useState(15);
  const [grantPlan, setGrantPlan] = useState<Plan>(),
    [hours, setHours] = useState("1"),
    [maxOperations, setMaxOperations] = useState("1"),
    [chosenGrants, setChosenGrants] = useState<Record<string, string>>({});
  const alive = useRef(true),
    generation = useRef(0),
    mutating = useRef(false);
  const dirty =
      edited ||
      Boolean(secretValue || secretName || accountLabel) ||
      Object.values(answers).some(Boolean),
    dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  const provider = action.split(".")[0],
    accounts = state.connections.find((c) => c.id === provider)?.accounts || [],
    selectedAccount =
      account && accounts.some((a) => a.id === account)
        ? account
        : accounts[0]?.id || "";
  const currentProject = state.projects.find((p) => p.id === projectId),
    prefix = `/api/projects/${encodeURIComponent(projectId)}/provisioning`;
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      generation.current++;
    };
  }, []);
  useEffect(() => {
    const guard = () =>
      !dirtyRef.current ||
      window.confirm(
        "Discard your unsaved delivery settings and secret entry?",
      );
    setNavigationGuard(guard);
    const unload = (event: BeforeUnloadEvent) => {
      if (dirtyRef.current) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", unload);
    return () => {
      setNavigationGuard(null);
      window.removeEventListener("beforeunload", unload);
    };
  }, [setNavigationGuard]);
  useEffect(() => {
    let cancelled = false,
      inFlight = false;
    const epoch = ++generation.current;
    setData(undefined);
    setError("");
    const load = async () => {
      if (previewMode || !projectId || inFlight) return;
      inFlight = true;
      try {
        const [library, grantList, schemaList, handoffList, deliveryList] =
          await Promise.all([
            api<Library>("GET", prefix),
            api<{ grants: Grant[] }>("GET", "/api/project-grants"),
            api<{ actions: Record<string, string[]> }>(
              "GET",
              "/api/provisioning/schemas",
            ),
            api<{ requests: Handoff[] }>("GET", "/api/connection-handoffs"),
            api<{ runs: DeliveryRun[] }>(
              "GET",
              `/api/projects/${encodeURIComponent(projectId)}/delivery`,
            ),
          ]);
        if (!cancelled && generation.current === epoch) {
          setData(library);
          setGrants(grantList.grants);
          setSchemas(schemaList.actions);
          setHandoffs(handoffList.requests);
          setDeliveries(deliveryList.runs);
          setError("");
        }
      } catch (reason) {
        if (!cancelled && generation.current === epoch)
          setError(
            reason instanceof Error
              ? reason.message
              : "Delivery information is unavailable.",
          );
      } finally {
        inFlight = false;
      }
    };
    void load();
    const timer = setInterval(() => void load(), 4000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [projectId, prefix, revision]);
  function changeProject(value: string) {
    if (
      dirty &&
      !window.confirm("Discard unsaved delivery settings and secret entry?")
    )
      return;
    generation.current++;
    setProjectId(value);
    setDraft(defaults(action));
    setEdited(false);
    setSecretValue("");
    setSecretName("");
    setGrantPlan(undefined);
    setChosenGrants({});
    setHistoryLimit(15);
    setAnswers({});
    setWorkflowId("");
    setDeliveries([]);
  }
  function changeAction(value: string) {
    if (edited && !window.confirm("Discard your unsaved operation settings?"))
      return;
    setAction(value);
    setAccount("");
    setDraft(defaults(value));
    setEdited(false);
  }
  function update(key: string, value: string | string[]) {
    setDraft((d) => ({ ...d, [key]: value }));
    setEdited(true);
  }
  async function run<T>(
    method: string,
    path: string,
    body?: unknown,
    success?: string,
  ): Promise<T | undefined> {
    if (mutating.current) return;
    mutating.current = true;
    setBusy(true);
    setError("");
    const epoch = generation.current;
    try {
      const result = await api<T>(method, path, body);
      if (!alive.current || epoch !== generation.current) return;
      await refresh();
      if (!alive.current || epoch !== generation.current) return;
      if (success) notify(success);
      setRevision((v) => v + 1);
      return result;
    } catch (reason) {
      if (alive.current && epoch === generation.current)
        setError(
          reason instanceof Error
            ? reason.message
            : "The operation was not confirmed. Refresh its receipt before repeating it.",
        );
      return undefined;
    } finally {
      mutating.current = false;
      if (alive.current) setBusy(false);
    }
  }
  async function prepare() {
    const result = await run<Plan>(
      "POST",
      `${prefix}/prepare`,
      {
        provider,
        accountId: selectedAccount,
        action,
        settings: settingsFor(action, draft),
      },
      "Plan saved for review. No provider write was sent.",
    );
    if (result) {
      setEdited(false);
      dirtyRef.current = Boolean(secretName || secretValue || accountLabel);
    }
  }
  async function approval(plan: Plan) {
    const result = await run<{ id: string }>("POST", `${prefix}/request`, {
      planId: plan.id,
      planHash: plan.hash,
    });
    if (result) openApproval(result.id);
  }
  async function requestGrant() {
    if (!grantPlan) return;
    const result = await run<{ id: string }>("POST", "/api/project-grants", {
      projectId,
      scopes: [
        {
          provider: grantPlan.provider,
          accountId: grantPlan.accountId,
          action: grantPlan.action.slice(grantPlan.provider.length + 1),
          match: grantPlan.settings,
        },
      ],
      hours: Number(hours),
      maxOperations: Number(maxOperations),
    });
    if (result) {
      setGrantPlan(undefined);
      openApproval(result.id);
    }
  }
  const settings = settingsFor(action, draft),
    valid = Boolean(
      selectedAccount &&
      ACTIONS[action].fields.every(
        (f) =>
          !f.required ||
          (Array.isArray(settings[f.key])
            ? (settings[f.key] as string[]).length
            : Boolean(settings[f.key])),
      ),
    );
  const devices = state.devices.filter(
    (d) =>
      d.platform === "android" &&
      d.permissions?.googleAccess !== false &&
      d.permissions?.projectAccess !== false &&
      d.permissions?.browserControl === true,
  );
  const visiblePlans = [...(data?.plans || [])]
      .reverse()
      .slice(0, historyLimit),
    operations = [...(data?.operations || [])].reverse();
  const projectGrants = grants.filter((g) => g.projectId === projectId);
  const completedWorkflows = (state.projectWorkflows || [])
    .filter((w) => w.projectId === projectId && w.status === "completed")
    .slice()
    .reverse();
  const selectedWorkflow = completedWorkflows.some((w) => w.id === workflowId)
    ? workflowId
    : completedWorkflows[0]?.id || "";
  const activeDelivery = deliveries.some((d) =>
    ["running", "awaiting_approval", "awaiting_answers"].includes(d.status),
  );
  function settingLabel(key: string) {
    return (
      ACTIONS[action]?.fields.find((f) => f.key === key)?.label ||
      Object.values(ACTIONS)
        .flatMap((a) => a.fields)
        .find((f) => f.key === key)?.label ||
      key
    );
  }
  function displayValue(key: string, value: Value) {
    if (key === "secretRef")
      return (
        data?.secrets.find((s) => s.id === value)?.name ||
        "Saved project secret"
      );
    return Array.isArray(value)
      ? value.join(", ")
      : typeof value === "boolean"
        ? value
          ? "Yes"
          : "No"
        : String(value);
  }
  const details = (plan: Plan) => (
    <dl className="delivery-settings">
      {Object.entries(plan.settings).map(([key, value]) => (
        <div key={key}>
          <dt>{settingLabel(key)}</dt>
          <dd>{displayValue(key, value)}</dd>
        </div>
      ))}
    </dl>
  );
  return (
    <div className="page-enter delivery-page">
      <SectionTitle
        eyebrow="FROM READY TO RELEASE"
        title="Delivery"
        description="Prepare a concrete service change, review its scope, then follow the provider's receipt."
        action={
          <Button
            kind="secondary"
            disabled={busy}
            onClick={() => setRevision((v) => v + 1)}
          >
            <RefreshCw size={16} />
            Refresh
          </Button>
        }
      />
      <section className="panel delivery-intro">
        <Mascot size={85} />
        <div>
          <h3>A careful launch companion</h3>
          <p>
            Each write needs a Windows approval or an explicit, bounded project
            grant. Provider receipts describe accepted requests and status; they
            do not prove that an app is healthy.
          </p>
          <p>
            No service deletion, domain purchase or subscription upgrade is
            available here.
          </p>
        </div>
      </section>
      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
      {previewMode ? (
        <Empty
          icon={<Cloud size={30} />}
          title="Delivery needs the Windows host"
        >
          Use the installed Control Center to prepare service operations.
        </Empty>
      ) : !state.projects.length ? (
        <Empty icon={<Cloud size={30} />} title="Choose a home for this work">
          Create a Nakama project before preparing its services.
        </Empty>
      ) : (
        <>
          <label className="delivery-project">
            Nakama project
            <select
              value={projectId}
              disabled={busy}
              onChange={(e) => changeProject(e.target.value)}
            >
              {state.projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          {!currentProject ? (
            <p role="alert">
              This project is no longer available. Choose another project.
            </p>
          ) : (
            <>
              <section
                className="panel delivery-coordinator"
                aria-label="Managed project delivery"
              >
                <div className="delivery-section-heading">
                  <Mascot size={58} />
                  <div>
                    <h3>Let Nakama coordinate delivery</h3>
                    <p>
                      Continue from a completed, reviewed workflow. The manager
                      can prepare service operations and relay questions, while
                      approvals and bounded grants still control every external
                      write.
                    </p>
                  </div>
                </div>
                <div className="delivery-plan-actions">
                  <label>
                    Completed project workflow
                    <select
                      value={selectedWorkflow}
                      disabled={busy || activeDelivery}
                      onChange={(e) => setWorkflowId(e.target.value)}
                    >
                      <option value="">Choose a completed workflow</option>
                      {completedWorkflows.map((w) => (
                        <option key={w.id} value={w.id}>
                          {w.message.slice(0, 90)} ·{" "}
                          {relativeDate(w.updatedAt || w.createdAt)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <Button
                    disabled={busy || activeDelivery || !selectedWorkflow}
                    onClick={() =>
                      void run(
                        "POST",
                        `/api/projects/${encodeURIComponent(projectId)}/delivery/start`,
                        { workflowId: selectedWorkflow },
                        "Delivery manager started. Follow its questions and receipts below.",
                      )
                    }
                  >
                    Start delivery
                  </Button>
                </div>
                {!completedWorkflows.length && (
                  <p className="delivery-help">
                    Complete the project's planning, development and review
                    workflow first.
                  </p>
                )}
                {[...deliveries].reverse().map((delivery) => (
                  <article key={delivery.id} className="delivery-plan">
                    <div className="delivery-card-heading">
                      <h4>Delivery manager · round {delivery.round}</h4>
                      <Status value={delivery.status} />
                    </div>
                    {delivery.summary && (
                      <>
                        <small>Manager's recorded summary</small>
                        <p className="delivery-summary">{delivery.summary}</p>
                      </>
                    )}
                    <p className="delivery-help">
                      Live acceptance is still yours to verify. A model summary
                      or a provider's ready status does not establish that the
                      complete site works.
                    </p>
                    {delivery.status === "awaiting_answers" && (
                      <form
                        onSubmit={(e) => {
                          e.preventDefault();
                          void (async () => {
                            const pending = delivery.questions.filter(
                              (q) => !q.answer,
                            );
                            const result = await run(
                              "POST",
                              `/api/project-deliveries/${encodeURIComponent(delivery.id)}/answers`,
                              {
                                answers: pending.map((q) => ({
                                  id: q.id,
                                  answer: answers[q.id]?.trim() || "",
                                })),
                              },
                              "Answers shared with the delivery manager.",
                            );
                            if (result)
                              setAnswers((values) => {
                                const next = { ...values };
                                pending.forEach((q) => delete next[q.id]);
                                return next;
                              });
                          })();
                        }}
                      >
                        <fieldset disabled={busy}>
                          {delivery.questions
                            .filter((q) => !q.answer)
                            .map((q) => (
                              <label key={q.id}>
                                {q.question}
                                <textarea
                                  value={answers[q.id] || ""}
                                  maxLength={2000}
                                  rows={2}
                                  onChange={(e) =>
                                    setAnswers((a) => ({
                                      ...a,
                                      [q.id]: e.target.value,
                                    }))
                                  }
                                  required
                                />
                              </label>
                            ))}
                          <Button
                            type="submit"
                            disabled={
                              busy ||
                              delivery.questions
                                .filter((q) => !q.answer)
                                .some((q) => !answers[q.id]?.trim())
                            }
                          >
                            Send answers
                          </Button>
                        </fieldset>
                      </form>
                    )}
                    <div className="delivery-plan-actions">
                      {delivery.status === "awaiting_approval" &&
                        delivery.approvalId && (
                          <Button
                            disabled={busy}
                            onClick={() => openApproval(delivery.approvalId!)}
                          >
                            Review pending approval
                          </Button>
                        )}
                      {[
                        "running",
                        "awaiting_approval",
                        "awaiting_answers",
                      ].includes(delivery.status) && (
                        <Button
                          kind="secondary"
                          disabled={busy}
                          onClick={() =>
                            void run(
                              "POST",
                              `/api/project-deliveries/${encodeURIComponent(delivery.id)}/stop`,
                              {},
                              "Delivery manager stopped. Any submitted provider operation keeps its receipt.",
                            )
                          }
                        >
                          Stop delivery
                        </Button>
                      )}
                      {delivery.reportId && (
                        <small>
                          A saved delivery report is available in the project's
                          Reports tab.
                        </small>
                      )}
                    </div>
                  </article>
                ))}
              </section>
              <div className="delivery-columns">
                <section
                  className="panel delivery-form"
                  aria-label="Prepare a service operation"
                >
                  <div className="delivery-section-heading">
                    <Cloud size={22} />
                    <div>
                      <h3>Prepare an operation</h3>
                      <p>
                        Preparation saves a plan without writing to the
                        provider.
                      </p>
                    </div>
                  </div>
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      void prepare();
                    }}
                  >
                    <fieldset disabled={busy || !data || !schemas[action]}>
                      <div className="delivery-field-grid">
                        <label>
                          Provider
                          <select
                            value={provider}
                            onChange={(e) =>
                              changeAction(
                                Object.keys(ACTIONS).find((a) =>
                                  a.startsWith(`${e.target.value}.`),
                                )!,
                              )
                            }
                          >
                            {Object.entries(PROVIDERS).map(([id, name]) => (
                              <option key={id} value={id}>
                                {name}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label>
                          Operation
                          <select
                            value={action}
                            onChange={(e) => changeAction(e.target.value)}
                          >
                            {Object.entries(ACTIONS)
                              .filter(([id]) => id.startsWith(`${provider}.`))
                              .map(([id, a]) => (
                                <option key={id} value={id}>
                                  {a.label}
                                </option>
                              ))}
                          </select>
                        </label>
                      </div>
                      <p className="delivery-help">
                        {ACTIONS[action].description}
                      </p>
                      <label>
                        Saved {PROVIDERS[provider]} account
                        <select
                          value={selectedAccount}
                          onChange={(e) => {
                            setAccount(e.target.value);
                            setEdited(true);
                          }}
                          required
                        >
                          <option value="">Choose a saved account</option>
                          {accounts.map((a) => (
                            <option key={a.id} value={a.id}>
                              {a.accountLabel}
                            </option>
                          ))}
                        </select>
                      </label>
                      {!accounts.length && (
                        <p className="delivery-notice">
                          Add an API credential in Connections, or send a
                          connection request to a trusted phone below. Signing
                          into a browser alone does not link an API account.
                        </p>
                      )}
                      <div className="delivery-field-grid">
                        {ACTIONS[action].fields.map((f) =>
                          f.type === "checkbox" ? (
                            <label className="delivery-check" key={f.key}>
                              <input
                                type="checkbox"
                                checked={draft[f.key] === "true"}
                                onChange={(e) =>
                                  update(f.key, String(e.target.checked))
                                }
                              />
                              {f.label}
                            </label>
                          ) : f.type === "targets" ? (
                            <fieldset key={f.key} className="delivery-targets">
                              <legend>{f.label}</legend>
                              {["preview", "production", "development"].map(
                                (t) => (
                                  <label className="delivery-check" key={t}>
                                    <input
                                      type="checkbox"
                                      checked={
                                        Array.isArray(draft[f.key]) &&
                                        draft[f.key].includes(t)
                                      }
                                      onChange={(e) => {
                                        const values = Array.isArray(
                                          draft[f.key],
                                        )
                                          ? (draft[f.key] as string[])
                                          : [];
                                        update(
                                          f.key,
                                          e.target.checked
                                            ? [...values, t]
                                            : values.filter((v) => v !== t),
                                        );
                                      }}
                                    />
                                    {t}
                                  </label>
                                ),
                              )}
                            </fieldset>
                          ) : (
                            <label
                              key={f.key}
                              className={
                                f.type === "nameservers" ? "delivery-wide" : ""
                              }
                            >
                              {f.label}
                              {!f.required && (
                                <span className="delivery-optional">
                                  optional
                                </span>
                              )}
                              {f.type === "select" ? (
                                <select
                                  value={String(draft[f.key] || "")}
                                  onChange={(e) =>
                                    update(f.key, e.target.value)
                                  }
                                  required={f.required}
                                >
                                  {!f.required && (
                                    <option value="">
                                      Use provider default
                                    </option>
                                  )}
                                  {f.options?.map((v) => (
                                    <option key={v} value={v}>
                                      {v}
                                    </option>
                                  ))}
                                </select>
                              ) : f.type === "secret" ? (
                                <select
                                  value={String(draft[f.key] || "")}
                                  onChange={(e) =>
                                    update(f.key, e.target.value)
                                  }
                                  required
                                >
                                  <option value="">
                                    Choose a project secret
                                  </option>
                                  {data?.secrets.map((s) => (
                                    <option key={s.id} value={s.id}>
                                      {s.name}
                                    </option>
                                  ))}
                                </select>
                              ) : f.type === "nameservers" ? (
                                <textarea
                                  rows={3}
                                  maxLength={1200}
                                  value={String(draft[f.key] || "")}
                                  onChange={(e) =>
                                    update(f.key, e.target.value)
                                  }
                                  required
                                />
                              ) : (
                                <input
                                  value={String(draft[f.key] || "")}
                                  maxLength={
                                    f.key.endsWith("Command") ? 500 : 254
                                  }
                                  onChange={(e) =>
                                    update(f.key, e.target.value)
                                  }
                                  placeholder={f.placeholder}
                                  required={f.required}
                                  autoComplete="off"
                                  spellCheck={false}
                                />
                              )}
                              {f.help && <small>{f.help}</small>}
                            </label>
                          ),
                        )}
                      </div>
                      <Button
                        type="submit"
                        busy={busy}
                        disabled={!valid || !schemas[action]}
                      >
                        <ShieldCheck size={17} />
                        Prepare for review
                      </Button>
                    </fieldset>
                  </form>
                </section>
                <aside className="delivery-side">
                  <section
                    className="panel delivery-secret"
                    aria-label="Project secrets"
                  >
                    <div className="delivery-section-heading">
                      <KeyRound size={21} />
                      <div>
                        <h3>Project secrets</h3>
                        <p>
                          Values stay in the Windows vault. Plans use a
                          reference.
                        </p>
                      </div>
                    </div>
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        void (async () => {
                          const value = secretValue;
                          setSecretValue("");
                          dirtyRef.current =
                            edited || Boolean(secretName || accountLabel);
                          const result = await run<ProjectSecret>(
                            "POST",
                            `${prefix}/secrets`,
                            { name: secretName, value },
                            "Project secret saved securely.",
                          );
                          if (result) {
                            setSecretName("");
                            dirtyRef.current = edited || Boolean(accountLabel);
                          }
                        })();
                      }}
                    >
                      <fieldset disabled={busy}>
                        <label>
                          Secret label
                          <input
                            value={secretName}
                            maxLength={80}
                            onChange={(e) => setSecretName(e.target.value)}
                            placeholder="Database connection"
                            required
                          />
                        </label>
                        <label>
                          Secret value
                          <input
                            type="password"
                            value={secretValue}
                            onChange={(e) => setSecretValue(e.target.value)}
                            maxLength={16000}
                            autoComplete="new-password"
                            spellCheck={false}
                            required
                          />
                        </label>
                        <Button
                          type="submit"
                          kind="secondary"
                          disabled={!secretName.trim() || !secretValue}
                          busy={busy}
                        >
                          Save secret
                        </Button>
                      </fieldset>
                    </form>
                    <p className="delivery-help">
                      The entry clears when submitted or when you leave. A
                      changed value creates a new reference, so an old approval
                      cannot silently use it.
                    </p>
                    <ul className="delivery-small-list">
                      {data?.secrets.map((s) => (
                        <li key={s.id}>
                          <KeyRound size={14} />
                          <span>
                            {s.name}
                            <small>
                              {s.source === "neon"
                                ? "Retrieved from Neon"
                                : "Saved by you"}{" "}
                              · {relativeDate(s.createdAt)}
                            </small>
                          </span>
                        </li>
                      ))}
                    </ul>
                  </section>
                  <section
                    className="panel delivery-phone"
                    aria-label="Connect a provider on Android"
                  >
                    <div className="delivery-section-heading">
                      <Smartphone size={21} />
                      <div>
                        <h3>Connect on your phone</h3>
                        <p>
                          Send a one-use {PROVIDERS[provider]} credential
                          request to a trusted Android device.
                        </p>
                      </div>
                    </div>
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        void (async () => {
                          const result = await run<Handoff>(
                            "POST",
                            "/api/connection-handoffs",
                            { provider, deviceId, accountLabel },
                            "Connection request sent to the selected phone.",
                          );
                          if (result) {
                            setAccountLabel("");
                            dirtyRef.current =
                              edited || Boolean(secretName || secretValue);
                          }
                        })();
                      }}
                    >
                      <fieldset disabled={busy}>
                        <label>
                          Trusted phone
                          <select
                            value={deviceId}
                            onChange={(e) => setDeviceId(e.target.value)}
                            required
                          >
                            <option value="">Choose a device</option>
                            {devices.map((d) => (
                              <option key={d.id} value={d.id}>
                                {d.name}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label>
                          New account label
                          <input
                            value={accountLabel}
                            maxLength={120}
                            onChange={(e) => setAccountLabel(e.target.value)}
                            required
                            placeholder="My project account"
                          />
                        </label>
                        <Button
                          kind="secondary"
                          type="submit"
                          disabled={!deviceId || !accountLabel.trim()}
                        >
                          Send connection request
                        </Button>
                      </fieldset>
                    </form>
                    <p className="delivery-help">
                      The phone opens the provider's sign-in page and can submit
                      an API credential over the paired connection. Browser
                      cookies and API credentials are separate. Enable Google,
                      project and browser access for that phone first.
                    </p>
                    {handoffs
                      .filter((h) => h.status === "waiting")
                      .map((h) => (
                        <div className="delivery-handoff" key={h.id}>
                          <span>
                            {PROVIDERS[h.provider]} · {h.accountLabel}
                            <small>
                              Waiting on{" "}
                              {state.devices.find((d) => d.id === h.deviceId)
                                ?.name || "the selected phone"}
                            </small>
                          </span>
                          <Button
                            kind="ghost"
                            disabled={busy}
                            onClick={() =>
                              void run(
                                "DELETE",
                                `/api/connection-handoffs/${encodeURIComponent(h.id)}`,
                              )
                            }
                            aria-label={`Cancel ${h.accountLabel} connection request`}
                          >
                            <X size={16} />
                          </Button>
                        </div>
                      ))}
                  </section>
                </aside>
              </div>
              <section
                className="panel delivery-plans"
                aria-label="Prepared delivery plans"
              >
                <div className="delivery-section-heading">
                  <ShieldCheck size={22} />
                  <div>
                    <h3>Plans ready for your decision</h3>
                    <p>
                      Review the saved details. A grant only applies while its
                      exact settings, account and project still match.
                    </p>
                  </div>
                </div>
                {!data ? (
                  <p>Loading delivery plans…</p>
                ) : !visiblePlans.length ? (
                  <p className="delivery-help">
                    Your prepared plans will appear here.
                  </p>
                ) : (
                  visiblePlans.map((plan) => {
                    const attempted = data.operations.find(
                        (o) => o.planId === plan.id,
                      ),
                      expired = Date.parse(plan.expiresAt) <= Date.now(),
                      availableGrants = grants.filter((g) => matches(g, plan));
                    return (
                      <article className="delivery-plan" key={plan.id}>
                        <div className="delivery-card-heading">
                          <div>
                            <span className="eyebrow">
                              {PROVIDERS[plan.provider]} ·{" "}
                              {state.connections
                                .find((c) => c.id === plan.provider)
                                ?.accounts?.find((a) => a.id === plan.accountId)
                                ?.accountLabel || "Saved account"}
                            </span>
                            <h4>
                              {ACTIONS[plan.action]?.label || plan.action}
                            </h4>
                          </div>
                          <Status
                            value={
                              attempted?.status ||
                              (expired ? "expired" : "awaiting_approval")
                            }
                          />
                        </div>
                        <p>{plan.summary}</p>
                        {details(plan)}
                        <small>
                          Prepared {relativeDate(plan.createdAt)} · expires{" "}
                          {new Date(plan.expiresAt).toLocaleTimeString()}
                        </small>
                        {!attempted && !expired && (
                          <div className="delivery-plan-actions">
                            <Button
                              disabled={busy}
                              onClick={() => void approval(plan)}
                            >
                              Request Windows approval
                            </Button>
                            <Button
                              kind="secondary"
                              disabled={busy}
                              onClick={() => {
                                setGrantPlan(plan);
                                setHours("1");
                                setMaxOperations("1");
                              }}
                            >
                              Authorize a bounded scope
                            </Button>
                            {availableGrants.length > 0 && (
                              <div className="delivery-grant-run">
                                <label>
                                  Approved scope
                                  <select
                                    value={chosenGrants[plan.id] || ""}
                                    onChange={(e) =>
                                      setChosenGrants((g) => ({
                                        ...g,
                                        [plan.id]: e.target.value,
                                      }))
                                    }
                                    disabled={busy}
                                  >
                                    <option value="">
                                      Choose an active grant
                                    </option>
                                    {availableGrants.map((g) => (
                                      <option key={g.id} value={g.id}>
                                        {g.maxOperations - g.used} operations
                                        left · expires{" "}
                                        {new Date(
                                          g.expiresAt,
                                        ).toLocaleTimeString()}
                                      </option>
                                    ))}
                                  </select>
                                </label>
                                <Button
                                  kind="secondary"
                                  disabled={
                                    busy ||
                                    !availableGrants.some(
                                      (g) => g.id === chosenGrants[plan.id],
                                    )
                                  }
                                  onClick={() =>
                                    void run(
                                      "POST",
                                      `${prefix}/execute`,
                                      {
                                        planId: plan.id,
                                        planHash: plan.hash,
                                        grantId: chosenGrants[plan.id],
                                      },
                                      "Provider request finished. Review its receipt below.",
                                    )
                                  }
                                >
                                  Run with selected grant
                                </Button>
                              </div>
                            )}
                          </div>
                        )}
                      </article>
                    );
                  })
                )}
                {(data?.plans.length || 0) > historyLimit && (
                  <Button
                    kind="ghost"
                    disabled={busy}
                    onClick={() => setHistoryLimit((n) => n + 15)}
                  >
                    Show older plans
                  </Button>
                )}
              </section>
              {grantPlan && (
                <section
                  className="panel delivery-grant-editor"
                  aria-label="Bounded scope review"
                >
                  <h3>Authorize these exact settings</h3>
                  <p>
                    {ACTIONS[grantPlan.action]?.label} ·{" "}
                    {PROVIDERS[grantPlan.provider]} · {currentProject.name}
                  </p>
                  {details(grantPlan)}
                  <p className="delivery-notice">
                    After Windows approval, matching operations may run without
                    another prompt until this limit expires or is revoked.
                    Changing a commit, environment value reference, target or
                    nameserver list needs a different scope.
                  </p>
                  <div className="delivery-field-grid">
                    <label>
                      Duration in hours
                      <input
                        type="number"
                        min={1}
                        max={24}
                        value={hours}
                        onChange={(e) => setHours(e.target.value)}
                        disabled={busy}
                      />
                    </label>
                    <label>
                      Maximum operations
                      <input
                        type="number"
                        min={1}
                        max={30}
                        value={maxOperations}
                        onChange={(e) => setMaxOperations(e.target.value)}
                        disabled={busy}
                      />
                    </label>
                  </div>
                  <div className="delivery-plan-actions">
                    <Button
                      disabled={
                        busy ||
                        !Number.isInteger(Number(hours)) ||
                        Number(hours) < 1 ||
                        Number(hours) > 24 ||
                        !Number.isInteger(Number(maxOperations)) ||
                        Number(maxOperations) < 1 ||
                        Number(maxOperations) > 30
                      }
                      onClick={() => void requestGrant()}
                    >
                      Review scope in Windows approvals
                    </Button>
                    <Button
                      kind="ghost"
                      disabled={busy}
                      onClick={() => setGrantPlan(undefined)}
                    >
                      Cancel
                    </Button>
                  </div>
                </section>
              )}
              {!!projectGrants.length && (
                <section
                  className="panel delivery-grants"
                  aria-label="Project authorization scopes"
                >
                  <h3>Project authorizations</h3>
                  {projectGrants.map((g) => (
                    <div className="delivery-handoff" key={g.id}>
                      <span>
                        {g.scopes
                          .map(
                            (s) =>
                              `${PROVIDERS[s.provider]} ${ACTIONS[`${s.provider}.${s.action}`]?.label || s.action}`,
                          )
                          .join(", ")}
                        <small>
                          {g.used} of {g.maxOperations} operations used ·{" "}
                          {g.status === "active" &&
                          Date.parse(g.expiresAt) > Date.now()
                            ? `expires ${new Date(g.expiresAt).toLocaleString()}`
                            : g.status === "active"
                              ? "expired"
                              : g.status}
                        </small>
                      </span>
                      {g.status === "active" && (
                        <Button
                          kind="secondary"
                          disabled={busy}
                          onClick={() =>
                            void run(
                              "DELETE",
                              `/api/project-grants/${encodeURIComponent(g.id)}`,
                              undefined,
                              "Project authorization revoked.",
                            )
                          }
                        >
                          Revoke
                        </Button>
                      )}
                    </div>
                  ))}
                </section>
              )}
              <section
                className="panel delivery-receipts"
                aria-label="Delivery receipts"
              >
                <div className="delivery-section-heading">
                  <Check size={22} />
                  <div>
                    <h3>What the provider reported</h3>
                    <p>
                      A ready deployment status is provider evidence. Check the
                      actual site separately before declaring delivery
                      successful.
                    </p>
                  </div>
                </div>
                {!operations.length ? (
                  <p className="delivery-help">
                    No service operations have been attempted for this project.
                  </p>
                ) : (
                  operations.map((op) => (
                    <article className="delivery-receipt" key={op.id}>
                      <div className="delivery-card-heading">
                        <h4>
                          {PROVIDERS[op.provider]} ·{" "}
                          {ACTIONS[op.action]?.label || op.action}
                        </h4>
                        <Status value={op.status} />
                      </div>
                      <p>
                        {op.verification
                          ? `Latest provider status: ${op.verification.providerStatus.replaceAll("_", " ")}`
                          : op.result
                            ? `Provider receipt: ${op.result.providerStatus.replaceAll("_", " ")}`
                            : "No confirmed provider receipt."}
                      </p>
                      {op.result && (
                        <small>
                          Resource:{" "}
                          {op.result.repository || op.result.resourceId}
                        </small>
                      )}
                      {op.error && <p className="inline-error">{op.error}</p>}
                      {op.warning && (
                        <p className="delivery-notice">{op.warning}</p>
                      )}
                      {op.result?.connectionUnavailable && (
                        <p className="delivery-notice">
                          The project was created, but no usable connection was
                          returned. Prepare “Save a database connection” for
                          this project instead of creating it again.
                        </p>
                      )}
                      {op.result?.secretRefs?.length && (
                        <p className="delivery-help">
                          Project secret references saved or used:{" "}
                          {op.result.secretRefs
                            .map(
                              (id) =>
                                data?.secrets.find((s) => s.id === id)?.name ||
                                "Protected project secret",
                            )
                            .join(", ")}
                        </p>
                      )}
                      <div className="delivery-plan-actions">
                        <small>
                          {relativeDate(op.startedAt)}
                          {op.verification &&
                            ` · status checked ${relativeDate(op.verification.checkedAt)}`}
                        </small>
                        {op.result?.resourceId && (
                          <Button
                            kind="secondary"
                            disabled={busy}
                            onClick={() =>
                              void run(
                                "POST",
                                `${prefix}/verify`,
                                { operationId: op.id },
                                "Provider status refreshed. No write was repeated.",
                              )
                            }
                          >
                            Check provider status
                          </Button>
                        )}
                      </div>
                    </article>
                  ))
                )}
              </section>
            </>
          )}
          <Button kind="ghost" onClick={() => navigate("connections")}>
            Manage connected accounts
          </Button>
        </>
      )}
    </div>
  );
}
