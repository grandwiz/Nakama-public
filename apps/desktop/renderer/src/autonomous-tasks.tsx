import { useCallback, useEffect, useRef, useState } from "react";
import { Play, RefreshCw, Send, Square } from "lucide-react";
import { Button, Status } from "./components";
import { api } from "./bridge";
import { useNakama } from "./context";

export interface AutonomousRun {
  id: string;
  goal: string;
  projectId?: string;
  status: string;
  stage?: string;
  revision: number;
  step?: number;
  maxSteps?: number;
  summary?: string;
  detail?: string;
  error?: string;
  approvalId?: string;
  questions?: { id: string; question: string; answer?: string }[];
  receipts?: {
    id?: string;
    tool?: string;
    status?: string;
    summary?: string;
    approvalId?: string;
    verification?: { verified: boolean; summary?: string };
  }[];
}
interface TaskSnapshot {
  runs: AutonomousRun[];
  detail?: string;
  available?: boolean;
  capabilities?: {
    detail?: string;
    limits?: string;
    available?: boolean;
    tools?: {
      name: string;
      tool?: string;
      description?: string;
      detail?: string;
    }[];
  };
}
const activeStatuses = new Set([
  "running",
  "queued",
  "awaiting_answers",
  "awaiting_approval",
  "awaiting_result",
]);

export function AutonomousTasksPanel({
  onDirty,
}: {
  onDirty: (dirty: boolean) => void;
}) {
  const { state, setNavigationGuard } = useNakama();
  const [snapshot, setSnapshot] = useState<TaskSnapshot>();
  const [goal, setGoal] = useState("");
  const [projectId, setProjectId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [loadError, setLoadError] = useState("");
  const mounted = useRef(false);
  const sequence = useRef(0);
  const mutation = useRef(false);
  const dirtyCards = useRef(new Set<string>());
  const goalDraft = useRef("");
  goalDraft.current = goal;
  const updateDirty = useCallback(
    (id: string, dirty: boolean) => {
      if (dirty) dirtyCards.current.add(id);
      else dirtyCards.current.delete(id);
      onDirty(Boolean(goalDraft.current.trim() || dirtyCards.current.size));
    },
    [onDirty],
  );
  useEffect(() => {
    onDirty(Boolean(goal.trim() || dirtyCards.current.size));
  }, [goal, onDirty]);
  const load = useCallback(async () => {
    if (mutation.current) return;
    const token = ++sequence.current;
    try {
      const next = await api<TaskSnapshot>("GET", "/api/autonomous-tasks");
      if (mounted.current && token === sequence.current) {
        setSnapshot(next);
        setLoadError("");
      }
    } catch (failure) {
      if (mounted.current && token === sequence.current)
        setLoadError(
          failure instanceof Error
            ? failure.message
            : "Task progress could not be loaded.",
        );
    }
  }, []);
  useEffect(() => {
    mounted.current = true;
    void load();
    const interval = setInterval(() => void load(), 6000);
    const dirty = () =>
      Boolean(goalDraft.current.trim() || dirtyCards.current.size);
    setNavigationGuard(
      () =>
        !dirty() ||
        window.confirm("Leave without saving these autonomous task drafts?"),
    );
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (dirty()) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => {
      mounted.current = false;
      sequence.current++;
      clearInterval(interval);
      window.removeEventListener("beforeunload", beforeUnload);
      setNavigationGuard(null);
      onDirty(false);
    };
  }, [load, onDirty, setNavigationGuard]);
  const request = useCallback(
    async (route: string, body: unknown) => {
      if (mutation.current) return false;
      mutation.current = true;
      sequence.current++;
      setBusy(true);
      setError("");
      try {
        await api("POST", route, body);
        if (!mounted.current) return false;
        mutation.current = false;
        await load();
        return mounted.current;
      } catch (failure) {
        if (mounted.current)
          setError(
            failure instanceof Error
              ? failure.message
              : "The task request did not complete.",
          );
        return false;
      } finally {
        mutation.current = false;
        if (mounted.current) setBusy(false);
      }
    },
    [load],
  );
  return (
    <section className="project-setup" aria-label="Autonomous tasks">
      <div className="panel">
        <h2>Give Nakama a task</h2>
        <p>
          Nakama works through a goal with saved steps, asks when information is
          missing, and keeps a record of its actions.
        </p>
        <p className="small-copy">
          {snapshot?.capabilities?.limits ||
            snapshot?.capabilities?.detail ||
            snapshot?.detail ||
            "Uses the connected, supported tools and their existing permissions. Protected actions still need their exact PC approval. Private browser content is never shared with agents."}
        </p>
        {!!snapshot?.capabilities?.tools?.length && (
          <details>
            <summary>Available task tools</summary>
            <ul>
              {snapshot.capabilities.tools.map((tool) => (
                <li key={tool.tool || tool.name}>
                  <strong>{tool.name.replaceAll("_", " ")}</strong>
                  {tool.detail || tool.description
                    ? `: ${tool.detail || tool.description}`
                    : ""}
                </li>
              ))}
            </ul>
          </details>
        )}
        <form
          onSubmit={async (event) => {
            event.preventDefault();
            if (!goal.trim() || busy) return;
            if (
              await request("/api/autonomous-tasks", {
                goal: goal.trim(),
                ...(projectId ? { projectId } : {}),
              })
            )
              setGoal("");
          }}
        >
          <label className="field">
            Task goal
            <textarea
              rows={4}
              maxLength={12000}
              value={goal}
              disabled={busy}
              onChange={(event) => setGoal(event.target.value)}
              placeholder="Describe the result you want and any constraints…"
            />
          </label>
          <label className="field">
            Project context
            <select
              value={projectId}
              disabled={busy}
              onChange={(event) => setProjectId(event.target.value)}
            >
              <option value="">No project</option>
              {state.projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
          </label>
          <div className="button-row">
            <Button
              type="submit"
              busy={busy}
              disabled={
                !goal.trim() ||
                !snapshot ||
                snapshot.available === false ||
                snapshot.capabilities?.available === false ||
                Boolean(
                  projectId &&
                  !state.projects.some((project) => project.id === projectId),
                )
              }
            >
              <Play size={16} /> Start autonomous task
            </Button>
            <Button
              kind="secondary"
              disabled={busy}
              onClick={() => void load()}
            >
              <RefreshCw size={15} /> Refresh task progress
            </Button>
          </div>
        </form>
        {(error || loadError) && (
          <p className="inline-error" role="alert">
            {error || loadError}
          </p>
        )}
        {!snapshot && !error && !loadError && (
          <p role="status">Loading saved tasks…</p>
        )}
      </div>
      {snapshot?.runs
        ?.slice()
        .reverse()
        .map((run) => (
          <AutonomousRunCard
            key={run.id}
            run={run}
            busy={busy}
            request={request}
            onDirty={updateDirty}
          />
        ))}
      {snapshot?.runs?.length === 0 && (
        <p className="small-copy">No autonomous tasks yet.</p>
      )}
    </section>
  );
}

function AutonomousRunCard({
  run,
  busy,
  request,
  onDirty,
}: {
  run: AutonomousRun;
  busy: boolean;
  request: (route: string, body: unknown) => Promise<boolean>;
  onDirty: (id: string, dirty: boolean) => void;
}) {
  const { openApproval } = useNakama();
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [revision, setRevision] = useState(run.revision);
  const dirty = Object.values(answers).some((value) => value.trim());
  useEffect(() => {
    onDirty(run.id, dirty);
    return () => onDirty(run.id, false);
  }, [run.id, dirty, onDirty]);
  useEffect(() => {
    if (!dirty) setRevision(run.revision);
  }, [run.revision, dirty]);
  const questions = (run.questions || []).filter(
    (question) => !question.answer,
  );
  const stale = dirty && revision !== run.revision;
  const route = `/api/autonomous-tasks/${encodeURIComponent(run.id)}`;
  return (
    <article
      className="panel setup-card"
      aria-label={`Autonomous task: ${run.goal}`}
    >
      <header>
        <h3>{run.goal}</h3>
        <Status value={run.status} />
      </header>
      <p className="small-copy">
        Step {run.step || 0}
        {run.maxSteps ? ` of ${run.maxSteps}` : ""}
        {run.stage && activeStatuses.has(run.status)
          ? ` · ${run.stage.replaceAll("_", " ")}`
          : ""}
        . Progress is saved on your PC. Restarted work requires explicit resume.
      </p>
      {run.summary && <p>{run.summary}</p>}
      {run.detail && (
        <p className="small-copy" role="status">
          {run.detail}
        </p>
      )}
      {run.error && <p className="inline-error">{run.error}</p>}
      {run.status === "awaiting_answers" && (
        <form
          onSubmit={async (event) => {
            event.preventDefault();
            if (
              busy ||
              stale ||
              questions.some((question) => !answers[question.id]?.trim())
            )
              return;
            if (
              await request(`${route}/answers`, {
                revision,
                answers: questions.map((question) => ({
                  id: question.id,
                  answer: answers[question.id].trim(),
                })),
              })
            )
              setAnswers({});
          }}
        >
          <p>
            Your manager needs these answers before continuing. Answers do not
            grant permission for protected actions.
          </p>
          {questions.map((question) => (
            <label className="field" key={question.id}>
              {question.question}
              <textarea
                rows={2}
                maxLength={6000}
                value={answers[question.id] || ""}
                disabled={busy}
                onChange={(event) =>
                  setAnswers((current) => ({
                    ...current,
                    [question.id]: event.target.value,
                  }))
                }
              />
            </label>
          ))}
          {stale && (
            <p role="alert">
              This task changed elsewhere. Your draft is preserved. Copy it
              before reloading the saved questions.
            </p>
          )}
          <div className="button-row">
            <Button
              type="submit"
              disabled={
                busy ||
                stale ||
                !questions.length ||
                questions.some((question) => !answers[question.id]?.trim())
              }
            >
              <Send size={15} /> Send task answers
            </Button>
            {dirty && (
              <Button
                kind="secondary"
                disabled={busy}
                onClick={() => {
                  if (window.confirm("Discard these unsent task answers?")) {
                    setAnswers({});
                    setRevision(run.revision);
                  }
                }}
              >
                Reload saved questions
              </Button>
            )}
          </div>
        </form>
      )}
      <div className="button-row">
        {run.approvalId && (
          <Button
            kind="secondary"
            onClick={() => openApproval(run.approvalId!)}
          >
            Review task approval on this PC
          </Button>
        )}
        {activeStatuses.has(run.status) && (
          <Button
            kind="secondary"
            disabled={busy}
            onClick={() => void request(`${route}/stop`, {})}
          >
            <Square size={14} /> Stop autonomous task
          </Button>
        )}
        {["interrupted", "needs_attention", "review_required"].includes(
          run.status,
        ) && (
          <Button
            disabled={busy}
            onClick={() =>
              void request(`${route}/resume`, { revision: run.revision })
            }
          >
            <Play size={14} /> Resume task
          </Button>
        )}
      </div>
      {!!run.receipts?.length && (
        <details>
          <summary>Recorded task actions ({run.receipts.length})</summary>
          {run.receipts.map((receipt, index) => (
            <div className="workflow-review" key={receipt.id || index}>
              <strong>
                {receipt.tool || "Action"}
                {receipt.status
                  ? ` · ${receipt.status.replaceAll("_", " ")}`
                  : ""}
              </strong>
              {receipt.summary && <p>{receipt.summary}</p>}
              {receipt.verification && (
                <p className="small-copy">
                  {receipt.verification.verified
                    ? "Observation checked"
                    : "Verification unresolved"}
                  {receipt.verification.summary
                    ? `: ${receipt.verification.summary}`
                    : ""}
                </p>
              )}
              {receipt.approvalId && (
                <Button
                  kind="ghost"
                  onClick={() => openApproval(receipt.approvalId!)}
                >
                  View action approval
                </Button>
              )}
            </div>
          ))}
        </details>
      )}
    </article>
  );
}
