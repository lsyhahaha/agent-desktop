import pino, { type Logger, type DestinationStream } from "pino";
import {
  constants,
  open as openFile,
  close as closeFile,
  fstat,
  fchmod,
  read as readFd,
  write as writeFd,
  ftruncate,
} from "node:fs";
import {
  chmod,
  lstat,
  mkdir,
  realpath,
  unlink,
  rename,
} from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { protectRuntimeDirectory } from "./workspace-path";
import { BUILD_ID } from "@protocol";

const messages = {
  "runtime.started": "Runtime已启动",
  "runtime.stopping": "Runtime准备退出",
  "runtime.stopped": "Runtime业务资源已清理，准备退出",
  "runtime.log_repaired": "修复未完整写入的日志尾部",
  "runtime.error": "Runtime异常",
  "recovery.started": "开始恢复会话",
  "recovery.completed": "会话恢复完成",
  "run.interrupted": "恢复时发现未决任务，已标记中断",
  "rpc.failed": "Runtime请求失败",
  "run.received": "收到任务输入，准备保存",
  "run.created": "任务输入已保存并接纳",
  "run.started": "开始执行任务",
  "run.state_changed": "任务状态改变",
  "run.cancel_requested": "用户请求取消",
  "run.completed": "本轮执行完成",
  "run.failed": "本轮执行失败",
  "run.cancelled": "本轮执行已取消",
  "run.timeout": "执行超时",
  "run.budget_exceeded": "达到执行预算上限",
  "loop.started": "开始Agent Loop迭代",
  "loop.continued": "工具结果已回填，继续模型",
  "model.started": "开始模型请求",
  "model.completed": "模型响应完成",
  "model.failed": "模型请求未完成",
  "model.usage": "模型返回实际用量",
  "tool.requested": "收到模型工具调用",
  "tool.validated": "工具参数校验通过",
  "tool.started": "开始实际工具操作",
  "tool.returned": "工具调用已返回，进程可能仍在运行",
  "tool.failed": "工具调用失败",
  "execution.started": "命令进程已创建",
  "execution.completed": "命令进程已结束",
  "interaction.requested": "等待用户审批或回答",
  "interaction.resolved": "用户交互已结算",
  "interaction.expired": "用户交互已失效",
  "plan.updated": "Agent更新任务计划",
  "file.read": "已批准的文件读取完成",
  "file.proposed": "提出文件修改，等待审批",
  "file.applied": "文件修改已确认应用",
  "file.failed": "文件修改未成功或结果未知",
  "cleanup.started": "开始清理本轮资源",
  "cleanup.completed": "本轮资源清理完成",
  "storage.saved": "业务检查点已保存",
  "storage.failed": "业务保存失败",
} as const;
export type RuntimeLogEvent = keyof typeof messages;
const fieldNames = [
  "sessionId",
  "runId",
  "nodeVersion",
  "itemId",
  "toolCallId",
  "executionId",
  "interactionId",
  "requestId",
  "model",
  "tool",
  "kind",
  "path",
  "state",
  "code",
  "operation",
  "phase",
  "decision",
  "reason",
  "attempt",
  "iteration",
  "durationMs",
  "inputCharacters",
  "outputCharacters",
  "contextCharacters",
  "historyMessages",
  "inputTokens",
  "outputTokens",
  "usageComplete",
  "toolCount",
  "modelCalls",
  "exitCode",
  "signal",
  "truncated",
  "bytes",
  "steps",
  "revision",
  "count",
  "inputSaved",
] as const;
type Field = (typeof fieldNames)[number];
export type RuntimeLogFields = Partial<
  Record<Field, string | number | boolean | null>
>;
const allowed = new Set<string>(fieldNames);
export interface RunLog {
  event(
    event: RuntimeLogEvent,
    fields?: RuntimeLogFields,
    level?: "info" | "warn" | "error",
  ): void;
  close(): Promise<void>;
}
export const nullRunLog: RunLog = { event() {}, async close() {} };
type Level = "info" | "warn" | "error";
type Sink = DestinationStream & {
  on(event: string, listener: (...args: unknown[]) => void): unknown;
  once(event: string, listener: () => void): unknown;
  end(): void;
  flush(callback: (error?: Error | null) => void): void;
  destroy(): void;
};
const maxFileBytes = 10 * 1024 * 1024;
let lastDiagnostic = 0;
/** 故障出口只输出固定类别，不回退打印原始正文或异常。 */
function diagnostic(code: string) {
  if (Date.now() - lastDiagnostic < 10000) return;
  lastDiagnostic = Date.now();
  console.warn("[runtime-log] degraded", { code });
}

/** 单写者：所有任务复用固定文件；任务close只释放上下文，进程退出才关闭文件。 */
export class RuntimeLogs {
  readonly bootId = randomUUID();
  readonly file: string;
  readonly root: RunLog;
  private sink: Sink | undefined;
  private logger: Logger | undefined;
  private ready: Promise<void>;
  private failed = false;
  private closing = false;
  private finished: Promise<void> | undefined;
  private rotating: Promise<void> | undefined;
  private size = 0;
  private seq = 0;
  private queue: string[] = [];
  private queuedBytes = 0;
  constructor(readonly directory: string) {
    this.file = join(directory, "runtime.jsonl");
    this.ready = this.initialize().catch(() => this.fail("initialize_failed"));
    this.root = this.scope({}, [], 5000);
  }
  private fail(code: string) {
    this.failed = true;
    this.queue = [];
    this.queuedBytes = 0;
    diagnostic(code);
  }
  private async initialize() {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const info = await lstat(this.directory);
    if (!info.isDirectory() || info.isSymbolicLink())
      throw new Error("invalid_log_directory");
    await chmod(this.directory, 0o700);
    protectRuntimeDirectory(await realpath(this.directory));
    await this.openSink(false);
    if (this.closing) return;
    this.drain();
  }
  /** 安全打开固定文件，跨重启追加；轮转后独占创建，拒绝链接及非普通文件。 */
  private async openSink(exclusive: boolean) {
    await new Promise<void>((resolve, reject) => {
      openFile(
        this.file,
        constants.O_CREAT |
          constants.O_RDWR |
          constants.O_APPEND |
          constants.O_NOFOLLOW |
          (exclusive ? constants.O_EXCL : 0),
        0o600,
        (error, fd) => {
          if (error) {
            reject(error);
            return;
          }
          fstat(fd, (error, stat) => {
            if (error || !stat.isFile() || stat.nlink !== 1) {
              closeFile(fd, () => {});
              reject(new Error("invalid_log_file"));
              return;
            }
            fchmod(fd, 0o600, (error) => {
              if (error) {
                closeFile(fd, () => {});
                reject(error);
                return;
              }
              void this.repairTail(fd, stat.size).then(
                (size) => {
                  try {
                    const sink = pino.destination({
                      fd,
                      sync: false,
                      minLength: 0,
                      maxLength: 65536,
                    }) as Sink;
                    sink.on("error", () => this.fail("file_write_failed"));
                    sink.on("drop", () => this.fail("buffer_overflow"));
                    this.sink = sink;
                    this.size = size;
                    resolve();
                  } catch (error) {
                    closeFile(fd, () => {});
                    reject(error);
                  }
                },
                (error) => {
                  closeFile(fd, () => {});
                  reject(error);
                },
              );
            });
          });
        },
      );
    });
  }
  /** 固定文件跨重启追加前检查最后一行，最多读取64KiB，不让残缺JSON污染后续记录。 */
  private repairTail(fd: number, size: number): Promise<number> {
    if (size === 0) return Promise.resolve(0);
    return new Promise((resolve, reject) => {
      const buffer = Buffer.alloc(Math.min(size, 65536));
      readFd(
        fd,
        buffer,
        0,
        buffer.length,
        size - buffer.length,
        (error, bytes) => {
          if (error || bytes !== buffer.length) {
            reject(error ?? new Error("log_file_changed"));
            return;
          }
          if (buffer[bytes - 1] === 10) {
            resolve(size);
            return;
          }
          const newline = buffer.lastIndexOf(10),
            tail = buffer.subarray(newline + 1);
          let complete = false;
          try {
            JSON.parse(tail.toString("utf8"));
            complete = true;
          } catch {}
          if (complete) {
            writeFd(fd, "\n", (error) => {
              if (error) reject(error);
              else {
                this.root?.event(
                  "runtime.log_repaired",
                  { phase: "newline_added", bytes: 1 },
                  "warn",
                );
                resolve(size + 1);
              }
            });
            return;
          }
          if (newline < 0 && size > buffer.length) {
            reject(new Error("log_tail_too_large"));
            return;
          }
          const end = size - buffer.length + newline + 1;
          ftruncate(fd, end, (error) => {
            if (error) reject(error);
            else {
              this.root?.event(
                "runtime.log_repaired",
                { phase: "partial_record_removed", bytes: size - end },
                "warn",
              );
              resolve(end);
            }
          });
        },
      );
    });
  }
  private clean(value: string, secrets: string[]) {
    let result = value;
    for (const secret of secrets)
      if (secret) result = result.split(secret).join("[REDACTED]");
    return result
      .replace(/(?:Bearer\s+|sk[-_])[a-zA-Z0-9._~+\/-]+/gi, "[REDACTED]")
      .replace(
        /((?:api[_-]?key|token|secret|password)\s*[:=]\s*)[^\s,;]+/gi,
        "$1[REDACTED]",
      )
      .slice(0, 512);
  }
  private enqueue(line: string) {
    const bytes = Buffer.byteLength(line);
    if (this.queue.length >= 128 || this.queuedBytes + bytes > 65536) {
      this.fail("pending_buffer_overflow");
      return;
    }
    this.queue.push(line);
    this.queuedBytes += bytes;
  }
  private output(line: string) {
    if (this.failed) return;
    if (!this.sink || this.rotating) {
      this.enqueue(line);
      return;
    }
    const bytes = Buffer.byteLength(line);
    if (this.size > 0 && this.size + bytes > maxFileBytes) {
      this.enqueue(line);
      this.rotate();
      return;
    }
    this.size += bytes;
    try {
      this.sink.write(line);
    } catch {
      this.fail("file_write_failed");
    }
  }
  private drain() {
    while (this.queue.length && !this.failed && !this.rotating && this.sink) {
      const line = this.queue.shift()!;
      this.queuedBytes -= Buffer.byteLength(line);
      this.output(line);
    }
  }
  /** 使用Pino destination排空/关闭，重命名自有文件后恢复同一路径；期间只暂存有界数据。 */
  private rotate() {
    if (this.rotating || this.failed) return;
    this.rotating = (async () => {
      await this.endSink();
      this.sink = undefined;
      await unlink(join(this.directory, "runtime.5.jsonl")).catch((error) => {
        if (error.code !== "ENOENT") throw error;
      });
      for (let index = 4; index >= 1; index--)
        await rename(
          join(this.directory, `runtime.${index}.jsonl`),
          join(this.directory, `runtime.${index + 1}.jsonl`),
        ).catch((error) => {
          if (error.code !== "ENOENT") throw error;
        });
      await rename(this.file, join(this.directory, "runtime.1.jsonl"));
      await this.openSink(true);
    })()
      .catch(() => this.fail("rotation_failed"))
      .finally(() => {
        this.rotating = undefined;
        this.drain();
      });
  }
  private endSink(): Promise<void> {
    const sink = this.sink;
    if (!sink) return Promise.resolve();
    return new Promise((resolve, reject) => {
      sink.once("close", resolve);
      sink.on("error", reject);
      try {
        sink.end();
      } catch (error) {
        reject(error);
      }
    });
  }
  private baseLogger() {
    if (!this.logger)
      this.logger = pino(
        {
          base: {
            schemaVersion: 1,
            process: "runtime",
            pid: process.pid,
            buildId: BUILD_ID,
            bootId: this.bootId,
          },
          timestamp: pino.stdTimeFunctions.isoTime,
          formatters: { level: (label) => ({ level: label }) },
          redact: {
            paths: [
              "apiKey",
              "token",
              "authorization",
              "password",
              "prompt",
              "content",
              "data",
            ],
            remove: true,
          },
        },
        { write: (line) => this.output(line) },
      );
    return this.logger;
  }
  private scope(
    bindings: Record<string, string>,
    secrets: string[],
    limit: number,
  ): RunLog {
    let closed = false,
      count = 0,
      bytes = 0,
      child: Logger | undefined;
    return {
      event: (event, fields = {}, level: Level = "info") => {
        if (closed || this.closing || this.failed) return;
        try {
          if (++count > limit) {
            closed = true;
            diagnostic("context_record_limit");
            return;
          }
          const safe: RuntimeLogFields = {};
          for (const [key, value] of Object.entries(fields)) {
            if (!allowed.has(key)) continue;
            if (typeof value === "string")
              safe[key as Field] = this.clean(value, secrets);
            else if (
              value === null ||
              typeof value === "boolean" ||
              (typeof value === "number" && Number.isFinite(value))
            )
              safe[key as Field] = value;
          }
          bytes += Buffer.byteLength(JSON.stringify(safe)) + 1024;
          if (bytes > (limit === 512 ? 1024 * 1024 : 8 * 1024 * 1024)) {
            closed = true;
            diagnostic("context_budget");
            return;
          }
          child ??= this.baseLogger().child(bindings);
          child[level]({ ...safe, event, seq: ++this.seq }, messages[event]);
        } catch {
          diagnostic("record_failed");
        }
      },
      close: async () => {
        closed = true;
        secrets = [];
      },
    };
  }
  run(sessionId: string, runId: string, secrets: string[]): RunLog {
    return this.scope({ sessionId, runId }, [...secrets], 512);
  }
  /** 只在Runtime退出时排空共享文件，单个Run结束不关掉其他任务的日志出口。 */
  close(): Promise<void> {
    if (this.finished) return this.finished;
    this.closing = true;
    this.finished = (async () => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const finish = (async () => {
        await this.ready;
        while (this.rotating) await this.rotating;
        this.drain();
        while (this.rotating) await this.rotating;
        await this.endSink();
      })();
      try {
        await Promise.race([
          finish,
          new Promise<never>((_, reject) => {
            timer = setTimeout(
              () => reject(new Error("log_close_timeout")),
              1500,
            );
          }),
        ]);
      } catch {
        diagnostic("close_unconfirmed");
      } finally {
        clearTimeout(timer);
      }
    })();
    return this.finished;
  }
}
