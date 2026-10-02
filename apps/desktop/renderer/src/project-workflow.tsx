import { useEffect, useState } from "react";
import { Bot, Send, Square } from "lucide-react";
import { Button, Status } from "./components";
import { useNakama } from "./context";
import { roleSummary } from "./ai-role-settings";
import type { ProjectWorkflow } from "./types";

const liveStatuses = new Set([
  "queued",
  "running",
  "planning",
  "awaiting_answers",
  "developing",
  "reviewing",
  "fixing",
  "delivering",
]);
const stageLabels: Record<string, string> = {
  planning: "Planning together",
  manager: "Manager preparing the plan",
  awaiting_answers: "Your manager has questions",
  awaiting_check_approval: "Project check needs your PC approval",
  checking: "Running project checks",
  development: "Workers building",
  developing: "Workers building",
  review: "Both reviewers checking",
  reviewing: "Both reviewers checking",
  fixing: "Workers applying check or review fixes",
  delivery: "Manager preparing your result",
  delivering: "Manager preparing your result",
  completed: "Delivered",
  needs_attention: "Needs attention",
  stopped: "Stopped",
  cancelled: "Stopped",
  interrupted: "Interrupted",
  failed: "Could not continue",
};

export function ProjectWorkflowPanel({
  projectId,
  onDraftChange,
}: {
  projectId: string;
  onDraftChange: (dirty: boolean) => void;
}) {
  const { state } = useNakama();
  const runs = (state.projectWorkflows || [])
    .filter((run) => run.projectId === projectId)
    .slice(-3)
    .reverse();
  if (!runs.length) return null;
  return (
    <section
      className="project-workflows"
      aria-label="Managed project progress"
    >
      {runs.map((run) => (
        <WorkflowCard key={run.id} run={run} onDraftChange={onDraftChange} />
      ))}
    </section>
  );
}

function WorkflowCard({
  run,
  onDraftChange,
}: {
  run: ProjectWorkflow;
  onDraftChange: (dirty: boolean) => void;
}) {
  const { perform, openApproval, navigate } = useNakama();
  const [busy, setBusy] = useState(false);
  const waiting = run.status === "awaiting_answers";
  const active = liveStatuses.has(run.status);
  const dependencyApproval = run.checkReceipts?.some(
    (receipt) =>
      receipt.approvalId === run.checkApprovalId &&
      receipt.checkName === "dependencies",
  );
  const dependencyStage =
    active && dependencyApproval
      ? run.stage === "awaiting_check_approval"
        ? "Dependency preparation needs your PC approval"
        : run.stage === "checking"
          ? "Preparing locked dependencies"
          : undefined
      : undefined;
  const unanswered = (run.questions || []).filter(
    (question) => !question.answer,
  );
  return (
    <article className="project-workflow-card" aria-label="Project manager">
      <div className="workflow-heading">
        <Bot size={20} />
        <strong>
          {dependencyStage ||
            (!active && stageLabels[run.status]) ||
            stageLabels[run.stage] ||
            stageLabels[run.status] ||
            run.stage.replaceAll("_", " ")}
        </strong>
        <Status value={run.status} />
        {active && (
          <Button
            kind="ghost"
            busy={busy}
            onClick={async () => {
              setBusy(true);
              await perform(
                "POST",
                `/api/project-workflows/${run.id}/stop`,
                {},
              );
              setBusy(false);
            }}
          >
            <Square size={13} />
            Stop project work
          </Button>
        )}
      </div>
      <p>{run.message}</p>
      {run.detail && (
        <p className="small-copy" role="status">
          {run.detail}
        </p>
      )}
      {run.error && (
        <p className="inline-error" role="alert">
          {run.error}
        </p>
      )}
      {active && run.stage === "awaiting_check_approval" && (
        <div className="workflow-questions" role="status">
          <p>
            {dependencyApproval
              ? "Dependency preparation is waiting for your approval on this PC. Review the exact npm ci command and package/lockfile hashes in Activity & approvals. It downloads public npm packages and replaces this project's node_modules. Lifecycle scripts are disabled; packages needing install scripts may still need setup. Each installation needs fresh approval."
              : "The next check is waiting for your approval on this PC. Read its exact command and pre/main/post scripts in Activity & approvals. Every run needs fresh approval, including runs after a repair."}
          </p>
          <Button
            onClick={() =>
              run.checkApprovalId
                ? openApproval(run.checkApprovalId)
                : navigate("activity")
            }
          >
            {dependencyApproval
              ? "Review dependency approval"
              : "Review check approval"}
          </Button>
        </div>
      )}
      {waiting && (
        <QuestionForm
          key={`${run.id}:${unanswered.map((q) => q.id).join(",")}`}
          runId={run.id}
          questions={unanswered}
          disabled={busy}
          onDraftChange={onDraftChange}
        />
      )}
      {(run.checkSummary || !!run.checkReceipts?.length) && (
        <section aria-label="Workflow project checks">
          {run.checkSummary && <p className="small-copy">{run.checkSummary}</p>}
          {!!run.checkReceipts?.length && (
            <details>
              <summary>
                Project check results ({run.checkReceipts.length})
              </summary>
              {run.checkReceipts.map((check, index) => (
                <div
                  key={`${check.approvalId}:${index}`}
                  className="workflow-review"
                >
                  <strong>
                    {check.checkName === "dependencies"
                      ? "Locked dependencies (npm ci)"
                      : check.checkName}{" "}
                    · round {check.round} · {check.status.replaceAll("_", " ")}
                    {typeof check.exitCode === "number"
                      ? ` · exit ${check.exitCode}`
                      : ""}
                    {check.signal ? ` · signal ${check.signal}` : ""}
                  </strong>
                  {check.status === "awaiting_approval" && (
                    <p className="small-copy">
                      {check.checkName === "dependencies"
                        ? "Dependency preparation has not started."
                        : "This check has not started."}
                    </p>
                  )}
                  {check.checkName === "dependencies" && (
                    <p className="small-copy">
                      Approved npm ci replaces node_modules with the exact
                      locked public packages. Lifecycle scripts are disabled.
                      This receipt does not establish a passing build or working
                      website.
                    </p>
                  )}
                  {check.error && <p className="inline-error">{check.error}</p>}
                  {check.output && (
                    <details>
                      <summary>Recorded check output</summary>
                      <pre className="workflow-plan">{check.output}</pre>
                    </details>
                  )}
                </div>
              ))}
            </details>
          )}
        </section>
      )}
      <details>
        <summary>Plan, team & review progress</summary>
        <dl className="ai-role-summary">
          <dt>Manager</dt>
          <dd>{roleSummary(run.assignments.manager)}</dd>
          <dt>Co-planner</dt>
          <dd>{roleSummary(run.assignments.peer)}</dd>
          <dt>Workers</dt>
          <dd>{roleSummary(run.assignments.development)}</dd>
        </dl>
        {run.plan && <pre className="workflow-plan">{run.plan}</pre>}
        {(run.workItems || []).length > 0 && (
          <ol>
            {run.workItems!.map((item, index) => (
              <li key={item.id || index}>
                {item.title}
                {item.status ? ` · ${item.status.replaceAll("_", " ")}` : ""}
              </li>
            ))}
          </ol>
        )}
        {(run.reviews || []).map((review, index) => (
          <div key={index} className="workflow-review">
            <strong>
              {review.role === "peer" ? "Co-planner review" : "Manager review"}{" "}
              · round {review.round ?? 0} ·{" "}
              {review.verdict?.replaceAll("_", " ")}
            </strong>
            <p>{review.summary}</p>
            {!!review.findings?.length && (
              <ul>
                {review.findings.map((finding, item) => (
                  <li key={item}>{finding}</li>
                ))}
              </ul>
            )}
          </div>
        ))}
        <p className="small-copy">
          Review round {run.reviewRound || 0}. Completed means both reviewers
          passed the changes and the manager delivered. Check results above
          record what ran; a passed script does not certify a working
          deployment.
          {!run.checkSummary &&
            !run.checkReceipts?.length &&
            " No automated check record is available for this workflow."}
        </p>
      </details>
    </article>
  );
}

function QuestionForm({
  runId,
  questions,
  disabled,
  onDraftChange,
}: {
  runId: string;
  questions: ProjectWorkflow["questions"];
  disabled: boolean;
  onDraftChange: (dirty: boolean) => void;
}) {
  const { perform } = useNakama();
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const dirty = Object.values(answers).some((value) => value.trim());
  useEffect(() => {
    onDraftChange(dirty);
    return () => onDraftChange(false);
  }, [dirty, onDraftChange]);
  return (
    <form
      className="workflow-questions"
      onSubmit={async (event) => {
        event.preventDefault();
        if (busy || disabled || questions.some((q) => !answers[q.id]?.trim()))
          return;
        setBusy(true);
        const result = await perform(
          "POST",
          `/api/project-workflows/${runId}/answers`,
          {
            answers: questions.map((question) => ({
              id: question.id,
              answer: answers[question.id].trim(),
            })),
          },
          "Your answers have been sent to the project manager.",
        );
        if (result !== undefined) setAnswers({});
        setBusy(false);
      }}
    >
      <p>
        Your manager needs these answers before the team can finish planning.
      </p>
      {questions.map((question) => (
        <label className="field" key={question.id}>
          {question.text}
          <textarea
            required
            maxLength={4000}
            rows={2}
            disabled={busy || disabled}
            value={answers[question.id] || ""}
            onChange={(event) =>
              setAnswers((current) => ({
                ...current,
                [question.id]: event.target.value,
              }))
            }
          />
        </label>
      ))}
      <Button
        type="submit"
        busy={busy}
        disabled={
          disabled ||
          !questions.length ||
          questions.some((q) => !answers[q.id]?.trim())
        }
      >
        <Send size={14} />
        Send answers to manager
      </Button>
    </form>
  );
}
