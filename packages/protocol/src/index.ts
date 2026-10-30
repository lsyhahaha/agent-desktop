import { z } from "zod";
export const channels = {
  status: "desktop:status",
  workspace: "desktop:select-workspace",
  settingsGet: "model:settings",
  settingsSave: "model:save",
  chat: "chat:command",
  chatEvent: "chat:event",
} as const;
export const RuntimeStatus = z
  .object({
    state: z.literal("ready"),
    pid: z.number().int().positive(),
    nodeVersion: z.string(),
    uptimeSeconds: z.number().nonnegative(),
  })
  .strict();
export const DesktopStatus = z
  .object({
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
  getStatus(): Promise<DesktopStatus>;
  selectWorkspace(): Promise<WorkspaceSelection>;
  getSettings(): Promise<ModelSettings>;
  saveSettings(value: unknown): Promise<ModelSettings>;
  chat(value: ChatCommand): Promise<ChatSnapshot>;
  onChat(callback: (snapshot: ChatSnapshot) => void): () => void;
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
  z.object({ type: z.literal("snapshot") }).strict(),
  z
    .object({
      type: z.literal("send"),
      text: z.string().trim().min(1).max(16000),
    })
    .strict(),
  z.object({ type: z.literal("cancel") }).strict(),
  z.object({ type: z.literal("clear") }).strict(),
  z
    .object({
      type: z.literal("approve"),
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
      "completed",
      "cancelled",
      "failed",
    ]),
    messages: z
      .array(
        z
          .object({
            id: z.string(),
            role: z.enum(["user", "assistant"]),
            text: z.string(),
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
            name: z.string(),
            path: z.string(),
            state: z.enum([
              "waiting",
              "running",
              "success",
              "denied",
              "error",
              "cancelled",
            ]),
            detail: z.string(),

          })
          .strict(),
      )
      .max(12),
    interaction: z
      .object({
        id: z.string().uuid(),
        path: z.string(),
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
export const RuntimeEvent = z
  .object({
    version: z.literal(1),
    type: z.literal("agent.snapshot"),
    payload: ChatSnapshot,
  })
  .strict();
