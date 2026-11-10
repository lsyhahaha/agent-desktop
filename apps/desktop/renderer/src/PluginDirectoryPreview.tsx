const groups = [
  {
    title: "推荐",
    items: [
      ["Computer Use", "控制本机应用", "CU"],
      ["Chrome", "在浏览器中工作", "CH"],
      ["Spreadsheets", "创建和编辑表格", "SS"],
      ["Presentations", "创建和编辑演示文稿", "PR"],
    ],
  },
  {
    title: "开发",
    items: [
      ["GitHub", "代码、Issue 与 Pull Request", "GH"],
      ["Cloudflare", "部署与平台文档", "CF"],
      ["Vercel", "构建和部署应用", "VE"],
      ["Linear", "规划与跟踪工程任务", "LI"],
    ],
  },
] as const;

/**
 * 官方 Codex 插件目录的视觉预览。
 *
 * 所有操作均保持禁用并显示 Mock 标识；该模块不连接市场、不安装软件、不读取账号，
 * 因而不能被调用方误用为真实插件能力。真实本地插件管理仍由 PluginSettingsPage 持有。
 */
export function PluginDirectoryPreview() {
  return (
    <div className="plugin-directory-preview" aria-label="插件目录界面预览">
      <div className="plugin-preview-note" role="note">
        界面预览 · Mock。插件市场和账号连接尚未实现，以下项目不可安装。
      </div>
      <div className="plugin-directory-controls">
        <div className="plugin-filters" aria-label="目录筛选预览">
          <button aria-pressed="true" disabled>精选</button>
          <button disabled>与你共享</button>
          <button disabled>由我创建</button>
        </div>
        <input aria-label="搜索插件预览" placeholder="搜索插件" disabled />
      </div>
      <section className="plugin-featured" aria-label="插件目录推荐">
        <span>连接你常用的工具</span>
        <strong>让 Agent Desktop 在更多工作流中提供帮助</strong>
        <button disabled>在聊天中试用</button>
      </section>
      {groups.map((group) => (
        <section className="plugin-directory-group" key={group.title}>
          <h2>{group.title}</h2>
          <div className="plugin-directory-grid">
            {group.items.map(([name, description, initials]) => (
              <article key={name}>
                <span className="plugin-directory-icon" aria-hidden="true">{initials}</span>
                <div><strong>{name}</strong><small>{description}</small></div>
                <button disabled aria-label={`${name} 尚未实现`}>＋</button>
              </article>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
