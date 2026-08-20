/* eslint-disable @typescript-eslint/no-require-imports */
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("sbsDesktop", Object.freeze({
  isDesktop: true,
  getApiKeyStatus: () => ipcRenderer.invoke("sbs:settings:status"),
  saveOpenAiApiKey: (apiKey) => ipcRenderer.invoke("sbs:settings:save-openai-key", apiKey),
  clearOpenAiApiKey: () => ipcRenderer.invoke("sbs:settings:clear-openai-key"),
}));
