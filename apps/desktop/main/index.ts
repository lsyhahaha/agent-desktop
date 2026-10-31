import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  session,
  shell,
  type IpcMainInvokeEvent,
} from "electron";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join, basename } from "node:path";
import {
  channels,
  DesktopStatus,
  WorkspaceSelection,
  BUILD_ID,
  PROTOCOL_VERSION,
  ClientDiagnostic,
  DIAGNOSTIC_PREFIX,
} from "@protocol";
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
  // 只转发受约束诊断字段。普通console错误仅记录级别/行号，绝不搬运任意网页或模型文本。
  window.webContents.on("console-message", (details) => {
    if (details.message.startsWith(DIAGNOSTIC_PREFIX)) {
      if (details.message.length > 4096) {
        console.warn("[desktop] invalid_client_diagnostic");
        return;
      }
      try {
        const diagnostic = ClientDiagnostic.parse(
          JSON.parse(details.message.slice(DIAGNOSTIC_PREFIX.length)),
        );
        console.error("[desktop] client_diagnostic", diagnostic);
      } catch {
        console.warn("[desktop] invalid_client_diagnostic");
      }
    } else if (details.level === "error") {
      console.error("[desktop] renderer_console_error", {
        line: details.lineNumber,
      });
    }
  });
  // Markdown链接只能在系统浏览器打开HTTPS网页；不允许本地文件/应用协议或新Electron窗口。
  window.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const target = new URL(url);
      if (url.length <= 2048 && target.protocol === "https:" && !target.username && !target.password) {
        setImmediate(() => {
          void shell.openExternal(target.href).catch(() => {
            // 不记录完整链接，避免泄露URL中的令牌或用户内容。
            console.warn("[desktop] external_link_open_failed");
            if (window && !window.isDestroyed())
              void dialog.showMessageBox(window, {
                type: "error", message: "无法打开链接", detail: "请检查默认浏览器，或复制链接后手动打开。",
              }).catch(() => console.warn("[desktop] link_error_dialog_failed"));
          });
        });
      }
    } catch {
      console.warn("[desktop] invalid_external_link");
    }
    return { action: "deny" };
  });
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
if (!app.requestSingleInstanceLock({ buildId: BUILD_ID })) {
  console.error(
    "[desktop] startup_blocked: Agent Desktop 已有实例运行，本次没有启动新后台。请先在旧应用中按 ⌘Q 完整退出，再执行 npm start；关闭窗口或刷新页面不等于退出。",
  );
  app.exit(1);
} else {
  app.on("second-instance", (_event, _argv, _cwd, additionalData) => {
    console.warn("[desktop] existing_instance_reused", {
      buildMismatch:
        (additionalData &&
        typeof additionalData === "object" &&
        "buildId" in additionalData
          ? additionalData.buildId
          : null) !== BUILD_ID,
    });
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
      runtime.start(
        join(app.getPath("userData"), "storage", "sessions.sqlite"),
      );
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
          protocolVersion: PROTOCOL_VERSION,
          buildId: BUILD_ID,
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
  let quitting = false;
  app.on("before-quit", (event) => {
    if (quitting) return;
    event.preventDefault();
    quitting = true;
    // 原生退出先等待Runtime取消与刷盘；超时由RuntimeHost处理，避免无限阻塞退出。
    void runtime.stop().finally(() => app.quit());
  });
}
