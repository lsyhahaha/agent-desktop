import { contextBridge, ipcRenderer } from "electron";
import {
  channels,
  DesktopStatus,
  WorkspaceSelection,
  type DesktopBridge,
} from "@protocol";
const bridge: DesktopBridge = Object.freeze({
  getStatus: async () =>
    DesktopStatus.parse(await ipcRenderer.invoke(channels.status)),
  selectWorkspace: async () =>
    WorkspaceSelection.parse(await ipcRenderer.invoke(channels.workspace)),
});
contextBridge.exposeInMainWorld("desktop", bridge);
