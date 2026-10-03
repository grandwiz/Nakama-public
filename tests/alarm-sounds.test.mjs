import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { NakamaHost } from "../apps/host/host.mjs";
import { parseEverydayRequest, validateEverydayAction } from "../apps/host/everyday-actions.mjs";
import { checkedWav } from "../apps/host/alarm-sounds.mjs";
function wav(seconds=1) { const data=Buffer.alloc(44+44100*seconds); data.write("RIFF"); data.writeUInt32LE(data.length-8,4); data.write("WAVEfmt ",8); data.writeUInt32LE(16,16); data.writeUInt16LE(1,20); data.writeUInt16LE(1,22); data.writeUInt32LE(22050,24); data.writeUInt32LE(44100,28); data.writeUInt16LE(2,32); data.writeUInt16LE(16,34); data.write("data",36); data.writeUInt32LE(data.length-44,40); return data; }
async function fixture(t,decoder) {
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),"nakama-sounds-")); let downloads=0;
 const host=await new NakamaHost({dataDir:dir,alarmSoundDecoder:decoder || (async()=>wav()),alarmSoundFetch:async(url,options)=>{
  assert.equal(options.redirect,"error");
  if (new URL(url).hostname==="commons.wikimedia.org") return new Response(JSON.stringify({query:{pages:{"1":{title:"File:Birds.ogg",imageinfo:[{mime:"audio/ogg",url:"https://upload.wikimedia.org/wikipedia/commons/a/ab/Birds.ogg",size:50,extmetadata:{LicenseShortName:{value:"CC0"},Artist:{value:"Fixture"}}}]}}}}));
  assert.equal(new URL(url).hostname,"upload.wikimedia.org"); downloads++; return new Response(Buffer.from("synthetic compressed audio"));
 }}).init();
 const principal={kind:"device",id:"phone",platform:"android"};
 host.store.state.devices.push(...["phone","tablet"].map(id=>({id,name:id,platform:"android",permissions:{projectAccess:true,googleAccess:true}})));
 t.after(async()=>{await host.close(); assert.ok(dir.startsWith(path.join(os.tmpdir(),"nakama-sounds-"))); await fs.rm(dir,{recursive:true,force:true});});
 return {host,principal,downloads:()=>downloads};
}
test("spoken sound requests bind exact query and clip timings",()=>{
 const action=parseEverydayRequest("Set an alarm for 7 am with birds chirping sound from 2 seconds for 8 seconds");
 assert.equal(action.soundQuery,"birds chirping"); assert.equal(action.startSeconds,2); assert.equal(action.durationSeconds,8);
 const change=parseEverydayRequest("change my 7 am alarm sound to ocean waves for 12 seconds");
 assert.deepEqual(change,{type:"alarm_sound",time:"07:00",soundQuery:"ocean waves",startSeconds:0,durationSeconds:12});
 assert.throws(()=>validateEverydayAction({...change,soundQuery:"wrong sound"},"change my 7 am alarm sound to ocean waves for 12 seconds"));
 assert.equal(parseEverydayRequest('Explain "change my alarm sound to birds"'),null);
 assert.equal(parseEverydayRequest("do not change my alarm sound to birds"),null);
 assert.equal(parseEverydayRequest("set an alarm for 7 am with birds sound for 99 seconds"),null);
});
test("audio library verifies bytes, source isolation, assigned delivery and request deduplication",async t=>{
 const f=await fixture(t);
 const body={query:"birds",requestId:"sound-fixture-01"};
 const sound=await f.host.alarmSounds.create(body,f.principal);
 const same=await f.host.alarmSounds.create(body,f.principal); assert.equal(same.id,sound.id); assert.equal(f.downloads(),1);
 assert.equal(checkedWav(Buffer.from((await f.host.alarmSounds.audio(sound.id,f.principal)).base64,"base64")),1000);
 const tablet={kind:"device",id:"tablet",platform:"android"};
 await assert.rejects(f.host.alarmSounds.audio(sound.id,tablet),e=>e.status===404);
 await assert.rejects(f.host.alarmSounds.create({...body,query:"different"},f.principal),e=>e.status===409);
 const reply=await f.host.localAssistant.handle({message:"set an alarm for 7 am with birds sound",timeZone:"Europe/London",requestId:"alarm-sound-fixture-01"},f.principal);
 assert.match(reply.reply,/birds.*clip/i); const routine=f.host.store.state.routineBoard.routines[0]; assert.ok(routine.soundId); assert.deepEqual(routine.targetDeviceIds,["phone"]);
 const old=routine.updatedAt;
 const changed=await f.host.localAssistant.handle({message:"change my 7 am alarm sound to ocean waves",requestId:"change-sound-01"},f.principal);
 assert.match(changed.reply,/download, verify/); assert.notEqual(routine.updatedAt,old);
 await assert.rejects(f.host.dispatch("PATCH",`/api/routines/${routine.id}`,{soundId:sound.id,expectedUpdatedAt:old},f.principal),e=>e.status===409);
 const state=await f.host.dispatch("GET","/api/state",{},tablet); assert.equal(state.alarmSoundLibrary,undefined); assert.equal(state.alarmSounds.length,0);
});
test("revocation during audio decoding saves neither clip nor alarm",async t=>{
 let entered,release; const wait=new Promise(resolve=>release=resolve),ready=new Promise(resolve=>entered=resolve);
 const f=await fixture(t,async()=>{entered();await wait;return wav();});
 const request=f.host.alarmSounds.create({query:"birds"},f.principal); await ready;
 f.host.store.state.devices[0].permissions.projectAccess=false; release();
 await assert.rejects(request,e=>e.status===403); assert.equal(f.host.store.state.alarmSoundLibrary?.length||0,0);
});
test("invalid clip formats cannot become alarm sounds",()=>{assert.throws(()=>checkedWav(Buffer.from("not audio")));const data=wav();data.writeUInt16LE(2,22);assert.throws(()=>checkedWav(data));});


test("sound credits survive persistence and assignment revocation during byte reads denies delivery", {timeout:10000}, async t=>{
  const f=await fixture(t);
  const sound=await f.host.alarmSounds.create({query:"birds"},f.principal);
  assert.equal(sound.sourceTitle,"File:Birds.ogg");
  assert.equal(sound.license,"CC0");
  assert.equal(sound.attribution,"Fixture");
  assert.equal(sound.sourceUrl,"https://commons.wikimedia.org/wiki/File%3ABirds.ogg");
  await f.host.store.change(s=>s.routineBoard.routines.push({id:"assigned",soundId:sound.id,targetDeviceIds:["tablet"]}));
  const tablet={kind:"device",id:"tablet",platform:"android"};
  const visible=f.host.alarmSounds.public(tablet)[0];
  assert.equal(visible.attribution,"Fixture");
  for(const key of ["file","origin","requestKey","requestDigest"]) assert.equal(visible[key],undefined);
  const original=fs.readFile;
  let entered,release;
  const ready=new Promise(resolve=>entered=resolve),wait=new Promise(resolve=>release=resolve);
  const target=path.join(f.host.store.dir,"alarm-sounds",sound.id+".wav");
  fs.readFile=async function(file,...args){
    const value=await original.call(this,file,...args);
    if(file===target){entered();await wait;}
    return value;
  };
  try {
    const pending=f.host.alarmSounds.audio(sound.id,tablet);
    await ready;
    f.host.store.state.routineBoard.routines[0].targetDeviceIds=["phone"];
    release();
    await assert.rejects(pending,{status:403});
  } finally {release();fs.readFile=original;}
  const persisted=JSON.parse(await fs.readFile(path.join(f.host.store.dir,"state.json"),"utf8"));
  assert.equal(persisted.alarmSoundLibrary[0].attribution,"Fixture");
  assert.equal(persisted.alarmSoundLibrary[0].license,"CC0");
});
