import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { StringDecoder } from "node:string_decoder";
import {
  SandboxManager,
  type SandboxRuntimeConfig,
} from "@anthropic-ai/sandbox-runtime";
import { z } from "zod";
import { workspacePath, protectedRuntimePaths } from "./workspace-path";

/** 默认使用沙箱内非登录 bash；仅 Runtime 对本次操作批准或完全访问模式可走宿主。 */
export const ExecInput = z
  .object({
    sandbox_permissions: z
      .enum(["workspace", "require_escalated"])
      .default("workspace"),
    purpose: z.enum(["command", "verification"]).default("command"),
    command: z
      .string()
      .min(1)
      .max(8000)
      .refine((v) => !v.includes("\0")),
    path: z.string().min(1).max(512).default("."),
    timeout_ms: z.number().int().min(100).max(60000).default(30000),
    yield_time_ms: z.number().int().min(0).max(1000).default(1000),
  })
  .strict();
export const PollInput = z
  .object({
    execution_id: z.string().uuid(),
    chars: z.string().max(4096).default(""),
    yield_time_ms: z.number().int().min(0).max(1000).default(1000),
  })
  .strict();
export const StopInput = z.object({ execution_id: z.string().uuid() }).strict();
export type Execution = {
  execution_id: string;
  status:
    | "running"
    | "exited"
    | "cancelled"
    | "timed_out"
    | "output_limit"
    | "spawn_failed";
  exit_code: number | null;
  signal: string | null;
  output: string;
  truncated: boolean;
};
type Job = {
  value: Execution;
  child: ChildProcess;
  done: Promise<void>;
  stop: (reason: Execution["status"]) => void;
  finished: boolean;
};
const live = new Set<Job>();
let initializing: Promise<void> | undefined;
let launching = false;
const literal = (path: string) => ({ path, literal: true as const });

/** SDK 是进程级单例；所有会话共用默认拒绝策略，每次包装只开放当前工作区读写。 */
function policy(root?: string): SandboxRuntimeConfig {
  return {
    network: {
      allowedDomains: [],
      deniedDomains: [],
      strictAllowlist: true,
      allowLocalBinding: false,
      allowAllUnixSockets: false,
    },
    filesystem: {
      denyRead: [
        literal("/"),
        ...protectedRuntimePaths().map(literal),
        ...(root
          ? [
              ".env",
              ".env.*",
              "**/.env",
              "**/.env.*",
              "**/*.pem",
              "**/*.key",
              "**/*.p12",
              "**/*.pfx",
              "**/credentials",
              "**/id_rsa",
              "**/id_ed25519",
            ].map((path) => `${root}/${path}`)
          : []),
      ],
      allowRead: [
        "/bin",
        "/sbin",
        "/usr",
        "/System",
        "/dev",
        "/Library/Developer",
        "/opt/homebrew",
        ...(root ? [literal(root)] : []),
      ],
      allowWrite: root ? [literal(root)] : [],
      // SDK 默认临时目录同样可写；凭据与应用数据目录显式拒绝。
      denyWrite: root
        ? [
            ...protectedRuntimePaths().map(literal),
            ...[
              ".env",
              ".env.*",
              "**/.env",
              "**/.env.*",
              "**/*.pem",
              "**/*.key",
              "**/credentials",
              "**/id_rsa",
              "**/id_ed25519",
            ].map((path) => `${root}/${path}`),
          ]
        : [literal("/")],
    },
    allowPty: false,
    allowAppleEvents: false,
    enableWeakerNestedSandbox: false,
  };
}
async function initialize(signal: AbortSignal) {
  // 平台验收前拒绝执行，不能误把 Node 子进程当沙箱或自动降级到宿主 shell。
  if (process.platform !== "darwin")
    throw new Error("命令沙箱当前仅支持已验收的 macOS");
  if (!initializing)
    initializing = SandboxManager.initialize(policy(), undefined, false).catch(
      (error) => {
        initializing = undefined;
        throw error;
      },
    );
  // 初始化同样受取消和5秒上限约束；SDK初始化承诺仍缓存，不能重复创建代理服务。
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let abort = () => {};
  try {
    await Promise.race([
      initializing,
      new Promise<never>((_, reject) => {
        abort = () => reject(new Error("沙箱初始化已取消"));
        signal.addEventListener("abort", abort, { once: true });
        timeout = setTimeout(() => reject(new Error("沙箱初始化超时")), 5000);
        if (signal.aborted) abort();
      }),
    ]);
  } finally {
    clearTimeout(timeout);
    signal.removeEventListener("abort", abort);
  }
}

/** 只操作我们创建的进程组；TERM 后升级 KILL。退出时也清理同组后代，避免后台命令遗留。 */
function killGroup(child: ChildProcess, signal: NodeJS.Signals) {
  if (!child.pid) return;
  try {
    process.kill(-child.pid, signal);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ESRCH")
      console.warn("[exec] process group signal failed", {
        code: (error as NodeJS.ErrnoException).code,
      });
  }
}
/** Main 正常退出和 Runtime 退出时同步停止已登记子进程；不等待模型下一步轮询。 */
export function stopAllCommands() {
  for (const job of live) job.stop("cancelled");
  for (const job of live) killGroup(job.child, "SIGKILL");
}
process.once("exit", stopAllCommands);

/** 每轮独立持有执行句柄，UUID 不能跨会话使用；最多一条活跃命令、12个有界结果。 */
export class CommandRunner {
  private jobs = new Map<string, Job>();
  private disposed = false;
  constructor(
    private signal: AbortSignal,
    private observe: (event: {
      phase: "started" | "completed";
      executionId: string;
      state: Execution["status"];
      exitCode: number | null;
      signal: string | null;
      bytes: number;
      truncated: boolean;
    }) => void = () => {},
    private fullAccess = false,
  ) {}
  /** 诊断观察者不得抛回进程控制链路，不传递stdout/stderr正文。 */
  private observed(event: Parameters<CommandRunner["observe"]>[0]) {
    try {
      this.observe(event);
    } catch {
      console.warn("[exec] diagnostic_failed");
    }
  }
  async start(
    root: string,
    raw: unknown,
    update: (value: Execution) => void,
    elevated = false,
  ): Promise<Execution> {
    this.signal.throwIfAborted();
    if (this.disposed || launching || live.size || this.jobs.size >= 12)
      throw new Error("命令并发或数量达到上限");
    launching = true;
    try {
      const args = ExecInput.parse(raw);
      if (
        args.sandbox_permissions === "require_escalated" &&
        !elevated &&
        !this.fullAccess
      )
        throw new Error("没有该命令的提权批准");
      const host = this.fullAccess || elevated;
      const location = await workspacePath(
        root,
        args.path,
        this.signal,
        true,
        host ? "full" : "workspace",
      );
      // 凭据拒绝规则需要拼接glob；不允许工作区名改变这些规则的匹配语义。
      if (!host && /[\[\]*?{}\\]/.test(location.canonical))
        throw new Error("命令工作区名称暂不支持glob特殊字符");
      if (!location.stat.isDirectory())
        throw new Error("命令工作目录必须是实际目录");
      if (!host) await initialize(this.signal);
      this.signal.throwIfAborted();
      if (this.disposed) throw new Error("运行已结束");
      const id = randomUUID();
      const wrapped = host
        ? { argv: ["/bin/bash", "--noprofile", "--norc", "-c", args.command] }
        : await SandboxManager.wrapWithSandboxArgv(
            args.command,
            "/bin/bash",
            policy(location.canonical),
            this.signal,
            location.target,
            { commandId: id },
          );
      await location.verify();
      this.signal.throwIfAborted();
      if (this.disposed) throw new Error("运行已结束");
      // 不使用 SDK 返回的 process.env，避免宿主凭据进入任意命令；HOME 也不指向真实用户。
      const child = spawn(wrapped.argv[0], wrapped.argv.slice(1), {
        cwd: location.target,
        detached: true,
        shell: false,
        env: {
          PATH: "/Library/Developer/CommandLineTools/usr/bin:/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin",
          HOME: "/nonexistent",
          LANG: "en_US.UTF-8",
          GIT_TERMINAL_PROMPT: "0",
          GIT_OPTIONAL_LOCKS: "0",
          GIT_CONFIG_NOSYSTEM: "1",
          GIT_CONFIG_GLOBAL: "/dev/null",
          GIT_PAGER: "cat",
          PAGER: "cat",
        },
        stdio: ["pipe", "pipe", "pipe"],
      });
      const value: Execution = {
        execution_id: id,
        status: "running",
        exit_code: null,
        signal: null,
        output: "",
        truncated: false,
      };
      let resolveDone!: () => void;
      let escalation: ReturnType<typeof setTimeout> | undefined;
      let cleanupTimeout: ReturnType<typeof setTimeout> | undefined;
      let bytes = 0;
      const decoders = [new StringDecoder("utf8"), new StringDecoder("utf8")];
      const job: Job = {
        value,
        child,
        finished: false,
        done: new Promise((resolve) => {
          resolveDone = resolve;
        }),
        stop: (reason) => {
          if (job.finished || value.status !== "running") return;
          value.status = reason;
          killGroup(child, "SIGTERM");
          escalation = setTimeout(() => killGroup(child, "SIGKILL"), 250);
          // close 可能被遗留管道阻塞，关闭自有句柄并明确结束；不无限占用运行预算。
          cleanupTimeout = setTimeout(() => {
            killGroup(child, "SIGKILL");
            child.stdout?.destroy();
            child.stderr?.destroy();
            finish();
          }, 1500);
          update({ ...value });
        },
      };
      const abort = () => job.stop("cancelled");
      const timeout = setTimeout(() => job.stop("timed_out"), args.timeout_ms);
      const finish = () => {
        if (job.finished) return;
        job.finished = true;
        clearTimeout(timeout);
        clearTimeout(escalation);
        clearTimeout(cleanupTimeout);
        this.signal.removeEventListener("abort", abort);
        killGroup(child, "SIGKILL");
        if (value.status === "running") value.status = "exited";
        for (const decoder of decoders) value.output += decoder.end();
        live.delete(job);
        SandboxManager.cleanupAfterCommand();
        this.observed({
          phase: "completed",
          executionId: id,
          state: value.status,
          exitCode: value.exit_code,
          signal: value.signal,
          bytes,
          truncated: value.truncated,
        });
        update({ ...value });
        resolveDone();
        console.info("[exec] ended", {
          executionId: id,
          status: value.status,
          exitCode: value.exit_code,
          bytes,
        });
      };
      this.jobs.set(id, job);
      child.once("spawn", () =>
        this.observed({
          phase: "started",
          executionId: id,
          state: "running",
          exitCode: null,
          signal: null,
          bytes: 0,
          truncated: false,
        }),
      );
      live.add(job);
      [child.stdout, child.stderr].forEach((stream, index) =>
        stream?.on("data", (chunk: Buffer) => {
          if (job.finished || value.truncated) return;
          const remaining = 32768 - bytes;
          const accepted = chunk.subarray(0, Math.max(0, remaining));
          bytes += accepted.length;
          value.output += decoders[index].write(accepted);
          if (chunk.length > remaining) {
            value.truncated = true;
            job.stop("output_limit");
          }
          update({ ...value });
        }),
      );
      // 命令可能提前关闭stdin，EPIPE不能成为Runtime未捕获异常。
      child.stdin?.on("error", () => job.stop("spawn_failed"));
      child.once("error", () => {
        value.status = "spawn_failed";
        finish();
      });
      child.once("exit", (code, signal) => {
        value.exit_code = code;
        value.signal = signal;
        // 即使父 shell 已退出也终止同组后台进程，否则它们可能一直持有 stdout。
        killGroup(child, "SIGKILL");
      });
      child.once("close", finish);
      this.signal.addEventListener("abort", abort, { once: true });
      if (this.signal.aborted) abort();
      update({ ...value });
      return await this.poll(id, args.yield_time_ms);
    } finally {
      launching = false;
    }
  }
  /** 轮询返回累计输出，模型不需要拼接重复增量；stdout/stderr合并顺序是到达顺序。 */
  async poll(id: string, wait = 1000): Promise<Execution> {
    const job = this.jobs.get(id);
    if (!job || this.disposed) throw new Error("执行句柄不属于本轮或已失效");
    if (!job.finished && wait > 0) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([
        job.done,
        new Promise<void>((resolve) => {
          timer = setTimeout(resolve, wait);
        }),
      ]);
      clearTimeout(timer);
    }
    return { ...job.value };
  }
  /** 有界标准输入，不提供TTY或任意PID；沿用启动时已确定的执行边界，不会因stdin再次提升权限。 */
  async write(id: string, chars: string, wait: number): Promise<Execution> {
    const job = this.jobs.get(id);
    if (!job || this.disposed) throw new Error("执行句柄不属于本轮或已失效");
    if (chars) {
      if (
        job.finished ||
        job.value.status !== "running" ||
        !job.child.stdin?.writable ||
        job.child.stdin.writableLength > 4096
      )
        throw new Error("命令输入已关闭或缓冲区达到上限");
      job.child.stdin.write(chars);
    }
    return this.poll(id, wait);
  }
  async stop(id: string): Promise<Execution> {
    const job = this.jobs.get(id);
    if (!job || this.disposed) throw new Error("执行句柄不属于本轮或已失效");
    job.stop("cancelled");
    await job.done;
    return { ...job.value };
  }
  /** Run 终态前清理所有句柄，模型不能靠返回最终回答让命令脱离运行生命周期。 */
  async dispose() {
    this.disposed = true;
    for (const job of this.jobs.values()) job.stop("cancelled");
    await Promise.all([...this.jobs.values()].map((job) => job.done));
    this.jobs.clear();
  }
}
