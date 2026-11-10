import { app } from "electron";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync } from "node:fs";
import { copyFile, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { promisify } from "node:util";
import { z } from "zod";
import { BUILD_ID, RUNTIME_DIGEST, type SessionSnapshot } from "@protocol";
import { Settings } from "./settings";
import { RuntimeHost } from "./runtime";

const execute = promisify(execFile);
// macOS safeStorage 与正式桌面应用使用同一应用身份；否则已保存凭据无法解密。
app.setName("agent-desktop");
const Task = z.object({
  schemaVersion: z.literal(1),
  benchmark: z.literal("swe-bench-verified"),
  taskId: z.string().regex(/^[A-Za-z0-9_.-]+__[A-Za-z0-9_.-]+-\d+$/),
  repository: z.string().regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/),
  baseCommit: z.string().regex(/^[0-9a-f]{40}$/),
  datasetRevision: z.string().min(7).max(128).refine((value) => !value.startsWith("REPLACE_"), "必须固定真实数据集 revision"),
  prompt: z.string().trim().min(1).max(16000).refine((value) => !value.startsWith("REPLACE_"), "必须使用固定数据集的原始 problem statement"),
}).strict();

function argument(name: string) {
  return process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3);
}
const terminal = (snapshot: SessionSnapshot) =>
  ["completed", "failed", "cancelled", "interrupted"].includes(snapshot.chat.state);
const BENCHMARK_SCAFFOLD_VERSION = "swebench-v1";
const benchmarkPrompt = (problem: string) =>
  `你正在执行可自动判分的软件修复任务。请在当前仓库中定位并修复下面的问题；必须实际修改源码并运行与改动直接相关的验证。你最多只有12次工具调用：优先使用精确查询，最迟应在第8次工具调用前开始编辑，保留后续调用验证。不要只给建议，不要改写任务描述，不要访问网络、隐藏测试、gold patch 或工作区外文件。最终简要说明修改和已运行验证。\n\n${problem}`;

/** 导出已跟踪与新增普通文件；未跟踪文件不能被 `git diff HEAD` 静默遗漏。 */
async function collectPatch(workspace: string, baseHead: string) {
  let patch = (await execute("/usr/bin/git", ["diff", "--binary", baseHead, "--", "."], {
    cwd: workspace, timeout: 30000, maxBuffer: 16 * 1024 * 1024,
  })).stdout;
  const untracked = (await execute("/usr/bin/git", ["ls-files", "--others", "--exclude-standard"], {
    cwd: workspace, timeout: 10000, maxBuffer: 1024 * 1024,
  })).stdout.split("\n").filter((path) => path && path !== ".agent-desktop-benchmark-workspace");
  if (untracked.length > 200) throw new Error("新增文件超过评测导出上限");
  for (const path of untracked) {
    if ((await stat(join(workspace, path))).size === 0)
      throw new Error(`新增空文件无法由 patch 表示：${path}`);
    try {
      await execute("/usr/bin/git", ["diff", "--no-index", "--binary", "--", "/dev/null", path], {
        cwd: workspace, timeout: 10000, maxBuffer: 4 * 1024 * 1024,
      });
    } catch (error) {
      const result = error as Error & { code?: number; stdout?: string };
      if (result.code !== 1 || typeof result.stdout !== "string") throw error;
      patch += result.stdout;
    }
    if (Buffer.byteLength(patch) > 16 * 1024 * 1024) throw new Error("评测 patch 超过 16MiB 上限");
  }
  return patch;
}

/**
 * 评测入口只编排既有 Runtime，不拥有 Agent Loop。工作区必须由外部 harness 创建并固定，
 * 输出目录不得位于工作区内，避免模型读取轨迹、报告或后续 grader 信息。
 */
async function main() {
  if (process.argv.includes("--help")) {
    console.log("npm run benchmark:task -- --manifest=/abs/task.json --workspace=/abs/repo --output=/abs/results [--live]");
    return;
  }
  const manifestPath = argument("manifest");
  const workspaceArgument = argument("workspace");
  const outputArgument = argument("output");
  if (!manifestPath || !workspaceArgument || !outputArgument)
    throw new Error("manifest、workspace 与 output 均为必填绝对路径");
  if (![manifestPath, workspaceArgument, outputArgument].every(isAbsolute))
    throw new Error("评测路径必须为绝对路径");

  const manifest = Task.parse(JSON.parse(await readFile(manifestPath, "utf8")));
  const workspace = await realpath(workspaceArgument);
  // 输出目录必须预先存在并 canonicalize；不能让符号链接把报告写回 Agent 可见工作区。
  const output = await realpath(outputArgument);
  if (output === workspace || output.startsWith(`${workspace}/`))
    throw new Error("输出目录不得位于任务工作区内");
  const repositoryRoot = await realpath((await execute("/usr/bin/git", ["rev-parse", "--show-toplevel"], { cwd: workspace, timeout: 10000 })).stdout.trim());
  if (repositoryRoot !== workspace) throw new Error("workspace 必须是任务 Git 仓库根目录");
  const baseHead = (await execute("/usr/bin/git", ["rev-parse", "HEAD"], { cwd: workspace, timeout: 10000 })).stdout.trim();
  if (baseHead !== manifest.baseCommit) throw new Error("任务工作区 HEAD 与 manifest baseCommit 不一致");
  const initialStatus = (await execute("/usr/bin/git", ["status", "--porcelain=v1", "--untracked-files=all"], { cwd: workspace, timeout: 10000 })).stdout;
  if (initialStatus) throw new Error("任务工作区必须从干净基线开始");
  const plan = {
    schemaVersion: 1,
    mode: process.argv.includes("--live") ? "live" : "preflight",
    task: manifest,
    workspace,
    baseHead,
    buildId: BUILD_ID,
    runtimeDigest: RUNTIME_DIGEST,
    repositoryIdentity: "manifest_only_until_harness_adapter",
    scaffoldVersion: BENCHMARK_SCAFFOLD_VERSION,
    approvalPolicy: "evaluation_only_workspace_auto",
    createdAt: Date.now(),
  };
  await writeFile(join(output, "plan.json"), JSON.stringify(plan, null, 2), { mode: 0o600 });
  if (!process.argv.includes("--live")) {
    console.log(JSON.stringify({ status: "prepared", taskId: manifest.taskId, plan: join(output, "plan.json") }));
    return;
  }

  // live 模式显式读取桌面应用设置；密钥不进入报告、环境变量或子进程参数。
  const profile = realpathSync(mkdtempSync(join(tmpdir(), "agent-benchmark-")));
  let latest: SessionSnapshot | undefined;
  let runtime: RuntimeHost | undefined;
  let config: { model: string; apiKey: string } | undefined;
  const startedAt = Date.now();
  try {
    const settings = new Settings(join(app.getPath("appData"), "agent-desktop"));
    await settings.load();
    config = await settings.credentials();
    mkdirSync(join(profile, "data", "storage"), { recursive: true, mode: 0o700 });
    runtime = new RuntimeHost(join(import.meta.dirname, "runtime.js"), (snapshot) => { latest = snapshot; });
    runtime.start(join(profile, "data", "storage", "sessions.sqlite"));
    await runtime.status();
    let state = await runtime.chat({ type: "new" }, undefined, { name: manifest.taskId, path: workspace });
    state = await runtime.chat(
      { type: "send", sessionId: state.sessionId, text: benchmarkPrompt(manifest.prompt) },
      { config, root: workspace, readingStrategyId: "baseline-v1", evaluationOnly: true },
    );
    latest = state;
    const seen = new Set<string>();
    while (latest && !terminal(latest)) {
      if (Date.now() - startedAt > 10 * 60_000) throw new Error("评测墙钟时间超过十分钟");
      const interaction = latest.chat.interaction;
      if (interaction && !seen.has(interaction.id)) {
        seen.add(interaction.id);
        if (interaction.kind === "input") throw new Error("固定评测任务不允许澄清输入");
        // evaluationOnly 会在创建交互前硬拒绝工作区外访问与提权；这里仅替代
        // 临时任务副本内复合命令/删除等原本需要人工点击的确认，不改变执行沙箱。
        latest = await runtime.chat({ type: "approve", sessionId: latest.sessionId, runId: latest.chat.runId!, interactionId: interaction.id, allow: true });
      }
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
    }
    const final = await runtime.chat({ type: "snapshot" });
    const patch = await collectPatch(workspace, baseHead);
    await writeFile(join(output, "patch.diff"), patch, { mode: 0o600 });
    await writeFile(join(output, "result.json"), JSON.stringify({
      schemaVersion: 1,
      taskId: manifest.taskId,
      benchmark: manifest.benchmark,
      datasetRevision: manifest.datasetRevision,
      state: final.chat.state,
      error: final.chat.error,
      usage: final.chat.usage,
      model: config.model,
      modelRequests: final.chat.items.filter((item) => item.type === "model").length,
      toolCalls: final.chat.tools.length,
      patchSha256: createHash("sha256").update(patch).digest("hex"),
      patchBytes: Buffer.byteLength(patch),
      startedAt,
      finishedAt: Date.now(),
      runId: final.chat.runId,
      grader: { status: "not_run", resolved: null },
      repositoryIdentity: "manifest_only_until_harness_adapter",
      scaffoldVersion: BENCHMARK_SCAFFOLD_VERSION,
      approvalPolicy: "evaluation_only_workspace_auto",
      outcome: patch.length ? "patch_generated" : "no_patch",
    }, null, 2), { mode: 0o600 });
    console.log(JSON.stringify({ status: final.chat.state, taskId: manifest.taskId, output }));
    if (final.chat.state !== "completed" || !patch.length) process.exitCode = 1;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Benchmark task failed";
    await writeFile(join(output, "result.json"), JSON.stringify({
      schemaVersion: 1,
      taskId: manifest.taskId,
      benchmark: manifest.benchmark,
      datasetRevision: manifest.datasetRevision,
      state: "failed",
      failureCategory: message.includes("墙钟") ? "timeout" : latest ? "agent_error" : "infrastructure_error",
      error: { code: "benchmark_failed", message: message.slice(0, 1000) },
      usage: latest?.chat.usage ?? { input: 0, output: 0, complete: false },
      runId: latest?.chat.runId ?? null,
      startedAt,
      finishedAt: Date.now(),
      grader: { status: "not_run", resolved: null },
      scaffoldVersion: BENCHMARK_SCAFFOLD_VERSION,
      approvalPolicy: "evaluation_only_workspace_auto",
    }, null, 2), { mode: 0o600 }).catch(() => {});
    throw error;
  } finally {
    try {
      await runtime?.stop();
    } finally {
      await copyFile(join(profile, "data", "logs", "agent-runtime", "runtime.jsonl"), join(output, "runtime.jsonl")).catch(() => {});
      await rm(profile, { recursive: true, force: true });
    }
  }
}

void app.whenReady().then(main).then(() => app.exit(typeof process.exitCode === "number" ? process.exitCode : 0)).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Benchmark task failed");
  app.exit(1);
});
