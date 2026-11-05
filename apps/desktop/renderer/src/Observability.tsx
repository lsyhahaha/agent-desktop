import { useEffect, useState } from "react";
import { CopyText } from "./MarkdownReply";
import {
  acceptanceResult,
  isEvidenceRecord,
  verificationCommands,
  verificationResult,
  type TimelineItem,
  type ChatCommand,
  type ChatSnapshot,
} from "@protocol";

/** 不可信参数按文本和已知字段呈现；原始JSON仅在用户展开后挂载。 */
export function ToolDetail({
  item,
}: {
  item: Extract<TimelineItem, { type: "tool" }>;
}) {
  const [open, setOpen] = useState(false);
  let args: Record<string, unknown> = {};
  try {
    const value = JSON.parse(item.data.arguments);
    if (value && typeof value === "object" && !Array.isArray(value))
      args = value;
  } catch {
    /* 历史非法参数保留原文。 */
  }
  const text = (key: string) =>
    typeof args[key] === "string" ? String(args[key]) : "—";
  const data = item.data;
  return (
    <>
      {data.failureStage && (
        <p className="error">
          {data.failureStage === "validation"
            ? "启动前校验失败"
            : data.failureStage === "approval"
              ? "授权阶段未完成"
              : "实际操作阶段失败"}{" "}
          · {data.errorCode ?? "原因未确认"}
          。请核对参数、权限及已有结果；不会自动重跑。
          {data.failureStage === "execution" &&
            "操作可能已产生影响，未自动回滚。"}
        </p>
      )}
      <button aria-expanded={open} onClick={() => setOpen(!open)}>
        {open ? "收起" : "展开"} 参数与执行结果
      </button>
      {open && (
        <div className="timeline-detail">
          <dl className="observation-fields">
            <dt>工具</dt>
            <dd>{data.name}</dd>
            <dt>{args.command ? "命令" : "对象"}</dt>
            <dd>
              <pre>{args.command ? text("command") : text("path")}</pre>
              {!!args.command && <CopyText text={text("command")} label="复制完整命令" />}
            </dd>
            <dt>工作目录</dt>
            <dd>{data.cwd ?? text("path")}</dd>
            <dt>执行环境</dt>
            <dd>
              {data.environment === "host"
                ? "宿主权限"
                : data.environment === "workspace"
                  ? "工作区范围"
                  : "未记录"}
            </dd>
            <dt>授权</dt>
            <dd>
              {data.authorization
                ? {
                    workspace: "工作区策略允许",
                    full: "完全访问",
                    review: "独立审查批准",
                    user: "用户批准",
                    denied: "用户拒绝，未执行",
                  }[data.authorization]
                : "未记录"}
            </dd>
            <dt>执行结果</dt>
            <dd>
              {data.executionStatus ?? item.status} · 退出码{" "}
              {data.exitCode ?? "—"} · 信号 {data.signal ?? "—"}
            </dd>
            <dt>实际执行耗时</dt>
            <dd>
              {data.startedAt !== undefined && data.endedAt !== undefined
                ? `${((data.endedAt - data.startedAt) / 1000).toFixed(1)}s`
                : "未确认完整起止时间"}
            </dd>
            <dt>权限等待</dt>
            <dd>
              {data.approvalStartedAt !== undefined &&
              data.approvalEndedAt !== undefined
                ? `${((data.approvalEndedAt - data.approvalStartedAt) / 1000).toFixed(1)}s`
                : "无已记录等待区间"}
            </dd>
          </dl>
          <pre>{(data.output ?? data.result) || "（暂无输出）"}</pre>
          {data.truncated && (
            <p className="error">输出达到上限并终止命令；结果不完整。</p>
          )}
          <details>
            <summary>原始参数</summary>
            <pre>{data.arguments}</pre>
          </details>
        </div>
      )}
    </>
  );
}
/** 仅展示原始计数与有据可查的区间，不把Token或命令通过率包装成任务质量。 */
export function RunMetrics({
  items,
  audits,
}: {
  items: TimelineItem[];
  audits?: ChatSnapshot["tools"];
}) {
  const checks = verificationCommands(items);
  const tools = items.filter(
    (i): i is Extract<TimelineItem, { type: "tool" }> =>
      i.type === "tool" &&
      !["write_stdin", "stop_process"].includes(i.data.name),
  );
  const models = items.filter(
    (i): i is Extract<TimelineItem, { type: "model" }> => i.type === "model",
  );
  const reviews = items.filter(
    (i): i is Extract<TimelineItem, { type: "approval_review" }> =>
      i.type === "approval_review",
  );
  const usage = (list: typeof models) =>
    `${list.reduce((n, i) => n + (i.data.input ?? 0), 0)}/${list.reduce((n, i) => n + (i.data.output ?? 0), 0)} tokens${list.some((i) => i.data.input === undefined || i.data.output === undefined) ? " · 用量不完整" : ""}`;
  return (
    <details className="run-metrics">
      <summary>本轮执行统计与用量</summary>
      {items.some(
        (i) =>
          i.type === "tool" && i.data.errorCode === "tool_budget_exhausted",
      ) && (
        <p>
          工具预算未接纳：
          {
            items.filter(
              (i) =>
                i.type === "tool" &&
                i.data.errorCode === "tool_budget_exhausted",
            ).length
          }
          次，均未执行。
        </p>
      )}
      {audits && (
        <p>
          已接纳工具调用（含轮询/控制）：{audits.length}次 · 成功{" "}
          {audits.filter((t) => t.state === "success").length} · 失败{" "}
          {audits.filter((t) => t.state === "error").length} · 拒绝{" "}
          {audits.filter((t) => t.state === "denied").length} · 其余状态{" "}
          {
            audits.filter(
              (t) => !["success", "error", "denied"].includes(t.state),
            ).length
          }
        </p>
      )}
      <p>
        非轮询工具记录：{tools.length} · 完成{" "}
        {tools.filter((i) => i.status === "completed").length} · 失败{" "}
        {tools.filter((i) => i.status === "failed").length} · 拒绝/跳过{" "}
        {tools.filter((i) => i.status === "skipped").length} · 其他/未确认{" "}
        {
          tools.filter(
            (i) => !["completed", "failed", "skipped"].includes(i.status),
          ).length
        }
      </p>
      <p>
        验证命令：
        {checks.filter((i) => verificationResult(i) === "passed").length}通过 /{" "}
        {checks.filter((i) => verificationResult(i) === "failed").length}失败 /{" "}
        {checks.filter((i) => verificationResult(i) === "unknown").length}未确认
      </p>
      <p>
        主模型：{usage(models.filter((i) => !i.data.childId))}；子模型：
        {usage(models.filter((i) => !!i.data.childId))}
      </p>
      <p>
        审批模型：{reviews.reduce((n, i) => n + (i.data.inputTokens ?? 0), 0)}/
        {reviews.reduce((n, i) => n + (i.data.outputTokens ?? 0), 0)} tokens{" "}
        {reviews.some((i) => i.data.inputTokens === undefined)
          ? "· 用量不完整"
          : ""}
      </p>
      <small>
        统计仅覆盖本轮已记录事实，不是完整账单或任务正确率。并行步骤耗时不相加。
      </small>
    </details>
  );
}

/** 证据跳转只定位已经挂载的本轮记录；先展开祖先详情，再聚焦，不获取任意路径。 */
function locate(id: string) {
  const node = document.getElementById(`evidence-${id}`);
  if (!node) return;
  let parent = node.parentElement;
  while (parent) {
    if (parent instanceof HTMLDetailsElement) parent.open = true;
    parent = parent.parentElement;
  }
  node.scrollIntoView({ block: "center", behavior: "auto" });
  node.focus({ preventScroll: true });
}
/** 修订与证据只在Runtime确认保存后更新；失败保留编辑内容，历史操作也校验Run归属。 */
export function AcceptancePanel({
  items,
  sessionId,
  runId,
  editable,
  onEdit,
}: {
  items: TimelineItem[];
  sessionId?: string;
  runId?: string;
  editable: boolean;
  onEdit?: (cmd: ChatCommand) => Promise<boolean>;
}) {
  const item = items.find(
    (i): i is Extract<TimelineItem, { type: "acceptance" }> =>
      i.type === "acceptance",
  );
  const current = item?.data.revisions.at(-1);
  const [editing, setEditing] = useState(false);
  const [conditions, setConditions] = useState(current?.conditions ?? []);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [linkCondition, setLinkCondition] = useState("");
  const [linkItem, setLinkItem] = useState("");
  const [explanation, setExplanation] = useState("");
  const candidates = items.filter(isEvidenceRecord);
  async function save(link = false) {
    if (!sessionId || !runId || !onEdit || !editable || pending) return;
    setPending(true);
    setError("");
    try {
      const ok = await onEdit({
        type: "edit_acceptance",
        sessionId,
        runId,
        expectedRevision: item?.data.revision ?? 0,
        ...(link
          ? {
              link: {
                conditionId: linkCondition,
                itemId: linkItem,
                explanation,
              },
            }
          : { conditions }),
      });
      if (ok) setEditing(false);
      else setError("未能保存，请核对最新记录或修订上限；编辑内容仍保留。");
    } catch {
      setError("保存未确认，请核对连接与存储。");
    } finally {
      setPending(false);
    }
  }
  return (
    <section className="acceptance-panel" aria-label="验收条件与证据">
      <h4>验收条件与证据</h4>
      <p className="muted">
        {current
          ? `${current.source === "agent" ? "Agent提出" : "用户修订"} · 第${current.revision}版；关联检查结果不等于业务验收。`
          : "尚未明确验收条件"}
      </p>
      {current && (
        <p>
          验收条件：{current.conditions.length}项 · 当前版本关联检查通过{" "}
          {
            current.conditions.filter((c) => {
              const links = item!.data.links.filter(
                (l) =>
                  l.conditionId === c.id &&
                  l.conditionRevision === current.revision,
              );
              return (
                links.length > 0 &&
                links.every((l) => {
                  const fact = acceptanceResult(items, l.itemId);
                  return fact.result === "passed" && fact.version === "current";
                })
              );
            }).length
          }
          项；其余请查看失败、未覆盖或版本限制。外部修改未核对。
        </p>
      )}
      {current?.conditions.map((c) => {
        const links = item!.data.links.filter(
          (l) =>
            l.conditionId === c.id && l.conditionRevision === current.revision,
        );
        return (
          <div className="acceptance-condition" key={c.id}>
            <strong>{c.text}</strong>
            {!links.length && <p>未覆盖</p>}
            {links.map((l, index) => {
              const fact = acceptanceResult(items, l.itemId);
              return (
                <p key={`${l.itemId}-${index}`}>
                  {fact.version === "stale"
                    ? "适用于修改前版本"
                    : fact.result === "failed"
                      ? "关联检查失败"
                      : fact.version === "unknown"
                        ? "结果或版本未确认"
                        : fact.result === "passed"
                          ? "关联检查通过"
                          : "结果未确认"}{" "}
                  · {l.source === "agent" ? "Agent关联" : "用户关联"}：
                  {l.explanation}{" "}
                  <button onClick={() => locate(l.itemId)}>查看执行证据</button>
                </p>
              );
            })}
          </div>
        );
      })}
      <button
        disabled={
          !editable || pending || (item?.data.revisions.length ?? 0) >= 24
        }
        onClick={() => setEditing(!editing)}
      >
        {editing ? "关闭编辑" : "编辑验收条件"}
      </button>
      {!editable && <small>运行期间或连接/保存异常时不能编辑。</small>}
      {editing && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <p>修改后旧证据保留为历史，新版本需要重新关联。最多12项、24版。</p>
          {conditions.map((c, index) => (
            <div key={c.id}>
              <label htmlFor={`condition-${c.id}`}>条件{index + 1}</label>
              <textarea
                id={`condition-${c.id}`}
                maxLength={500}
                required
                value={c.text}
                onChange={(e) =>
                  setConditions(
                    conditions.map((v) =>
                      v.id === c.id ? { ...v, text: e.target.value } : v,
                    ),
                  )
                }
              />
              <button
                type="button"
                onClick={() =>
                  setConditions(conditions.filter((v) => v.id !== c.id))
                }
              >
                移除
              </button>
            </div>
          ))}
          <button
            type="button"
            disabled={conditions.length >= 12}
            onClick={() =>
              setConditions([
                ...conditions,
                { id: crypto.randomUUID(), text: "" },
              ])
            }
          >
            补充条件
          </button>
          <button disabled={pending || conditions.some((c) => !c.text.trim())}>
            保存条件
          </button>
        </form>
      )}
      {!!current?.conditions.length && (
        <details>
          <summary>关联已有执行证据</summary>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void save(true);
            }}
          >
            <label>
              验收条件
              <select
                required
                value={linkCondition}
                onChange={(e) => setLinkCondition(e.target.value)}
              >
                <option value="">请选择</option>
                {current.conditions.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.text}
                  </option>
                ))}
              </select>
            </label>
            <label>
              执行记录
              <select
                required
                value={linkItem}
                onChange={(e) => setLinkItem(e.target.value)}
              >
                <option value="">请选择</option>
                {candidates.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.summary}
                  </option>
                ))}
              </select>
            </label>
            <label>
              支持范围与限制
              <textarea
                required
                maxLength={500}
                value={explanation}
                onChange={(e) => setExplanation(e.target.value)}
              />
            </label>
            <button
              disabled={
                !editable ||
                pending ||
                !linkItem ||
                !linkCondition ||
                !explanation.trim() ||
                item!.data.links.length >= 48
              }
            >
              保存关联
            </button>
          </form>
        </details>
      )}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {item && (
        <details>
          <summary>
            条件修订与旧证据（{item.data.revisions.length}版 /{" "}
            {item.data.links.length}条关联）
          </summary>
          <pre>{JSON.stringify(item.data, null, 2)}</pre>
        </details>
      )}
    </section>
  );
}

/** 每个活跃轮次共用一个低频时钟；只解释最近事实更新时间，不据此判定卡死。 */
export function ProgressClock({ items }: { items: TimelineItem[] }) {
  const active = items.some(
    (i) => i.status === "running" && !["plan", "acceptance"].includes(i.type),
  );
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active]);
  const at = Math.max(0, ...items.map((i) => i.updatedAt));
  return active ? (
    <small aria-hidden="true">
      距离最近执行进展 {Math.max(0, Math.floor((now - at) / 1000))}{" "}
      秒；暂未收到新进展不代表卡死。
    </small>
  ) : null;
}
