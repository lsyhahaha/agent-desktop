import { z } from "zod";
import { TerminalCommand, TerminalSnapshot, TerminalProfile } from "./terminal";
export * from "./terminal";
import { Timeline } from "./timeline";
export * from "./timeline";
// 构建时对Main/preload/Runtime注入同一标识；数据库格式版本独立维护，不跟随构建改变。
declare const __APP_BUILD_ID__: string;
export const BUILD_ID =
  typeof __APP_BUILD_ID__ === "string" ? __APP_BUILD_ID__ : "unbundled-source";
export const PROTOCOL_VERSION = 7;
const buildIdentity = {
  protocolVersion: z.literal(PROTOCOL_VERSION),
  buildId: z.literal(BUILD_ID),
};
export const DIAGNOSTIC_PREFIX = "[agent-desktop:diagnostic]";
export const ClientDiagnostic = z
  .object({
    code: z.enum(["protocol_mismatch", "invalid_request", "ipc_failed"]),
    operation: z.enum([
      "status",
      "chat",
      "chat_event",
      "terminal",
      "terminal_event",
      "settings_get",
      "settings_save",
      "workspace",
    ]),
    fields: z
      .array(
        z
          .string()
          .max(100)
          .regex(/^[a-zA-Z_$.*]+$/),
      )
      .max(12),
  })
  .strict();
/** 只记录schema字段名，不记录message、received值、原始快照、文件内容或凭据。 */
export function validationFields(error: { issues: { path: PropertyKey[] }[] }) {
  return [
    ...new Set(
      error.issues.map(
        (issue) =>
          issue.path
            .map((part) =>
              typeof part === "number"
                ? "*"
                : typeof part === "string" && /^[a-zA-Z_]+$/.test(part)
                  ? part
                  : "field",
            )
            .join(".") || "$",
      ),
    ),
  ]
    .slice(0, 12)
    .map((field) => field.slice(0, 100));
}
export const channels = {
  status: "desktop:status",
  workspace: "desktop:select-workspace",
  settingsGet: "model:settings",
  settingsSave: "model:save",
  chat: "chat:command",
  chatEvent: "chat:event",
  terminal: "terminal:command",
  terminalEvent: "terminal:event",
} as const;
export const RuntimeStatus = z
  .object({
    ...buildIdentity,
    state: z.literal("ready"),
    pid: z.number().int().positive(),
    nodeVersion: z.string(),
    uptimeSeconds: z.number().nonnegative(),
  })
  .strict();
export const DesktopStatus = z
  .object({
    ...buildIdentity,
    appVersion: z.string(),
    electronVersion: z.string(),
    runtime: RuntimeStatus,
  })
  .strict();
export const WorkspaceSelection = z
  .object({ name: z.string(), path: z.string() })
  .strict()
  .nullable();
export type DesktopStatus = z.infer<typeof DesktopStatus>;
export type WorkspaceSelection = z.infer<typeof WorkspaceSelection>;
export interface DesktopBridge {
  terminal(value: import("./terminal").TerminalCommand): Promise<{
    terminal: import("./terminal").TerminalSnapshot | null;
    terminals?: import("./terminal").TerminalTab[];
  }>;
  onTerminal(
    callback: (snapshot: import("./terminal").TerminalSnapshot) => void,
    onError?: (message: string) => void,
  ): () => void;
  getStatus(): Promise<DesktopStatus>;
  selectWorkspace(): Promise<WorkspaceSelection>;
  getSettings(): Promise<ModelSettings>;
  saveSettings(value: unknown): Promise<ModelSettings>;
  chat(value: ChatCommand): Promise<SessionSnapshot>;
  onChat(
    callback: (snapshot: SessionSnapshot) => void,
    onError?: (message: string) => void,
  ): () => void;
}

export const ModelSettings = z
  .object({ model: z.string().min(1).max(100), hasKey: z.boolean() })
  .strict();
export type ModelSettings = z.infer<typeof ModelSettings>;
export const SaveSettings = z
  .object({
    model: z
      .string()
      .trim()
      .min(1)
      .max(100)
      .regex(/^[a-zA-Z0-9._/-]+$/),
    apiKey: z.string().trim().max(512).optional(),
  })
  .strict();
export const ChatCommand = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("list_sessions"),
      page: z.number().int().min(0).max(100000),
    })
    .strict(),
  z
    .object({
      type: z.literal("inspect_run"),
      sessionId: z.string().uuid(),
      runId: z.string().uuid(),
    })
    .strict(),
  z.object({ type: z.literal("snapshot") }).strict(),
  z
    .object({
      type: z.literal("send"),
      sessionId: z.string().uuid(),
      text: z.string().trim().min(1).max(16000),
    })
    .strict(),
  z
    .object({
      type: z.literal("cancel"),
      sessionId: z.string().uuid(),
      runId: z.string().uuid(),
    })
    .strict(),
  z
    .object({
      type: z.literal("answer"),
      sessionId: z.string().uuid(),
      runId: z.string().uuid(),
      interactionId: z.string().uuid(),
      answer: z.string().trim().min(1).max(4000),
    })
    .strict(),
  z.object({ type: z.literal("clear") }).strict(),
  z.object({ type: z.literal("new") }).strict(),
  z
    .object({ type: z.literal("complete_task"), sessionId: z.string().uuid() })
    .strict(),
  z
    .object({ type: z.literal("select"), sessionId: z.string().uuid() })
    .strict(),
  z
    .object({
      type: z.literal("rename"),
      sessionId: z.string().uuid(),
      title: z.string().trim().min(1).max(60),
    })
    .strict(),
  z
    .object({
      type: z.literal("approve"),
      sessionId: z.string().uuid(),
      runId: z.string().uuid(),
      interactionId: z.string().uuid(),
      allow: z.boolean(),
    })
    .strict(),
]);
export type ChatCommand = z.infer<typeof ChatCommand>;
export const ChatSnapshot = z
  .object({
    revision: z.number().int().nonnegative(),
    runId: z.string().nullable(),
    state: z.enum([
      "idle",
      "running",
      "waiting_user",
      "queued",
      "waiting_input",
      "waiting_approval",
      "completed",
      "cancelled",
      "failed",
      "interrupted",
    ]),
    items: Timeline,
    timelineVersion: z.literal(1).nullable(),
    stopping: z.boolean(),
    messages: z
      .array(
        z
          .object({
            id: z.string(),
            runId: z.string().uuid(),
            role: z.enum(["user", "assistant"]),
            text: z.string().max(65536),
            state: z.enum(["streaming", "complete", "interrupted"]),
          })
          .strict(),
      )
      .max(100),
    tools: z
      .array(
        z
          .object({
            id: z.string(),
            name: z.string().max(100),
            path: z.string().max(9000),
            state: z.enum([
              "waiting",
              "running",
              "success",
              "denied",
              "error",
              "cancelled",
              "interrupted",
              "unknown",
            ]),
            detail: z.string().max(1000),
            // 命令输出保持有界，按快照增量频率投影；不暴露进程句柄或任意IPC。
            execution: z
              .object({
                execution_id: z.string().uuid(),
                status: z.enum([
                  "running",
                  "exited",
                  "cancelled",
                  "timed_out",
                  "output_limit",
                  "spawn_failed",
                  "unknown",
                ]),
                exit_code: z.number().int().nullable(),
                signal: z.string().nullable(),
                output: z.string().max(32776),
                truncated: z.boolean(),
              })
              .strict()
              .optional(),
          })
          .strict(),
      )
      .max(12),
    interaction: z
      .object({
        id: z.string().uuid(),
        path: z.string(),
        kind: z.enum(["read_file", "exec_command", "edit_file", "input"]),
        itemId: z.string().uuid(),
        options: z.array(z.string().max(300)).max(6).optional(),
      })
      .strict()
      .nullable(),
    usage: z
      .object({
        input: z.number().nonnegative(),
        output: z.number().nonnegative(),
        complete: z.boolean(),
      })
      .strict(),
    error: z
      .object({ code: z.string(), message: z.string() })
      .strict()
      .nullable(),
  })
  .strict();
export type ChatSnapshot = z.infer<typeof ChatSnapshot>;

/** 历史列表只携带摘要；按轮加载工具详情，避免流式期间反复发送全部历史输出。 */
export const RunSummary = z
  .object({
    id: z.string().uuid(),
    state: ChatSnapshot.shape.state,
    toolCount: z.number().int().min(0).max(12),
    createdAt: z.number(),
    timelineVersion: z.literal(1).nullable(),
  })
  .strict();
export type RunSummary = z.infer<typeof RunSummary>;
export const RunInspection = z
  .object({
    runId: z.string().uuid(),
    tools: ChatSnapshot.shape.tools,
    items: Timeline,
    timelineVersion: z.literal(1).nullable(),
  })
  .strict();

/** 会话索引由 Runtime 拥有；窗口只接收当前会话投影，不接触其他会话的模型上下文。 */
export const SessionSnapshot = z
  .object({
    revision: z.number().int().nonnegative(),
    sessionId: z.string().uuid(),
    taskStatus: z.enum(["open", "completed"]),
    workspace: WorkspaceSelection,
    title: z.string().min(1).max(60),
    sessionPage: z.number().int().nonnegative(),
    hasMoreSessions: z.boolean(),
    storageError: z.string().nullable(),
    runs: z.array(RunSummary).max(50),
    inspectedRun: RunInspection.nullable(),
    chat: ChatSnapshot,
    sessions: z
      .array(
        z
          .object({
            id: z.string().uuid(),
            title: z.string().min(1).max(60),
            state: ChatSnapshot.shape.state,
            taskStatus: z.enum(["open", "completed"]),
            workspaceName: z.string().nullable(),
            updatedAt: z.number(),
          })
          .strict(),
      )
      .max(20),
  })
  .strict();
export type SessionSnapshot = z.infer<typeof SessionSnapshot>;

export const RuntimeContext = z
  .object({
    config: z
      .object({
        model: z.string().min(1).max(100),
        apiKey: z.string().min(1).max(512),
      })
      .strict(),
    root: z.string().nullable(),
  })
  .strict();
export const RuntimeRequest = z.discriminatedUnion("type", [
  z
    .object({
      version: z.literal(1),
      id: z.string().uuid(),
      type: z.literal("terminal.command"),
      command: TerminalCommand,
      authorizedRoot: z.string().max(4096).optional(),
      profile: TerminalProfile.optional(),
    })
    .strict(),
  // 仅Main持有父端口；退出前让Runtime清理自己启动的命令进程组。
  z
    .object({
      version: z.literal(1),
      id: z.string().uuid(),
      type: z.literal("runtime.shutdown"),
    })
    .strict(),
  z
    .object({
      version: z.literal(1),
      id: z.string().uuid(),
      type: z.literal("runtime.ping"),
    })
    .strict(),
  z
    .object({
      version: z.literal(1),
      id: z.string().uuid(),
      type: z.literal("agent.command"),
      command: ChatCommand,
      context: RuntimeContext.optional(),
      workspace: WorkspaceSelection.optional(),
    })
    .strict(),
]);
export const RuntimeResponse = z
  .object({
    version: z.literal(1),
    id: z.string().uuid(),
    type: z.literal("rpc.result"),
    payload: z.unknown().optional(),
    error: z.string().optional(),
  })
  .strict();
export const RuntimeEvent = z.discriminatedUnion("type", [
  z
    .object({
      version: z.literal(1),
      type: z.literal("terminal.snapshot"),
      payload: TerminalSnapshot,
    })
    .strict(),
  z
    .object({
      version: z.literal(1),
      type: z.literal("agent.snapshot"),
      payload: SessionSnapshot,
    })
    .strict(),
]);
