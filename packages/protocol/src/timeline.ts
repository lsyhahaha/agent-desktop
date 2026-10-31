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
export const TimelineItem = z.discriminatedUnion("type", [
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
          attempt: z.number().int(),
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
