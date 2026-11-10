# Agent Desktop 对齐 Codex 桌面界面的调研与实施建议

日期：2026-11-06
范围：只读调研与实施建议；未修改产品代码、未引入依赖、未运行付费模型、未新增测试。

## 结论先行

用户要求的“和 Codex 一模一样”是本轮最终视觉验收目标。对 OpenAI 已公开截图的区域，应按同尺寸逐区域、逐像素迭代；对没有公开完整截图的状态，应沿同一视觉系统自行设计、保留证据限制并继续迭代，不能把目标主动降低为“同类产品体验”。同时保留 Agent Desktop 自有品牌，不复制 OpenAI/Codex 名称、标志或专有图形；未实现按钮必须禁用并显式标为 Mock。

现有项目已经具备较好的骨架，不需要换框架：左侧项目/任务导航、中央对话、底部 composer、流式执行时间线、权限交互、终端、只读改动视图、浅深主题和本地持久化都已存在。最小风险路线是继续使用 React + CSS，先重排现有界面，再逐项补足真正缺失的产品能力。项目约定本身也要求复用现有 React/CSS、窄 preload 接口，不为样式改造引入 UI 框架（[DESIGN.md](../DESIGN.md#9-性能与实现约束)；[package.json](../package.json)）。

不建议一次性“大改成 Codex”。应拆成四层：

1. **可直接做的视觉与布局对齐**：只涉及现有组件、CSS 和真实已有状态。
2. **已有能力的交互重组**：终端、改动、项目、权限、执行时间线换到更接近 Codex 的位置。
3. **需要新增状态模型的能力**：工作树、分支/环境切换、附件/上下文、计划模式、任务归档等。
4. **只能显式Mock的能力**：自动化、云端项目、插件市场、套餐/统计、跨设备远程控制；当前项目没有对应后端，可以对齐页面结构，但所有有副作用的控件必须禁用并可见标注Mock，不能展示占位成功结果。

## 证据范围与限制

### 本地事实

- 当前已实现能力与边界以 [README.md](../README.md) 为准：任务持久化、项目目录、真实模型流、权限模式、执行时间线、终端、只读 Git 改动、主题和设置均已实现；自动化、插件市场、多供应商、套餐或统计页面未实现。
- [DESIGN.md](../DESIGN.md#4-信息架构与布局) 已规定两区主布局、状态真实投影、最小窗口、焦点、输入法、权限说明和性能边界，这些约束应保留，而不是为了视觉相似而回退。
- 当前界面入口集中在 [App.tsx](../apps/desktop/renderer/src/App.tsx)、[ExecutionTimeline.tsx](../apps/desktop/renderer/src/ExecutionTimeline.tsx)、[DeveloperPanel.tsx](../apps/desktop/renderer/src/DeveloperPanel.tsx)、[TerminalPanel.tsx](../apps/desktop/renderer/src/TerminalPanel.tsx) 和 [style.css](../apps/desktop/renderer/src/style.css)。现有页面已包含可折叠侧栏、项目/任务搜索、标题栏状态、宽幅阅读、composer、终端/改动双视图。
- 最近一轮界面验收已覆盖正文分层、项目导航、草稿恢复、改动审阅和最小窗口，但 Provider、PTY、剪贴板与系统编辑器的一部分使用替身；不能把该记录当成全链路视觉/宿主兼容证明（[workspace-ui-verification.md](../docs/workspace-ui-verification.md)）。

### Codex 一手资料

- OpenAI 官方将桌面应用描述为可在同一工作区并行处理项目和长任务、检查真实文件产物、使用浏览器/桌面应用/插件并调度任务；新任务可从项目、文件夹或普通聊天开始（[ChatGPT desktop app](https://learn.chatgpt.com/docs/app)）。
- 官方长任务材料把 Codex 日常工作面概括为并行 threads、skills、automations 和 Git worktrees；核心循环是计划、编辑、运行工具、观察、修复和持续验证（[Run long horizon tasks with Codex](https://developers.openai.com/blog/run-long-horizon-tasks-with-codex)）。
- 官方平台说明明确区分 UI 与 harness：harness 负责会话、流式执行、工具、边界、审批和恢复，应用负责业务上下文与用户工作流；官方也直接建议不要仅仅“换 logo 复刻 Codex”，而应围绕实际工作流设计（[Codex as a platform](https://developers.openai.com/blog/codex-as-a-platform)）。
- Worktree 不是一个样式开关。官方定义了 Local/Worktree、起始分支、detached HEAD、Handoff、快照恢复和自动清理等真实生命周期（[Worktrees](https://learn.chatgpt.com/docs/environments/git-worktrees)）。因此在本项目没有状态机、Git事务和恢复策略之前，只能提供禁用、显式标注Mock的视觉预览，不能让按钮产生目录或Git副作用。

无法通过自动化接口读取当前正在运行的 Codex/ChatGPT 原生窗口（系统对该应用禁止自动化访问）。因此本报告对“当前 Codex”只采用 OpenAI 官方文档、公开截图及可验证产品说明；不声称获得了私有设计规范或完整像素值。

## 页面、面板与状态证据矩阵

### 分级口径

- **A：有官方截图。** 官方页面提供真实产品位图，或以 `data-documentation-screenshot-presentation` 标记、同时给出 source width/aspect ratio 的 canonical UI 截图呈现。后者由官方页面内嵌 HTML/CSS 绘制，没有可单独访问的 PNG/JPEG；矩阵会明确写“无独立位图”，不会伪造图片 URL。
- **B：有官方文字，无满足 A 口径的截图。** 页面可能有概念插图或局部交互示例，但不足以据此复刻完整页面。
- **C：仅推断或不得复刻。** 没有官方证据，或属于品牌/私有设计系统；不能据此宣称当前 Codex 的确定行为。

矩阵中的“可观察布局”只描述官方视觉直接展示的内容，不把文字说明反推成像素布局。直接位图分辨率通过网络流读取文件头获得，未保存图片到仓库或本机文件。

| # | 页面 / 面板 × 状态 | 级别 | 官方文字证据 | 官方视觉 / 图片 URL | 分辨率与可观察布局 | Agent Desktop 映射与边界 |
|---:|---|:---:|---|---|---|---|
| 1 | 主导航 / 项目与聊天 | A | [Projects and chats](https://learn.chatgpt.com/docs/projects#organize-projects-and-chats) 说明项目、并行聊天、置顶、搜索和归档 | [官方页面内嵌截图](https://learn.chatgpt.com/docs/projects#work-in-a-project)；无独立位图 | 浅/深均为 1172×660 source。左侧项目/聊天行含置顶、运行/进行中状态和时间，项目组下有文件夹 | 已有项目入口、任务搜索、状态点、分页和最近恢复；可重排侧栏，但归档/置顶须新增真实存储状态 |
| 2 | 新聊天空态 / Composer | A | [Desktop app](https://learn.chatgpt.com/docs/app#get-started-with-the-desktop-app) 说明从 New chat、项目或文件夹开始并添加文件/上下文 | [官方浅色位图](https://learn.chatgpt.com/images/codex/app/codex-app-basic-light.webp)；[官方深色位图](https://learn.chatgpt.com/images/codex/app/codex-app-basic-dark.webp) | 两图均为 3600×2026。可见居中欢迎标题、三行 Composer、建议任务、左侧项目/聊天导航和顶栏 Git 操作 | 已有欢迎空态、建议提示、项目/模型/权限/发送；可以该图为第一阶段主基准，但不应补造附件和环境选择成功态 |
| 3 | 运行中 / Goal 控件 / 停止 | A | [Long-running work](https://learn.chatgpt.com/docs/long-running-work#steer-running-work) 说明同一聊天持续引导运行任务 | [官方页面内嵌截图](https://learn.chatgpt.com/docs/long-running-work#start-a-goal)；无独立位图 | 浅 1978×1114，深 2004×1128。Goal 条位于 Composer 上方；底栏含 Auto-review、Goal、模型、effort、麦克风和停止按钮 | 已有真实运行状态、当前动作、停止和清理确认；可对齐层级，但没有持久 Goal 状态，不得把普通 Run 改名冒充 Goal |
| 4 | 运行中 follow-up：Queue / Steer | B | [官方工程文章](https://developers.openai.com/blog/mastering-codex-remote-for-engineering#2-learn-the-difference-between-queue-and-steer) 明确 Queue 等当前 turn 完成、Steer 中途改变方向，并可在设置中选默认值 | 无 Queue/Steer 桌面截图；该文章相关位图均为 Remote 移动端其他场景 | 无法确认桌面按钮位置、菜单形态和排队消息样式 | 当前运行中禁止再次发送，没有 queued/steering command 与顺序语义；必须先设计协议和恢复规则，不能只解锁输入框 |
| 5 | 权限模式 / 审批请求 | B | [Permission modes](https://learn.chatgpt.com/docs/permission-modes) 与 [Agent approvals & security](https://learn.chatgpt.com/docs/agent-approvals-security#sandbox-and-approvals) 说明 Ask、Approve for me、Full access 和越界审批 | [官方交互示例](https://learn.chatgpt.com/docs/permission-modes#choose-a-mode) 显示权限模式，但不是完整审批请求截图；无独立位图 | 可确认模式选择包含 Approve for me 与 Full access；不能据此确定命令/工具审批卡完整布局 | 已有 ask/auto_review/full_access 和逐调用 Interaction，且语义更明确；只调整视觉，不削弱对象、命令、目录、数据去向与拒绝入口 |
| 6 | Agent 向用户提问 | B | [Long-running work](https://learn.chatgpt.com/docs/long-running-work#start-a-goal) 说明需要澄清时会 follow up；官方长任务文章也说明 Plan mode 会提问 | 无专门的桌面“提问卡”截图 | 无法确认选项、自由输入、取消与过期态的官方视觉 | 已有 input interaction、选项和文本回答；保留请求身份、pending 与错误处理，不按无证据样式重写 |
| 7 | Diff / Review / 行内评论 | A | [Code review](https://learn.chatgpt.com/docs/code-review?surface=app#review-in-the-app) 说明 scope、inline comments、stage/revert、编辑器打开和 findings | [官方内嵌 review 截图](https://learn.chatgpt.com/docs/code-review?surface=app#code-review-results)（浅 1063×598、深 1057×594，无独立位图）；[Remote diff 实图](https://developers.openai.com/images/blog/mastering-codex-remote-inline-review.jpg) | 位图 1200×859。可见分文件 diff、行级评论；内嵌图显示优先级标签、标题、Dismiss 与评论正文 | 已有只读Git快照、文件定位和系统打开；stage/revert/commit/行内评论仅显示禁用Mock，真实写能力仍未实现 |
| 8 | 集成终端 | A | [Integrated terminal](https://learn.chatgpt.com/docs/integrated-terminal) 说明每个 chat 的项目范围终端、抽屉、清理与 Agent 可读取输出 | [官方页面内嵌截图](https://learn.chatgpt.com/docs/integrated-terminal)；无独立位图 | 浅/深均 1962×1104。终端抽屉在聊天下方，属于同一 chat 工作区 | 已有真实 PTY、会话标签、尺寸同步和清理，但当前明确“不发送到模型”；不能复制“Agent 可读终端输出”承诺，除非新增受控上下文通道 |
| 9 | 文件树 / 来源侧栏 | B | [Work with files](https://learn.chatgpt.com/docs/artifacts-viewer) 与 [Troubleshooting](https://learn.chatgpt.com/docs/reference/troubleshooting#files-appear-in-the-side-panel-that-codex-didnt-edit) 证明存在文件侧面板且可能展示 Codex 未编辑文件 | 无满足 A 的独立文件树截图 | 官方文字不足以确定树层级、筛选、选择态、文件状态图标和刷新行为 | 已加入右侧文件树Mock，全部项目禁用，不读取目录或开放文件；真实能力仍需有界目录协议 |
| 10 | 文件 / 产物预览 | A | [Work with files](https://learn.chatgpt.com/docs/artifacts-viewer) 说明文档、表格、演示、PDF、HTML、LaTeX 预览和 annotation | [官方页面内嵌截图](https://learn.chatgpt.com/docs/artifacts-viewer#create-files-for-review)；无独立位图 | 浅/深均 3984×2696。聊天旁为大幅演示文稿预览，属于并列审阅工作面 | 已加入缩略页、工具栏、批注层级和大幅预览Mock；不加载用户文件、不执行HTML或脚本 |
| 11 | Settings 总体与 Appearance | A | [Settings](https://learn.chatgpt.com/docs/reference/settings) 列 General、Profile、Shortcuts、Notifications、Appearance、Browser、Computer Use、Personalization、Archived chats 等 | [Appearance 官方内嵌截图](https://learn.chatgpt.com/docs/reference/settings#appearance)；[官方主题对照位图](https://learn.chatgpt.com/images/codex/app/themes-side-by-side.webp) | 内嵌图浅 2385×1385、深 2384×1385；直接位图展示四套主题的设置页。可见主题、强调/背景/前景颜色与 UI/代码字体 | 已有真实模型/插件页与Appearance/Environment/Worktrees/Archived等显式Mock；未实现操作均禁用 |
| 12 | Plugins 目录 / 安装 | A | [Plugins](https://learn.chatgpt.com/docs/plugins#universal-plugin-directory) 说明 OpenAI、workspace、Personal、Installed 分组、详情、安装、连接和卸载 | [官方插件目录位图](https://learn.chatgpt.com/images/codex/plugins/directory.webp)；补充 [Composer 内引用实图](https://developers.openai.com/images/blog/mastering-codex-remote-skills-plugins.jpg) | 目录位图 4924×3088，可见 Plugins/Skills 顶部切换、来源筛选、搜索、推荐横幅、分类双列列表、安装状态与管理入口；补充位图 1206×966 | 当前是本地受信任插件安装/启停/排序/卸载，与公共市场不同；可以借鉴目录层级，但禁止把本地目录包装成“Universal plugin directory” |
| 13 | Skills 浏览 / 选择 | A | [Build skills](https://learn.chatgpt.com/docs/build-skills#how-chatgpt-and-codex-use-skills) 说明桌面侧栏 Skills、显式/隐式调用及本地加载位置 | [Skills picker 官方内嵌截图](https://learn.chatgpt.com/docs/build-skills)；无独立位图；补充 [Remote inline 实图](https://developers.openai.com/images/blog/mastering-codex-remote-skills-plugins.jpg) | 内嵌图浅/深均 1762×992；直接位图 1206×966。可确认 Skills picker 与 Composer 内引用是不同表面 | 插件页已有Skills目录Mock，所有添加/创建禁用；不发现、加载或执行SKILL.md |
| 14 | Automations / Scheduled | A | [Scheduled tasks](https://learn.chatgpt.com/docs/automations) 说明 Scheduled 状态、recent runs、事件触发、Run now、worktree 隔离和权限 | [官方创建页浅色位图](https://learn.chatgpt.com/images/codex/app/codex-automations-light.webp)；[官方创建页深色位图](https://learn.chatgpt.com/images/codex/app/codex-automations-dark.webp) | 两图均 978×551。可见标题、Prompt、Grounding rules、项目、频率、模型、更多选项以及 Cancel/Create；仍没有完整 Scheduled 列表、运行历史和失败态截图 | 当前没有调度器、通知、宿主休眠恢复和重复执行模型；允许创建页视觉Mock，但模板、取消、创建均须禁用 |
| 15 | 搜索 / 归档 / 置顶 | B | [Projects and chats](https://learn.chatgpt.com/docs/projects#organize-projects-and-chats) 明确 Search chats、pin project/chat、archive 与 Settings 恢复；[Settings](https://learn.chatgpt.com/docs/reference/settings#archived-chats) 说明归档列表 | 主导航截图可见 pin 图标，但没有完整搜索、归档列表或确认/恢复页面截图 | 只能确认功能存在，不能确定搜索结果分组、归档动作反馈和置顶排序细节 | 已有标题/正文搜索和改名；归档/置顶需要 SQLite 字段、查询、撤销/恢复语义，不能作为纯样式项 |
| 16 | Local / Worktree 选择与分支 | A | [Worktrees](https://learn.chatgpt.com/docs/environments/git-worktrees#getting-started) 定义 Local、Worktree、起始分支、detached HEAD、清理和恢复 | [官方内嵌截图](https://learn.chatgpt.com/docs/environments/git-worktrees#option-1-working-on-the-worktree)（1424×802，无独立位图）；[Remote 目标选择实图](https://developers.openai.com/images/blog/mastering-codex-remote-worktree-branch.jpg) | 位图 1189×1200。可见 host/repository/worktree/environment 的分层选择；内嵌图显示 Create branch dialog | 当前仅单工作区路径。允许禁用的选择页Mock；真实能力仍必须新增Workspace/Checkout身份、Git事务、磁盘/清理、终端绑定和恢复 |
| 17 | Cloud 环境选择 / 配置 | B | [Cloud environments](https://learn.chatgpt.com/docs/environments/cloud-environments#start-a-task-in-codex-cloud) 说明 Work in > Cloud、environment、配置、发布、vault 和运行恢复 | [官方环境 picker 插图](https://learn.chatgpt.com/docs/environments/cloud-environments#start-a-task-in-codex-cloud) 与 [setup 插图](https://learn.chatgpt.com/docs/environments/cloud-environments#create-and-publish-an-environment)；均为 HTML/CSS illustration，无独立位图、未标 source 分辨率 | 可观察 picker 搜索、保存环境、Create/Manage，setup 为聊天与配置双栏；它们不是产品截图，不能当像素基准 | 项目定位是本地优先且无云执行控制面；不实现 Cloud 占位，不把远程模型调用等同云环境 |
| 18 | Handoff（Local ↔ Worktree） | A | [Worktrees](https://learn.chatgpt.com/docs/environments/git-worktrees#option-2-handing-a-chat-off-to-local) 说明移动 chat 与 code、同一 worktree 关联及 Git 限制 | [官方页面内嵌截图](https://learn.chatgpt.com/docs/environments/git-worktrees#option-2-handing-a-chat-off-to-local)；无独立位图 | 浅 1748×984、深 1748×983。居中确认 dialog，显示目标 local workspace、分支和 Hand off 主按钮 | 当前没有移动代码/会话的事务语义；必须与 Worktree 一并设计，不能做普通“切换项目”别名 |
| 19 | 浅色 / 深色 / 自定义主题 | A | [Settings > Appearance](https://learn.chatgpt.com/docs/reference/settings#appearance) 明确 base theme、颜色和 UI/code fonts | 同 #11 的 [Appearance 官方内嵌截图](https://learn.chatgpt.com/docs/reference/settings#appearance)；[官方主题对照位图](https://learn.chatgpt.com/images/codex/app/themes-side-by-side.webp) | 内嵌截图提供浅 2385×1385、深 2384×1385 source；直接位图并列展示四种主题，但仍不公开完整 token | 已有 light/dark/system 与 CSS 变量；可对齐层级和对比度，不复制未公开 token，也不需要新增主题依赖 |
| 20 | 错误、卡住与恢复 | B | [Troubleshooting](https://learn.chatgpt.com/docs/reference/troubleshooting#stuck-states-and-recovery-patterns) 说明 stuck recovery；同页说明选错 Local/Worktree/Cloud 后取消并用 ↑ 恢复 prompt、终端卡住时等待活动 chat 完成后重启 | 无统一错误/恢复页面截图 | 无法确认错误 banner、retry、恢复入口和未知结果的完整视觉；不同故障不应套一个万能卡片 | 已有连接/存储/协议/模型/工具/未知结果等精确状态；继续遵循 DEBUG.md，不能为相似度合并成含糊“Something went wrong” |
| 21 | Codex/OpenAI 品牌资产与完整像素 token | C | 官方功能文档不授予 Agent Desktop 使用 Codex 名称、Logo 或私有设计 token | 无可作为复制授权的图片 URL | 公开截图只能观察局部，不能推出完整组件规范、动画曲线或全部尺寸 | 只对齐工作流与层级；保留 Agent Desktop 自有名称和资产，不声称“官方 Codex UI” |

### 覆盖统计

- **总项数：21**。
- **A（有官方截图）：13**：主导航、空态 Composer、运行中 Goal、Diff/Review、终端、文件预览、Settings/Appearance、Plugins 目录、Skills、Automations 创建页、Local/Worktree、Handoff、浅深主题。部分项目共享同一官方截图，但对应不同页面状态，分别计入矩阵项。
- **B（官方文字充分但无对应完整截图）：7**：Queue/Steer、审批、提问、文件树、搜索/归档/置顶、Cloud、错误恢复。
- **C（仅推断/不得复刻）：1**：品牌资产与完整私有设计 token。
- **仍缺视觉页：7 项**：运行中 Queue/Steer、真实审批卡、提问卡、桌面文件树、搜索/归档管理页、Cloud 真实截图、错误恢复状态。Automations 目前只覆盖创建页，列表、运行历史和失败态仍属于局部缺图，但不再把整个页面记为缺少视觉证据。

这意味着当前证据足以设计**主导航、对话运行态、Composer 基础层级、Review、终端、设置主题与 Worktree/Handoff 的能力边界**；不足以声称已经掌握 Codex 的全量页面视觉。缺图项不再要求用户补资料：本项目应沿已验证的 Codex 视觉语言自行设计并持续迭代，但只有公开证据区域完成同尺寸对照、缺图区域完成一致性走查且正式实例验证后，才能判断最终验收是否达标。

## 目标界面模型

建议把主窗口整理为以下五个稳定区域：

| 区域 | Codex 式职责 | Agent Desktop 当前基础 | 建议 |
|---|---|---|---|
| 全局侧栏 | 新建聊天、项目分组、聊天状态、搜索/归档入口 | 项目入口、无项目对话、分页任务、搜索、改名 | 保留真实数据，去掉“后台管理表格感”；按项目分组显示近期任务，分页改为滚动加载或“加载更多”前需先评估 SQLite 查询和可访问性 |
| 聊天顶栏 | 聊天标题、运行环境、分支/工作树、打开目标、更多操作 | 标题、宽幅、终端入口、运行状态 | 将状态与环境拆开：标题居左；项目/环境事实居中或标题下；终端/改动/停止放右侧。没有 worktree 时只显示“本地目录”，不做假选项 |
| 对话工作面 | 用户意图、Agent 正文、按需展开的工具过程、审批与错误 | 已有消息、时间线、审批、验收、Minimap | 继续使用现有真实 Timeline；进一步降低普通模型步骤的视觉权重，审批/失败/未知保持突出 |
| Composer | 上下文、模式/模型/权限、输入、附件、发送/停止 | 项目、权限、模型、展开输入、草稿、发送/停止 | 第一阶段只重排现有控件；附件和计划模式必须等协议与持久化能力确认后再加 |
| 审阅面板 | diff、终端、文件/产物预览、在编辑器打开 | 终端 + 只读改动、受限系统打开 | 保持右侧可调面板，强化“改动”默认审阅路径；文件树或产物预览需另立真实需求，不能留空面板 |

### 视觉基线

视觉上建议靠近 Codex 的“低饱和桌面工具”而非复制品牌资产：

- 左侧 240–264px 的哑光侧栏，主工作面无厚重卡片边框；窗口层级主要依靠背景差和细分隔线。
- 正文列保持约 760–840px，宽幅模式再放大；工具输出和 diff 可占更宽区域。
- 用户消息为低饱和紧凑气泡；Agent 正文无头像、无大卡片。执行过程作为正文之间的可折叠 items，而不是独立“监控仪表盘”。
- Composer 是视觉锚点：圆角 14–18px，输入与上下文/权限/模型工具栏属于一个整体；发送与停止必须是同一位置的互斥状态。
- 继续使用现有系统字体、CSS 变量、浅深主题和本地图标方案。不要复制 Codex/OpenAI logo，也不要使用“Codex”作为产品名。

当前 [style.css](../apps/desktop/renderer/src/style.css) 已有多数基础 token，但存在两项视觉债务：侧栏信息密度仍像管理后台，分页按钮割裂任务浏览；工作面外层圆角边框较重，使主界面更像嵌套卡片。它们都能在不引入依赖的情况下调整。

## 能力差距：哪些不能只改 CSS

| 能力 | 当前状态 | 若要对齐所需工程工作 | 结论 |
|---|---|---|---|
| 项目/聊天导航 | 已有项目隔离、搜索、分页、最近恢复 | 重做侧栏投影和加载交互；复用现有 SQLite 查询 | 可优先做 |
| 运行状态与停止 | 已有真实状态、等待授权、停止和清理 | 仅重排层级，不能改状态语义 | 可优先做 |
| 工具执行 items | 已有稳定 ID、状态、详情和折叠 | 调整展示密度；保持错误、未知、审批强可见 | 可优先做 |
| 终端与 Git 改动 | 已有真实 PTY 和只读 diff | 优化面板入口、空态和文件定位；不改变权限边界 | 可优先做 |
| 环境/分支/Worktree | 只有一个选定工作区；无隔离工作副本生命周期 | 新建 Workspace/Checkout 身份、Git 事务、并发约束、磁盘配额、恢复/清理、Handoff；需要协议和 SQLite schema 设计 | 可先做禁用且显式标注的页面Mock；真实能力单独立项 |
| 计划模式 | 现有 timeline 可显示计划，但没有独立协作模式状态机 | 模式配置、提问阶段、只读/可写边界、运行接纳时冻结、恢复语义 | 单独设计，禁止只换提示词宣称完成 |
| 附件/文件引用 | 当前 composer 只有文本；需求记录明确无附件对象 | 文件选择、大小/类型/链接校验、持久化身份、模型外发确认、删除与恢复语义 | 单独设计 |
| 归档/置顶 | 当前有改名和项目分页，未见完整归档/置顶模型 | SQLite 字段、查询排序、撤销/恢复和跨项目语义 | 可作为小型真实功能，但非纯 UI |
| 自动化/计划任务 | 未实现 | 调度器、持久化、并发/重复执行、宿主休眠、权限、通知、审计 | 创建页可显式Mock；真实调度不在本轮范围 |
| 多供应商/账号/云端 | 未实现 | 身份、密钥、计费、远端执行和数据治理 | 只允许禁用且显式标注的视觉Mock |

## 推荐实施顺序

### 第 0 阶段：采用固定官方基准（已完成调研，不再要求用户提供截图）

为避免把参考资料收集转嫁给用户，本方案自行冻结以下基准：

- 视觉主基准：OpenAI 官方 `codex-app-basic-light.webp`，原图 3600×2026，来源为官方 Codex 发布记录中的“project sidebar, thread list, and review pane”截图（[官方图片](https://learn.chatgpt.com/images/codex/app/codex-app-basic-light.webp)；[发布记录](https://learn.chatgpt.com/docs/changelog#introducing-the-codex-app)）。
- 交互事实：项目/聊天组织、Local/Worktree/Cloud、Review、终端和权限分别以当前 OpenAI Docs 为准；图片只用于推导布局，不用于猜测后台行为。
- 本项目基线：`docs/evidence/workspace-ui/default.png` 及同目录浅色、最小窗口、改动面板截图。
- 冻结日期：2026-11-06。后续 Codex 产品更新不自动进入本轮范围，避免目标漂移。

官方没有公开完整设计 token，以下像素是从官方 3600×2026 截图按应用窗口比例推导的工程基线，不声称是 OpenAI 内部规范：

| 项目 | 建议基线 | 落地说明 |
|---|---:|---|
| 侧栏宽度 | 236px，允许 224–264px | 现有侧栏保留折叠能力；最小窗口时不压缩 Composer |
| 主内容最大宽度 | 空态 720px；对话 820px | 工具输出、diff 不受正文宽度限制 |
| 顶栏高度 | 52px | 左侧标题，右侧终端/改动/停止；不用大标题栏 |
| Composer 宽度 | 680–720px | 空态居中；有消息时固定在底部 |
| Composer 圆角 | 16px | 输入区和两行工具栏为一个整体，不叠多层卡片 |
| Composer 内边距 | 12px 14px | 第一行文本，第二行权限/模型，第三行项目/环境事实可按空间折行 |
| 普通控件高度 | 28–32px | 图标按钮最小命中区仍保持 32px，并保留焦点轮廓 |
| 视觉分隔 | 1px 低对比边线 | 去掉当前主工作面的厚边框与过强圆角容器 |

本轮对齐矩阵由项目事实直接决定：

- **直接对齐**：侧栏密度、空态、顶栏、Composer 结构、消息层级、终端/改动入口。
- **语义替代**：官方 `Work locally + main` 改为本项目真实的“本地目录 + 当前可确认 Git 分支”；取不到分支时显示“分支未确认”，不猜测。
- **显式Mock**：Worktree/Handoff、Automations、插件市场、Commit/暂存/还原/行内评论可以显示，但必须禁用、可见标注Mock且不产生副作用。Cloud、附件等没有当前页面需求或证据不足的能力暂不显示。
- **保留自有品牌**：名称继续使用 Agent Desktop，不复制 Codex/OpenAI 标志或专有插图。

这一阶段不需要用户补充视觉资料，也没有外部依赖。

### 第 1 阶段：外壳和信息层级对齐（低风险）

范围：只重排已实现能力，不改 Runtime 语义。

- `App.tsx`：把主外壳拆成可维护的 `Sidebar`、`ChatHeader`、`Composer` 组件（仅当拆分能减少现有 700+ 行组件职责混杂；不要建立通用页面框架）。
- `style.css`：统一侧栏、顶栏、正文、composer 和右侧面板 token；减轻工作面外框；压缩任务导航密度；保留 1000×680 最小窗口。
- `ExecutionTimeline.tsx`：普通步骤更克制，运行中动作、待授权、失败、结果未知保持展开或明显。
- `DeveloperPanel.tsx`：将“改动”提升为与终端同级的明确审阅入口；保持两个视图切换不销毁 PTY。
- `DESIGN.md`：只同步已确认、稳定的设计决定，不把目标截图写成已实现能力。

验收重点：浅/深主题、空/加载/运行/审批/失败/停止、长中文/长路径、键盘焦点、中文输入法、最小窗口、滚动跟随和右侧面板。按项目约定不新增单元测试，执行类型检查、构建、现有受控链路并实际查看界面。

### 第 2 阶段：导航和审阅工作流（中风险）

- 用现有项目/会话查询实现 Codex 式项目分组与近期任务；先测量分页改成滚动加载后的 DOM 和查询成本，历史列表必须有界或虚拟化。若需要虚拟列表依赖，须先按项目审批规则比较原生实现和成熟库，得到用户批准后再引入。
- 增加真正的归档/置顶前，先在 `packages/protocol`、Runtime command、SQLite schema 和恢复查询中定义状态；UI 不拥有事实。
- 改动审阅增加文件级定位、比较基准和失败原因，但继续明确“只读快照、归属可能未知”；不要把刷新后的 diff 误说成应用所有改动的事务快照。

### 第 3 阶段：环境能力（高风险，独立 PRD）

如果用户真正需要 Codex 的 Local/Worktree/Handoff，再单独设计。至少需要：

- `Project`、`Workspace`、`Checkout`/`Worktree`、`Session` 的身份关系；不能继续把项目路径当成唯一工作区身份。
- Git 仓库检测、起始引用、dirty tree 处理、detached HEAD、分支占用、Handoff 冲突和回滚。
- 每个工作树的依赖/缓存/磁盘成本、并发上限、清理策略与删除前快照。
- Runtime 进程、终端、工具权限和会话恢复绑定到具体 Workspace ID，而不是只绑定显示路径。
- 创建、迁移、清理过程的取消、超时、崩溃恢复和审计；任何未知结果保持未知。

这不是 UI 模仿任务，而是核心架构扩展。建议先写 ADR/领域模型和失败场景，再决定是否复用 Git CLI 或其他库；发现候选依赖后必须先提交选型比较并等待批准。

### 第 4 阶段：composer 上下文与协作模式（高风险，按需求选择）

附件、文件引用、计划模式和更多上下文选择分别立项。每一项都需要协议验证、持久化、外发说明、取消/恢复语义及模型上下文构造，不能把前端 chip 当作已发送成功。

## 架构批判与最小改进建议

### 1. `App.tsx` 已出现职责拥挤

它同时拥有页面路由、侧栏、任务搜索/改名、窗口布局、聊天滚动、composer、开发面板和设置入口。继续把 Codex 式界面全部堆进同一文件会增加交互回归和状态耦合。建议只沿稳定视觉职责拆 3–4 个组件，状态仍由现有 hook 和父级协调；不要同时引入全局状态库或设计系统。

### 2. 侧栏分页是数据边界正确、交互表达笨重

当前每页 20 条能限制查询和 DOM，工程上是安全的；但“上一页/下一页”更像后台管理系统，不像持续工作的桌面助手。建议保留分页协议，在 renderer 上换成“加载更多/逐页追加”投影，并设置最大驻留条数或窗口化。这样不需要立即改数据库，也不会为相似度牺牲资源边界。

### 3. 当前右侧面板方向正确，不应为像 Codex 再造一套

已有终端/改动共享面板、宽度保存、Git 只读快照和系统打开边界。后续应深化这一模块，而不是新增第二个“Review”实现。Codex 式体验的关键是从聊天结果能定位到审阅对象，不是面板名称。

### 4. 不要让 Worktree Mock 产生真实副作用

Worktree 会改变并发、路径、Git状态、终端、缓存和恢复责任。视觉预览必须禁用并醒目标注Mock；只有完整状态机和恢复策略落地后，才可以启用创建、切换或Handoff操作。

## 性能、安全与成本判断

- **性能**：第一阶段主要是 DOM/CSS 重排，几乎不增加模型、存储或进程成本。侧栏改无限滚动时必须保持查询与 DOM 有界；流式消息不能因新布局每 token 重算全历史。
- **存储**：归档/置顶是小幅 schema 成本；附件和工作树会显著增加文件、索引、快照和清理成本，需单独预算。
- **计算**：终端/改动双面板继续保持组件不重复启动；隐藏视图避免不必要轮询。Minimap、ResizeObserver 和流式渲染要合并布局测量。
- **安全**：renderer 仍不能获得通用 shell/文件系统接口；所有环境、文件、打开和 Git 操作经窄协议校验。视觉上的禁用/隐藏不替代 Runtime 授权。
- **费用与数据**：纯 UI 改造不应触发模型请求。附件、文件引用、Web/插件能力必须在发送前说明会外发什么数据；不能因追求 Codex 相似度默认扩大数据范围。

## 验收口径

建议把“像 Codex”转成可检查的验收项，而不是主观一句话：

1. **结构**：目标截图中的五个区域和主次关系一致；本项目无真实能力的控件不存在。
2. **状态**：空、连接中、未配置、运行、审批、提问、停止中、失败、未知、完成、存储失败均来自真实投影。
3. **操作**：键盘可完成新建任务、选择任务、输入、发送/停止、审批、打开改动/终端；Escape/焦点恢复正确。
4. **窗口**：1000×680 不遮挡发送、停止、审批和保存；长路径、长命令、长中文不撑破主窗口。
5. **主题与可访问性**：浅深主题、焦点轮廓、对比度、减少动态效果和读屏状态不退化。
6. **性能**：长会话和多任务侧栏保持有界；流式过程中无明显布局抖动或全历史重复解析。
7. **安全**：没有新通用 IPC、没有 renderer 直连文件系统/密钥/shell、外部内容仍按不可信文本处理。
8. **证据**：在同尺寸下保存目标/实现对照截图，同时记录类型检查、构建、实际界面操作和未覆盖项；构建通过不等于视觉验收。

## 2026-11-06 官方 Settings 增量核对

[OpenAI 官方 Settings 文档](https://learn.chatgpt.com/docs/reference/settings)明确列出 Appearance 的基础主题、强调色、背景色、前景色、UI/代码字体，以及半透明侧栏、对比度、指针光标、UI 字号和代码字号。当前实现仅让基础主题切换真实生效，其余字段均以禁用 Mock 呈现，避免把尚未持久化的外观配置伪装成可用能力。

## 最终建议

建议直接实施第 1 阶段，不再等待用户补参考图，也不要一次铺开完整 Codex 能力集合。它能在不新增依赖、不扩大权限、不改核心 Runtime 的情况下，让 Agent Desktop 的视觉和主工作流明显接近 Codex，同时为后续真实能力留下正确接口。

第 1 阶段完成后，再根据使用反馈二选一：

- 如果重点是个人本地 Coding Agent：优先深化改动审阅、项目导航和 composer 上下文。
- 如果重点是并行长任务 Harness：优先立项 Workspace/Worktree/Handoff 架构，不应继续在单目录会话模型上堆 UI。

两条路线资源投入差异很大，不能用同一个“做得像 Codex”需求混在一次实现中。

## 2026-11-06 Queue / Steer、提问与错误恢复的官方证据补充

本节只记录 OpenAI 官方页面能够直接支持的事实。对没有完整桌面截图的状态，不从其他产品界面或文字描述反推像素布局。

### Queue / Steer

- 官方将两种行为明确区分为：**Steer** 把新消息加入当前运行，**Queue** 把消息留到当前运行完成后的下一轮。[Prompting：Steering and queuing](https://learn.chatgpt.com/docs/prompting#steering-and-queuing)
- 在 ChatGPT 桌面应用中，默认行为位于 `Settings > General > Follow-up behavior`。官方还明确说明：排队消息出现在 Composer 上方，并可编辑、重排、发送或删除；另一种行为可用快捷键对单条消息临时触发。[Prompting：Steering and queuing](https://learn.chatgpt.com/docs/prompting#steering-and-queuing)
- Codex app 26.217 的发布记录确认排队消息支持拖放重排；26.205 确认加入 mid-turn steering。[ChatGPT & Codex changelog](https://learn.chatgpt.com/docs/changelog)
- 因而可确认的桌面布局约束只有：排队列表位于 Composer 上方，至少需要编辑、重排、立即发送和删除四类操作。官方文档没有给出这些行的精确高度、圆角、图标、颜色或完整桌面截图；当前实现不应声称这些细节已完成像素复刻。
- API 的 `response.steer.accepted` 只代表服务端接管并排队输入，不代表已经应用；失败会通过 `response.steer.failed` 返回原输入和错误。因此未来启用真实 Steer 时，UI 至少要区分“已接收待应用”“已应用/后继响应创建”和“失败可取回”，不能在点击发送后直接显示成功。[Mid-turn steering](https://developers.openai.com/api/docs/guides/steering)

### Goal、Agent 提问与审批

- Goal 的官方可观察布局事实较明确：进度行位于 Composer 上方，并提供暂停/恢复、编辑和清除入口。[Long-running work](https://learn.chatgpt.com/docs/long-running-work)
- 权限文档确认审批发生在越过当前工作区或使用网络等受限动作前；官方快捷键文档确认审批请求打开时，`Enter` 批准、`Escape` 拒绝。[Permissions](https://learn.chatgpt.com/docs/permission-modes)；[Commands](https://learn.chatgpt.com/docs/reference/commands)
- 官方安全文档还列出自动审批审阅项的状态：`Reviewing`、`Approved`、`Denied`、`Aborted`、`Timed out`，并可显示风险级别和用户授权判断。[Agent approvals & security](https://learn.chatgpt.com/docs/agent-approvals-security)
- 已检查的官方资料没有给出通用“Agent 向用户提问”卡片的完整桌面截图，也没有规定单选、自由输入、按钮位置或卡片尺寸。当前受控 `request_user_input` 截图只能证明本项目状态完整，不能作为 Codex 像素基准。

### 错误与恢复

- Codex app 26.313 的官方发布记录只确认恢复和聊天错误 toast 的细节说明得到改善，没有公开该 toast 的完整像素结构。[ChatGPT & Codex changelog](https://learn.chatgpt.com/docs/changelog)
- OpenAI 的错误恢复指导要求先检查已保存工作和已经发生的工具副作用，再决定重试；失败的 turn 不等于整个 session 失败，恢复前应读取状态和结构化错误。[Errors and recovery](https://developers.openai.com/api/docs/guides/agents-api/errors)
- 因此本项目错误态可依据官方行为保留错误原因、已完成动作、未完成范围和恢复入口，但官方资料不足以证明当前卡片的颜色、间距和按钮排列与 Codex 完全一致。不能用 API 错误示例替代桌面视觉证据。

### 对当前实现的直接结论

1. Queue 不应只作为 Composer 内的禁用文字：即使保持 Mock，也应在运行态提供位于 Composer 上方的排队行预览，包含编辑、重排、发送、删除四种禁用操作，才能对齐已证实的信息架构。
2. Steer 应作为“本次消息的发送行为”表达，并与 Queue 默认设置/单次反转相关联；在底层协议未实现前必须禁用并明确 Mock，不能伪报已注入当前运行。
3. Goal 行当前位置有官方依据；Agent 提问卡和错误卡仍只能沿已确认的产品视觉系统做一致性设计，验收记录必须继续标注“无官方完整截图”。
4. 不建议为上述预览引入新组件库。现有 Composer、Goal 行、按钮、Tooltip 和状态卡已经能复用；真实拖放排序若后续启用，再单独比较原生 Pointer/Keyboard 实现与成熟可访问拖放库，并按依赖审批流程决定。
