import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./bridge";
import { Button, Status } from "./components";
import { useNakama } from "./context";

type UpgradeRequest = {
  id: string;
  title: string;
  request: string;
  status: string;
  revision: number;
  detail?: string;
  error?: string;
  projectId?: string;
  workflowId?: string;
  workflowStatus?: string;
  approvalId?: string;
  readiness?: { ready: boolean; detail: string; sourceHash?: string };
  questions?: { id: string; text: string; answer?: string }[];
  artifact?: {
    platform: string;
    version: string;
    sha256: string;
    signerVerification?: string;
  };
  recovery?: { detail: string };
};
type Snapshot = {
  requests: UpgradeRequest[];
  settings: {
    sourcePath?: string;
    trustedKeys?: { id: string; publicKey: string }[];
  };
  capabilities: { detail: string };
};

export function SelfMaintenancePanel({
  onDirty,
}: {
  onDirty: (dirty: boolean) => void;
}) {
  const { setNavigationGuard, openAssistant, openApproval } = useNakama();
  const [snapshot, setSnapshot] = useState<Snapshot>();
  const [title, setTitle] = useState(""),
    [request, setRequest] = useState(""),
    [source, setSource] = useState("");
  const [keyId, setKeyId] = useState(""),
    [publicKey, setPublicKey] = useState("");
  const [manifest, setManifest] = useState(""),
    [artifact, setArtifact] = useState(""),
    [previousManifest, setPreviousManifest] = useState(""),
    [previousArtifact, setPreviousArtifact] = useState("");
  const [selected, setSelected] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [recovery, setRecovery] = useState<{
    backupPath: string;
    previousArtifactPath: string;
    detail: string;
  }>();
  const mounted = useRef(false),
    sequence = useRef(0),
    mutation = useRef(false),
    dirtyRef = useRef(false);
  const dirty = Boolean(
    title ||
    request ||
    source ||
    keyId ||
    publicKey ||
    manifest ||
    artifact ||
    previousManifest ||
    previousArtifact,
  );
  dirtyRef.current = dirty;
  const load = useCallback(async () => {
    if (mutation.current) return;
    const token = ++sequence.current;
    try {
      const value = await api<Snapshot>("GET", "/api/self-maintenance");
      if (mounted.current && token === sequence.current) setSnapshot(value);
    } catch (e) {
      if (mounted.current && token === sequence.current)
        setError(e instanceof Error ? e.message : "Upgrade state unavailable.");
    }
  }, []);
  useEffect(() => {
    mounted.current = true;
    void load();
    const timer = setInterval(() => void load(), 6000);
    setNavigationGuard(
      () =>
        !dirtyRef.current ||
        window.confirm("Leave without saving upgrade drafts?"),
    );
    const before = (e: BeforeUnloadEvent) => {
      if (dirtyRef.current) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", before);
    return () => {
      mounted.current = false;
      sequence.current++;
      clearInterval(timer);
      setNavigationGuard(null);
      onDirty(false);
      window.removeEventListener("beforeunload", before);
    };
  }, [load, onDirty, setNavigationGuard]);
  useEffect(() => onDirty(dirty), [dirty, onDirty]);
  async function act(
    method: string,
    route: string,
    body: unknown,
    onSuccess?: () => void,
  ) {
    if (mutation.current) return;
    mutation.current = true;
    sequence.current++;
    setBusy(true);
    setError("");
    try {
      const result = await api(method, route, body);
      if (mounted.current) {
        onSuccess?.();
        if (route.endsWith("/recovery"))
          setRecovery(
            result as {
              backupPath: string;
              previousArtifactPath: string;
              detail: string;
            },
          );
      }
    } catch (e) {
      if (mounted.current)
        setError(e instanceof Error ? e.message : "Upgrade operation failed.");
    } finally {
      mutation.current = false;
      if (mounted.current) {
        setBusy(false);
        await load();
      }
    }
  }
  const chosen = snapshot?.requests.find((r) => r.id === selected);
  const lifecycle = (
    row: UpgradeRequest,
    action: string,
    extra: Record<string, unknown> = {},
  ) =>
    void act("POST", `/api/self-maintenance/${row.id}/${action}`, {
      expectedRevision: row.revision,
      ...extra,
    });
  return (
    <fieldset
      disabled={busy}
      style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}
    >
      <div className="self-maintenance-panel stack">
        <div className="card">
          <h2>Update readiness</h2>
          <p>
            {snapshot?.capabilities.detail ||
              "Save improvements, prepare isolated source, review signed updates and keep recovery copies."}
          </p>
          <p>
            Provider usage stays on hold until you explicitly release one
            request. The reset date never starts work automatically.
          </p>
          {error && <p role="alert">{error}</p>}
          <Button disabled={busy} onClick={() => void load()}>
            Refresh
          </Button>
        </div>
        <div className="card">
          <h3>Request an improvement</h3>
          <label>
            Title
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={160}
            />
          </label>
          <label>
            Requested change
            <textarea
              value={request}
              onChange={(e) => setRequest(e.target.value)}
              maxLength={16000}
            />
          </label>
          <Button
            disabled={busy || !title.trim() || !request.trim()}
            onClick={() =>
              void act(
                "POST",
                "/api/self-maintenance",
                { title, request },
                () => {
                  setTitle("");
                  setRequest("");
                },
              )
            }
          >
            Save request without model usage
          </Button>
        </div>
        <details className="card">
          <summary>Source and trusted publisher</summary>
          <p>
            Source folder: {snapshot?.settings.sourcePath || "Not configured"}.
            Only tracked working files in an ordinary Git checkout are exported.
            Exports exclude runtime data, signing keys, reports, installers and
            private checklist files.
          </p>
          <label>
            Reviewed Nakama source folder
            <input value={source} onChange={(e) => setSource(e.target.value)} />
          </label>
          <Button
            disabled={busy || !source.trim()}
            onClick={() =>
              void act(
                "PATCH",
                "/api/self-maintenance/settings",
                { sourcePath: source },
                () => setSource(""),
              )
            }
          >
            Save source folder
          </Button>
          <p>
            Trusted Ed25519 publishers:{" "}
            {snapshot?.settings.trustedKeys?.map((k) => k.id).join(", ") ||
              "None"}
            . Only add a publisher key obtained through a trusted channel. Never
            paste a private key.
          </p>
          <label>
            Publisher key ID
            <input
              value={keyId}
              onChange={(e) => setKeyId(e.target.value)}
              maxLength={64}
            />
          </label>
          <label>
            Ed25519 public key (PEM)
            <textarea
              value={publicKey}
              onChange={(e) => setPublicKey(e.target.value)}
              maxLength={4096}
            />
          </label>
          <Button
            disabled={busy || !keyId || !publicKey}
            onClick={() => {
              if (
                window.confirm(
                  `Trust publisher ${keyId} for signed Nakama updates?`,
                )
              )
                void act(
                  "PATCH",
                  "/api/self-maintenance/settings",
                  {
                    trustedKeys: [
                      ...(snapshot?.settings.trustedKeys || []).filter(
                        (k) => k.id !== keyId,
                      ),
                      { id: keyId, publicKey },
                    ],
                  },
                  () => {
                    setKeyId("");
                    setPublicKey("");
                  },
                );
            }}
          >
            Trust publisher
          </Button>
          {snapshot?.settings.trustedKeys?.map((k) => (
            <Button
              key={k.id}
              disabled={busy}
              onClick={() =>
                void act("PATCH", "/api/self-maintenance/settings", {
                  trustedKeys: snapshot.settings.trustedKeys?.filter(
                    (item) => item.id !== k.id,
                  ),
                })
              }
            >
              Revoke {k.id}
            </Button>
          ))}
        </details>
        {snapshot?.requests.map((row) => (
          <div className="card" key={row.id}>
            <h3>{row.title}</h3>
            <Status value={row.status} />
            <p>{row.request}</p>
            <p>{row.detail}</p>
            {row.error && <p role="alert">{row.error}</p>}
            {row.workflowId && (
              <p>
                Managed project: {row.projectId} · {row.workflowStatus}. Open
                this project’s team panel to answer manager questions and review
                exact checks.
              </p>
            )}
            {row.questions
              ?.filter((q) => !q.answer)
              .map((q) => (
                <p key={q.id}>Manager question: {q.text}</p>
              ))}
            {row.readiness && <p>{row.readiness.detail}</p>}
            {row.readiness?.sourceHash && (
              <p>
                Reviewed source SHA-256: <code>{row.readiness.sourceHash}</code>
              </p>
            )}
            {row.artifact && (
              <p>
                {row.artifact.platform} {row.artifact.version} ·{" "}
                <code>{row.artifact.sha256}</code>
              </p>
            )}
            {row.artifact?.signerVerification && (
              <p>{row.artifact.signerVerification}</p>
            )}
            <div className="row">
              {row.projectId && (
                <Button
                  kind="secondary"
                  disabled={busy}
                  onClick={() => openAssistant(row.projectId!)}
                >
                  Open candidate team
                </Button>
              )}
              {row.approvalId && row.status === "awaiting_install_approval" && (
                <Button
                  kind="secondary"
                  disabled={busy}
                  onClick={() => openApproval(row.approvalId!)}
                >
                  Review update approval
                </Button>
              )}
              {["held", "staging_failed"].includes(row.status) && (
                <Button disabled={busy} onClick={() => lifecycle(row, "stage")}>
                  Prepare isolated source
                </Button>
              )}
              {row.status === "staged" && (
                <Button
                  disabled={busy}
                  onClick={() => {
                    if (
                      window.confirm(
                        "Has your provider allowance been restored, and do you explicitly authorise this single development run with your saved models now? There is no paid fallback or automatic retry.",
                      )
                    )
                      lifecycle(row, "start", { confirmProviderUse: true });
                  }}
                >
                  Release hold and start team
                </Button>
              )}
              <Button disabled={busy} onClick={() => lifecycle(row, "refresh")}>
                Check reviewed source
              </Button>
              {["review_ready", "packaged"].includes(row.status) && (
                <Button disabled={busy} onClick={() => setSelected(row.id)}>
                  Attach signed artifacts
                </Button>
              )}
              {row.status === "packaged" && (
                <Button
                  disabled={busy}
                  onClick={() => lifecycle(row, "install-request")}
                >
                  Request exact update approval
                </Button>
              )}
              {!["stopped", "installing", "handed_off"].includes(
                row.status,
              ) && (
                <Button disabled={busy} onClick={() => lifecycle(row, "stop")}>
                  Stop
                </Button>
              )}
              {row.recovery && (
                <Button
                  disabled={busy}
                  onClick={() =>
                    void act(
                      "GET",
                      `/api/self-maintenance/${row.id}/recovery`,
                      {},
                    )
                  }
                >
                  Show recovery paths
                </Button>
              )}
            </div>
            {row.approvalId && (
              <p>
                Review the update in Activity &amp; approvals. Windows also
                requires a valid publisher signature. Android installation is
                manual and retains its existing signing identity.
              </p>
            )}
          </div>
        ))}
        {chosen && (
          <div className="card">
            <h3>Attach packages for {chosen.title}</h3>
            <p>
              Build and sign separately, then supply the signed release
              manifests and artifacts. The current unsigned Windows preview
              cannot pass signed update handoff. Keep a distinct previous signed
              artifact for recovery.
            </p>
            <label>
              Candidate signed manifest
              <input
                value={manifest}
                onChange={(e) => setManifest(e.target.value)}
              />
            </label>
            <label>
              Candidate artifact
              <input
                value={artifact}
                onChange={(e) => setArtifact(e.target.value)}
              />
            </label>
            <label>
              Previous signed manifest
              <input
                value={previousManifest}
                onChange={(e) => setPreviousManifest(e.target.value)}
              />
            </label>
            <label>
              Previous artifact
              <input
                value={previousArtifact}
                onChange={(e) => setPreviousArtifact(e.target.value)}
              />
            </label>
            <Button
              disabled={
                busy ||
                ![manifest, artifact, previousManifest, previousArtifact].every(
                  Boolean,
                )
              }
              onClick={() =>
                void act(
                  "POST",
                  `/api/self-maintenance/${chosen.id}/package`,
                  {
                    expectedRevision: chosen.revision,
                    manifestPath: manifest,
                    artifactPath: artifact,
                    previousManifestPath: previousManifest,
                    previousArtifactPath: previousArtifact,
                  },
                  () => {
                    setManifest("");
                    setArtifact("");
                    setPreviousManifest("");
                    setPreviousArtifact("");
                    setSelected("");
                  },
                )
              }
            >
              Verify and privately stage artifacts
            </Button>
          </div>
        )}
        {recovery && (
          <div className="card">
            <h3>Recovery information</h3>
            <p>{recovery.detail}</p>
            <p>
              Local backup: <code>{recovery.backupPath}</code>
            </p>
            <p>
              Previous artifact: <code>{recovery.previousArtifactPath}</code>
            </p>
          </div>
        )}
      </div>
    </fieldset>
  );
}
