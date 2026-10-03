const path=require("node:path"),fs=require("node:fs/promises"),assert=require("node:assert/strict");
const {spawn}=require("node:child_process");
if(!process.versions.electron) {
 const env={...process.env}; delete env.ELECTRON_RUN_AS_NODE; const runId=require("node:crypto").randomUUID();
 const child=spawn(path.join(__dirname,"../node_modules/electron/dist/electron.exe"),[__filename,runId],{env,stdio:"inherit",windowsHide:true});
 child.on("exit",async code=>{ try { const result=JSON.parse(await fs.readFile(path.join(__dirname,"../tmp/audio-verify-result.json"),"utf8")); assert.equal(result.passed,4); assert.equal(result.runId,runId); console.log(result); process.exitCode=code||0; } catch(error) { console.error(error); process.exitCode=1; } });
} else {
 const {app,BrowserWindow,session}=require("electron");
 app.on("window-all-closed",()=>{});
 const root=path.resolve(__dirname,".."),profile=path.join(root,"tmp","audio-verify-"+Date.now());
 app.setPath("userData",profile);
 app.whenReady().then(async()=>{
  try {
   const decode=require("../apps/desktop/alarm-audio.cjs").createAlarmAudioDecoder({BrowserWindow,session});
   const source=Buffer.alloc(44+44100*4);source.write("RIFF");source.writeUInt32LE(source.length-8,4);source.write("WAVEfmt ",8);source.writeUInt32LE(16,16);source.writeUInt16LE(1,20);source.writeUInt16LE(1,22);source.writeUInt32LE(22050,24);source.writeUInt32LE(44100,28);source.writeUInt16LE(2,32);source.writeUInt16LE(16,34);source.write("data",36);source.writeUInt32LE(source.length-44,40);
   for(let i=0;i<88200;i++)source.writeInt16LE(Math.round(5000*Math.sin(i*Math.PI*2*440/22050)),44+i*2);
   const bytes=await decode(source,{startSeconds:1,durationSeconds:2});
   const {checkedWav}=await import("../apps/host/alarm-sounds.mjs");assert.equal(checkedWav(bytes),2000);assert.equal(bytes.length,88244);assert.ok(bytes.subarray(44).some(value=>value));
   await assert.rejects(decode(Buffer.from("not audio"),{startSeconds:0,durationSeconds:1}));
   await assert.rejects(decode(source,{startSeconds:20,durationSeconds:1}));
   assert.equal(BrowserWindow.getAllWindows().length,0);
   let publicSound;
   if(process.env.NAKAMA_PUBLIC_AUDIO_TEST === "1") {
     const {NakamaHost}=await import("../apps/host/host.mjs");
     const host=await new NakamaHost({dataDir:path.join(profile,"public-sound-fixture"),alarmSoundDecoder:decode}).init();
     try { const sound=await host.alarmSounds.create({query:"birds chirping",durationSeconds:3},{kind:"owner",id:"desktop"}); const audio=await host.alarmSounds.audio(sound.id,{kind:"owner",id:"desktop"}); assert.equal(checkedWav(Buffer.from(audio.base64,"base64")),3000); publicSound={title:sound.sourceTitle,license:sound.license,bytes:sound.byteLength}; } finally { await host.close(); }
   }
   await fs.writeFile(path.join(root,"tmp/audio-verify-result.json"),JSON.stringify({passed:4,publicSound,runId:process.argv[2],checkedAt:new Date().toISOString()}));
   console.log("Passed4 silent native audio checks: exact PCM clip, malformed audio, out-of-range start, disposable renderer cleanup.");
  }catch(error){console.error(error);process.exitCode=1;}finally{
   assert.ok(profile.startsWith(path.join(root,"tmp")+path.sep));
   await session.defaultSession.clearStorageData();
   app.quit();
  }
 });
}
