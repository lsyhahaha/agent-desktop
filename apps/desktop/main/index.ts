import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  session,
  type IpcMainInvokeEvent,
} from "electron";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join, basename } from "node:path";
import { channels, DesktopStatus, WorkspaceSelection } from "@protocol";
import { RuntimeHost } from "./runtime";
import { Settings } from "./settings";
import { SaveSettings } from "@protocol";
const settings = new Settings();
const here = dirname(fileURLToPath(import.meta.url));
let window: BrowserWindow | undefined;
const runtime = new RuntimeHost(join(here, "runtime.js"));
const rendererFile = join(here, "../renderer/index.html");
function devUrl(): string | undefined {
  if (app.isPackaged || !process.env.ELECTRON_RENDERER_URL) return undefined;
  const url = new URL(process.env.ELECTRON_RENDERER_URL);
  if (
    url.protocol !== "http:" ||
    url.hostname !== "127.0.0.1" ||
    url.port !== "5173"
  )
    throw new Error("Unexpected development renderer URL");
  return url.href;
}
function assertSender(event: IpcMainInvokeEvent): void {
  if (
    !window ||
    event.sender !== window.webContents ||
    event.senderFrame !== window.webContents.mainFrame
  )
    throw new Error("IPC sender rejected");
  const actual = new URL(event.senderFrame.url),
    dev = devUrl();
  if (
    dev
      ? actual.origin !== new URL(dev).origin
      : actual.href.split("#")[0] !== pathToFileURL(rendererFile).href
  )
    throw new Error("IPC origin rejected");
}
function createWindow(): void {
  window = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 1000,
    minHeight: 680,
    title: "Agent Desktop",
    backgroundColor: "#101114",
    titleBarStyle: "hiddenInset",
    webPreferences: {
      preload: join(here, "../preload/index.cjs"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webviewTag: false,
    },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event) => event.preventDefault());
  window.webContents.on("render-process-gone", (_event, detail) =>
    console.error("[desktop] renderer gone", detail.reason),
  );
  window.on("closed", () => {
    window = undefined;
  });
  const url = devUrl();
  void (url ? window.loadURL(url) : window.loadFile(rendererFile)).catch(
    (error: unknown) => {
      console.error("[desktop] renderer load failed", error);
      dialog.showErrorBox("启动失败", "界面加载失败，请查看启动日志。");
      app.quit();
    },
  );
}
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on("second-instance", () => {
    if (window?.isMinimized()) window.restore();
    window?.focus();
  });
  app
    .whenReady()
    .then(async () => {
      session.defaultSession.setPermissionRequestHandler(
        (_contents, _permission, callback) => callback(false),
      );
      session.defaultSession.setPermissionCheckHandler(() => false);
      await settings.load();
      runtime.start();
      ipcMain.handle(channels.settingsGet, event => { assertSender(event); return settings.view(); });
      ipcMain.handle(channels.settingsSave, (event, raw: unknown) => { assertSender(event); return settings.save(SaveSettings.parse(raw)); });
      ipcMain.handle(channels.status, async (event) => {
        assertSender(event);
        return DesktopStatus.parse({
          appVersion: app.getVersion(),
          electronVersion: process.versions.electron,
          runtime: await runtime.status(),
        });
      });
      ipcMain.handle(channels.workspace, async (event) => {
        assertSender(event);
        const result = await dialog.showOpenDialog(window!, {
          title: "选择项目目录",
          properties: ["openDirectory"],
        });
        if (result.canceled || !result.filePaths[0]) return null;
        const path = result.filePaths[0];
        return WorkspaceSelection.parse({ name: basename(path), path });
      });
      createWindow();
      app.on("activate", () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
      });
    })
    .catch((error: unknown) => {
      console.error("[desktop] startup failed", error);
      dialog.showErrorBox("启动失败", String(error));
      app.quit();
    });
  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
  app.on("before-quit", () => runtime.stop());
}
