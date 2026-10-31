import { contextBridge, ipcRenderer } from "electron";
import {
  TerminalCommand,
  TerminalSnapshot,
  TerminalReply,
  channels,
  ModelSettings,
  SaveSettings,
  ChatCommand,
  SessionSnapshot,
  DesktopStatus,
  WorkspaceSelection,
  DIAGNOSTIC_PREFIX,
  validationFields,
  type DesktopBridge,
} from "@protocol";
import type { z } from "zod";

type Operation =
  | "status"
  | "chat"
  | "terminal"
  | "terminal_event"
  | "chat_event"
  | "settings_get"
  | "settings_save"
  | "workspace";
const reported = new Map<string, number>();
let incompatible = false;
const mismatch =
  "[protocol_mismatch] 界面与后台版本不一致。请完整退出 Agent Desktop（⌘Q）后重新启动；仅刷新页面不能更新后台。";
/** 错误日志只包含类别、操作和字段名，限制每种类别/操作10秒一次，避免坏事件刷屏。 */
function report(
  code: "protocol_mismatch" | "invalid_request" | "ipc_failed",
  operation: Operation,
  fields: string[] = [],
) {
  const now = Date.now(),
    key = `${code}:${operation}`;
  if (now - (reported.get(key) ?? 0) >= 10000) {
    reported.set(key, now);
    console.error(
      DIAGNOSTIC_PREFIX + JSON.stringify({ code, operation, fields }),
    );
  }
}
function validate<T>(
  schema: z.ZodType<T>,
  value: unknown,
  operation: Operation,
  request = false,
): T {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  const code = request ? "invalid_request" : "protocol_mismatch";
  if (!request) incompatible = true;
  report(code, operation, validationFields(result.error));
  throw new Error(
    request ? "[invalid_request] 输入不符合要求，本次操作未发送。" : mismatch,
  );
}
let connecting: Promise<import("@protocol").DesktopStatus> | undefined;
/** 必须先确认Main和Runtime与本次preload是同一构建，不能把旧进程的健康ping当成协议可用。 */
function connection() {
  if (incompatible) return Promise.reject(new Error(mismatch));
  if (!connecting)
    connecting = (async () => {
      let value: unknown;
      try {
        value = await ipcRenderer.invoke(channels.status);
      } catch (error) {
        const versionError =
          error instanceof Error &&
          error.message.includes("[protocol_mismatch]");
        report(versionError ? "protocol_mismatch" : "ipc_failed", "status");
        throw new Error(
          versionError
            ? mismatch
            : "[connection_failed] 无法连接本地后台，请查看启动终端并检查本地存储；不要删除会话数据库。",
        );
      }
      return validate(DesktopStatus, value, "status");
    })();
  return connecting;
}
async function invoke<T>(
  operation: Operation,
  channel: string,
  schema: z.ZodType<T>,
  input?: unknown,
) {
  const cancellation =
    operation === "chat" &&
    !!input &&
    typeof input === "object" &&
    "type" in input &&
    input.type === "cancel";
  if (!cancellation) {
    await connection();
    if (incompatible) throw new Error(mismatch);
  }
  let value: unknown;
  try {
    value = await ipcRenderer.invoke(channel, input);
  } catch (error) {
    const versionError =
      error instanceof Error && error.message.includes("[protocol_mismatch]");
    if (versionError) incompatible = true;
    report(versionError ? "protocol_mismatch" : "ipc_failed", operation);
    // Electron远端Error可能包含原始Zod详情，不能直接把整个异常放进产品页面。
    throw new Error(
      versionError
        ? mismatch
        : operation === "status"
          ? "[connection_failed] 无法连接本地后台，请查看启动终端并检查本地存储。"
          : "[ipc_failed] 操作未完成，请检查本地存储和会话状态；详情见启动终端或开发者工具 Console。",
    );
  }
  return validate(schema, value, operation);
}
const bridge: DesktopBridge = Object.freeze({
  terminal: (value: unknown) =>
    invoke(
      "terminal",
      channels.terminal,
      TerminalReply,
      validate(TerminalCommand, value, "terminal", true),
    ),
  onTerminal: (
    callback: (snapshot: import("@protocol").TerminalSnapshot) => void,
    onError?: (message: string) => void,
  ) => {
    const listener = (_event: unknown, raw: unknown) => {
      const result = TerminalSnapshot.safeParse(raw);
      if (result.success) callback(result.data);
      else {
        report(
          "protocol_mismatch",
          "terminal_event",
          validationFields(result.error),
        );
        onError?.("终端协议不匹配，请完整重启应用。");
      }
    };
    ipcRenderer.on(channels.terminalEvent, listener);
    return () => ipcRenderer.removeListener(channels.terminalEvent, listener);
  },
  getSettings: () =>
    invoke("settings_get", channels.settingsGet, ModelSettings),
  saveSettings: (value: unknown) =>
    invoke(
      "settings_save",
      channels.settingsSave,
      ModelSettings,
      validate(SaveSettings, value, "settings_save", true),
    ),
  chat: (value: unknown) =>
    invoke(
      "chat",
      channels.chat,
      SessionSnapshot,
      validate(ChatCommand, value, "chat", true),
    ),
  onChat: (
    callback: (snapshot: SessionSnapshot) => void,
    onError?: (message: string) => void,
  ) => {
    let disposed = false,
      verified = false;
    let pending: unknown;
    const receive = (raw: unknown) => {
      if (disposed || incompatible) return;
      const result = SessionSnapshot.safeParse(raw);
      if (!result.success) {
        incompatible = true;
        report(
          "protocol_mismatch",
          "chat_event",
          validationFields(result.error),
        );
        onError?.(mismatch);
        return;
      }
      callback(result.data);
    };
    const listener = (_event: unknown, raw: unknown) => {
      if (!verified) {
        pending = raw;
        return;
      }
      receive(raw);
    };
    // 校验连接期间只缓存最新一次快照，既不漏初始化事件，也不无限积压旧进程的数据。
    ipcRenderer.on(channels.chatEvent, listener);
    void connection()
      .then(() => {
        verified = true;
        if (pending !== undefined) receive(pending);
        pending = undefined;
      })
      .catch((error) => {
        if (!disposed)
          onError?.(
            error instanceof Error
              ? error.message
              : "[connection_failed] 后台连接失败",
          );
      });
    return () => {
      disposed = true;
      pending = undefined;
      ipcRenderer.removeListener(channels.chatEvent, listener);
    };
  },
  getStatus: async () => {
    // 仅缓存构建握手，健康状态每次重新查询，避免进程退出后继续返回过期的ready。
    const value = await invoke("status", channels.status, DesktopStatus);
    if (incompatible) throw new Error(mismatch);
    return value;
  },
  selectWorkspace: () =>
    invoke("workspace", channels.workspace, WorkspaceSelection),
});
contextBridge.exposeInMainWorld("desktop", bridge);
