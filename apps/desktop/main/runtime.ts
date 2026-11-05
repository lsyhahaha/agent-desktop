import { utilityProcess, type MessagePortMain, type UtilityProcess } from "electron";
import { randomUUID } from "node:crypto";
import {
  TerminalReply,
  type TerminalCommand,
  type TerminalSnapshot,
  type TerminalProfile,
  RuntimeResponse,
  validationFields,
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
  private pluginStatus: (value: { id: string; status: "failed" | "disabled"; error: string }) => void = () => {};
  constructor(
    private readonly entry: string,
    private readonly onSnapshot: (value: SessionSnapshot) => void,
    private readonly onTerminal: (value: TerminalSnapshot) => void = () => {},
  ) {}
  start(databasePath: string): void {
    if (this.child) return;
    const child = utilityProcess.fork(
      this.entry,
      [`--database=${databasePath}`],
      {
        serviceName: "Agent Desktop Runtime",
        env: {
          // SDK内部用which查找shell；固定系统PATH，不继承用户目录或凭据。
          PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
          NODE_ENV:
            process.env.NODE_ENV === "development"
              ? "development"
              : "production",
        },
        stdio: "pipe",
      },
    );
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
        if (event.data.type === "terminal.snapshot")
          this.onTerminal(event.data.payload);
        else if (event.data.type === "agent.snapshot") this.onSnapshot(event.data.payload);
        else this.pluginStatus(event.data.payload);
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
  setPluginStatusHandler(handler: typeof this.pluginStatus) {
    this.pluginStatus = handler;
  }
  async status(): Promise<DesktopStatus["runtime"]> {
    const result = RuntimeStatus.safeParse(
      await this.request({ type: "runtime.ping" }),
    );
    if (!result.success) {
      console.error("[runtime] protocol_mismatch", {
        operation: "status",
        fields: validationFields(result.error),
      });
      throw new Error(
        "[protocol_mismatch] 界面与后台版本不一致，请完整退出 Agent Desktop 后重新启动。",
      );
    }
    return result.data;
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
      }, 10000);
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
  /** Main只移交已校验插件的专用端口；后续Hook流量不经过Main。 */
  attachPlugin(plugin: import("@protocol").RuntimePluginDescriptor, port: MessagePortMain) {
    return this.requestWithPorts({ type: "plugin.attach", plugin }, [port]);
  }
  detachPlugin(pluginId: string) {
    return this.request({ type: "plugin.detach", pluginId });
  }
  private requestWithPorts(fields: Record<string, unknown>, ports: MessagePortMain[]) {
    if (!this.child) return Promise.reject(new Error("Runtime unavailable; restart the application"));
    const child = this.child, id = randomUUID();
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error("Runtime response timed out"));
      }, 10000);
      this.pending.set(id, { resolve, reject, timer });
      try {
        child.postMessage({ version: 1, id, ...fields }, ports);
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error instanceof Error ? error : new Error("Runtime transport failed"));
      }
    });
  }
  async terminal(
    command: TerminalCommand,
    authorizedRoot?: string,
    profile?: TerminalProfile,
  ) {
    return TerminalReply.parse(
      await this.request({
        type: "terminal.command",
        command,
        ...(authorizedRoot ? { authorizedRoot } : {}),
        ...(profile ? { profile } : {}),
      }),
    );
  }
  async chat(
    command: unknown,
    context?: unknown,
    workspace?: unknown,
  ): Promise<SessionSnapshot> {
    const result = SessionSnapshot.safeParse(
      await this.request({
        type: "agent.command",
        command,
        ...(context ? { context } : {}),
        ...(workspace !== undefined ? { workspace } : {}),
      }),
    );
    if (!result.success) {
      console.error("[runtime] protocol_mismatch", {
        operation: "chat",
        fields: validationFields(result.error),
      });
      throw new Error(
        "[protocol_mismatch] 会话数据与当前版本不一致，请完整退出 Agent Desktop 后重新启动。",
      );
    }
    return result.data;
  }
  async stop(): Promise<void> {
    const child = this.child;
    if (!child) return;
    try {
      await this.request({ type: "runtime.shutdown" });
    } catch {
      console.warn("[runtime] graceful storage shutdown failed");
    } finally {
      this.child = undefined;
      this.rejectPending(new Error("Application closing"));
      child.kill();
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
