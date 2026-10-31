import { z } from "zod";
import { ChatSnapshot, WorkspaceSelection, RunSummary } from "@protocol";

/** 数据库不是可信反序列化源：历史版本、损坏及人工修改的数据都须通过有界schema。 */
export const ModelMessage = z
  .object({
    role: z.enum(["user", "assistant", "tool"]),
    content: z.string().max(262144).nullable(),
    tool_calls: z
      .array(
        z
          .object({
            id: z.string().max(256),
            type: z.literal("function"),
            function: z
              .object({
                name: z.string().max(100),
                arguments: z.string().max(4096),
              })
              .strict(),
          })
          .strict(),
      )
      .max(12)
      .optional(),
    tool_call_id: z.string().max(256).optional(),
  })
  .strict();
export const ContextHistory = z
  .array(ModelMessage)
  .max(2000)
  .refine((v) => JSON.stringify(v).length <= 250000);
export const SessionMeta = z
  .object({
    id: z.string().uuid(),
    title: z.string().min(1).max(60),
    customTitle: z.boolean(),
    taskStatus: z.enum(["open", "completed"]),
    workspace: WorkspaceSelection,
    createdAt: z.number(),
    updatedAt: z.number(),
  })
  .strict();
export type SessionMeta = z.infer<typeof SessionMeta>;
/** 原始参数/结果只进本地审计和模型上下文；历史列表只使用view摘要，不复制大文本。 */
export const ToolAudit = z
  .object({
    view: ChatSnapshot.shape.tools.element,
    arguments: z.string().max(4096),
    result: z.string().max(262144).nullable(),
    approval: z.enum([
      "pending",
      "allowed",
      "denied",
      "not_required",
      "expired",
    ]),
    startedAt: z.number().nullable(),
    completedAt: z.number().nullable(),
  })
  .strict();
export type ToolAudit = z.infer<typeof ToolAudit>;
export const RunCheckpoint = z
  .object({
    runId: z.string().uuid(),
    model: z.string().max(100),
    createdAt: z.number(),
    revision: z.number().int().nonnegative(),
    state: ChatSnapshot.shape.state,
    messages: z.array(ChatSnapshot.shape.messages.element).length(2),
    tools: z.array(ToolAudit).max(12),
    usage: ChatSnapshot.shape.usage,
    error: ChatSnapshot.shape.error,
    // 只有成功终态才携带新上下文，事务回滚时不能出现“消息已结束但上下文未提交”。
    context: ContextHistory.optional(),
  })
  .strict();
export type RunCheckpoint = z.infer<typeof RunCheckpoint>;
export const LoadedSession = z
  .object({
    meta: SessionMeta,
    chat: ChatSnapshot,
    history: ContextHistory,
    runs: z.array(RunSummary).max(50),
  })
  .strict();
export const SessionPage = z
  .object({
    sessions: z
      .array(
        z
          .object({
            id: z.string().uuid(),
            title: z.string(),
            state: ChatSnapshot.shape.state,
            taskStatus: z.enum(["open", "completed"]),
            workspaceName: z.string().nullable(),
            updatedAt: z.number(),
          })
          .strict(),
      )
      .max(20),
    hasMore: z.boolean(),
  })
  .strict();
export const StorageRequest = z.discriminatedUnion("op", [
  z.object({ op: z.literal("recover") }).strict(),
  z.object({ op: z.literal("selected") }).strict(),
  z.object({ op: z.literal("draft") }).strict(),
  z.object({ op: z.literal("meta"), meta: SessionMeta }).strict(),
  z.object({ op: z.literal("rename"), meta: SessionMeta }).strict(),
  z.object({ op: z.literal("load"), id: z.string().uuid() }).strict(),
  z
    .object({
      op: z.literal("page"),
      page: z.number().int().min(0).max(100000),
    })
    .strict(),
  z
    .object({ op: z.literal("save"), meta: SessionMeta, run: RunCheckpoint })
    .strict(),
  z
    .object({
      op: z.literal("inspect"),
      sessionId: z.string().uuid(),
      runId: z.string().uuid(),
    })
    .strict(),
  z.object({ op: z.literal("clear"), sessionId: z.string().uuid() }).strict(),
  z.object({ op: z.literal("close") }).strict(),
]);
export type StorageRequest = z.infer<typeof StorageRequest>;
