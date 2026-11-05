import { z } from "zod";

/** 插件协议只允许这些稳定阶段；审批、存储与权限不对插件开放。 */
export const HookStage = z.enum([
  "run.before",
  "model.before",
  "model.after",
  "tool.before",
  "tool.after",
  "run.after",
]);
export type HookStage = z.infer<typeof HookStage>;
export const HookMode = z.enum(["observe", "mutate"]);
const pluginId = z
  .string()
  .trim()
  .min(3)
  .max(100)
  .regex(/^[a-z0-9]+(?:[.-][a-z0-9]+)+$/);
const version = z
  .string()
  .trim()
  .min(1)
  .max(40)
  .regex(/^[0-9]+\.[0-9]+\.[0-9]+(?:-[a-zA-Z0-9.-]+)?$/);

export const PluginManifestV1 = z
  .object({
    schemaVersion: z.literal(1),
    id: pluginId,
    name: z.string().trim().min(1).max(80),
    version,
    entry: z
      .string()
      .min(1)
      .max(240)
      .regex(/^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[a-zA-Z0-9_./-]+\.m?js$/),
    runtimeApiVersion: z.literal(1),
    hooks: z
      .array(
        z.object({ stage: HookStage, mode: HookMode }).strict(),
      )
      .min(1)
      .max(12)
      .refine(
        (items) => new Set(items.map((item) => item.stage)).size === items.length,
        "hook stage must be unique",
      ),
  })
  .strict();
export type PluginManifestV1 = z.infer<typeof PluginManifestV1>;

export const PluginStatus = z.enum([
  "disabled",
  "starting",
  "ready",
  "failed",
  "incompatible",
]);
export const InstalledPlugin = z
  .object({
    manifest: PluginManifestV1,
    digest: z.string().regex(/^[a-f0-9]{64}$/),
    enabled: z.boolean(),
    order: z.number().int().min(0).max(63),
    status: PluginStatus,
    lastError: z.string().max(500).nullable(),
  })
  .strict();
export type InstalledPlugin = z.infer<typeof InstalledPlugin>;
export const PluginList = z
  .object({ plugins: z.array(InstalledPlugin).max(64), activeRun: z.boolean() })
  .strict();
export type PluginList = z.infer<typeof PluginList>;

export const PluginCommand = z.discriminatedUnion("type", [
  z.object({ type: z.literal("list") }).strict(),
  z.object({ type: z.literal("install") }).strict(),
  z.object({ type: z.literal("set_enabled"), id: pluginId, enabled: z.boolean() }).strict(),
  z.object({ type: z.literal("move"), id: pluginId, direction: z.enum(["up", "down"]) }).strict(),
  z.object({ type: z.literal("remove"), id: pluginId }).strict(),
]);
export type PluginCommand = z.infer<typeof PluginCommand>;

const safeText = z.string().max(65536);
const modelMessage = z
  .object({
    role: z.enum(["system", "user", "assistant", "tool"]),
    content: safeText.nullable(),
    tool_calls: z
      .array(
        z.object({
          id: z.string().max(256),
          type: z.literal("function"),
          function: z.object({ name: z.string().max(100), arguments: z.string().max(200000) }).strict(),
        }).strict(),
      )
      .max(12)
      .optional(),
    tool_call_id: z.string().max(256).optional(),
  })
  .strict();
const toolCall = z
  .object({
    id: z.string().max(256),
    name: z.string().max(100),
    arguments: z.string().max(200000),
  })
  .strict();

/** Hook输入不包含Key、数据库句柄、权限对象或可执行函数。 */
export const HookContext = z.discriminatedUnion("stage", [
  z.object({ stage: z.literal("run.before"), runId: z.string().uuid(), input: z.string().max(16000), workspace: z.string().max(4096).nullable() }).strict(),
  z.object({ stage: z.literal("model.before"), runId: z.string().uuid(), attempt: z.number().int().positive(), messages: z.array(modelMessage).max(120), maxTokens: z.number().int().min(1).max(4096) }).strict(),
  z.object({ stage: z.literal("model.after"), runId: z.string().uuid(), attempt: z.number().int().positive(), text: safeText, calls: z.array(toolCall).max(12) }).strict(),
  z.object({ stage: z.literal("tool.before"), runId: z.string().uuid(), call: toolCall }).strict(),
  z.object({ stage: z.literal("tool.after"), runId: z.string().uuid(), call: toolCall, result: z.string().max(262144), state: z.enum(["success", "error", "denied"]) }).strict(),
  z.object({ stage: z.literal("run.after"), runId: z.string().uuid(), status: z.enum(["completed", "failed", "cancelled"]), reply: safeText }).strict(),
]);
export type HookContext = z.infer<typeof HookContext>;

const HookPatch = z.union([
  z.object({ stage: z.literal("run.before"), input: z.string().max(16000).optional(), systemInstructions: z.string().max(8000).optional() }).strict(),
  z.object({ stage: z.literal("model.before"), messages: z.array(modelMessage).max(120).optional(), maxTokens: z.number().int().min(1).max(4096).optional() }).strict(),
  z.object({ stage: z.literal("model.after"), text: safeText.optional(), calls: z.array(toolCall).max(12).optional() }).strict(),
  z.object({ stage: z.literal("tool.before"), arguments: z.string().max(200000).optional() }).strict(),
  z.object({ stage: z.literal("tool.after"), result: z.string().max(262144).optional() }).strict(),
  z.object({ stage: z.literal("run.after"), reply: safeText.optional(), append: z.string().max(8000).optional() }).strict(),
]);
export type HookPatch = z.infer<typeof HookPatch>;
export const HookDecision = z.discriminatedUnion("action", [
  z.object({ action: z.literal("continue"), patch: HookPatch.optional() }).strict(),
  z.object({ action: z.literal("deny"), code: z.string().regex(/^[a-z][a-z0-9_]{2,63}$/), message: z.string().trim().min(1).max(500) }).strict(),
]);
export type HookDecision = z.infer<typeof HookDecision>;

export const PluginHostRequest = z.discriminatedUnion("type", [
  z.object({ type: z.literal("probe"), id: z.string().uuid(), manifest: PluginManifestV1 }).strict(),
  z.object({ type: z.literal("hook"), id: z.string().uuid(), mode: HookMode, context: HookContext }).strict(),
  z.object({ type: z.literal("shutdown"), id: z.string().uuid() }).strict(),
]);
export const PluginHostResponse = z.discriminatedUnion("type", [
  z.object({ type: z.literal("ready"), id: z.string().uuid(), hooks: z.array(HookStage).max(12) }).strict(),
  z.object({ type: z.literal("result"), id: z.string().uuid(), decision: HookDecision }).strict(),
  z.object({ type: z.literal("error"), id: z.string().uuid(), code: z.string().max(100), message: z.string().max(500) }).strict(),
]);

export const RuntimePluginDescriptor = z
  .object({
    id: pluginId,
    name: z.string().min(1).max(80),
    version,
    digest: z.string().regex(/^[a-f0-9]{64}$/),
    hooks: PluginManifestV1.shape.hooks,
    order: z.number().int().min(0).max(63),
  })
  .strict();
export type RuntimePluginDescriptor = z.infer<typeof RuntimePluginDescriptor>;
