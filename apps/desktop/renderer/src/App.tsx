import { useEffect, useMemo, useRef, useState } from "react";
import { PermissionPicker } from "./PermissionPicker";
import { DeveloperPanel } from "./DeveloperPanel";
import { MarkdownReply } from "./MarkdownReply";
import { ConversationMinimap } from "./ConversationMinimap";
import { Tooltip } from "./Tooltip";
import { ThemePicker } from "./ThemePicker";
import { currentActivity } from "@protocol";
import { ExecutionTimeline } from "./ExecutionTimeline";
import { ToolRecords } from "./ToolRecords";
import { ModelSettingsPage } from "./ModelSettingsPage";
import { PluginSettingsPage } from "./PluginSettingsPage";
import { useAgentSession } from "./useAgentSession";
import { PinnedPreview, ProjectListPreview, ProjectRow, SettingsNavigation, type SettingsPage, WorkspacePrimaryNav } from "./WorkspaceSidebar";
import { AppearancePreviewPage, ArchivedChatsPreviewPage, AutomationPreviewPage, BrowserSettingsPreviewPage, CloudEnvironmentPreviewPage, ComputerUseSettingsPreviewPage, ConnectionsSettingsPreviewPage, GeneralSettingsPreviewPage, GitSettingsPreviewPage, KeyboardShortcutsPreviewPage, McpSettingsPreviewPage, MemoriesSettingsPreviewPage, NotificationSettingsPreviewPage, PersonalizationSettingsPreviewPage, PetsSettingsPreviewPage, ProfileSettingsPreviewPage, SuggestedPromptsSettingsPreviewPage, WorktreePreviewPage } from "./PreviewPages";
import { SearchPage } from "./SearchPage";
import { ChatActionsMenu, ProjectActionsMenu, type ChatMenuTarget, type ProjectMenuTarget } from "./ChatActionsMenu";

/** 侧栏菜单共用边界内定位；打开时序交给原生popoverTarget，避免手动show与点击轻关闭竞态。 */
function prepareSidebarPopover(menu: HTMLDivElement, trigger: HTMLButtonElement, onReady: () => void) {
  const box = trigger.getBoundingClientRect();
  menu.style.left = `${Math.max(8, Math.min(window.innerWidth - 188, box.right - 180))}px`;
  menu.style.top = `${Math.max(8, Math.min(window.innerHeight - 126, box.bottom + 4))}px`;
  onReady();
}

/** 分组以本机自然日为界，跨月和夏令时仍按日期判断。 */
function dayGroup(time: number) {
  const now = new Date(), day = new Date(time);
  if (day.toDateString() === now.toDateString()) return "今天";
  now.setDate(now.getDate() - 1);
  return day.toDateString() === now.toDateString() ? "昨天" : "更早";
}
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
  // hiddenInset 的交通灯只存在于 macOS；平台类仅用于标题栏安全间距，不改变权限或业务逻辑。
  const macOS = navigator.platform.startsWith("Mac");
  const [developerOpen, setDeveloperOpen] = useState(false),
    [developerMax, setDeveloperMax] = useState(false),
    [developerView, setDeveloperView] = useState<"terminal" | "changes" | "files" | "preview">("terminal"),
    [developerWidth, setDeveloperWidth] = useState(() => {
      try { const width = Number(localStorage.getItem("workspace-panel-width")); return width >= 320 && width <= 2000 ? width : 420; } catch { return 420; }
    });
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
  /** 顶栏与面板标签共用同一视图切换，避免两个入口产生不同的开关语义。 */
  function toggleDeveloperView(view: "terminal" | "changes" | "files" | "preview") {
    const sameView = developerOpen && developerView === view;
    setDeveloperView(view);
    setDeveloperOpen(!sameView);
    setDeveloperMax(false);
  }
  // 分隔线使用指针捕获，离开窗口或取消手势不会遗留全局监听。

  type Page = "chat" | "search" | "automations" | SettingsPage;
  const [page, setPage] = useState<Page>("chat");
  // 终端、改动和文件树属于聊天工作区；进入独立页面时关闭面板，避免跨页面残留。
  useEffect(() => {
    if (page !== "chat") {
      setDeveloperOpen(false);
      setDeveloperMax(false);
    }
  }, [page]);
  // 折叠仅影响窗口布局；保留侧栏节点和草稿，不改变会话或正在执行的运行。
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const settingsMenu = useRef<HTMLDivElement>(null);
  const settingsTrigger = useRef<HTMLButtonElement>(null);
  const [text, setText] = useState("");
  // 外观偏好与业务草稿分开；此处只保存显示设置，失败不会阻断发送。
  const [wide, setWide] = useState(() => {
    try { return localStorage.getItem("workspace-reading-wide") === "true"; } catch { return false; }
  });
  const [layoutError, setLayoutError] = useState("");
  useEffect(() => {
    try { localStorage.setItem("workspace-reading-wide", String(wide)); localStorage.setItem("workspace-panel-width", String(developerWidth)); }
    catch { setLayoutError("布局已调整，但无法记住本机偏好。"); }
  }, [wide, developerWidth]);
  const [composerExpanded, setComposerExpanded] = useState(false);
  const [expandedRun, setExpandedRun] = useState<string | null>(null);
  const [clearing, setClearing] = useState(false);
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<string | null>(null),
    [title, setTitle] = useState("");
  const [chatMenuTarget, setChatMenuTarget] = useState<ChatMenuTarget | null>(null);
  const chatMenu = useRef<HTMLDivElement>(null);
  const chatMenuTrigger = useRef<HTMLButtonElement | null>(null);
  const [projectMenuTarget, setProjectMenuTarget] = useState<ProjectMenuTarget | null>(null);
  const projectMenu = useRef<HTMLDivElement>(null);
  const projectMenuTrigger = useRef<HTMLButtonElement | null>(null);
  const composer = useRef<HTMLTextAreaElement>(null);
  // 草稿按会话隔离，切换只改变显示，不丢弃旧任务或把草稿写进模型上下文。
  useEffect(() => {
    setText(agent.draft);
    setExpandedRun(null);
    follow.current = true;
    setAwayFromLatest(false);
  }, [agent.sessionId]);
  // 保存请求串行发送；切换和发送前等待最后一份草稿确认，防止迟到回包清空新输入。
  const draftWrites = useRef(Promise.resolve(true));
  const transitioning = useRef(false);
  const [draftError, setDraftError] = useState("");
  function persistDraft(value = text) {
    const sessionId = agent.sessionId;
    if (!sessionId) return Promise.resolve(false);
    const write = draftWrites.current.then(async () => {
      const ok = await agent.command({ type: "save_draft", sessionId, text: value });
      setDraftError(ok ? "" : "草稿尚未保存，请保留当前窗口并重试。");
      return ok;
    });
    draftWrites.current = write;
    return write;
  }
  useEffect(() => {
    if (clearing || !agent.sessionId || text === agent.draft) return;
    const timer = setTimeout(() => void persistDraft(text), 500);
    return () => clearTimeout(timer);
  }, [text, agent.sessionId, clearing]);
  function changeText(value: string) {
    setText(value);
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
  /** 保存与导航共用过渡锁。锁定期间禁止继续编辑，取消旧的延迟保存，
   * 避免已经发送的旧草稿在清空确认后被迟到写入重新恢复。 */
  async function withSavedDraft(action: () => Promise<void>) {
    if (transitioning.current || agent.active || agent.pending || agent.choosing) return;
    transitioning.current = true;
    setClearing(true);
    try {
      if (await persistDraft()) await action();
    } finally {
      transitioning.current = false;
      setClearing(false);
    }
  }
  async function send() {
    await withSavedDraft(async () => {
      if (await agent.send(text)) {
        if (await persistDraft("")) changeText("");
        follow.current = true;
      }
    });
  }
  /** 新聊天创建/复用独立草稿，旧聊天由Runtime保留。 */
  async function newChat() {
    await withSavedDraft(async () => {
      if (await agent.command({ type: "new" })) {
        setPage("chat"); setEditing(null); setQuery("");
        follow.current = true;
        requestAnimationFrame(() => composer.current?.focus());
      }
    });
  }
  async function selectTask(id: string) {
    await withSavedDraft(async () => {
      const match = agent.sessions.find((item) => item.id === id);
      if (await agent.command({ type: "select", sessionId: id })) {
        if (match?.matchedRunId) {
          await agent.command({ type: "inspect_run", sessionId: id, runId: match.matchedRunId });
          setExpandedRun(match.matchedRunId);
          follow.current = false;
          setAwayFromLatest(true);
          requestAnimationFrame(() => document.querySelector(`[data-minimap-round="${match.matchedRunId}"]`)?.scrollIntoView({block: "center"}));
        } else follow.current = true;
        setPage("chat"); setEditing(null);
      }
    });
  }
  async function chooseWorkspace() {
    await withSavedDraft(async () => { await agent.choose(); });
  }
  async function noProject() {
    await withSavedDraft(async () => { await agent.command({type: "no_project"}); });
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
  // 搜索交给SQLite分页，避免把全量会话正文搬到renderer。
  const lastSearch = useRef("");
  useEffect(() => {
    const key = `${agent.sessionId}:${query}`;
    if (agent.active || agent.pending || lastSearch.current === key) return;
    const timer = setTimeout(() => {
      lastSearch.current = key;
      void agent.command({type: "list_sessions", page: 0, query});
    }, 300);
    return () => clearTimeout(timer);
  }, [query, agent.sessionId, agent.active, agent.pending]);
  const shownTasks = agent.sessions;
  // 统计只来自已读取的真实Diff快照；未读取时显示未知，不能用0伪装成干净工作区。
  const changeStats = useMemo(() => {
    if (!agent.changes?.git || !agent.changes.detail) return null;
    let added = 0, removed = 0;
    for (const line of agent.changes.detail.split("\n")) {
      if (line.startsWith("+") && !line.startsWith("+++")) added += 1;
      else if (line.startsWith("-") && !line.startsWith("---")) removed += 1;
    }
    return { added, removed };
  }, [agent.changes]);
  return (
    <div
      className={
        "desktop-shell codex-aligned" + (macOS ? " platform-macos" : "") + (sidebarCollapsed ? " sidebar-collapsed" : "") +
        (wide ? " reading-wide" : "") + (composerExpanded ? " composer-expanded" : "")
      }
    >
      {/* 折叠入口位于标题栏，设置入口位于侧栏底部，与 Codex 的导航层级一致。 */}
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
            <rect x="2.5" y="3" width="15" height="14" rx="2" />
            <path d="M7 3v14" />
          </svg>
          <span className="sidebar-toggle-label">侧栏</span>
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
            <span>设置</span>
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
            <button
              type="button"
              className="settings-menu-item"
              onClick={() => {
                settingsMenu.current?.hidePopover();
                setPage("plugins");
                settingsTrigger.current?.focus();
              }}
            >
              <span aria-hidden="true">⬡</span> 插件
            </button>
            <div className="settings-theme-entry">
              <span>主题</span><ThemePicker />
            </div>
          </div>
        </div>
      </nav>
      <aside
        id="workspace-sidebar"
        className="sidebar"
        aria-label="工作区导航"
        hidden={sidebarCollapsed}
      >
        <div className="window-drag sidebar-drag" />
        {["general", "profile", "shortcuts", "notifications", "browser", "computer", "personalization", "suggestions", "memories", "pets", "mcp", "connections", "git", "settings", "plugins", "appearance", "cloud", "worktrees", "archived"].includes(page) ? (
          <SettingsNavigation
            page={page as SettingsPage}
            onBack={() => setPage("chat")}
            onPage={setPage}
          />
        ) : (
          <>
            <div className="app-brand" aria-label="Agent Desktop">
              Agent Desktop
            </div>
            <WorkspacePrimaryNav
              busy={
                !!agent.connectionError ||
                agent.active ||
                agent.pending ||
                clearing
              }
              activePage={page === "automations" ? "automations" : page === "search" ? "search" : "chat"}
              onNewChat={() => void newChat()}
              onSearch={() => { setQuery(""); setPage("search"); }}
              onPlugins={() => setPage("plugins")}
              onAutomations={() => setPage("automations")}
            />
            <PinnedPreview />
            <div className="sidebar-context">
              <div className="group-label sidebar-group-heading">
                <span>项目</span>
                <span className="sidebar-group-actions">
                  <button type="button" disabled title="项目筛选尚未实现" aria-label="筛选项目 · Mock"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 4h10M5 8h6M7 12h2" /></svg></button>
                  <button type="button" onClick={() => void chooseWorkspace()} disabled={!!agent.connectionError || agent.active || agent.pending || agent.choosing} title="添加或切换项目" aria-label="添加或切换项目"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2.5 4h4l1.5 2h5.5v7h-11zM11.5 1.5v4M9.5 3.5h4" /></svg></button>
                </span>
              </div>
              <ProjectRow
                name={agent.choosing ? "正在选择…" : (agent.workspace?.name ?? "选择项目目录")}
                onSelect={() => void chooseWorkspace()}
                disabled={
                  !!agent.connectionError ||
                  agent.active ||
                  agent.pending ||
                  agent.choosing
                }
                onMore={(name, trigger) => {
                  if (!projectMenu.current) return;
                  projectMenuTrigger.current = trigger;
                  prepareSidebarPopover(projectMenu.current, trigger, () => setProjectMenuTarget({ name }));
                }}
              />
              <ProjectListPreview onMore={(name, trigger) => {
                if (!projectMenu.current) return;
                projectMenuTrigger.current = trigger;
                prepareSidebarPopover(projectMenu.current, trigger, () => setProjectMenuTarget({ name }));
              }} />
              <button className="no-project" disabled={agent.active || agent.pending}
                onClick={() => void noProject()}>无项目对话</button>
            </div>
            <div className="group-label nav-label task-list-heading">
              <span>
                聊天 <span className="count">{agent.sessions.length}</span>
              </span>
              <span className="sidebar-group-actions">
                <button type="button" disabled title="聊天筛选尚未实现" aria-label="筛选聊天 · Mock"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 4h10M5 8h6M7 12h2" /></svg></button>
                <button type="button" onClick={() => void newChat()} disabled={!!agent.connectionError || agent.active || agent.pending || clearing} title="新建聊天" aria-label="新建聊天"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 3h7v10H3zM8.5 6.5l4-4 1 1-4 4-2 .5z" /></svg></button>
              </span>
            </div>
            <div className="task-list">
              {!shownTasks.length ? (
                <p className="empty-list">
                  {query ? "没有匹配的聊天" : "发送第一条消息后显示聊天"}
                </p>
              ) : (
                shownTasks.map((item, index) => (
                  <section key={item.id} className="task-entry">
                    {(index === 0 || dayGroup(item.updatedAt) !== dayGroup(shownTasks[index - 1].updatedAt)) &&
                      <div className="task-day-group">{dayGroup(item.updatedAt)}</div>}
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
                          aria-label="聊天名称"
                          maxLength={60}
                          value={title}
                          onChange={(event) => setTitle(event.target.value)}
                          autoFocus
                        />
                        <button
                          aria-label="保存聊天名称"
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
                          <span>{item.title}<small className="task-updated">{new Date(item.updatedAt).toLocaleString(undefined, {month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit"})}</small>{item.snippet && <small className="task-snippet">{item.snippet}</small>}</span>
                        </button>
                        <button
                          className="task-more"
                          aria-label={item.title + " 更多聊天操作"}
                          title="更多聊天操作"
                          popoverTarget="chat-actions-menu"
                          popoverTargetAction="show"
                          disabled={agent.active || agent.pending}
                          onClick={(event) => {
                            const menu = chatMenu.current;
                            if (!menu) return;
                            chatMenuTrigger.current = event.currentTarget;
                            prepareSidebarPopover(menu, event.currentTarget, () => setChatMenuTarget({ id: item.id, title: item.title }));
                          }}
                        >
                          ⋯
                        </button>
                      </>
                    )}
                  </div>
                  </section>
                ))
              )}
            </div>
            {(agent.sessionPage > 0 || agent.hasMoreSessions) && <div className="session-pagination" aria-label="聊天分页">
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
            </div>}
            <ChatActionsMenu
              menuRef={chatMenu}
              target={chatMenuTarget}
              onClose={() => {
                setChatMenuTarget(null);
                chatMenuTrigger.current?.focus();
              }}
              onRename={(target) => {
                chatMenu.current?.hidePopover();
                setEditing(target.id);
                setTitle(target.title);
              }}
            />
            <ProjectActionsMenu
              menuRef={projectMenu}
              target={projectMenuTarget}
              onClose={() => {
                setProjectMenuTarget(null);
                projectMenuTrigger.current?.focus();
              }}
            />

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
          (developerOpen && developerView === "terminal" ? " terminal-drawer" : "") +
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
            <button className="reading-width" aria-pressed={wide}
              onClick={() => setWide(!wide)}>{wide ? "标准宽度" : "宽幅阅读"}</button>
            <div className="window-drag header-drag" />

            <span>
              {page === "general" ? "通用" : page === "profile" ? "个人资料" : page === "shortcuts" ? "键盘快捷键" : page === "notifications" ? "通知" : page === "browser" ? "浏览器" : page === "computer" ? "Computer Use" : page === "personalization" ? "个性化" : page === "suggestions" ? "建议提示" : page === "memories" ? "记忆" : page === "pets" ? "Pets" : page === "mcp" ? "MCP 服务" : page === "connections" ? "连接" : page === "git" ? "Git" : page === "settings" ? "模型设置" : page === "plugins" ? "插件" : page === "appearance" ? "外观" : page === "cloud" ? "环境" : page === "worktrees" ? "Worktrees" : page === "archived" ? "已归档聊天" : page === "automations" ? "自动化" : page === "search" ? "搜索" : empty ? "新聊天" : currentTitle}
            </span>
            <div className="header-actions">
              {page === "chat" && agent.workspace && (
                <>
                  {/* 与 Codex 顶栏保持同构；编辑器启动和提交仍是明确禁用的视觉占位。 */}
                  <button className="editor-action-mock" type="button" disabled title="编辑器启动尚未接入" aria-label="在编辑器中打开 · Mock">
                    <span className="editor-mark">◇</span><span>⌄</span>
                  </button>
                  <button className="git-action-mock" type="button" disabled title="Git 提交底层能力尚未接入">
                    <span aria-hidden="true">↹</span> Commit <span aria-hidden="true">⌄</span>
                  </button>
                </>
              )}
              {page === "chat" && <>
                <button
                  ref={developerTrigger}
                  className="developer-trigger developer-action"
                  aria-label="打开终端"
                  aria-pressed={developerOpen && developerView === "terminal"}
                  onClick={() => toggleDeveloperView("terminal")}
                >
                  <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
                    <rect x="2" y="3" width="16" height="14" rx="2" />
                    <path d="m5 7 3 3-3 3m5 0h5" />
                  </svg>
                </button>
                <button
                  className="developer-trigger git-stats-action"
                  aria-label="打开改动审阅"
                  title={changeStats ? "基于当前已读取Diff快照" : "点击打开改动并读取文件列表"}
                  aria-pressed={developerOpen && developerView === "changes"}
                  onClick={() => {
                    const opening = !developerOpen || developerView !== "changes";
                    toggleDeveloperView("changes");
                    if (opening && agent.sessionId && !agent.changes)
                      void agent.command({ type: "workspace_changes", sessionId: agent.sessionId });
                  }}
                >
                  <span className="git-added">+{changeStats?.added ?? "–"}</span>
                  <span className="git-removed">-{changeStats?.removed ?? "–"}</span>
                </button>
                <button className="developer-trigger" aria-label="打开文件树" aria-pressed={developerOpen && developerView === "files"} onClick={() => toggleDeveloperView("files")}>
                  <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><rect x="3" y="3" width="14" height="14" rx="2"/><path d="M13 3v14" /></svg>
                </button>
              </>}
              {agent.active && page !== "chat" && (
                <button className="stop-button" onClick={() => void stop()}>
                  ■ 停止任务
                </button>
              )}
              <span
                role="status"
                className={"run-status " + (agent.active || agent.connectionError || agent.storageError || agent.chat?.interaction ? "busy" : "is-idle")}
              >
                {agent.connectionError
                  ? "连接异常"
                  : agent.storageError
                    ? "保存异常"
                    : agent.chat?.stopping
                      ? "正在停止，等待资源清理确认…"
                      : agent.chat?.interaction
                        ? agent.chat.interaction.kind === "input"
                          ? "等待你的回答"
                          : `等待批准 · ${agent.chat.interaction.path}`
                        : agent.chat?.state === "running"
                          ? currentActivity(agent.chat.items)
                          : runLabels[agent.chat?.state ?? "idle"]}
              </span>
            </div>
          </header>
          {page === "general" ? (
            <GeneralSettingsPreviewPage />
          ) : page === "profile" ? (
            <ProfileSettingsPreviewPage />
          ) : page === "shortcuts" ? (
            <KeyboardShortcutsPreviewPage />
          ) : page === "notifications" ? (
            <NotificationSettingsPreviewPage />
          ) : page === "browser" ? (
            <BrowserSettingsPreviewPage />
          ) : page === "computer" ? (
            <ComputerUseSettingsPreviewPage />
          ) : page === "personalization" ? (
            <PersonalizationSettingsPreviewPage />
          ) : page === "suggestions" ? (
            <SuggestedPromptsSettingsPreviewPage />
          ) : page === "memories" ? (
            <MemoriesSettingsPreviewPage />
          ) : page === "pets" ? (
            <PetsSettingsPreviewPage />
          ) : page === "mcp" ? (
            <McpSettingsPreviewPage />
          ) : page === "connections" ? (
            <ConnectionsSettingsPreviewPage />
          ) : page === "git" ? (
            <GitSettingsPreviewPage />
          ) : page === "settings" ? (
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
          ) : page === "plugins" ? (
            <PluginSettingsPage active={agent.active || agent.pending} />
          ) : page === "appearance" ? (
            <AppearancePreviewPage />
          ) : page === "worktrees" ? (
            <WorktreePreviewPage workspaceName={agent.workspace?.name ?? null} />
          ) : page === "cloud" ? (
            <CloudEnvironmentPreviewPage workspaceName={agent.workspace?.name ?? null} />
          ) : page === "archived" ? (
            <ArchivedChatsPreviewPage />
          ) : page === "automations" ? (
            <AutomationPreviewPage />
          ) : page === "search" ? (
            <SearchPage
              query={query}
              results={shownTasks}
              busy={agent.active || agent.pending || clearing}
              onQuery={setQuery}
              onSelect={(id) => void selectTask(id)}
            />
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
                      <h1>
                        {agent.workspace
                          ? `想在 ${projectLabel} 中构建什么？`
                          : "今天想构建什么？"}
                      </h1>
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
                                  {showTimeline &&
                                  (version === 1 || version === 2) ? (
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
                                      tools={
                                        current
                                          ? agent.chat!.tools
                                          : (inspection?.tools ?? [])
                                      }
                                      sessionId={agent.sessionId ?? undefined}
                                      runId={message.runId}
                                      editable={
                                        !agent.active &&
                                        !agent.pending &&
                                        !agent.storageError &&
                                        !agent.connectionError
                                      }
                                      onEdit={agent.command}
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
                                  {version !== 1 && version !== 2 && (
                                    <p className="muted">
                                      旧版记录，执行细节不完整
                                    </p>
                                  )}
                                  {showTimeline &&
                                    version !== 1 &&
                                    version !== 2 && (
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
                      {agent.chat?.state === "completed" && !agent.chat.items.length && (
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
                {!text && ["failed", "cancelled", "interrupted"].includes(agent.chat?.state ?? "") &&
                  <button onClick={() => changeText(agent.chat?.messages.filter((message) => message.role === "user").at(-1)?.text ?? "")}>取回上次输入继续编辑</button>}
                {layoutError && <p role="alert" className="error">{layoutError}</p>}
                {draftError && <p role="alert" className="error">{draftError}</p>}
                {text !== agent.draft && !draftError && <small className="draft-save-state">草稿正在保存…</small>}
                {(agent.error || agent.storageError || agent.chat?.error) && (
                  <div role="alert" className="error">
                    {agent.error ||
                      agent.storageError ||
                      agent.chat?.error?.message}
                  </div>
                )}
                {agent.active && (
                  <div className="goal-progress-mock" role="status" aria-label="Goal 进度预览 · Mock">
                    <span className="goal-progress-dot" aria-hidden="true" />
                    <strong>当前任务</strong>
                    <small>Goal · Mock</small>
                    <span className="composer-spacer" />
                    <button type="button" disabled title="Goal 暂停与恢复尚未实现">暂停</button>
                    <button type="button" disabled title="Goal 编辑尚未实现">编辑</button>
                    <button type="button" disabled title="Goal 清除尚未实现">清除</button>
                  </div>
                )}
                {agent.active && text.trim() && (
                  <section className="followup-draft-preview" aria-label="运行中跟进草稿预览 · Mock">
                    <span className="followup-grip" aria-hidden="true">⠿</span>
                    <div>
                      <strong>{text.trim()}</strong>
                      <small>未发送 · Mock</small>
                    </div>
                    <button type="button" disabled title="Queue 协议尚未实现">编辑</button>
                    <button type="button" disabled title="Queue 重排协议尚未实现" aria-label="重排跟进消息 · Mock">↕</button>
                    <button type="button" disabled title="Queue 发送协议尚未实现">发送</button>
                    <button type="button" disabled title="Queue 删除协议尚未实现" aria-label="删除跟进消息 · Mock">×</button>
                  </section>
                )}
                <div className="composer-wrap">
                  {/* 视觉顺序由 CSS 固定为输入、权限/模型、项目环境；状态仍来自真实投影。 */}
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
                        onClick={() => void chooseWorkspace()}
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
                        <span className="context-chevron" aria-hidden="true">⌄</span>
                      </button>
                    </Tooltip>
                    <span className="workspace-mode" title={agent.workspace ? "当前直接使用本地项目目录" : "普通对话未绑定项目目录"}>
                      <svg viewBox="0 0 18 18" aria-hidden="true"><rect x="2.5" y="3" width="13" height="9" rx="1.5" /><path d="M6 15h6M9 12v3" /></svg>
                      {agent.workspace ? "本地" : "无项目"}<span className="context-chevron" aria-hidden="true">⌄</span>
                    </span>
                    {agent.workspace && <span className="workspace-branch" title="尚未接入分支查询"><svg viewBox="0 0 18 18" aria-hidden="true"><circle cx="5" cy="4" r="1.5" /><circle cx="5" cy="14" r="1.5" /><circle cx="13" cy="6" r="1.5" /><path d="M5 5.5v7M6.5 11c4 0 6.5-1.5 6.5-3.5" /></svg>分支未确认<span className="context-chevron" aria-hidden="true">⌄</span></span>}
                  </div>
                  <div className="composer">
                    <textarea
                      aria-label="消息"
                      ref={composer}
                      value={text}
                      maxLength={16000}
                      disabled={
                        clearing || agent.pending || !agent.settingsReady || !agent.sessionId
                      }
                      onChange={(e) => changeText(e.target.value)}
                      placeholder={
                        agent.connectionError
                          ? "请先完整退出并重新启动 Agent Desktop"
                          : agent.active
                            ? "添加跟进消息（Queue / Steer 尚未接入）"
                          : agent.settings.hasKey
                            ? "询问任何问题（@ 插件与文件为 Mock）"
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
                      <button className="composer-expand" aria-expanded={composerExpanded}
                        onClick={() => { setComposerExpanded(!composerExpanded); composer.current?.focus(); }}>
                        {composerExpanded ? "收起编辑区" : "展开编辑区"}
                      </button>
                      {agent.active && (
                        <div className="active-followup-mock" aria-label="运行中跟进模式尚未实现">
                          <button type="button" disabled title="默认 Queue 行为尚未接入">排队 <span>⌄</span> · Mock</button>
                        </div>
                      )}
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
                        <button className="effort-mock" type="button" disabled title="推理强度选择尚未接入">
                          极高 <span>⌄</span>
                        </button>
                        <button className="voice-mock" type="button" disabled title="语音输入尚未接入" aria-label="语音输入 · Mock">
                          <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><rect x="7" y="2.5" width="6" height="10" rx="3"/><path d="M4.5 9.5a5.5 5.5 0 0 0 11 0M10 15v2.5"/></svg>
                        </button>
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
                                clearing || agent.pending ||
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
                  <button disabled={agent.active || !agent.workspace} onClick={() => changeText("请检查当前项目的暂存、未暂存和新增文件，概括改动与待验证事项。")}><svg className="suggestion-icon" viewBox="0 0 18 18" aria-hidden="true"><path d="M3 4.5h10a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2H8l-3.5 2 .8-2H3a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2z" /></svg><span>检查当前改动</span><span>↗</span></button>
                  <button
                    disabled={agent.active}
                    onClick={() =>
                      changeText("请帮我分析以下报错，定位原因并说明验证方法。\n\n")
                    }
                  >
                    <svg className="suggestion-icon" viewBox="0 0 18 18" aria-hidden="true"><path d="M3 4.5h10a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2H8l-3.5 2 .8-2H3a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2z" /></svg><span>分析一段报错</span>
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
                    <svg className="suggestion-icon" viewBox="0 0 18 18" aria-hidden="true"><circle cx="5" cy="5" r="2" /><circle cx="13" cy="5" r="2" /><circle cx="5" cy="13" r="2" /><circle cx="13" cy="13" r="2" /></svg><span>了解这个项目</span>
                    <span>↗</span>
                  </button>
                </div>
              )}
            </div>
          )}
        </main>
        {developerOpen && (
          <>
            {!developerMax && developerView !== "terminal" && (
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
          view={developerView}
          onViewChange={setDeveloperView}
              changes={agent.changes}
              items={agent.chat?.items}
              busy={agent.active}
              onRefresh={(path) => agent.sessionId ? agent.command({ type: "workspace_changes", sessionId: agent.sessionId, path }) : Promise.resolve(false)}
            />
          </>
        )}
      </div>
    </div>
  );
}
