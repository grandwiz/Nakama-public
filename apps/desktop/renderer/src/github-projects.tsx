import { useEffect, useRef, useState } from "react";
import {
  Check,
  Download,
  GitBranch,
  GitCommitHorizontal,
  RefreshCw,
  Upload,
} from "lucide-react";
import { api, previewMode } from "./bridge";
import { Button, Empty, Modal } from "./components";
import { useNakama } from "./context";
import type { Project } from "./types";
import "./learning-github.css";

interface Repository {
  id: string | number;
  name: string;
  url: string;
  private: boolean;
  defaultBranch?: string;
  updatedAt?: string;
}
interface GitEntry {
  path: string;
  indexStatus: string;
  worktreeStatus: string;
  originalPath?: string;
}
interface GitHubState {
  linked: boolean;
  link?: {
    accountId: string;
    accountLabel: string;
    repository: string;
    url: string;
    defaultBranch?: string;
  };
  status: {
    available: boolean;
    repository: boolean;
    branch: string | null;
    head: string | null;
    entries: GitEntry[];
    truncated: boolean;
    ahead?: number;
    behind?: number;
    remoteHead?: string | null;
  };
  busy: boolean;
}
interface CommitPreview {
  id: string;
  projectId: string;
  head: string;
  branch: string;
  message: string;
  authorName: string;
  authorEmail: string;
  files: {
    path: string;
    kind: string;
    before: string;
    after: string;
    bytes: number;
  }[];
  expiresAt: string;
  disclosure: string;
}
interface PushPreview {
  id: string;
  head: string;
  branch: string;
  remoteHead?: string | null;
  repository: string;
  accountLabel: string;
  expiresAt: string;
  disclosure: string;
}
const reasonText = (reason: unknown) =>
  reason instanceof Error
    ? reason.message
    : "The host did not confirm this operation.";
const encoded = encodeURIComponent;

export function GitHubImport({ onClose }: { onClose: () => void }) {
  const { state, refresh, openProject, navigate } = useNakama();
  const accounts =
    state.connections.find((item) => item.id === "github")?.accounts || [];
  const [accountId, setAccountId] = useState(accounts[0]?.id || "");
  const [repository, setRepository] = useState("");
  const [name, setName] = useState("");
  const [items, setItems] = useState<Repository[]>([]);
  const [nextPage, setNextPage] = useState<number | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const close = () => {
    if (
      !busy &&
      (!(repository || name) ||
        window.confirm("Close this repository import form?"))
    )
      onClose();
  };
  async function list(page = 1) {
    setBusy("list");
    setError("");
    try {
      const result = await api<{
        items: Repository[];
        nextPage?: number | null;
      }>(
        "GET",
        `/api/github/repositories?accountId=${encoded(accountId)}&page=${page}`,
      );
      if (alive.current) {
        setItems((prior) =>
          page === 1
            ? result.items
            : [
                ...prior,
                ...result.items.filter(
                  (item) => !prior.some((old) => old.id === item.id),
                ),
              ],
        );
        setNextPage(result.nextPage || null);
      }
    } catch (reason) {
      if (alive.current) setError(reasonText(reason));
    } finally {
      if (alive.current) setBusy("");
    }
  }
  async function clone() {
    setBusy("clone");
    setError("");
    try {
      const result = await api<{ project: Project }>(
        "POST",
        "/api/github/import",
        {
          accountId,
          repository: repository.trim(),
          ...(name.trim() ? { name: name.trim() } : {}),
        },
      );
      await refresh();
      if (alive.current && result.project?.id) {
        onClose();
        openProject(result.project.id);
      }
    } catch (reason) {
      if (alive.current)
        setError(
          `${reasonText(reason)} Check Projects before repeating an uncertain import.`,
        );
    } finally {
      if (alive.current) setBusy("");
    }
  }
  return (
    <Modal
      title="Bring a GitHub project home"
      description="Clone an existing repository into a new folder in your Nakama workspace."
      onClose={close}
    >
      {!accounts.length ? (
        <Empty
          icon={<GitBranch size={30} />}
          title="Link a GitHub account first"
          action={
            <Button
              onClick={() => {
                onClose();
                navigate("connections");
              }}
            >
              Open Connections
            </Button>
          }
        >
          Add a labelled GitHub account in Connections on this PC. Its token
          stays in the protected host vault.
        </Empty>
      ) : (
        <form
          className="github-form"
          onSubmit={(event) => {
            event.preventDefault();
            void clone();
          }}
        >
          <fieldset disabled={Boolean(busy)} className="plain-fieldset">
            <label>
              GitHub account
              <select
                value={accountId}
                onChange={(event) => {
                  setAccountId(event.target.value);
                  setItems([]);
                  setNextPage(null);
                  setRepository("");
                  setError("");
                }}
              >
                {accounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.accountLabel}
                  </option>
                ))}
              </select>
            </label>
            <Button
              kind="secondary"
              type="button"
              disabled={!accountId}
              onClick={() => void list()}
            >
              <RefreshCw size={14} /> Load repositories
            </Button>
            {items.length > 0 && (
              <div
                className="github-repository-list"
                aria-label="GitHub repositories"
              >
                {items.map((item) => (
                  <button
                    type="button"
                    className="github-repository-choice"
                    key={item.id}
                    aria-pressed={repository === item.name}
                    onClick={() => setRepository(item.name)}
                  >
                    <strong>{item.name}</strong>
                    <small>
                      {item.private ? "Private" : "Public"}
                      {item.defaultBranch ? ` · ${item.defaultBranch}` : ""}
                    </small>
                  </button>
                ))}
              </div>
            )}
            {nextPage && (
              <Button
                kind="secondary"
                type="button"
                onClick={() => void list(nextPage)}
              >
                Load more repositories
              </Button>
            )}
            <label>
              Repository
              <input
                required
                maxLength={240}
                value={repository}
                onChange={(event) => setRepository(event.target.value)}
                placeholder="owner/repository or its GitHub HTTPS URL"
              />
            </label>
            <label>
              Local project name
              <input
                maxLength={80}
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Use the repository name"
              />
            </label>
            <p className="small-copy">
              A new checkout goes inside your configured workspace. Existing
              folders are preserved. Import does not run project scripts,
              install dependencies or deploy.
            </p>
            {!state.config.workspaceRoot && (
              <p className="inline-error">
                Choose a workspace folder in Settings first.
              </p>
            )}
            {error && (
              <p role="alert" className="inline-error">
                {error}
              </p>
            )}
            <div className="modal-actions">
              <Button kind="secondary" type="button" onClick={close}>
                Cancel
              </Button>
              <Button
                type="submit"
                busy={busy === "clone"}
                disabled={
                  !repository.trim() ||
                  !accounts.some((account) => account.id === accountId) ||
                  !state.config.workspaceRoot
                }
              >
                <Download size={15} /> Clone project
              </Button>
            </div>
          </fieldset>
          {busy && (
            <p role="status">
              {busy === "clone"
                ? "Cloning into your workspace. Keep this window open…"
                : "Reading your repositories…"}
            </p>
          )}
        </form>
      )}
    </Modal>
  );
}

export function GitHubProject({
  project,
  blockedReason = "",
  onChanged,
  onDraftChange,
}: {
  project: Project;
  blockedReason?: string;
  onChanged: () => void;
  onDraftChange?: (dirty: boolean) => void;
}) {
  const { state, refresh, openApproval, navigate } = useNakama();
  const accounts =
    state.connections.find((item) => item.id === "github")?.accounts || [];
  const [data, setData] = useState<GitHubState>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [revision, setRevision] = useState(0);
  const [accountId, setAccountId] = useState(accounts[0]?.id || "");
  const [repository, setRepository] = useState("");
  const [paths, setPaths] = useState<string[]>([]);
  const [message, setMessage] = useState("");
  const [authorName, setAuthorName] = useState("");
  const [authorEmail, setAuthorEmail] = useState("");
  const [cleanAuthor, setCleanAuthor] = useState({ name: "", email: "" });
  const [commit, setCommit] = useState<CommitPreview>();
  const [push, setPush] = useState<PushPreview>();
  const [reviewed, setReviewed] = useState(false);
  const [pushReviewed, setPushReviewed] = useState(false);
  const [receipt, setReceipt] = useState("");
  const [approvalId, setApprovalId] = useState<string>();
  const [uncertain, setUncertain] = useState(false);
  const [clock, setClock] = useState(Date.now());
  const alive = useRef(true);
  const prefix = `/api/projects/${encoded(project.id)}/github`;
  const draftPresent = Boolean(
    message ||
    paths.length ||
    repository ||
    authorName !== cleanAuthor.name ||
    authorEmail !== cleanAuthor.email,
  );
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    onDraftChange?.(draftPresent || Boolean(busy && busy !== "read"));
    return () => onDraftChange?.(false);
  }, [draftPresent, busy, onDraftChange]);
  useEffect(() => {
    if (!commit && !push) return;
    const interval = window.setInterval(() => setClock(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, [commit, push]);
  useEffect(() => {
    if (previewMode) return;
    let cancelled = false;
    setBusy("read");
    setError("");
    void api<GitHubState>("GET", prefix)
      .then((next) => {
        if (!cancelled) {
          setData(next);
          if (next.link) setAccountId(next.link.accountId);
        }
      })
      .catch((reason) => {
        if (!cancelled) setError(reasonText(reason));
      })
      .finally(() => {
        if (!cancelled) setBusy("");
      });
    return () => {
      cancelled = true;
    };
  }, [prefix, revision]);
  function invalidate() {
    setCommit(undefined);
    setPush(undefined);
    setReviewed(false);
    setPushReviewed(false);
    setReceipt("");
    setApprovalId(undefined);
  }
  function refreshStatus() {
    invalidate();
    setUncertain(false);
    setRevision((value) => value + 1);
  }
  async function run<T>(
    action: string,
    body: unknown,
    done: (result: T) => void,
    mutation = false,
  ) {
    setBusy(action);
    setError("");
    setReceipt("");
    setApprovalId(undefined);
    // The project editor outlives this tab. Invalidate its buffer both before
    // and after a pull, including when the user leaves the Git screen mid-run.
    if (action === "pull") onChanged();
    try {
      const result = await api<T>("POST", `${prefix}/${action}`, body);
      await refresh();
      if (alive.current) done(result);
    } catch (reason) {
      if (alive.current) {
        setError(reasonText(reason));
        if (mutation) setUncertain(true);
      }
    } finally {
      if (action === "pull") onChanged();
      if (alive.current) setBusy("");
    }
  }
  const disabled = Boolean(busy || blockedReason || data?.busy || uncertain);
  const changed = () => {
    onChanged();
    setRevision((value) => value + 1);
  };
  const candidates = data?.status.entries || [];
  if (previewMode) return null;
  return (
    <section
      className="panel github-project-panel"
      aria-label="GitHub project controls"
    >
      <div className="github-heading">
        <GitBranch size={25} />
        <div>
          <h3>Your GitHub project</h3>
          <p>
            {data?.link
              ? `${data.link.repository} · ${data.link.accountLabel}`
              : "Link a saved GitHub account to this managed checkout."}
          </p>
        </div>
      </div>
      <div className="button-row">
        <Button
          kind="secondary"
          disabled={Boolean(busy)}
          onClick={refreshStatus}
        >
          <RefreshCw size={14} /> Refresh GitHub state
        </Button>
        {!accounts.length && (
          <Button kind="secondary" onClick={() => navigate("connections")}>
            Link a GitHub account
          </Button>
        )}
      </div>
      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
      {uncertain && (
        <p className="inline-note">
          The operation was not confirmed. Refresh and inspect the current
          branch/files before trying again.
        </p>
      )}
      {blockedReason && <p className="inline-note">{blockedReason}</p>}
      {data?.busy && (
        <p role="status">
          Another project operation is active. Wait for it to finish.
        </p>
      )}
      {!data ? (
        <p role="status">
          {busy ? "Reading repository state…" : "Repository state unavailable."}
        </p>
      ) : (
        <>
          <details className="github-form" open={!data.linked}>
            <summary>
              {data.linked
                ? "Change linked repository/account"
                : "Link this checkout"}
            </summary>
            <fieldset
              disabled={disabled || !accounts.length}
              className="plain-fieldset"
            >
              <label>
                Repository account
                <select
                  value={accountId}
                  onChange={(event) => {
                    invalidate();
                    setAccountId(event.target.value);
                  }}
                >
                  {accounts.map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.accountLabel}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                GitHub repository
                <input
                  value={repository}
                  maxLength={240}
                  onChange={(event) => {
                    invalidate();
                    setRepository(event.target.value);
                  }}
                  placeholder="owner/repository"
                />
              </label>
              <Button
                disabled={
                  !repository.trim() ||
                  !accounts.some((account) => account.id === accountId)
                }
                onClick={() => {
                  invalidate();
                  void run(
                    "link",
                    { accountId, repository: repository.trim() },
                    () => {
                      setRepository("");
                      setReceipt(
                        "Repository linked. No files were pulled or pushed.",
                      );
                      setRevision((value) => value + 1);
                    },
                    true,
                  );
                }}
              >
                Link repository
              </Button>
            </fieldset>
          </details>
          {data.linked && (
            <>
              <p className="small-copy">
                <GitBranch size={13} />{" "}
                {data.status.branch || "No active branch"} ·{" "}
                {data.status.head?.slice(0, 12) || "No local commits"}
                {typeof data.status.ahead === "number"
                  ? ` · ${data.status.ahead} ahead / ${data.status.behind || 0} behind`
                  : " · fetch to compare with GitHub"}
              </p>
              <div className="button-row">
                <Button
                  kind="secondary"
                  disabled={disabled}
                  onClick={() => {
                    invalidate();
                    void run(
                      "fetch",
                      {},
                      () => {
                        setReceipt(
                          "Latest remote references fetched. Working files unchanged.",
                        );
                        setRevision((value) => value + 1);
                      },
                      true,
                    );
                  }}
                >
                  <RefreshCw size={14} /> Fetch updates
                </Button>
                <Button
                  kind="secondary"
                  disabled={disabled || candidates.length > 0}
                  onClick={() => {
                    invalidate();
                    void run(
                      "pull",
                      {},
                      () => {
                        setReceipt(
                          "Pull completed. Reload any open file before editing it.",
                        );
                        changed();
                      },
                      true,
                    );
                  }}
                >
                  <Download size={14} /> Pull fast-forward
                </Button>
              </div>
              <p className="small-copy">
                Pull requires a clean checkout and a fast-forward history. Dirty
                or diverged work is preserved for you to resolve.
              </p>
              <div className="github-columns">
                <section className="github-form">
                  <h4>Commit selected changes</h4>
                  <fieldset disabled={disabled} className="plain-fieldset">
                    <div className="github-files" aria-label="Files to commit">
                      {candidates.map((entry) => (
                        <label key={entry.path}>
                          <input
                            type="checkbox"
                            checked={paths.includes(entry.path)}
                            onChange={(event) => {
                              invalidate();
                              setPaths(
                                event.target.checked
                                  ? [...paths, entry.path]
                                  : paths.filter((item) => item !== entry.path),
                              );
                            }}
                          />
                          <span>
                            {entry.path}{" "}
                            <small>
                              ({entry.indexStatus}
                              {entry.worktreeStatus})
                            </small>
                          </span>
                        </label>
                      ))}
                    </div>
                    {!candidates.length && (
                      <p className="small-copy">No saved changes to commit.</p>
                    )}
                    <label>
                      Commit message
                      <input
                        value={message}
                        maxLength={500}
                        onChange={(event) => {
                          invalidate();
                          setMessage(event.target.value);
                        }}
                      />
                    </label>
                    <label>
                      Commit author name
                      <input
                        value={authorName}
                        maxLength={100}
                        onChange={(event) => {
                          invalidate();
                          setAuthorName(event.target.value);
                        }}
                      />
                    </label>
                    <label>
                      Commit author email
                      <input
                        type="email"
                        value={authorEmail}
                        maxLength={254}
                        onChange={(event) => {
                          invalidate();
                          setAuthorEmail(event.target.value);
                        }}
                        placeholder="Your GitHub verified or no-reply address"
                      />
                    </label>
                    <Button
                      disabled={
                        !paths.length ||
                        !message.trim() ||
                        !authorName.trim() ||
                        !authorEmail.trim() ||
                        data.status.truncated
                      }
                      onClick={() => {
                        invalidate();
                        void run<CommitPreview>(
                          "commit/prepare",
                          {
                            paths,
                            message: message.trim(),
                            authorName: authorName.trim(),
                            authorEmail: authorEmail.trim(),
                          },
                          (result) => {
                            setCommit(result);
                            setClock(Date.now());
                          },
                        );
                      }}
                    >
                      <GitCommitHorizontal size={15} /> Review commit
                    </Button>
                  </fieldset>
                </section>
                <section>
                  <h4>Push reviewed work</h4>
                  <p className="small-copy">
                    Prepare the exact branch and commit, then request approval
                    on this PC. A push may trigger GitHub Actions or a connected
                    deployment.
                  </p>
                  <Button
                    disabled={
                      disabled || !data.status.head || !data.status.branch
                    }
                    onClick={() => {
                      invalidate();
                      void run<PushPreview>("push/prepare", {}, (result) => {
                        setPush(result);
                        setClock(Date.now());
                      });
                    }}
                  >
                    <Upload size={15} /> Review push
                  </Button>
                </section>
              </div>
              {commit && (
                <section className="github-review" aria-label="Commit review">
                  <h4>Review this local commit</h4>
                  <p>
                    <strong>{commit.message}</strong>
                  </p>
                  <p>
                    {commit.authorName} &lt;{commit.authorEmail}&gt; ·{" "}
                    {commit.branch} · based on{" "}
                    {commit.head?.slice(0, 12) || "empty repository"}
                  </p>
                  <p className="small-copy">{commit.disclosure}</p>
                  {commit.files.map((file) => (
                    <details key={file.path}>
                      <summary>{file.path}</summary>
                      <p className="small-copy">
                        {file.kind} · {file.bytes} bytes
                      </p>
                      <strong>Before</strong>
                      <pre>{file.before || "(empty)"}</pre>
                      <strong>After</strong>
                      <pre>{file.after || "(empty)"}</pre>
                    </details>
                  ))}
                  <label className="check-label">
                    <input
                      type="checkbox"
                      checked={reviewed}
                      disabled={disabled}
                      onChange={(event) => setReviewed(event.target.checked)}
                    />
                    I reviewed the selected changes and author details
                  </label>
                  <Button
                    disabled={
                      disabled ||
                      !reviewed ||
                      Date.parse(commit.expiresAt) <= clock
                    }
                    onClick={() =>
                      void run<{ head?: string; commit?: string }>(
                        "commit",
                        { previewId: commit.id },
                        (result) => {
                          setReceipt(
                            `Local commit created: ${result.commit || "see current branch"}. Nothing was pushed.`,
                          );
                          setCommit(undefined);
                          setMessage("");
                          setPaths([]);
                          setCleanAuthor({
                            name: authorName,
                            email: authorEmail,
                          });
                          changed();
                        },
                        true,
                      )
                    }
                  >
                    <Check size={15} /> Create local commit
                  </Button>
                  {Date.parse(commit.expiresAt) <= clock && (
                    <p className="inline-error">
                      This review expired. Prepare a fresh commit review.
                    </p>
                  )}
                </section>
              )}
              {push && (
                <section className="github-review" aria-label="Push review">
                  <h4>Review this GitHub push</h4>
                  <p>
                    {push.repository} · {push.accountLabel} · {push.branch}
                  </p>
                  <p>
                    Local commit: <code>{push.head}</code>
                  </p>
                  <p>
                    Reviewed remote:{" "}
                    <code>{push.remoteHead || "new branch"}</code>
                  </p>
                  <p className="small-copy">{push.disclosure}</p>
                  <label className="check-label">
                    <input
                      type="checkbox"
                      checked={pushReviewed}
                      disabled={disabled}
                      onChange={(event) =>
                        setPushReviewed(event.target.checked)
                      }
                    />
                    I reviewed the destination, commit and automation
                    implications
                  </label>
                  <Button
                    disabled={
                      disabled ||
                      !pushReviewed ||
                      Date.parse(push.expiresAt) <= clock
                    }
                    onClick={() =>
                      void run<{ approval: { id: string } }>(
                        "push",
                        { previewId: push.id },
                        (result) => {
                          setPush(undefined);
                          setReceipt(
                            "Push requested. It has not run; review the exact operation in PC approvals.",
                          );
                          setApprovalId(result.approval.id);
                        },
                        true,
                      )
                    }
                  >
                    Request PC approval
                  </Button>
                  {Date.parse(push.expiresAt) <= clock && (
                    <p className="inline-error">
                      This review expired. Prepare a fresh push review.
                    </p>
                  )}
                </section>
              )}
            </>
          )}
          {busy && (
            <p role="status">
              {busy === "read"
                ? "Reading repository state…"
                : "Working on the requested Git operation…"}
            </p>
          )}
          {receipt && (
            <p className="github-receipt" role="status">
              {receipt}
            </p>
          )}
          {approvalId && (
            <Button kind="secondary" onClick={() => openApproval(approvalId)}>
              Open push approval
            </Button>
          )}
        </>
      )}
    </section>
  );
}
