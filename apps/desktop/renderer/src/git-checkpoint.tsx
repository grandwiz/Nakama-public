import { useEffect, useRef, useState } from "react";
import { CheckCircle2, GitCommitHorizontal, Info } from "lucide-react";
import { api } from "./bridge";
import { Button } from "./components";
import type { Project } from "./types";
import {
  checkpointCandidates,
  checkpointRequest,
  CheckpointRequestGate,
  validCheckpointPreparation,
  validCheckpointReceipt,
  type CheckpointEntry,
  type CheckpointPreparation,
  type CheckpointReceipt,
} from "./git-checkpoint-model";

export function GitCheckpoint({
  project,
  entries,
  blockedReason,
}: {
  project: Project;
  entries: CheckpointEntry[];
  blockedReason: string;
}) {
  const [paths, setPaths] = useState<string[]>([]);
  const [message, setMessage] = useState("");
  const [preparation, setPreparation] = useState<CheckpointPreparation>();
  const [receipt, setReceipt] = useState<CheckpointReceipt>();
  const [reviewed, setReviewed] = useState(false);
  const [busy, setBusy] = useState<"prepare" | "create" | "">("");
  const [error, setError] = useState("");
  const [uncertain, setUncertain] = useState(false);
  const [expired, setExpired] = useState(false);
  const gate = useRef(new CheckpointRequestGate());
  const candidates = checkpointCandidates(entries);
  const disabled = Boolean(blockedReason) || Boolean(busy) || uncertain;
  useEffect(() => () => gate.current.invalidate(), []);
  useEffect(() => {
    setExpired(false);
    if (!preparation) return;
    const timer = window.setTimeout(
      () => setExpired(true),
      Math.max(0, Date.parse(preparation.expiresAt) - Date.now()),
    );
    return () => window.clearTimeout(timer);
  }, [preparation]);
  const resetReview = () => {
    gate.current.invalidate();
    setPreparation(undefined);
    setReceipt(undefined);
    setReviewed(false);
    setError("");
    setExpired(false);
  };
  const prepare = async () => {
    if (disabled) return;
    let request;
    try {
      request = checkpointRequest(candidates, paths, message);
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Choose files and a message first.",
      );
      return;
    }
    const token = gate.current.begin();
    if (token === null) return;
    setBusy("prepare");
    setError("");
    setPreparation(undefined);
    setReceipt(undefined);
    setReviewed(false);
    try {
      const result = await api<unknown>(
        "POST",
        `/api/projects/${project.id}/git/checkpoints/prepare`,
        request,
      );
      if (!gate.current.finish(token)) return;
      if (!validCheckpointPreparation(result, project.id, request)) {
        setError(
          "The review did not match the selected project, files and message. Prepare it again.",
        );
      } else {
        setPreparation(result);
      }
      setBusy("");
    } catch (reason) {
      if (!gate.current.finish(token)) return;
      setBusy("");
      setError(
        reason instanceof Error
          ? reason.message
          : "Could not prepare this checkpoint.",
      );
    }
  };
  const create = async () => {
    if (
      disabled ||
      !reviewed ||
      !preparation ||
      expired ||
      Date.parse(preparation.expiresAt) <= Date.now()
    )
      return;
    const token = gate.current.begin();
    if (token === null) return;
    setBusy("create");
    setError("");
    try {
      const result = await api<unknown>(
        "POST",
        `/api/projects/${project.id}/git/checkpoints/create`,
        { previewId: preparation.id },
      );
      if (!gate.current.finish(token)) return;
      setBusy("");
      if (!validCheckpointReceipt(result, preparation)) {
        setUncertain(true);
        setError(
          "The host response did not identify the checkpoint just reviewed.",
        );
        return;
      }
      setReceipt(result);
    } catch (reason) {
      if (!gate.current.finish(token)) return;
      setBusy("");
      setUncertain(true);
      setError(
        reason instanceof Error
          ? reason.message
          : "The checkpoint result could not be confirmed.",
      );
    }
  };
  return (
    <section className="checkpoint-card" aria-label="Local Git checkpoint">
      <div className="checkpoint-heading">
        <GitCommitHorizontal size={22} />
        <div>
          <h3>Save a local checkpoint</h3>
          <p>
            Keep a named snapshot of selected saved files before your next
            change.
          </p>
        </div>
        <span className="git-readonly">On this PC</span>
      </div>
      <p className="checkpoint-explanation">
        A checkpoint keeps your branch, staged changes and working files as they
        are. It is stored only in this repository. Create your first Git commit
        before using checkpoints. Restoring one currently requires your Git
        client.
      </p>
      {blockedReason && (
        <p className="inline-note" role="status">
          <Info size={16} />
          {blockedReason}
        </p>
      )}
      {receipt ? (
        <div className="checkpoint-receipt" role="status">
          <CheckCircle2 size={21} />
          <div>
            <strong>Local checkpoint saved</strong>
            <p>{receipt.message}</p>
            <p>
              {receipt.files.length} file{receipt.files.length === 1 ? "" : "s"}{" "}
              · Commit <code>{receipt.commit}</code>
            </p>
            <code>{receipt.ref}</code>
            <p>
              Nothing was uploaded. Keep this reference to find the checkpoint
              in Git.
            </p>
          </div>
          <Button
            kind="secondary"
            onClick={() => {
              resetReview();
              setPaths([]);
              setMessage("");
            }}
          >
            New checkpoint
          </Button>
        </div>
      ) : (
        <>
          <label className="field">
            Checkpoint message
            <input
              value={message}
              maxLength={500}
              disabled={disabled}
              placeholder="Describe the changes you want to keep"
              onChange={(event) => {
                resetReview();
                setMessage(event.target.value);
              }}
            />
          </label>
          <fieldset className="checkpoint-selection" disabled={disabled}>
            <legend>Choose saved files · {paths.length}/20 selected</legend>
            {candidates.length ? (
              candidates.map((entry) => (
                <label key={entry.path}>
                  <input
                    type="checkbox"
                    aria-label={`Include ${entry.path} in checkpoint`}
                    checked={paths.includes(entry.path)}
                    disabled={!paths.includes(entry.path) && paths.length >= 20}
                    onChange={(event) => {
                      resetReview();
                      setPaths((previous) =>
                        event.target.checked
                          ? [...previous, entry.path]
                          : previous.filter((value) => value !== entry.path),
                      );
                    }}
                  />
                  <span>{entry.path}</span>
                </label>
              ))
            ) : (
              <p>
                No eligible changes. Save a text-file change and refresh this
                view.
              </p>
            )}
          </fieldset>
          <p className="checkpoint-hint">
            The complete current saved version of each chosen file is compared
            with HEAD, even if only part of it is staged. Plain text only;
            private files, renames and conflicts require your Git client.
          </p>
          <Button
            kind="secondary"
            disabled={disabled || !paths.length || !message.trim()}
            busy={busy === "prepare"}
            onClick={() => void prepare()}
          >
            Prepare checkpoint review
          </Button>
          {error && (
            <p className="inline-error" role="alert">
              {error}
            </p>
          )}
          {preparation && (
            <div className="checkpoint-review">
              <h4>Review this checkpoint for {project.name}</h4>
              <dl>
                <div>
                  <dt>Message</dt>
                  <dd>{preparation.message}</dd>
                </div>
                <div>
                  <dt>Based on</dt>
                  <dd>
                    {preparation.head || "No commits yet"}
                    {preparation.branch ? ` · ${preparation.branch}` : ""}
                  </dd>
                </div>
                <div>
                  <dt>Review expires</dt>
                  <dd>
                    {new Date(preparation.expiresAt).toLocaleTimeString()}
                  </dd>
                </div>
              </dl>
              <p>{preparation.disclosure}</p>
              {preparation.files.map((file) => (
                <details className="checkpoint-file" key={file.path} open>
                  <summary>
                    <strong>{file.path}</strong>
                    <span>
                      {file.kind} · {file.bytes} saved bytes
                    </span>
                  </summary>
                  <div className="checkpoint-comparison">
                    <div>
                      <h5>Before · HEAD</h5>
                      <pre
                        tabIndex={0}
                        aria-label={`Before checkpoint: ${file.path}`}
                      >
                        {file.before ||
                          (file.kind === "added"
                            ? "(File does not exist in HEAD)"
                            : "(Empty file)")}
                      </pre>
                    </div>
                    <div>
                      <h5>After · checkpoint</h5>
                      <pre
                        tabIndex={0}
                        aria-label={`After checkpoint: ${file.path}`}
                      >
                        {file.after ||
                          (file.kind === "deleted"
                            ? "(File will be absent in the checkpoint)"
                            : "(Empty file)")}
                      </pre>
                    </div>
                  </div>
                </details>
              ))}
              {uncertain ? (
                <div className="checkpoint-uncertain" role="status">
                  <strong>Check the result before trying again</strong>
                  <p>
                    A request was submitted and will not be retried
                    automatically. Inspect this local Git reference before
                    starting another checkpoint:
                  </p>
                  <code>{`refs/nakama/checkpoints/${preparation.id}`}</code>
                  <p>
                    If the host reported changed files or an expired review,
                    refresh this view and prepare a fresh review.
                  </p>
                </div>
              ) : (
                <>
                  {expired && (
                    <p className="inline-error" role="status">
                      This review has expired. Prepare it again before creating
                      the checkpoint.
                    </p>
                  )}
                  <label className="checkpoint-consent">
                    <input
                      type="checkbox"
                      checked={reviewed}
                      disabled={disabled || expired}
                      onChange={(event) => setReviewed(event.target.checked)}
                    />
                    <span>
                      I have reviewed these exact files and this checkpoint
                      message.
                    </span>
                  </label>
                  <Button
                    disabled={disabled || !reviewed || expired}
                    busy={busy === "create"}
                    onClick={() => void create()}
                  >
                    <GitCommitHorizontal size={16} />
                    Create local checkpoint
                  </Button>
                  <p className="checkpoint-hint">
                    The host checks the saved files again. This action does not
                    push, deploy or change your branch.
                  </p>
                </>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}
