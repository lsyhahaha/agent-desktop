import { utilityProcess, type UtilityProcess } from "electron";
import { randomUUID } from "node:crypto";
import {
  RuntimeResponse,
  RuntimeEvent,
  RuntimeStatus,
  SessionSnapshot,
  type DesktopStatus,
} from "@protocol";
type Pending = {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};
export class RuntimeHost {
  private child: UtilityProcess | undefined;
  private pending = new Map<string, Pending>();
  constructor(
    private readonly entry: string,
    private readonly onSnapshot: (value: SessionSnapshot) => void,
  ) {}
  start(): void {
    if (this.child) return;
    const child = utilityProcess.fork(this.entry, [], {
      serviceName: "Agent Desktop Runtime",
      env: {
        // SDK内部用which查找shell；固定系统PATH，不继承用户目录或凭据。
        PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
        NODE_ENV:
          process.env.NODE_ENV === "development" ? "development" : "production",
      },
      stdio: "pipe",
    });
    this.child = child;
    child.stdout?.on("data", (chunk: Buffer) =>
      console.info("[runtime]", chunk.toString().trim()),
    );
    child.stderr?.on("data", (chunk: Buffer) =>
      console.error("[runtime]", chunk.toString().trim()),
    );
    child.on("message", (data: unknown) => {
      const event = RuntimeEvent.safeParse(data);
      if (event.success) {
        this.onSnapshot(event.data.payload);
        return;
      }
      const parsed = RuntimeResponse.safeParse(data);
      if (!parsed.success) {
        console.warn("[runtime] invalid response");
        return;
      }
      const item = this.pending.get(parsed.data.id);
      if (!item) return;
      clearTimeout(item.timer);
      this.pending.delete(parsed.data.id);
      if (parsed.data.error) item.reject(new Error(parsed.data.error));
      else item.resolve(parsed.data.payload);
    });
    child.on("exit", (code) => {
      if (this.child === child) {
        this.child = undefined;
        this.rejectPending(new Error(`Runtime exited (${code})`));
        console.warn("[runtime] exited", code);
      }
    });
  }
  async status(): Promise<DesktopStatus["runtime"]> {
    return RuntimeStatus.parse(await this.request({ type: "runtime.ping" }));
  }
  private request(fields: Record<string, unknown>): Promise<unknown> {
    if (!this.child)
      return Promise.reject(
        new Error("Runtime unavailable; restart the application"),
      );
    if (this.pending.size >= 32)
      return Promise.reject(new Error("Runtime 请求过多，请稍后重试"));
    const child = this.child,
      id = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error("Runtime response timed out"));
      }, 5000);
      this.pending.set(id, { resolve, reject, timer });
      try {
        child.postMessage({ version: 1, id, ...fields });
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(
          error instanceof Error
            ? error
            : new Error("Runtime transport failed"),
        );
      }
    });
  }
  async chat(
    command: unknown,
    context?: unknown,
    workspace?: unknown,
  ): Promise<SessionSnapshot> {
    return SessionSnapshot.parse(
      await this.request({
        type: "agent.command",
        command,
        ...(context ? { context } : {}),
        ...(workspace !== undefined ? { workspace } : {}),
      }),
    );
  }
  stop(): void {
    const child = this.child;
    this.child = undefined;
    this.rejectPending(new Error("Application closing"));
    if (child) {
      // 先通知受信Runtime杀掉自有命令进程组；超时兜底终止Runtime，避免应用退出卡住。
      const fallback = setTimeout(() => child.kill(), 2000);
      fallback.unref();
      child.once("exit", () => clearTimeout(fallback));
      try {
        child.postMessage({
          version: 1,
          id: randomUUID(),
          type: "runtime.shutdown",
        });
      } catch {
        clearTimeout(fallback);
        child.kill();
      }
    }
  }
  private rejectPending(error: Error): void {
    for (const item of this.pending.values()) {
      clearTimeout(item.timer);
      item.reject(error);
    }
    this.pending.clear();
  }
}
