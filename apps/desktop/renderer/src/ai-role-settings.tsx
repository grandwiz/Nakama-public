import { useEffect, useState } from "react";
import { Bot, Check } from "lucide-react";
import { Button, Toggle } from "./components";
import { useNakama } from "./context";
import type { AiRole, AiRoles, ProjectTeam } from "./types";

export function defaultInteractionRole(): AiRole {
  return { providerId: "codex", model: "gpt-6-astra", effort: "low" };
}

export function defaultProjectTeam(): ProjectTeam {
  return {
    peer: { providerId: "claude", model: "claude-fable-5-1", effort: "ultracode" },
    maxFixCycles: 2,
  };
}

export function defaultAiRoles(): AiRoles {
  const codex = (): AiRole => ({
    providerId: "codex",
    model: "gpt-6-astra",
    effort: "ultra",
  });
  const claude = (): AiRole => ({
    providerId: "claude",
    model: "claude-opus-4-8",
    effort: "ultracode",
  });
  return {
    planning: codex(),
    development: claude(),
    chat: codex(),
    research: codex(),
    imagePrompts: codex(),
    tasks: { general: codex(), technical: { ...claude(), effort: "max" } },
  };
}

export function roleSummary(role: AiRole) {
  const name = role.providerId === "codex" ? "ChatGPT" : "Claude";
  const model =
    role.model === "gpt-6-astra"
      ? "Astra 6"
      : role.model === "claude-opus-4-8"
        ? "Opus 4.8"
        : role.model === "claude-fable-5-1"
          ? "Fable 5.1"
          : role.model || "account default";
  return `${name} · ${model} · ${role.effort === "ultracode" ? "Ultracode request" : role.effort === "ultra" ? "Ultra" : role.effort === "max" ? "Maximum" : role.effort}`;
}

const roleFields = [
  [
    "planning",
    "Planning & design",
    "Project manager: plans with the co-planner, asks your questions, reviews work and delivers the result.",
  ],
  [
    "development",
    "Development",
    "Build and change project files using the completed plan.",
  ],
  [
    "chat",
    "Detailed conversation",
    "The saved conversation role for detailed discussion; Fast Nakama has its own interaction model below.",
  ],
  ["research", "Research", "Investigations and research requests."],
  [
    "imagePrompts",
    "Image ideas & prompts",
    "Creative direction and detailed generation prompts. Image-file generation is not connected yet.",
  ],
  [
    "general",
    "Everyday tasks",
    "Supported email, calendar, phone and personal-assistant actions.",
  ],
  [
    "technical",
    "Technical tasks",
    "Supported development and technical tool actions.",
  ],
] as const;
type RoleKey = (typeof roleFields)[number][0];
function getRole(roles: AiRoles, key: RoleKey) {
  return key === "general" || key === "technical"
    ? roles.tasks[key]
    : roles[key];
}

export function AiRoleSettings() {
  const { state, perform, setNavigationGuard } = useNakama();
  const saved = JSON.stringify(state.config.aiRoles || defaultAiRoles());
  const savedFastReplies = state.config.fastReplies !== false;
  const savedInteraction = JSON.stringify(
    state.config.interactionRole || defaultInteractionRole(),
  );
  const savedTeam = JSON.stringify(
    state.config.projectTeam || defaultProjectTeam(),
  );
  const [roles, setRoles] = useState<AiRoles>(() => JSON.parse(saved));
  const [interactionRole, setInteractionRole] = useState<AiRole>(() =>
    JSON.parse(savedInteraction),
  );
  const [projectTeam, setProjectTeam] = useState<ProjectTeam>(() =>
    JSON.parse(savedTeam),
  );
  const [fastReplies, setFastReplies] = useState(savedFastReplies);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!dirty) {
      setRoles(JSON.parse(saved));
      setInteractionRole(JSON.parse(savedInteraction));
      setFastReplies(savedFastReplies);
      setProjectTeam(JSON.parse(savedTeam));
    }
  }, [saved, savedInteraction, savedFastReplies, savedTeam, dirty]);
  useEffect(() => {
    setNavigationGuard(
      dirty
        ? () => window.confirm("Discard your unsaved AI role settings?")
        : null,
    );
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (dirty) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => {
      setNavigationGuard(null);
      window.removeEventListener("beforeunload", beforeUnload);
    };
  }, [dirty, setNavigationGuard]);
  const change = (key: RoleKey, patch: Partial<AiRole>) => {
    setDirty(true);
    setRoles((current) =>
      key === "general" || key === "technical"
        ? {
            ...current,
            tasks: {
              ...current.tasks,
              [key]: { ...current.tasks[key], ...patch },
            },
          }
        : { ...current, [key]: { ...current[key], ...patch } },
    );
  };
  const save = async () => {
    setBusy(true);
    const result = await perform(
      "PATCH",
      "/api/settings",
      { aiRoles: roles, interactionRole, fastReplies, projectTeam },
      "AI roles saved. New automatic requests will use these choices.",
    );
    if (result !== undefined) setDirty(false);
    setBusy(false);
  };
  return (
    <section className="settings-section" id="ai-roles">
      <div className="settings-section-label">
        <Bot size={22} />
        <h3>AI roles</h3>
        <p>
          Choose your team once. Nakama uses these roles for automatic
          conversations on your PC and phone.
        </p>
      </div>
      <div className="settings-section-body">
        <p className="small-copy">
          Your manager and co-planner prepare the project together. The manager
          brings questions to you before development starts. Both review the
          workers' changes before the manager delivers the result.
        </p>
        <Toggle
          label="Faster everyday replies"
          description="Allow lower thinking effort for brief everyday requests. Your interaction model stays separate from project planning, development and review. Account availability and response times can vary."
          checked={fastReplies}
          disabled={busy}
          onChange={(checked) => {
            setFastReplies(checked);
            setDirty(true);
          }}
        />
        <fieldset className="ai-role-card" disabled={busy}>
          <legend>Fast Nakama interaction</legend>
          <p className="small-copy">
            The companion you talk to, including quick questions and updates
            while project workers run. Astra 6 at low effort is the suggested
            starting point; Nakama never silently selects another model.
          </p>
          <label className="field">
            Interaction account
            <select
              value={interactionRole.providerId}
              onChange={(event) => {
                const providerId = event.target.value as AiRole["providerId"];
                setInteractionRole({
                  providerId,
                  model:
                    providerId === "codex" ? "gpt-6-astra" : "claude-opus-4-8",
                  effort: "low",
                });
                setDirty(true);
              }}
            >
              <option value="codex">ChatGPT</option>
              <option value="claude">Claude</option>
            </select>
          </label>
          <label className="field">
            Interaction model
            <input
              value={interactionRole.model}
              maxLength={120}
              onChange={(event) => {
                setInteractionRole((current) => ({
                  ...current,
                  model: event.target.value,
                }));
                setDirty(true);
              }}
            />
          </label>
          <label className="field">
            Interaction effort
            <select
              value={interactionRole.effort}
              onChange={(event) => {
                setInteractionRole((current) => ({
                  ...current,
                  effort: event.target.value,
                }));
                setDirty(true);
              }}
            >
              {Array.from(
                new Set([
                  ...(interactionRole.providerId === "claude"
                    ? ["low", "medium", "high", "xhigh", "max", "ultracode"]
                    : ["low", "medium", "high", "xhigh", "ultra"]),
                  interactionRole.effort,
                ]),
              ).map((effort) => (
                <option key={effort} value={effort}>
                  {effort}
                </option>
              ))}
            </select>
          </label>
          <p className="small-copy">
            {roleSummary(interactionRole)}. This setting does not replace your
            saved project roles.
          </p>
        </fieldset>
        <div className="ai-role-grid">
          {roleFields.map(([key, label, description]) => {
            const role = getRole(roles, key);
            const provider = state.providers.find(
              (item) => item.id === role.providerId,
            );
            const efforts =
              role.providerId === "claude"
                ? ["low", "medium", "high", "xhigh", "max", "ultracode"]
                : ["low", "medium", "high", "xhigh", "ultra"];
            return (
              <fieldset className="ai-role-card" key={key} disabled={busy}>
                <legend>{label}</legend>
                <p className="small-copy">{description}</p>
                <label className="field">
                  AI for {label.toLowerCase()}
                  <select
                    value={role.providerId}
                    onChange={(event) => {
                      const providerId = event.target
                        .value as AiRole["providerId"];
                      change(key, {
                        providerId,
                        model:
                          providerId === "codex"
                            ? "gpt-6-astra"
                            : "claude-opus-4-8",
                        effort: providerId === "codex" ? "ultra" : "max",
                      });
                    }}
                  >
                    <option value="codex">ChatGPT</option>
                    <option value="claude">Claude</option>
                  </select>
                </label>
                <p className="small-copy">{roleSummary(role)}</p>
                {provider?.status !== "connected" && (
                  <p className="small-copy">
                    Connect this account in AI team before using this role.
                  </p>
                )}
                <details>
                  <summary>Model & effort</summary>
                  <label className="field">
                    Model for {label.toLowerCase()}
                    <input
                      value={role.model}
                      maxLength={120}
                      onChange={(event) =>
                        change(key, { model: event.target.value })
                      }
                      placeholder="Account default"
                    />
                  </label>
                  <label className="field">
                    Effort for {label.toLowerCase()}
                    <select
                      value={role.effort}
                      onChange={(event) =>
                        change(key, { effort: event.target.value })
                      }
                    >
                      {Array.from(new Set([...efforts, role.effort])).map(
                        (effort) => (
                          <option key={effort} value={effort}>
                            {effort === "ultra" || effort === "max"
                              ? `Ultra (${effort})`
                              : effort}
                          </option>
                        ),
                      )}
                    </select>
                  </label>
                  <p className="small-copy">
                    Your account must support this exact model and effort.
                    Nakama reports errors without switching your chosen model.
                  </p>
                </details>
              </fieldset>
            );
          })}
        </div>
        <fieldset className="ai-role-card" disabled={busy}>
          <legend>Project co-planner & reviewer</legend>
          <p className="small-copy">
            Fable 5.1 uses your Claude account. Both planners receive your
            answers; workers wait until the manager resolves the questions.
            Saved runs keep the team they started with.
          </p>
          <label className="field">
            Co-planner account
            <select
              value={projectTeam.peer.providerId}
              onChange={(event) => {
                const providerId = event.target.value as AiRole["providerId"];
                setProjectTeam((current) => ({
                  ...current,
                  peer: {
                    providerId,
                    model:
                      providerId === "claude"
                        ? "claude-fable-5-1"
                        : "gpt-6-astra",
                    effort: providerId === "claude" ? "ultracode" : "ultra",
                  },
                }));
                setDirty(true);
              }}
            >
              <option value="claude">Claude</option>
              <option value="codex">ChatGPT</option>
            </select>
          </label>
          <label className="field">
            Co-planner model
            <input
              value={projectTeam.peer.model}
              maxLength={120}
              onChange={(event) => {
                setProjectTeam((current) => ({
                  ...current,
                  peer: { ...current.peer, model: event.target.value },
                }));
                setDirty(true);
              }}
            />
          </label>
          <label className="field">
            Co-planner effort
            <select
              value={projectTeam.peer.effort}
              onChange={(event) => {
                setProjectTeam((current) => ({
                  ...current,
                  peer: { ...current.peer, effort: event.target.value },
                }));
                setDirty(true);
              }}
            >
              {Array.from(
                new Set([
                  ...(projectTeam.peer.providerId === "claude"
                    ? ["low", "medium", "high", "xhigh", "max", "ultracode"]
                    : ["low", "medium", "high", "xhigh", "ultra"]),
                  projectTeam.peer.effort,
                ]),
              ).map((effort) => (
                <option key={effort} value={effort}>
                  {effort}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            Automatic fix rounds
            <select
              value={projectTeam.maxFixCycles}
              onChange={(event) => {
                setProjectTeam((current) => ({
                  ...current,
                  maxFixCycles: Number(event.target.value),
                }));
                setDirty(true);
              }}
            >
              {[0, 1, 2, 3].map((count) => (
                <option key={count} value={count}>
                  {count}
                  {count === 0 ? " · review only" : ""}
                </option>
              ))}
            </select>
          </label>
          <p className="small-copy">
            If reviewers still find issues after this limit, the project needs
            attention. Nakama does not call it complete. Workers apply files in
            sequence to prevent conflicting writes; commands, deployments and
            deletion keep their approval gates.
          </p>
          <p className="small-copy">
            Ultracode requests xhigh effort in Claude Code. Nakama coordinates
            the workers itself with restricted tools; Claude's native dynamic
            workflows are disabled in this preview.
          </p>
        </fieldset>
        <div className="inline-note">
          <span>
            Video generation uses Kling separately from these conversation
            roles. It stays disabled until you enable it, and every video needs
            your approval in Control Center.
          </span>
        </div>
        <div className="button-row">
          <Button onClick={() => void save()} busy={busy} disabled={!dirty}>
            <Check size={15} />
            Save AI roles
          </Button>
          <Button
            kind="secondary"
            disabled={busy}
            onClick={() => {
              setRoles(defaultAiRoles());
              setInteractionRole(defaultInteractionRole());
              setProjectTeam(defaultProjectTeam());
              setFastReplies(true);
              setDirty(true);
            }}
          >
            Restore suggested roles
          </Button>
        </div>
      </div>
    </section>
  );
}
