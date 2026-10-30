import { contextBridge, ipcRenderer } from "electron";
import {
  channels,
  ModelSettings, SaveSettings,
  DesktopStatus,
  WorkspaceSelection,
  type DesktopBridge,
} from "@protocol";
const bridge: DesktopBridge = Object.freeze({
  getSettings: async () => ModelSettings.parse(await ipcRenderer.invoke(channels.settingsGet)),
  saveSettings: async (value: unknown) => ModelSettings.parse(await ipcRenderer.invoke(channels.settingsSave, SaveSettings.parse(value))),
  getStatus: async () =>
    DesktopStatus.parse(await ipcRenderer.invoke(channels.status)),
  selectWorkspace: async () =>
    WorkspaceSelection.parse(await ipcRenderer.invoke(channels.workspace)),
});
contextBridge.exposeInMainWorld("desktop", bridge);
