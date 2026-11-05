import {
  app,
  clipboard,
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
  TerminalCommand,
  channels,
  DesktopStatus,
  WorkspaceSelection,
  BUILD_ID,
  PROTOCOL_VERSION,
  ClientDiagnostic,
  DIAGNOSTIC_PREFIX,
  PluginCommand,
  PluginList,
} from "@protocol";
import { Settings } from "./settings";
import { realpath } from "node:fs/promises";
import { userInfo } from "node:os";
import { ChatCommand, ChatSnapshot, SaveSettings } from "@protocol";
import { RuntimeHost } from "./runtime";
import { PluginManager } from "./plugin-manager";
const here = dirname(fileURLToPath(import.meta.url));
let window: BrowserWindow | undefined;
let active = false;
let dispatching = false;
let selectedRoot: string | null = null;
let currentScope: { sessionId: string; runId: string } | null = null;
let terminalScope: { sessionId: string } | null = null;
const settings = new Settings();
const runtime = new RuntimeHost(
  join(here, "runtime.js"),
  (snapshot) => {
    currentScope = snapshot.chat.runId
      ? { sessionId: snapshot.sessionId, runId: snapshot.chat.runId }
      : null;
    active = [
      "queued",
      "running",
      "waiting_user",
      "waiting_input",
      "waiting_approval",
    ].includes(snapshot.chat.state);
    // 工作区只来自 Main 的原生目录授权或 Runtime 已保存的会话，不接受前端路径。
    selectedRoot = snapshot.workspace?.path ?? null;
    if (window && !window.isDestroyed())
      window.webContents.send(channels.chatEvent, snapshot);
  },
  (snapshot) => {
    terminalScope = {
      sessionId: snapshot.sessionId,
    };
    if (window && !window.isDestroyed())
      window.webContents.send(channels.terminalEvent, snapshot);
  },
);
let plugins: PluginManager | undefined;
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
      if (
        url.length <= 2048 &&
        target.protocol === "https:" &&
        !target.username &&
        !target.password
      ) {
        setImmediate(() => {
          void shell.openExternal(target.href).catch(() => {
            // 不记录完整链接，避免泄露URL中的令牌或用户内容。
            console.warn("[desktop] external_link_open_failed");
            if (window && !window.isDestroyed())
              void dialog
                .showMessageBox(window, {
                  type: "error",
                  message: "无法打开链接",
                  detail: "请检查默认浏览器，或复制链接后手动打开。",
                })
                .catch(() =>
                  console.warn("[desktop] link_error_dialog_failed"),
                );
          });
        });
      }
    } catch {
      console.warn("[desktop] invalid_external_link");
    }
    return { action: "deny" };
  });
  window.webContents.on("will-navigate", (event) => event.preventDefault());
  window.webContents.on("render-process-gone", (_event, detail) => {
    console.error("[desktop] renderer gone", detail.reason);
    if (terminalScope)
      void runtime
        .terminal({ type: "close_all", sessionId: terminalScope.sessionId })
        .catch(() => {});
  });
  window.on("closed", () => {
    if (terminalScope)
      void runtime
        .terminal({ type: "close_all", sessionId: terminalScope.sessionId })
        .catch(() => {});
    if (currentScope && active)
      void runtime.chat({ type: "cancel", ...currentScope }).catch(() => {});
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
      await runtime.status();
      plugins = new PluginManager(
        join(app.getPath("userData"), "plugins"),
        join(here, "plugin-host.js"),
        runtime,
        () => active || dispatching,
      );
      await plugins.load();
      ipcMain.handle(channels.settingsGet, (event) => {
        assertSender(event);
        return settings.view();
      });
      ipcMain.handle(channels.settingsSave, async (event, raw: unknown) => {
        assertSender(event);
        if (active || dispatching) throw new Error("运行期间不能更改模型");
        return settings.save(SaveSettings.parse(raw));
      });
      ipcMain.handle(channels.plugins, async (event, raw: unknown) => {
        assertSender(event);
        if (!plugins) throw new Error("插件管理器尚未就绪");
        const command = PluginCommand.parse(raw);
        if (command.type === "install") {
          if (active || dispatching) throw new Error("请先停止当前运行再安装插件");
          const warning = await dialog.showMessageBox(window!, {
            type: "warning",
            title: "安装受信任的本地插件？",
            message: "插件是本地可执行代码，可能访问你的文件或网络。",
            detail: "独立进程只提供故障隔离，不是安全沙箱。请只安装你已审查并信任的插件目录；Agent Desktop不会运行npm安装脚本。",
            buttons: ["取消", "选择插件目录"],
            defaultId: 0,
            cancelId: 0,
            noLink: true,
          });
          if (warning.response !== 1) return plugins.view();
          const selected = await dialog.showOpenDialog(window!, {
            title: "选择包含 manifest.json 的插件目录",
            properties: ["openDirectory"],
          });
          if (selected.canceled || !selected.filePaths[0]) return plugins.view();
          return PluginList.parse(await plugins.install(await realpath(selected.filePaths[0])));
        }
        if (command.type === "set_enabled" && command.enabled) {
          const warning = await dialog.showMessageBox(window!, {
            type: "warning",
            title: "启用本地插件？",
            message: "启用后，插件可以观察或改写声明的Run、模型和工具数据。",
            detail: "插件不会收到模型API Key，也不能提高Agent权限或绕过删除审批；但插件代码本身仍以当前用户身份运行。",
            buttons: ["取消", "启用"],
            defaultId: 0,
            cancelId: 0,
            noLink: true,
          });
          if (warning.response !== 1) return plugins.view();
        }
        return PluginList.parse(await plugins.command(command));
      });
      let openingTerminal = false;
      ipcMain.handle(channels.terminal, async (event, raw: unknown) => {
        assertSender(event);
        const command = TerminalCommand.parse(raw);
        if (command.type === "paste") {
          const current = await runtime.terminal({
            type: "snapshot",
            sessionId: command.sessionId,
            terminalId: command.terminalId,
          });
          if (
            current.terminal?.terminalId !== command.terminalId ||
            current.terminal.state !== "running"
          )
            throw new Error("终端已失效");
          const text = await clipboard.readText();
          if (text.length > 32768)
            throw new Error("粘贴超过32Ki字符，请分批操作");
          if (/[\r\n]/.test(text)) {
            const answer = await dialog.showMessageBox(window!, {
              type: "warning",
              title: "粘贴多行到本机终端",
              message: "剪贴板包含多行文本，粘贴可能立即执行命令。",
              buttons: ["取消", "粘贴"],
              defaultId: 0,
              cancelId: 0,
            });
            if (answer.response !== 1) return { terminal: null };
          }
          for (let start = 0; start < text.length;) {
            let end = Math.min(text.length, start + 4096);
            const code = text.charCodeAt(end - 1);
            if (code >= 0xd800 && code <= 0xdbff && end < text.length) end--;
            await runtime.terminal({
              type: "write",
              sessionId: command.sessionId,
              terminalId: command.terminalId,
              data: text.slice(start, end),
            });
            start = end;
          }
          return { terminal: null };
        }
        if (command.type !== "open") return runtime.terminal(command);
        if (openingTerminal) throw new Error("正在启动终端");
        openingTerminal = true;
        try {
          const current = await runtime.chat({ type: "snapshot" });
          if (current.sessionId !== command.sessionId || !current.workspace)
            throw new Error("请选择项目目录");
          // 用户打开Terminal即启动；只保留可信工作区与Runtime侧目录校验，不弹启动确认。
          const shell =
            process.env.SHELL === "/bin/bash" ? "/bin/bash" : "/bin/zsh";
          terminalScope = { sessionId: command.sessionId };
          const opened = await runtime.terminal(
            command,
            current.workspace.path,
            {
              shell,
              home: app.getPath("home"),
              path: process.env.PATH ?? "/usr/bin:/bin:/usr/sbin:/sbin",
              user: userInfo().username,
              lang: process.env.LANG ?? "en_US.UTF-8",
              tmp: app.getPath("temp"),
            },
          );
          if (opened.terminal)
            terminalScope = {
              sessionId: opened.terminal.sessionId,
            };
          return opened;
        } finally {
          openingTerminal = false;
        }
      });
      ipcMain.handle(channels.chat, async (event, raw: unknown) => {
        assertSender(event);
        const cmd = ChatCommand.parse(raw);
        if (
          dispatching &&
          !["snapshot", "cancel", "approve", "answer"].includes(cmd.type)
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
        // 真实宿主访问必须经过 Main 的原生确认；renderer 不能伪造已确认字段。
        if (cmd.type === "set_permission" && cmd.mode === "full_access") {
          if (active || dispatching)
            throw new Error("请先停止当前运行再修改权限");
          dispatching = true;
          try {
            const before = await runtime.chat({ type: "snapshot" });
            if (before.sessionId !== cmd.sessionId)
              throw new Error("会话已变化");
            const choice = await dialog.showMessageBox(window!, {
              type: "warning",
              title: "启用完全访问权限？",
              message: "允许 Agent 读写电脑上的文件并联网执行命令？",
              detail:
                "该会话后续任务将以当前用户权限执行，常规操作不逐次审批，删除及无法确认无删除的命令仍须人工确认。可能修改或删除项目外文件、访问个人数据及联网。手动终端权限不受影响。",
              buttons: ["取消", "启用完全访问权限"],
              defaultId: 0,
              cancelId: 0,
              noLink: true,
            });
            if (choice.response !== 1) return before;
            return await runtime.chat(cmd);
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
    void Promise.resolve(plugins?.close()).finally(() =>
      runtime.stop().finally(() => app.quit()),
    );
  });
}
