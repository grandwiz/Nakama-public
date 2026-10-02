const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("remoteSession", { stop: () => ipcRenderer.send("nakama:remote-stop") });
