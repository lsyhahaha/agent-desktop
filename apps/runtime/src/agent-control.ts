import { randomUUID } from "node:crypto";

/** 子任务控制平面。只负责生命周期，不赋予工具或文件权限。 */
export type ChildState = "running" | "stopping" | "completed" | "failed" | "cancelled";
export interface ChildSnapshot<T> {
  id: string;
  parentId: string;
  state: ChildState;
  result?: T;
  error?: string;
  startedAt: number;
  finishedAt?: number;
}
interface Child<T> {
  snapshot: ChildSnapshot<T>;
  controller: AbortController;
  done: Promise<ChildSnapshot<T>>;
  unlinkParent?: () => void;
}
export class AgentControl<T> {
  private readonly children = new Map<string, Child<T>>();
  // 使用可直接擦除的类型语法，兼容 CI 的 Node strip-types 测试入口。
  private readonly maxChildren: number;
  constructor(maxChildren = 3) {
    if (!Number.isInteger(maxChildren) || maxChildren < 1) throw new Error("invalid child limit");
    this.maxChildren = maxChildren;
  }
  spawn(parentId: string, run: (signal: AbortSignal) => Promise<T>, parentSignal?: AbortSignal): string {
    if (!parentId) throw new Error("missing parent id");
    const active = [...this.children.values()].filter(c => c.snapshot.state === "running" || c.snapshot.state === "stopping").length;
    if (active >= this.maxChildren) throw new Error("subagent concurrency limit");
    const id = randomUUID();
    if (parentSignal?.aborted) throw new Error("parent run already cancelled");
    const controller = new AbortController();
    const snapshot: ChildSnapshot<T> = { id, parentId, state: "running", startedAt: Date.now() };
    const child: Child<T> = { snapshot, controller, done: undefined! };
    if (parentSignal) {
      const abort = () => this.cancel(id);
      parentSignal.addEventListener("abort", abort, { once: true });
      child.unlinkParent = () => parentSignal.removeEventListener("abort", abort);
    }
    this.children.set(id, child);
    child.done = Promise.resolve().then(() => {
      if (controller.signal.aborted) throw controller.signal.reason ?? new Error("subagent cancelled");
      return run(controller.signal);
    }).then(
      result => {
        snapshot.state = controller.signal.aborted ? "cancelled" : "completed";
        snapshot.finishedAt = Date.now();
        child.unlinkParent?.();
        if (snapshot.state === "completed") snapshot.result = result;
        return { ...snapshot };
      },
      error => {
        snapshot.state = controller.signal.aborted ? "cancelled" : "failed";
        snapshot.finishedAt = Date.now();
        child.unlinkParent?.();
        if (snapshot.state === "failed") snapshot.error = error instanceof Error ? error.message : "unknown error";
        return { ...snapshot };
      },
    );
    return id;
  }
  get(id: string): ChildSnapshot<T> | null {
    const child = this.children.get(id);
    return child ? { ...child.snapshot } : null;
  }
  wait(id: string): Promise<ChildSnapshot<T>> {
    const child = this.children.get(id);
    if (!child) throw new Error("unknown subagent");
    return child.done.then(result => ({ ...result }));
  }
  cancel(id: string): boolean {
    const child = this.children.get(id);
    if (!child || child.snapshot.state !== "running") return false;
    child.snapshot.state = "stopping";
    child.controller.abort();
    return true;
  }
  async close(): Promise<void> {
    for (const child of this.children.values()) if (child.snapshot.state === "running") this.cancel(child.snapshot.id);
    await Promise.all([...this.children.values()].map(child => child.done));
    this.children.clear();
  }
}
