import { useCallback, useEffect, useRef, useState } from "react";
import { ClipboardList, ExternalLink, MessageCircle, Play } from "lucide-react";
import { Button, SectionTitle, Status } from "./components";
import { api } from "./bridge";
import { useNakama } from "./context";
export interface ProjectIntake {
  id: string;
  projectId: string | null;
  message: string;
  status: string;
  revision: number;
  questions: { id: string; key: string; question: string; answer: string }[];
  workflowId?: string;
  createdAt: string;
  updatedAt: string;
}
function SetupCard({
  intake,
  onDirty,
}: {
  intake: ProjectIntake;
  onDirty: (id: string, dirty: boolean) => void;
}) {
  const { state, notify, refresh, navigate, openProject } = useNakama();
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [revision, setRevision] = useState(intake.revision);
  const [projectId, setProjectId] = useState(intake.projectId || "");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const dirty = Object.keys(answers).length > 0;
  useEffect(() => {
    onDirty(
      intake.id,
      dirty ||
        (["awaiting_answers", "ready"].includes(intake.status) &&
          (Boolean(name.trim()) || projectId !== (intake.projectId || ""))),
    );
    return () => onDirty(intake.id, false);
  }, [
    intake.id,
    intake.projectId,
    intake.status,
    dirty,
    name,
    projectId,
    onDirty,
  ]);
  useEffect(() => {
    if (!dirty) setRevision(intake.revision);
  }, [intake.revision, dirty]);
  const editable = ["awaiting_answers", "ready"].includes(intake.status);
  async function request(action: string, body: unknown) {
    setBusy(true);
    try {
      await api("POST", `/api/project-intakes/${intake.id}/${action}`, body);
      setAnswers({});
      if (action === "start") {
        setName("");
      }
      await refresh();
    } catch (error) {
      notify(
        error instanceof Error ? error.message : "Project setup did not save.",
        true,
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <article className="panel setup-card">
      <header>
        <ClipboardList size={24} />
        <h3>
          {state.projects.find((p) => p.id === intake.projectId)?.name ||
            "New website project"}
        </h3>
        <Status value={intake.status} />
      </header>
      <p className="setup-request">{intake.message}</p>
      {editable && (
        <p className="small-copy">
          Answer here or dictate on Android. Keep credentials in Connections or
          a private browser session. These answers guide the plan; permissions
          are reviewed separately.
        </p>
      )}
      {intake.questions.map((question) => (
        <label className="field" key={question.id}>
          {question.question}
          <textarea
            disabled={!editable || busy}
            maxLength={2000}
            value={answers[question.id] ?? question.answer}
            onChange={(event) =>
              setAnswers((current) => ({
                ...current,
                [question.id]: event.target.value,
              }))
            }
            rows={3}
          />
        </label>
      ))}
      {dirty && revision !== intake.revision && (
        <p role="alert">
          Answers changed on another device. Copy your draft before refreshing;
          saving this stale version will be rejected.
        </p>
      )}
      <div className="button-row">
        {editable && (
          <Button
            disabled={
              !dirty ||
              busy ||
              Object.values(answers).some((answer) => !answer.trim())
            }
            onClick={() =>
              void request("answers", {
                revision,
                answers: Object.entries(answers).map(([id, answer]) => ({
                  id,
                  answer,
                })),
              })
            }
          >
            Save answers
          </Button>
        )}
        {dirty && (
          <Button
            kind="secondary"
            disabled={busy}
            onClick={() => {
              if (window.confirm("Discard these unsaved setup answers?")) {
                setAnswers({});
                setRevision(intake.revision);
              }
            }}
          >
            Reload saved answers
          </Button>
        )}
        <Button kind="secondary" onClick={() => navigate("connections")}>
          <ExternalLink size={15} /> Connections
        </Button>
        <Button kind="secondary" onClick={() => navigate("browser")}>
          Private browser / login
        </Button>
        {editable && (
          <Button
            kind="ghost"
            disabled={busy || dirty}
            onClick={() => void request("cancel", {})}
          >
            Cancel setup
          </Button>
        )}
        {intake.projectId && (
          <Button
            kind="secondary"
            onClick={() => openProject(intake.projectId!)}
          >
            Open project
          </Button>
        )}
      </div>
      {intake.status === "ready" && (
        <div className="setup-start">
          <label className="field">
            Local workspace
            <select
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
              disabled={busy}
            >
              <option value="">Create a new local project folder</option>
              {state.projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          {!projectId && (
            <label className="field">
              New local project name
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={80}
                disabled={busy}
              />
            </label>
          )}
          <Button
            disabled={busy || dirty || (!projectId && !name.trim())}
            onClick={() =>
              void request("start", {
                revision: intake.revision,
                ...(projectId ? { projectId } : { name }),
              })
            }
          >
            <Play size={15} /> Start planning
          </Button>
          <p className="small-copy">
            Creates local work only. GitHub repositories, hosted services,
            deployments and DNS changes require their own reviewed operation or
            explicit bounded grant. Connected account permissions and provider
            eligibility can still require additional attention.
          </p>
        </div>
      )}
    </article>
  );
}
export function ProjectSetupPage() {
  const { state, navigate, perform, setNavigationGuard } = useNakama();
  const dirtyCards = useRef(new Set<string>());
  const draft = useRef("");
  const onDirty = useCallback((id: string, dirty: boolean) => {
    if (dirty) dirtyCards.current.add(id);
    else dirtyCards.current.delete(id);
  }, []);
  useEffect(() => {
    setNavigationGuard(
      () =>
        !(dirtyCards.current.size || draft.current.trim()) ||
        window.confirm("Leave without saving these project setup drafts?"),
    );
    return () => setNavigationGuard(null);
  }, [setNavigationGuard]);
  useEffect(() => {
    const check = (event: BeforeUnloadEvent) => {
      if (dirtyCards.current.size || draft.current.trim()) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", check);
    return () => window.removeEventListener("beforeunload", check);
  }, []);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  draft.current = message;
  return (
    <div className="project-setup page-enter">
      <SectionTitle
        eyebrow="Before the building begins"
        title="Project setup"
        description="Agree the destination, accounts and constraints before your team starts."
        action={
          <Button kind="secondary" onClick={() => navigate("assistant")}>
            <MessageCircle size={16} /> Talk to Nakama
          </Button>
        }
      />
      <section className="panel">
        <h3>Plan a website from start to finish</h3>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            try {
              const result = await perform("POST", "/api/project-intakes", {
                message,
              });
              if (result) setMessage("");
            } finally {
              setBusy(false);
            }
          }}
        >
          <label className="field">
            Describe the website and where it should run
            <textarea
              rows={4}
              disabled={busy}
              value={message}
              maxLength={16000}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Build a website… include hosting, domain and shop requirements."
            />
          </label>
          <Button disabled={busy || !message.trim()} type="submit">
            Gather setup questions
          </Button>
        </form>
      </section>
      {[...(state.projectIntakes || [])].reverse().map((intake) => (
        <SetupCard key={intake.id} intake={intake} onDirty={onDirty} />
      ))}
    </div>
  );
}
