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
import { Settings } from "./settings";
import { realpath } from "node:fs/promises";
import { ChatCommand, ChatSnapshot, SaveSettings } from "@protocol";
import { RuntimeHost } from "./runtime";
const here = dirname(fileURLToPath(import.meta.url));
let window: BrowserWindow | undefined;
let active = false;
let dispatching = false;
let selectedRoot: string | null = null;
const settings = new Settings();
const runtime = new RuntimeHost(join(here, "runtime.js"), (snapshot) => {
  active = ["running", "waiting_user"].includes(snapshot.chat.state);
  // 工作区只来自 Main 的原生目录授权或 Runtime 已保存的会话，不接受前端路径。
  selectedRoot = snapshot.workspace?.path ?? null;
  if (window && !window.isDestroyed())
    window.webContents.send(channels.chatEvent, snapshot);
});
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
    // 与浅色工作台一致，避免 renderer 加载前闪出深色底。
    backgroundColor: "#eceff0",
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
    void runtime.chat({ type: "cancel" }).catch(() => {});
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
      ipcMain.handle(channels.settingsGet, (event) => {
        assertSender(event);
        return settings.view();
      });
      ipcMain.handle(channels.settingsSave, async (event, raw: unknown) => {
        assertSender(event);
        if (active || dispatching) throw new Error("运行期间不能更改模型");
        return settings.save(SaveSettings.parse(raw));
      });
      ipcMain.handle(channels.chat, async (event, raw: unknown) => {
        assertSender(event);
        const cmd = ChatCommand.parse(raw);
        if (
          dispatching &&
          !["snapshot", "cancel", "approve"].includes(cmd.type)
        )
          throw new Error("正在接纳任务，请稍后重试");
        if (cmd.type === "send") {
          if (active || dispatching) throw new Error("已有运行正在进行");
          dispatching = true;
          try {
            const config = await settings.credentials();
            return await runtime.chat(cmd, { config, root: selectedRoot });
          } finally {
            dispatching = false;
          }
        }
        return runtime.chat(cmd);
      });
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
        if (active || dispatching)
          throw new Error("请先停止当前运行再切换工作区");
        const result = await dialog.showOpenDialog(window!, {
          title: "选择项目目录",
          properties: ["openDirectory"],
        });
        if (result.canceled || !result.filePaths[0]) return null;
        if (active || dispatching) throw new Error("运行期间不能切换工作区");
        const path = await realpath(result.filePaths[0]);
        // 选择新项目开启独立会话，保留旧项目上下文与授权；同一项目不重置历史。
        if (selectedRoot !== path)
          await runtime.chat({ type: "new" }, undefined, {
            name: basename(path),
            path,
          });
        selectedRoot = path;
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
