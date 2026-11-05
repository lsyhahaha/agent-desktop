import { z } from "zod";

/** 时间线是Runtime事实的有界投影；seq只表示首次出现顺序，更新不改变节点身份。 */
const base = {
  id: z.string().uuid(),
  runId: z.string().uuid(),
  seq: z.number().int().positive(),
  status: z.enum([
    "pending",
    "running",
    "completed",
    "failed",
    "skipped",
    "cancelled",
    "interrupted",
    "unknown",
  ]),
  createdAt: z.number().nonnegative(),
  updatedAt: z.number().nonnegative(),
  endedAt: z.number().nullable(),
  summary: z.string().max(1000),
  phase: z.enum(["started", "delta", "completed"]),
};
export const PlanSteps = z
  .array(
    z
      .object({
        step: z.string().min(1).max(300),
        status: z.enum(["pending", "running", "completed", "skipped"]),
      })
      .strict(),
  )
  .min(1)
  .max(12);
export const Question = z
  .object({
    question: z.string().min(1).max(2000),
    options: z.array(z.string().min(1).max(300)).max(6).optional(),
  })
  .strict();
export const FileChange = z
  .object({
    path: z.string().max(1024),
    before: z.string().max(32768),
    after: z.string().max(32768),
    baseHash: z.string().length(64),
    workspaceRevision: z.number().int().nonnegative().optional(),
    targetHash: z.string().length(64),
    outcome: z.enum([
      "proposed",
      "applying",
      "applied",
      "conflict",
      "unknown",
      "not_applied",
    ]),
  })
  .strict();
/** 验收修订只保存有界业务说明；来源由Runtime决定，调用者不能自报人工验收。 */
export const AcceptanceConditions = z
  .array(
    z
      .object({
        id: z.string().uuid(),
        text: z.string().trim().min(1).max(500),
      })
      .strict(),
  )
  .max(12)
  .refine((v) => new Set(v.map((c) => c.id)).size === v.length);
export const AcceptanceData = z
  .object({
    revision: z.number().int().nonnegative(),
    revisions: z
      .array(
        z
          .object({
            revision: z.number().int().nonnegative(),
            at: z.number(),
            source: z.enum(["agent", "user"]),
            conditions: AcceptanceConditions,
          })
          .strict(),
      )
      .min(1)
      .max(24),
    links: z
      .array(
        z
          .object({
            conditionId: z.string().uuid(),
            conditionRevision: z.number().int().nonnegative(),
            itemId: z.string().uuid(),
            source: z.enum(["agent", "user"]),
            explanation: z.string().trim().min(1).max(500),
            at: z.number(),
          })
          .strict(),
      )
      .max(48),
  })
  .strict();
export const AcceptanceEdit = z
  .object({
    sessionId: z.string().uuid(),
    runId: z.string().uuid(),
    expectedRevision: z.number().int().nonnegative(),
    conditions: AcceptanceConditions.optional(),
    link: z
      .object({
        conditionId: z.string().uuid(),
        itemId: z.string().uuid(),
        explanation: z.string().trim().min(1).max(500),
      })
      .strict()
      .optional(),
  })
  .strict();
export const TimelineItem = z.discriminatedUnion("type", [
  z
    .object({
      ...base,
      type: z.literal("middleware"),
      data: z
        .object({
          pluginId: z.string().max(100),
          pluginName: z.string().max(80),
          stage: z.enum([
            "run.before",
            "model.before",
            "model.after",
            "tool.before",
            "tool.after",
            "run.after",
          ]),
          outcome: z.enum(["modified", "denied", "failed", "disabled"]),
          changedFields: z.array(z.string().max(80)).max(12),
          inputDigest: z.string().length(64),
          outputDigest: z.string().length(64).optional(),
          code: z.string().max(100).optional(),
        })
        .strict(),
    })
    .strict(),
  z
    .object({ ...base, type: z.literal("acceptance"), data: AcceptanceData })
    .strict(),
  z
    .object({
      ...base,
      type: z.literal("approval_review"),
      data: z
        .object({
          tool: z.string().max(100),
          digest: z.string().length(64),
          decision: z.enum(["reviewing", "allow", "manual"]),
          reason: z.string().max(500),
          inputTokens: z.number().optional(),
          outputTokens: z.number().optional(),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      ...base,
      type: z.literal("model"),
      data: z
        .object({
          model: z.string().max(100),
          strategyId: z.string().max(80).optional(),
          strategyDigest: z
            .string()
            .regex(/^[a-f0-9]{64}$/)
            .optional(),
          attempt: z.number().int(),
          childId: z.string().uuid().optional(),
          parentItemId: z.string().uuid().optional(),
          input: z.number().optional(),
          output: z.number().optional(),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      ...base,
      type: z.literal("message"),
      data: z.object({ text: z.string().max(65536) }).strict(),
    })
    .strict(),
  z
    .object({
      ...base,
      type: z.literal("plan"),
      data: z
        .object({
          revisions: z
            .array(z.object({ at: z.number(), steps: PlanSteps }).strict())
            .max(12),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      ...base,
      type: z.literal("tool"),
      data: z
        .object({
          callId: z.string().max(256),
          name: z.string().max(100),
          kind: z.enum([
            "directory",
            "read",
            "command",
            "verification",
            "control",
          ]),
          arguments: z.string().max(200000),
          result: z.string().max(262144),
          executionId: z.string().optional(),
          output: z.string().max(32776).optional(),
          exitCode: z.number().nullable().optional(),
          executionStatus: z.string().max(30).optional(),
          truncated: z.boolean().optional(),
          requestedAt: z.number().optional(),
          startedAt: z.number().optional(),
          endedAt: z.number().optional(),
          approvalStartedAt: z.number().optional(),
          approvalEndedAt: z.number().optional(),
          authorization: z
            .enum(["workspace", "full", "review", "user", "denied"])
            .optional(),
          environment: z.enum(["workspace", "host"]).optional(),
          cwd: z.string().max(4096).optional(),
          workspaceRevision: z.number().int().nonnegative().optional(),
          versionUnconfirmed: z.boolean().optional(),
          signal: z.string().nullable().optional(),
          failureStage: z
            .enum(["validation", "approval", "execution"])
            .optional(),
          errorCode: z.string().max(100).optional(),
        })
        .strict(),
    })
    .strict(),
  z
    .object({ ...base, type: z.literal("file_change"), data: FileChange })
    .strict(),
  z
    .object({
      ...base,
      type: z.literal("interaction"),
      data: z
        .object({
          interactionId: z.string().uuid(),
          kind: z.enum(["approval", "input"]),
          toolItemId: z.string().uuid(),
          question: z.string().max(9000),
          options: z.array(z.string().max(300)).max(6).optional(),
          answer: z.string().max(4000).optional(),
          decision: z.enum(["allowed", "denied", "expired"]).optional(),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      ...base,
      type: z.literal("error"),
      data: z
        .object({ code: z.string().max(100), message: z.string().max(1000) })
        .strict(),
    })
    .strict(),
  z
    .object({
      ...base,
      type: z.literal("summary"),
      data: z
        .object({
          files: z.array(z.string().max(1024)).max(12),
          commands: z.number().int(),
          verificationPassed: z.number().int(),
          verificationFailed: z.number().int(),
          verificationUnknown: z.number().int(),
          result: z.string().max(1000),
          workspaceRevision: z.number().int().nonnegative().optional(),
          versionUnconfirmed: z.boolean().optional(),
        })
        .strict(),
    })
    .strict(),
  // 仅协议预留；未接入MCP服务前Runtime不产生该类节点。
  z
    .object({
      ...base,
      type: z.literal("mcp"),
      data: z
        .object({
          server: z.string().max(100),
          tool: z.string().max(100),
          result: z.string().max(32768),
        })
        .strict(),
    })
    .strict(),
]);
export const Timeline = z.array(TimelineItem).max(128);
export type TimelineItem = z.infer<typeof TimelineItem>;
