import { useState } from "react";
import {
  ArrowRight,
  Building2,
  Clock3,
  MessageCircle,
  Monitor,
  Network,
  Settings2,
} from "lucide-react";
import {
  Button,
  Empty,
  Mascot,
  Modal,
  SectionTitle,
  Status,
} from "./components";
import { useNakama } from "./context";
import {
  officeForest,
  officeIsCurrent,
  type OfficeNode,
} from "./agent-office-model";
import type { AgentOfficeAgent } from "./types";
import "./agent-office.css";
import { BrowserFrame } from "./browser-studio";

function words(value: string) {
  return value.replaceAll(/[_-]/g, " ");
}
function providerName(id: string) {
  return id === "codex" ? "ChatGPT" : id === "claude" ? "Claude" : id || "Host";
}
function modelTask(agent: AgentOfficeAgent) {
  return (
    agent.sourceKind === "task" &&
    (agent.receiptKind === "model_task" ||
      (!agent.receiptKind && ["codex", "claude"].includes(agent.providerId)))
  );
}
function stamp(value: string) {
  const date = new Date(value);
  return Number.isNaN(+date) ? "Not recorded" : date.toLocaleString();
}

function Desk({
  node,
  parent,
  onInspect,
}: {
  node: OfficeNode;
  parent?: AgentOfficeAgent;
  onInspect: (id: string) => void;
}) {
  const { agent, children } = node;
  const { state } = useNakama();
  const browser = state.browserStudio?.sessions.find(
    (session) =>
      session.status !== "closed" &&
      ((agent.taskId && session.taskId === agent.taskId) ||
        (agent.sourceKind === "workflow" &&
          session.workflowId === agent.workflowId)),
  );
  const tone =
    agent.providerId === "codex"
      ? "green"
      : agent.providerId === "claude"
        ? "orange"
        : "blue";
  return (
    <li className="office-branch">
      <article
        className={`office-desk office-${tone} ${agent.status === "running" && modelTask(agent) ? "office-working" : ""}`}
      >
        <div className="office-desk-heading">
          <span className="office-provider">
            {providerName(agent.providerId)}
          </span>
          <Status value={agent.status} />
        </div>
        <div className="office-workstation">
          <div className="office-pet" aria-hidden="true">
            <Mascot size={112} tone={tone} />
          </div>
          <button
            className="office-screen"
            aria-label={`Open screen for ${agent.name}`}
            onClick={() => onInspect(agent.id)}
          >
            <span className="office-screen-bar">
              <Monitor size={14} />
              <span>
                {agent.sourceKind === "workflow"
                  ? "Workflow coordinator"
                  : "Task receipt"}
              </span>
              <ArrowRight size={14} />
            </span>
            {browser && <BrowserFrame session={browser} compact />}
            {browser?.status === "attention" && (
              <span className="browser-attention-badge">
                Needs your attention
              </span>
            )}
            <strong>{agent.title || "Untitled task"}</strong>
            <span className="office-phase">
              {words(agent.phase || agent.status)}
            </span>
            <span className="office-screen-hint">Open task & output</span>
          </button>
          <div className="office-table" aria-hidden="true">
            <span />
            <i />
          </div>
        </div>
        <h2>{agent.name}</h2>
        <p className="office-role">
          {words(agent.role)}
          {agent.sourceKind === "workflow" && " · orchestration record"}
        </p>
        <p className="office-parent">
          <Network size={13} />
          {parent
            ? `Reports to ${parent.name}`
            : agent.parentId
              ? "Parent outside retained history"
              : "Top-level assignment"}
        </p>
      </article>
      {children.length > 0 && (
        <ul
          className="office-children"
          aria-label={`Assignments under ${agent.name}`}
        >
          {children.map((child) => (
            <Desk
              key={child.agent.id}
              node={child}
              parent={agent}
              onInspect={onInspect}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

export function AgentOfficePage() {
  const { state, navigate, openAssistant, openProject } = useNakama();
  const [history, setHistory] = useState(false);
  const [selectedId, setSelectedId] = useState<string>();
  const agents = state.agentOffice?.agents || [];
  const supported = state.agentOffice?.version === 1;
  const roots = supported ? officeForest(agents, history) : [];
  const selected = agents.find((agent) => agent.id === selectedId);
  const running = agents.filter(
    (agent) => modelTask(agent) && agent.status === "running",
  ).length;
  const current = agents.filter(officeIsCurrent).length;
  const selectedBrowsers =
    state.browserStudio?.sessions.filter(
      (session) =>
        session.status !== "closed" &&
        ((selected?.taskId && session.taskId === selected.taskId) ||
          (selected?.sourceKind === "workflow" &&
            session.workflowId === selected.workflowId)),
    ) || [];
  const selectedParent = selected?.parentId
    ? agents.find((agent) => agent.id === selected.parentId)
    : undefined;
  const project = state.projects.find(
    (item) => item.id === selected?.projectId,
  );
  return (
    <div className="page-enter agent-office">
      <SectionTitle
        eyebrow="A LITTLE OFFICE. YOUR REAL TEAM."
        title="Agent office"
        description="Visit the desks behind your projects. Select a screen to see its task, progress and recorded output."
        action={
          <Button kind="secondary" onClick={() => navigate("assistant")}>
            <MessageCircle size={16} />
            Talk to Nakama
          </Button>
        }
      />
      <div className="office-toolbar">
        <div className="office-tabs" role="group" aria-label="Office view">
          <button aria-pressed={!history} onClick={() => setHistory(false)}>
            Current work <span>{current}</span>
          </button>
          <button aria-pressed={history} onClick={() => setHistory(true)}>
            <Clock3 size={15} />
            Including history <span>{agents.length}</span>
          </button>
        </div>
        <Button kind="ghost" onClick={() => navigate("agents")}>
          <Settings2 size={16} />
          AI team & connections
        </Button>
      </div>
      <div className="office-room">
        <div className="office-room-header">
          <div>
            <Building2 size={19} />
            <strong>Nakama studio</strong>
            <span>
              {running
                ? `${running} model task${running === 1 ? "" : "s"} running`
                : "No model tasks running"}
            </span>
          </div>
          <span className="office-room-sign">
            <i className="office-green-dot" />
            ChatGPT
            <i className="office-orange-dot" />
            Claude
          </span>
        </div>
        <div className="office-decoration" aria-hidden="true">
          <div className="office-window">
            <span>☁</span>
            <i />
          </div>
          <div className="office-wall-note">
            make little things
            <br />
            possible ✦
          </div>
          <div className="office-plant">
            ♧<span />
          </div>
        </div>
        {!supported ? (
          <div className="office-empty">
            <Empty
              icon={<Monitor size={30} />}
              title="Office status unavailable"
            >
              This host has not supplied a compatible office snapshot. Reconnect
              or update the host to see its task records.
            </Empty>
          </div>
        ) : roots.length ? (
          <ul className="office-desks" aria-label="Agent desks">
            {roots.map((node) => (
              <Desk key={node.agent.id} node={node} onInspect={setSelectedId} />
            ))}
          </ul>
        ) : (
          <div className="office-empty">
            <Mascot size={115} />
            <h2>
              {history
                ? "A fresh office, full of possibilities."
                : "The office is taking a breather."}
            </h2>
            <p>
              {history
                ? "Your team’s desks appear when Nakama starts a task. No agents have been recorded yet."
                : "There are no current assignments. Finished and interrupted work stays in history while the host retains it."}
            </p>
            <Button kind="secondary" onClick={() => navigate("assistant")}>
              Give Nakama a task
              <ArrowRight size={16} />
            </Button>
          </div>
        )}
      </div>
      <p className="office-footnote">
        <Monitor size={15} />
        Screens show task receipts, available output and associated live browser
        previews. Private sign-in screens are hidden here. They never show
        private model thinking. A coordinator desk represents a workflow, not
        another running model.
      </p>
      {selectedId && (
        <Modal
          wide
          title={
            selected
              ? `${selected.name} · desk screen`
              : "Desk no longer available"
          }
          description="Recorded task details from your host."
          onClose={() => setSelectedId(undefined)}
        >
          {selected ? (
            <div className="office-inspector">
              <div className="office-inspector-title">
                <div>
                  <span className="eyebrow">
                    {selected.sourceKind === "workflow"
                      ? "WORKFLOW COORDINATOR"
                      : modelTask(selected)
                        ? "MODEL TASK RECEIPT"
                        : "TOOL TASK RECEIPT"}
                  </span>
                  <h3>{selected.title}</h3>
                </div>
                <Status value={selected.status} />
              </div>
              {selectedBrowsers.map((session) => (
                <section key={session.id}>
                  <BrowserFrame session={session} compact />
                  {session.attentionReason && (
                    <p className="browser-attention">
                      {session.attentionReason}
                    </p>
                  )}
                  <Button
                    kind="secondary"
                    onClick={() => {
                      setSelectedId(undefined);
                      navigate("browser");
                    }}
                  >
                    Open live browser / take control
                  </Button>
                </section>
              ))}
              <dl className="office-detail-grid">
                <div>
                  <dt>Role</dt>
                  <dd>{words(selected.role)}</dd>
                </div>
                <div>
                  <dt>Phase</dt>
                  <dd>{words(selected.phase || selected.status)}</dd>
                </div>
                <div>
                  <dt>Account</dt>
                  <dd>{providerName(selected.providerId)}</dd>
                </div>
                <div>
                  <dt>Model</dt>
                  <dd>{selected.model || "Not recorded"}</dd>
                </div>
                <div>
                  <dt>Requested effort</dt>
                  <dd>{selected.requestedEffort || "Not recorded"}</dd>
                </div>
                <div>
                  <dt>Effective effort</dt>
                  <dd>{selected.effectiveEffort || "Not recorded"}</dd>
                </div>
                <div>
                  <dt>Reports to</dt>
                  <dd>
                    {selectedParent?.name ||
                      (selected.parentId
                        ? "Outside retained history"
                        : "Top-level assignment")}
                  </dd>
                </div>
                <div>
                  <dt>Project</dt>
                  <dd>
                    {project?.name ||
                      (selected.projectId
                        ? "No longer available"
                        : "General conversation")}
                  </dd>
                </div>
                <div>
                  <dt>Created</dt>
                  <dd>{stamp(selected.createdAt)}</dd>
                </div>
                <div>
                  <dt>Updated</dt>
                  <dd>{stamp(selected.updatedAt || selected.createdAt)}</dd>
                </div>
              </dl>
              {selected.summary && (
                <section>
                  <h4>Latest summary</h4>
                  <p className="office-receipt-text">{selected.summary}</p>
                </section>
              )}
              {selected.error && (
                <section className="office-receipt-error">
                  <h4>Needs attention</h4>
                  <p className="office-receipt-text">{selected.error}</p>
                </section>
              )}
              <section>
                <h4>Recorded output</h4>
                {selected.output ? (
                  <pre
                    className="office-output"
                    tabIndex={0}
                    aria-label="Recorded output"
                  >
                    {selected.output}
                  </pre>
                ) : (
                  <p className="small-copy">
                    No output has been recorded for this desk yet. Status
                    updates do not imply that a result is ready.
                  </p>
                )}
                {selected.outputTruncated && (
                  <p className="small-copy">
                    This preview is shortened by the host. Open the project for
                    the retained task history.
                  </p>
                )}
              </section>
              <div className="button-row">
                <Button
                  onClick={() => {
                    setSelectedId(undefined);
                    openAssistant(project?.id || "");
                  }}
                >
                  <MessageCircle size={16} />
                  Ask Nakama for an update
                </Button>
                {project && (
                  <Button
                    kind="secondary"
                    onClick={() => {
                      setSelectedId(undefined);
                      openProject(project.id);
                    }}
                  >
                    Open project
                    <ArrowRight size={16} />
                  </Button>
                )}
              </div>
            </div>
          ) : (
            <p>
              This task has left the host’s retained history. Close this screen
              to return to the current office.
            </p>
          )}
        </Modal>
      )}
    </div>
  );
}
