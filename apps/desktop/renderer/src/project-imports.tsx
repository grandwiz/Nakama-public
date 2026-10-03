import { useEffect, useState } from "react";
import { api, chooseFolder } from "./bridge";
import { Button, Modal } from "./components";
import { useNakama } from "./context";
import type { Project } from "./types";

type Library = { id: string; name: string; path?: string };
type Folder = { rootId: string; path: string; entries: { name: string; path: string }[]; detected: string[]; canImport: boolean };
export function LocalProjectImport({ onClose }: { onClose: () => void }) {
  const { perform, openProject } = useNakama();
  const [libraries, setLibraries] = useState<Library[]>([]);
  const [rootId, setRootId] = useState("");
  const [folder, setFolder] = useState<Folder>();
  const [relative, setRelative] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    api<{ roots: Library[] }>("GET", "/api/project-imports/roots").then(result => {
      if (!active) return;
      setLibraries(result.roots);
      setRootId(current => result.roots.some(row => row.id === current) ? current : result.roots[0]?.id || "");
    }).catch(reason => { if (active) setError(String(reason)); });
    return () => { active = false; };
  }, [revision]);
  useEffect(() => {
    setFolder(undefined);
    if (!rootId) return;
    let active = true;
    api<Folder>("GET", `/api/project-imports/browse?rootId=${encodeURIComponent(rootId)}&path=${encodeURIComponent(relative)}`).then(result => { if (active) setFolder(result); }).catch(reason => { if (active) setError(String(reason)); });
    return () => { active = false; };
  }, [rootId, relative, revision]);
  const add = async () => {
    setError(""); setBusy(true);
    try {
      const path = await chooseFolder();
      if (path) {
        const result = await api<Library>("POST", "/api/project-imports/roots", { path });
        setRootId(result.id); setRelative(""); setRevision(value => value + 1);
      }
    } catch (reason) { setError(String(reason)); } finally { setBusy(false); }
  };
  const importFolder = async () => {
    if (!folder?.canImport) return;
    setBusy(true);
    try {
      const result = await perform<{ project: Project }>("POST", "/api/project-imports", { rootId, path: folder.path });
      if (result) { openProject(result.project.id); onClose(); }
    } finally { setBusy(false); }
  };
  return <Modal title="Import an existing project" onClose={onClose}>
    <p>Select a Windows project folder. Files remain in place. Claude and GPT project instructions are retained; importing does not run them.</p>
    <Button kind="secondary" onClick={add} disabled={busy}>Add a project library folder</Button>
    <label className="field" style={{ marginTop: 16 }}>Project library<select value={rootId} onChange={event => { setRootId(event.target.value); setRelative(""); setError(""); }}>
      <option value="">Select a library</option>{libraries.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}
    </select></label>
    {folder && <><p>{folder.path || "Library root"}</p><div className="button-row">
      <Button kind="secondary" disabled={!relative} onClick={() => setRelative(relative.split("/").slice(0,-1).join("/"))}>Up one folder</Button>
      <Button disabled={!folder.canImport || busy} onClick={importFolder}>Import this folder</Button>
    </div><p>{folder.detected.join(" · ") || "Existing folder"}</p><div style={{ maxHeight: 300, overflowY: "auto" }}>{folder.entries.map(row => <Button key={row.path} kind="secondary" onClick={() => { setRelative(row.path); setError(""); }}>{row.name} →</Button>)}</div></>}
    {error && <p role="alert">{error}</p>}
    <p className="muted">Paired Android devices with project access can browse these libraries. Removing an imported project from Nakama preserves its original files.</p>
  </Modal>;
}
