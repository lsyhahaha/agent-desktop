import { createHash, randomUUID } from "node:crypto";
import {
  HookContext,
  HookDecision,
  PluginHostResponse,
  RuntimePluginDescriptor,
  type HookPatch,
  type HookStage,
  type RuntimePluginDescriptor as PluginDescriptor,
} from "@protocol";

type Pending = {
  resolve: (decision: HookDecision) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};
type Connection = {
  descriptor: PluginDescriptor;
  port: import("electron").MessagePortMain;
  pending: Map<string, Pending>;
  disabled: boolean;
};
export type HookRecord = {
  pluginId: string;
  pluginName: string;
  stage: HookStage;
  outcome: "modified" | "denied" | "failed" | "disabled";
  changedFields: string[];
  inputDigest: string;
  outputDigest?: string;
  code?: string;
};
export class HookPipelineError extends Error {
  constructor(public readonly code: "plugin_denied" | "plugin_hook_failed", message: string) {
    super(message);
  }
}

const digest = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");

/** 进程连接池只管理传输；每轮Pipeline会冻结一份已启用插件顺序。 */
export class PluginConnections {
  private connections = new Map<string, Connection>();
  constructor(
    private readonly status: (value: { id: string; status: "failed" | "disabled"; error: string }) => void = () => {},
  ) {}

  /** 接管Main移交的单插件端口；重复ID关闭旧端口，所有响应必须匹配pending身份。 */
  attach(raw: unknown, port: import("electron").MessagePortMain) {
    const descriptor = RuntimePluginDescriptor.parse(raw);
    this.connections.get(descriptor.id)?.port.close();
    const connection: Connection = {
      descriptor,
      port,
      pending: new Map(),
      disabled: false,
    };
    port.on("message", (event) => {
      const response = PluginHostResponse.safeParse(event.data);
      if (!response.success) return this.fail(connection, new Error("插件返回非法协议"));
      const item = connection.pending.get(response.data.id);
      if (!item) return;
      clearTimeout(item.timer);
      connection.pending.delete(response.data.id);
      if (response.data.type === "result") item.resolve(response.data.decision);
      else if (response.data.type === "error") item.reject(new Error(response.data.message));
      else item.resolve({ action: "continue" });
    });
    port.on("close", () => this.fail(connection, new Error("插件连接已关闭")));
    port.start();
    this.connections.set(descriptor.id, connection);
  }

  /** cooperative shutdown先把关闭消息送到Host；Main仍负责核对进程是否真实退出。 */
  detach(id: string) {
    const connection = this.connections.get(id);
    if (!connection) return;
    this.connections.delete(id);
    try {
      connection.port.postMessage({ type: "shutdown", id: randomUUID() });
    } catch {
      connection.port.close();
    }
  }

  /** Run接纳时获取稳定顺序快照；后续启停不会改变正在执行的Pipeline。 */
  snapshot() {
    return [...this.connections.values()]
      .filter((connection) => !connection.disabled)
      .sort((a, b) => a.descriptor.order - b.descriptor.order)
      .slice(0, 8);
  }

  private fail(connection: Connection, error: Error) {
    if (connection.disabled) return;
    connection.disabled = true;
    for (const item of connection.pending.values()) {
      clearTimeout(item.timer);
      item.reject(error);
    }
    connection.pending.clear();
    this.status({ id: connection.descriptor.id, status: "failed", error: error.message.slice(0, 500) });
  }

  disable(connection: Connection, error: Error, status: "failed" | "disabled" = "failed") {
    if (connection.disabled) return;
    connection.disabled = true;
    for (const item of connection.pending.values()) {
      clearTimeout(item.timer);
      item.reject(error);
    }
    connection.pending.clear();
    this.status({ id: connection.descriptor.id, status, error: error.message.slice(0, 500) });
  }

  /** 单次RPC在取消、超时、端口关闭时都移除pending，防止旧回复结算新阶段。 */
  request(
    connection: Connection,
    mode: "observe" | "mutate",
    context: HookContext,
    signal: AbortSignal,
    timeoutMs: number,
  ) {
    return new Promise<HookDecision>((resolve, reject) => {
      const id = randomUUID();
      const cleanup = () => signal.removeEventListener("abort", abort);
      const abort = () => {
        const pending = connection.pending.get(id);
        if (!pending) return;
        clearTimeout(pending.timer);
        connection.pending.delete(id);
        cleanup();
        reject(signal.reason instanceof Error ? signal.reason : new Error("Hook已取消"));
      };
      const timer = setTimeout(() => {
        connection.pending.delete(id);
        cleanup();
        reject(new Error("插件Hook超过3秒"));
      }, timeoutMs);
      connection.pending.set(id, {
        timer,
        resolve: (decision) => {
          cleanup();
          resolve(decision);
        },
        reject: (error) => {
          cleanup();
          reject(error);
        },
      });
      signal.addEventListener("abort", abort, { once: true });
      try {
        connection.port.postMessage({ type: "hook", id, mode, context });
      } catch (error) {
        clearTimeout(timer);
        connection.pending.delete(id);
        cleanup();
        reject(error instanceof Error ? error : new Error("插件传输失败"));
      }
    });
  }
}

export class HookPipeline {
  private readonly plugins: ReturnType<PluginConnections["snapshot"]>;
  constructor(
    private readonly connections: PluginConnections | undefined,
    private readonly record: (record: HookRecord) => void,
  ) {
    this.plugins = connections?.snapshot() ?? [];
  }

  /** 同一阶段串行执行；mutate失败即阻断，observe失败只禁用该连接并留下事实。 */
  /**
   * 串行执行一个阶段并返回唯一有效上下文。observe失败降级，mutate失败阻断；
   * 调用者仍负责对有效参数重新做业务校验、审批和持久化。
   */
  async execute<T extends HookContext>(context: T, signal: AbortSignal): Promise<{ context: T; systemInstructions?: string }> {
    const started = Date.now();
    let current: HookContext = HookContext.parse(context);
    let systemInstructions: string | undefined;
    for (const plugin of this.plugins) {
      const remaining = 10000 - (Date.now() - started);
      if (remaining <= 0) throw new HookPipelineError("plugin_hook_failed", "插件阶段累计超过10秒");
      const hook = plugin.descriptor.hooks.find((candidate) => candidate.stage === current.stage);
      if (!hook || plugin.disabled) continue;
      const inputDigest = digest(current);
      try {
        const decision = await (this.connections
          ? this.connections.request(plugin, hook.mode, current, signal, Math.min(3000, remaining))
          : Promise.resolve({ action: "continue" } as HookDecision));
        if (Date.now() - started > 10000)
          throw new HookPipelineError("plugin_hook_failed", "插件阶段累计超过10秒");
        if (decision.action === "deny") {
          this.record({ pluginId: plugin.descriptor.id, pluginName: plugin.descriptor.name, stage: current.stage, outcome: "denied", changedFields: [], inputDigest, code: decision.code });
          throw new HookPipelineError("plugin_denied", `插件 ${plugin.descriptor.name} 拒绝执行：${decision.message}`);
        }
        if (decision.patch) {
          const fields = Object.keys(decision.patch).filter((field) => field !== "stage");
          const applied = applyPatch(current, decision.patch);
          current = HookContext.parse(applied.context);
          systemInstructions = applied.systemInstructions ?? systemInstructions;
          this.record({ pluginId: plugin.descriptor.id, pluginName: plugin.descriptor.name, stage: current.stage, outcome: "modified", changedFields: fields, inputDigest, outputDigest: digest(current) });
        }
      } catch (error) {
        if (error instanceof HookPipelineError && error.code === "plugin_denied") throw error;
        this.connections?.disable(
          plugin,
          error instanceof Error ? error : new Error("插件Hook失败"),
          hook.mode === "observe" ? "disabled" : "failed",
        );
        this.record({ pluginId: plugin.descriptor.id, pluginName: plugin.descriptor.name, stage: current.stage, outcome: hook.mode === "observe" ? "disabled" : "failed", changedFields: [], inputDigest, code: "plugin_hook_failed" });
        if (hook.mode === "mutate")
          throw new HookPipelineError(
            "plugin_hook_failed",
            error instanceof Error ? error.message : "插件Hook失败",
          );
      }
    }
    return { context: current as T, systemInstructions };
  }
}

function applyPatch(context: HookContext, patch: HookPatch): { context: HookContext; systemInstructions?: string } {
  if (context.stage !== patch.stage) throw new Error("Hook patch阶段不一致");
  switch (patch.stage) {
    case "run.before":
      return { context: HookContext.parse({ ...context, ...(patch.input === undefined ? {} : { input: patch.input }) }), systemInstructions: patch.systemInstructions };
    case "model.before":
      return { context: HookContext.parse({ ...context, ...(patch.messages ? { messages: patch.messages } : {}), ...(patch.maxTokens ? { maxTokens: patch.maxTokens } : {}) }) };
    case "model.after":
      if (
        patch.calls &&
        (patch.calls.length !== (context as Extract<HookContext, { stage: "model.after" }>).calls.length ||
          patch.calls.some(
            (call, index) =>
              call.id !== (context as Extract<HookContext, { stage: "model.after" }>).calls[index]?.id,
          ))
      )
        throw new Error("model.after不能新增、删除、重排或替换工具调用ID");
      return { context: HookContext.parse({ ...context, ...(patch.text === undefined ? {} : { text: patch.text }), ...(patch.calls ? { calls: patch.calls } : {}) }) };
    case "tool.before":
      return { context: HookContext.parse({ ...context, call: { ...(context as Extract<HookContext, { stage: "tool.before" }>).call, ...(patch.arguments === undefined ? {} : { arguments: patch.arguments }) } }) };
    case "tool.after":
      return { context: HookContext.parse({ ...context, ...(patch.result === undefined ? {} : { result: patch.result }) }) };
    case "run.after":
      return { context: HookContext.parse({ ...context, reply: (patch.reply ?? (context as Extract<HookContext, { stage: "run.after" }>).reply) + (patch.append ?? "") }) };
  }
}
