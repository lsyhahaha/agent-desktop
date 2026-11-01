import { memo, useState, type ReactNode } from "react";
import type { ChatSnapshot, TimelineItem } from "@protocol";
import {
  AcceptancePanel,
  ToolDetail,
  RunMetrics,
  ProgressClock,
} from "./Observability";
import type { ChatCommand } from "@protocol";
import { MarkdownReply } from "./MarkdownReply";

const states = {
  pending: "待执行",
  running: "进行中",
  completed: "已完成",
  failed: "失败",
  skipped: "已跳过",
  cancelled: "已取消",
  interrupted: "已中断",
  unknown: "结果未确认",
};
const icons: Record<TimelineItem["type"], string> = {
  acceptance: "M7 5h10M7 10h10M7 15h10M3 5h1M3 10h1M3 15h1",
  approval_review: "M10 2 17 5v5c0 4-7 8-7 8s-7-4-7-8V5z",
  model: "M4 4h12v12H4z M7 7h6v6H7z",
  message: "M3 4h14v10H7l-4 3z",
  plan: "M7 5h10M7 10h10M7 15h10M3 5h1M3 10h1M3 15h1",
  tool: "m4 5 5 5-5 5M11 15h5",
  file_change: "M5 2h7l4 4v12H5zM8 10h5M8 13h5",
  interaction: "M3 3h14v11H9l-5 4v-4H3z",
  error: "m10 2 8 15H2zM10 7v4M10 14v1",
  summary: "m4 10 4 4 8-9",
  mcp: "M3 10h14M6 6l-4 4 4 4M14 6l4 4-4 4",
};
/** 长详情只在展开时挂载；不把折叠历史输出预先铺进DOM。 */
function Disclosure({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="timeline-disclosure">
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)}>
        {open ? "收起" : "展开"} {label}
      </button>
      {open && <div className="timeline-detail">{children}</div>}
    </div>
  );
}
function Detail({ item }: { item: TimelineItem }) {
  switch (item.type) {
    case "acceptance":
      return null;
    case "approval_review":
      return (
        <>
          <p>
            {item.data.tool} · {item.data.reason}
          </p>
          <small>
            本次参数摘要：{item.data.digest.slice(0, 16)}
            {item.data.inputTokens !== undefined
              ? ` · 审查用量 ${item.data.inputTokens}/${item.data.outputTokens}`
              : ""}
          </small>
        </>
      );
    case "message":
      return (
        <div className="timeline-prose">
          <MarkdownReply text={item.data.text} />
        </div>
      );
    case "model":
      return (
        <p>
          {item.data.model} · 第{item.data.attempt}次请求
          {item.data.strategyId && (
            <span title={item.data.strategyDigest}>
              {" "}
              · 读取策略{" "}
              {(
                {
                  "baseline-v1": "当前基线v1",
                  "evidence-first-v1": "证据优先v1",
                  "module-batch-v1": "模块批读v1",
                } as Record<string, string>
              )[item.data.strategyId] ?? item.data.strategyId}
            </span>
          )}
          {item.data.input !== undefined
            ? ` · 输入 ${item.data.input} / 输出 ${item.data.output} tokens`
            : ""}
        </p>
      );
    case "plan":
      return (
        <>
          <ol className="timeline-plan">
            {item.data.revisions.at(-1)?.steps.map((step, index) => (
              <li key={index}>
                <span>{states[step.status]}</span> {step.step}
              </li>
            ))}
          </ol>
          <small>计划由 Agent 更新，不代表工具执行证据。</small>
          {item.data.revisions.length > 1 && (
            <Disclosure label="计划修订">
              <pre>{JSON.stringify(item.data.revisions, null, 2)}</pre>
            </Disclosure>
          )}
        </>
      );
    case "file_change":
      return (
        <>
          <p>
            {item.data.path} ·{" "}
            {
              {
                proposed: "待审批",
                applying: "正在应用",
                applied: "已应用",
                conflict: "版本冲突",
                unknown: "结果未确认",
                not_applied: "未应用",
              }[item.data.outcome]
            }
          </p>
          <Disclosure label="文件前后对照">
            <div className="file-comparison">
              <section>
                <h4>修改前</h4>
                <pre>{item.data.before}</pre>
              </section>
              <section>
                <h4>修改后</h4>
                <pre>{item.data.after}</pre>
              </section>
            </div>
            <small>基线 SHA-256：{item.data.baseHash}</small>
          </Disclosure>
        </>
      );
    case "tool":
      return <ToolDetail item={item} />;
    case "interaction":
      return (
        <>
          <p>{item.data.question}</p>
          {item.data.answer && <p>回答：{item.data.answer}</p>}
          {item.data.decision && (
            <small>
              {
                { allowed: "已批准", denied: "已拒绝", expired: "交互已失效" }[
                  item.data.decision
                ]
              }
            </small>
          )}
        </>
      );
    case "error":
      return (
        <p className="error">
          {item.data.message}（{item.data.code}）
        </p>
      );
    case "summary":
      return (
        <>
          <p>{item.data.result}</p>
          <p>
            已确认结构化修改：
            {item.data.files.length
              ? item.data.files.join("、")
              : "无已确认修改"}
          </p>
          <p className="muted">
            Shell及外部修改未全面核对；命令通过不代表任务目标达成。
          </p>
          <p>
            命令：{item.data.commands} ·{" "}
            {item.data.verificationPassed +
            item.data.verificationFailed +
            item.data.verificationUnknown
              ? `验证命令：${item.data.verificationPassed} 通过 / ${item.data.verificationFailed} 失败 / ${item.data.verificationUnknown} 未确认`
              : "未验证"}
          </p>
        </>
      );
    case "mcp":
      return (
        <Disclosure label="外部工具结果">
          <pre>{item.data.result}</pre>
        </Disclosure>
      );
  }
}
/** 交互表单绑定唯一交互身份；历史记录没有可执行按钮。 */
function Interaction({
  interaction,
  onReply,
}: {
  interaction: NonNullable<ChatSnapshot["interaction"]>;
  onReply: (value: boolean | string) => Promise<boolean>;
}) {
  const [answer, setAnswer] = useState("");
  const [pending, setPending] = useState(false);
  async function submit(value: boolean | string) {
    if (pending) return;
    setPending(true);
    try {
      await onReply(value);
    } finally {
      setPending(false);
    }
  }
  if (interaction.kind === "input")
    return (
      <form
        className="timeline-interaction"
        onSubmit={(e) => {
          e.preventDefault();
          if (answer.trim()) void submit(answer.trim());
        }}
      >
        <label htmlFor={`answer-${interaction.id}`}>你的回答</label>
        {interaction.options?.length ? (
          <div className="timeline-options">
            {interaction.options.map((option) => (
              <button
                key={option}
                type="button"
                disabled={pending}
                aria-pressed={answer === option}
                onClick={() => setAnswer(option)}
              >
                {option}
              </button>
            ))}
          </div>
        ) : null}
        <textarea
          id={`answer-${interaction.id}`}
          maxLength={4000}
          value={answer}
          onChange={(e) => setAnswer(e.target.value)}
          rows={3}
        />
        <button className="primary" disabled={pending || !answer.trim()}>
          {pending ? "提交中…" : "提交回答并继续"}
        </button>
      </form>
    );
  return (
    <div className="timeline-interaction">
      <p>
        {interaction.kind === "edit_file"
          ? "批准将替换以上文件内容，请先展开文件前后对照审阅。仅修改该文件；冲突会阻止写入。"
          : interaction.kind === "read_file"
            ? "文件内容会发送到 DeepSeek 并保存在本机；本次仅允许读取所示路径，最多32KiB。"
            : "批准仅允许执行本次命令或输入，仍受该轮权限与沙箱限制；仅显式申请边界外权限的操作可使用宿主文件与网络。输出会发送到 DeepSeek 并保存在本机。"}
      </p>
      <div className="approval-actions">
        <button disabled={pending} onClick={() => void submit(false)}>
          拒绝
        </button>
        <button
          className="primary"
          disabled={pending}
          onClick={() => void submit(true)}
        >
          允许本次操作
        </button>
      </div>
    </div>
  );
}
const Item = memo(function Item({
  item,
  interaction,
  onReply,
}: {
  item: TimelineItem;
  interaction: ChatSnapshot["interaction"];
  onReply: (value: boolean | string) => Promise<boolean>;
}) {
  const current = interaction?.itemId === item.id ? interaction : null;
  return (
    <li
      id={`evidence-${item.id}`}
      tabIndex={-1}
      className={`timeline-item ${item.status} type-${item.type}`}
      data-minimap-id={item.id}
      data-minimap-round={item.runId}
      data-minimap-kind={item.type === "message" ? "assistant" : "tool"}
      data-minimap-label={item.summary}
    >
      <span className="timeline-icon" aria-hidden="true">
        <svg
          viewBox="0 0 20 20"
          width="18"
          height="18"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path
            d={item.status === "completed" ? "m4 10 4 4 8-9" : icons[item.type]}
          />
        </svg>
      </span>
      <div className="timeline-body">
        <div className="timeline-heading">
          <strong>{item.summary}</strong>
          <span>{states[item.status]}</span>
          {item.endedAt !== null && (
            <time>{((item.endedAt - item.createdAt) / 1000).toFixed(1)}s</time>
          )}
        </div>
        <Detail item={item} />
        {current && (
          <Interaction
            key={current.id}
            interaction={current}
            onReply={onReply}
          />
        )}
      </div>
    </li>
  );
});
/** 顺序与终态完全来自Runtime；运行中节点不会因折叠详情而消失。 */
export function ExecutionTimeline({
  items,
  interaction,
  onReply,
  sessionId,
  runId,
  editable = false,
  onEdit,
  tools,
}: {
  items: TimelineItem[];
  tools?: ChatSnapshot["tools"];
  interaction: ChatSnapshot["interaction"];
  onReply: (value: boolean | string) => Promise<boolean>;
  sessionId?: string;
  runId?: string;
  editable?: boolean;
  onEdit?: (command: ChatCommand) => Promise<boolean>;
}) {
  return (
    <section className="execution-timeline" aria-label="Agent 执行时间线">
      <ProgressClock items={items} />
      <ol>
        {timelineGroups(items).map((group) => {
          const item = group[0];
          if (item.type === "model" && item.data.parentItemId) return null;
          if (
            item.type === "tool" &&
            ["write_stdin", "stop_process"].includes(item.data.name) &&
            item.data.executionId &&
            items.some(
              (i) =>
                i.type === "tool" &&
                i.data.name === "exec_command" &&
                i.data.executionId === item.data.executionId,
            )
          )
            return null;
          const children = items.filter(
            (i) => i.type === "model" && i.data.parentItemId === item.id,
          );
          const controls =
            item.type === "tool" &&
            item.data.name === "exec_command" &&
            item.data.executionId
              ? items.filter(
                  (i) =>
                    i.type === "tool" &&
                    ["write_stdin", "stop_process"].includes(i.data.name) &&
                    i.data.executionId === item.data.executionId,
                )
              : [];
          return (
            <li key={item.id} className="timeline-group">
              {group.length > 1 ? (
                <details>
                  <summary>{group.length}次已完成读取</summary>
                  <ol>
                    {group.map((read) => (
                      <Item
                        key={read.id}
                        item={read}
                        interaction={null}
                        onReply={onReply}
                      />
                    ))}
                  </ol>
                </details>
              ) : (
                <ol>
                  <Item
                    item={item}
                    interaction={interaction}
                    onReply={onReply}
                  />
                </ol>
              )}
              {!!children.length && (
                <section aria-label="并行子分析">
                  <small>属于以上步骤的子分析</small>
                  <ol>
                    {children.map((child) => (
                      <Item
                        key={child.id}
                        item={child}
                        interaction={null}
                        onReply={onReply}
                      />
                    ))}
                  </ol>
                </section>
              )}
              {!!controls.length && (
                <details>
                  <summary>{controls.length}次轮询/停止调用审计</summary>
                  <ol>
                    {controls.map((control) => (
                      <Item
                        key={control.id}
                        item={control}
                        interaction={null}
                        onReply={onReply}
                      />
                    ))}
                  </ol>
                </details>
              )}
            </li>
          );
        })}
      </ol>
      <RunMetrics items={items} audits={tools} />
      <AcceptancePanel
        key={`${runId}-${items.find((i) => i.type === "acceptance")?.updatedAt ?? 0}`}
        items={items}
        sessionId={sessionId}
        runId={runId}
        editable={editable}
        onEdit={onEdit}
      />
    </section>
  );
}

/** 只压缩连续读取；错误/审批/修改保持原位置，命令控制审计仍可展开。 */
function timelineGroups(items: TimelineItem[]): TimelineItem[][] {
  const groups: TimelineItem[][] = [];
  for (const item of items) {
    if (item.type === "acceptance") continue;
    const previous = groups.at(-1);
    if (
      item.type === "tool" &&
      item.data.name === "read_file" &&
      item.status === "completed" &&
      previous?.every(
        (i) =>
          i.type === "tool" &&
          i.data.name === "read_file" &&
          i.status === "completed",
      )
    )
      previous.push(item);
    else groups.push([item]);
  }
  return groups;
}
