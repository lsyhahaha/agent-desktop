import { prepareTool } from "./tools";
import { HookPipeline } from "./hook-pipeline";

export type DispatchCall = { id: string; function: { name: string; arguments: string } };

/**
 * 工具分派的稳定seam：冻结调用身份，统一执行工具前后中间件，并复用唯一注册表。
 * 它不拥有审批或执行事实；Agent仍负责状态机，调用者必须在before之后重新校验和审批。
 */
export class ToolDispatcher {
  constructor(
    private readonly hooks: HookPipeline,
    private readonly runId: string,
    private readonly signal: AbortSignal,
  ) {}

  async before(call: DispatchCall): Promise<DispatchCall> {
    const result = await this.hooks.execute(
      {
        stage: "tool.before",
        runId: this.runId,
        call: { id: call.id, name: call.function.name, arguments: call.function.arguments },
      },
      this.signal,
    );
    return {
      id: result.context.call.id,
      function: { name: result.context.call.name, arguments: result.context.call.arguments },
    };
  }

  /** 只有注册表工具使用本入口；交互型工具仍由Run状态机结算。 */
  prepare(call: DispatchCall) {
    return prepareTool(call.function.name, call.function.arguments);
  }

  async after(
    call: DispatchCall,
    result: string,
    state: "success" | "error" | "denied",
  ) {
    return (
      await this.hooks.execute(
        {
          stage: "tool.after",
          runId: this.runId,
          call: { id: call.id, name: call.function.name, arguments: call.function.arguments },
          result,
          state,
        },
        this.signal,
      )
    ).context.result;
  }
}
