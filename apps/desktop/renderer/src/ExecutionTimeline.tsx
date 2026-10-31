import { memo, useState, type ReactNode } from "react";
import type { ChatSnapshot, TimelineItem } from "@protocol";
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
      return (
        <Disclosure label="参数与执行结果">
          <pre>{item.data.arguments}</pre>
          {item.data.executionStatus && (
            <p>
              命令状态：{item.data.executionStatus} · 退出码{" "}
              {item.data.exitCode ?? "—"}
            </p>
          )}
          <pre>{(item.data.output ?? item.data.result) || "（暂无输出）"}</pre>
          {item.data.truncated && <p>输出达到上限，已截断并终止命令。</p>}
        </Disclosure>
      );
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
            修改文件：
            {item.data.files.length
              ? item.data.files.join("、")
              : "无已确认修改"}
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
            ? "文件内容会发送到 DeepSeek 并保存在本机；本次仅允许读取该文件，最多32KiB。"
            : "命令在只读沙箱运行，禁止写入和网络。输出发送到 DeepSeek 并保存在本机；最长60秒，最多32KiB。"}
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
}: {
  items: TimelineItem[];
  interaction: ChatSnapshot["interaction"];
  onReply: (value: boolean | string) => Promise<boolean>;
}) {
  return (
    <section className="execution-timeline" aria-label="Agent 执行时间线">
      <ol>
        {items.map((item) => (
          <Item
            key={item.id}
            item={item}
            interaction={interaction}
            onReply={onReply}
          />
        ))}
      </ol>
    </section>
  );
}
