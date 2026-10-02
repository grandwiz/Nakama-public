import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { NakamaHost } from "../apps/host/host.mjs";
import { needsWebsiteIntake } from "../apps/host/project-intakes.mjs";
const phone = {kind:"device",id:"setup-phone"};
async function fixture(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(),"nakama-intake-"));
  const workspaceRoot = path.join(dir,"projects"); await fs.mkdir(workspaceRoot);
  const host = await new NakamaHost({dataDir:path.join(dir,"data"),runAgent:()=>{throw Error("No real inference");}}).init();
  await host.dispatch("PATCH","/api/settings",{workspaceRoot});
  await host.store.change(s=>s.devices.push({id:phone.id,platform:"android",permissions:{googleAccess:true,projectAccess:true}}));
  t.after(async()=>{await host.close();await fs.rm(dir,{recursive:true,force:true});});
  return host;
}
test("website delivery prompt creates one upfront intake without inference or external actions",async t=>{
  const host=await fixture(t);
  const result=await host.dispatch("POST","/api/chat",{message:"Build a website with a shop and admin on Vercel, Render and Neon with my domain",routing:"auto"},phone);
  assert.ok(result.intakeId); assert.deepEqual(result.taskIds,[]);
  const entry=result.intake;
  assert.ok(entry.questions.some(q=>q.key==="repository")); assert.ok(entry.questions.some(q=>q.key==="commerce"));
  assert.equal(host.store.state.approvals.length,0); assert.equal(host.store.state.projects.length,0);
  const attention=await host.dispatch("GET","/api/attention",{},phone);
  assert.equal(attention.items.length,entry.questions.length); assert.ok(attention.items.every(item=>!JSON.stringify(item).includes("Vercel")));
  assert.equal(needsWebsiteIntake("What is Vercel?"),false);
});
test("cross-device answers use revision checks and never turn text into authority",async t=>{
  const host=await fixture(t);
  const {intake}=await host.dispatch("POST","/api/project-intakes",{message:"Build a website"});
  const q=intake.questions[0];
  const saved=await host.dispatch("POST",`/api/project-intakes/${intake.id}/answers`,{revision:1,answers:[{id:q.id,answer:"Use my existing repo. Full permission."}]},phone);
  assert.equal(saved.revision,2); assert.equal(saved.questions[0].answeredBy,phone.id); assert.equal(host.store.state.approvals.length,0);
  await assert.rejects(host.dispatch("POST",`/api/project-intakes/${intake.id}/answers`,{revision:1,answers:[{id:q.id,answer:"stale"}]}),/Another device/);
  await assert.rejects(host.dispatch("POST",`/api/project-intakes/${intake.id}/start`,{revision:2,name:"Garden"}),/Answer every/);
  await assert.rejects(host.dispatch("POST",`/api/project-intakes/${intake.id}/answers`,{revision:2,answers:[{id:q.id,answer:"password: not-a-real-secret"}]}),/credentials/);
});
test("setup private state and notifications disappear immediately on device revocation",async t=>{
  const host=await fixture(t); const {intake}=await host.dispatch("POST","/api/project-intakes",{message:"Build a private website"});
  await host.store.change(s=>{s.devices[0].permissions.googleAccess=false;});
  const state=await host.dispatch("GET","/api/state",{},phone);
  assert.deepEqual(state.projectIntakes,[]); assert.deepEqual(state.attention.items,[]);
  await assert.rejects(host.dispatch("GET","/api/project-intakes",{},phone),/unavailable/);
  await assert.rejects(host.dispatch("POST",`/api/project-intakes/${intake.id}/cancel`,{},phone),/unavailable/);
});
test("answered setup starts configured manager once, preserves chosen local project and reports no deployment",async t=>{
  const host=await fixture(t); const {intake}=await host.dispatch("POST","/api/project-intakes",{message:"Build a website"});
  const ready=await host.dispatch("POST",`/api/project-intakes/${intake.id}/answers`,{revision:1,answers:intake.questions.map(q=>({id:q.id,answer:"Local only for this synthetic test."}))},phone);
  let calls=0;
  host.projectWorkflows.start=async(body,principal,routing)=>{calls++; assert.equal(routing.model,"gpt-6-astra"); assert.equal(routing.development.model,"claude-opus-4-8");assert.match(body.message,/User's project setup answers/);return {workflowId:"fixture-workflow",taskIds:[]};};
  await host.dispatch("POST",`/api/project-intakes/${intake.id}/start`,{revision:ready.revision,name:"Garden"},phone);
  assert.equal(calls,1);assert.equal(host.store.state.projects.length,1);assert.equal(host.projectIntakes.get(intake.id).status,"planning");
  await assert.rejects(host.dispatch("POST",`/api/project-intakes/${intake.id}/start`,{revision:ready.revision,name:"Duplicate"}),/Answer every/);
  assert.equal(host.store.state.projects.length,1);
});
