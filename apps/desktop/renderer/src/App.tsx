import { useEffect, useRef, useState } from "react";
import { PermissionPicker } from "./PermissionPicker";
import { DeveloperPanel } from "./DeveloperPanel";
import { MarkdownReply } from "./MarkdownReply";
import { ConversationMinimap } from "./ConversationMinimap";
import { Tooltip } from "./Tooltip";
import { ThemePicker } from "./ThemePicker";
import { ExecutionTimeline } from "./ExecutionTimeline";
import { ToolRecords } from "./ToolRecords";
import { ModelSettingsPage } from "./ModelSettingsPage";
import { useAgentSession } from "./useAgentSession";

const runLabels = {
  queued: "任务已接纳",
  waiting_input: "等待你的回答",
  waiting_approval: "等待用户授权",
  idle: "准备就绪",
  running: "正在生成",
  waiting_user: "等待用户授权",
  completed: "本轮执行完成",
  cancelled: "已停止",
  failed: "运行失败",
  interrupted: "上次运行已中断",
};

/** 两个页面共用已有会话连接；切换模型设置不会销毁正在运行的 Agent。 */
export function App() {
  const agent = useAgentSession();
  const [developerOpen, setDeveloperOpen] = useState(false),
    [developerMax, setDeveloperMax] = useState(false),
    [developerWidth, setDeveloperWidth] = useState(420);
  const developerTrigger = useRef<HTMLButtonElement>(null);
  const columns = useRef<HTMLDivElement>(null),
    resizing = useRef(false);
  function resizeDeveloper(clientX: number) {
    const bounds = columns.current?.getBoundingClientRect();
    if (bounds)
      setDeveloperWidth(
        Math.max(320, Math.min(bounds.width - 340, bounds.right - clientX)),
      );
  }
  useEffect(() => {
    const el = columns.current;
    if (!el) return;
    const observer = new ResizeObserver(() =>
      setDeveloperWidth((width) =>
        Math.max(320, Math.min(width, el.clientWidth - 340)),
      ),
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  function closeDeveloper() {
    setDeveloperOpen(false);
    setDeveloperMax(false);
    requestAnimationFrame(() => developerTrigger.current?.focus());
  }
  // 分隔线使用指针捕获，离开窗口或取消手势不会遗留全局监听。

  const [page, setPage] = useState<"chat" | "settings">("chat");
  // 折叠仅影响窗口布局；保留侧栏节点和草稿，不改变会话或正在执行的运行。
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const settingsMenu = useRef<HTMLDivElement>(null);
  const settingsTrigger = useRef<HTMLButtonElement>(null);
  const [text, setText] = useState("");
  const [expandedRun, setExpandedRun] = useState<string | null>(null);
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
    setExpandedRun(null);
    follow.current = true;
    setAwayFromLatest(false);
  }, [agent.sessionId]);
  function changeText(value: string) {
    setText(value);
    if (agent.sessionId) drafts.current.set(agent.sessionId, value);
  }
  const [awayFromLatest, setAwayFromLatest] = useState(false);
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
  /** 取消和回复都绑定当前轮次，旧界面不能作用于新Run。 */
  async function stop() {
    if (agent.sessionId && agent.chat?.runId)
      await agent.command({
        type: "cancel",
        sessionId: agent.sessionId,
        runId: agent.chat.runId,
      });
  }
  async function reply(value: boolean | string) {
    const interaction = agent.chat?.interaction;
    if (!interaction || !agent.sessionId || !agent.chat?.runId) return false;
    const scope = {
      sessionId: agent.sessionId,
      runId: agent.chat.runId,
      interactionId: interaction.id,
    };
    return agent.command(
      typeof value === "string"
        ? { type: "answer", ...scope, answer: value }
        : { type: "approve", ...scope, allow: value },
    );
  }
  const currentTitle = agent.title;
  // 按 Unicode 码点截取名称，避免把 emoji 的代理对截断；完整值仍用于可访问名称。
  const projectCharacters = Array.from(agent.workspace?.name ?? "");
  const projectLabel = agent.choosing
    ? "正在选择…"
    : agent.workspace
      ? projectCharacters.slice(0, 20).join("") +
        (projectCharacters.length > 20 ? "…" : "")
      : "未选择项目";
  const sendHint = agent.connectionError
    ? "恢复连接后再发送消息"
    : !agent.settingsReady
      ? "正在加载模型配置"
      : !agent.settings.hasKey
        ? "请先配置模型"
        : agent.storageError
          ? "本地保存异常，暂时无法发送"
          : agent.choosing
            ? "请先完成项目选择"
            : agent.pending
              ? "正在处理，请稍候"
              : !text.trim()
                ? "输入消息后发送（⌘ / Ctrl + Enter）"
                : "发送消息（⌘ / Ctrl + Enter）";
  const shownTasks = agent.sessions.filter((item) =>
    item.title.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()),
  );
  return (
    <div
      className={
        "desktop-shell" + (sidebarCollapsed ? " sidebar-collapsed" : "")
      }
    >
      {/* 应用工具拥有独立布局行；隐藏导航后仍可访问，不覆盖聊天或终端。 */}
      <nav className="app-controls" aria-label="应用工具">
        <button
          className="sidebar-toggle"
          type="button"
          aria-label={sidebarCollapsed ? "展开侧栏" : "收起侧栏"}
          title={sidebarCollapsed ? "展开侧栏" : "收起侧栏"}
          aria-expanded={!sidebarCollapsed}
          aria-controls="workspace-sidebar"
          onClick={() => setSidebarCollapsed((collapsed) => !collapsed)}
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 20 20"
            fill="none"
            aria-hidden="true"
          >
            <circle cx="10" cy="10" r="7.5" />
            <path
              d={
                sidebarCollapsed
                  ? "m8.5 6.5 3.5 3.5-3.5 3.5"
                  : "m11.5 6.5-3.5 3.5 3.5 3.5"
              }
            />
          </svg>
        </button>
        {/* 原生自动弹出层负责点击外部/Escape 关闭；只列出已实现的设置。 */}
        <div className="settings-controls">
          <button
            ref={settingsTrigger}
            className="settings-trigger"
            type="button"
            aria-label="设置"
            title="设置"
            popoverTarget="settings-menu"
          >
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              aria-hidden="true"
            >
              <path d="m9.5 3-.5 2-1.5.9-2-.5L3 9.6l1.5 1.5v1.8L3 14.4l2.5 4.2 2-.5 1.5.9.5 2h5l.5-2 1.5-.9 2 .5 2.5-4.2-1.5-1.5v-1.8L21 9.6l-2.5-4.2-2 .5L15 5l-.5-2z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
          </button>
          <div
            id="settings-menu"
            className="settings-popover"
            ref={settingsMenu}
            popover="auto"
            role="dialog"
            aria-label="设置菜单"
            onToggle={(event) => {
              // 打开后直接聚焦真实设置项，不在普通页面加载时抢占输入焦点。
              if (event.newState === "open")
                event.currentTarget
                  .querySelector<HTMLButtonElement>("button")
                  ?.focus();
            }}
          >
            <button
              type="button"
              className="settings-menu-item"
              onClick={() => {
                settingsMenu.current?.hidePopover();
                setPage("settings");
                settingsTrigger.current?.focus();
              }}
            >
              <span aria-hidden="true">◇</span> 模型设置
            </button>
          </div>
        </div>
        <ThemePicker />
      </nav>
      <aside
        id="workspace-sidebar"
        className="sidebar"
        aria-label="工作区导航"
        hidden={sidebarCollapsed}
      >
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
              disabled={
                !!agent.connectionError ||
                agent.active ||
                agent.pending ||
                clearing
              }
            >
              <span>⊕</span> 新建任务<kbd>⌘ N</kbd>
            </button>
            <div className="sidebar-divider" />
            <div className="group-label nav-label task-list-heading">
              <span>
                任务列表 <span className="count">{agent.sessions.length}</span>
              </span>
              <button
                aria-label="搜索当前页任务"
                title="搜索当前页任务"
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
                aria-label="搜索当前页任务名称"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="搜索当前页任务名称"
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
                          disabled={
                            !!agent.connectionError ||
                            agent.active ||
                            agent.pending ||
                            clearing
                          }
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
            <div className="session-pagination">
              <button
                disabled={
                  agent.sessionPage === 0 || agent.active || agent.pending
                }
                onClick={() =>
                  void agent.command({
                    type: "list_sessions",
                    page: agent.sessionPage - 1,
                  })
                }
              >
                上一页
              </button>
              <span>第 {agent.sessionPage + 1} 页</span>
              <button
                disabled={
                  !agent.hasMoreSessions || agent.active || agent.pending
                }
                onClick={() =>
                  void agent.command({
                    type: "list_sessions",
                    page: agent.sessionPage + 1,
                  })
                }
              >
                下一页
              </button>
            </div>
            <div className="sidebar-context">
              <span className="group-label">项目</span>
              <button
                className="workspace-link"
                onClick={() => void agent.choose()}
                disabled={
                  !!agent.connectionError ||
                  agent.active ||
                  agent.pending ||
                  agent.choosing
                }
              >
                <span>▱</span>
                <span>
                  {agent.choosing
                    ? "正在选择…"
                    : (agent.workspace?.name ?? "选择项目目录")}
                </span>
              </button>
              <p>
                {agent.storageError
                  ? "本地保存异常"
                  : agent.connectionError
                    ? "历史记录尚未加载"
                    : "任务保存在本机"}
              </p>
            </div>
          </>
        )}
        <div className="sidebar-bottom">
          {/* 正常连接保持安静；仅展示影响使用的连接进度或异常。 */}
          {(!agent.status || agent.connectionError) && (
            <div className="runtime-indicator" role="status">
              <span className="connection-dot" aria-hidden="true" />
              {agent.connectionError === "protocol_mismatch"
                ? "后台版本不匹配"
                : agent.connectionError
                  ? "后台连接失败"
                  : "正在连接…"}
            </div>
          )}
        </div>
      </aside>
      <div
        ref={columns}
        className={
          "workspace-columns" +
          (developerOpen ? " has-developer" : "") +
          (developerOpen && developerMax ? " developer-maximized" : "")
        }
        style={
          { "--developer-width": `${developerWidth}px` } as React.CSSProperties
        }
      >
        <main
          className="workspace-surface"
          hidden={developerOpen && developerMax}
        >
          <header className="workspace-header">
            <div className="window-drag header-drag" />

            <span>
              {page === "settings" ? "设置" : empty ? "新任务" : currentTitle}
            </span>
            <div className="header-actions">
              <button
                ref={developerTrigger}
                className="developer-trigger"
                aria-label="打开终端"
                aria-expanded={developerOpen}
                onClick={() => {
                  setDeveloperOpen(!developerOpen);
                  setDeveloperMax(false);
                }}
              >
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 20 20"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  aria-hidden="true"
                >
                  <rect x="2" y="3" width="16" height="14" rx="2" />
                  <path d="m5 7 3 3-3 3m5 0h5" />
                </svg>
              </button>
              {agent.active && page === "settings" && (
                <button className="stop-button" onClick={() => void stop()}>
                  ■ 停止任务
                </button>
              )}
              <span
                role="status"
                className={"run-status " + (agent.active ? "busy" : "")}
              >
                {agent.connectionError
                  ? "连接异常"
                  : agent.chat?.stopping
                    ? "正在停止…"
                    : agent.chat?.state === "running" &&
                        agent.chat?.tools.some(
                          (tool) => tool.state === "running",
                        )
                      ? "工具执行中"
                      : runLabels[agent.chat?.state ?? "idle"]}
              </span>
            </div>
          </header>
          {page === "settings" ? (
            <>
              <ModelSettingsPage
                settings={agent.settings}
                ready={agent.settingsReady && !agent.connectionError}
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
              <div className="conversation-region">
                <div
                  className="conversation-scroll"
                  ref={viewport}
                  onScroll={() => {
                    const el = viewport.current;
                    if (el) {
                      follow.current =
                        el.scrollHeight - el.scrollTop - el.clientHeight < 100;
                      setAwayFromLatest(!follow.current);
                    }
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
                      {agent.chat?.messages.map((message) => {
                        const current = message.runId === agent.chat?.runId;
                        const inspection =
                          agent.inspectedRun?.runId === message.runId
                            ? agent.inspectedRun
                            : null;
                        const version = current
                          ? agent.chat?.timelineVersion
                          : agent.runs.find((run) => run.id === message.runId)
                              ?.timelineVersion;
                        const showTimeline =
                          message.role === "assistant" &&
                          (current || expandedRun === message.runId);
                        return (
                          <article
                            className={"message " + message.role}
                            key={message.id}
                            aria-label={
                              message.role === "user"
                                ? "用户消息"
                                : "Agent 执行"
                            }
                          >
                            <div
                              data-minimap-id={message.id}
                              data-minimap-round={message.runId}
                              data-minimap-kind={message.role}
                              data-minimap-label={
                                message.role === "user"
                                  ? "用户消息"
                                  : "Agent 回复"
                              }
                            >
                              {message.role === "user" ? (
                                <div className="message-content">
                                  {message.text}
                                </div>
                              ) : (
                                <>
                                  {!current && (
                                    <button
                                      className="history-toggle"
                                      aria-expanded={
                                        expandedRun === message.runId
                                      }
                                      disabled={agent.pending}
                                      onClick={async () => {
                                        if (expandedRun === message.runId) {
                                          setExpandedRun(null);
                                          return;
                                        }
                                        if (
                                          agent.sessionId &&
                                          (await agent.command({
                                            type: "inspect_run",
                                            sessionId: agent.sessionId,
                                            runId: message.runId,
                                          }))
                                        )
                                          setExpandedRun(message.runId);
                                      }}
                                    >
                                      {expandedRun === message.runId
                                        ? "收起"
                                        : "查看"}{" "}
                                      本轮执行时间线
                                    </button>
                                  )}
                                  {showTimeline && version === 1 ? (
                                    <ExecutionTimeline
                                      items={
                                        current
                                          ? agent.chat!.items
                                          : (inspection?.items ?? [])
                                      }
                                      interaction={
                                        current && !agent.chat?.stopping
                                          ? (agent.chat?.interaction ?? null)
                                          : null
                                      }
                                      onReply={reply}
                                    />
                                  ) : (
                                    <div className="message-content">
                                      <MarkdownReply
                                        text={
                                          message.text ||
                                          (current && agent.active
                                            ? "任务已接纳，等待执行事件…"
                                            : "本轮未产生文本")
                                        }
                                      />
                                    </div>
                                  )}
                                  {version !== 1 && (
                                    <p className="muted">
                                      旧版记录，执行细节不完整
                                    </p>
                                  )}
                                  {showTimeline && version !== 1 && (
                                    <ToolRecords
                                      tools={
                                        current
                                          ? agent.chat!.tools
                                          : (inspection?.tools ?? [])
                                      }
                                      runId={message.runId}
                                    />
                                  )}
                                </>
                              )}
                            </div>
                          </article>
                        );
                      })}
                      {agent.chat?.state === "cancelled" && (
                        <p
                          className="run-note"
                          data-minimap-round={agent.chat?.runId ?? undefined}
                          data-minimap-id={`event-${agent.chat?.runId}-${agent.chat?.state}`}
                          data-minimap-kind="system"
                          data-minimap-label="本轮已停止"
                        >
                          本轮已停止。未完成的输出不会加入后续模型上下文。
                        </p>
                      )}
                      {agent.chat?.state === "completed" && (
                        <div
                          className="usage"
                          data-minimap-round={agent.chat?.runId ?? undefined}
                          data-minimap-id={`event-${agent.chat?.runId}-${agent.chat?.state}`}
                          data-minimap-kind="system"
                          data-minimap-label="本轮用量"
                        >
                          本轮用量 ·{" "}
                          {agent.chat.usage.complete
                            ? `输入 ${agent.chat.usage.input} / 输出 ${agent.chat.usage.output} tokens`
                            : "Provider 用量信息不完整"}
                        </div>
                      )}
                    </div>
                  )}
                </div>
                {awayFromLatest && (
                  <button
                    className="jump-latest"
                    onClick={() => {
                      follow.current = true;
                      setAwayFromLatest(false);
                      if (viewport.current)
                        viewport.current.scrollTop =
                          viewport.current.scrollHeight;
                    }}
                  >
                    回到最新 ↓
                  </button>
                )}
                {!empty && (
                  <ConversationMinimap
                    key={agent.sessionId ?? "draft"}
                    viewport={viewport}
                    onNavigate={() => {
                      follow.current = false;
                      setAwayFromLatest(true);
                    }}
                  />
                )}
              </div>
              <div className="compose-area">
                {(agent.error || agent.storageError || agent.chat?.error) && (
                  <div role="alert" className="error">
                    {agent.error ||
                      agent.storageError ||
                      agent.chat?.error?.message}
                  </div>
                )}
                <div className="composer-wrap">
                  <div className="composer-context">
                    <Tooltip
                      className="project-tooltip"
                      content={
                        "选择或切换项目目录" +
                        (agent.workspace ? `\n${agent.workspace.path}` : "") +
                        (agent.active ? "\n停止当前运行后可切换项目。" : "")
                      }
                    >
                      <button
                        className="project-select"
                        aria-label={
                          agent.workspace
                            ? `选择或切换项目目录，当前项目：${agent.workspace.name}`
                            : "选择或切换项目目录，未选择项目"
                        }
                        disabled={
                          !!agent.connectionError ||
                          agent.active ||
                          agent.pending ||
                          agent.choosing
                        }
                        onClick={() => void agent.choose()}
                      >
                        <svg
                          width="16"
                          height="16"
                          viewBox="0 0 20 20"
                          fill="none"
                          aria-hidden="true"
                        >
                          <path d="M2.5 5.5h5l2 2h8v9h-15zM2.5 7.5v-3h5l2 2h8v1" />
                        </svg>
                        <span className="project-name">{projectLabel}</span>
                      </button>
                    </Tooltip>
                    <Tooltip
                      content="普通对话无需选择项目"
                      align="end"
                      className="project-info-tooltip"
                    >
                      <button
                        type="button"
                        className="project-info"
                        aria-label="项目选择说明"
                      >
                        <svg
                          width="14"
                          height="14"
                          viewBox="0 0 20 20"
                          fill="none"
                          aria-hidden="true"
                        >
                          <circle cx="10" cy="10" r="7.5" />
                          <path d="M10 9v5m0-8v.5" />
                        </svg>
                      </button>
                    </Tooltip>
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
                        agent.connectionError
                          ? "请先完整退出并重新启动 Agent Desktop"
                          : agent.settings.hasKey
                            ? "和Agent Desktop一起工作"
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
                      <PermissionPicker
                        mode={agent.permissionMode}
                        disabled={
                          agent.active ||
                          agent.pending ||
                          agent.choosing ||
                          !agent.sessionId ||
                          !!agent.connectionError ||
                          !!agent.storageError
                        }
                        onSelect={(mode) =>
                          agent.command({
                            type: "set_permission",
                            sessionId: agent.sessionId!,
                            mode,
                          })
                        }
                      />
                      <span className="composer-spacer" />
                      <div className="send-actions">
                        <Tooltip content="选择或管理模型" align="end">
                          <button
                            aria-label="选择或管理模型"
                            className="model-select"
                            onClick={() => setPage("settings")}
                          >
                            {agent.settings.hasKey
                              ? agent.settings.model
                              : "管理模型"}
                            <span>⌄</span>
                          </button>
                        </Tooltip>
                        {agent.active ? (
                          <Tooltip content="停止当前生成" align="end">
                            <button
                              aria-label="停止生成"
                              disabled={agent.chat?.stopping}
                              className="send-button stop"
                              onClick={() => void stop()}
                            >
                              ■
                            </button>
                          </Tooltip>
                        ) : (
                          <Tooltip content={sendHint} align="end">
                            <button
                              aria-label="发送消息"
                              className="send-button"
                              disabled={
                                agent.pending ||
                                !!agent.storageError ||
                                !!agent.connectionError ||
                                !text.trim() ||
                                !agent.settings.hasKey ||
                                !agent.settingsReady ||
                                agent.choosing
                              }
                              onClick={() => void send()}
                            >
                              ↑
                            </button>
                          </Tooltip>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
                {(agent.connectionError || !agent.settings.hasKey) && (
                  <p className="composer-footnote">
                    {agent.connectionError ? (
                      <span>恢复连接后再发送消息。</span>
                    ) : !agent.settings.hasKey ? (
                      <button
                        className="text-link"
                        onClick={() => setPage("settings")}
                      >
                        先配置 DeepSeek API Key，开始真实对话
                      </button>
                    ) : null}
                  </p>
                )}
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
        {developerOpen && (
          <>
            {!developerMax && (
              <div
                className="developer-separator"
                role="separator"
                aria-label="调整开发者面板宽度"
                aria-orientation="vertical"
                aria-valuemin={320}
                aria-valuemax={Math.max(
                  320,
                  (columns.current?.clientWidth ?? 1000) - 340,
                )}
                aria-valuenow={developerWidth}
                tabIndex={0}
                onPointerDown={(e) => {
                  resizing.current = true;
                  e.currentTarget.setPointerCapture(e.pointerId);
                }}
                onPointerMove={(e) => {
                  if (resizing.current) resizeDeveloper(e.clientX);
                }}
                onPointerUp={(e) => {
                  resizing.current = false;
                  e.currentTarget.releasePointerCapture(e.pointerId);
                }}
                onPointerCancel={() => {
                  resizing.current = false;
                }}
                onKeyDown={(e) => {
                  if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
                    e.preventDefault();
                    const width = columns.current?.getBoundingClientRect();
                    if (width)
                      resizeDeveloper(
                        width.right -
                          developerWidth +
                          (e.key === "ArrowLeft" ? -20 : 20),
                      );
                  }
                }}
              />
            )}
            <DeveloperPanel
              workspacePath={agent.workspace?.path ?? null}
              sessionId={agent.sessionId}
              onClose={closeDeveloper}
              onCollapse={closeDeveloper}
              maximized={developerMax}
              onMaximize={() => setDeveloperMax(!developerMax)}
            />
          </>
        )}
      </div>
    </div>
  );
}
