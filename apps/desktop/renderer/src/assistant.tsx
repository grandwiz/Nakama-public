import { useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  ArrowDown,
  Bot,
  Check,
  Image,
  Info,
  MessageCircle,
  RefreshCw,
  Send,
  Sparkles,
  Square,
  Wand2,
} from "lucide-react";
import {
  Button,
  Mascot,
  SectionTitle,
  Status,
  TextLink,
  Toggle,
  relativeDate,
} from "./components";
import { openExternal } from "./bridge";
import { useNakama } from "./context";
import type { Provider } from "./types";
import { MediaPanel } from "./media";
import type { CheckReviewDraft } from "./check-review";
import {
  defaultAiRoles,
  defaultInteractionRole,
  defaultProjectTeam,
  roleSummary,
} from "./ai-role-settings";
import { ProjectWorkflowPanel } from "./project-workflow";
import { navigationOutcome } from "./agent-office-model";
import { MessageTimestamp, useChatTimeline } from "./chat-timeline";
import { ChatHistoryControls } from "./chat-history";

import {
  claudeModelChoices,
  effortChoices,
  normalizedEffort,
} from "./provider-options";

function locationLookup(message: import("./types").Message): string | null {
  if (
    !message.localOutcome ||
    !["weather_lookup", "map_link"].includes(message.localOutcome.type)
  )
    return null;
  try {
    const url = new URL(message.localOutcome.url || "");
    return url.origin === "https://www.google.com" &&
      ["/search", "/maps/search/"].includes(url.pathname)
      ? url.href
      : null;
  } catch {
    return null;
  }
}

function ModelField({
  provider,
  value,
  onChange,
  label,
  defaultLabel = "Use account default",
  disabled = false,
}: {
  provider?: Provider;
  value: string;
  onChange: (value: string) => void;
  label: string;
  defaultLabel?: string;
  disabled?: boolean;
}) {
  const [customChoice, setCustomChoice] = useState(false);
  useEffect(() => setCustomChoice(false), [provider?.id]);
  const custom =
    customChoice ||
    (!!value && !claudeModelChoices.some((item) => item.value === value));
  if (provider?.id !== "claude")
    return (
      <label className="field">
        {label}
        <input
          value={value}
          list={`models-${provider?.id}`}
          onChange={(event) => onChange(event.target.value)}
          placeholder={defaultLabel}
          disabled={disabled}
        />
        <datalist id={`models-${provider?.id}`}>
          {(provider?.models || []).map((item) => (
            <option
              key={typeof item === "string" ? item : item.id}
              value={typeof item === "string" ? item : item.id}
            >
              {typeof item === "string" ? item : item.name || item.id}
            </option>
          ))}
        </datalist>
      </label>
    );
  return (
    <>
      <label className="field">
        {label}
        <select
          aria-label={label}
          value={custom ? "__custom__" : value}
          disabled={disabled}
          onChange={(event) => {
            const next = event.target.value;
            setCustomChoice(next === "__custom__");
            onChange(next === "__custom__" ? "" : next);
          }}
        >
          <option value="">{defaultLabel}</option>
          <optgroup label="Specific model version">
            {claudeModelChoices
              .filter((item) => item.value.startsWith("claude-"))
              .map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
          </optgroup>
          <optgroup label="Follow the CLI default version">
            {claudeModelChoices
              .filter((item) => !item.value.startsWith("claude-"))
              .map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
          </optgroup>
          <option value="__custom__">Other exact model ID…</option>
        </select>
        {!custom && value && <small>Model ID: {value}</small>}
      </label>
      {custom && (
        <label className="field">
          Exact model ID
          <input
            value={value}
            onChange={(event) => onChange(event.target.value)}
            placeholder="e.g. claude-opus-5-5"
            disabled={disabled}
          />
        </label>
      )}
      <p className="small-copy">
        Specific versions request that model; availability depends on your
        Claude account. Fable 5.1 needs Claude Code 2.1.257 or later; Opus 5.5
        needs 2.1.280 or later.
      </p>
    </>
  );
}

export function AssistantPage({
  initialProjectId,
  initialReview,
  onReviewConsumed,
}: {
  initialProjectId?: string;
  initialReview?: CheckReviewDraft;
  onReviewConsumed: () => void;
}) {
  const {
    state,
    perform,
    navigate,
    openProject,
    openAssistant,
    notify,
    setNavigationGuard,
  } = useNakama();
  const [review, setReview] = useState(() =>
    initialReview?.projectId === initialProjectId &&
    state.projects.some((project) => project.id === initialProjectId)
      ? initialReview
      : undefined,
  );
  const [message, setMessage] = useState(() => review?.message || "");
  const [projectId, setProjectId] = useState(initialProjectId || "");
  const [providerId, setProviderId] = useState(
    state.providers[0]?.id || "codex",
  );
  const [team, setTeam] = useState<string[]>([]);
  const [manual, setManual] = useState(Boolean(initialReview));
  const [routeNote, setRouteNote] = useState("");
  const [mode, setMode] = useState<"discuss" | "build" | "act">("discuss");
  const [effort, setEffort] = useState("high");
  const [model, setModel] = useState("");
  const [busy, setBusy] = useState(false);
  const [workflowDraft, setWorkflowDraft] = useState(false);
  const draftRef = useRef(message);
  const workflowDraftRef = useRef(workflowDraft);
  const conversationRef = useRef(projectId);
  const mountedRef = useRef(true);
  draftRef.current = message;
  workflowDraftRef.current = workflowDraft;
  conversationRef.current = projectId;
  const provider = state.providers.find((item) => item.id === providerId);
  const roles = state.config.aiRoles || defaultAiRoles();
  const projectAvailable =
    !projectId || state.projects.some((project) => project.id === projectId);
  const hasDraft = Boolean(message.trim()) || workflowDraft;
  const messages = state.messages.filter(
    (item) => !item.deliveryOnly && (item.projectId || "") === projectId,
  );
  const timeline = useChatTimeline(messages, projectId);
  const tasks = state.tasks.filter(
    (item) =>
      (item.projectId || "") === projectId &&
      ["running", "queued"].includes(item.status),
  );
  useEffect(() => {
    onReviewConsumed();
  }, [onReviewConsumed]);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);
  useEffect(() => {
    setNavigationGuard(
      () =>
        !(draftRef.current.trim() || workflowDraftRef.current) ||
        window.confirm("Discard your unsent assistant draft?"),
    );
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (draftRef.current.trim() || workflowDraftRef.current) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => {
      setNavigationGuard(null);
      window.removeEventListener("beforeunload", beforeUnload);
    };
  }, [setNavigationGuard]);
  useEffect(() => {
    setModel(provider?.selectedModel || "");
    setEffort(normalizedEffort(provider));
  }, [provider?.id, provider?.selectedModel, provider?.effort]);
  useEffect(() => {
    const options = effortChoices(provider, model);
    setEffort((current) =>
      options.some((item) => item.value === current)
        ? current
        : options.find((item) => item.value === "high")?.value ||
          options[0]?.value ||
          "high",
    );
  }, [provider?.id, provider?.modelDetails, model]);
  const send = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!message.trim() || !projectAvailable || busy) return;
    const submittedMessage = message;
    timeline.submitted(submittedMessage);
    setBusy(true);
    const result = await perform<{
      routing?: { reason: string };
      outcome?: unknown;
    }>("POST", "/api/chat", {
      message: message.trim(),
      projectId: projectId || undefined,
      ...(manual
        ? {
            providerId,
            model: team.length ? undefined : model || undefined,
            effort: team.length ? undefined : effort,
            mode: mode === "build" && !projectId ? "discuss" : mode,
            team: team.length
              ? [providerId, ...team.filter((id) => id !== providerId)]
              : undefined,
          }
        : { routing: "auto" }),
    });
    if (!mountedRef.current) return;
    if (!result) timeline.failed();
    setBusy(false);
    if (conversationRef.current !== projectId) return;
    if (result) {
      setRouteNote(result.routing?.reason || "");
      setMessage((current) => (current === submittedMessage ? "" : current));
      if (draftRef.current === submittedMessage) draftRef.current = "";
      setReview(undefined);
      const destination = navigationOutcome(result.outcome, state.projects);
      if (destination) {
        if (destination.projectId && destination.target === "projects")
          openProject(destination.projectId);
        else if (destination.projectId && destination.target === "assistant")
          openAssistant(destination.projectId);
        else
          navigate(destination.target, {
            browserSessionId: destination.browserSessionId,
          });
      }
    }
  };
  const toggleTeam = (id: string) => {
    const next = team.includes(id)
      ? team.filter((item) => item !== id)
      : [...team, id];
    setTeam(next);
    if (next.length && !next.includes(providerId)) setProviderId(next[0]);
  };
  const changeProject = (nextProjectId: string) => {
    if (nextProjectId === projectId) return;
    if (
      hasDraft &&
      !window.confirm(
        "Discard your unsent draft and change conversation project?",
      )
    )
      return;
    setMessage("");
    setReview(undefined);
    setProjectId(nextProjectId);
  };
  return (
    <div className="page-enter assistant-page">
      <SectionTitle
        eyebrow="A LITTLE HELP WITH EVERYTHING"
        title="Talk to Nakama"
        description="Think out loud. Start a project. Let your AI team help with the next step."
        action={
          <TextLink onClick={() => navigate("agents")}>
            Manage AI connections
          </TextLink>
        }
      />
      <section className="chat-layout">
        <div className="chat-main">
          <div className="chat-toolbar">
            <span>
              <span className="chat-dot" />
              <strong>
                {projectId
                  ? state.projects.find((item) => item.id === projectId)?.name
                  : "Your personal assistant"}
              </strong>
            </span>
            <select
              aria-label="Conversation project"
              value={projectId}
              disabled={busy}
              onChange={(event) => changeProject(event.target.value)}
            >
              <option value="">General conversation</option>
              {state.projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
          </div>
          <ChatHistoryControls projectId={projectId} />
          <div className="chat-transcript">
            <div
              className="chat-messages"
              ref={timeline.viewport}
              onScroll={timeline.onScroll}
              aria-label="Conversation messages"
            >
              {projectId && (
                <ProjectWorkflowPanel
                  key={projectId}
                  projectId={projectId}
                  onDraftChange={setWorkflowDraft}
                />
              )}
              {!messages.length && (
                <div className="chat-welcome">
                  <Mascot size={116} />
                  <h2>A thought, a task, a big idea?</h2>
                  <p>
                    I’m here to help you make it happen.
                    <br />
                    Connect an AI account, then tell me what you have in mind.
                  </p>
                  <div className="prompt-grid">
                    {[
                      {
                        icon: Wand2,
                        title: "Build something",
                        text: "Help me plan a new app. Ask about the problem it should solve.",
                      },
                      {
                        icon: Bot,
                        title: "Work as a team",
                        text: "Review my project and suggest a plan for what to work on next.",
                      },
                      {
                        icon: Image,
                        title: "Explore an idea",
                        text: "Help me write a detailed image-generation prompt for a creative project.",
                      },
                      {
                        icon: MessageCircle,
                        title: "Make a plan",
                        text: "Help me organise my priorities for tomorrow.",
                      },
                    ].map((prompt) => (
                      <button
                        key={prompt.title}
                        onClick={() => {
                          if (
                            hasDraft &&
                            !window.confirm(
                              "Replace your unsent assistant draft?",
                            )
                          )
                            return;
                          setReview(undefined);
                          setMessage(prompt.text);
                        }}
                      >
                        <prompt.icon size={18} />
                        <span>
                          {prompt.title}
                          <small>{prompt.text}</small>
                        </span>
                        <ArrowRight size={15} />
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {messages.map((item) => (
                <article
                  className={`message ${item.role === "user" ? "user-message" : "assistant-message"}`}
                  key={item.id}
                  data-message-id={item.id}
                >
                  <span
                    className={`message-avatar ${item.role === "user" ? "human" : ""}`}
                  >
                    {item.role === "user" ? "You" : <Mascot size={34} />}
                  </span>
                  <div className="message-content">
                    <div className="message-meta">
                      <strong>
                        {item.role === "user"
                          ? "You"
                          : item.role === "assistant"
                            ? "Nakama"
                            : item.role}
                      </strong>
                      <time>{relativeDate(item.createdAt)}</time>
                    </div>
                    <MessageTimestamp message={item} />
                    {locationLookup(item) && (
                      <Button
                        kind="secondary"
                        onClick={() =>
                          void openExternal(locationLookup(item)!).catch(() =>
                            notify("Could not open this lookup.", true),
                          )
                        }
                      >
                        {item.localOutcome?.type === "weather_lookup"
                          ? "Open weather lookup"
                          : "Open map"}
                        <ArrowRight size={14} />
                      </Button>
                    )}
                  </div>
                </article>
              ))}
              {tasks.map((task) => (
                <article className="running-message" key={task.id}>
                  <Bot size={19} />
                  <div>
                    <strong>
                      {state.providers.find(
                        (item) => item.id === task.providerId,
                      )?.name || task.providerId}{" "}
                      is working
                    </strong>
                    <p>{task.title}</p>
                    {task.routingReason && (
                      <p className="small-copy">{task.routingReason}</p>
                    )}
                    {task.output && <pre>{task.output.slice(-6000)}</pre>}
                  </div>
                  <Button
                    kind="ghost"
                    onClick={() =>
                      void perform("POST", `/api/tasks/${task.id}/stop`)
                    }
                  >
                    <Square size={13} />
                    Stop
                  </Button>
                </article>
              ))}
            </div>
            {timeline.away && (
              <button
                type="button"
                className="chat-latest"
                onClick={timeline.latest}
              >
                <ArrowDown size={16} />
                {timeline.unread
                  ? `Latest · ${timeline.unread} unread`
                  : "Latest message"}
              </button>
            )}
          </div>
          <form
            className="chat-composer"
            onSubmit={(event) => void send(event)}
          >
            {routeNote && (
              <p className="small-copy" role="status">
                {routeNote}
              </p>
            )}
            {review && (
              <div
                className="check-review-draft"
                role="note"
                aria-label="Check review draft"
              >
                <Info size={18} />
                <div>
                  <strong>{review.title}</strong>
                  <p>
                    This is an editable draft. Nothing is sent until you choose
                    Send. Review the included output and remove any sensitive
                    details first.
                  </p>
                  {review.truncated && (
                    <small>
                      Long check details were shortened. The draft marks omitted
                      content.
                    </small>
                  )}
                </div>
              </div>
            )}
            {!projectAvailable && (
              <p className="inline-error" role="alert">
                This project is no longer available. Choose another conversation
                to discard this draft and continue.
              </p>
            )}
            <label className="sr-only" htmlFor="message">
              Message Nakama
            </label>
            <textarea
              id="message"
              autoFocus={Boolean(review)}
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              rows={review ? 8 : 3}
              maxLength={24000}
              placeholder="Ask Nakama anything, or describe what you want to build…"
              onKeyDown={(event) => {
                if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
                  event.preventDefault();
                  void send(event as unknown as React.FormEvent);
                }
              }}
            />
            <div className="composer-bottom">
              <span>
                <ShieldIcon />
                {!manual
                  ? "Nakama chooses the right AI"
                  : team.length
                    ? `${team.length} AI${team.length === 1 ? "" : "s"} selected`
                    : provider?.name || "Choose an AI"}
                <span className="composer-hint"> · Ctrl + Enter to send</span>
              </span>
              <Button
                type="submit"
                busy={busy}
                disabled={!message.trim() || !projectAvailable}
              >
                <Send size={16} />
                Send
              </Button>
            </div>
          </form>
          <p className="chat-footnote">
            AI can make mistakes. Deployments and project deletion always come
            back to you for approval.
          </p>
        </div>
        <aside className="chat-settings">
          <span className="eyebrow">YOUR CREW</span>
          <h3>{manual ? "Your override" : "Just tell Nakama"}</h3>
          {!manual && (
            <>
              <p>
                Your manager plans with a second AI, brings questions to you,
                and assigns work after the plan is complete. Both review the
                changes before your manager delivers the result.
              </p>
              <dl className="ai-role-summary">
                <dt>Fast Nakama interaction</dt>
                <dd>
                  {roleSummary(
                    state.config.interactionRole || defaultInteractionRole(),
                  )}
                </dd>
                <dt>Planning & design</dt>
                <dd>{roleSummary(roles.planning)}</dd>
                <dt>Co-planner & reviewer</dt>
                <dd>
                  {roleSummary(
                    (state.config.projectTeam || defaultProjectTeam()).peer,
                  )}
                </dd>
                <dt>Development</dt>
                <dd>{roleSummary(roles.development)}</dd>
              </dl>
              <Button kind="secondary" onClick={() => navigate("agent-office")}>
                Visit the Agent office
              </Button>
              <p className="small-copy">
                You can say “plan using Claude” to change the AI for one
                request. Videos use the separate Kling studio and always need
                your approval.
              </p>
              <Button kind="ghost" onClick={() => navigate("settings")}>
                Change AI roles in Settings
              </Button>
            </>
          )}
          <label className="team-choice">
            <input
              type="checkbox"
              checked={manual}
              onChange={(event) => setManual(event.target.checked)}
            />
            <span>Override AI for this chat</span>
          </label>
          {manual && (
            <>
              <label className="field">
                {mode === "build" && projectId
                  ? "Primary writer"
                  : "Primary assistant"}
                <select
                  value={providerId}
                  onChange={(event) => setProviderId(event.target.value)}
                >
                  {state.providers.map((item) => (
                    <option
                      value={item.id}
                      key={item.id}
                      disabled={team.length > 0 && !team.includes(item.id)}
                    >
                      {item.name}
                    </option>
                  ))}
                </select>
              </label>
              <ModelField
                provider={provider}
                value={model}
                onChange={setModel}
                label="Model"
                defaultLabel={
                  provider?.selectedModel
                    ? `Use saved model (${provider.selectedModel})`
                    : "Use account default"
                }
                disabled={team.length > 0}
              />
              {team.length > 0 && (
                <p className="small-copy">
                  Team runs use each AI’s saved model.
                </p>
              )}
              <label className="field">
                Working mode
                <select
                  value={mode === "build" && !projectId ? "discuss" : mode}
                  onChange={(event) =>
                    setMode(event.target.value as "discuss" | "build" | "act")
                  }
                >
                  <option value="discuss">Discuss · plan and review</option>
                  <option value="build" disabled={!projectId}>
                    Build · write project files
                  </option>
                  <option value="act">Do a task · use connected tools</option>
                </select>
                <small>
                  {mode === "act"
                    ? "Carry out supported project, email, calendar and phone tasks."
                    : projectId
                      ? "Build mode lets the primary writer create or update files inside this project."
                      : "Choose a project to enable file building. Do a task works with your personal assistant."}
                </small>
              </label>
              <label className="field">
                Thinking effort
                <select
                  value={effort}
                  disabled={team.length > 0}
                  onChange={(event) => setEffort(event.target.value)}
                >
                  {effortChoices(provider, model).map((item) => (
                    <option key={item.value} value={item.value}>
                      {item.label}
                    </option>
                  ))}
                </select>
                <small>
                  {team.length
                    ? "Each team member uses its saved effort setting."
                    : "Effort options follow this provider and model. Ultra appears only when supported."}
                </small>
              </label>
              <div className="settings-divider" />
              <h4>Parallel team</h4>
              <p className="small-copy">
                Select the AIs you want to run together.
              </p>
              <div className="team-options">
                {state.providers.map((item) => (
                  <label className="team-choice" key={item.id}>
                    <input
                      type="checkbox"
                      checked={team.includes(item.id)}
                      onChange={() => toggleTeam(item.id)}
                    />
                    <span>
                      <strong>{item.name}</strong>
                      <small>{item.selectedModel || "Account default"}</small>
                    </span>
                  </label>
                ))}
              </div>
              <div className="inline-note compact">
                <Info size={16} />
                <span>
                  Connect each selected account first. Discuss mode plans and
                  reviews. Build mode writes project files. Do a task uses
                  connected tools with your permissions; commands, deployments,
                  and project deletion still require approval.
                </span>
              </div>
            </>
          )}
        </aside>
      </section>
    </div>
  );
}
function ShieldIcon() {
  return <Sparkles size={14} />;
}

export function AgentsPage() {
  const { state } = useNakama();
  return (
    <div className="page-enter">
      <SectionTitle
        eyebrow="YOUR TEAM. YOUR DIRECTION."
        title="Meet your AI team"
        description="Connect the accounts you already use. Choose each model and how deeply it thinks."
      />
      <div className="subscription-note">
        <Sparkles size={21} />
        <div>
          <strong>Start with the subscriptions you already have.</strong>
          <p>
            Official CLI connections can use eligible ChatGPT and Claude account
            plans. Kling video uses a separate account and credits.
          </p>
          <p className="small-copy">
            A connection check reads local sign-in information. The first task
            verifies whether that session and its usage allowance can actually
            run.
          </p>
        </div>
      </div>
      <div className="agent-grid">
        {state.providers.map((provider, index) => (
          <AgentCard key={provider.id} provider={provider} index={index} />
        ))}
      </div>
      <MediaPanel />
      <div className="inline-note">
        <Info size={18} />
        <span>
          Model availability can change. Enter an exact supported model ID or
          leave it blank to use the official client’s default. Nakama reports
          provider errors instead of silently switching to a paid API.
        </span>
      </div>
    </div>
  );
}

function AgentCard({ provider, index }: { provider: Provider; index: number }) {
  const { perform } = useNakama();
  const [model, setModel] = useState(provider.selectedModel || "");
  const [effort, setEffort] = useState(provider.effort || "high");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setModel(provider.selectedModel || "");
    setEffort(normalizedEffort(provider));
  }, [provider.selectedModel, provider.effort]);
  useEffect(() => {
    const options = effortChoices(provider, model);
    setEffort((current) =>
      options.some((item) => item.value === current)
        ? current
        : options.find((item) => item.value === "high")?.value ||
          options[0]?.value ||
          "high",
    );
  }, [provider.id, provider.modelDetails, model]);
  const docs =
    provider.id === "claude"
      ? "https://code.claude.com/docs/en/quickstart"
      : "https://developers.openai.com/codex/cli/";
  const probe = async () => {
    setBusy(true);
    await perform(
      "POST",
      `/api/providers/${provider.id}/probe`,
      {},
      "Connection check finished. See the status below.",
    );
    setBusy(false);
  };
  return (
    <section className="agent-card">
      <div className="agent-card-heading">
        <span className={`provider-mark large provider-${index}`}>
          {provider.name.slice(0, 1)}
        </span>
        <Status value={provider.status} />
      </div>
      <h2>{provider.name}</h2>
      <p className="agent-description">
        {provider.id === "claude"
          ? "Thoughtful development, architecture, and review."
          : "Code, investigate, and turn plans into precise next steps."}
      </p>
      <div className="connection-method">
        <span>Connection method</span>
        <strong>Official command-line client</strong>
      </div>
      {provider.id === "claude" && (
        <Toggle
          label="I have disabled usage credits in Claude"
          description="Fable needs your Max plan and this confirmation. Turn usage credits off in Claude account settings first. This records your confirmation; Nakama cannot verify that billing switch. Turn this off if you enable credits or change accounts."
          checked={provider.usageCreditsDisabledConfirmed === true}
          onChange={(checked) =>
            void perform(
              "POST",
              "/api/providers/claude/settings",
              { usageCreditsDisabledConfirmed: checked },
              "Claude billing confirmation saved. No model request was made.",
            )
          }
        />
      )}
      <ModelField
        provider={provider}
        value={model}
        onChange={setModel}
        label="Preferred model"
      />
      <label className="field">
        Thinking effort
        <select
          value={effort}
          onChange={(event) => setEffort(event.target.value)}
        >
          {effortChoices(provider, model).map((item) => (
            <option key={item.value} value={item.value}>
              {item.label}
            </option>
          ))}
        </select>
      </label>
      <Button
        kind="secondary"
        className="full-width"
        onClick={() =>
          void perform(
            "POST",
            `/api/providers/${provider.id}/settings`,
            {
              selectedModel: model.trim(),
              effort,
              connectionType: "subscription",
            },
            "AI preferences saved.",
          )
        }
      >
        <Check size={15} />
        Save preferences
      </Button>
      {provider.id === "codex" && (
        <Button
          kind="ghost"
          className="full-width"
          onClick={() =>
            void perform(
              "GET",
              "/api/providers/codex/models",
              undefined,
              "Available Codex models refreshed.",
            )
          }
        >
          <RefreshCw size={14} />
          Discover account models
        </Button>
      )}
      <div className="agent-status-detail">
        <Info size={15} />
        <p>
          {provider.detail ||
            "Install and sign into the official CLI, then check the connection. No inference call is made by this check."}
        </p>
      </div>
      <div className="agent-card-footer">
        <TextLink onClick={() => void openExternal(docs)} external>
          Setup guide
        </TextLink>
        <Button kind="ghost" busy={busy} onClick={() => void probe()}>
          <RefreshCw size={14} />
          Check connection
        </Button>
      </div>
    </section>
  );
}
