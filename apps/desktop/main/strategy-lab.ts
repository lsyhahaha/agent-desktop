import { app } from "electron";
import { readBounded } from "./maintenance-files";
import { mkdtempSync, mkdirSync, realpathSync } from "node:fs";
import {
  writeFile,
  readFile,
  readdir,
  lstat,
  mkdir,
  unlink,
  realpath,
} from "node:fs/promises";
import { join, dirname, resolve } from "node:path";
import { tmpdir } from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash, randomUUID } from "node:crypto";
import { createInterface } from "node:readline/promises";
import {
  RUNTIME_DIGEST,
  BUILD_ID,
  ReadingStrategyId,
  type SessionSnapshot,
} from "@protocol";
import { Settings } from "./settings";
import { SessionStore } from "../../runtime/src/storage";
import { RuntimeHost } from "./runtime";
import { readingStrategy } from "../../runtime/src/reading-strategy";
import {
  overviewCases,
  suiteId,
  suiteDigest,
  taskPrompt,
  evaluateCase,
  StrategyEvaluation,
  checkEvaluation,
} from "../../runtime/src/strategy-evaluation";

const argument = (key: string) =>
  process.argv.find((a) => a.startsWith(`--${key}=`))?.slice(key.length + 3);
// 每次评估有独立项目/业务库/日志；不连接正式会话库，也不把真实项目当作可写评估副本。
app.setName("agent-desktop");
const settingsDirectory = join(app.getPath("appData"), "agent-desktop");
const directory = realpathSync(
  mkdtempSync(join(tmpdir(), "agent-strategy-lab-")),
);
mkdirSync(join(directory, "profile"), { mode: 0o700 });
app.setPath("userData", join(directory, "profile"));
const execute = promisify(execFile);
const cancellation = new AbortController();
const gitConfigurations = new Map<string, string>();
const gitEnv = {
  PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_TERMINAL_PROMPT: "0",
};
async function git(root: string, args: string[]) {
  if (gitConfigurations.has(root)) {
    const config = await readBounded(join(root, ".git/config"), 8192);
    if (
      createHash("sha256").update(config).digest("hex") !==
      gitConfigurations.get(root)
    )
      throw new Error("Fixture git config modified");
    let metadataEntries = 0;
    const metadataDeadline = Date.now() + 5000;
    async function verify(path: string, depth = 0) {
      cancellation.signal.throwIfAborted();
      if (depth > 12 || Date.now() > metadataDeadline)
        throw new Error("Git metadata traversal limit");
      for (const name of await readdir(path)) {
        if (++metadataEntries > 2000)
          throw new Error("Git metadata entry limit");
        const full = join(path, name),
          info = await lstat(full);
        if (
          info.isSymbolicLink() ||
          (!info.isDirectory() && (!info.isFile() || info.nlink !== 1))
        )
          throw new Error("Unsafe Git metadata");
        if (info.isDirectory()) await verify(full, depth + 1);
      }
    }
    const metadata = await lstat(join(root, ".git"));
    if (!metadata.isDirectory() || metadata.isSymbolicLink())
      throw new Error("Unsafe Git root");
    await verify(join(root, ".git"));
    for (const name of ["commondir", "gitdir", "objects/info/alternates"]) {
      try {
        await lstat(join(root, ".git", name));
        throw new Error("External Git metadata forbidden");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
  }
  return (
    await execute(
      "/usr/bin/git",
      [
        "-c",
        "core.hooksPath=/dev/null",
        "-c",
        "core.fsmonitor=false",
        "-c",
        "commit.gpgsign=false",
        ...args,
      ],
      {
        cwd: root,
        env: gitEnv,
        timeout: 10000,
        maxBuffer: 65536,
        signal: cancellation.signal,
      },
    )
  ).stdout;
}
/** 快照包含实际普通文件内容与Git状态，不使用修改时间或临时绝对路径充当版本。 */
async function snapshot(root: string) {
  const files: Record<string, string> = {};
  let examined = 0,
    bytes = 0;
  const deadline = Date.now() + 5000;
  async function walk(path: string) {
    cancellation.signal.throwIfAborted();
    if (path.split("/").length > 12 || Date.now() > deadline)
      throw new Error("Snapshot traversal limit");
    for (const name of (await readdir(join(root, path))).sort()) {
      if (name === ".git") continue;
      if (++examined > 1000) throw new Error("Snapshot entry limit");
      const relative = path ? `${path}/${name}` : name,
        full = join(root, relative),
        info = await lstat(full);
      if (info.isSymbolicLink() || (!info.isDirectory() && !info.isFile()))
        throw new Error("Unexpected fixture file");
      if (info.isDirectory()) await walk(relative);
      else {
        bytes += info.size;
        if (info.size > 65536 || bytes > 4 * 1024 * 1024)
          throw new Error("Fixture output too large");
        files[relative] = (await readBounded(full, 65536)).toString("base64");
      }
    }
  }
  await walk("");
  return createHash("sha256")
    .update(
      JSON.stringify({
        files,
        status: await git(root, [
          "status",
          "--porcelain=v1",
          "--untracked-files=all",
        ]),
      }),
    )
    .digest("hex");
}
async function prepare(id: string, copy: string) {
  const task = overviewCases.find((c) => c.id === id)!;
  const root = join(directory, copy, id);
  await mkdir(root, { recursive: true, mode: 0o700 });
  async function put(path: string, text: string) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), text, { mode: 0o600 });
  }
  for (const [path, content] of Object.entries(task.initial))
    await put(path, content!);
  await git(root, ["init", "-q"]);
  await git(root, ["add", "--", "."]);
  await git(root, [
    "-c",
    "user.name=Strategy Lab",
    "-c",
    "user.email=lab@example.invalid",
    "commit",
    "-qm",
    "fixed initial snapshot",
  ]);
  for (const [path, content] of Object.entries(task.changes)) {
    if (content === null) await unlink(join(root, path));
    else await put(path, content!);
  }
  if (task.staged.length) await git(root, ["add", "--", ...task.staged]);
  gitConfigurations.set(
    root,
    createHash("sha256")
      .update(await readFile(join(root, ".git/config")))
      .digest("hex"),
  );
  return { root, digest: await snapshot(root) };
}
let runtime: RuntimeHost | undefined,
  latest: SessionSnapshot | undefined,
  cancelled = false;
const receive = (s: SessionSnapshot) => {
  if (!latest || s.revision > latest.revision) latest = s;
};
const terminal = (s: SessionSnapshot) =>
  ["completed", "failed", "cancelled", "interrupted"].includes(s.chat.state);
process.on("SIGINT", () => {
  cancelled = true;
  cancellation.abort();
  if (latest?.chat.runId)
    void runtime
      ?.chat({
        type: "cancel",
        sessionId: latest.sessionId,
        runId: latest.chat.runId,
      })
      .catch(() => {});
});
async function main() {
  if (process.argv.includes("--help")) {
    console.log(
      "Prepare only: npm run strategy:lab -- --project=/absolute/project; live evaluation (requires explicit API authorization): --evaluate=evidence-first-v1|module-batch-v1 --live --max-requests=10..120 --project=/absolute/project",
    );
    return;
  }
  const raw = argument("evaluate"),
    candidate = ReadingStrategyId.parse(raw ?? "evidence-first-v1");
  if (candidate === "baseline-v1")
    throw new Error("Choose one of the two candidate strategies");
  const projectPath = await realpath(
    resolve(argument("project") ?? process.cwd()),
  );
  await app.whenReady();
  const plans = [];
  for (const task of overviewCases) {
    const fixture = await prepare(task.id, "plan");
    plans.push({
      taskId: task.id,
      split: task.split,
      root: fixture.root,
      snapshotDigest: fixture.digest,
    });
  }
  const plan = {
    suiteId,
    suiteDigest,
    projectPath,
    buildId: BUILD_ID,
    strategies: [
      readingStrategy("baseline-v1"),
      readingStrategy("evidence-first-v1"),
      readingStrategy("module-batch-v1"),
    ],
    tasks: plans,
    maxMainRequests: 120,
  };
  await writeFile(join(directory, "plan.json"), JSON.stringify(plan, null, 2), {
    mode: 0o600,
  });
  console.log(
    JSON.stringify({
      directory,
      plan: join(directory, "plan.json"),
      mode: raw ? "evaluation_requested" : "prepare_only",
      candidate,
    }),
  );
  if (!raw) return;
  // 显式本机操作开关及整批预算；准备动作从不读取凭据或调用Provider。
  const maxRequests = Number(argument("max-requests"));
  if (
    !process.argv.includes("--live") ||
    !Number.isInteger(maxRequests) ||
    maxRequests < 10 ||
    maxRequests > 120
  )
    throw new Error(
      "Live evaluation requires --live and --max-requests=10..120",
    );
  const settings = new Settings(settingsDirectory);
  await settings.load();
  const config = await settings.credentials();
  let used = 0;
  runtime = new RuntimeHost(join(import.meta.dirname, "runtime.js"), receive);
  runtime.start(join(directory, "data", "storage", "sessions.sqlite"));
  await runtime.status();
  const report: StrategyEvaluation = {
    runtimeDigest: RUNTIME_DIGEST,
    id: randomUUID(),
    projectPath,
    suiteId,
    suiteDigest,
    candidateId: candidate,
    candidateDigest: readingStrategy(candidate).digest,
    baselineDigest: readingStrategy("baseline-v1").digest,
    buildId: BUILD_ID,
    model: config.model,
    // 测试环境只会降级证据来源，不能改变权限、绕过授权或据此启用策略。
    mode: process.env.NODE_ENV === "test" ? "controlled" : "live",
    termination: "failed",
    createdAt: Date.now(),
    baseline: [],
    candidate: [],
  };
  const input = createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  try {
    for (const task of overviewCases)
      for (const policy of ["baseline-v1", candidate] as const) {
        if (cancelled || used + 10 > maxRequests)
          throw new Error(
            "Batch request budget exhausted or cancelled; no next run started",
          );
        const fixture = await prepare(task.id, policy);
        let state = await runtime.chat({ type: "new" }, undefined, {
          name: task.id,
          path: fixture.root,
        });
        state = await runtime.chat(
          { type: "send", sessionId: state.sessionId, text: taskPrompt },
          {
            config,
            root: fixture.root,
            readingStrategyId: policy,
            evaluationOnly: true,
          },
        );
        receive(state);
        const started = Date.now(),
          seen = new Set<string>();
        while (latest && !terminal(latest)) {
          if (cancelled || Date.now() - started > 180000) {
            await runtime.chat({
              type: "cancel",
              sessionId: latest.sessionId,
              runId: latest.chat.runId,
            });
            throw new Error("Case cancelled or exceeded wall-clock limit");
          }
          const interaction = latest.chat.interaction;
          if (interaction && !seen.has(interaction.id)) {
            seen.add(interaction.id);
            if (interaction.kind === "input") {
              await runtime.chat({
                type: "cancel",
                sessionId: latest.sessionId,
                runId: latest.chat.runId,
              });
              throw new Error(
                "Evaluation requires fixed task; unexpected clarification",
              );
            }
            // 审批保持人工逐次确认；评估器不通过Shell正则猜测命令安全，也不扩大沙箱边界。
            const answer = await input.question(
              `\n[${task.id}/${policy}] ${interaction.path}\n允许本次操作？输入 allow，否则拒绝：`,
              {
                signal: AbortSignal.any([
                  cancellation.signal,
                  AbortSignal.timeout(60000),
                ]),
              },
            );
            await runtime.chat({
              type: "approve",
              sessionId: latest.sessionId,
              runId: latest.chat.runId,
              interactionId: interaction.id,
              allow: answer.trim() === "allow",
            });
          }
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
        state = await runtime.chat({ type: "snapshot" });
        const result = evaluateCase(
          state,
          task.needles,
          (await snapshot(fixture.root)) === fixture.digest,
          fixture.digest,
          task.id,
          task.split,
        );
        used += result.modelRequests;
        (policy === "baseline-v1" ? report.baseline : report.candidate).push(
          result,
        );
        await writeFile(
          join(directory, "evaluation.json"),
          JSON.stringify(StrategyEvaluation.parse(report), null, 2),
          { mode: 0o600 },
        );
        console.log(
          JSON.stringify({
            task: task.id,
            policy,
            state: result.state,
            evidenceVisible: result.evidenceVisible,
            requests: result.modelRequests,
            used,
          }),
        );
        if (
          result.state !== "completed" ||
          !result.workspaceUnchanged ||
          !result.usageComplete
        )
          throw new Error(
            "Case execution failed; stop further paid evaluation",
          );
      }
    report.termination = "completed";
    console.log(
      `Completed. Review answers and evidence before selection: ${join(directory, "evaluation.json")}`,
    );
  } finally {
    input.close();
    await runtime.stop();
    runtime = undefined;
    if (cancelled) report.termination = "cancelled";
    await writeFile(
      join(directory, "evaluation.json"),
      JSON.stringify(StrategyEvaluation.parse(report), null, 2),
      { mode: 0o600 },
    );
    let qualityGatePassed = false;
    try {
      checkEvaluation(report);
      qualityGatePassed = true;
    } catch {
      /* 失败也保留报告，绝不宣布候选获胜。 */
    }
    const aggregate = (results: typeof report.baseline) => ({
      cases: results.length,
      modelRequests: results.reduce((n, c) => n + c.modelRequests, 0),
      toolCalls: results.reduce((n, c) => n + c.toolCalls, 0),
      inputTokens: results.reduce((n, c) => n + c.inputTokens, 0),
      outputTokens: results.reduce((n, c) => n + c.outputTokens, 0),
      evidenceVisibleCases: results.filter((c) => c.evidenceVisible).length,
    });
    await writeFile(
      join(directory, "summary.json"),
      JSON.stringify(
        {
          qualityGatePassed,
          manualReviewRequired: true,
          winner: null,
          baseline: aggregate(report.baseline),
          candidate: aggregate(report.candidate),
        },
        null,
        2,
      ),
      { mode: 0o600 },
    );
    // 评估Runtime完全释放连接后再以同一Worker实现追加报告，不并行另开写者。
    const store = new SessionStore(
      join(directory, "data", "storage", "sessions.sqlite"),
      () => {},
    );
    try {
      await store.appendStrategyEvaluation(report);
    } finally {
      await store.close();
    }
  }
}
void main()
  .then(() => app.exit(0))
  .catch(async () => {
    await runtime?.stop();
    console.error(
      `Strategy lab stopped without confirming a winner. Evidence directory: ${directory}`,
    );
    app.exit(1);
  });
