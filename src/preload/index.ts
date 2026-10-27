import { contextBridge, ipcRenderer } from "electron";
import type { DesktopAPI } from "../shared/types";
const api: DesktopAPI = {
  onNavigateNotices: (fn) => {
    ipcRenderer.on("navigate-notices", fn);
    return () => {
      ipcRenderer.removeListener("navigate-notices", fn);
    };
  },
  configuration: () => ipcRenderer.invoke("configuration"),
  saveAI: (config, key) => ipcRenderer.invoke("saveAI", config, key),
  saveAPI: (config) => ipcRenderer.invoke("saveAPI", config),
  copyAPIToken: () => ipcRenderer.invoke("copyAPIToken"),
  rotateAPIToken: () => ipcRenderer.invoke("rotateAPIToken"),
  analyzeTask: (id) => ipcRenderer.invoke("analyzeTask", id),
  testAI: () => ipcRenderer.invoke("testAI"),
  diagnostics: () => ipcRenderer.invoke("diagnostics"),
  snapshot: () => ipcRenderer.invoke("snapshot"),
  sync: () => ipcRenderer.invoke("sync"),
  login: (p) => ipcRenderer.invoke("login", p),
  finishLogin: (p) => ipcRenderer.invoke("finishLogin", p),
  complete: (id, done) => ipcRenderer.invoke("complete", id, done),
  correct: (id, value) => ipcRenderer.invoke("correct", id, value),
  readNotice: (id) => ipcRenderer.invoke("readNotice", id),
  snooze: (id) => ipcRenderer.invoke("snooze", id),
  saveSettings: (s) => ipcRenderer.invoke("saveSettings", s),
  open: (url) => ipcRenderer.invoke("open", url),
  testNotification: () => ipcRenderer.invoke("testNotification"),
  backup: () => ipcRenderer.invoke("backup"),
  restore: () => ipcRenderer.invoke("restore"),
  openData: () => ipcRenderer.invoke("openData"),
  installBrowser: () => ipcRenderer.invoke("installBrowser"),
  onChanged: (fn) => {
    ipcRenderer.on("changed", fn);
    return () => {
      ipcRenderer.removeListener("changed", fn);
    };
  },
};
contextBridge.exposeInMainWorld("reminder", api);
