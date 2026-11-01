import { createHash } from "node:crypto";
import { z } from "zod";
import { BUILD_ID, ReadingStrategyId, type SessionSnapshot } from "@protocol";

/** 固定合成项目：任务输入与必需证据由评估器拥有，候选只看到项目和任务，不获得答案标签。 */
export const overviewCases = [
  {
    id: "new-and-modified",
    split: "dev",
    initial: { "src/main.ts": "export const timeout = 10;\n" },
    changes: {
      "src/main.ts": "export const timeout = 20;\n",
      "src/cache.ts": "export const cacheEnabled = true;\n",
    },
    staged: [],
    needles: ["timeout = 20", "cacheEnabled = true"],
  },
  {
    id: "staged-only",
    split: "dev",
    initial: { "src/router.ts": "export const route = '/old';\n" },
    changes: { "src/router.ts": "export const route = '/new';\n" },
    staged: ["src/router.ts"],
    needles: ["route = '/new'"],
  },
  {
    id: "mixed-index",
    split: "dev",
    initial: {
      "src/a.ts": "export const retries = 1;\n",
      "src/b.ts": "export const format = 'text';\n",
    },
    changes: {
      "src/a.ts": "export const retries = 2;\n",
      "src/b.ts": "export const format = 'json';\n",
    },
    staged: ["src/a.ts"],
    needles: ["retries = 2", "format = 'json'"],
  },
  {
    id: "nested-new",
    split: "holdout",
    initial: { "README.md": "Sample project\n" },
    changes: { "lib/parser/token.ts": "export const tokenLimit = 256;\n" },
    staged: [],
    needles: ["tokenLimit = 256"],
  },
  {
    id: "deletion",
    split: "holdout",
    initial: { "src/legacy.ts": "export const legacyMode = true;\n" },
    changes: { "src/legacy.ts": null },
    staged: [],
    needles: ["legacyMode = true"],
  },
  {
    id: "clean",
    split: "holdout",
    initial: { "src/main.ts": "export const stable = true;\n" },
    changes: {},
    staged: [],
    needles: [],
  },
] as const;
export const suiteId = "change-overview-v1";
export const suiteDigest = createHash("sha256")
  .update(JSON.stringify(overviewCases))
  .digest("hex");
export const taskPrompt =
  "看看当前代码改了哪些什么？请区分暂存、未暂存与新增文件；根据实际证据概述变化，并说明尚未检查或验证的范围。";
const count = z.number().int().nonnegative();
export const CaseResult = z
  .object({
    strategyId: ReadingStrategyId,
    strategyDigest: z.string().regex(/^[a-f0-9]{64}$/),
    traceDigest: z.string().regex(/^[a-f0-9]{64}$/),
    taskId: z.string().max(80),
    split: z.enum(["dev", "holdout"]),
    runId: z.string().uuid(),
    snapshotDigest: z.string().regex(/^[a-f0-9]{64}$/),
    state: z.string().max(40),
    modelRequests: count.max(10),
    toolCalls: count.max(12),
    inputTokens: count,
    outputTokens: count,
    usageComplete: z.boolean(),
    workspaceUnchanged: z.boolean(),
    evidenceVisible: z.boolean(),
    answer: z.string().max(16384),
    answerTruncated: z.boolean(),
    model: z.string().max(100),
    buildId: z.string().max(100),
  })
  .strict();
export const StrategyEvaluation = z
  .object({
    id: z.string().uuid(),
    projectPath: z.string().min(1).max(4096),
    suiteId: z.literal(suiteId),
    suiteDigest: z.literal(suiteDigest),
    candidateId: ReadingStrategyId,
    candidateDigest: z.string().regex(/^[a-f0-9]{64}$/),
    runtimeDigest: z.string().regex(/^[a-f0-9]{64}$/),
    baselineDigest: z.string().regex(/^[a-f0-9]{64}$/),
    buildId: z.string().max(100),
    model: z.string().max(100),
    mode: z.enum(["live", "controlled"]),
    termination: z.enum(["completed", "failed", "cancelled"]),
    createdAt: count,
    baseline: z.array(CaseResult).max(6),
    candidate: z.array(CaseResult).max(6),
  })
  .strict();
export type StrategyEvaluation = z.infer<typeof StrategyEvaluation>;
/** 自动检查只证明所需片段在成功工具输出中可见，不替代人工判断答案正确与覆盖充分。 */
export function evaluateCase(
  snapshot: SessionSnapshot,
  needles: readonly string[],
  workspaceUnchanged: boolean,
  snapshotDigest: string,
  taskId: string,
  split: "dev" | "holdout",
) {
  const tools = snapshot.chat.tools;
  const answer = snapshot.chat.messages.at(-1)?.text ?? "";
  const visible = snapshot.chat.items
    .filter((i) => i.type === "tool" && i.status === "completed")
    .map((i) => {
      if (i.type !== "tool") return "";
      try {
        const result = JSON.parse(i.data.result);
        return [result.content, i.data.output ?? result.output]
          .filter((v) => typeof v === "string")
          .join("\n");
      } catch {
        return "";
      }
    })
    .join("\n");
  return CaseResult.parse({
    strategyId: snapshot.chat.items.find((i) => i.type === "model")?.data
      .strategyId,
    strategyDigest: snapshot.chat.items.find((i) => i.type === "model")?.data
      .strategyDigest,
    traceDigest: createHash("sha256")
      .update(JSON.stringify(snapshot.chat.items))
      .digest("hex"),
    taskId,
    split,
    runId: snapshot.chat.runId,
    snapshotDigest,
    state: snapshot.chat.state,
    modelRequests: snapshot.chat.items.filter((i) => i.type === "model").length,
    toolCalls: tools.length,
    inputTokens: snapshot.chat.usage.input,
    outputTokens: snapshot.chat.usage.output,
    usageComplete: snapshot.chat.usage.complete,
    workspaceUnchanged,
    evidenceVisible: needles.every((n) => visible.includes(n)),
    answer: answer.slice(0, 16384),
    answerTruncated: answer.length > 16384,
    model:
      snapshot.chat.items.find((i) => i.type === "model")?.data.model ??
      "unknown",
    buildId: BUILD_ID,
  });
}
/** 只有同一套完整输入、同构建/模型的基线与候选可比较；成本是质量约束之后的观察值。 */
export function checkEvaluation(report: StrategyEvaluation) {
  if (report.termination !== "completed")
    throw new Error("Evaluation did not finish");
  const expected = overviewCases
    .map((c) => c.id)
    .sort()
    .join("|");
  for (const results of [report.baseline, report.candidate]) {
    if (
      results
        .map((c) => c.taskId)
        .sort()
        .join("|") !== expected
    )
      throw new Error("Evaluation case coverage incomplete");
    for (const c of results) {
      if (
        c.split !== overviewCases.find((t) => t.id === c.taskId)!.split ||
        c.state !== "completed" ||
        !c.workspaceUnchanged ||
        !c.evidenceVisible ||
        !c.usageComplete ||
        c.answerTruncated ||
        c.modelRequests < 1 ||
        c.model !== report.model ||
        c.buildId !== report.buildId
      )
        throw new Error("Evaluation quality checks failed");
    }
  }
  for (const c of report.baseline)
    if (
      c.strategyId !== "baseline-v1" ||
      c.strategyDigest !== report.baselineDigest
    )
      throw new Error("Baseline strategy mismatch");
  for (const c of report.candidate)
    if (
      c.strategyId !== report.candidateId ||
      c.strategyDigest !== report.candidateDigest
    )
      throw new Error("Candidate strategy mismatch");
  for (const c of report.candidate)
    if (
      c.snapshotDigest !==
      report.baseline.find((b) => b.taskId === c.taskId)!.snapshotDigest
    )
      throw new Error("Snapshot mismatch");
  return {
    inputTokensBefore: report.baseline.reduce((n, c) => n + c.inputTokens, 0),
    inputTokensAfter: report.candidate.reduce((n, c) => n + c.inputTokens, 0),
  };
}
