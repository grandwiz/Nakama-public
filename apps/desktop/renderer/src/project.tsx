import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  Bot,
  Box,
  ChevronRight,
  Code2,
  File,
  FilePlus,
  FileText,
  Folder,
  FolderOpen,
  GitBranch,
  Play,
  RefreshCw,
  Rocket,
  Save,
  ShieldCheck,
  Square,
  Terminal,
  Trash2,
  Wrench,
} from "lucide-react";
import { api, openProjectFolder } from "./bridge";
import {
  Button,
  Empty,
  IconButton,
  Modal,
  SectionTitle,
  Status,
  relativeDate,
} from "./components";
import { useNakama } from "./context";
import type { FileEntry, Project, Task } from "./types";
import { DeploymentRequest } from "./services";
import { GitChanges } from "./git";
import { ProjectChecks } from "./checks";
import { ProjectReportsPanel } from "./project-reports";
import { createCheckReview } from "./check-review";
import { CheckRepairDialog, ProjectRepairs } from "./check-repair";
import {
  activeProjectRepair,
  eligibleRepairSource,
  repairFileRevision,
} from "./check-repair-model";

export function ProjectDetail({ project }: { project: Project }) {
  const { state, perform, notify, openAssistant, setNavigationGuard } =
    useNakama();
  const [tab, setTab] = useState<"files" | "git" | "tasks" | "reports">(
    "files",
  );
  const [directory, setDirectory] = useState("");
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [fileBusy, setFileBusy] = useState(false);
  const [fileFilter, setFileFilter] = useState("");
  const [folderTarget, setFolderTarget] = useState("");
  const [preview, setPreview] = useState<{
    path: string;
    fileName: string;
    mimeType: string;
    base64: string;
    bytes: number;
  }>();
  const directoryRequest = useRef(0);
  const fileRequest = useRef(0);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      directoryRequest.current++;
      fileRequest.current++;
    };
  }, []);
  const [filePath, setFilePath] = useState("");
  const [content, setContent] = useState("");
  const [savedContent, setSavedContent] = useState("");
  const [githubDraft, setGithubDraft] = useState(false);
  const [gitRevision, setGitRevision] = useState(0);
  const [openedGitRevision, setOpenedGitRevision] = useState(0);
  const [newFile, setNewFile] = useState(false);
  const [newPath, setNewPath] = useState("");
  const [command, setCommand] = useState("");
  const [args, setArgs] = useState("[]");
  const [deployment, setDeployment] = useState(false);
  const [fileError, setFileError] = useState("");
  const [blenderOpen, setBlenderOpen] = useState(false);
  const [scriptPath, setScriptPath] = useState("scene.py");
  const [blenderInstalled, setBlenderInstalled] = useState<boolean>();
  const [blenderBusy, setBlenderBusy] = useState(false);
  const [repairTaskId, setRepairTaskId] = useState<string>();
  const [repairUncertain, setRepairUncertain] = useState(false);
  const dirty = content !== savedContent;
  const activeRepair = activeProjectRepair(state.checkRepairs, project.id);
  const repairRevision = repairFileRevision(state.checkRepairs, project.id);
  const [openedRepairRevision, setOpenedRepairRevision] = useState("");
  const staleBuffer =
    Boolean(filePath) &&
    (openedRepairRevision !== repairRevision ||
      openedGitRevision !== gitRevision);
  const editorLocked = Boolean(activeRepair) || staleBuffer || fileBusy;
  const visibleEntries = entries.filter((entry) =>
    entry.name
      .toLocaleLowerCase()
      .includes(fileFilter.trim().toLocaleLowerCase()),
  );
  const tasks = state.tasks
    .filter((task) => task.projectId === project.id)
    .slice()
    .reverse();
  useEffect(() => {
    if (!blenderOpen) return;
    let cancelled = false;
    api<{ installed: boolean }>("GET", "/api/tools/blender")
      .then((result) => {
        if (!cancelled) setBlenderInstalled(result.installed);
      })
      .catch(() => {
        if (!cancelled) setBlenderInstalled(undefined);
      });
    return () => {
      cancelled = true;
    };
  }, [blenderOpen]);
  useEffect(() => {
    setNavigationGuard(
      dirty || githubDraft
        ? () =>
            window.confirm(
              dirty
                ? "Discard the unsaved changes in this file?"
                : "Leave this Git operation or discard your unsaved Git form?",
            )
        : null,
    );
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (dirty || githubDraft) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => {
      setNavigationGuard(null);
      window.removeEventListener("beforeunload", beforeUnload);
    };
  }, [dirty, githubDraft, setNavigationGuard]);
  const loadFiles = async (path: string) => {
    const request = ++directoryRequest.current;
    setLoading(true);
    setFileError("");
    try {
      const result = await api<{ entries: FileEntry[] }>(
        "GET",
        `/api/projects/${project.id}/files?path=${encodeURIComponent(path)}`,
      );
      if (request !== directoryRequest.current || !mounted.current) return;
      setEntries(result.entries);
      setDirectory(path);
      setFolderTarget(path);
      setFileFilter("");
    } catch (reason) {
      if (request !== directoryRequest.current || !mounted.current) return;
      setFileError(
        reason instanceof Error
          ? reason.message
          : "Unable to read project files.",
      );
    } finally {
      if (request === directoryRequest.current && mounted.current)
        setLoading(false);
    }
  };
  useEffect(() => {
    void loadFiles("");
  }, [project.id]);
  const openFile = async (entry: FileEntry) => {
    if (entry.type === "directory" || entry.isDirectory) {
      void loadFiles(entry.path);
      return;
    }
    if (dirty && !window.confirm("Discard the unsaved changes in this file?"))
      return;
    const request = ++fileRequest.current;
    setFileBusy(true);
    try {
      if (/\.(png|jpe?g|pdf)$/i.test(entry.path)) {
        const result = await api<{
          path: string;
          fileName: string;
          mimeType: string;
          base64: string;
          bytes: number;
        }>(
          "GET",
          `/api/projects/${project.id}/file-preview?path=${encodeURIComponent(entry.path)}`,
        );
        if (request !== fileRequest.current || !mounted.current) return;
        setPreview(result);
        setFilePath("");
        setContent("");
        setSavedContent("");
        return;
      }
      const result = await api<{ path: string; content: string }>(
        "GET",
        `/api/projects/${project.id}/file?path=${encodeURIComponent(entry.path)}`,
      );
      if (request !== fileRequest.current || !mounted.current) return;
      setPreview(undefined);
      setContent(result.content);
      setSavedContent(result.content);
      setFilePath(result.path || entry.path);
      setOpenedRepairRevision(repairRevision);
      setOpenedGitRevision(gitRevision);
    } catch (reason) {
      if (request !== fileRequest.current || !mounted.current) return;
      notify(
        reason instanceof Error ? reason.message : "Could not open this file.",
        true,
      );
    } finally {
      if (request === fileRequest.current && mounted.current)
        setFileBusy(false);
    }
  };
  const save = async () => {
    if (editorLocked) {
      notify(
        "Project activity changed this file's context. Wait for it to settle, then reload this file before saving.",
        true,
      );
      return;
    }
    const request = fileRequest.current;
    const result = await perform(
      "PUT",
      `/api/projects/${project.id}/file`,
      { path: filePath, content },
      "File saved.",
    );
    if (result && request === fileRequest.current && mounted.current) {
      setSavedContent(content);
      void loadFiles(directory);
    }
  };
  const submitCommand = async (event: React.FormEvent) => {
    event.preventDefault();
    let parsed: unknown;
    try {
      parsed = JSON.parse(args);
    } catch {
      notify(
        'Arguments must be a JSON array, for example ["--version"].',
        true,
      );
      return;
    }
    if (
      !Array.isArray(parsed) ||
      parsed.some((item) => typeof item !== "string")
    ) {
      notify("Every argument must be a string inside a JSON array.", true);
      return;
    }
    const result = await perform(
      "POST",
      "/api/commands",
      { projectId: project.id, command: command.trim(), args: parsed },
      "Command sent for approval. Review it in Activity & approvals.",
    );
    if (result) {
      setCommand("");
      setArgs("[]");
    }
  };
  return (
    <div className="page-enter">
      <SectionTitle
        eyebrow="PROJECT WORKSPACE"
        title={project.name}
        description={
          project.description ||
          "Your idea has a home. Let’s make something of it."
        }
        action={
          <div className="button-row">
            <Button
              kind="secondary"
              onClick={() =>
                void openProjectFolder(project.id).catch((reason) =>
                  notify(
                    reason instanceof Error
                      ? reason.message
                      : "Could not open the project folder.",
                    true,
                  ),
                )
              }
            >
              <FolderOpen size={16} />
              Open folder
            </Button>
            <Button kind="secondary" onClick={() => setDeployment(true)}>
              <Rocket size={16} />
              Deploy
            </Button>
            <Button onClick={() => openAssistant(project.id)}>
              <Bot size={17} />
              Open assistant
            </Button>
          </div>
        }
      />
      <div className="project-meta-bar">
        <span>
          <FolderOpen size={15} />
          {project.path}
        </span>
        <Status value={project.status} />
        <button
          className="danger-link"
          onClick={() =>
            void perform(
              "POST",
              `/api/projects/${project.id}/delete-request`,
              {},
              "Deletion requested. Files remain until you approve the exact action.",
            )
          }
        >
          <Trash2 size={14} />
          Request deletion
        </button>
      </div>
      <div className="tabs">
        <button
          className={tab === "files" ? "selected" : ""}
          onClick={() => {
            if (
              !githubDraft ||
              window.confirm(
                "Leave this Git operation or discard your unsaved Git form?",
              )
            )
              setTab("files");
          }}
        >
          <Code2 size={16} />
          Files & editor
        </button>
        <button
          className={tab === "git" ? "selected" : ""}
          onClick={() => setTab("git")}
        >
          <GitBranch size={16} />
          Git changes
        </button>
        <button
          className={tab === "tasks" ? "selected" : ""}
          onClick={() => {
            if (
              !githubDraft ||
              window.confirm(
                "Leave this Git operation or discard your unsaved Git form?",
              )
            )
              setTab("tasks");
          }}
        >
          <Terminal size={16} />
          Tasks & commands<span>{tasks.length}</span>
        </button>
        <button
          className={tab === "reports" ? "selected" : ""}
          onClick={() => {
            if (
              !githubDraft ||
              window.confirm(
                "Leave this Git operation or discard your unsaved Git form?",
              )
            )
              setTab("reports");
          }}
        >
          <FileText size={16} />
          Reports
        </button>
      </div>
      {tab === "files" ? (
        <section className="file-workspace">
          <aside className="file-browser">
            <div className="file-browser-header">
              <strong>PROJECT FILES</strong>
              <div>
                <IconButton
                  label="New text file"
                  disabled={Boolean(activeRepair)}
                  onClick={() => {
                    setNewPath(directory ? directory + "/" : "");
                    setNewFile(true);
                  }}
                >
                  <FilePlus size={16} />
                </IconButton>
                <IconButton
                  label="Refresh files"
                  onClick={() => void loadFiles(directory)}
                >
                  <RefreshCw size={15} className={loading ? "spin" : ""} />
                </IconButton>
              </div>
            </div>
            <nav className="file-breadcrumbs" aria-label="Project folder path">
              <button onClick={() => void loadFiles("")}>{project.name}</button>
              {directory
                .split("/")
                .filter(Boolean)
                .map((part, index, parts) => (
                  <span key={index}>
                    <ChevronRight size={11} />
                    <button
                      onClick={() =>
                        void loadFiles(parts.slice(0, index + 1).join("/"))
                      }
                    >
                      {part}
                    </button>
                  </span>
                ))}
            </nav>
            <div className="file-search">
              <label className="sr-only" htmlFor="project-file-filter">
                Find a file in this folder
              </label>
              <input
                id="project-file-filter"
                value={fileFilter}
                onChange={(event) => setFileFilter(event.target.value)}
                placeholder="Find in this folder…"
              />
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  void loadFiles(folderTarget.trim().replaceAll("\\", "/"));
                }}
              >
                <label className="sr-only" htmlFor="project-folder-target">
                  Relative folder path
                </label>
                <input
                  id="project-folder-target"
                  value={folderTarget}
                  onChange={(event) => setFolderTarget(event.target.value)}
                  placeholder="Folder path, e.g. src/ui"
                />
                <Button type="submit" kind="secondary">
                  Go
                </Button>
              </form>
            </div>
            {directory && (
              <button
                className="file-entry"
                onClick={() =>
                  void loadFiles(directory.split("/").slice(0, -1).join("/"))
                }
              >
                <ArrowLeft size={15} />
                Parent folder
              </button>
            )}
            {fileError ? (
              <p className="inline-error">{fileError}</p>
            ) : visibleEntries.length ? (
              visibleEntries.map((entry) => (
                <button
                  key={entry.path}
                  onClick={() => void openFile(entry)}
                  className={`file-entry ${filePath === entry.path ? "selected" : ""}`}
                >
                  {entry.type === "directory" || entry.isDirectory ? (
                    <Folder size={16} />
                  ) : (
                    <File size={16} />
                  )}
                  <span>{entry.name}</span>
                  {(entry.type === "directory" || entry.isDirectory) && (
                    <ChevronRight size={13} />
                  )}
                </button>
              ))
            ) : (
              <div className="folder-empty">
                {loading
                  ? "Reading files…"
                  : fileFilter
                    ? "No matching files in this folder."
                    : "This folder is empty."}
              </div>
            )}
          </aside>
          <div className="file-editor">
            {preview ? (
              <>
                <div className="editor-header">
                  <span>
                    <FileText size={15} />
                    {preview.path}
                  </span>
                  <span>{Math.ceil(preview.bytes / 1024)} KB · read-only</span>
                </div>
                {preview.mimeType.startsWith("image/") ? (
                  <img
                    className="file-preview-image"
                    src={`data:${preview.mimeType};base64,${preview.base64}`}
                    alt={preview.fileName}
                  />
                ) : (
                  <div className="file-preview-placeholder">
                    <h3>{preview.fileName}</h3>
                    <p>
                      PDF selected. Use Open folder to view this project file
                      with your PDF reader. Generated Nakama reports have their
                      own Open PDF and Save a copy controls in Reports.
                    </p>
                    <Button
                      kind="secondary"
                      onClick={() =>
                        void openProjectFolder(project.id).catch((reason) =>
                          notify(reason.message, true),
                        )
                      }
                    >
                      Open project folder
                    </Button>
                  </div>
                )}
              </>
            ) : filePath ? (
              <>
                <div className="editor-header">
                  <span>
                    <File size={15} />
                    {filePath}
                    {dirty && <i title="Unsaved changes" />}
                  </span>
                  <Button
                    kind="secondary"
                    disabled={!dirty || editorLocked}
                    onClick={() => void save()}
                  >
                    <Save size={14} />
                    Save file
                  </Button>
                </div>
                {editorLocked && (
                  <div className="inline-note editor-repair-note">
                    <ShieldCheck size={17} />
                    <span>
                      {fileBusy
                        ? "Opening the requested file…"
                        : activeRepair
                          ? "A repair has reserved this project. The open buffer is read-only while it works."
                          : "Project activity changed this project. This buffer may be out of date. Reload the file before editing or saving."}
                      {dirty &&
                        " Your unsaved text is still here; reloading asks before discarding it."}
                    </span>
                    <Button
                      kind="secondary"
                      disabled={Boolean(activeRepair)}
                      onClick={() =>
                        void openFile({
                          name: filePath,
                          path: filePath,
                          type: "file",
                        })
                      }
                    >
                      <RefreshCw size={14} />
                      Reload file
                    </Button>
                  </div>
                )}
                <textarea
                  className="code-editor"
                  aria-label={`Edit ${filePath}`}
                  spellCheck={false}
                  value={content}
                  readOnly={editorLocked}
                  onChange={(event) => setContent(event.target.value)}
                  onKeyDown={(event) => {
                    if ((event.ctrlKey || event.metaKey) && event.key === "s") {
                      event.preventDefault();
                      void save();
                    }
                  }}
                />
                <div className="editor-footer">
                  <span>Plain text editor</span>
                  <span>
                    {content.split("\n").length} lines ·{" "}
                    {staleBuffer
                      ? "Reload required"
                      : activeRepair
                        ? "Read-only during repair"
                        : dirty
                          ? "Unsaved changes"
                          : "Saved"}
                  </span>
                </div>
              </>
            ) : (
              <Empty icon={<Code2 size={35} />} title="A space to build">
                Open a text file from the sidebar, or create your first file.
              </Empty>
            )}
          </div>
        </section>
      ) : tab === "reports" ? (
        <ProjectReportsPanel key={project.id} projectId={project.id} />
      ) : tab === "git" ? (
        <GitChanges
          project={project}
          hasUnsavedChanges={dirty}
          onDraftChange={setGithubDraft}
          onRepositoryChanged={() => {
            setGitRevision((value) => value + 1);
            void loadFiles(directory);
          }}
          checkpointBlockedReason={
            activeRepair
              ? "Wait for the active repair to finish before creating a checkpoint."
              : staleBuffer
                ? "Reload the open editor file after project changes before creating a checkpoint or Git operation."
                : ""
          }
        />
      ) : (
        <div className="task-workspace">
          <ProjectChecks project={project} hasUnsavedChanges={dirty} />
          <ProjectRepairs
            project={project}
            uncertain={repairUncertain}
            onClearReminder={() => setRepairUncertain(false)}
          />
          <section className="panel blender-panel">
            <span className="blender-icon">
              <Box size={29} />
            </span>
            <div>
              <h3>Bring an idea into Blender</h3>
              <p>
                Ask your AI to write a scene script in Build mode, review the
                saved file, then run it on this PC. You approve the exact script
                before Blender starts.
              </p>
            </div>
            <Button
              kind="secondary"
              onClick={() => {
                setScriptPath(filePath.endsWith(".py") ? filePath : "scene.py");
                setBlenderOpen(true);
              }}
            >
              <Box size={16} />
              Run Blender script
            </Button>
          </section>
          <section className="panel">
            <SectionTitle
              title="Run a command"
              description="Commands run inside this project after you approve the exact command and arguments."
            />
            <form
              className="command-form"
              onSubmit={(event) => void submitCommand(event)}
            >
              <label className="field">
                Executable
                <input
                  required
                  value={command}
                  onChange={(event) => setCommand(event.target.value)}
                  placeholder="e.g. git, node, python"
                />
              </label>
              <label className="field">
                Arguments · JSON array
                <input
                  required
                  value={args}
                  onChange={(event) => setArgs(event.target.value)}
                  placeholder={'["--version"]'}
                />
              </label>
              <Button type="submit" disabled={!command.trim()}>
                <Play size={15} />
                Request command
              </Button>
            </form>
            <div className="inline-note compact">
              <ShieldCheck size={16} />
              <span>
                Raw commands can change files or deploy software. Each command
                request needs approval.
              </span>
            </div>
          </section>
          <section className="panel">
            <SectionTitle
              title="Project activity"
              description="AI output and command results from this project."
            />
            {tasks.length ? (
              <div className="task-list">
                {tasks.map((task) => (
                  <article className="task-card" key={task.id}>
                    <div className="task-card-header">
                      <span className="task-icon">
                        <Terminal size={18} />
                      </span>
                      <div>
                        <h3>{task.title}</h3>
                        <small>
                          {task.providerId} · {relativeDate(task.createdAt)}
                        </small>
                      </div>
                      <Status value={task.status} />
                      {["running", "queued"].includes(task.status) && (
                        <Button
                          kind="ghost"
                          onClick={() =>
                            void perform("POST", `/api/tasks/${task.id}/stop`)
                          }
                        >
                          <Square size={13} />
                          Stop
                        </Button>
                      )}
                    </div>
                    {task.output && (
                      <pre className="task-output">{task.output}</pre>
                    )}
                    {task.error && <p className="inline-error">{task.error}</p>}
                    {task.exitCode !== undefined && task.exitCode !== null && (
                      <p className="task-exit-code">
                        Exit code: {task.exitCode}
                      </p>
                    )}
                    {task.signal && (
                      <p className="task-exit-code">
                        Stopped by signal: {task.signal}
                      </p>
                    )}
                    <CheckReviewButton project={project} task={task} />
                    {eligibleRepairSource(project, task) && (
                      <div className="check-repair-action">
                        <Button
                          kind="secondary"
                          disabled={
                            dirty || Boolean(activeRepair) || repairUncertain
                          }
                          onClick={() => setRepairTaskId(task.id)}
                        >
                          <Wrench size={15} />
                          Repair this failed check
                        </Button>
                        <small>
                          {dirty
                            ? "Save your editor changes before repairing."
                            : activeRepair
                              ? "A repair is already active in this project."
                              : repairUncertain
                                ? "Check the unconfirmed request in Check repairs first."
                                : "Choose an AI for one file-repair attempt. Rerunning still needs approval."}
                        </small>
                      </div>
                    )}
                  </article>
                ))}
              </div>
            ) : (
              <Empty icon={<Terminal size={27} />} title="A quiet console">
                Your AI runs and command results will appear here.
              </Empty>
            )}
          </section>
        </div>
      )}
      {newFile && (
        <Modal
          title="Create a text file"
          description="Use a path relative to this project, such as src/hello.txt."
          onClose={() => setNewFile(false)}
        >
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (
                dirty &&
                !window.confirm("Discard the unsaved changes in this file?")
              )
                return;
              setFilePath(newPath);
              setOpenedRepairRevision(repairRevision);
              setContent("");
              setSavedContent("\u0000");
              setNewFile(false);
            }}
          >
            <label className="field">
              File path
              <input
                autoFocus
                required
                value={newPath}
                onChange={(event) => setNewPath(event.target.value)}
                placeholder="README.md"
              />
            </label>
            <div className="modal-actions">
              <Button
                kind="secondary"
                type="button"
                onClick={() => setNewFile(false)}
              >
                Cancel
              </Button>
              <Button type="submit">Open in editor</Button>
            </div>
          </form>
        </Modal>
      )}
      {repairTaskId && (
        <CheckRepairDialog
          project={project}
          sourceTaskId={repairTaskId}
          hasUnsavedChanges={dirty}
          onClose={() => setRepairTaskId(undefined)}
          onUncertain={() => setRepairUncertain(true)}
        />
      )}
      {blenderOpen && (
        <Modal
          title="Run a Blender scene script"
          description="The script must be a Python file saved inside this project. Nakama shows it for your approval before running Blender."
          onClose={() => setBlenderOpen(false)}
        >
          <form
            onSubmit={(event) => {
              event.preventDefault();
              setBlenderBusy(true);
              void perform(
                "POST",
                "/api/tools/blender/run-request",
                { projectId: project.id, scriptPath: scriptPath.trim() },
                "Blender script sent for approval. Review it in Activity & approvals.",
              )
                .then((result) => {
                  if (result) setBlenderOpen(false);
                })
                .finally(() => setBlenderBusy(false));
            }}
          >
            <label className="field">
              Python script path
              <input
                autoFocus
                required
                value={scriptPath}
                onChange={(event) => setScriptPath(event.target.value)}
                placeholder="scene.py"
              />
              <small>
                Relative to {project.name}. Save all editor changes first.
              </small>
            </label>
            <div className="inline-note">
              <Box size={17} />
              <span>
                {blenderInstalled === true
                  ? "Blender was found on this PC."
                  : blenderInstalled === false
                    ? "Blender was not found. Install Blender before requesting a run."
                    : "The host will check for Blender when processing this request."}{" "}
                Scripts run under your Windows account and can access its files.
                Review the complete script before approving it.
              </span>
            </div>
            <div className="modal-actions">
              <Button
                kind="secondary"
                type="button"
                onClick={() => setBlenderOpen(false)}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                busy={blenderBusy}
                disabled={
                  !scriptPath.trim() || dirty || blenderInstalled === false
                }
              >
                Request approval
              </Button>
            </div>
          </form>
        </Modal>
      )}
      {deployment && (
        <DeploymentRequest
          initialProjectId={project.id}
          onClose={() => setDeployment(false)}
        />
      )}
    </div>
  );
}

function CheckReviewButton({
  project,
  task,
}: {
  project: Project;
  task: Task;
}) {
  const { state, openAssistant } = useNakama();
  const draft = useMemo(
    () => createCheckReview(project, task),
    [project, task],
  );
  if (!draft || !state.projects.some((item) => item.id === project.id))
    return null;
  return (
    <div className="check-review-action">
      <Button kind="secondary" onClick={() => openAssistant(project.id, draft)}>
        <Bot size={15} />
        Review this check
      </Button>
      <small>Prepare an editable AI draft. You choose when to send it.</small>
    </div>
  );
}
