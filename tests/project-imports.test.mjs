import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { NakamaHost } from "../apps/host/host.mjs";
import { projectRoot } from "../apps/host/security.mjs";

test("PC-selected libraries allow in-place Android imports with boundaries and unchanged files", async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "nakama-imports-"));
  const host = await new NakamaHost({ dataDir: path.join(dir, "state") }).init();
  t.after(async () => { await host.close(); await fs.rm(dir, { recursive: true, force: true }); });
  const library = path.join(dir, "projects"); const source = path.join(library, "Existing");
  await fs.mkdir(source, { recursive: true }); await fs.writeFile(path.join(source, "CLAUDE.md"), "Keep original instructions");
  const phone = { kind: "device", id: "phone", platform: "android" };
  host.store.state.devices.push({ id: "phone", platform: "android", permissions: { projectAccess: true, googleAccess: true } });
  await assert.rejects(host.dispatch("POST", "/api/project-imports/roots", { path: library }, phone), e => e.status === 403);
  const root = await host.dispatch("POST", "/api/project-imports/roots", { path: library });
  const visible = await host.dispatch("GET", "/api/project-imports/roots", {}, phone);
  assert.equal(visible.roots[0].path, undefined);
  const listing = await host.dispatch("GET", `/api/project-imports/browse?rootId=${root.id}`, {}, phone);
  assert.deepEqual(listing.entries, [{ name: "Existing", path: "Existing" }]);
  await assert.rejects(host.dispatch("POST", "/api/project-imports", { rootId: root.id, path: "../state" }, phone));
  await assert.rejects(host.dispatch("POST", "/api/project-imports", { rootId: root.id, path: source }, phone));
  const result = await host.dispatch("POST", "/api/project-imports", { rootId: root.id, path: "Existing" }, phone);
  const stored = host.store.state.projects.find(p => p.id === result.project.id);
  assert.equal(await projectRoot("", stored), source);
  assert.equal(result.project.importedRoot, undefined);
  assert.equal(result.project.importedPath, undefined);
  const again = await host.dispatch("POST", "/api/project-imports", { rootId: root.id, path: "Existing" }, phone);
  assert.equal(again.project.importedRoot, undefined);
  assert.equal(again.project.importedPath, undefined);
  const renamed = await host.dispatch("PATCH", "/api/projects/" + result.project.id, { name: "Renamed" }, phone);
  assert.equal(renamed.importedRoot, undefined);
  assert.equal(renamed.importedPath, undefined);
  const ownerState = await host.dispatch("GET", "/api/state");
  const visibleProject = ownerState.projects.find(p => p.id === result.project.id);
  assert.equal(visibleProject.importedRoot, undefined);
  assert.equal(visibleProject.importedPath, undefined);
  assert.equal(await fs.readFile(path.join(source, "CLAUDE.md"), "utf8"), "Keep original instructions");
  assert.equal((await host.dispatch("POST", "/api/project-imports", { rootId: root.id, path: "Existing" }, phone)).alreadyImported, true);
  assert.equal((await host.dispatch("GET", `/api/projects/${result.project.id}/files`, {}, phone)).entries[0].name, "CLAUDE.md");
  host.store.state.devices[0].permissions.projectAccess = false;
  await assert.rejects(host.dispatch("GET", `/api/project-imports/browse?rootId=${root.id}`, {}, phone), e => e.status === 403);
  const state = await host.dispatch("GET", "/api/state", {}, phone);
  assert.equal(state.projectImportRoots, undefined);
});


async function importedFixture(t) {
  const dir=await fs.mkdtemp(path.join(os.tmpdir(), "nakama-import-boundary-"));
  const host=await new NakamaHost({dataDir:path.join(dir,"state")}).init();
  t.after(async()=>{await host.close(); await host.store.queue; await fs.rm(dir,{recursive:true,force:true});});
  const library=path.join(dir,"library"), source=path.join(library,"Existing");
  await fs.mkdir(source,{recursive:true}); await fs.writeFile(path.join(source,"CLAUDE.md"),"Original instructions");
  const phone={kind:"device",id:"phone",platform:"android"};
  host.store.state.devices.push({id:phone.id,platform:"android",permissions:{projectAccess:true,googleAccess:true}});
  const root=await host.dispatch("POST","/api/project-imports/roots",{path:library});
  return {host,phone,root,source,library};
}

test("library marker discovery rechecks access after its final asynchronous read", {timeout:10000}, async t=>{
  const f=await importedFixture(t);
  const original=fs.lstat;
  let entered,release;
  const ready=new Promise(resolve=>entered=resolve), wait=new Promise(resolve=>release=resolve);
  fs.lstat=async function(file,...args) {
    if(file===path.join(f.source,"CLAUDE.md")) {entered(); await wait;}
    return original.call(this,file,...args);
  };
  try {
    const request=f.host.dispatch("GET","/api/project-imports/browse?rootId="+f.root.id+"&path=Existing",{},f.phone);
    await ready;
    f.host.store.state.devices[0].permissions.projectAccess=false;
    release();
    await assert.rejects(request,{status:403});
  } finally {release();fs.lstat=original;}
});

test("approved removal of an imported project unlinks it while retaining original files", async t=>{
  const f=await importedFixture(t);
  const imported=await f.host.dispatch("POST","/api/project-imports",{rootId:f.root.id,path:"Existing"},f.phone);
  const request=await f.host.dispatch("POST","/api/projects/"+imported.project.id+"/delete-request",{},f.phone);
  await assert.rejects(f.host.dispatch("POST","/api/approvals/"+request.id+"/resolve",{approved:true},f.phone),{status:403});
  await f.host.dispatch("POST","/api/approvals/"+request.id+"/resolve",{approved:true});
  assert.equal(f.host.store.state.projects.some(p=>p.id===imported.project.id),false);
  assert.equal(await fs.readFile(path.join(f.source,"CLAUDE.md"),"utf8"),"Original instructions");
  assert.deepEqual(await fs.readdir(f.library),["Existing"]);
  assert.ok(f.host.store.state.audit.some(item=>item.type==="project.unlinked"));
});
