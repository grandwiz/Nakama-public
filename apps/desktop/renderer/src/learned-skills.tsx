import { useEffect, useRef, useState } from "react";
import { BookOpen, Check, Pencil, Plus, Trash2 } from "lucide-react";
import {
  Button,
  Empty,
  SectionTitle,
  Toggle,
  relativeDate,
} from "./components";
import { previewMode } from "./bridge";
import { useNakama } from "./context";
import "./learning-github.css";

export interface LearnedSkill {
  id: string;
  title: string;
  description: string;
  whenToUse: string;
  steps: string[];
  tags: string[];
  enabled: boolean;
  status: "ready" | "candidate";
  source: {
    kind: string;
    detail?: string;
    workflowId?: string;
    projectId?: string;
  };
  createdAt: string;
  updatedAt: string;
  reviewedAt?: string;
  lastUsedAt?: string;
  useCount: number;
}
export interface SkillLibrary {
  version: number;
  learningEnabled: boolean;
  reuseEnabled: boolean;
  skills: LearnedSkill[];
  receipts: {
    id: string;
    taskId: string;
    workflowId?: string;
    role: string;
    skillIds: string[];
    createdAt: string;
  }[];
}
const blank = {
  title: "",
  description: "",
  whenToUse: "",
  steps: "",
  tags: "",
  enabled: true,
};
type Draft = typeof blank;
function fromSkill(skill: LearnedSkill): Draft {
  return {
    title: skill.title,
    description: skill.description,
    whenToUse: skill.whenToUse,
    steps: skill.steps.join("\n"),
    tags: skill.tags.join(", "),
    enabled: skill.enabled,
  };
}

export function LearnedSkillsPage() {
  const { state, perform, setNavigationGuard } = useNakama();
  const library = state.skillLibrary;
  const [draft, setDraft] = useState<Draft>({ ...blank });
  const [original, setOriginal] = useState<Draft>({ ...blank });
  const [editing, setEditing] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [candidatesOnly, setCandidatesOnly] = useState(false);
  const alive = useRef(true);
  const dirty = JSON.stringify(draft) !== JSON.stringify(original);
  const entries = library?.skills || [];
  const editedSkill = entries.find((skill) => skill.id === editing);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    setNavigationGuard(
      dirty
        ? () => window.confirm("Discard your unsaved skill changes?")
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
  function load(skill?: LearnedSkill) {
    if (dirty && !window.confirm("Discard your unsaved skill changes?")) return;
    const next = skill ? fromSkill(skill) : { ...blank };
    setDraft(next);
    setOriginal(next);
    setEditing(skill?.id);
  }
  async function act(
    method: string,
    path: string,
    body: unknown,
    message: string,
    reset = false,
  ) {
    setBusy(true);
    try {
      const result = await perform(method, path, body, message);
      if (result && reset && alive.current) {
        setDraft({ ...blank });
        setOriginal({ ...blank });
        setEditing(undefined);
      }
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  const steps = draft.steps
    .split("\n")
    .map((step) => step.trim())
    .filter(Boolean);
  const tags = draft.tags
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
  const valid = Boolean(
    draft.title.trim() &&
    draft.description.trim() &&
    draft.whenToUse.trim() &&
    steps.length &&
    steps.length <= 12 &&
    steps.every((step) => step.length <= 500) &&
    tags.length <= 8 &&
    tags.every((tag) => tag.length <= 40),
  );
  return (
    <div className="page-enter">
      <SectionTitle
        eyebrow="A LITTLE WISER, TOGETHER"
        title="Learned skills"
        description="Teach Nakama a useful method once, then let the right agents draw on it again."
      />
      {previewMode || library?.version !== 1 ? (
        <Empty
          icon={<BookOpen size={30} />}
          title="Skills need an updated Windows host"
        >
          Open the current Control Center to save and reuse skills.
        </Empty>
      ) : (
        <>
          <section className="panel learning-intro">
            <BookOpen size={28} />
            <div>
              <h3>Methods your team can remember</h3>
              <p>
                Skills describe how to approach a task. Core Memory keeps
                personal preferences. Relevant skills are shared as context,
                without an extra learning call. They never grant permissions or
                prove that a method has been tested.
              </p>
            </div>
          </section>
          <section
            className="panel skill-controls"
            aria-label="Skill learning settings"
          >
            <Toggle
              disabled={busy}
              checked={library.learningEnabled}
              label="Learn useful methods"
              description="Save explicit teaching and candidates from successfully reviewed projects."
              onChange={(learningEnabled) =>
                void act(
                  "PATCH",
                  "/api/skills/settings",
                  { learningEnabled },
                  "Skill learning preference saved.",
                )
              }
            />
            <Toggle
              disabled={busy}
              checked={library.reuseEnabled}
              label="Reuse relevant skills"
              description="Include a small relevant selection in Nakama and worker prompts."
              onChange={(reuseEnabled) =>
                void act(
                  "PATCH",
                  "/api/skills/settings",
                  { reuseEnabled },
                  "Skill reuse preference saved.",
                )
              }
            />
            {state.config.memoryEnabled === false && (
              <p className="inline-note">
                Conversation memory is off in Settings, so automatic learning
                and reuse are paused. Your library remains editable.
              </p>
            )}
          </section>
          <div className="skill-layout">
            <section className="panel skill-editor" aria-label="Skill editor">
              <h3>{editing ? "Edit a saved skill" : "Teach a skill"}</h3>
              {editedSkill?.status === "candidate" && (
                <p className="inline-note">
                  This candidate needs your review before agents can reuse it.
                  Editing it does not replace that review.
                </p>
              )}
              {editing && !editedSkill && (
                <p className="inline-error">
                  This skill was removed elsewhere. Your draft is kept; choose
                  New skill to start again.
                </p>
              )}
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  void act(
                    editing ? "PATCH" : "POST",
                    `/api/skills${editing ? `/${editing}` : ""}`,
                    {
                      ...draft,
                      title: draft.title.trim(),
                      description: draft.description.trim(),
                      whenToUse: draft.whenToUse.trim(),
                      steps,
                      tags,
                    },
                    "Skill saved.",
                    true,
                  );
                }}
              >
                <fieldset disabled={busy} className="plain-fieldset">
                  <label>
                    Skill name
                    <input
                      value={draft.title}
                      maxLength={80}
                      onChange={(event) =>
                        setDraft({ ...draft, title: event.target.value })
                      }
                      placeholder="Review an accessible form"
                      required
                    />
                  </label>
                  <label>
                    What it helps with
                    <textarea
                      value={draft.description}
                      maxLength={500}
                      rows={2}
                      onChange={(event) =>
                        setDraft({ ...draft, description: event.target.value })
                      }
                      required
                    />
                  </label>
                  <label>
                    When to use it
                    <textarea
                      value={draft.whenToUse}
                      maxLength={500}
                      rows={2}
                      onChange={(event) =>
                        setDraft({ ...draft, whenToUse: event.target.value })
                      }
                      placeholder="When creating or reviewing a web form"
                      required
                    />
                  </label>
                  <label>
                    Steps, one per line
                    <textarea
                      value={draft.steps}
                      maxLength={6100}
                      rows={6}
                      onChange={(event) =>
                        setDraft({ ...draft, steps: event.target.value })
                      }
                      placeholder={
                        "Check each input has a visible label\nReview keyboard focus order\nDescribe checks that still need a real browser"
                      }
                      required
                    />
                  </label>
                  <p className="small-copy">
                    Up to 12 steps of 500 characters. Keep passwords and
                    credentials out of skills.
                  </p>
                  <label>
                    Tags, separated by commas
                    <input
                      value={draft.tags}
                      maxLength={334}
                      onChange={(event) =>
                        setDraft({ ...draft, tags: event.target.value })
                      }
                      placeholder="accessibility, forms, web"
                    />
                  </label>
                  <label className="check-label">
                    <input
                      type="checkbox"
                      disabled={editedSkill?.status === "candidate"}
                      checked={draft.enabled}
                      onChange={(event) =>
                        setDraft({ ...draft, enabled: event.target.checked })
                      }
                    />
                    Use when relevant after review
                  </label>
                  <div className="button-row">
                    <Button
                      type="submit"
                      disabled={!valid || Boolean(editing && !editedSkill)}
                      busy={busy}
                    >
                      <Check size={15} /> Save skill
                    </Button>
                    <Button
                      type="button"
                      kind="secondary"
                      onClick={() => load()}
                    >
                      <Plus size={15} />
                      {editing ? "Cancel edit" : "Clear draft"}
                    </Button>
                  </div>
                </fieldset>
              </form>
            </section>
            <section className="skill-library" aria-label="Saved skills">
              <div className="skill-heading">
                <h3>Your library · {entries.length}</h3>
                <label className="check-label">
                  <input
                    type="checkbox"
                    checked={candidatesOnly}
                    onChange={(event) =>
                      setCandidatesOnly(event.target.checked)
                    }
                  />
                  Candidates only
                </label>
              </div>
              {!entries.some(
                (skill) => !candidatesOnly || skill.status === "candidate",
              ) && (
                <Empty
                  icon={<BookOpen size={28} />}
                  title={
                    candidatesOnly
                      ? "No candidates waiting"
                      : "Your first skill starts here"
                  }
                >
                  Teach a method in the editor, or say “Teach skill: NAME |
                  When: CONTEXT | Steps: FIRST STEP; SECOND STEP”.
                </Empty>
              )}
              {entries
                .filter(
                  (skill) => !candidatesOnly || skill.status === "candidate",
                )
                .map((skill) => (
                  <article
                    key={skill.id}
                    className={`panel skill-card ${skill.status}`}
                  >
                    <div className="skill-heading">
                      <h3>{skill.title}</h3>
                      <span className="skill-state">
                        {skill.status === "candidate"
                          ? "Review candidate"
                          : skill.enabled
                            ? "Ready to reuse"
                            : "Paused"}
                      </span>
                    </div>
                    <p>{skill.description}</p>
                    <p>
                      <strong>Use when:</strong> {skill.whenToUse}
                    </p>
                    <details>
                      <summary>Read method and source</summary>
                      <ol>
                        {skill.steps.map((step, index) => (
                          <li key={index}>{step}</li>
                        ))}
                      </ol>
                      <p className="small-copy">
                        Source: {skill.source.kind.replaceAll("_", " ")}.{" "}
                        {skill.source.detail}
                      </p>
                      {skill.source.workflowId && (
                        <p className="small-copy">
                          Workflow: {skill.source.workflowId}
                        </p>
                      )}
                    </details>
                    {skill.tags.length > 0 && (
                      <p className="small-copy">{skill.tags.join(" · ")}</p>
                    )}
                    <p className="small-copy">
                      Selected for {skill.useCount || 0} task prompt
                      {skill.useCount === 1 ? "" : "s"}
                      {skill.lastUsedAt
                        ? ` · last ${relativeDate(skill.lastUsedAt)}`
                        : ""}
                      . Selection records do not prove the method was supplied
                      or followed.
                    </p>
                    <div className="button-row">
                      <Button
                        kind="secondary"
                        disabled={busy}
                        onClick={() => load(skill)}
                      >
                        <Pencil size={14} /> Edit
                      </Button>
                      {skill.status === "candidate" ? (
                        <Button
                          disabled={busy || dirty}
                          onClick={() => {
                            if (
                              window.confirm(
                                `Have you read “${skill.title}” and want to make it available for reuse?`,
                              )
                            )
                              void act(
                                "POST",
                                `/api/skills/${skill.id}/accept`,
                                {},
                                "Skill reviewed and ready for reuse.",
                              );
                          }}
                        >
                          <Check size={14} /> Accept method
                        </Button>
                      ) : (
                        <Button
                          kind="secondary"
                          disabled={busy || dirty}
                          onClick={() =>
                            void act(
                              "PATCH",
                              `/api/skills/${skill.id}`,
                              { enabled: !skill.enabled },
                              skill.enabled
                                ? "Skill paused."
                                : "Skill enabled.",
                            )
                          }
                        >
                          {skill.enabled ? "Pause" : "Enable"}
                        </Button>
                      )}
                      <Button
                        kind="secondary"
                        disabled={busy}
                        onClick={() => {
                          if (
                            window.confirm(
                              `Forget the saved skill “${skill.title}”? Existing conversation and task history stay unchanged.`,
                            )
                          )
                            void act(
                              "DELETE",
                              `/api/skills/${skill.id}`,
                              undefined,
                              "Skill forgotten.",
                              editing === skill.id,
                            );
                        }}
                      >
                        <Trash2 size={14} /> Forget
                      </Button>
                    </div>
                  </article>
                ))}
            </section>
          </div>
        </>
      )}
    </div>
  );
}
