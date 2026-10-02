import { useEffect, useRef, useState } from "react";
import { Download, FileText, RefreshCw, Trash2 } from "lucide-react";
import { api, previewMode } from "./bridge";
import { Button, Empty, Toggle, relativeDate } from "./components";
import { useNakama } from "./context";
import "./project-reports.css";

interface Report {
  id: string;
  projectId: string;
  workflowId?: string;
  status: string;
  createdAt: string;
  completedAt?: string;
  fileName: string;
  bytes?: number;
  imageCount: number;
  error?: string;
}
interface Reports {
  version: number;
  available: boolean;
  automaticEnabled: boolean;
  busy: boolean;
  reports: Report[];
}
export function ProjectReportsPanel({ projectId }: { projectId: string }) {
  const { notify } = useNakama();
  const [data, setData] = useState<Reports>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  const alive = useRef(true);
  const prefix = `/api/projects/${encodeURIComponent(projectId)}/reports`;
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    let cancelled = false,
      inFlight = false;
    const load = () => {
      if (previewMode || inFlight) return;
      inFlight = true;
      void api<Reports>("GET", prefix)
        .then((result) => {
          if (!cancelled) {
            setData(result);
            setError("");
          }
        })
        .catch((reason) => {
          if (!cancelled)
            setError(
              reason instanceof Error
                ? reason.message
                : "Reports are unavailable.",
            );
        })
        .finally(() => {
          inFlight = false;
        });
    };
    load();
    const timer = setInterval(load, 2500);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [prefix, revision]);
  async function change(method: string, path: string, body?: unknown) {
    setBusy(true);
    setError("");
    try {
      await api(method, path, body);
      if (alive.current) setRevision((value) => value + 1);
    } catch (reason) {
      if (alive.current)
        setError(
          reason instanceof Error
            ? reason.message
            : "Report request was not confirmed.",
        );
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  async function open(report: Report, save: boolean) {
    setBusy(true);
    try {
      if (!window.nakama)
        throw new Error("Open the Windows app to view or save reports.");
      if (save) {
        const result = await window.nakama.saveProjectReport(
          projectId,
          report.id,
        );
        if (alive.current && result.saved) notify("PDF copy saved.");
      } else await window.nakama.openProjectReport(projectId, report.id);
    } catch (reason) {
      if (alive.current)
        setError(
          reason instanceof Error
            ? reason.message
            : "Could not open the report.",
        );
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  if (previewMode)
    return (
      <Empty
        icon={<FileText size={30} />}
        title="Reports live with your project"
      >
        Open Windows Control Center to generate and save project PDFs.
      </Empty>
    );
  return (
    <section className="project-report-panel" aria-label="Project reports">
      <div className="panel report-welcome">
        <div className="report-icon">
          <FileText size={35} />
        </div>
        <div>
          <h2>A little project journal</h2>
          <p>
            A readable PDF of the request, recorded result, saved files and
            verification receipts. Safe saved project previews can be included;
            private browsing is excluded.
          </p>
        </div>
      </div>
      {data && (
        <div className="panel">
          <Toggle
            checked={data.automaticEnabled}
            disabled={busy}
            label="Make a report when the project is delivered"
            description="Enabled by default. No extra model call, screenshot capture or deployment."
            onChange={(automaticEnabled) =>
              void change("PATCH", `${prefix}/settings`, { automaticEnabled })
            }
          />
        </div>
      )}
      <div className="button-row">
        <Button
          disabled={busy || !data?.available || data?.busy}
          onClick={() => void change("POST", prefix, {})}
        >
          <FileText size={16} />
          Create report now
        </Button>
        <Button
          kind="secondary"
          disabled={busy}
          onClick={() => setRevision((value) => value + 1)}
        >
          <RefreshCw size={15} />
          Refresh reports
        </Button>
      </div>
      {data && !data.available && (
        <p className="inline-note">
          The connected host has no Windows PDF renderer. Project work remains
          available.
        </p>
      )}
      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
      {data?.busy && (
        <p role="status">
          Preparing your project report… The project result is unchanged.
        </p>
      )}
      {!data?.reports.length && (
        <Empty
          icon={<FileText size={30} />}
          title="Your next milestone, nicely recorded"
        >
          Reports appear after managed project delivery, or create a snapshot
          now. No tests or deployments are inferred from a model's reply.
        </Empty>
      )}
      <div className="report-list">
        {data?.reports.map((report) => (
          <article className="panel report-card" key={report.id}>
            <FileText size={26} />
            <div>
              <h3>{report.fileName}</h3>
              <p className="small-copy">
                {report.status} · {relativeDate(report.createdAt)}
                {report.bytes
                  ? ` · ${Math.ceil(report.bytes / 1024)} KB`
                  : ""}{" "}
                · {report.imageCount} image{report.imageCount === 1 ? "" : "s"}
              </p>
              {report.error && <p className="inline-error">{report.error}</p>}
              {report.workflowId && (
                <small>Workflow: {report.workflowId}</small>
              )}
            </div>
            <div className="button-row">
              {report.status === "ready" && (
                <>
                  <Button
                    kind="secondary"
                    disabled={busy}
                    onClick={() => void open(report, false)}
                  >
                    Open PDF
                  </Button>
                  <Button
                    kind="secondary"
                    disabled={busy}
                    onClick={() => void open(report, true)}
                  >
                    <Download size={14} />
                    Save a copy
                  </Button>
                </>
              )}
              <Button
                kind="ghost"
                disabled={
                  busy || ["queued", "generating"].includes(report.status)
                }
                onClick={() => {
                  if (
                    window.confirm(
                      "Forget this saved report? Project files and task history stay intact.",
                    )
                  )
                    void change("DELETE", `${prefix}/${report.id}`);
                }}
              >
                <Trash2 size={14} />
                Forget
              </Button>
            </div>
          </article>
        ))}
      </div>
      <p className="small-copy">
        Saved privately on this PC. Review the PDF before sharing it. Static
        review, screenshot appearance and provider acceptance do not prove tests
        or deployment health.
      </p>
    </section>
  );
}
