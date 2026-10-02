const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("nakama", {
  api: (method, path, body) =>
    ipcRenderer.invoke("nakama:api", method, path, body),
  chooseFolder: () => ipcRenderer.invoke("nakama:choose-folder"),
  copyText: (value) => ipcRenderer.invoke("nakama:copy-text", value),
  openProjectFolder: (projectId) =>
    ipcRenderer.invoke("nakama:open-project-folder", projectId),
  saveProjectReport: (projectId, reportId) =>
    ipcRenderer.invoke("nakama:save-project-report", projectId, reportId),
  openProjectReport: (projectId, reportId) =>
    ipcRenderer.invoke("nakama:open-project-report", projectId, reportId),
  openExternal: (url) => ipcRenderer.invoke("nakama:external", url),
  onEvent: (callback) => {
    const listener = (_event, message) => callback(message);
    ipcRenderer.on("nakama:event", listener);
    return () => ipcRenderer.removeListener("nakama:event", listener);
  },
});
