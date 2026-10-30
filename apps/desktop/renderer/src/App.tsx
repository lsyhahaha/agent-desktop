import { useEffect, useRef, useState } from "react";
import { ModelSettingsPage } from "./ModelSettingsPage";
import { useAgentSession } from "./useAgentSession";

const runLabels = {
  idle: "准备就绪",
  running: "正在生成",
  waiting_user: "等待用户授权",
  completed: "本轮执行完成",
  cancelled: "已停止",
  failed: "运行失败",
};
const toolLabels = {
  waiting: "等待授权",
  running: "执行中",
  success: "执行成功",
  denied: "已拒绝",
  error: "执行失败",
  cancelled: "已取消",
};

/** 两个页面共用已有会话连接；切换模型设置不会销毁正在运行的 Agent。 */
export function App() {
  const agent = useAgentSession();
  const [page, setPage] = useState<"chat" | "settings">("chat");
  const [text, setText] = useState("");
  const [clearing, setClearing] = useState(false);
  const [searching, setSearching] = useState(false),
    [query, setQuery] = useState("");
  const [editing, setEditing] = useState<string | null>(null),
    [title, setTitle] = useState("");
  const drafts = useRef(new Map<string, string>());
  const composer = useRef<HTMLTextAreaElement>(null);
  // 草稿按会话隔离，切换只改变显示，不丢弃旧任务或把草稿写进模型上下文。
  useEffect(() => {
    setText(drafts.current.get(agent.sessionId ?? "") ?? "");
    follow.current = true;
  }, [agent.sessionId]);
  function changeText(value: string) {
    setText(value);
    if (agent.sessionId) drafts.current.set(agent.sessionId, value);
  }
  const [approvalPending, setApprovalPending] = useState(false);
  const viewport = useRef<HTMLDivElement>(null);
  const follow = useRef(true);
  const empty = !agent.chat?.messages.length;
  // 用户查看较早消息时不强拉到底部；仅在靠近底部时跟随流式增量。
  useEffect(() => {
    if (follow.current && viewport.current)
      viewport.current.scrollTop = viewport.current.scrollHeight;
  }, [agent.chat?.revision, agent.sessionId, page]);
  async function send() {
    if (await agent.send(text)) {
      changeText("");
      follow.current = true;
    }
  }
  /** 新任务创建/复用独立草稿，旧任务由 Runtime 保留，不再调用 clear。 */
  async function newChat() {
    if (agent.active || agent.pending || clearing) return;
    setClearing(true);
    try {
      if (await agent.command({ type: "new" })) {
        setPage("chat");
        setEditing(null);
        setQuery("");
        follow.current = true;
        composer.current?.focus();
      }
    } finally {
      setClearing(false);
    }
  }
  async function selectTask(id: string) {
    if (agent.active || agent.pending || clearing) return;
    setClearing(true);
    try {
      if (await agent.command({ type: "select", sessionId: id })) {
        setPage("chat");
        setEditing(null);
        follow.current = true;
      }
    } finally {
      setClearing(false);
    }
  }
  async function renameTask() {
    if (!editing || !title.trim() || agent.active || agent.pending) return;
    if (
      await agent.command({
        type: "rename",
        sessionId: editing,
        title: title.trim(),
      })
    )
      setEditing(null);
  }
  // 快捷键仅在工作区生效；设置页的凭据编辑不被任务快捷键打断。
  const newTaskAction = useRef(newChat);
  newTaskAction.current = newChat;
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (
        page === "chat" &&
        (event.metaKey || event.ctrlKey) &&
        event.key.toLowerCase() === "n"
      ) {
        event.preventDefault();
        void newTaskAction.current();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [page]);
  /** 审批绑定当次 interactionId；即使双击或旧按钮残留，也由 Runtime 再校验。 */
  async function approve(allow: boolean) {
    const id = agent.chat?.interaction?.id;
    if (!id || approvalPending) return;
    setApprovalPending(true);
    try {
      await agent.command({ type: "approve", interactionId: id, allow });
    } finally {
      setApprovalPending(false);
    }
  }
  const currentTitle =
    agent.sessions.find((item) => item.id === agent.sessionId)?.title ??
    "新任务";
  const shownTasks = agent.sessions.filter((item) =>
    item.title.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()),
  );
  return (
    <div className="desktop-shell">
      <aside className="sidebar">
        <div className="window-drag sidebar-drag" />
        {page === "settings" ? (
          <>
            <button className="nav-item back" onClick={() => setPage("chat")}>
              <span>←</span> 返回工作区
            </button>
            <div className="group-label nav-label">基础设置</div>
            <button className="nav-item selected" aria-current="page">
              <span>◇</span> 模型设置
            </button>
          </>
        ) : (
          <>
            <div className="app-brand">
              Agent Desktop<span>本地开发助手</span>
            </div>
            <button
              className="nav-item new-task"
              onClick={() => void newChat()}
              disabled={agent.active || agent.pending || clearing}
            >
              <span>⊕</span> 新建任务<kbd>⌘ N</kbd>
            </button>
            <div className="sidebar-divider" />
            <div className="group-label nav-label task-list-heading">
              <span>
                任务列表 <span className="count">{agent.sessions.length}</span>
              </span>
              <button
                aria-label="搜索任务"
                title="搜索任务"
                onClick={() => {
                  setSearching(!searching);
                  setQuery("");
                }}
              >
                ⌕
              </button>
            </div>
            {searching && (
              <input
                className="task-search"
                aria-label="搜索任务名称"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="搜索任务名称"
                autoFocus
              />
            )}
            <div className="task-list">
              {!shownTasks.length ? (
                <p className="empty-list">
                  {query ? "没有匹配的任务" : "发送第一条消息后显示任务"}
                </p>
              ) : (
                shownTasks.map((item) => (
                  <div
                    className={
                      "task-row " +
                      (item.id === agent.sessionId ? "selected" : "")
                    }
                    key={item.id}
                  >
                    {editing === item.id ? (
                      <form
                        className="task-rename"
                        onSubmit={(event) => {
                          event.preventDefault();
                          void renameTask();
                        }}
                      >
                        <input
                          aria-label="任务名称"
                          maxLength={60}
                          value={title}
                          onChange={(event) => setTitle(event.target.value)}
                          autoFocus
                        />
                        <button
                          aria-label="保存任务名称"
                          disabled={!title.trim() || agent.pending}
                        >
                          ✓
                        </button>
                        <button
                          aria-label="取消重命名"
                          type="button"
                          onClick={() => setEditing(null)}
                        >
                          ×
                        </button>
                      </form>
                    ) : (
                      <>
                        <button
                          className="task-item"
                          aria-current={
                            item.id === agent.sessionId ? "true" : undefined
                          }
                          disabled={agent.active || agent.pending || clearing}
                          title={
                            item.title +
                            (item.workspaceName
                              ? " · " + item.workspaceName
                              : "")
                          }
                          onClick={() => void selectTask(item.id)}
                        >
                          <span
                            className={
                              "task-dot " +
                              (["running", "waiting_user"].includes(item.state)
                                ? "live"
                                : "")
                            }
                          />
                          <span>{item.title}</span>
                        </button>
                        <button
                          className="task-more"
                          aria-label={"重命名 " + item.title}
                          title="重命名任务"
                          disabled={agent.active || agent.pending}
                          onClick={() => {
                            setEditing(item.id);
                            setTitle(item.title);
                          }}
                        >
                          ⋯
                        </button>
                      </>
                    )}
                  </div>
                ))
              )}
            </div>
            <div className="sidebar-context">
              <span className="group-label">项目</span>
              <button
                className="workspace-link"
                onClick={() => void agent.choose()}
                disabled={agent.active || agent.pending || agent.choosing}
              >
                <span>▱</span>
                <span>
                  {agent.choosing
                    ? "正在选择…"
                    : (agent.workspace?.name ?? "选择项目目录")}
                </span>
              </button>
              <p>任务仅保存在内存</p>
            </div>
          </>
        )}
        <div className="sidebar-bottom">
          <div className="runtime-indicator">
            <span
              className={"connection-dot " + (agent.status ? "configured" : "")}
            />
            {agent.status ? "本地 Runtime 已就绪" : "正在连接 Runtime"}
          </div>
          <button
            className={
              "nav-item settings-link " +
              (page === "settings" ? "selected" : "")
            }
            onClick={() => {
              setPage("settings");
            }}
          >
            <span>⚙</span> 模型设置
            <span className="key-indicator">
              {agent.settings.hasKey ? "已配置" : "未配置"}
            </span>
          </button>
        </div>
      </aside>
      <main className="workspace-surface">
        <header className="workspace-header">
          <div className="window-drag header-drag" />
          <span>
            {page === "settings" ? "设置" : empty ? "新任务" : currentTitle}
          </span>
          <div className="header-actions">
            {agent.active && page === "settings" && (
              <button
                className="stop-button"
                onClick={() => void agent.command({ type: "cancel" })}
              >
                ■ 停止任务
              </button>
            )}
            <span className={"run-status " + (agent.active ? "busy" : "")}>
              {agent.taskStatus === "completed"
                ? "任务已确认完成"
                : agent.chat?.tools.some((tool) => tool.state === "running")
                  ? "工具执行中"
                  : runLabels[agent.chat?.state ?? "idle"]}
            </span>
          </div>
        </header>
        {page === "settings" ? (
          <>
            <ModelSettingsPage
              settings={agent.settings}
              ready={agent.settingsReady}
              active={agent.active || agent.pending}
              onSave={agent.save}
            />
            {agent.error && (
              <div className="page-error error" role="alert">
                {agent.error}
              </div>
            )}
          </>
        ) : (
          <div
            className={
              "chat-workspace " + (empty ? "is-empty" : "has-messages")
            }
          >
            <div
              className="conversation-scroll"
              ref={viewport}
              onScroll={() => {
                const el = viewport.current;
                if (el)
                  follow.current =
                    el.scrollHeight - el.scrollTop - el.clientHeight < 100;
              }}
            >
              {empty ? (
                <section className="welcome">
                  <span className="watermark" aria-hidden="true">
                    A
                  </span>
                  <h1>今天有什么工作，交给我吧</h1>
                  <p>从一次对话开始，让每一步执行都清晰可见。</p>
                </section>
              ) : (
                <div className="conversation-content">
                  {agent.chat?.messages.map((message) => (
                    <article
                      className={"message " + message.role}
                      key={message.id}
                    >
                      <div className="message-heading">
                        <span className="avatar" aria-hidden="true">
                          {message.role === "user" ? "○" : "A"}
                        </span>
                        <strong>
                          {message.role === "user" ? "你" : "Agent Desktop"}
                        </strong>
                        {message.state === "streaming" && (
                          <span className="stream-label">
                            正在回复
                            <span className="typing-dot" />
                          </span>
                        )}
                        {message.state === "interrupted" && (
                          <span className="stream-label">本轮未完成</span>
                        )}
                      </div>
                      <div className="message-content">
                        {message.text.replace(/\n{3,}/g, "\n\n") ||
                          (message.state === "streaming"
                            ? "正在等待模型…"
                            : "本轮未产生文本")}
                      </div>
                    </article>
                  ))}
                  {!!agent.chat?.tools.length && (
                    <section className="tool-list" aria-label="工具执行记录">
                      <header>
                        <span>▤</span> 工具执行记录{" "}
                        <span className="muted">
                          {agent.chat.tools.length} / 12
                        </span>
                      </header>
                      {agent.chat.tools.map((tool) => (
                        <div className="tool-item" key={tool.id}>
                          <div>
                            <code>{tool.name}</code>
                            <span className={"tool-state " + tool.state}>
                              {toolLabels[tool.state]}
                            </span>
                          </div>
                          <p>{tool.path || "路径未通过校验"}</p>
                          {tool.detail && <small>{tool.detail}</small>}

                        </div>
                      ))}
                    </section>
                  )}
                  {agent.chat?.interaction && (
                    <section
                      className="approval"
                      aria-labelledby="approval-heading"
                    >
                      <div className="approval-icon">◇</div>
                      <div>
                        <h3 id="approval-heading">允许读取这个文件吗？</h3>
                        <code>{agent.chat.interaction.path}</code>
                        <p>文件内容会发送到 DeepSeek。本次仅允许读取该文件，最多32KiB，不包含写入或命令执行权限。</p>
                        <div className="approval-actions">
                          <button
                            onClick={() => void approve(false)}
                            disabled={approvalPending}
                          >
                            拒绝
                          </button>
                          <button
                            className="primary"
                            onClick={() => void approve(true)}
                            disabled={approvalPending}
                          >
允许本次读取
                          </button>
                        </div>
                      </div>
                    </section>
                  )}
                  {agent.chat?.state === "cancelled" && (
                    <p className="run-note">
                      本轮已停止。未完成的输出不会加入后续模型上下文。
                    </p>
                  )}
                  {agent.chat?.state === "completed" && (
                    <div className="task-outcome">
                      <span>
                        {agent.taskStatus === "completed"
                          ? "任务结果已由你确认完成。"
                          : "本轮执行已结束，任务结果尚待你确认。"}
                      </span>
                      {agent.taskStatus !== "completed" && agent.sessionId && (
                        <button
                          onClick={() =>
                            void agent.command({
                              type: "complete_task",
                              sessionId: agent.sessionId!,
                            })
                          }
                          disabled={agent.pending}
                        >
                          确认任务完成
                        </button>
                      )}
                    </div>
                  )}
                  {agent.chat?.state === "completed" && (
                    <div className="usage">
                      本轮用量 ·{" "}
                      {agent.chat.usage.complete
                        ? `输入 ${agent.chat.usage.input} / 输出 ${agent.chat.usage.output} tokens`
                        : "Provider 用量信息不完整"}
                    </div>
                  )}
                </div>
              )}
            </div>
            <div className="compose-area">
              {(agent.error || agent.chat?.error) && (
                <div role="alert" className="error">
                  {agent.error || agent.chat?.error?.message}
                </div>
              )}
              <div className="composer-wrap">
                <div className="composer-context">
                  <button
                    className="project-select"
                    disabled={agent.active || agent.pending || agent.choosing}
                    onClick={() => void agent.choose()}
                    title={agent.workspace?.path ?? "选择允许读取的项目目录"}
                  >
                    <span>▱</span>
                    {agent.choosing
                      ? "正在选择…"
                      : (agent.workspace?.name ?? "选择项目")}
                    <span className="chevron">⌄</span>
                  </button>
                  <span className="context-divider" />
                  <span className="context-hint">
                    {agent.workspace
                      ? "仅在项目内读取文件"
                      : "普通对话无需选择项目"}
                  </span>
                </div>
                <div className="composer">
                  <textarea
                    aria-label="消息"
                    ref={composer}
                    value={text}
                    maxLength={16000}
                    disabled={
                      agent.active || agent.pending || !agent.settingsReady
                    }
                    onChange={(e) => changeText(e.target.value)}
                    placeholder={
                      agent.settings.hasKey
                        ? "描述你的任务，或让我读取 README.md…"
                        : "描述你的任务；发送前请先配置 DeepSeek 模型"
                    }
                    onKeyDown={(e) => {
                      if (
                        e.key === "Enter" &&
                        (e.metaKey || e.ctrlKey) &&
                        !e.nativeEvent.isComposing
                      ) {
                        e.preventDefault();
                        void send();
                      }
                    }}
                  />
                  <div className="composer-toolbar">
                    {/* 内置工具由 Runtime 决定，输入框不再暴露工具实现开关。 */}
                    <span className="composer-spacer" />
                    <div className="send-actions">
                      <button
                        className="model-select"
                        onClick={() => setPage("settings")}
                        title="管理模型"
                      >
                        {agent.settings.hasKey
                          ? agent.settings.model
                          : "管理模型"}
                        <span>⌄</span>
                      </button>
                      {agent.active ? (
                        <button
                          aria-label="停止生成"
                          className="send-button stop"
                          onClick={() => void agent.command({ type: "cancel" })}
                        >
                          ■
                        </button>
                      ) : (
                        <button
                          aria-label="发送消息"
                          className="send-button"
                          disabled={
                            agent.pending ||
                            !text.trim() ||
                            !agent.settings.hasKey ||
                            !agent.settingsReady ||
                            agent.choosing
                          }
                          onClick={() => void send()}
                        >
                          ↑
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </div>
              <p className="composer-footnote">
                {!agent.settings.hasKey ? (
                  <button
                    className="text-link"
                    onClick={() => setPage("settings")}
                  >
                    先配置 DeepSeek API Key，开始真实对话
                  </button>
                ) : (
                  <>
                    <span>⌘ / Ctrl + Enter 发送</span>
                    <span>最多 6 次模型请求 · 12 次工具调用 · 120 秒</span>
                  </>
                )}
              </p>
            </div>
            {empty && (
              <div className="suggestions">
                <span>试试这些任务</span>
                <button
                  disabled={agent.active}
                  onClick={() =>
                    changeText("请介绍一下你能如何协助我理解一个代码项目。")
                  }
                >
                  ✧<span>一起梳理一个项目的思路</span>
                  <span>↗</span>
                </button>
                <button
                  disabled={agent.active || !agent.workspace}
                  title={
                    agent.workspace
                      ? "准备读取 README 的任务"
                      : "请先选择项目目录"
                  }
                  onClick={() => {
                    changeText("请读取 README.md，说明项目用途和启动方式。");
                  }}
                >
                  ▤<span>读取 README，了解项目如何启动</span>
                  <span>↗</span>
                </button>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
