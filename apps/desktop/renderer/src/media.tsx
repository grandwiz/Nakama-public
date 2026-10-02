import { useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  Clapperboard,
  Copy,
  Info,
  Link2,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import { api, copyText, openExternal, previewMode } from "./bridge";
import {
  Button,
  Empty,
  Modal,
  SectionTitle,
  Status,
  TextLink,
  Toggle,
  relativeDate,
} from "./components";
import { useNakama } from "./context";
import "./kling.css";

interface Parameter {
  type?: string;
  title?: string;
  description?: string;
  enum?: (string | number | boolean)[];
  default?: unknown;
  minimum?: number;
  maximum?: number;
}
interface KlingModel {
  id: string;
  name: string;
  parameters: { properties?: Record<string, Parameter>; required?: string[] };
}
interface KlingStatus {
  installed: boolean;
  detail: string;
  enabled: boolean;
  mcpConfigured: boolean;
}
interface KlingAccount {
  credits: number | null;
  detail: string;
}
interface KlingJob {
  id: string;
  status: string;
  request: {
    prompt: string;
    model: string;
    parameters: Record<string, unknown>;
    projectId?: string;
  };
  generationId?: string;
  results?: { index: number; url: string; contentType: string }[];
  error?: string;
  createdAt: string;
  approvalId?: string;
}
interface Catalogue {
  models: KlingModel[];
  detail: string;
}
const loginCommand =
  "npm exec --yes --registry=https://registry.npmjs.org --package=@klingai/cli-global@0.2.0 -- kling login --skill-name kling-ai-cli --skill-version 1.0.5";
const reservedParameters = new Set(["prompt", "model"]);

function parseParameters(model: KlingModel, inputs: Record<string, string>) {
  const parameters: Record<string, unknown> = {};
  for (const [key, schema] of Object.entries(
    model.parameters.properties || {},
  )) {
    if (reservedParameters.has(key)) continue;
    const raw = inputs[key];
    if (raw === undefined || raw === "") continue;
    if (schema.enum)
      parameters[key] = schema.enum.find((value) => String(value) === raw);
    else if (schema.type === "number" || schema.type === "integer") {
      const value = Number(raw);
      if (
        !Number.isFinite(value) ||
        (schema.type === "integer" && !Number.isInteger(value))
      )
        throw new Error(`${schema.title || key} needs a valid ${schema.type}.`);
      parameters[key] = value;
    } else if (schema.type === "boolean") parameters[key] = raw === "true";
    else if (schema.type === "object" || schema.type === "array") {
      try {
        parameters[key] = JSON.parse(raw);
      } catch {
        throw new Error(`${schema.title || key} needs valid JSON.`);
      }
    } else parameters[key] = raw;
  }
  return parameters;
}

export function MediaPanel() {
  const { state, perform, notify, navigate } = useNakama();
  const [status, setStatus] = useState<KlingStatus>();
  const [catalogue, setCatalogue] = useState<Catalogue>();
  const [account, setAccount] = useState<KlingAccount>();
  const [jobs, setJobs] = useState<KlingJob[]>([]);
  const [modelId, setModelId] = useState("");
  const [projectId, setProjectId] = useState("");
  const [prompt, setPrompt] = useState("");
  const [inputs, setInputs] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [setup, setSetup] = useState(false);
  const [mcp, setMcp] = useState<{ config: unknown; detail: string }>();
  const mounted = useRef(true);
  const selected =
    catalogue?.models.find((item) => item.id === modelId) ||
    catalogue?.models[0];
  const fields = Object.entries(selected?.parameters.properties || {}).filter(
    ([key]) => !reservedParameters.has(key),
  );

  useEffect(() => {
    mounted.current = true;
    const load = async () => {
      if (previewMode) return;
      try {
        const [next, nextJobs] = await Promise.all([
          api<KlingStatus>("GET", "/api/kling/status"),
          api<{ jobs: KlingJob[] }>("GET", "/api/kling/jobs"),
        ]);
        if (mounted.current) {
          setStatus(next);
          setJobs(nextJobs.jobs);
        }
      } catch (reason) {
        if (mounted.current)
          setError(
            reason instanceof Error
              ? reason.message
              : "Kling setup is unavailable.",
          );
      }
    };
    void load();
    const interval = setInterval(() => void load(), 8000);
    return () => {
      mounted.current = false;
      clearInterval(interval);
    };
  }, []);

  const refresh = async () => {
    setBusy("refresh");
    setError("");
    try {
      const [modelsResult, accountResult, statusResult] =
        await Promise.allSettled([
          api<Catalogue>("GET", "/api/kling/catalogue"),
          api<KlingAccount>("GET", "/api/kling/account"),
          api<KlingStatus>("GET", "/api/kling/status"),
        ]);
      if (!mounted.current) return;
      if (modelsResult.status === "fulfilled") {
        setCatalogue(modelsResult.value);
        setModelId("");
        setInputs({});
      } else {
        setCatalogue(undefined);
        setError(
          modelsResult.reason instanceof Error
            ? modelsResult.reason.message
            : "Could not read your Kling models.",
        );
      }
      if (accountResult.status === "fulfilled") setAccount(accountResult.value);
      else
        setAccount({
          credits: null,
          detail:
            accountResult.reason instanceof Error
              ? accountResult.reason.message
              : "Credit balance unavailable.",
        });
      if (statusResult.status === "fulfilled") setStatus(statusResult.value);
    } finally {
      if (mounted.current) setBusy("");
    }
  };
  const enable = async (enabled: boolean) => {
    setBusy("settings");
    const result = await perform<KlingStatus>(
      "POST",
      "/api/kling/settings",
      { enabled },
      enabled
        ? "Kling generation enabled. Every video still requires approval."
        : "Kling generation disabled.",
    );
    if (mounted.current) {
      if (result) setStatus((current) => ({ ...current!, ...result, enabled }));
      setBusy("");
    }
  };
  const prepare = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!selected) return;
    let parameters: Record<string, unknown>;
    try {
      parameters = parseParameters(selected, inputs);
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Check the video options.",
      );
      return;
    }
    setBusy("prepare");
    setError("");
    const result = await perform<{ job: KlingJob; approval: { id: string } }>(
      "POST",
      "/api/kling/prepare",
      {
        prompt: prompt.trim(),
        model: selected.id,
        parameters,
        ...(projectId ? { projectId } : {}),
      },
    );
    if (!mounted.current) return;
    setBusy("");
    if (result) {
      setJobs((current) => [
        ...current.filter((item) => item.id !== result.job.id),
        result.job,
      ]);
      notify(
        "Video request prepared. Review the exact request and credit warning in Activity & approvals.",
      );
    }
  };
  const poll = async (id: string) => {
    setBusy(id);
    const result = await perform<KlingJob>(
      "POST",
      `/api/kling/jobs/${id}/poll`,
    );
    if (!mounted.current) return;
    if (result) {
      const updated = await api<{ jobs: KlingJob[] }>(
        "GET",
        "/api/kling/jobs",
      ).catch(() => undefined);
      if (updated && mounted.current) setJobs(updated.jobs);
      notify("Video status checked. No new generation was submitted.");
    }
    if (mounted.current) setBusy("");
  };
  const configureMcp = async () => {
    setBusy("mcp");
    const result = await perform<{ config: unknown; detail: string }>(
      "POST",
      "/api/kling/mcp-config",
    );
    if (mounted.current) {
      if (result) {
        setMcp(result);
        setStatus((current) =>
          current ? { ...current, mcpConfigured: true } : current,
        );
      }
      setBusy("");
    }
  };
  const revokeMcp = async () => {
    setBusy("revoke");
    const result = await perform(
      "DELETE",
      "/api/kling/mcp-config",
      undefined,
      "Kling MCP access revoked. Previously copied configuration no longer connects.",
    );
    if (mounted.current) {
      if (result) {
        setMcp(undefined);
        setStatus((current) =>
          current ? { ...current, mcpConfigured: false } : current,
        );
      }
      setBusy("");
    }
  };
  const copy = async (text: string, success: string) => {
    try {
      await copyText(text);
      notify(success);
    } catch {
      notify("Could not copy. Select and copy the text manually.", true);
    }
  };

  return (
    <section className="panel media-studio" aria-label="Kling video studio">
      <SectionTitle
        eyebrow="YOUR VIDEO STUDIO"
        title="Bring your ideas to life with Kling"
        description="Turn a written prompt into a video, here or through Nakama’s Kling MCP."
        action={
          <Button kind="secondary" onClick={() => setSetup(true)}>
            <Link2 size={15} />
            Kling setup
          </Button>
        }
      />
      <div className="media-studio-intro">
        <span>
          <ShieldCheck size={18} />
          <strong>You decide when credits are used.</strong>
        </span>
        <p>
          Kling uses separate credits. Generation is disabled by default. Every
          video needs a fresh approval. This integration cannot quote the exact
          cost; review your Kling plan and credits before enabling it.
        </p>
      </div>
      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
      {previewMode && (
        <div className="inline-note">
          <Info size={16} />
          <span>
            Open the Windows app to connect Kling. Browser preview cannot create
            videos or configure MCP access.
          </span>
        </div>
      )}
      <div className="media-studio-grid">
        <form onSubmit={(event) => void prepare(event)}>
          <div className="kling-form-heading">
            <h3>Your next video</h3>
            <Button
              type="button"
              kind="secondary"
              disabled={previewMode || !!busy}
              busy={busy === "refresh"}
              onClick={() => void refresh()}
            >
              <RefreshCw size={15} />
              Refresh Kling
            </Button>
          </div>
          <p className="small-copy">
            Refresh reads available models and credits from your Kling account.
            It does not generate a video or buy credits.
          </p>
          <div className="two-column">
            <label className="field">
              Model
              <select
                aria-label="Kling model"
                value={selected?.id || ""}
                disabled={!catalogue?.models.length || !!busy}
                onChange={(event) => {
                  setModelId(event.target.value);
                  setInputs({});
                }}
              >
                {!catalogue?.models.length && (
                  <option value="">Sign in, then refresh Kling</option>
                )}
                {catalogue?.models.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
              <small>
                {catalogue?.detail ||
                  "Choices come from your account’s current catalogue."}
              </small>
            </label>
            <label className="field">
              Related project · optional
              <select
                aria-label="Related project"
                value={projectId}
                disabled={!!busy}
                onChange={(event) => setProjectId(event.target.value)}
              >
                <option value="">Personal video</option>
                {state.projects.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
              <small>
                Associates this request with a project. Results are links, not
                automatic file downloads.
              </small>
            </label>
          </div>
          <label className="field">
            Describe your video
            <textarea
              required
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              rows={4}
              maxLength={4000}
              disabled={!!busy}
              placeholder="A slow camera move through a peaceful futuristic studio…"
            />
          </label>
          {!!fields.length && (
            <details className="kling-options" open>
              <summary>Video options from your selected model</summary>
              <div className="two-column">
                {fields.map(([key, schema]) => {
                  const value = inputs[key] || "";
                  const required = selected?.parameters.required?.includes(key);
                  const change = (next: string) =>
                    setInputs((current) => ({ ...current, [key]: next }));
                  return (
                    <label className="field" key={key}>
                      {schema.title || key}
                      {required ? " · required" : ""}
                      {schema.enum ? (
                        <select
                          value={value}
                          required={required}
                          onChange={(event) => change(event.target.value)}
                        >
                          <option value="">
                            {required
                              ? "Choose an option"
                              : "Use model default"}
                          </option>
                          {schema.enum.map((option) => (
                            <option key={String(option)} value={String(option)}>
                              {String(option)}
                            </option>
                          ))}
                        </select>
                      ) : schema.type === "boolean" ? (
                        <select
                          value={value}
                          required={required}
                          onChange={(event) => change(event.target.value)}
                        >
                          <option value="">Use model default</option>
                          <option value="true">Yes</option>
                          <option value="false">No</option>
                        </select>
                      ) : schema.type === "object" ||
                        schema.type === "array" ? (
                        <textarea
                          value={value}
                          required={required}
                          rows={3}
                          onChange={(event) => change(event.target.value)}
                          placeholder={`Enter ${schema.type} as JSON`}
                        />
                      ) : (
                        <input
                          value={value}
                          required={required}
                          type={
                            schema.type === "number" ||
                            schema.type === "integer"
                              ? "number"
                              : "text"
                          }
                          min={schema.minimum}
                          max={schema.maximum}
                          step={schema.type === "integer" ? "1" : "any"}
                          onChange={(event) => change(event.target.value)}
                          placeholder={
                            schema.default === undefined
                              ? "Use model default"
                              : `Default: ${String(schema.default)}`
                          }
                        />
                      )}
                      {schema.description && (
                        <small>{schema.description}</small>
                      )}
                    </label>
                  );
                })}
              </div>
            </details>
          )}
          <Button
            type="submit"
            disabled={
              !!busy ||
              previewMode ||
              !status?.enabled ||
              !selected ||
              !prompt.trim()
            }
            busy={busy === "prepare"}
          >
            <Clapperboard size={16} />
            Prepare video for approval
            <ArrowRight size={15} />
          </Button>
          <p className="small-copy">
            Preparing a request does not start generation. Your prompt is sent
            to Kling only after approval. Image-to-video is not supported in
            this preview.
          </p>
        </form>
        <aside className="media-cost-card">
          <span className="eyebrow">YOUR KLING CONNECTION</span>
          <h3>Creative control stays with you</h3>
          <Status
            value={status?.installed ? "ready" : "not_configured"}
            label={status?.installed ? "CLI runtime ready" : "Setup needed"}
          />
          <p className="small-copy">
            {status?.detail || "Checking this PC’s Kling setup…"}
          </p>
          <div className="media-price">
            <strong>
              {account?.credits == null
                ? "—"
                : new Intl.NumberFormat("en-GB", {
                    maximumFractionDigits: 2,
                  }).format(account.credits)}
            </strong>
            <span>
              {account?.credits == null
                ? "Credit balance unavailable"
                : "credits reported by Kling"}
            </span>
          </div>
          <p className="small-copy">
            {account?.detail ||
              "Refresh Kling after signing in to read your available credits."}
          </p>
          <Toggle
            checked={status?.enabled === true}
            disabled={previewMode || !status || !!busy}
            onChange={(value) => void enable(value)}
            label="Allow Kling video generation"
            description="Uses your separate Kling credits only after you approve a video request. This does not purchase credits."
          />
          <div className="connection-facts">
            <div>
              <span>Exact generation cost</span>
              <strong>Not supplied</strong>
            </div>
            <div>
              <span>Approval</span>
              <strong>Always required</strong>
            </div>
          </div>
          <TextLink onClick={() => navigate("activity")}>
            Open Activity & approvals
          </TextLink>
          <div className="settings-divider" />
          <h4>Connect an AI client with MCP</h4>
          <p className="small-copy">
            An MCP client can discover models, prepare requests and check
            results. Only you can approve generation in Control Center. Keep
            this PC app running.
          </p>
          <Button
            kind="secondary"
            disabled={previewMode || !!busy}
            busy={busy === "mcp"}
            onClick={() => void configureMcp()}
          >
            <Link2 size={15} />
            {status?.mcpConfigured
              ? "Replace MCP configuration"
              : "Create MCP configuration"}
          </Button>
          {status?.mcpConfigured && (
            <>
              <p className="small-copy">
                Replacing configuration disconnects clients using the previous
                credential.
              </p>
              <Button
                kind="ghost"
                disabled={!!busy}
                onClick={() => void revokeMcp()}
              >
                Revoke MCP access
              </Button>
            </>
          )}
        </aside>
      </div>
      <div className="settings-divider" />
      <SectionTitle
        title="Your videos"
        description="Prepared requests, generation progress and results. Failed or uncertain submissions are never automatically retried."
      />
      {jobs.length ? (
        <div className="media-jobs">
          {[...jobs]
            .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
            .slice(0, 12)
            .map((job) => (
              <article className="media-job" key={job.id}>
                <div className="media-job-heading">
                  <span className="media-job-icon">
                    <Clapperboard size={22} />
                  </span>
                  <div>
                    <h3>
                      {catalogue?.models.find(
                        (item) => item.id === job.request.model,
                      )?.name || job.request.model}
                    </h3>
                    <p>
                      {relativeDate(job.createdAt)} ·{" "}
                      {state.projects.find(
                        (item) => item.id === job.request.projectId,
                      )?.name || "Personal video"}
                    </p>
                  </div>
                  <Status value={job.status} />
                </div>
                <p className="media-job-prompt">{job.request.prompt}</p>
                {job.error && <p className="inline-error">{job.error}</p>}
                {job.generationId && (
                  <p className="small-copy">
                    Generation reference: {job.generationId}
                  </p>
                )}
                {!!job.results?.length && (
                  <div className="kling-results">
                    {job.results.map((result) => (
                      <TextLink
                        key={result.index}
                        external
                        onClick={() =>
                          void openExternal(result.url).catch(() =>
                            notify("Could not open this result link.", true),
                          )
                        }
                      >
                        Open result {result.index + 1} ·{" "}
                        {result.contentType || "video"}
                      </TextLink>
                    ))}
                    <small>
                      Result links can expire after 24 hours. Save wanted videos
                      through your browser.
                    </small>
                  </div>
                )}
                <div className="media-job-actions">
                  {["awaiting_approval", "prepared", "pending"].includes(
                    job.status,
                  ) && (
                    <Button
                      kind="secondary"
                      onClick={() => navigate("activity")}
                    >
                      Review approval
                      <ArrowRight size={14} />
                    </Button>
                  )}
                  {job.generationId && (
                    <Button
                      kind="secondary"
                      disabled={!!busy}
                      busy={busy === job.id}
                      onClick={() => void poll(job.id)}
                    >
                      <RefreshCw size={14} />
                      Check video status
                    </Button>
                  )}
                </div>
              </article>
            ))}
        </div>
      ) : (
        <Empty
          icon={<Clapperboard size={27} />}
          title="A space for your next idea"
        >
          Prepare a video here or from your MCP client. It appears here for
          review before any credits can be used.
        </Empty>
      )}
      {setup && (
        <Modal
          title="Connect your Kling account"
          description="Use the official Kling CLI on this Windows account. Your sign-in stays with the CLI."
          onClose={() => setSetup(false)}
        >
          <ol className="kling-setup">
            <li>Install Node.js if this PC does not already have it.</li>
            <li>
              Open PowerShell and run the command below. npm may download and
              execute the pinned official Kling CLI.
            </li>
          </ol>
          <pre className="kling-code">{loginCommand}</pre>
          <Button
            kind="secondary"
            onClick={() =>
              void copy(loginCommand, "Kling login command copied.")
            }
          >
            <Copy size={15} />
            Copy login command
          </Button>
          <p className="small-copy">
            Complete the CLI’s sign-in instructions, then return here and choose
            Refresh Kling. Never paste credentials into Nakama chat.
          </p>
          <div className="inline-note">
            <Info size={18} />
            <span>
              ChatGPT and Claude subscriptions do not include Kling credits.
              Check your Kling account before enabling generation. No video is
              generated by signing in or refreshing.
            </span>
          </div>
          <div className="modal-actions">
            <Button onClick={() => setSetup(false)}>Done</Button>
          </div>
        </Modal>
      )}
      {mcp && (
        <Modal
          title="Your Kling MCP configuration"
          description="Add this server configuration to a compatible local MCP client. It contains a private access credential; share it only with a client you trust."
          onClose={() => setMcp(undefined)}
        >
          <p className="small-copy">{mcp.detail}</p>
          <textarea
            className="kling-config"
            aria-label="MCP configuration"
            readOnly
            value={JSON.stringify(mcp.config, null, 2)}
            rows={12}
            spellCheck={false}
          />
          <div className="modal-actions">
            <Button kind="secondary" onClick={() => setMcp(undefined)}>
              Done
            </Button>
            <Button
              onClick={() =>
                void copy(
                  JSON.stringify(mcp.config, null, 2),
                  "MCP configuration copied. Treat it as a private credential.",
                )
              }
            >
              <Copy size={15} />
              Copy MCP configuration
            </Button>
          </div>
        </Modal>
      )}
    </section>
  );
}
