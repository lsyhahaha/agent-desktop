import { useState } from "react";
import { ThemePicker } from "./ThemePicker";

/** General 设置依据官方字段做只读预览；不保存发送习惯、电源或跟进策略。 */
export function GeneralSettingsPreviewPage() {
  return (
    <section className="preview-page general-settings-preview" aria-labelledby="general-settings-heading">
      <header className="page-heading"><h1 id="general-settings-heading">通用</h1><p>调整聊天输入、运行期间系统行为和跟进消息方式。</p></header>
      <div className="preview-disclosure" role="note">界面预览 · Mock。以下设置尚未接入本地配置。</div>
      <div className="settings-row-list">
        <label><span><strong>Enter 键行为</strong><small>选择 Enter 直接发送，或要求组合键发送。</small></span><button disabled>⌘ Enter · Mock</button></label>
        <label><span><strong>运行时防止睡眠</strong><small>本地聊天运行时保持电脑唤醒。</small></span><button className="appearance-switch" disabled aria-label="运行时防止睡眠 · Mock"><i /></button></label>
        <label><span><strong>跟进消息行为</strong><small>运行中发送的消息用于引导当前轮次，或排队等待下一轮。</small></span><button disabled>排队 · Mock</button></label>
      </div>
    </section>
  );
}

/** 快捷键设置仅复刻信息层级；不注册快捷键、不覆盖系统或Electron菜单命令。 */
export function KeyboardShortcutsPreviewPage() {
  const rows = [["新聊天", "⌘ N"], ["打开设置", "⌘ ,"], ["切换终端", "⌃ `"], ["在聊天中查找", "⌘ F"]] as const;
  return (
    <section className="preview-page shortcut-settings-preview" aria-labelledby="shortcut-settings-heading">
      <header className="page-heading"><h1 id="shortcut-settings-heading">键盘快捷键</h1><p>查看和自定义常用命令的按键组合。</p></header>
      <div className="preview-disclosure" role="note">界面预览 · Mock。快捷键搜索、录制和重置尚未接入。</div>
      <div className="shortcut-toolbar"><input disabled placeholder="搜索命令或按下快捷键" aria-label="搜索快捷键 · Mock" /><button disabled>重置全部 · Mock</button></div>
      <div className="shortcut-list">{rows.map(([name,keys]) => <div key={name}><span>{name}</span><kbd>{keys}</kbd><button disabled aria-label={`修改 ${name} · Mock`}>编辑</button></div>)}</div>
    </section>
  );
}

/** 通知设置不调用Notification API，也不触发系统权限弹窗。 */
export function NotificationSettingsPreviewPage() {
  return (
    <section className="preview-page notification-settings-preview" aria-labelledby="notification-settings-heading">
      <header className="page-heading"><h1 id="notification-settings-heading">通知</h1><p>选择何时显示运行完成通知，并管理系统通知权限。</p></header>
      <div className="preview-disclosure" role="note">界面预览 · Mock。不会请求或修改操作系统通知权限。</div>
      <div className="settings-row-list">
        <label><span><strong>聊天完成通知</strong><small>本地聊天结束时显示桌面通知。</small></span><button className="appearance-switch" disabled aria-label="聊天完成通知 · Mock"><i /></button></label>
        <label><span><strong>仅在应用位于后台时通知</strong><small>前台查看当前聊天时保持安静。</small></span><button className="appearance-switch" disabled aria-label="仅后台通知 · Mock"><i /></button></label>
        <label><span><strong>系统通知权限</strong><small>当前未连接系统权限状态。</small></span><button disabled>检查权限 · Mock</button></label>
      </div>
    </section>
  );
}

/** Profile 预览不读取账号、用量或组织信息，所有未知值保持为空。 */
export function ProfileSettingsPreviewPage() {
  const stats = [["累计 Tokens", "—"], ["峰值 Tokens", "—"], ["连续使用", "—"], ["最长任务", "—"]] as const;
  return (
    <section className="preview-page profile-settings-preview" aria-labelledby="profile-settings-heading">
      <header className="page-heading"><h1 id="profile-settings-heading">个人资料</h1><p>查看账号资料、活动概览和分享入口。</p></header>
      <div className="preview-disclosure" role="note">界面预览 · Mock。未连接账号，不读取或生成个人统计。</div>
      <section className="profile-summary"><span aria-hidden="true">AD</span><div><strong>未连接账号</strong><small>头像、显示名称和用户名尚未连接</small></div><button disabled>编辑资料 · Mock</button></section>
      <div className="profile-stats">{stats.map(([label,value]) => <article key={label}><small>{label}</small><strong>{value}</strong></article>)}</div>
      <section className="profile-token-activity" aria-label="Token 活动 · Mock">
        <header><div><strong>Token 活动</strong><small>最近 30 天</small></div><button disabled>30 天 · Mock</button></header>
        <div className="profile-token-chart" aria-hidden="true">{Array.from({ length: 24 }, (_, index) => <i key={index} style={{ height: `${18 + ((index * 17) % 54)}%` }} />)}</div>
        <p>未连接用量数据，不生成或推断活动统计。</p>
      </section>
      <div className="settings-row-list"><label><span><strong>保存个人资料卡</strong><small>使用已确认的资料和用量亮点生成可分享图片。</small></span><button disabled>保存 · Mock</button></label><label><span><strong>邀请朋友或同事</strong><small>资格、奖励、限额和工作区策略尚未连接。</small></span><button disabled>邀请 · Mock</button></label></div>
    </section>
  );
}

/** Browser 设置仅展示权限结构；不安装扩展、不启动浏览器或保存站点例外。 */
export function BrowserSettingsPreviewPage() {
  const permissions = [["浏览", "需要批准"], ["下载", "需要批准"], ["上传", "阻止"]] as const;
  return (
    <section className="preview-page browser-settings-preview" aria-labelledby="browser-settings-heading">
      <header className="page-heading"><h1 id="browser-settings-heading">浏览器</h1><p>连接浏览器并管理 Agent 的浏览、下载和上传权限。</p></header>
      <div className="preview-disclosure" role="note">界面预览 · Mock。不会安装扩展、打开浏览器或更改站点权限。</div>
      <section className="browser-status"><div><strong>浏览器连接</strong><small>尚未连接浏览器扩展或内置浏览器</small></div><button disabled>设置浏览器 · Mock</button></section>
      <h2 className="settings-subheading">Agent 权限</h2>
      <div className="settings-row-list">{permissions.map(([label,value]) => <label key={label}><span><strong>{label}</strong><small>默认策略，站点例外尚未实现。</small></span><button disabled>{value} · Mock</button></label>)}</div>
    </section>
  );
}

/** Computer Use 设置不读取系统授权、不枚举设备，也不启用远程控制。 */
export function ComputerUseSettingsPreviewPage() {
  return (
    <section className="preview-page computer-settings-preview" aria-labelledby="computer-settings-heading">
      <header className="page-heading"><h1 id="computer-settings-heading">Computer Use</h1><p>查看本机应用控制权限和远程设备连接。</p></header>
      <div className="preview-disclosure" role="note">界面预览 · Mock。不会请求系统权限、扫描设备或启用远程控制。</div>
      <div className="settings-row-list">
        <label><span><strong>屏幕与系统音频录制</strong><small>允许 Agent 查看当前屏幕内容。</small></span><button disabled>未检查 · Mock</button></label>
        <label><span><strong>辅助功能</strong><small>允许 Agent 点击和输入桌面应用。</small></span><button disabled>未检查 · Mock</button></label>
        <label><span><strong>远程控制此电脑</strong><small>允许已授权设备继续本机工作。</small></span><button className="appearance-switch" disabled aria-label="远程控制此电脑 · Mock"><i /></button></label>
        <label><span><strong>已连接设备</strong><small>尚未连接或枚举任何设备。</small></span><button disabled>管理设备 · Mock</button></label>
      </div>
    </section>
  );
}

/** 个性化预览不读取或写入用户级/仓库级AGENTS.md。 */
export function PersonalizationSettingsPreviewPage() {
  return (
    <section className="preview-page personalization-settings-preview" aria-labelledby="personalization-settings-heading">
      <header className="page-heading"><h1 id="personalization-settings-heading">个性化</h1><p>通过个人指令调整 Agent 的工作方式。</p></header>
      <div className="preview-disclosure" role="note">界面预览 · Mock。不会读取、创建或修改 AGENTS.md。</div>
      <section className="instruction-preview"><header><div><strong>个人指令</strong><small>应用于这台电脑上的新聊天</small></div><button disabled>编辑 · Mock</button></header><textarea disabled value={"尚未连接个人指令。\n\n仓库中的 AGENTS.md 仍由 Runtime 按现有规则读取。"} readOnly /></section>
      <div className="settings-row-list"><label><span><strong>指令来源</strong><small>用户级 AGENTS.md</small></span><button disabled>未连接 · Mock</button></label><label><span><strong>仓库指令优先级</strong><small>沿用现有 Runtime 规则，不由此页面覆盖。</small></span><button disabled>查看说明 · Mock</button></label></div>
    </section>
  );
}

/** 建议提示预览不读取历史、不生成推荐，也不触发模型请求。 */
export function SuggestedPromptsSettingsPreviewPage() {
  return (
    <section className="preview-page suggested-prompts-preview" aria-labelledby="suggested-prompts-heading">
      <header className="page-heading"><h1 id="suggested-prompts-heading">建议提示</h1><p>控制新聊天和返回应用时显示的上下文建议。</p></header>
      <div className="preview-disclosure" role="note">界面预览 · Mock。不会读取历史、生成推荐或调用模型。</div>
      <div className="settings-row-list">
        <label><span><strong>启用上下文建议</strong><small>根据当前项目和最近工作显示建议。</small></span><button className="appearance-switch" disabled aria-label="上下文建议 · Mock"><i /></button></label>
        <label><span><strong>新聊天建议</strong><small>在空白 Composer 下显示可开始的工作。</small></span><button disabled>开启 · Mock</button></label>
        <label><span><strong>继续工作建议</strong><small>返回应用时显示可能继续的聊天。</small></span><button disabled>开启 · Mock</button></label>
        <label><span><strong>建议来源</strong><small>项目、聊天和插件上下文均未连接。</small></span><button disabled>管理 · Mock</button></label>
      </div>
    </section>
  );
}

/** Memories 仅展示产品结构；不读取会话、不生成摘要，也不建立跨会话存储。 */
export function MemoriesSettingsPreviewPage() {
  return (
    <section className="preview-page memories-settings-preview" aria-labelledby="memories-settings-heading">
      <header className="page-heading"><h1 id="memories-settings-heading">记忆</h1><p>控制是否从过去聊天中保留可复用的偏好与事实。</p></header>
      <div className="preview-disclosure" role="note">界面预览 · Mock。未启用、未读取、未写入任何跨会话记忆。</div>
      <div className="settings-row-list">
        <label><span><strong>启用 Codex 记忆</strong><small>允许未来聊天使用已确认的长期偏好。</small></span><button className="appearance-switch" disabled aria-label="启用记忆 · Mock"><i /></button></label>
        <label><span><strong>查看已保存记忆</strong><small>当前没有记忆存储或可枚举记录。</small></span><button disabled>查看 · Mock</button></label>
        <label><span><strong>清除全部记忆</strong><small>没有数据可删除；删除协议尚未实现。</small></span><button disabled>清除 · Mock</button></label>
      </div>
      <div className="memories-empty"><strong>没有已保存的记忆</strong><p>实现受控记忆后，已确认的条目会显示在这里。</p></div>
    </section>
  );
}

/** Pets 只展示设置结构；不创建、上传、激活动画或悬浮窗口。 */
export function PetsSettingsPreviewPage() {
  const pets = [["Codey", "默认伙伴", "C"], ["Mini", "仅保留快捷聊天控件", "M"], ["自定义", "上传九状态动画资源", "+"]] as const;
  return (
    <section className="preview-page pets-settings-preview" aria-labelledby="pets-settings-heading">
      <header className="page-heading"><h1 id="pets-settings-heading">Pets</h1><p>选择一个可选的动画伙伴或精简快捷聊天控件。</p></header>
      <div className="preview-disclosure" role="note">界面预览 · Mock。不会创建、上传、激活动画或悬浮窗口。</div>
      <div className="pet-grid">{pets.map(([name,description,mark]) => <article key={name}><span aria-hidden="true">{mark}</span><div><strong>{name}</strong><small>{description}</small></div><button disabled>{name === "自定义" ? "创建 · Mock" : "选择 · Mock"}</button></article>)}</div>
      <div className="settings-row-list"><label><span><strong>显示 Pet</strong><small>悬浮层和快捷聊天尚未实现。</small></span><button className="appearance-switch" disabled aria-label="显示 Pet · Mock"><i /></button></label><label><span><strong>当前选择</strong><small>没有激活任何 Pet。</small></span><button disabled>无 · Mock</button></label></div>
    </section>
  );
}

/** Git 设置只展示产品结构；不执行命令、不改变仓库或写配置。 */
export function GitSettingsPreviewPage() {
  return (
    <section className="preview-page git-settings-preview" aria-labelledby="git-settings-heading">
      <header className="page-heading"><h1 id="git-settings-heading">Git</h1><p>配置代码审阅、Diff 显示和分支相关行为。</p></header>
      <div className="preview-disclosure" role="note">界面预览 · Mock。不会执行 Git 命令、修改仓库或保存配置。</div>
      <div className="settings-row-list">
        <label><span><strong>Review delivery</strong><small>选择在当前聊天内联审阅，或新建独立审阅聊天。</small></span><button disabled>Inline · Mock</button></label>
        <label><span><strong>Diff 自动换行</strong><small>控制改动审阅面板中的长行显示。</small></span><button className="appearance-switch" disabled aria-label="Diff 自动换行 · Mock"><i /></button></label>
        <label><span><strong>默认工作方式</strong><small>新聊天使用本地目录或独立 Worktree。</small></span><button disabled>Local · Mock</button></label>
        <label><span><strong>分支信息</strong><small>当前尚未接入分支查询和切换。</small></span><button disabled>未确认 · Mock</button></label>
      </div>
    </section>
  );
}

/** Connections 只展示远程连接分类；不扫描网络、读取SSH配置或建立连接。 */
export function ConnectionsSettingsPreviewPage() {
  const connections = [["Computer", "从其他设备安全控制此电脑"], ["Devices", "连接并控制其他授权设备"], ["SSH", "通过 SSH 连接远程开发主机"]] as const;
  return (
    <section className="preview-page connections-settings-preview" aria-labelledby="connections-settings-heading">
      <header className="page-heading"><h1 id="connections-settings-heading">连接</h1><p>管理本机、设备和 SSH 远程连接。</p></header>
      <div className="preview-disclosure" role="note">界面预览 · Mock。不会扫描网络、读取 ~/.ssh/config 或建立连接。</div>
      <div className="connection-grid">{connections.map(([name,description]) => <article key={name}><span aria-hidden="true">{name.slice(0,2).toUpperCase()}</span><div><strong>{name}</strong><small>{description}</small><em>未连接</em></div><button disabled>设置 · Mock</button></article>)}</div>
      <div className="settings-row-list"><label><span><strong>已连接主机</strong><small>当前没有可枚举的远程连接。</small></span><button disabled>刷新 · Mock</button></label></div>
    </section>
  );
}

/** MCP 服务页只描述配置结构；不发现进程、连接服务、枚举工具或写入配置。 */
export function McpSettingsPreviewPage() {
  const transports = [["STDIO", "由本地命令启动的标准输入输出服务"], ["HTTP", "通过明确地址连接的远程服务"]] as const;
  return (
    <section className="preview-page mcp-settings-preview" aria-labelledby="mcp-settings-heading">
      <header className="page-heading"><h1 id="mcp-settings-heading">MCP 服务</h1><p>管理可向 Agent 提供工具和资源的 MCP 服务。</p></header>
      <div className="preview-disclosure" role="note">界面预览 · Mock。不会扫描进程或网络、启动命令、连接服务、读取工具列表或写入配置。</div>
      <div className="connection-grid">{transports.map(([name, description]) => <article key={name}><span aria-hidden="true">{name.slice(0, 2)}</span><div><strong>{name}</strong><small>{description}</small><em>未配置</em></div><button disabled>添加 · Mock</button></article>)}</div>
      <div className="settings-row-list">
        <label><span><strong>已配置服务</strong><small>当前预览没有读取或枚举任何 MCP 服务。</small></span><button disabled>刷新 · Mock</button></label>
        <label><span><strong>服务状态</strong><small>连接、工具数量和错误信息仅在真实接入后显示。</small></span><button disabled>无 · Mock</button></label>
      </div>
    </section>
  );
}

/** 官方 Automations 创建页的只读视觉预览；没有调度、保存或后台运行副作用。 */
export function AutomationPreviewPage() {
  return (
    <section className="preview-page automation-preview" aria-labelledby="automation-heading">
      <header className="page-heading sr-only">
        <h1 id="automation-heading">自动化</h1>
        <p>创建定期运行的开发任务。</p>
      </header>
      <div className="automation-stage">
        <article className="automation-card">
          <header>
            <strong>每日缺陷扫描</strong>
            <span className="automation-header-actions"><button disabled>清除</button><button disabled>使用模板</button></span>
          </header>
          <textarea disabled value={"扫描最近提交，查找可能的缺陷并提出最小修复。\n\n约束：\n- 仅使用仓库中的具体证据\n- 证据不足时明确跳过\n- 优先最小安全修改"} readOnly />
          <footer>
            <span>↗⌄</span><span>▱ agent-desktop⌄</span><span>◷ 每天 09:00⌄</span><span>◇ deepseek-flash⌄</span><span>···</span>
            <span className="preview-spacer" /><button disabled>取消</button><button className="primary" disabled>创建 · Mock</button>
          </footer>
        </article>
      </div>
    </section>
  );
}

/** Appearance 视觉预览复用真实 ThemePicker；颜色编辑器仅展示，不写入新的外观配置。 */
export function AppearancePreviewPage() {
  return (
    <section className="preview-page appearance-preview" aria-labelledby="appearance-heading">
      <header className="page-heading"><h1 id="appearance-heading">外观</h1><p>调整基础主题、字体和界面颜色。</p></header>
      <div className="preview-disclosure" role="note">主题切换入口可用；自定义色板和字体设置为 Mock。</div>
      <div className="appearance-layout">
        <section><h2>主题</h2><p>浅色、深色或跟随系统。</p><ThemePicker menuId="appearance-theme-menu" showLabel /></section>
        <section className="theme-code-preview" aria-label="主题代码预览"><pre>- background: #ffffff{`\n`}+ background: #111111{`\n`}- foreground: #252729{`\n`}+ foreground: #f1f1f1</pre></section>
        <section className="appearance-options">
          <label>强调色 <button disabled><span style={{background:"#9ee6a7"}} /> #9EE6A7</button></label>
          <label>背景色 <button disabled><span style={{background:"#111111"}} /> #111111</button></label>
          <label>前景色 <button disabled><span style={{background:"#f1f1f1"}} /> #F1F1F1</button></label>
          <label>界面字体 <button disabled>系统字体 · Mock</button></label>
          <label>代码字体 <button disabled>Menlo · Mock</button></label>
          <label>半透明侧栏 <button className="appearance-switch" disabled aria-label="半透明侧栏 · Mock"><span /></button></label>
          <label>对比度 <button disabled>60 · Mock</button></label>
          <label>交互元素使用指针光标 <button className="appearance-switch" disabled aria-label="指针光标 · Mock"><span /></button></label>
          <label>界面字号 <button disabled>14 px · Mock</button></label>
          <label>代码字号 <button disabled>14 px · Mock</button></label>
        </section>
      </div>
    </section>
  );
}

/** Worktree/Handoff 只读预览；不创建目录、不执行Git命令、不迁移会话。 */
export function WorktreePreviewPage({ workspaceName }: { workspaceName: string | null }) {
  const [handoffOpen, setHandoffOpen] = useState(false);
  return (
    <section className="preview-page worktree-preview" aria-labelledby="worktree-heading">
      <header className="page-heading"><h1 id="worktree-heading">Worktrees</h1><p>在独立工作副本中并行处理任务。</p></header>
      <div className="preview-disclosure" role="note">界面预览 · Mock。工作树身份、Git事务、快照恢复和清理策略尚未实现。</div>
      <div className="worktree-cards">
        <article><span>{workspaceName ? "当前" : "不可用"}</span><strong>Local</strong><p>{workspaceName ? "直接使用现有项目目录。" : "请先选择项目目录。"}</p><button disabled>{workspaceName ? "已选择" : "未选择项目"}</button></article>
        <article><span>隔离</span><strong>Worktree</strong><p>为聊天创建独立的Git工作副本。</p><button disabled>创建 · Mock</button></article>
      </div>
      <button className="handoff-preview-trigger" type="button" onClick={() => setHandoffOpen(true)}>预览 Handoff · Mock</button>
      {handoffOpen && <div className="handoff-overlay" role="presentation">
        <article className="handoff-preview" role="dialog" aria-modal="true" aria-labelledby="handoff-preview-title">
          <div><strong id="handoff-preview-title">Hand off to Local</strong><p>把当前聊天和代码移动到本地工作区。</p></div>
          <dl><dt>目标项目</dt><dd>{workspaceName ?? "未选择项目"}</dd><dt>分支</dt><dd>未确认</dd></dl>
          <footer><button type="button" onClick={() => setHandoffOpen(false)}>取消预览</button><button className="primary" disabled>Hand off · Mock</button></footer>
        </article>
      </div>}
    </section>
  );
}

/** 归档页面视觉预览；没有归档字段、恢复命令或删除操作。 */
export function ArchivedChatsPreviewPage() {
  return (
    <section className="preview-page archived-preview" aria-labelledby="archived-heading">
      <header className="page-heading"><h1 id="archived-heading">已归档聊天</h1><p>查看和恢复已经移出侧栏的聊天。</p></header>
      <div className="preview-disclosure" role="note">界面预览 · Mock。当前数据库没有归档状态或恢复命令。</div>
      <div className="archived-empty"><strong>尚无已归档聊天</strong><p>归档功能实现后，聊天会显示在这里。</p></div>
    </section>
  );
}

/** Cloud环境设置只读预览；不连接账号、不创建容器、不发布配置或Vault。 */
export function CloudEnvironmentPreviewPage({ workspaceName }: { workspaceName: string | null }) {
  return (
    <section className="preview-page cloud-preview" aria-labelledby="cloud-heading">
      <header className="page-heading"><h1 id="cloud-heading">环境</h1><p>选择本机或Cloud作为新聊天的执行位置。</p></header>
      <div className="preview-disclosure" role="note">界面预览 · Mock。Cloud账号、容器、Vault、发布和恢复尚未实现。</div>
      <div className="environment-picker-preview">
        <article><span>{workspaceName ? "可用" : "不可用"}</span><strong>本机</strong><p>{workspaceName ?? "未选择项目"}</p><button disabled>{workspaceName ? "当前环境" : "请先选择项目"}</button></article>
        <article><span>Mock</span><strong>Cloud</strong><p>在隔离的托管环境中运行任务。</p><button disabled>选择环境 · Mock</button></article>
      </div>
      <section className="environment-setup-preview"><header><strong>Cloud environment setup</strong><button disabled>发布 · Mock</button></header><div><label>仓库<input disabled value={workspaceName ?? "未选择项目"} readOnly /></label><label>Setup script<textarea disabled value={"npm install\nnpm run build"} readOnly /></label><label>Secrets / Vault<input disabled placeholder="尚未连接" /></label></div></section>
    </section>
  );
}
