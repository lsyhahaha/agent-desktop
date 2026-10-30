import { utilityProcess, type UtilityProcess } from "electron";
import { randomUUID } from "node:crypto";
import { RuntimeResponse, type DesktopStatus } from "@protocol";
type Pending = {
  resolve: (value: DesktopStatus["runtime"]) => void;
  reject: (reason: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};
export class RuntimeHost {
  private child: UtilityProcess | undefined;
  private pending = new Map<string, Pending>();
  constructor(private readonly entry: string) {}
  start(): void {
    if (this.child) return;
    const child = utilityProcess.fork(this.entry, [], {
      serviceName: "Agent Desktop Runtime",
      env: {
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
      const parsed = RuntimeResponse.safeParse(data);
      if (!parsed.success) {
        console.warn("[runtime] invalid response");
        return;
      }
      const item = this.pending.get(parsed.data.id);
      if (!item) return;
      clearTimeout(item.timer);
      this.pending.delete(parsed.data.id);
      item.resolve(parsed.data.payload);
    });
    child.on("exit", (code) => {
      if (this.child === child) {
        this.child = undefined;
        this.rejectPending(new Error(`Runtime exited (${code})`));
        console.warn("[runtime] exited", code);
      }
    });
  }
  status(): Promise<DesktopStatus["runtime"]> {
    if (!this.child)
      return Promise.reject(
        new Error("Runtime unavailable; restart the application"),
      );
    const child = this.child,
      id = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error("Runtime response timed out"));
      }, 5000);
      this.pending.set(id, { resolve, reject, timer });
      try {
        child.postMessage({ version: 1, id, type: "runtime.ping" });
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
  stop(): void {
    const child = this.child;
    this.child = undefined;
    this.rejectPending(new Error("Application closing"));
    child?.kill();
  }
  private rejectPending(error: Error): void {
    for (const item of this.pending.values()) {
      clearTimeout(item.timer);
      item.reject(error);
    }
    this.pending.clear();
  }
}
