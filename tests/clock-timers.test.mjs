import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { NakamaHost } from "../apps/host/host.mjs";
import { parseClockCommand, parseTimerDuration } from "../apps/host/local-clock.mjs";
const OWNER = { kind: "owner", id: "desktop" }, PHONE = { kind: "device", id: "phone", platform: "android" }, OTHER = { ...PHONE, id: "other" };
async function fixture(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "nakama-clock-"));
  let time = Date.parse("2026-10-02T12:00:00Z"), modelCalls = 0;
  const createHost = () => new NakamaHost({ dataDir: dir, boardClock: () => new Date(time), runAgent: () => { modelCalls++; throw new Error("Live models forbidden"); } }).init();
  let host = await createHost();
  await host.store.change((state) => { state.devices = [PHONE, OTHER].map((item) => ({ id: item.id, name: `Fixture ${item.id}`, platform: "android", permissions: { googleAccess: true, projectAccess: true } })); });
  t.after(async () => { await host.close(); await fs.rm(dir, { recursive: true, force: true }); assert.equal(modelCalls, 0); });
  return { get host() { return host; }, advance(ms) { time += ms; }, async restart() { await host.close(); host = await createHost(); }, request: (method, route, body = {}, principal = OWNER) => host.dispatch(method, route, body, principal) };
}
test("duration parser handles everyday numeric and spoken countdowns without accepting extra instructions", () => {
  for (const [input, seconds] of [["10 minutes",600],["ten minutes",600],["1 hour and 30 minutes",5400],["half an hour",1800],["a quarter of an hour",900],["ninety seconds",90],["twenty-five minutes",1500],["1.5 minutes",90]]) assert.equal(parseTimerDuration(input),seconds,input);
  for (const input of ["0 seconds","-1 minutes","+1 minutes","−1 minutes","8 days","0.1 seconds","10 minutes then send a message","about ten minutes","1 hour 0 minutes"]) assert.equal(parseTimerDuration(input),null,input);
  assert.deepEqual(parseClockCommand("set a 10 minute timer called Pasta"),{type:"create",durationSeconds:600,title:"Pasta"});
  assert.equal(parseClockCommand("start a timer for ten minutes").durationSeconds,600);
  assert.equal(parseClockCommand("set a timer for tomorrow").type,"invalid");
  assert.equal(parseClockCommand("write a timer app"),null);
  assert.equal(parseClockCommand("set a 10 minute timer called eggs and send a message").type,"invalid");
  assert.equal(parseClockCommand("list my timers and send them to Sam"),null);
  for (const input of ["set a 10 minute timer called eggs and resume the tea timer", "set a 10 minute timer called eggs but do not start it", "set a 10 minute timer called eggs; open mail", "pause the eggs and dismiss the tea timer"]) assert.equal(parseClockCommand(input)?.type,"invalid",input);
  for (const input of ["do not set a 10 minute timer", "don't start a timer for ten minutes", 'Explain this: "set a ten minute timer"']) assert.equal(parseClockCommand(input),null,input);
});
test("timers preserve exact remaining milliseconds across pause and resume, then finish once", async (t) => {
  const f=await fixture(t);
  let {timer}=await f.request("POST","/api/clock/timers",{durationSeconds:10,title:"Eggs"});
  f.advance(1250);
  ({timer}=await f.request("POST",`/api/clock/timers/${timer.id}/pause`,{revision:timer.revision}));
  assert.equal(timer.remainingSeconds,9); assert.equal(timer.status,"paused"); assert.equal(timer.endsAt,undefined);
  f.advance(60000);
  assert.equal((await f.request("GET","/api/clock")).timers[0].remainingSeconds,9);
  ({timer}=await f.request("POST",`/api/clock/timers/${timer.id}/resume`,{revision:timer.revision}));
  f.advance(8749); await f.host.clockTimers.tick(); assert.equal((await f.request("GET","/api/clock")).timers[0].status,"running");
  f.advance(1); await f.host.clockTimers.tick(); timer=(await f.request("GET","/api/clock")).timers[0];
  assert.equal(timer.status,"finished"); assert.equal(timer.remainingSeconds,0); const revision=timer.revision;
  await f.host.clockTimers.tick(); assert.equal((await f.request("GET","/api/clock")).timers[0].revision,revision);
  const attention=await f.request("GET","/api/attention"); assert.equal(attention.items.filter((item)=>item.kind==="timer").length,1);
  assert.deepEqual((await f.request("POST","/api/attention/open",{id:`timer:${timer.id}`})).outcome,{type:"navigate",target:"clock"});
  await f.request("POST",`/api/clock/timers/${timer.id}/dismiss`,{revision});
  assert.equal((await f.request("GET","/api/attention")).items.some((item)=>item.kind==="timer"),false);
  await assert.rejects(f.request("POST","/api/attention/open",{id:`timer:${timer.id}`}),/ended|available/);
});
test("timer request receipts survive restart without resetting or replaying a cancelled countdown",async(t)=>{
  const f=await fixture(t),body={durationSeconds:60,title:"Break",requestId:"fixture-request"};
  const first=await f.request("POST","/api/clock/timers",body);
  f.advance(10000); await f.restart();
  const repeated=await f.request("POST","/api/clock/timers",body);
  assert.equal(repeated.timer.id,first.timer.id); assert.equal(repeated.timer.remainingSeconds,50); assert.equal(repeated.repeated,true);
  await assert.rejects(f.request("POST","/api/clock/timers",{...body,durationSeconds:120}),/already used/);
  await f.request("POST",`/api/clock/timers/${first.timer.id}/cancel`,{revision:repeated.timer.revision});
  await f.restart(); assert.equal((await f.request("POST","/api/clock/timers",body)).timer.status,"cancelled");
});
test("overdue timers finish at startup while paused timers and existing routine data remain intact",async(t)=>{
  const f=await fixture(t);
  const running=(await f.request("POST","/api/clock/timers",{durationSeconds:5,title:"Running"})).timer;
  const paused=(await f.request("POST","/api/clock/timers",{durationSeconds:30,title:"Paused"})).timer;
  await f.request("POST",`/api/clock/timers/${paused.id}/pause`,{revision:paused.revision});
  const routines=structuredClone(f.host.store.state.routineBoard);
  f.advance(10000); await f.restart();
  const timers=(await f.request("GET","/api/clock")).timers;
  assert.equal(timers.find((timer)=>timer.id===running.id).status,"finished"); assert.equal(timers.find((timer)=>timer.id===paused.id).status,"paused");
  assert.deepEqual(f.host.store.state.routineBoard,routines);
});
test("device timer records, local chat receipts and completion notices remain scoped and revoke safe",async(t)=>{
  const f=await fixture(t);
  const result=await f.request("POST","/api/chat",{message:"set a 1 second timer called private fixture",routing:"auto",requestId:"private-one"},PHONE);
  assert.equal(result.local,true);
  const own=(await f.request("GET","/api/clock",{},PHONE)).timers[0];
  assert.equal((await f.request("GET","/api/clock",{},OTHER)).timers.length,0);
  assert.equal(JSON.stringify(await f.request("GET","/api/state",{},OTHER)).includes("private fixture"),false);
  await assert.rejects(f.request("POST",`/api/clock/timers/${own.id}/cancel`,{revision:own.revision},OTHER),/not found/);
  f.advance(1000); await f.host.clockTimers.tick();
  assert.equal((await f.request("GET","/api/attention",{},PHONE)).items.some((item)=>item.timerId===own.id),true);
  assert.equal((await f.request("GET","/api/attention",{},OTHER)).items.some((item)=>item.timerId===own.id),false);
  await f.request("PATCH","/api/devices/phone",{googleAccess:false});
  await assert.rejects(f.request("GET","/api/clock",{},PHONE),/unavailable/);
  assert.equal((await f.request("GET","/api/state",{},PHONE)).clock.timers.length,0);
});
test("revision conflicts, protected scopes and invalid duration or formatting fail without side effects",async(t)=>{
  const f=await fixture(t);
  for(const body of [{durationSeconds:0},{durationSeconds:604801},{durationSeconds:1.5},{durationSeconds:10,title:"Hidden\u202e"},{durationSeconds:10,requestedBy:"phone"}]) await assert.rejects(f.request("POST","/api/clock/timers",body));
  const {timer}=await f.request("POST","/api/clock/timers",{durationSeconds:60});
  await f.request("POST",`/api/clock/timers/${timer.id}/pause`,{revision:1});
  await assert.rejects(f.request("POST",`/api/clock/timers/${timer.id}/cancel`,{revision:1}),/changed/);
  assert.equal((await f.request("GET","/api/clock")).timers[0].status,"paused");
  await f.request("DELETE","/api/devices/phone");
  await assert.rejects(f.request("POST","/api/clock/timers",{durationSeconds:60},PHONE));
});
test("greetings, current time and timer lifecycle replies are immediate local responses with no model task",async(t)=>{
  const f=await fixture(t);
  for(const message of ["hello","how are you","thank you","what time is it?","what is the date today?","set a ten minute timer called cooking","how much time is left on the cooking timer","pause the cooking timer","resume the cooking timer","cancel the cooking timer","list my timers","set a timer for tomorrow","open clock"]){
    const result=await f.request("POST","/api/chat",{message,routing:"auto",timeZone:"Europe/London"});
    assert.equal(result.local,true,message); assert.deepEqual(result.taskIds,[],message);
  }
  assert.equal(f.host.store.state.tasks.length,0);
  assert.equal(f.host.store.state.routineBoard.routines.length,0);
});
