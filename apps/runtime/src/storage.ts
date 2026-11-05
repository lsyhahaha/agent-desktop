import {
  EvolutionRecord,
  EvolutionPage,
  type EvolutionDraft,
} from "./evolution-record";
import { ReadingStrategyId } from "@protocol";
import type { StrategyEvaluation } from "./strategy-evaluation";
import { Worker } from "node:worker_threads";
import {
  RecoveryResult,
  StorageRequest,
  LoadedSession,
  SessionMeta,
  SessionPage,
  type StorageRequest as Request,
} from "./storage-types";
import { RunInspection } from "@protocol";

/** 有界Worker RPC；超时/异常后进入失败状态，不猜测事务是否已提交，也不自动重试。 */
export class SessionStore {
  private worker: Worker;
  private next = 0;
  private failed: Error | undefined;
  private closing = false;
  private pending = new Map<
    number,
    {
      resolve: (value: unknown) => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  constructor(
    path: string,
    private onFailure: (message: string) => void,
  ) {
    this.worker = new Worker(new URL("./storage-worker.js", import.meta.url), {
      workerData: { path },
      execArgv: [],
      env: { NODE_ENV: process.env.NODE_ENV ?? "production" },
    });
    this.worker.on(
      "message",
      (value: {
        id?: number;
        value?: unknown;
        error?: string;
        fatal?: boolean;
      }) => {
        const entry = this.pending.get(value.id ?? -1);
        if (!entry) return;
        clearTimeout(entry.timer);
        this.pending.delete(value.id!);
        if (value.error) {
          const error = new Error(value.error);
          entry.reject(error);
          if (value.fatal !== false) this.fail(error);
        } else entry.resolve(value.value);
      },
    );
    this.worker.on("error", () =>
      this.fail(new Error("本地存储Worker异常，请重启后检查数据文件。")),
    );
    this.worker.on("exit", (code) => {
      if (!this.closing)
        this.fail(new Error("本地存储Worker已退出，不能继续保存。"));
    });
  }
  private fail(error: Error) {
    if (this.failed) return;
    this.failed = error;
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(error);
    }
    this.pending.clear();
    this.onFailure(error.message);
  }
  request(request: Request): Promise<unknown> {
    if (this.failed) return Promise.reject(this.failed);
    if (this.pending.size >= 8)
      return Promise.reject(new Error("存储队列达到上限"));
    const validated = StorageRequest.parse(request),
      id = ++this.next;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () =>
          this.fail(
            new Error("本地存储超时；为避免重复提交，已停止接纳新任务。"),
          ),
        7000,
      );
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.worker.postMessage({ id, request: validated });
      } catch {
        this.fail(new Error("无法连接本地存储Worker。"));
      }
    });
  }
  /** 可信维护入口复用唯一Worker；renderer与模型未获得写入进化历史的通道。 */
  async appendEvolution(record: EvolutionDraft) {
    return EvolutionRecord.parse(
      await this.request({ op: "evolution_append", record }),
    );
  }
  async getEvolution(projectPath: string, id: string) {
    return EvolutionRecord.parse(
      await this.request({ op: "evolution_get", projectPath, id }),
    );
  }
  async evolutionPage(projectPath: string, after = 0, limit = 20) {
    return EvolutionPage.parse(
      await this.request({ op: "evolution_page", projectPath, after, limit }),
    );
  }
  async appendStrategyEvaluation(report: StrategyEvaluation) {
    return String(
      await this.request({ op: "strategy_evaluation_append", report }),
    );
  }
  async selectedReadingStrategy(projectPath: string) {
    return ReadingStrategyId.parse(
      await this.request({ op: "strategy_selected", projectPath }),
    );
  }
  async selectReadingStrategy(
    projectPath: string,
    strategyId: import("@protocol").ReadingStrategyId,
    report: StrategyEvaluation | null,
    rationale: string,
  ) {
    return ReadingStrategyId.parse(
      await this.request({
        op: "strategy_select",
        projectPath,
        strategyId,
        report,
        rationale,
        humanReviewed: true,
      }),
    );
  }
  async recover() {
    return RecoveryResult.parse(await this.request({ op: "recover" }));
  }
  async selected() {
    const value = await this.request({ op: "selected" });
    return value === null ? null : SessionMeta.parse(value);
  }
  async draft(workspace?: import("@protocol").WorkspaceSelection) {
    const value = await this.request({ op: "draft", workspace });
    return value === null ? null : SessionMeta.parse(value);
  }
  async load(id: string) {
    return LoadedSession.parse(await this.request({ op: "load", id }));
  }
  async page(page: number, workspace?: import("@protocol").WorkspaceSelection, query?: string) {
    return SessionPage.parse(await this.request({ op: "page", page, workspace, query }));
  }
  async inspect(sessionId: string, runId: string) {
    return RunInspection.parse(
      await this.request({ op: "inspect", sessionId, runId }),
    );
  }
  async close() {
    if (this.closing) return;
    this.closing = true;
    try {
      if (!this.failed) await this.request({ op: "close" });
    } finally {
      await this.worker.terminate();
    }
  }
}
