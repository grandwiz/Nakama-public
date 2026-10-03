const { randomUUID } = require("node:crypto");
// Decode downloaded audio silently inside a disposable sandboxed Chromium renderer.
// No shell command, page script, remote URL or audible playback is involved.
exports.createAlarmAudioDecoder = ({ BrowserWindow, session }) => async (source, options) => {
  if (!Buffer.isBuffer(source) || source.length > 4 * 1024 * 1024) throw new Error("Alarm sound download is too large.");
  const partition = session.fromPartition(`nakama-alarm-audio-${randomUUID()}`);
  partition.setPermissionRequestHandler((_contents,_permission,reply) => reply(false));
  partition.webRequest.onBeforeRequest((details,reply) => reply({ cancel: !details.url.startsWith("data:text/html,") }));
  const window = new BrowserWindow({ show:false, webPreferences:{ session:partition, sandbox:true, contextIsolation:true, nodeIntegration:false, webSecurity:true, backgroundThrottling:false } });
  window.webContents.setWindowOpenHandler(() => ({ action:"deny" }));
  window.webContents.on("will-navigate", event => event.preventDefault());
  let timer;
  try {
    await window.loadURL("data:text/html," + encodeURIComponent('<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src \'none\'">'));
    const decode = async ({base64,startSeconds,durationSeconds}) => {
      const raw = Uint8Array.from(atob(base64), char => char.charCodeAt(0));
      const decoder = new OfflineAudioContext(1, 1, 22050);
      const input = await decoder.decodeAudioData(raw.buffer);
      if (input.duration > 600 || input.numberOfChannels > 8) throw new Error("Choose a shorter audio source.");
      const duration = Math.min(durationSeconds, input.duration-startSeconds);
      if (!(duration > 0)) throw new Error("The clip starts after this sound ends.");
      const length = Math.min(661500, Math.floor(duration*22050));
      const context = new OfflineAudioContext(1,length,22050);
      const node = context.createBufferSource(); node.buffer = input; node.connect(context.destination); node.start(0,startSeconds,duration);
      const rendered = await context.startRendering(); const samples = rendered.getChannelData(0);
      const result = new Uint8Array(44+samples.length*2), view = new DataView(result.buffer);
      const write = (at,value) => { for(let i=0;i<value.length;i++) result[at+i] = value.charCodeAt(i); };
      write(0,"RIFF"); view.setUint32(4,result.length-8,true); write(8,"WAVE"); write(12,"fmt "); view.setUint32(16,16,true); view.setUint16(20,1,true); view.setUint16(22,1,true); view.setUint32(24,22050,true); view.setUint32(28,44100,true); view.setUint16(32,2,true); view.setUint16(34,16,true); write(36,"data"); view.setUint32(40,result.length-44,true);
      for(let i=0;i<samples.length;i++) { const value=Math.max(-1,Math.min(1,samples[i])); view.setInt16(44+i*2,value<0 ? value*32768 : value*32767,true); }
      let binary=""; for(let i=0;i<result.length;i+=8192) binary+=String.fromCharCode(...result.subarray(i,i+8192));
      return btoa(binary);
    };
    const base64 = await Promise.race([
      window.webContents.executeJavaScript(`(${decode.toString()})(${JSON.stringify({base64:source.toString("base64"),...options})})`),
      new Promise((_resolve,reject) => { timer = setTimeout(() => reject(new Error("Alarm audio decoding timed out.")),15000); })
    ]);
    return Buffer.from(base64,"base64");
  } finally { clearTimeout(timer); if(!window.isDestroyed()) window.destroy(); await partition.clearStorageData(); }
};
