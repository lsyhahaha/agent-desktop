import { contextBridge, ipcRenderer } from "electron";
import {
  channels,
  ModelSettings,
  SaveSettings,
  ChatCommand,
  SessionSnapshot,
  DesktopStatus,
  WorkspaceSelection,
  type DesktopBridge,
} from "@protocol";
const bridge: DesktopBridge = Object.freeze({
  getSettings: async () =>
    ModelSettings.parse(await ipcRenderer.invoke(channels.settingsGet)),
  saveSettings: async (value: unknown) =>
    ModelSettings.parse(
      await ipcRenderer.invoke(
        channels.settingsSave,
        SaveSettings.parse(value),
      ),
    ),
  chat: async (value: unknown) =>
    SessionSnapshot.parse(
      await ipcRenderer.invoke(channels.chat, ChatCommand.parse(value)),
    ),
  onChat: (callback: (snapshot: SessionSnapshot) => void) => {
    const listener = (_event: unknown, raw: unknown) => {
      const result = SessionSnapshot.safeParse(raw);
      if (result.success) callback(result.data);
    };
    ipcRenderer.on(channels.chatEvent, listener);
    return () => ipcRenderer.removeListener(channels.chatEvent, listener);
  },
  getStatus: async () =>
    DesktopStatus.parse(await ipcRenderer.invoke(channels.status)),
  selectWorkspace: async () =>
    WorkspaceSelection.parse(await ipcRenderer.invoke(channels.workspace)),
});
contextBridge.exposeInMainWorld("desktop", bridge);
