import type { ChatSnapshot } from "@protocol";
const labels = {
  waiting: "等待授权",
  running: "执行中",
  success: "执行成功",
  denied: "已拒绝",
  error: "执行失败",
  cancelled: "已取消",
  interrupted: "已中断",
  unknown: "结果未确认",
};
/** 当前轮与历史轮复用同一工具视图；历史execution_id只展示，不提供恢复或重跑入口。 */
export function ToolRecords({ tools, runId }: { tools: ChatSnapshot["tools"]; runId?: string }) {
  return (
    <section className="tool-list" aria-label="工具执行记录">
      <header>
        <span>▤</span> 工具执行记录{" "}
        <span className="muted">{tools.length} / 12</span>
      </header>
      {tools.map((tool) => (
        <div className="tool-item" key={tool.id}>
          <div data-minimap-id={`${runId}-${tool.id}-call`} data-minimap-round={runId} data-minimap-kind="tool" data-minimap-label={`工具调用 · ${tool.name}`}
            data-minimap-preview={`${tool.name} · ${labels[tool.state]}\n${tool.path}`.slice(0, 1200)}>
            <code>{tool.name}</code>
            <span className={"tool-state " + tool.state}>
              {labels[tool.state]}
            </span>
          </div>
          <p>{tool.path || "参数未通过校验"}</p>
          {tool.detail && <small data-minimap-id={`${runId}-${tool.id}-result`} data-minimap-round={runId} data-minimap-kind="result" data-minimap-label={`工具结果 · ${tool.name}`}>{tool.detail}</small>}
          {tool.execution && (
            <details open={tool.execution.status === "running"}
              data-minimap-id={`${runId}-${tool.id}-output`} data-minimap-round={runId} data-minimap-kind="result" data-minimap-label={`命令输出 · ${tool.name}`}
              data-minimap-preview={tool.execution.output.slice(0, 1200)}>
              <summary>
                命令输出 · {tool.execution.status} · 退出码{" "}
                {tool.execution.exit_code ?? "—"}
              </summary>
              <pre className="command-output">
                {tool.execution.output || "（暂无输出）"}
                {tool.execution.truncated ? "\n[输出达到上限，命令已终止]" : ""}
              </pre>
            </details>
          )}
        </div>
      ))}
    </section>
  );
}
