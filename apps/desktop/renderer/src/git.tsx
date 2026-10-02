import { useEffect, useId, useState } from "react";
import {
  CheckCircle2,
  FileDiff,
  GitBranch,
  Info,
  RefreshCw,
} from "lucide-react";
import { api, previewMode } from "./bridge";
import { Button, Empty } from "./components";
import type { Project } from "./types";
import { GitCheckpoint } from "./git-checkpoint";
import { GitHubProject } from "./github-projects";

interface GitEntry {
  path: string;
  indexStatus: string;
  worktreeStatus: string;
  originalPath?: string;
}
interface GitState {
  available: boolean;
  repository: boolean;
  branch: string | null;
  head: string | null;
  entries: GitEntry[];
  truncated: boolean;
}
interface GitDiff {
  path: string;
  staged: boolean;
  content: string;
  truncated: boolean;
  binary: boolean;
  untracked: boolean;
}
type Pane = "worktree" | "staged";
const statusNames: Record<string, string> = {
  M: "Modified",
  A: "Added",
  D: "Deleted",
  R: "Renamed",
  C: "Copied",
  U: "Conflict",
  "?": "Untracked",
  T: "Type changed",
};
function inPane(entry: GitEntry, pane: Pane) {
  const status = pane === "staged" ? entry.indexStatus : entry.worktreeStatus;
  return (
    Boolean(status.trim()) &&
    status !== "." &&
    (pane !== "staged" || status !== "?")
  );
}
function entryStatus(entry: GitEntry, pane: Pane) {
  if (
    ["DD", "AU", "UD", "UA", "DU", "AA", "UU"].includes(
      entry.indexStatus + entry.worktreeStatus,
    )
  )
    return "U";
  return pane === "staged" ? entry.indexStatus : entry.worktreeStatus;
}
function lineClass(line: string) {
  if (line.startsWith("@@")) return "diff-hunk";
  if (
    line.startsWith("+++") ||
    line.startsWith("---") ||
    line.startsWith("diff ") ||
    line.startsWith("index ")
  )
    return "diff-meta";
  if (line.startsWith("+")) return "diff-added";
  if (line.startsWith("-")) return "diff-removed";
  return "";
}

export function GitChanges({
  project,
  hasUnsavedChanges = false,
  checkpointBlockedReason = "",
  onRepositoryChanged,
  onDraftChange,
}: {
  project: Project;
  hasUnsavedChanges?: boolean;
  checkpointBlockedReason?: string;
  onRepositoryChanged?: () => void;
  onDraftChange?: (dirty: boolean) => void;
}) {
  const [git, setGit] = useState<GitState>();
  const [loading, setLoading] = useState(!previewMode);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const [pane, setPane] = useState<Pane>("worktree");
  const [selectedPath, setSelectedPath] = useState("");
  const [diff, setDiff] = useState<GitDiff>();
  const [diffError, setDiffError] = useState("");
  const [diffLoading, setDiffLoading] = useState(false);
  const panelId = useId();
  const visible = git?.entries.filter((entry) => inPane(entry, pane)) || [];
  const selected =
    visible.find((entry) => entry.path === selectedPath) || visible[0];
  const path = selected?.path;

  useEffect(() => {
    if (previewMode) return;
    let cancelled = false;
    setLoading(true);
    setError("");
    setGit(undefined);
    void api<GitState>("GET", `/api/projects/${project.id}/git`)
      .then((result) => {
        if (!cancelled) setGit(result);
      })
      .catch((reason: unknown) => {
        if (!cancelled)
          setError(
            reason instanceof Error
              ? reason.message
              : "Could not read this project’s Git changes.",
          );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [project.id, revision]);

  useEffect(() => {
    let cancelled = false;
    setDiff(undefined);
    setDiffError("");
    setDiffLoading(false);
    if (previewMode || !path || loading) return;
    setDiffLoading(true);
    void api<GitDiff>(
      "GET",
      `/api/projects/${project.id}/git/diff?path=${encodeURIComponent(path)}&staged=${pane === "staged" ? "1" : "0"}`,
    )
      .then((result) => {
        if (!cancelled) setDiff(result);
      })
      .catch((reason: unknown) => {
        if (!cancelled)
          setDiffError(
            reason instanceof Error
              ? reason.message
              : "Could not read this file’s diff.",
          );
      })
      .finally(() => {
        if (!cancelled) setDiffLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [project.id, path, pane, revision, loading]);

  const changePane = (next: Pane) => {
    setPane(next);
    setSelectedPath("");
  };
  const count = (next: Pane) =>
    git?.entries.filter((entry) => inPane(entry, next)).length || 0;
  const refreshChanges = () => {
    // Remove the previous review immediately, before the async load effect.
    setLoading(true);
    setRevision((current) => current + 1);
  };
  return (
    <section className="git-panel" aria-label="Project Git changes">
      <div className="git-toolbar">
        <span className="git-branch-icon">
          <GitBranch size={21} />
        </span>
        <div>
          <h3>
            {git?.repository
              ? git.branch || (git.head ? "Detached HEAD" : "No commits yet")
              : "Git changes"}
          </h3>
          <p>
            {git?.head ? `Commit ${git.head.slice(0, 8)} · ` : ""}Review saved
            changes in this project.
          </p>
        </div>
        <span className="git-readonly">Local Git</span>
        <Button
          kind="secondary"
          disabled={previewMode}
          busy={loading}
          onClick={refreshChanges}
        >
          {!loading && <RefreshCw size={14} />} Refresh changes
        </Button>
      </div>
      <GitHubProject
        project={project}
        blockedReason={
          hasUnsavedChanges
            ? "Save your open file before changing Git history or pulling updates."
            : checkpointBlockedReason
        }
        onDraftChange={onDraftChange}
        onChanged={() => {
          refreshChanges();
          onRepositoryChanged?.();
        }}
      />
      {hasUnsavedChanges && (
        <div className="inline-note git-notice">
          <Info size={16} />
          <span>
            You have unsaved editor changes. Save the file, then refresh to
            include them here.
          </span>
        </div>
      )}
      {previewMode ? (
        <Empty
          icon={<GitBranch size={30} />}
          title="Git changes need the Windows app"
        >
          Open this project in Nakama Control Center to read its local Git
          history and saved changes.
        </Empty>
      ) : error ? (
        <div className="git-error" role="alert">
          <strong>Git changes could not be loaded</strong>
          <p>{error}</p>
          <Button kind="secondary" onClick={refreshChanges}>
            Try again
          </Button>
        </div>
      ) : loading ? (
        <div className="git-loading" role="status">
          <RefreshCw size={20} className="spin" /> Reading project changes…
        </div>
      ) : !git?.available ? (
        <Empty icon={<GitBranch size={30} />} title="Git is not installed">
          Install Git for Windows, restart Nakama, then refresh this view.
        </Empty>
      ) : !git.repository ? (
        <Empty
          icon={<GitBranch size={30} />}
          title="This project has no Git repository"
        >
          Initialise a repository in this project to track its changes. This
          view works with existing repositories.
        </Empty>
      ) : (
        <>
          <GitCheckpoint
            key={`${project.id}:${revision}:${hasUnsavedChanges}:${checkpointBlockedReason}`}
            project={project}
            entries={git.entries}
            blockedReason={
              hasUnsavedChanges
                ? "Save or discard your unsaved editor changes before preparing a checkpoint."
                : checkpointBlockedReason ||
                  (git.truncated
                    ? "The change list is incomplete. Reduce the changes or use your Git client before creating a checkpoint."
                    : "")
            }
          />
          {git.truncated && (
            <div className="inline-note git-notice">
              <Info size={16} />
              <span>
                This is a bounded list of changes. More files may be changed
                than shown here.
              </span>
            </div>
          )}
          <div
            className="git-pane-tabs"
            role="tablist"
            aria-label="Change location"
          >
            {(["worktree", "staged"] as const).map((name) => (
              <button
                key={name}
                id={`${panelId}-${name}`}
                role="tab"
                aria-selected={pane === name}
                aria-controls={panelId}
                tabIndex={pane === name ? 0 : -1}
                className={pane === name ? "selected" : ""}
                onClick={() => changePane(name)}
                onKeyDown={(event) => {
                  if (
                    ["ArrowLeft", "ArrowRight", "Home", "End"].includes(
                      event.key,
                    )
                  ) {
                    event.preventDefault();
                    const next =
                      event.key === "Home"
                        ? "worktree"
                        : event.key === "End"
                          ? "staged"
                          : pane === "worktree"
                            ? "staged"
                            : "worktree";
                    changePane(next);
                    document.getElementById(`${panelId}-${next}`)?.focus();
                  }
                }}
              >
                {name === "worktree" ? "Worktree" : "Staged"}
                <span>{count(name)}</span>
              </button>
            ))}
            <p>
              {pane === "worktree"
                ? "Saved edits that have not been staged"
                : "Changes staged for the next commit"}
            </p>
          </div>
          <div
            id={panelId}
            role="tabpanel"
            aria-labelledby={`${panelId}-${pane}`}
          >
            {!visible.length ? (
              <Empty
                icon={<CheckCircle2 size={31} />}
                title={
                  git.entries.length
                    ? pane === "staged"
                      ? "Nothing staged"
                      : "No unstaged changes"
                    : "Your working tree is clean"
                }
              >
                {git.entries.length
                  ? pane === "staged"
                    ? "Stage files using your Git client when they are ready to commit."
                    : "Your saved changes are staged. Switch to Staged to review them."
                  : "There are no saved changes to review. New and modified files will appear here after a refresh."}
              </Empty>
            ) : (
              <div className="git-workspace">
                <nav
                  className="git-files"
                  aria-label={`${pane === "staged" ? "Staged" : "Worktree"} files`}
                >
                  {visible.map((entry) => {
                    const status = entryStatus(entry, pane);
                    const label = statusNames[status] || "Changed";
                    return (
                      <button
                        key={entry.path}
                        className={`git-file ${entry.path === path ? "selected" : ""}`}
                        aria-current={entry.path === path ? "true" : undefined}
                        onClick={() => setSelectedPath(entry.path)}
                      >
                        <span
                          className={`git-file-status git-status-${status === "?" ? "new" : status.toLowerCase()}`}
                          aria-label={label}
                        >
                          {status === "?" ? "U" : status}
                        </span>
                        <span>
                          <strong>{entry.path}</strong>
                          <small>
                            {label}
                            {entry.originalPath
                              ? ` · from ${entry.originalPath}`
                              : ""}
                          </small>
                        </span>
                      </button>
                    );
                  })}
                </nav>
                <div className="git-diff-panel" aria-busy={diffLoading}>
                  <div className="git-diff-heading">
                    <FileDiff size={16} />
                    <strong>{path}</strong>
                    <span>
                      {pane === "staged"
                        ? "Index vs HEAD"
                        : "Worktree vs index"}
                    </span>
                  </div>
                  {diffLoading ? (
                    <div className="git-loading" role="status">
                      <RefreshCw size={19} className="spin" /> Reading file
                      changes…
                    </div>
                  ) : diffError ? (
                    <p className="inline-error" role="alert">
                      {diffError}
                    </p>
                  ) : diff &&
                    diff.path === path &&
                    Boolean(diff.staged) === (pane === "staged") ? (
                    <>
                      {diff.untracked && (
                        <div className="inline-note git-notice">
                          <Info size={16} />
                          <span>
                            This new file is not tracked by Git. Its current
                            text is shown below; there is no earlier version to
                            compare.
                          </span>
                        </div>
                      )}
                      {diff.truncated && (
                        <div className="inline-note git-notice">
                          <Info size={16} />
                          <span>
                            This preview is truncated. Use your Git client or
                            editor to review the complete file.
                          </span>
                        </div>
                      )}
                      {diff.binary ? (
                        <Empty
                          icon={<FileDiff size={26} />}
                          title="No text preview"
                        >
                          This file is binary or is not eligible for a text
                          preview. Open it in a suitable application to review
                          it.
                        </Empty>
                      ) : diff.content ? (
                        <>
                          <p className="git-diff-legend">
                            {diff.untracked
                              ? "Current saved file contents"
                              : "+ added lines · − removed lines · unchanged lines provide context"}
                          </p>
                          <pre
                            className="git-diff"
                            tabIndex={0}
                            aria-label={`${diff.untracked ? "Contents" : "Diff"} of ${path}`}
                          >
                            <code>
                              {diff.untracked
                                ? diff.content
                                : diff.content
                                    .split("\n")
                                    .map((line, index, lines) => (
                                      <span
                                        className={lineClass(line)}
                                        key={index}
                                      >
                                        {line}
                                        {index < lines.length - 1 ? "\n" : ""}
                                      </span>
                                    ))}
                            </code>
                          </pre>
                        </>
                      ) : (
                        <Empty
                          icon={<CheckCircle2 size={26} />}
                          title="No text differences"
                        >
                          The file may have changed since the list was loaded,
                          or only its metadata changed. Refresh for the latest
                          state.
                        </Empty>
                      )}
                    </>
                  ) : null}
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </section>
  );
}
