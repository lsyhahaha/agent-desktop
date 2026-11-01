import type { TimelineItem } from "./timeline";

type Tool = Extract<TimelineItem, { type: "tool" }>;
/** 统计只认原始exec与真实进程终态；轮询/停止保留审计，不重复结算命令。 */
export function verificationResult(
  item: TimelineItem,
): "passed" | "failed" | "unknown" {
  if (item.type === "tool") {
    if (item.data.name === "exec_command") {
      if (item.data.truncated || !item.data.executionId) return "unknown";
      if (item.data.executionStatus === "exited")
        return item.data.exitCode === 0 ? "passed" : "failed";
      return ["timed_out", "output_limit", "spawn_failed"].includes(
        item.data.executionStatus ?? "",
      )
        ? "failed"
        : "unknown";
    }
    if (["write_stdin", "stop_process"].includes(item.data.name))
      return "unknown";
    return item.status === "completed"
      ? "passed"
      : item.status === "failed"
        ? "failed"
        : "unknown";
  }
  if (item.type === "file_change")
    return item.data.outcome === "applied"
      ? "passed"
      : item.data.outcome === "conflict"
        ? "failed"
        : "unknown";
  return "unknown";
}
/** 原命令与控制调用共享executionId；缺身份的未启动命令仍保留，不能丢掉失败。 */
export function verificationCommands(items: TimelineItem[]): Tool[] {
  const seen = new Set<string>();
  return items.filter((item): item is Tool => {
    if (
      item.type !== "tool" ||
      item.data.name !== "exec_command" ||
      item.data.kind !== "verification"
    )
      return false;
    const key = item.data.executionId ?? item.id;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
/** 验收支持状态由原始事实派生；Agent只能关联，不能覆盖事实或版本限制。 */
export function acceptanceResult(items: TimelineItem[], itemId: string) {
  const item = items.find((i) => i.id === itemId);
  if (!item) return { result: "unknown" as const, version: "unknown" as const };
  const summary = items.find((i) => i.type === "summary");
  const revision = items.filter(
    (i) => i.type === "file_change" && i.data.outcome === "applied",
  ).length;
  const recorded =
    item.type === "tool" || item.type === "file_change"
      ? item.data.workspaceRevision
      : undefined;
  const shell = items.some(
    (i) =>
      i.type === "tool" &&
      i.data.name === "exec_command" &&
      i.data.startedAt !== undefined,
  );
  const version =
    recorded === undefined
      ? "unknown"
      : recorded !== revision
        ? "stale"
        : shell ||
            (summary?.type === "summary" && summary.data.versionUnconfirmed)
          ? "unknown"
          : "current";
  return {
    result: verificationResult(item),
    version: version as "unknown" | "stale" | "current",
  };
}
/** 顶栏只投影已收到的事实；不推断卡死，不输出虚假进度。 */
export function currentActivity(items: TimelineItem[]): string {
  const active = items.filter(
    (i) =>
      i.status === "running" &&
      !["plan", "acceptance", "message"].includes(i.type),
  );
  const main =
    active.find((i) => i.type === "tool" || i.type === "file_change") ??
    active.find((i) => i.type === "approval_review") ??
    active.at(-1);
  return main
    ? `${main.summary}${active.length > 1 ? ` · 另有${active.length - 1}项进行中` : ""}`
    : "任务已接纳，等待执行进展";
}

/** 只允许实际文件/命令/读取记录作为证据；计划、验收元数据及生命周期控制不是验收依据。 */
export function isEvidenceRecord(item: TimelineItem): boolean {
  return (
    !["running", "pending"].includes(item.status) &&
    (item.type === "file_change" ||
      (item.type === "tool" &&
        ["read_file", "list_directory", "exec_command"].includes(
          item.data.name,
        )))
  );
}
