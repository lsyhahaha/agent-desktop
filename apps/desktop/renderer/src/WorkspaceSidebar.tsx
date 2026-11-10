import { useEffect, useRef } from "react";

/**
 * Codex 式工作区主导航。
 *
 * 该模块只拥有稳定的导航层级和可访问语义，不读取会话状态，也不执行外部副作用。
 * 调用方负责传入真实禁用状态和命令；未实现的自动化始终保持禁用，避免视觉入口
 * 被误解为已具备调度能力。后续若批准接入图标库，只需在此模块替换图标实现。
 */
export function WorkspacePrimaryNav({
  busy,
  onNewChat,
  onSearch,
  onPlugins,
  onAutomations,
  activePage,
}: {
  busy: boolean;
  onNewChat: () => void;
  onSearch: () => void;
  onPlugins: () => void;
  onAutomations: () => void;
  activePage: "chat" | "search" | "automations";
}) {
  return (
    <nav className="workspace-primary-nav" aria-label="主要导航">
      <button className="nav-item new-task" onClick={onNewChat} disabled={busy}>
        <NavIcon name="new" /> 新聊天<kbd>⌘ N</kbd>
      </button>
      <button
        className={`nav-item ${activePage === "search" ? "selected" : ""}`}
        type="button"
        aria-current={activePage === "search" ? "page" : undefined}
        onClick={onSearch}
      >
        <NavIcon name="search" /> 搜索
      </button>
      <button className="nav-item" type="button" onClick={onPlugins}>
        <NavIcon name="plugins" /> 插件
      </button>
      <button
        className={`nav-item ${activePage === "automations" ? "selected" : ""}`}
        type="button"
        aria-current={activePage === "automations" ? "page" : undefined}
        onClick={onAutomations}
      >
        <NavIcon name="automations" /> 自动化 <small className="mock-badge">Mock</small>
      </button>
    </nav>
  );
}
/** 设置导航复用 Codex 的分组密度；未接入页面始终禁用并显示未实现标记。 */
export type SettingsPage = "general" | "profile" | "shortcuts" | "notifications" | "browser" | "computer" | "personalization" | "suggestions" | "memories" | "pets" | "mcp" | "connections" | "git" | "settings" | "plugins" | "appearance" | "cloud" | "worktrees" | "archived";
export function SettingsNavigation({
  page,
  onBack,
  onPage,
}: {
  page: SettingsPage;
  onBack: () => void;
  onPage: (page: SettingsPage) => void;
}) {
  const navigation = useRef<HTMLElement>(null);
  // 分类超过最小窗口高度时，始终让当前页面入口保持可见，不依赖用户手动寻找。
  useEffect(() => {
    const element = navigation.current;
    if (!element) return;
    if (["general", "profile", "shortcuts", "notifications", "browser", "computer", "personalization", "suggestions", "memories", "pets", "appearance", "archived"].includes(page)) element.scrollTop = 0;
    else element.querySelector<HTMLElement>('[aria-current="page"]')?.scrollIntoView({ block: "nearest" });
  }, [page]);
  return (
    <nav ref={navigation} className="settings-navigation" aria-label="设置导航">
      <button className="nav-item back" onClick={onBack}><NavIcon name="back" /> 返回工作区</button>
      <div className="group-label nav-label">设置</div>
      <button className={`nav-item ${page === "general" ? "selected" : ""}`} aria-current={page === "general" ? "page" : undefined} onClick={() => onPage("general")}>通用 <small className="mock-badge">Mock</small></button>
      <button className={`nav-item ${page === "profile" ? "selected" : ""}`} aria-current={page === "profile" ? "page" : undefined} onClick={() => onPage("profile")}>个人资料 <small className="mock-badge">Mock</small></button>
      <button className={`nav-item ${page === "shortcuts" ? "selected" : ""}`} aria-current={page === "shortcuts" ? "page" : undefined} onClick={() => onPage("shortcuts")}>键盘快捷键 <small className="mock-badge">Mock</small></button>
      <button className={`nav-item ${page === "notifications" ? "selected" : ""}`} aria-current={page === "notifications" ? "page" : undefined} onClick={() => onPage("notifications")}>通知 <small className="mock-badge">Mock</small></button>
      <button className={`nav-item ${page === "appearance" ? "selected" : ""}`} aria-current={page === "appearance" ? "page" : undefined} onClick={() => onPage("appearance")}>外观 <small className="mock-badge">部分Mock</small></button>
      <button className={`nav-item ${page === "browser" ? "selected" : ""}`} aria-current={page === "browser" ? "page" : undefined} onClick={() => onPage("browser")}>浏览器 <small className="mock-badge">Mock</small></button>
      <button className={`nav-item ${page === "computer" ? "selected" : ""}`} aria-current={page === "computer" ? "page" : undefined} onClick={() => onPage("computer")}>Computer Use <small className="mock-badge">Mock</small></button>
      <button className={`nav-item ${page === "personalization" ? "selected" : ""}`} aria-current={page === "personalization" ? "page" : undefined} onClick={() => onPage("personalization")}>个性化 <small className="mock-badge">Mock</small></button>
      <button className={`nav-item ${page === "suggestions" ? "selected" : ""}`} aria-current={page === "suggestions" ? "page" : undefined} onClick={() => onPage("suggestions")}>建议提示 <small className="mock-badge">Mock</small></button>
      <button className={`nav-item ${page === "memories" ? "selected" : ""}`} aria-current={page === "memories" ? "page" : undefined} onClick={() => onPage("memories")}>记忆 <small className="mock-badge">Mock</small></button>
      <button className={`nav-item ${page === "pets" ? "selected" : ""}`} aria-current={page === "pets" ? "page" : undefined} onClick={() => onPage("pets")}>Pets <small className="mock-badge">Mock</small></button>
      <button className={`nav-item ${page === "archived" ? "selected" : ""}`} aria-current={page === "archived" ? "page" : undefined} onClick={() => onPage("archived")}>已归档聊天 <small className="mock-badge">Mock</small></button>
      <div className="group-label nav-label settings-section-label">开发</div>
      <button className={`nav-item ${page === "settings" ? "selected" : ""}`} aria-current={page === "settings" ? "page" : undefined} onClick={() => onPage("settings")}>
        <NavIcon name="model" /> 模型设置
      </button>
      <button className={`nav-item ${page === "plugins" ? "selected" : ""}`} aria-current={page === "plugins" ? "page" : undefined} onClick={() => onPage("plugins")}>
        <NavIcon name="plugins" /> 插件
      </button>
      <button className={`nav-item ${page === "mcp" ? "selected" : ""}`} aria-current={page === "mcp" ? "page" : undefined} onClick={() => onPage("mcp")}>MCP 服务 <small className="mock-badge">Mock</small></button>
      <button className={`nav-item ${page === "connections" ? "selected" : ""}`} aria-current={page === "connections" ? "page" : undefined} onClick={() => onPage("connections")}>连接 <small className="mock-badge">Mock</small></button>
      <button className={`nav-item ${page === "git" ? "selected" : ""}`} aria-current={page === "git" ? "page" : undefined} onClick={() => onPage("git")}>Git <small className="mock-badge">Mock</small></button>
      <button className={`nav-item ${page === "cloud" ? "selected" : ""}`} aria-current={page === "cloud" ? "page" : undefined} onClick={() => onPage("cloud")}>环境 <small className="mock-badge">Mock</small></button>
      <button className={`nav-item ${page === "worktrees" ? "selected" : ""}`} aria-current={page === "worktrees" ? "page" : undefined} onClick={() => onPage("worktrees")}>Worktrees <small className="mock-badge">Mock</small></button>
    </nav>
  );
}

/** 置顶状态尚未持久化；保留官方分组位置但不伪造聊天内容。 */
export function PinnedPreview() {
  const examples = [["审查并分类问题","1周"],["重新设计应用界面","1周"],["创建流程图","2周"],["补充图标","1月"]] as const;
  return <section className="pinned-preview" aria-label="置顶聊天界面预览">
    <span className="group-label">置顶 <small className="mock-badge">Mock</small></span>
    {examples.map(([title,time])=><button disabled key={title}>
      <svg viewBox="0 0 18 18" aria-hidden="true"><path d="m7 2 5 5-2 2 3 3-1 1-3-3-2 2-5-5 1-1 1 1 3-3-1-1zM6 12l-4 4" /></svg>
      <strong>{title}</strong><small>{time}</small>
    </button>)}
  </section>;
}

/** 官方基础截图中的项目列表密度预览；示例项不读取目录，也不能切换工作区。 */
export function ProjectListPreview({ onMore }: { onMore?: (name: string, trigger: HTMLButtonElement) => void }) {
  const projects = ["burger-restaurant", "fitness-tracker", "codex-voxel", "codespottr", "voxel-snake"];
  return <div className="project-list-preview" aria-label="示例项目 · Mock">
    {projects.map((project) => <ProjectRow key={project} name={project} disabled mock onMore={onMore} />)}
  </div>;
}

/**
 * 真实项目与示例项目共用同一行组件，确保文件夹、名称和悬停菜单不会分叉。
 * 三点入口可打开只读Popover；菜单内项目设置/移除在协议实现前始终禁用，不能改变目录或侧栏状态。
 */
export function ProjectRow({
  name,
  disabled = false,
  mock = false,
  onSelect,
  onMore,
}: {
  name: string;
  disabled?: boolean;
  mock?: boolean;
  onSelect?: () => void;
  onMore?: (name: string, trigger: HTMLButtonElement) => void;
}) {
  return <div className="project-row" tabIndex={0} aria-label={`${name} 项目行`}>
    <button className="workspace-link project-row-main" type="button" disabled={disabled} onClick={onSelect} aria-label={mock ? `${name} · Mock` : name}>
      <ProjectFolderIcon />
      <span>{name}</span>
      {mock && <small>Mock</small>}
    </button>
    <button className="project-row-more" type="button" disabled={!onMore} popoverTarget="project-actions-menu" popoverTargetAction="show" onClick={(event) => onMore?.(name, event.currentTarget)} aria-label={`项目 ${name} 更多操作`} title="更多项目操作">•••</button>
  </div>;
}

/** 项目导航统一使用线框文件夹，避免字符字形随平台和字体漂移。 */
export function ProjectFolderIcon() {
  return <svg className="project-folder-icon" viewBox="0 0 16 16" aria-hidden="true"><path d="M2.5 4h4l1.4 1.8h5.6v7.2h-11z" /></svg>;
}

/** 单一图标模块保证尺寸、线宽和语义一致；批准外部图标库后可整体替换此实现。 */
function NavIcon({ name }: { name: "new" | "search" | "plugins" | "automations" | "back" | "model" }) {
  const paths = {
    new: <><rect x="3" y="3" width="14" height="14" rx="2" /><path d="M10 6v8M6 10h8" /></>,
    search: <><circle cx="8.5" cy="8.5" r="4.5" /><path d="m12 12 4 4" /></>,
    plugins: <><path d="M7 3.5h6v4h3.5v6H13v3H7v-3H3.5v-6H7z" /></>,
    automations: <><circle cx="10" cy="10" r="7" /><path d="M10 6v4l3 2" /></>,
    back: <><path d="m9 4-6 6 6 6M3 10h14" /></>,
    model: <><path d="M4 5h12M4 10h12M4 15h12" /><circle cx="8" cy="5" r="1.5" fill="currentColor" stroke="none" /><circle cx="13" cy="10" r="1.5" fill="currentColor" stroke="none" /><circle cx="7" cy="15" r="1.5" fill="currentColor" stroke="none" /></>,
  } as const;
  return <span className="nav-icon" aria-hidden="true"><svg width="16" height="16" viewBox="0 0 20 20" fill="none">{paths[name]}</svg></span>;
}
