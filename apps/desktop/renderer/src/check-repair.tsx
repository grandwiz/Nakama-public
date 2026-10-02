import { useEffect, useRef, useState } from "react";
import {
  ArrowUpRight,
  CircleAlert,
  RefreshCw,
  ShieldCheck,
  Square,
  Wrench,
} from "lucide-react";
import { api, previewMode } from "./bridge";
import {
  Button,
  Modal,
  SectionTitle,
  Status,
  relativeDate,
} from "./components";
import { useNakama } from "./context";
import {
  activeProjectRepair,
  eligibleRepairSource,
  repairRequest,
  repairResult,
} from "./check-repair-model";
import { effortChoices, normalizedEffort } from "./provider-options";
import type { CheckRepair, Project } from "./types";

export function CheckRepairDialog({
  project,
  sourceTaskId,
  hasUnsavedChanges,
  onClose,
  onUncertain,
}: {
  project: Project;
  sourceTaskId: string;
  hasUnsavedChanges: boolean;
  onClose: () => void;
  onUncertain: () => void;
}) {
  const { state, refresh } = useNakama();
  const [providerId, setProviderId] = useState("");
  const [model, setModel] = useState("");
  const [effort, setEffort] = useState("high");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [uncertain, setUncertain] = useState(false);
  const [accepted, setAccepted] = useState<CheckRepair>();
  const submitting = useRef(false);
  const attempted = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const provider = state.providers.find((item) => item.id === providerId);
  const source = state.tasks.find((item) => item.id === sourceTaskId);
  const available = state.projects.some((item) => item.id === project.id);
  const eligible = available && eligibleRepairSource(project, source);
  const active = activeProjectRepair(state.checkRepairs, project.id);
  const choices = effortChoices(provider, model);
  useEffect(() => {
    setEffort((current) =>
      choices.some((item) => item.value === current)
        ? current
        : choices.find((item) => item.value === "high")?.value ||
          choices[0]?.value ||
          "high",
    );
  }, [provider?.id, provider?.modelDetails, model]);
  const selectProvider = (id: string) => {
    const selected = state.providers.find((item) => item.id === id);
    setProviderId(id);
    setModel(selected?.selectedModel || "");
    setEffort(normalizedEffort(selected));
  };
  const start = async (event: React.FormEvent) => {
    event.preventDefault();
    if (
      submitting.current ||
      attempted.current ||
      uncertain ||
      previewMode ||
      !eligible ||
      !source ||
      hasUnsavedChanges ||
      active ||
      !provider ||
      provider.connectionType !== "subscription"
    )
      return;
    submitting.current = true;
    attempted.current = true;
    setBusy(true);
    setError("");
    try {
      const body = repairRequest(source, provider, model, effort);
      const result = await api<CheckRepair>(
        "POST",
        `/api/projects/${encodeURIComponent(project.id)}/check-repairs`,
        body,
      );
      if (
        !result.id ||
        result.projectId !== project.id ||
        result.sourceTaskId !== sourceTaskId
      )
        throw new Error(
          "The host response could not be matched to this project and check.",
        );
      if (mounted.current) setAccepted(result);
      await refresh();
    } catch (reason) {
      if (mounted.current) {
        setError(
          reason instanceof Error
            ? reason.message
            : "Could not confirm this repair request.",
        );
        // A disconnected response cannot prove that the host did not start.
        setUncertain(true);
        onUncertain();
      }
    } finally {
      submitting.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  const record =
    accepted &&
    (state.checkRepairs?.find(
      (item) => item.id === accepted.id && item.projectId === project.id,
    ) ||
      accepted);
  return (
    <Modal
      title="Repair this failed check"
      description={`${project.name} · npm run ${source?.checkName || accepted?.checkName || "check"}`}
      onClose={() => {
        if (!submitting.current) onClose();
      }}
      wide
    >
      {record ? (
        <>
          <p className="repair-receipt">
            Control Center accepted this repair request. Follow its recorded
            progress below. File changes do not prove the check passes.
          </p>
          <RepairCard repair={record} />
          <div className="modal-actions">
            <Button onClick={onClose}>Close and follow project activity</Button>
          </div>
        </>
      ) : (
        <form onSubmit={(event) => void start(event)}>
          <div className="repair-source">
            <CircleAlert size={20} />
            <div>
              <strong>{source?.title || "Original failed check"}</strong>
              <span>
                Recorded exit code: {source?.exitCode ?? "unavailable"}
              </span>
            </div>
            <Status value="failed" />
          </div>
          <p className="repair-explanation">
            Run one file-repair attempt using the AI you choose. It uses the
            recorded failure and this project's current files, which may have
            changed since the check ran. The original result stays in your
            history.
          </p>
          <div className="two-column">
            <label className="field">
              Repair AI
              <select
                autoFocus
                required
                aria-label="Repair AI"
                value={providerId}
                onChange={(event) => selectProvider(event.target.value)}
                disabled={busy || uncertain}
              >
                <option value="">Choose an AI</option>
                {state.providers.map((item) => (
                  <option
                    key={item.id}
                    value={item.id}
                    disabled={item.connectionType !== "subscription"}
                  >
                    {item.name}
                    {item.connectionType !== "subscription"
                      ? " · subscription connection required"
                      : ""}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              Repair model
              <input
                aria-label="Repair model"
                value={model}
                maxLength={160}
                list="repair-models"
                disabled={busy || uncertain || !provider}
                onChange={(event) => setModel(event.target.value)}
                placeholder="Use the connection's saved model"
              />
              <small>
                Exact model ID. Blank uses this AI's saved model, or its
                provider default when none is saved.
              </small>
              <datalist id="repair-models">
                {provider?.models.map((item) => (
                  <option
                    key={typeof item === "string" ? item : item.id}
                    value={typeof item === "string" ? item : item.id}
                  />
                ))}
              </datalist>
            </label>
          </div>
          <label className="field">
            Thinking effort
            <select
              aria-label="Repair thinking effort"
              value={effort}
              disabled={busy || uncertain || !provider}
              onChange={(event) => setEffort(event.target.value)}
            >
              {choices.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
          {provider && (
            <p className="repair-provider-note">
              {provider.detail ||
                "The host verifies the subscription sign-in before work begins."}{" "}
              This request uses your chosen connection; it does not switch to a
              billed API.
            </p>
          )}
          <div className="inline-note">
            <ShieldCheck size={19} />
            <span>
              The AI may save files inside this project. Nakama then prepares a
              fresh desktop approval for the same check. No check, install,
              deployment or deletion is automatically approved. Other project
              writes wait while this repair is active.
            </span>
          </div>
          {hasUnsavedChanges && (
            <p className="inline-error">
              Save your editor changes before starting a repair.
            </p>
          )}
          {!eligible && (
            <p className="inline-error">
              This project or eligible failed check is no longer available.
              Close this dialog and refresh project activity.
            </p>
          )}
          {active && (
            <p className="inline-error">
              A repair is already active in this project. Follow it in Check
              repairs before starting another.
            </p>
          )}
          {error && (
            <p className="inline-error" role="alert">
              {error}
            </p>
          )}
          {uncertain && (
            <div className="inline-note">
              <CircleAlert size={18} />
              <span>
                The request may have reached your PC. Close this dialog and
                refresh Check repairs before trying again. No request is retried
                automatically.
              </span>
            </div>
          )}
          <div className="modal-actions">
            <Button
              type="button"
              kind="secondary"
              disabled={busy}
              onClick={onClose}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              busy={busy}
              disabled={
                previewMode ||
                uncertain ||
                !eligible ||
                hasUnsavedChanges ||
                Boolean(active) ||
                !provider ||
                provider.connectionType !== "subscription"
              }
            >
              <Wrench size={16} />
              Start one repair
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
}

export function ProjectRepairs({
  project,
  uncertain,
  onClearReminder,
}: {
  project: Project;
  uncertain: boolean;
  onClearReminder: () => void;
}) {
  const { state, refresh } = useNakama();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const records = (state.checkRepairs || [])
    .filter((repair) => repair.projectId === project.id)
    .slice()
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 10);
  if (!records.length && !uncertain) return null;
  return (
    <section className="panel repair-panel" aria-label="Check repairs">
      <SectionTitle
        title="Check repairs"
        description="One file-repair attempt, then an approved check. Each recorded result belongs to this project."
        action={
          <Button
            kind="secondary"
            busy={busy}
            onClick={() => {
              setBusy(true);
              setError("");
              void refresh()
                .catch((reason: unknown) =>
                  setError(
                    reason instanceof Error
                      ? reason.message
                      : "Could not refresh repairs.",
                  ),
                )
                .finally(() => setBusy(false));
            }}
          >
            <RefreshCw size={14} />
            Refresh repairs
          </Button>
        }
      />
      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
      {uncertain && (
        <div className="repair-uncertain">
          <CircleAlert size={18} />
          <div>
            <strong>A request could not be confirmed</strong>
            <p>
              Check the repairs below and Activity & approvals before starting
              another. Clearing this reminder does not cancel work.
            </p>
            <Button
              kind="ghost"
              onClick={() => {
                if (
                  window.confirm(
                    "Only clear this reminder after checking existing repairs and desktop approvals. This does not stop or cancel any repair.",
                  )
                )
                  onClearReminder();
              }}
            >
              I checked repair activity
            </Button>
          </div>
        </div>
      )}
      <div className="repair-list">
        {records.map((repair) => (
          <RepairCard key={repair.id} repair={repair} />
        ))}
      </div>
    </section>
  );
}

function RepairCard({ repair }: { repair: CheckRepair }) {
  const { state, refresh, openApproval } = useNakama();
  const [stopping, setStopping] = useState(false);
  const [error, setError] = useState("");
  const stopLatch = useRef(false);
  const presentation = repairResult(repair, state.tasks);
  const build = state.tasks.find(
    (task) =>
      task.id === repair.buildTaskId && task.projectId === repair.projectId,
  );
  const approval = state.approvals.find(
    (item) => item.id === repair.approvalId && item.type === "project_check",
  );
  const stop = async () => {
    if (stopLatch.current || !presentation.active) return;
    stopLatch.current = true;
    setStopping(true);
    setError("");
    try {
      await api(
        "POST",
        `/api/check-repairs/${encodeURIComponent(repair.id)}/stop`,
        {},
      );
      await refresh();
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Could not confirm Stop. Refresh repair activity.",
      );
    } finally {
      stopLatch.current = false;
      setStopping(false);
    }
  };
  return (
    <article
      className="repair-card"
      aria-label={`Repair npm run ${repair.checkName}`}
    >
      <div className="repair-card-heading">
        <span className="repair-icon">
          <Wrench size={19} />
        </span>
        <div>
          <h3>{presentation.title}</h3>
          <small>
            npm run {repair.checkName} · {relativeDate(repair.createdAt)}
          </small>
        </div>
        <Status value={presentation.tone} />
        {presentation.active && (
          <Button kind="ghost" busy={stopping} onClick={() => void stop()}>
            <Square size={13} />
            Stop repair
          </Button>
        )}
      </div>
      <p>{repair.detail.slice(0, 4000)}</p>
      <div className="repair-metadata">
        <span>
          {state.providers.find((provider) => provider.id === repair.providerId)
            ?.name || repair.providerId}
        </span>
        <span>{repair.model || "Provider default"}</span>
        <span>Effort: {repair.effort || "Provider default"}</span>
        <span>
          Attempt {repair.attempts} of {repair.maxAttempts}
        </span>
      </div>
      <ol className="repair-stages" aria-label="Repair stages">
        <li>Prepare</li>
        <li>Repair files{build && <small>{build.status}</small>}</li>
        <li>Desktop approval{approval && <small>{approval.status}</small>}</li>
        <li>
          Run check
          {presentation.check && <small>{presentation.check.status}</small>}
        </li>
      </ol>
      {build && (
        <details className="repair-output">
          <summary>File-repair task · {build.status}</summary>
          {build.error && (
            <p className="inline-error">{build.error.slice(0, 4000)}</p>
          )}
          <pre className="task-output">
            {build.output?.slice(-6000) || "No output recorded yet."}
          </pre>
          <p className="small-copy">
            Saved files and the check result are separate outcomes. Output is a
            bounded excerpt.
          </p>
        </details>
      )}
      {repair.approvalId && (
        <div className="repair-approval">
          <ShieldCheck size={17} />
          <div>
            <strong>
              {approval?.status === "pending"
                ? "Your approval is needed before the rerun"
                : "Rerun approval"}
            </strong>
            <small>Approval reference: {repair.approvalId}</small>
          </div>
          <Button
            kind="secondary"
            onClick={() => openApproval(repair.approvalId!)}
          >
            Review this approval
            <ArrowUpRight size={14} />
          </Button>
        </div>
      )}
      {presentation.check && (
        <details className="repair-output">
          <summary>
            New check result · {presentation.check.status}
            {presentation.check.exitCode != null
              ? ` · exit ${presentation.check.exitCode}`
              : " · no exit code recorded"}
          </summary>
          {presentation.check.error && (
            <p className="inline-error">
              {presentation.check.error.slice(0, 4000)}
            </p>
          )}
          <pre className="task-output">
            {presentation.check.output?.slice(-8000) || "No output recorded."}
          </pre>
        </details>
      )}
      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
      <p className="repair-footnote">
        Stop prevents later work where possible. Files already saved or commands
        already started are not undone. A failed rerun needs your review; Nakama
        does not retry it automatically.
      </p>
    </article>
  );
}
