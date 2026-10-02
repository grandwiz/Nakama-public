import { useState } from "react";
import {
  ArrowRight,
  FolderOpen,
  Info,
  Mail,
  RefreshCw,
  Rocket,
  Send,
  ShieldCheck,
} from "lucide-react";
import { api, openExternal } from "./bridge";
import { Button, Empty, Modal, Status, TextLink } from "./components";
import { useNakama } from "./context";

type ResourceField = { key: string; label: string; optional?: boolean };
type Resource = { id: string; label: string; fields: ResourceField[] };
type ServiceItem = Record<string, string | boolean>;
const resources: Record<string, Resource[]> = {
  github: [
    { id: "repositories", label: "Repositories", fields: [] },
    {
      id: "deployments",
      label: "Repository deployments",
      fields: [
        { key: "owner", label: "Repository owner" },
        { key: "repo", label: "Repository name" },
      ],
    },
  ],
  vercel: [
    {
      id: "projects",
      label: "Projects",
      fields: [{ key: "teamId", label: "Team ID", optional: true }],
    },
    {
      id: "deployments",
      label: "Deployments",
      fields: [
        { key: "remoteProjectId", label: "Vercel project ID", optional: true },
        { key: "teamId", label: "Team ID", optional: true },
      ],
    },
  ],
  render: [
    { id: "services", label: "Services", fields: [] },
    {
      id: "deployments",
      label: "Service deployments",
      fields: [{ key: "serviceId", label: "Render service ID" }],
    },
  ],
  neon: [
    {
      id: "projects",
      label: "Projects",
      fields: [{ key: "orgId", label: "Organisation ID", optional: true }],
    },
    {
      id: "branches",
      label: "Project branches",
      fields: [{ key: "remoteProjectId", label: "Neon project ID" }],
    },
    {
      id: "databases",
      label: "Branch databases",
      fields: [
        { key: "remoteProjectId", label: "Neon project ID" },
        { key: "branchId", label: "Branch ID" },
      ],
    },
  ],
  resend: [{ id: "domains", label: "Sending domains", fields: [] }],
};
export interface ServiceSelection {
  provider: string;
  accountId: string;
  label: string;
}
export function ServiceExplorer({
  selection,
  onClose,
}: {
  selection: ServiceSelection;
  onClose: () => void;
}) {
  const { state, notify } = useNakama();
  const options = resources[selection.provider] || [];
  const [resource, setResource] = useState(options[0]?.id || "");
  const [params, setParams] = useState<Record<string, string>>({});
  const [items, setItems] = useState<ServiceItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [deployment, setDeployment] = useState<ServiceItem>();
  const [writeEmail, setWriteEmail] = useState(false);
  const option = options.find((item) => item.id === resource) || options[0];
  const providerName =
    state.connections.find((item) => item.id === selection.provider)?.name ||
    selection.provider;
  const load = async (next = false) => {
    if (!option) return;
    for (const field of option.fields)
      if (!field.optional && !params[field.key]?.trim()) {
        notify(`Enter ${field.label.toLowerCase()} first.`, true);
        return;
      }
    setBusy(true);
    try {
      const search = new URLSearchParams();
      for (const field of option.fields)
        if (params[field.key]?.trim())
          search.set(field.key, params[field.key].trim());
      if (next && cursor) search.set("cursor", cursor);
      const result = await api<{
        items: ServiceItem[];
        hasMore: boolean;
        nextCursor: string | null;
      }>(
        "GET",
        `/api/services/${selection.provider}/${selection.accountId}/${resource}${search.size ? "?" + search : ""}`,
      );
      setItems((current) =>
        next ? [...current, ...result.items] : result.items,
      );
      setHasMore(result.hasMore);
      setCursor(result.nextCursor);
      setLoaded(true);
    } catch (reason) {
      notify(
        reason instanceof Error
          ? reason.message
          : "Could not load these resources.",
        true,
      );
    } finally {
      setBusy(false);
    }
  };
  if (deployment)
    return (
      <DeploymentRequest
        initialProvider={selection.provider}
        initialAccountId={selection.accountId}
        resource={deployment}
        onClose={() => setDeployment(undefined)}
      />
    );
  if (writeEmail)
    return (
      <ResendCompose
        selection={selection}
        onClose={() => setWriteEmail(false)}
      />
    );
  return (
    <Modal
      wide
      title={`${providerName} · ${selection.label}`}
      description="Browse this account’s resources. Listing resources does not change them."
      onClose={onClose}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void load();
        }}
      >
        <div className="service-explorer-toolbar">
          <label className="field">
            What would you like to view?
            <select
              value={resource}
              onChange={(event) => {
                setResource(event.target.value);
                setParams({});
                setItems([]);
                setLoaded(false);
                setCursor(null);
                setHasMore(false);
              }}
            >
              {options.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
          <Button type="submit" kind="secondary" busy={busy}>
            <RefreshCw size={14} />
            {loaded ? "Refresh" : "Load resources"}
          </Button>
        </div>
        {option?.fields.length > 0 && (
          <div className="two-column">
            {option.fields.map((field) => (
              <label className="field" key={field.key}>
                {field.label}
                {field.optional ? " · optional" : ""}
                <input
                  required={!field.optional}
                  value={params[field.key] || ""}
                  onChange={(event) =>
                    setParams((current) => ({
                      ...current,
                      [field.key]: event.target.value,
                    }))
                  }
                />
              </label>
            ))}
          </div>
        )}
      </form>
      {["vercel", "render"].includes(selection.provider) && (
        <div className="service-action-callout">
          <p>
            Deploy an exact Git commit after reviewing its target and approving
            it.
          </p>
          <Button kind="secondary" onClick={() => setDeployment({})}>
            <Rocket size={14} />
            Request deployment
          </Button>
        </div>
      )}
      {selection.provider === "resend" && (
        <div className="service-action-callout">
          <p>
            Send a plain-text email from one of your verified sending domains.
          </p>
          <Button kind="secondary" onClick={() => setWriteEmail(true)}>
            <Mail size={14} />
            Write email
          </Button>
        </div>
      )}
      {loaded ? (
        items.length ? (
          <div className="service-resource-list">
            {items.map((item, index) => (
              <article
                className="service-resource"
                key={String(item.id || index)}
              >
                <div className="service-resource-heading">
                  <span>
                    <strong>
                      {String(item.name || item.id || "Resource")}
                    </strong>
                    <small>{String(item.id || "")}</small>
                  </span>
                  {item.status && <Status value={String(item.status)} />}
                </div>
                <dl>
                  {Object.entries(item)
                    .filter(
                      ([key, value]) =>
                        !["name", "id", "url", "status"].includes(key) &&
                        value !== "" &&
                        value !== undefined,
                    )
                    .map(([key, value]) => (
                      <div key={key}>
                        <dt>{key.replace(/([A-Z])/g, " $1").toLowerCase()}</dt>
                        <dd>{String(value)}</dd>
                      </div>
                    ))}
                </dl>
                <div className="service-resource-actions">
                  {typeof item.url === "string" &&
                    item.url.startsWith("https://") && (
                      <TextLink
                        external
                        onClick={() => void openExternal(String(item.url))}
                      >
                        Open in browser
                      </TextLink>
                    )}
                  {((selection.provider === "vercel" &&
                    resource === "projects") ||
                    (selection.provider === "render" &&
                      resource === "services")) && (
                    <TextLink onClick={() => setDeployment(item)}>
                      Prepare deployment
                    </TextLink>
                  )}
                  {selection.provider === "neon" && resource === "projects" && (
                    <TextLink
                      onClick={() => {
                        setResource("branches");
                        setParams({ remoteProjectId: String(item.id) });
                        setItems([]);
                        setLoaded(false);
                      }}
                    >
                      View branches
                    </TextLink>
                  )}
                </div>
              </article>
            ))}
          </div>
        ) : (
          <Empty icon={<FolderOpen size={25} />} title="No resources returned">
            Check the account and any filters, or create a resource in the
            provider’s dashboard.
          </Empty>
        )
      ) : (
        <div className="inline-note">
          <Info size={17} />
          <span>
            Choose a resource and select Load resources. The host makes a
            read-only request using the saved account token.
          </span>
        </div>
      )}
      {loaded && hasMore && (
        <div className="service-pagination">
          {cursor ? (
            <Button
              kind="secondary"
              busy={busy}
              onClick={() => void load(true)}
            >
              Load more
              <ArrowRight size={14} />
            </Button>
          ) : (
            <p className="small-copy">
              More results exist. This provider did not supply another page
              cursor; narrow your selection or use its dashboard.
            </p>
          )}
        </div>
      )}
      <div className="modal-actions">
        <Button kind="secondary" onClick={onClose}>
          Done
        </Button>
      </div>
    </Modal>
  );
}

export function DeploymentRequest({
  initialProjectId,
  initialProvider = "vercel",
  initialAccountId,
  resource,
  onClose,
}: {
  initialProjectId?: string;
  initialProvider?: string;
  initialAccountId?: string;
  resource?: ServiceItem;
  onClose: () => void;
}) {
  const { state, perform } = useNakama();
  const [provider, setProvider] = useState(initialProvider);
  const [projectId, setProjectId] = useState(initialProjectId || "");
  const [accountId, setAccountId] = useState(initialAccountId || "");
  const [commitId, setCommitId] = useState("");
  const [serviceId, setServiceId] = useState(
    initialProvider === "render" ? String(resource?.id || "") : "",
  );
  const [vercelProjectId, setVercelProjectId] = useState(
    initialProvider === "vercel" ? String(resource?.id || "") : "",
  );
  const [deploymentName, setDeploymentName] = useState(
    initialProvider === "vercel" ? String(resource?.name || "") : "",
  );
  const [repoId, setRepoId] = useState(String(resource?.repoId || ""));
  const [ref, setRef] = useState("");
  const [target, setTarget] = useState("preview");
  const [teamId, setTeamId] = useState("");
  const [busy, setBusy] = useState(false);
  const accounts =
    state.connections.find((item) => item.id === provider)?.accounts || [];
  const account = accounts.find((item) => item.id === accountId) || accounts[0];
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    const payload = {
      provider,
      projectId,
      accountId: account?.id,
      commitId: commitId.trim(),
      ...(provider === "render"
        ? { serviceId: serviceId.trim() }
        : {
            vercelProjectId: vercelProjectId.trim(),
            deploymentName: deploymentName.trim(),
            repoId: repoId.trim(),
            ref: ref.trim(),
            target,
            ...(teamId.trim() ? { teamId: teamId.trim() } : {}),
          }),
    };
    const result = await perform(
      "POST",
      "/api/deployments",
      payload,
      "Deployment request created. Review its exact commit and destination in Activity & approvals.",
    );
    setBusy(false);
    if (result) onClose();
  };
  return (
    <Modal
      wide
      title="Request a Git deployment"
      description="Choose the exact remote target and commit. Nothing is deployed until you approve this request on the desktop."
      onClose={onClose}
    >
      <form onSubmit={(event) => void submit(event)}>
        <div className="two-column">
          <label className="field">
            Hosting provider
            <select
              value={provider}
              onChange={(event) => {
                setProvider(event.target.value);
                setAccountId("");
              }}
            >
              <option value="vercel">Vercel</option>
              <option value="render">Render</option>
            </select>
          </label>
          <label className="field">
            Service account
            <select
              required
              value={account?.id || ""}
              onChange={(event) => setAccountId(event.target.value)}
            >
              {!accounts.length && (
                <option value="">Add an account in Connections</option>
              )}
              {accounts.map((item) => (
                <option value={item.id} key={item.id}>
                  {item.accountLabel}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label className="field">
          Nakama project
          <select
            required
            value={projectId}
            onChange={(event) => setProjectId(event.target.value)}
          >
            <option value="">Choose a project</option>
            {state.projects.map((item) => (
              <option value={item.id} key={item.id}>
                {item.name}
              </option>
            ))}
          </select>
          <small>
            The deployment uses the provider’s linked Git repository.
            Uncommitted local files are not uploaded by this action.
          </small>
        </label>
        <label className="field">
          Exact Git commit SHA
          <input
            required
            value={commitId}
            onChange={(event) => setCommitId(event.target.value)}
            pattern="[a-fA-F0-9]{40}"
            minLength={40}
            maxLength={40}
            placeholder="40-character commit ID"
          />
          <small>
            Push this commit to the linked repository before requesting
            deployment.
          </small>
        </label>
        {provider === "render" ? (
          <label className="field">
            Render service ID
            <input
              required
              value={serviceId}
              onChange={(event) => setServiceId(event.target.value)}
              placeholder="srv-…"
            />
          </label>
        ) : (
          <>
            <div className="two-column">
              <label className="field">
                Vercel project ID
                <input
                  required
                  value={vercelProjectId}
                  onChange={(event) => setVercelProjectId(event.target.value)}
                  placeholder="prj_…"
                />
              </label>
              <label className="field">
                Exact Vercel project name
                <input
                  required
                  value={deploymentName}
                  onChange={(event) => setDeploymentName(event.target.value)}
                  placeholder="my-project"
                />
              </label>
              <label className="field">
                Linked GitHub repository ID
                <input
                  required
                  inputMode="numeric"
                  pattern="[0-9]{1,20}"
                  value={repoId}
                  onChange={(event) => setRepoId(event.target.value)}
                  placeholder="Numeric repository ID"
                />
              </label>
              <label className="field">
                Git branch or tag
                <input
                  required
                  value={ref}
                  onChange={(event) => setRef(event.target.value)}
                  placeholder="Enter the branch or tag"
                />
              </label>
              <label className="field">
                Deployment target
                <select
                  value={target}
                  onChange={(event) => setTarget(event.target.value)}
                >
                  <option value="preview">Preview</option>
                  <option value="production">Production</option>
                </select>
              </label>
              <label className="field">
                Vercel team ID · optional
                <input
                  value={teamId}
                  onChange={(event) => setTeamId(event.target.value)}
                  placeholder="team_…"
                />
              </label>
            </div>
          </>
        )}
        <div className="inline-note">
          <ShieldCheck size={18} />
          <span>
            Both preview and production deployments always require approval.
            Provider acceptance does not confirm that the build completed or the
            application is healthy.
          </span>
        </div>
        <div className="modal-actions">
          <Button type="button" kind="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="submit"
            busy={busy}
            disabled={!account || !projectId || commitId.trim().length !== 40}
          >
            <Rocket size={15} />
            Create approval request
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function ResendCompose({
  selection,
  onClose,
}: {
  selection: ServiceSelection;
  onClose: () => void;
}) {
  const { state, perform, notify } = useNakama();
  const [requestId] = useState(() => crypto.randomUUID());
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const recipients = to
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
    if (!recipients.length || recipients.length > 10) {
      notify(
        "Enter between 1 and 10 comma-separated recipient email addresses.",
        true,
      );
      return;
    }
    setBusy(true);
    const result = await perform<{ status?: string; message?: string }>(
      "POST",
      `/api/services/resend/${selection.accountId}/send-email`,
      {
        requestId,
        from: from.trim(),
        to: recipients,
        subject: subject.trim(),
        text: message,
      },
    );
    setBusy(false);
    if (result) {
      notify(
        result.status === "pending"
          ? "Email request is waiting in your approvals inbox."
          : "Resend accepted the email. Delivery has not been verified.",
      );
      onClose();
    }
  };
  return (
    <Modal
      title="Write an email with Resend"
      description={`Using ${selection.label}. The sending domain must be verified in Resend.`}
      onClose={onClose}
    >
      <form onSubmit={(event) => void submit(event)}>
        <label className="field">
          From address
          <input
            type="email"
            required
            value={from}
            onChange={(event) => setFrom(event.target.value)}
            placeholder="you@your-domain.com"
          />
        </label>
        <label className="field">
          To · comma-separated addresses
          <input
            required
            value={to}
            onChange={(event) => setTo(event.target.value)}
            placeholder="person@example.com"
          />
        </label>
        <label className="field">
          Subject
          <input
            required
            value={subject}
            onChange={(event) => setSubject(event.target.value)}
            maxLength={300}
          />
        </label>
        <label className="field">
          Message
          <textarea
            required
            rows={5}
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            maxLength={100000}
          />
        </label>
        <p className="small-copy">
          {state.config.confirmOrdinaryActions
            ? "This will create an approval request."
            : "Selecting Send email submits this exact message to Resend."}{" "}
          An accepted request is not proof of delivery.
        </p>
        <div className="modal-actions">
          <Button type="button" kind="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" busy={busy}>
            <Send size={15} />
            {state.config.confirmOrdinaryActions
              ? "Request approval"
              : "Send email"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
