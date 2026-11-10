# Codex 工作区视觉对照（2026-11-06）

固定官方基准：[Codex app basic light](https://learn.chatgpt.com/images/codex/app/codex-app-basic-light.webp)（3600×2026）与 [dark](https://learn.chatgpt.com/images/codex/app/codex-app-basic-dark.webp)。本地证据由 `scripts/acceptance/workspace-ui.ts` 在标准1320×860 BrowserWindow中生成；只有 `minimum.png` 使用1000×680，随后立即恢复标准尺寸和紧凑Composer。未将远程图片复制进仓库。

截图助手在绘制前清除 DOM 自动点击遗留的伪键盘焦点；真正的键盘焦点可见性由 Minimap、导航与最小窗口的独立断言覆盖，不通过删除产品 `:focus-visible` 样式美化证据。

| 区域 | 官方可观察事实 | 当前实现证据 | 结论 / 剩余差异 |
|---|---|---|---|
| 应用外壳 | 侧栏约占应用窗口 23%，主画布无大卡片外框 | `empty.png`、`default.png` | 侧栏调整为306px（1320px下23.2%），主画布无外框；最小窗口降为270px |
| 折叠侧栏 | 画布扩展到整窗，左上保留侧栏入口 | `sidebar-collapsed.png` | 工作区填满高度；设置入口收敛为左下32px图标，不保留横跨整窗的侧栏渐变底条 |
| 主导航与Projects | 新建、搜索、插件、自动化，以及紧凑项目/聊天列表；项目和聊天行悬停出现三点菜单 | `empty.png`、`project-menu.png`、`project-actions.png`、`chat-menu.png`、`chat-actions.png` | 当前项目与五个禁用Mock项目复用同一`ProjectRow`和线框文件夹；两类三点入口默认隐藏并复用原生Popover；聊天菜单提供真实重命名、置顶/归档禁用Mock，项目设置/移除禁用Mock；不使用平台相关字符字形 |
| 空态 | 居中标题、三层 Composer、三条建议 | `empty.png`、`empty-light.png` | 深浅色结构已对齐；产品名称与中文文案保留自有品牌，不复制 Codex 商标 |
| Composer | 输入、权限/模型/推理强度/语音、项目/环境/分支，发送与停止同位 | `empty.png`、`empty-light.png`、`minimum.png` | 结构与状态位置已对齐；`@`、推理强度和语音明确标为或保持禁用Mock；分支明确“未确认” |
| 消息工作区 | 用户气泡、Agent 纯正文、过程按需展开 | `default.png`、`light.png` | 已对齐层级；现有验收条件和审计详情因真实产品能力保留 |
| 顶栏 | 当前聊天、Git/工作区动作位于右侧 | `default.png`、`changes.png` | 终端与改动双入口已对齐；并列面板打开时低优先级动作收敛为图标，保留可辨识标题；Commit仍为禁用Mock |
| 改动审阅 | 全部改动/Last turn/暂存范围、文件列表、选中文件、差异工作面、行间评论卡 | `changes.png`、`changes-dark.png` | 顶栏首次打开自动读取只读快照；全部改动绑定真实快照，Last turn、未暂存、已暂存和main范围为禁用Mock；当前文件同步高亮，评论Mock不污染原始Diff复制文本 |
| 终端 | 聊天下方抽屉、`Terminal / shell`紧凑头与真实Shell入口 | `terminal.png`、`terminal-dark.png` | 抽屉只保留标题和关闭入口；跨视图切换走顶栏，深浅主题覆盖且不重复创建PTY |
| 审批 | 官方文字确认存在审批，缺少完整公开桌面截图 | `approval.png` | 顶栏状态有界省略，完整命令仍在正文可复制；当前卡片沿同一视觉系统实现，不宣称像素级来源充分 |
| Agent提问 | 官方确认Plan/Goal流程会澄清，缺少完整桌面截图 | `question.png` | 真实input interaction、选项和自由输入均可见；回答后继续完成已受控验证 |
| Goal运行态 | 官方截图显示进度行位于Composer上方，可暂停/恢复、编辑或清除 | `question.png` | 已补齐同层级进度行；当前无Goal状态机，整行明确标注Mock且全部操作禁用，真实停止仍走取消清理链路 |
| Queue/Steer | 官方确认Queue位于Composer上方并支持编辑、重排、发送和删除；缺少完整桌面截图 | `followup.png` | 运行中草稿可继续编辑，预览行位于Composer上方；四类操作和Queue模式均禁用且标注“未发送 · Mock”，尚无顺序、恢复或中途转向协议 |
| 错误恢复 | 官方说明卡住与恢复模式，缺少统一错误截图 | `error.png` | 真实HTTP 500失败投影，保留失败步骤、总结、输入取回和错误提示 |
| 设置 | General、Profile、快捷键、通知、Browser、Computer Use、个性化、建议提示、记忆、Pets、MCP、Connections、模型详情 | `general.png`、`profile.png`、`shortcuts.png`、`notifications.png`、`browser.png`、`computer-use.png`、`personalization.png`、`suggested-prompts.png`、`memories.png`、`pets.png`、`mcp-services.png`、`connections.png`、`settings.png` | Mock不读取私有数据或连接外部能力；Profile按官方字段覆盖累计/峰值Tokens、连续使用、最长任务和Token活动，全部未知值保持`—`；真实模型页只显示凭据状态，Key输入为空且不回显，固定API地址只读 |
| Git设置 | Review delivery、Diff换行、默认工作方式、分支信息 | `git-settings.png` | 全部为禁用Mock；不执行Git命令、不修改仓库或写配置 |
| 插件目录 | 顶部筛选/搜索、推荐横幅、双列目录 | `plugins.png` | 视觉结构已对齐；目录为醒目标注 Mock，所有操作禁用；真实能力在 `plugins-local.png` |
| Automations | 黑色外框、内层工作面、居中宽卡片、Prompt、项目/频率/模型及创建操作 | `automations.png` | 原图采样门禁`#000/#232323/#242424`三层与约2.2:1卡片比例；模板、取消、创建均禁用 |
| Appearance | 设置侧栏、主题预览、颜色、字体、半透明侧栏、对比度、指针光标及字号选项 | `appearance.png` | 带标签ThemePicker显示真实当前选项并复用全局偏好；其余字段依据官方文档补齐为禁用Mock |
| Worktree/Handoff | Local/Worktree选择与居中Handoff确认弹层 | `worktrees.png`、`handoff.png` | 基础选择与确认态分开验收；确认禁用，取消仅关闭Mock预览，不执行Git、目录创建或会话迁移 |
| Search | 独立搜索工作面、查询输入和聊天结果 | `search.png` | 使用真实SQLite标题/正文搜索；结果有界并可返回原聊天 |
| Pinned / Archived | 侧栏置顶分组与设置归档入口 | `search.png`、`archived.png` | Pinned和Archived均显式Mock，不伪造持久化状态或恢复操作 |
| 文件树 | 工作区文件层级与文件选择 | `files.png` | 固定标题栏、树内容独立滚动并带目录展开语义；全部项目禁用且标注Mock，不读取文件系统 |
| 产物预览 | 对话旁的文档/图片/PDF/HTML审阅面 | `preview.png` | 文件身份与工具栏固定，只滚动画布并标记当前页；只读视觉Mock，不加载用户文件、不执行HTML或脚本 |
| Skills | 目录、推荐区、Skill卡片和添加操作 | `skills.png` | 独立Mock标签；不发现、加载、安装或执行SKILL.md |
| Cloud环境 | Local/Cloud选择、setup脚本和发布操作 | `cloud.png` | 独立Mock页；不连接账号、容器、Vault或远端执行 |

## 当前不能判定完成的项目

- 尚未对官方与本地截图执行自动像素差；官方基准包含桌面壁纸和不同窗口尺寸，只能先做同区域比例核对。
- Queue/Steer、Agent 提问卡、错误恢复仍缺少官方完整桌面截图；Queue只能按官方文字确认的信息架构验收，已有本项目真实状态截图不能替代官方像素证据。
- 最新正式实例已在只读确认无未保存草稿和活动Run后正常重启，实际查看工作区、真实zsh终端、改动列表、选中文件Diff和Automations页；终端关闭后，改动面板跨视图保留`DESIGN.md`、真实`+39 -1`统计、Diff与读取时间。Search、Pinned、Appearance和Worktrees/Handoff仍以此前正式走查与最新受控截图为证，本轮没有重复逐页操作全部Mock页面。
- Agent Desktop保留自有品牌、中文文案和醒目Mock边界，不复制Codex商标，也不把未实现能力伪装成可用；因此“功能层级对齐”不能被表述成未经限定的品牌级像素复制。

## 已量化对齐

- 1320px验收窗口侧栏占比：官方22.93%，当前23.18%，差0.25个百分点。
- Composer占主工作区宽度：官方70.89%，当前71.01%，差0.12个百分点。
- 深色主画布与Composer分别达到`#111111`和`#262626`完全一致。
- 深色侧栏渐变采样每个RGB通道与官方相差0–2/255。
- `acceptance:workspace` 现直接门禁侧栏/Composer宽度比例、Composer纵向位置、96px输入层高度、深色边框，以及深浅画布/输入/上下文和两套侧栏渐变；不再只依赖静态测量记录。
