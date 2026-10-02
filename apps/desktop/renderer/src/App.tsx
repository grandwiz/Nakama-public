import { useCallback, useEffect, useRef, useState } from "react";
import {
  Activity,
  ArrowRight,
  Bell,
  Bot,
  BookOpen,
  Building2,
  Check,
  ChevronLeft,
  CircleHelp,
  ClipboardList,
  Clock3,
  Folder,
  FolderOpen,
  Gauge,
  Globe,
  Home,
  Heart,
  LayoutGrid,
  Link2,
  Loader2,
  MessageCircle,
  Moon,
  Plus,
  Search,
  Settings,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Sun,
  X,
} from "lucide-react";
import { api, chooseFolder, previewMode, subscribe } from "./bridge";
import {
  Button,
  Empty,
  IconButton,
  Mascot,
  Modal,
  SectionTitle,
  Status,
  TextLink,
  relativeDate,
} from "./components";
import { Context, useNakama } from "./context";
import type { AppState, Page, Project } from "./types";
import { AssistantPage, AgentsPage } from "./assistant";
import {
  ActivityPage,
  ConnectionsPage,
  DevicesPage,
  SettingsPage,
} from "./settings";
import { ProjectDetail } from "./project";
import type { CheckReviewDraft } from "./check-review";
import { UsagePanel } from "./usage";
import { BoardsPage } from "./boards";
import { AgentOfficePage } from "./agent-office";
import { CompanionMemorySettings } from "./companion-memory";
import { LearnedSkillsPage } from "./learned-skills";
import { GitHubImport } from "./github-projects";
import { ProjectDeliveryPage } from "./project-delivery";
import { ProjectSetupPage } from "./project-setup";
import { BrowserStudioPage } from "./browser-studio";
import { ClockPage } from "./clock";
import { MonitoringPage } from "./monitoring";
import { SelfMaintenancePanel } from "./self-maintenance";
import { navigationOutcome } from "./agent-office-model";

const pages: { id: Page; label: string; icon: typeof Home; group: string }[] = [
  { id: "home", label: "Overview", icon: Home, group: "Workspace" },
  { id: "projects", label: "Projects", icon: LayoutGrid, group: "Workspace" },
  {
    id: "boards",
    label: "My clipboard",
    icon: ClipboardList,
    group: "Workspace",
  },
  {
    id: "assistant",
    label: "Assistant",
    icon: MessageCircle,
    group: "Workspace",
  },
  { id: "agents", label: "AI team", icon: Bot, group: "Workspace" },
  {
    id: "agent-office",
    label: "Agent office",
    icon: Building2,
    group: "Workspace",
  },
  { id: "usage", label: "AI usage", icon: Gauge, group: "Workspace" },
  { id: "core-memory", label: "Core Memory", icon: Heart, group: "Workspace" },
  { id: "skills", label: "Learned skills", icon: BookOpen, group: "Workspace" },
  {
    id: "project-setup",
    label: "Project setup",
    icon: ClipboardList,
    group: "Workspace",
  },
  { id: "delivery", label: "Delivery", icon: ShieldCheck, group: "Workspace" },
  { id: "browser", label: "Nakama browser", icon: Globe, group: "Workspace" },
  { id: "clock", label: "Clock", icon: Clock3, group: "Workspace" },
  { id: "monitoring", label: "Monitoring", icon: Bell, group: "Workspace" },
  {
    id: "self-maintenance",
    label: "Dynamic upgrade",
    icon: Sparkles,
    group: "Control center",
  },
  {
    id: "devices",
    label: "Devices",
    icon: Smartphone,
    group: "Control center",
  },
  {
    id: "connections",
    label: "Connections",
    icon: Link2,
    group: "Control center",
  },
  {
    id: "activity",
    label: "Activity & approvals",
    icon: Activity,
    group: "Control center",
  },
  {
    id: "settings",
    label: "Settings",
    icon: Settings,
    group: "Control center",
  },
];
function SelfMaintenancePage() {
  const onDirty = useCallback((_value: boolean) => {}, []);
  return (
    <div className="monitoring-page">
      <SectionTitle
        eyebrow="Carefully improving together"
        title="Dynamic upgrade"
        description="Prepare improvements separately, review the evidence, and choose when to update."
      />
      <SelfMaintenancePanel onDirty={onDirty} />
    </div>
  );
}
export function App() {
  const [state, setState] = useState<AppState>();
  const [page, setPage] = useState<Page>("home");
  const [projectId, setProjectId] = useState<string>();
  const [query, setQuery] = useState("");
  const [assistantProjectId, setAssistantProjectId] = useState<string>();
  const [assistantDraft, setAssistantDraft] = useState<CheckReviewDraft>();
  const [assistantSession, setAssistantSession] = useState(0);
  const [focusedApprovalId, setFocusedApprovalId] = useState<string>();
  const [focusedBrowserSessionId, setFocusedBrowserSessionId] =
    useState<string>();
  const attentionSequence = useRef(0);
  const navigationGuard = useRef<(() => boolean) | null>(null);
  const [error, setError] = useState("");
  const [toast, setToast] = useState<{ message: string; error: boolean }>();
  const [createOpen, setCreateOpen] = useState(false);
  const [theme, setTheme] = useState(
    () => localStorage.getItem("nakama-theme") || "light",
  );
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const refresh = useCallback(async () => {
    try {
      const next = await api<AppState>("GET", "/api/state");
      setState(next);
      setError("");
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Could not connect to the host.",
      );
    }
  }, []);
  useEffect(() => {
    void refresh();
    const unsubscribe = subscribe(() => {
      void refresh();
    });
    const interval = setInterval(() => {
      void refresh();
    }, 6000);
    return () => {
      unsubscribe();
      clearInterval(interval);
    };
  }, [refresh]);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("nakama-theme", theme);
  }, [theme]);
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "auto" });
  }, [page, projectId]);
  useEffect(() => () => clearTimeout(toastTimer.current), []);
  const notify = useCallback((message: string, isError = false) => {
    clearTimeout(toastTimer.current);
    setToast({ message, error: isError });
    toastTimer.current = setTimeout(
      () => setToast(undefined),
      isError ? 10000 : 4500,
    );
  }, []);
  const perform = useCallback(
    async <T,>(
      method: string,
      path: string,
      body?: unknown,
      success?: string,
    ): Promise<T | undefined> => {
      try {
        const result = await api<T>(method, path, body);
        await refresh();
        if (success) notify(success);
        return result;
      } catch (reason) {
        notify(
          reason instanceof Error
            ? reason.message
            : "Something went wrong. Please try again.",
          true,
        );
        return undefined;
      }
    },
    [refresh, notify],
  );
  const navigate = useCallback(
    (next: Page, options?: { browserSessionId?: string }) => {
      if (navigationGuard.current && !navigationGuard.current()) return;
      attentionSequence.current++;
      setFocusedBrowserSessionId(
        next === "browser" ? options?.browserSessionId : undefined,
      );
      setAssistantProjectId(undefined);
      setAssistantDraft(undefined);
      setFocusedApprovalId(undefined);
      setAssistantSession((current) => current + 1);
      setPage(next);
      setProjectId(undefined);
      setQuery("");
    },
    [],
  );
  useEffect(() => {
    if (!window.nakama) return;
    return window.nakama.onEvent((event: unknown) => {
      const notice = event as { type?: string; attentionId?: string };
      if (
        notice?.type !== "attention.open" ||
        typeof notice.attentionId !== "string"
      )
        return;
      const token = ++attentionSequence.current;
      void api<{ outcome: unknown }>("POST", "/api/attention/open", {
        id: notice.attentionId,
      })
        .then((result) => {
          if (token !== attentionSequence.current) return;
          const destination = navigationOutcome(result.outcome, []);
          if (destination)
            navigate(destination.target, {
              browserSessionId: destination.browserSessionId,
            });
        })
        .catch((error) => {
          if (token === attentionSequence.current)
            notify(
              error instanceof Error
                ? error.message
                : "That attention request is no longer available.",
              true,
            );
        });
    });
  }, [navigate, notify]);
  const openProject = useCallback((id: string) => {
    if (navigationGuard.current && !navigationGuard.current()) return;
    attentionSequence.current++;
    setAssistantDraft(undefined);
    setProjectId(id);
    setPage("projects");
  }, []);
  const openApproval = useCallback((id: string) => {
    if (navigationGuard.current && !navigationGuard.current()) return;
    attentionSequence.current++;
    setFocusedApprovalId(id);
    setAssistantDraft(undefined);
    setProjectId(undefined);
    setPage("activity");
  }, []);
  const openAssistant = useCallback((id: string, draft?: CheckReviewDraft) => {
    if (draft && draft.projectId !== id) return;
    if (navigationGuard.current && !navigationGuard.current()) return;
    attentionSequence.current++;
    setAssistantProjectId(id);
    setAssistantDraft(draft);
    setAssistantSession((current) => current + 1);
    setPage("assistant");
    setProjectId(undefined);
  }, []);
  const consumeAssistantDraft = useCallback(() => {
    setAssistantDraft(undefined);
  }, []);
  const setNavigationGuard = useCallback((guard: (() => boolean) | null) => {
    navigationGuard.current = guard;
  }, []);
  const approvals =
    state?.approvals.filter((item) => item.status === "pending").length || 0;
  const project = state?.projects.find((item) => item.id === projectId);
  if (!state)
    return (
      <main className="startup">
        <Mascot size={120} />
        <h1>Nakama</h1>
        <p>{error || "Waking up your workspace…"}</p>
        {error ? (
          <Button onClick={() => void refresh()}>Try again</Button>
        ) : (
          <Loader2 className="spin" size={20} />
        )}
      </main>
    );
  return (
    <Context.Provider
      value={{
        state,
        refresh,
        perform,
        notify,
        navigate,
        openProject,
        openApproval,
        openAssistant,
        setNavigationGuard,
        createProject: () => setCreateOpen(true),
      }}
    >
      <div className="app-shell">
        <aside className="sidebar">
          <button
            className="brand"
            onClick={() => navigate("home")}
            aria-label="Nakama overview"
          >
            <span className="brand-mark">
              <Mascot size={42} />
            </span>
            <span>
              Nakama<small>CONTROL CENTER</small>
            </span>
          </button>
          <div className="workspace-chip">
            <span className="workspace-letter">N</span>
            <div>
              <strong>Your workspace</strong>
              <small>
                {previewMode ? "Browser preview" : "Personal · Windows host"}
              </small>
            </div>
            <ShieldCheck size={16} />
          </div>
          <nav aria-label="Main navigation">
            {["Workspace", "Control center"].map((group) => (
              <div className="nav-group" key={group}>
                <span className="nav-label">{group}</span>
                {pages
                  .filter((item) => item.group === group)
                  .map((item) => (
                    <button
                      key={item.id}
                      className={`nav-item ${page === item.id || (page === "routines" && item.id === "boards") ? "selected" : ""}`}
                      onClick={() => navigate(item.id)}
                      aria-current={
                        page === item.id ||
                        (page === "routines" && item.id === "boards")
                          ? "page"
                          : undefined
                      }
                    >
                      <item.icon size={19} />
                      <span>{item.label}</span>
                      {item.id === "activity" && approvals > 0 && (
                        <span className="count-badge">{approvals}</span>
                      )}
                    </button>
                  ))}
              </div>
            ))}
          </nav>
          <div className="sidebar-bottom">
            <div className="companion-note">
              <Mascot size={64} />
              <div>
                <strong>A little help. A lot possible.</strong>
                <p>Your ideas, with a team behind them.</p>
              </div>
            </div>
            <button
              className="help-button"
              onClick={() => {
                navigate("settings");
              }}
            >
              <CircleHelp size={18} />
              <span>Setup & help</span>
              <ArrowRight size={15} />
            </button>
            <div className="host-status">
              <span className={`connection-dot ${error ? "offline" : ""}`} />
              <span>
                {error
                  ? "Host unavailable"
                  : previewMode
                    ? "Preview · no device access"
                    : "Connected to Windows host"}
              </span>
            </div>
          </div>
        </aside>
        <div className="main-shell">
          <header className="topbar">
            <div className="breadcrumb">
              <span>Personal workspace</span>
              <span>/</span>
              <strong>
                {project?.name ||
                  (page === "routines"
                    ? "Routines board"
                    : pages.find((item) => item.id === page)?.label)}
              </strong>
            </div>
            <div className="topbar-actions">
              <label className="search-box">
                <Search size={16} />
                <input
                  value={query}
                  placeholder="Find a project…"
                  aria-label="Find a project"
                  onChange={(event) => {
                    if (navigationGuard.current && !navigationGuard.current())
                      return;
                    setQuery(event.target.value);
                    setPage("projects");
                    setProjectId(undefined);
                  }}
                />
                <kbd>⌕</kbd>
              </label>
              <IconButton
                label={
                  theme === "light"
                    ? "Switch to dark theme"
                    : "Switch to light theme"
                }
                onClick={() => setTheme(theme === "light" ? "dark" : "light")}
              >
                {theme === "light" ? <Moon size={18} /> : <Sun size={18} />}
              </IconButton>
              <IconButton
                label={`Approvals, ${approvals} waiting`}
                onClick={() => navigate("activity")}
                className="notification-button"
              >
                <Bell size={19} />
                {approvals > 0 && <i />}
              </IconButton>
              <span className="avatar" title="Personal workspace">
                N
              </span>
            </div>
          </header>
          {previewMode && (
            <div className="preview-banner">
              <Sparkles size={14} />
              <span>
                <strong>Design preview.</strong> Projects and preferences stay
                in this browser. Open the Windows app to use AI, files,
                accounts, and devices.
              </span>
            </div>
          )}
          {error && (
            <div className="connection-banner" role="alert">
              {error}
              <button onClick={() => void refresh()}>Reconnect</button>
            </div>
          )}
          <main className="content" id="main-content">
            {page === "home" && <Overview />}
            {page === "projects" &&
              (project ? (
                <>
                  <button
                    className="back-link"
                    onClick={() => {
                      if (!navigationGuard.current || navigationGuard.current())
                        setProjectId(undefined);
                    }}
                  >
                    <ChevronLeft size={16} />
                    All projects
                  </button>
                  <ProjectDetail key={project.id} project={project} />
                </>
              ) : (
                <Projects query={query} />
              ))}
            {page === "assistant" && (
              <AssistantPage
                key={`${assistantProjectId || "general"}:${assistantSession}`}
                initialProjectId={assistantProjectId}
                initialReview={assistantDraft}
                onReviewConsumed={consumeAssistantDraft}
              />
            )}
            {page === "agents" && <AgentsPage />}
            {page === "agent-office" && <AgentOfficePage />}
            {(page === "boards" || page === "routines") && (
              <BoardsPage
                key={page}
                initialTab={page === "routines" ? "routines" : "tasks"}
              />
            )}
            {page === "core-memory" && (
              <div className="page-enter">
                <SectionTitle
                  eyebrow="GROWING TOGETHER"
                  title="Core Memory"
                  description="The things you share that help Nakama feel like your companion."
                />
                <CompanionMemorySettings showMemoryControl />
              </div>
            )}
            {page === "usage" && <UsagePanel />}
            {page === "skills" && <LearnedSkillsPage />}
            {page === "project-setup" && <ProjectSetupPage />}
            {page === "delivery" && <ProjectDeliveryPage />}
            {page === "browser" && (
              <BrowserStudioPage initialSessionId={focusedBrowserSessionId} />
            )}
            {page === "clock" && <ClockPage />}
            {page === "monitoring" && <MonitoringPage />}
            {page === "self-maintenance" && <SelfMaintenancePage />}
            {page === "devices" && <DevicesPage />}
            {page === "connections" && <ConnectionsPage />}
            {page === "activity" && (
              <ActivityPage focusedApprovalId={focusedApprovalId} />
            )}
            {page === "settings" && <SettingsPage />}
          </main>
          <footer className="app-footer">
            <span>Nakama · your personal AI workspace</span>
            <span>
              <ShieldCheck size={12} /> Local first. Yours to control.
            </span>
          </footer>
        </div>
        {createOpen && <CreateProject onClose={() => setCreateOpen(false)} />}
        {toast && (
          <div
            className={`toast ${toast.error ? "error" : ""}`}
            role={toast.error ? "alert" : "status"}
          >
            {toast.error ? <CircleHelp size={19} /> : <Check size={19} />}
            <span>{toast.message}</span>
            <IconButton
              label="Dismiss notification"
              onClick={() => setToast(undefined)}
            >
              <X size={16} />
            </IconButton>
          </div>
        )}
      </div>
    </Context.Provider>
  );
}

function Overview() {
  const { state, navigate, createProject, perform } = useNakama();
  const ready = state.providers.filter((item) =>
    ["connected", "ready", "verified"].includes(item.status),
  ).length;
  const running = state.tasks.filter(
    (item) => item.status === "running",
  ).length;
  const pending = state.approvals.filter(
    (item) => item.status === "pending",
  ).length;
  const recent = [...state.projects]
    .sort((a, b) => +new Date(b.updatedAt) - +new Date(a.updatedAt))
    .slice(0, 3);
  const setupFolder = async () => {
    const folder = await chooseFolder();
    if (folder)
      await perform(
        "PATCH",
        "/api/settings",
        { workspaceRoot: folder },
        "Workspace folder saved.",
      );
  };
  return (
    <div className="page-enter">
      <div className="overview-heading">
        <div>
          <span className="eyebrow">YOUR PERSONAL COMMAND CENTER</span>
          <h1>
            Good things start here<span className="title-dot">.</span>
          </h1>
          <p>
            One space for your ideas, your AI team, and everything you’re
            working on.
          </p>
        </div>
        <span className="date-label">
          {new Date().toLocaleDateString("en-GB", {
            weekday: "long",
            day: "numeric",
            month: "long",
          })}
        </span>
      </div>
      <section className="welcome-card">
        <div className="welcome-copy">
          <span className="pill">A LITTLE COMPANION. A BIG TEAM.</span>
          <h2>
            What shall we
            <br />
            make possible today?
          </h2>
          <p>
            Build something new, pick up a project, or ask Nakama to take care
            of the everyday.
          </p>
          <div className="button-row">
            <Button onClick={() => navigate("assistant")}>
              Talk to Nakama
              <ArrowRight size={17} />
            </Button>
            <Button kind="secondary" onClick={createProject}>
              <Plus size={17} />
              New project
            </Button>
          </div>
        </div>
        <div className="welcome-art">
          <span className="orbit orbit-one" />
          <span className="orbit orbit-two" />
          <span className="art-star star-one">✦</span>
          <span className="art-star star-two">✧</span>
          <span className="art-star star-three">✦</span>
          <div className="hero-mascot">
            <Mascot size={230} />
          </div>
          <div className="mascot-caption">
            <span className="connection-dot" />
            Made for your world
          </div>
        </div>
      </section>
      <div className="stats-grid">
        <button className="stat-card" onClick={() => navigate("projects")}>
          <span className="stat-icon blue">
            <FolderOpen size={21} />
          </span>
          <div>
            <strong>
              {state.projects.length}
              <small>Projects</small>
            </strong>
            <span>
              {state.projects.length
                ? "Your ideas, in progress"
                : "Ready for your first idea"}
            </span>
          </div>
          <ArrowRight size={17} />
        </button>
        <button className="stat-card" onClick={() => navigate("agents")}>
          <span className="stat-icon teal">
            <Bot size={21} />
          </span>
          <div>
            <strong>
              {ready}
              <small>AI accounts linked</small>
            </strong>
            <span>
              {running
                ? `${running} tasks running`
                : "ChatGPT · Claude · Kling"}
            </span>
          </div>
          <ArrowRight size={17} />
        </button>
        <button className="stat-card" onClick={() => navigate("devices")}>
          <span className="stat-icon purple">
            <Smartphone size={21} />
          </span>
          <div>
            <strong>
              {state.devices.length}
              <small>Paired devices</small>
            </strong>
            <span>Phone, tablet & browser</span>
          </div>
          <ArrowRight size={17} />
        </button>
      </div>
      {!state.config.workspaceRoot && (
        <section className="setup-callout">
          <div className="setup-icon">
            <FolderOpen size={22} />
          </div>
          <div>
            <h3>Give your ideas a home</h3>
            <p>
              Choose the folder Nakama can use to create and manage your
              projects.
            </p>
          </div>
          <Button kind="secondary" onClick={() => void setupFolder()}>
            Choose workspace
            <ArrowRight size={16} />
          </Button>
        </section>
      )}
      {pending > 0 && (
        <section className="approval-callout">
          <ShieldCheck size={22} />
          <div>
            <h3>
              {pending} {pending === 1 ? "action needs" : "actions need"} your
              permission
            </h3>
            <p>Review the exact action before Nakama continues.</p>
          </div>
          <Button kind="secondary" onClick={() => navigate("activity")}>
            Review actions
          </Button>
        </section>
      )}
      <SectionTitle
        title="Pick up where you left off"
        description="Your most recently active projects."
        action={
          <TextLink onClick={() => navigate("projects")}>All projects</TextLink>
        }
      />
      {recent.length ? (
        <div className="project-grid">
          {recent.map((project) => (
            <ProjectCard key={project.id} project={project} />
          ))}
        </div>
      ) : (
        <div className="first-project">
          <div className="empty-project-art">
            <FolderOpen size={37} />
            <span>✦</span>
          </div>
          <div>
            <h3>A fresh start, full of possibilities.</h3>
            <p>Your projects will live here. Start with a name and an idea.</p>
          </div>
          <Button kind="secondary" onClick={createProject}>
            <Plus size={16} />
            Create your first project
          </Button>
        </div>
      )}
      <div className="bottom-grid">
        <section className="panel">
          <SectionTitle
            title="Your AI team"
            action={
              <TextLink onClick={() => navigate("agents")}>
                Manage team
              </TextLink>
            }
          />
          <div className="team-list">
            {state.providers.map((provider, i) => (
              <button
                className="team-row"
                key={provider.id}
                onClick={() => navigate("agents")}
              >
                <span className={`provider-mark provider-${i}`}>
                  {provider.name.slice(0, 1)}
                </span>
                <span>
                  <strong>{provider.name}</strong>
                  <small>
                    {provider.selectedModel ||
                      "Choose a model after connecting"}
                  </small>
                </span>
                <Status value={provider.status} />
              </button>
            ))}
          </div>
        </section>
        <section className="getting-started">
          <span className="eyebrow">BUILT AROUND YOU</span>
          <h3>
            Your desk. Your pocket.
            <br />
            One Nakama.
          </h3>
          <p>
            Pair your Android phone to carry your projects and assistant with
            you.
          </p>
          <TextLink onClick={() => navigate("devices")}>
            Connect a device
          </TextLink>
          <div className="mini-device">
            <Smartphone size={50} />
            <span>
              <ShieldCheck size={18} />
              Paired. Private. In your control.
            </span>
          </div>
        </section>
      </div>
    </div>
  );
}

export function ProjectCard({ project }: { project: Project }) {
  const { openProject, perform } = useNakama();
  return (
    <article className="project-card">
      <div className="project-card-top">
        <span className="project-icon">
          <Folder size={24} />
        </span>
        <IconButton
          label={project.pinned ? "Unpin project" : "Pin project"}
          onClick={() =>
            void perform("PATCH", `/api/projects/${project.id}`, {
              pinned: !project.pinned,
            })
          }
        >
          <span className={`pin-star ${project.pinned ? "pinned" : ""}`}>
            {project.pinned ? "★" : "☆"}
          </span>
        </IconButton>
      </div>
      <button
        className="project-card-link"
        onClick={() => openProject(project.id)}
      >
        <h3>{project.name}</h3>
        <p>{project.description || "A new space for your next idea."}</p>
      </button>
      <div className="project-card-bottom">
        <Status value={project.status} />
        <span>{relativeDate(project.updatedAt)}</span>
      </div>
    </article>
  );
}
function Projects({ query }: { query: string }) {
  const { state, createProject } = useNakama();
  const [importOpen, setImportOpen] = useState(false);
  const filtered = [...state.projects]
    .filter((project) =>
      `${project.name} ${project.description}`
        .toLowerCase()
        .includes(query.toLowerCase()),
    )
    .sort((a, b) => +new Date(b.updatedAt) - +new Date(a.updatedAt));
  return (
    <div className="page-enter">
      <SectionTitle
        eyebrow="MAKE ROOM FOR YOUR NEXT IDEA"
        title="Your projects"
        description="Everything you’re building, most recently active first."
        action={
          <div className="button-row">
            <Button
              kind="secondary"
              disabled={previewMode}
              onClick={() => setImportOpen(true)}
            >
              Import from GitHub
            </Button>
            <Button onClick={createProject}>
              <Plus size={17} />
              New project
            </Button>
          </div>
        }
      />
      <div className="project-toolbar">
        <span className="tab selected">
          All projects <span>{state.projects.length}</span>
        </span>
        <span className="muted">
          {query ? `Results for “${query}”` : "Sorted by recent activity"}
        </span>
      </div>
      {importOpen && <GitHubImport onClose={() => setImportOpen(false)} />}
      {filtered.length ? (
        <div className="project-grid">
          {filtered.map((project) => (
            <ProjectCard key={project.id} project={project} />
          ))}
        </div>
      ) : (
        <div className="panel">
          <Empty
            icon={<FolderOpen size={30} />}
            title={
              query ? "No matching projects" : "Your next idea starts here"
            }
            action={
              !query && (
                <Button onClick={createProject}>
                  <Plus size={16} />
                  Create a project
                </Button>
              )
            }
          >
            {query
              ? "Try a different name or description in the search box."
              : "Create a project and give your AI team a place to work."}
          </Empty>
        </div>
      )}
    </div>
  );
}
function CreateProject({ onClose }: { onClose: () => void }) {
  const { state, perform, openProject, notify } = useNakama();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      if (!state.config.workspaceRoot) {
        const folder = await chooseFolder();
        if (!folder) return;
        const saved = await perform("PATCH", "/api/settings", {
          workspaceRoot: folder,
        });
        if (!saved) return;
      }
      const project = await perform<Project>(
        "POST",
        "/api/projects",
        { name: name.trim(), description: description.trim() },
        "Your project is ready.",
      );
      if (project) {
        onClose();
        openProject(project.id);
      }
    } catch (reason) {
      notify(String(reason), true);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title="Make something new"
      description="Give it a name. You can work out the rest with your AI team."
      onClose={onClose}
    >
      <form onSubmit={(event) => void submit(event)}>
        <label className="field">
          Project name
          <input
            autoFocus
            required
            maxLength={80}
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="My brilliant idea"
          />
        </label>
        <label className="field">
          What are you making?
          <textarea
            rows={3}
            maxLength={2000}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="A little context helps your AI team get started…"
          />
          <small>Optional. You can change this later.</small>
        </label>
        <div className="inline-note">
          <FolderOpen size={17} />
          <span>
            {state.config.workspaceRoot ||
              "You’ll choose your workspace folder next."}
          </span>
        </div>
        <div className="modal-actions">
          <Button kind="secondary" type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" busy={busy} disabled={!name.trim()}>
            Create project
            <ArrowRight size={16} />
          </Button>
        </div>
      </form>
    </Modal>
  );
}
