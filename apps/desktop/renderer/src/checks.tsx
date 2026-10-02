import { useEffect, useState } from "react";
import {
  ArrowUpRight,
  CheckCircle2,
  ClipboardCheck,
  Info,
  RefreshCw,
  ShieldCheck,
  Terminal,
} from "lucide-react";
import { api, previewMode } from "./bridge";
import { Button, Empty, SectionTitle } from "./components";
import { useNakama } from "./context";
import type { Project } from "./types";

interface ProjectCheck {
  name: string;
  script: string;
  preScript?: string;
  postScript?: string;
}
interface CheckCatalogue {
  supported: boolean;
  detail?: string;
  runtime: { available: boolean; detail?: string };
  manifestHash?: string;
  checks: ProjectCheck[];
  active?: boolean;
}
const checkLabels: Record<string, string> = {
  test: "Run project tests",
  lint: "Check code style",
  typecheck: "Check types",
  check: "Run project checks",
  build: "Build the project",
};

export function ProjectChecks({
  project,
  hasUnsavedChanges = false,
}: {
  project: Project;
  hasUnsavedChanges?: boolean;
}) {
  const { state, perform, navigate } = useNakama();
  const [catalogue, setCatalogue] = useState<CheckCatalogue>();
  const [loading, setLoading] = useState(!previewMode);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const [requesting, setRequesting] = useState("");
  const [requested, setRequested] = useState("");
  const active = Boolean(
    catalogue?.active ||
    state.tasks.some(
      (task) =>
        task.projectId === project.id &&
        task.kind === "project_check" &&
        ["running", "queued"].includes(task.status),
    ),
  );
  useEffect(() => {
    if (previewMode) return;
    let cancelled = false;
    setLoading(true);
    setError("");
    setCatalogue(undefined);
    setRequested("");
    void api<CheckCatalogue>("GET", `/api/projects/${project.id}/checks`)
      .then((result) => {
        if (!cancelled) setCatalogue(result);
      })
      .catch((reason: unknown) => {
        if (!cancelled)
          setError(
            reason instanceof Error
              ? reason.message
              : "Could not discover this project’s checks.",
          );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [project.id, revision]);

  const request = async (name: string) => {
    if (
      hasUnsavedChanges ||
      !catalogue?.runtime.available ||
      !catalogue.manifestHash ||
      active ||
      requesting
    )
      return;
    setRequesting(name);
    const result = await perform(
      "POST",
      `/api/projects/${project.id}/checks/request`,
      {
        name,
        manifestHash: catalogue.manifestHash,
      },
      `${name} sent for approval. Review the exact scripts in Activity & approvals.`,
    );
    if (result) setRequested(name);
    setRequesting("");
  };
  const canRequest = Boolean(
    catalogue?.supported &&
    catalogue.runtime.available &&
    catalogue.manifestHash &&
    !hasUnsavedChanges &&
    !active &&
    !requesting,
  );
  return (
    <section className="panel project-checks" aria-label="Project checks">
      <SectionTitle
        eyebrow="REVIEW, THEN RUN"
        title="Project checks"
        description="Choose a recognised npm script from this project’s root package.json. Each run needs your approval."
        action={
          <Button
            kind="secondary"
            disabled={previewMode || Boolean(requesting)}
            busy={loading}
            onClick={() => setRevision((current) => current + 1)}
          >
            {!loading && <RefreshCw size={14} />} Refresh checks
          </Button>
        }
      />
      {hasUnsavedChanges && (
        <div className="inline-note check-note">
          <Info size={16} />
          <span>
            You have unsaved editor changes. Save the file, then refresh checks
            before requesting a run.
          </span>
        </div>
      )}
      {active && (
        <div className="inline-note check-note" role="status">
          <Info size={16} />
          <span>
            A project check is already running. Follow its output in project
            activity, then refresh checks when it finishes.
          </span>
        </div>
      )}
      {previewMode ? (
        <Empty
          icon={<ClipboardCheck size={29} />}
          title="Project checks need the Windows app"
        >
          Open this project in Nakama Control Center to discover its scripts and
          request a local run.
        </Empty>
      ) : error ? (
        <div className="check-error" role="alert">
          <strong>Checks could not be loaded</strong>
          <p>{error}</p>
          <Button
            kind="secondary"
            onClick={() => setRevision((current) => current + 1)}
          >
            Try again
          </Button>
        </div>
      ) : loading ? (
        <div className="check-loading" role="status">
          <RefreshCw className="spin" size={19} />
          <span>Reading package.json…</span>
        </div>
      ) : !catalogue?.supported ? (
        <Empty
          icon={<ClipboardCheck size={29} />}
          title={
            catalogue?.manifestHash && !catalogue.checks.length
              ? "No supported scripts yet"
              : "Project checks are not available"
          }
        >
          {catalogue?.detail ||
            "Add a valid package.json to the project root to discover its supported npm scripts."}
        </Empty>
      ) : (
        <>
          {!catalogue.runtime.available && (
            <div className="inline-note check-note" role="status">
              <Info size={17} />
              <span>
                <strong>Runtime unavailable.</strong>{" "}
                {catalogue.runtime.detail ||
                  "Install Node.js and npm on this PC, restart Nakama, then refresh checks."}
              </span>
            </div>
          )}
          {catalogue.checks.length ? (
            <>
              {catalogue.detail && (
                <p className="check-detail">{catalogue.detail}</p>
              )}
              <div className="check-grid">
                {catalogue.checks.map((check) => (
                  <article className="check-card" key={check.name}>
                    <div className="check-card-heading">
                      <span className="check-icon">
                        <Terminal size={17} />
                      </span>
                      <div>
                        <h3>{checkLabels[check.name] || check.name}</h3>
                        <small>npm run {check.name}</small>
                      </div>
                      <span className="check-script-name">{check.name}</span>
                    </div>
                    <dl className="check-scripts">
                      {check.preScript && (
                        <div>
                          <dt>Before · pre{check.name}</dt>
                          <dd>
                            <code>{check.preScript}</code>
                          </dd>
                        </div>
                      )}
                      <div>
                        <dt>Main · {check.name}</dt>
                        <dd>
                          <code>{check.script}</code>
                        </dd>
                      </div>
                      {check.postScript && (
                        <div>
                          <dt>After · post{check.name}</dt>
                          <dd>
                            <code>{check.postScript}</code>
                          </dd>
                        </div>
                      )}
                    </dl>
                    <Button
                      kind="secondary"
                      disabled={!canRequest}
                      busy={requesting === check.name}
                      aria-label={`Request ${check.name} approval`}
                      onClick={() => void request(check.name)}
                    >
                      <ShieldCheck size={15} />
                      Request approval
                    </Button>
                  </article>
                ))}
              </div>
              {!catalogue.manifestHash && (
                <p className="inline-error">
                  Refresh checks to load the current package.json before
                  requesting a run.
                </p>
              )}
              {requested && (
                <div className="check-requested" role="status">
                  <CheckCircle2 size={17} />
                  <span>
                    <strong>{requested}</strong> was sent for approval. Review
                    its status in Activity & approvals.
                  </span>
                  <Button kind="ghost" onClick={() => navigate("activity")}>
                    Review approvals
                    <ArrowUpRight size={15} />
                  </Button>
                </div>
              )}
            </>
          ) : (
            <Empty
              icon={<ClipboardCheck size={29} />}
              title="No supported scripts yet"
            >
              {catalogue.detail ||
                "This package.json has no test, lint, typecheck, check, or build script. Add one in your editor, save, then refresh."}
            </Empty>
          )}
        </>
      )}
      <div className="check-safety">
        <ShieldCheck size={18} />
        <div>
          <strong>You approve each run</strong>
          <p>
            Scripts run with your Windows account’s permissions and can change
            files or use the network. Review the before, main, and after scripts
            in Activity & approvals. A changed package.json needs a new
            approval. Dependencies are not installed automatically.
          </p>
        </div>
      </div>
    </section>
  );
}
