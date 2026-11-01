import { z } from "zod";
import { isAbsolute } from "node:path";

const text = (max: number) => z.string().trim().min(1).max(max);
const metrics = z
  .object({
    runId: z.string().uuid(),
    modelRequests: z.number().int().min(0).max(1000),
    toolCalls: z.number().int().min(0).max(10000),
    inputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
    usageComplete: z.boolean(),
  })
  .strict();
/** 进化记录是开发者提交的证据陈述，不是模型自证正确，也不授权部署或回滚代码。 */
export const EvolutionDraft = z
  .object({
    key: z.string().regex(/^[a-z0-9][a-z0-9-]{0,79}$/),
    projectPath: text(4096).refine(isAbsolute),
    title: text(200),
    occurredOn: z.iso.date(),
    trigger: text(2000),
    baselineCommit: z.string().regex(/^[a-f0-9]{7,40}$/),
    changes: z.array(text(1000)).min(1).max(20),
    validations: z
      .array(
        z
          .object({
            kind: z.enum(["build", "controlled", "real", "manual"]),
            result: text(2000),
          })
          .strict(),
      )
      .min(1)
      .max(32),
    comparison: z
      .object({ before: metrics, after: metrics })
      .strict()
      .nullable(),
    limitations: z.array(text(1000)).min(1).max(20),
    evidence: z
      .array(
        z
          .object({
            path: text(1024).refine(
              (p) =>
                !isAbsolute(p) &&
                !p.includes("\\") &&
                !p.includes("\0") &&
                p.split("/").every((s) => !!s && s !== "." && s !== ".."),
            ),
            sha256: z.string().regex(/^[a-f0-9]{64}$/),
          })
          .strict(),
      )
      .min(1)
      .max(20),
  })
  .strict()
  .refine((v) => Buffer.byteLength(JSON.stringify(v)) <= 131072);
export type EvolutionDraft = z.infer<typeof EvolutionDraft>;
export const EvolutionRecord = z
  .object({
    id: z.string().uuid(),
    seq: z.number().int().positive(),
    createdAt: z.number().nonnegative(),
    provenance: z.literal("developer_recorded"),
    digest: z.string().regex(/^[a-f0-9]{64}$/),
    data: EvolutionDraft,
  })
  .strict();
export type EvolutionRecord = z.infer<typeof EvolutionRecord>;
/** 游标分页只返回摘要，避免反复复制证据正文；记录不随聊天清空或删除而丢失。 */
export const EvolutionPage = z
  .object({
    records: z
      .array(
        EvolutionRecord.omit({ data: true })
          .extend({ key: text(80), title: text(200) })
          .strict(),
      )
      .max(20),
    nextCursor: z.number().int().positive().nullable(),
  })
  .strict();
