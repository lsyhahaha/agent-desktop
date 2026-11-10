# 工作区界面改进验证记录

原始 `requirements/workspace-ui.md` 范围已完成实现、受控验收、正式实例升级和进化记录落库；后续用户追加的“全量 Codex UI 一模一样”目标仍在验证中，不能用原需求完成状态替代全量视觉完成声明。

## 已实施

回复正文与常规执行信息分层，空验收条件移入本轮选项。重要步骤保持可见，工具结束提供可展开的修改和检查范围。支持回复、代码、完整命令复制，宽幅阅读和展开编辑。

项目入口置于任务列表上方，项目隔离分页查询、正文片段搜索、最近访问任务恢复、无项目对话、自然日分组与更新时间已接入。草稿通过现有Runtime和存储Worker保存，协议升级11，数据库迁移6到7新增草稿和项目导航表。外观偏好保存在本机localStorage。

右侧增加Git改动视图，区分暂存、未暂存和未跟踪，显示比较基准、读取时间与未知归属。Git固定只读参数、10秒和64KiB输出限制，禁用外部diff、textconv、hooks和fsmonitor。未知/不可用Git显示范围说明。用户可显式打开已知文本源码，Main校验当前会话、工作区身份、普通文件和路径。

Electron参考项目本地快照的tutorial/ipc.md、api/shell.md，适用已安装45.1.0，快照main新增API未使用。

## 实际验证

- npm run build通过，包含类型检查。现有Zod注释解析警告仍存在。
- scripts/acceptance/run-workspace.cjs使用真实Sessions、Worker、SQLite与React，Provider、desktop bridge和PTY为替身。已覆盖项目草稿隔离、正文搜索命中轮次、最近项目与无项目恢复、混合暂存与新增文件、路径穿越拒绝、草稿冷恢复、普通回复、最小窗口发送按钮可达与无横向溢出、展开状态保留及改动面板渲染。
- scripts/acceptance/run-workspace.cjs --production使用生产Main/preload/utility Runtime/Worker，仅原生目录选择与系统打开为替身，验证实际握手、草稿隔离、文件打开路由、过期会话/穿越/可执行扩展名拒绝以及无项目恢复。没有真实模型调用。
- 证据保存在evidence/workspace-ui/controlled.json、production-chain.json和截图。已实际查看最小窗口、默认与浅色改动视图，截图为合成项目数据。

## 发现和修正

首轮验收启动发生Electron ESM顶层await等待就绪超时，随后补齐Worker构建分块，并将macOS临时目录规范化。产品身份校验没有放宽。中间构建发现unknown类型条件和新增preload参数类型错误，已修正并重新构建。

截图复查发现重复用量、日期分组落在选中背景、项目导航空白及输入区重复边框，已调整。受控桌面曾出现Chromium临时缓存创建告警，定位为验收入口异步创建userData晚于Electron就绪，改为同步初始化后最新运行不再出现。

## 验收覆盖与交付边界

- CHAT-01至07覆盖正文/执行分层、普通聊天空状态、重要步骤、折叠保持、紧凑摘要及实际主题截图。
- NAV-01至05覆盖项目隔离、无项目、最近访问、21个非空草稿任务分页、跨页正文查询与命中轮次身份，本地首条非空输入命名和人工改名入口保留。
- LAYOUT-01至03、INPUT-01至03覆盖侧栏紧凑、宽幅入口、可展开输入、本机偏好、最小窗口发送可达、草稿冷恢复及故障不伪报成功。面板原有指针和键盘调整逻辑保留。
- INPUT-04针对“已有文件引用”，现有输入只有文本，没有附件或引用条目，因此无适用对象，未补造附件能力。
- ACTION-01至03覆盖代码和完整命令实际复制文本、失败步骤、同轮已有文件记录定位，生产接口验证显式文本文件打开与拒绝分支。
- REVIEW-01至04覆盖真实改动面板、切换不再请求PTY、Git混合索引/删除/嵌套未跟踪/二进制/保护目录拒绝及非Git范围说明。PTY使用替身，未把该检查记为新一轮真实Shell验收。
- POLISH-01、START-01通过实际代码和主题截图核对图标、可访问名称、三个建议仅填入编辑区，输入法确认不触发发送。

最新controlled.json包含35组检查，production-chain.json包含3组检查，均通过。SQLite故障注入会产生预期storage错误日志。首次审批测试使用会自动执行的纯查询，改为必须人工确认的复合命令后，拒绝和取消路径通过。首次文件定位仅验证定位到失败记录，随后修正临时库目录并增加读取成功断言重新通过。

本轮未调用真实付费模型，未新增单元测试。正式维护已取得用户确认草稿保存、任务结束和退出授权，使用原生菜单正常退出，完成一致备份、v7升级和self-evolution-3-workspace-ui追加。部署证据见evidence/workspace-ui/deployment.json。

统一命令npm run acceptance:workspace已完整通过构建及两组验收。新增文件引用会定位本轮已存在的成功读取记录，并验证终端视图切换不重复请求PTY。源代码打开使用生产IPC路径，系统编辑器动作仍为替身。此前误将失败读取定位当作成功读取覆盖的问题已通过新增成功断言纠正，最新运行没有tool_rejected日志。

## 正式部署与完成核对

用户确认草稿已保存、任务已结束后，正常退出旧实例，对正式SQLite做一致备份并验证integrity_check。迁移前v6，迁移后v7，原有7会话、37轮、74消息、100条工具审计等数量保持，自进化记录由2条增至3条。对runs/messages/tool_calls/session_context/timeline_items/run_event_heads/run_events逐表计算内容哈希，与备份完全相同。

第3轮正式记录ID为87a654c9-0a58-4ad9-b318-d463fad1ce4a，维护CLI冷查询可读。备份位置保存在本机/private/tmp/agent-workspace-ui-backup-metadata.json，备份目录0700、文件0600，正式库和备份不进入仓库。

npm start重新构建并启动了正式应用。通过原生AX和截图实际看到项目导航、无项目对话、宽幅阅读、展开编辑区和主题图标，打开原有“你好”会话确认正文、执行折叠及本轮选项恢复。部署没有新增Run或模型请求。应用保持运行，当前展示该历史会话供用户查看。

最终自审补充了保存与发送/导航之间的竞争保护。过渡期间锁定输入，取消旧延迟保存，成功清空后不会被旧保存重新写回；移除重复的历史草稿内存Map。延迟保存受控回归通过，统一命令通过24组界面/存储/工具检查和3组生产链路检查。

已知边界保留。未确认保存的约500ms草稿仍可能在强制退出时丢失。PTY、剪贴板与Provider使用替身，系统编辑器打开使用替身，未覆盖所有宿主编辑器、跨平台或长期压力场景。现有输入没有附件条目，INPUT-04无适用对象。代码改动保持未提交状态。
# Codex 工作区视觉对齐增量（2026-11-06）

本节记录工作区外壳与审阅面板的增量实现，不覆盖文档后续既有验收事实。

- 实现范围：Codex 式主导航、无卡片主画布、Composer 三层结构、浅深主题、独立 `WorkspacePrimaryNav` 与 `ChangeReviewPanel`、右侧文件列表和 Diff 分层。
- 能力边界：自动化入口明确禁用；分支显示“未确认”；改动视图保持只读，不新增 stage/revert/commit/push；终端仍不自动进入模型上下文。
- 实际验证：`npm run typecheck` 通过；`npm run acceptance:workspace` 完成构建、35项受控 Renderer/SQLite/审批/提问/错误/PTY 替身链路与3项 production handshake/file-open/no-project 链路，均返回 `status: passed`；Queue未发送草稿、Git顶栏区分未读取统计与真实Diff行数、设置页、深色Diff和Minimap均有断言。
- 视觉证据：现有验收脚本生成默认、空态、最小窗口、改动、审批、提问、错误、设置、插件、Skills、Appearance、Cloud、Worktrees、Automations、Search、Archived、文件树与产物预览等状态截图；新增页面均已人工查看。截图证明渲染层级，不单独证明真实 Provider、真实 PTY 或用户正式实例升级。
- 受控检查新增真实空会话投影、可见审批交互、设置页、插件目录 Mock 与本地插件页截图。插件市场 Mock 的筛选、搜索、试用与安装全部禁用并明确标识；真实本地插件能力仍在独立标签中。
- 提问截图由受控Provider真实调用`request_user_input`产生，并验证回答后继续完成；错误截图由受控HTTP 500产生。Queue/Steer的发送、重排和中途引导仍为禁用Mock，没有底层顺序与恢复协议。
- 官方文档补充确认Queue消息位于Composer上方，并支持编辑、重排、立即发送和删除。`followup.png`新增运行中未发送草稿预览；输入仍保存为当前会话草稿，四类副作用操作和Queue模式全部禁用，不伪造已排队或已Steer成功。
- Profile页依据官方Settings字段补齐累计Tokens、峰值Tokens、连续使用、最长任务、Token活动、资料卡和邀请入口；未连接账号时所有统计保持`—`，活动图仅为明确标注Mock的只读结构，不生成个人数据。
- 截图入口等待目标状态的唯一可见标记与连续两帧绘制，主动请求重绘并对全部状态图计算SHA-256；不同状态若产生相同字节会直接使验收失败。该门禁修复了`capturePage`曾复用上一帧、导致多张证据相同的问题。
- 未覆盖：正式用户实例尚未逐项操作全部Mock和最小窗口状态；提问、Queue/Steer 与错误恢复缺少官方完整桌面截图，视觉只能沿当前Codex系统实现，不能把公开证据不足隐藏掉。
- 正式实例补充：完成最终构建后通过`npm start`正常启动用户实例，原5条会话和当前项目恢复；通过原生可访问树与实际截图查看工作区、Composer、终端/改动、Commit Mock、设置分类和真实DeepSeek配置。仅导航到设置页，没有发送消息、调用模型、保存设置或执行Git写操作；应用保持运行供用户预览。
- 页面Mock补充：Automations、Appearance和Worktrees/Handoff均可从正式导航到达；受控截图哈希互不相同。Appearance仅主题入口复用真实能力，其他预览控件与Automations、Worktrees/Handoff主操作均禁用。验收同时断言全局与Appearance页的ThemePicker各有唯一DOM ID，避免重复popover目标。
- 最新正式实例已正常退出旧Renderer并重新启动；通过原生可访问树和实际截图查看工作区、Search、Pinned以及Automations、Appearance、Worktrees/Handoff。所有Mock主操作在正式实例中保持disabled，Worktree页只读显示真实当前项目名；未触发调度、Git、目录或配置写入。
- Search受控截图使用真实SQLite正文查询并显示匹配片段；Archived和Pinned仅为醒目标注Mock，不生成、删除或恢复聊天。
- 文件树和产物预览通过现有右侧面板切换并保存独立截图；所有文件项、系统打开和预览动作禁用，没有新增Renderer文件系统能力、HTML执行或产物读取。
- Skills与Cloud环境页保存独立截图；Skills不读取或执行本地指令，Cloud不连接账号、容器、Vault或远端服务，所有创建、添加、选择和发布动作禁用。
- 最新受控证据补充折叠侧栏、Goal行、Queue未发送草稿行、MCP、Connections、Handoff模态、终端底部抽屉与紧凑头、Diff选中行和行内评论Mock，并直接门禁官方测量比例、深浅颜色、渐变、Automations三层颜色与卡片比例。`controlled.json`为35组，`production-chain.json`为3组，最新运行均通过。
- Review面板依据官方工作流补齐全部改动、Last turn、未暂存、已暂存和main范围栏；只有全部改动对应现有真实快照，其余按钮禁用并共用单一Mock标记。验收同时门禁默认420px面板无横向溢出。
- 项目侧栏新增复用`ProjectRow`：真实项目与五个示例项目共享文件夹、截断和三点菜单结构。入口默认`visibility:hidden`，悬停或键盘聚焦时显示；六个入口可打开共用原生Popover，但项目设置与移除全部禁用，不执行目录或侧栏修改。`project-menu.png`和`project-actions.png`分别保存入口与菜单证据。
- 聊天行重命名菜单同步改为`visibility`门禁，修复繁忙/禁用状态受全局按钮透明度影响而常驻的问题。真实鼠标只显示当前悬停聊天的菜单，`chat-menu.png`保存证据；重命名能力保持原实现。
- 聊天三点入口不再直接进入重命名，而是复用原生Popover打开上下文菜单；真实重命名可继续进入编辑表单，置顶与归档禁用并标记Mock。原生能力负责Escape和点击外部关闭，`chat-actions.png`保存菜单证据。
- Popover打开改用按钮原生`popoverTarget`，点击处理只更新目标与边界内位置；修复手动`showPopover()`与light-dismiss的时序竞态。受控验收直接点击原生目标验证菜单，不在每轮重复依赖后台窗口的系统级hover状态。
- 最新正式实例补充走查：只读检查确认没有未保存草稿和活动Run后，通过原生菜单正常退出旧实例并以最新构建重新启动；原5条会话、当前项目和DeepSeek配置均正常恢复。实际查看工作区与Composer，启动并关闭真实本机zsh终端；改动面板首次进入自动读取65个文件，列表阶段统计明确显示未知，选择`DESIGN.md`后显示真实`+39 -1`和Diff，切换到终端再返回仍保留选中文件、统计、Diff与原读取时间。随后实际查看Automations页面的禁用模板、Prompt和创建区。全程没有发送消息、调用模型、保存设置或执行Git写操作，验收产生的空终端已关闭。
- 项目/聊天菜单增量完成后再次检查正式库为0条非空草稿、0个活动Run且无zsh子进程，通过macOS原生Quit退出旧实例并由`npm start`构建启动最新版。正式窗口实际恢复7个会话、当前`agent-desktop`项目、历史消息和DeepSeek配置；AX确认`ProjectRow`容器、顶部Review入口和Composer新结构已加载。一次对项目行容器的验证点击命中真实项目选择按钮并打开系统目录选择器，立即取消且未选择目录；复查仍为0草稿、0活动Run、7会话。没有发送消息、调用模型、保存设置或执行Git写操作，应用保持运行供用户预览。
- 全量“一模一样”仍不能判定完成：Queue/Steer、Agent提问和错误恢复缺少官方完整桌面截图；品牌、中文文案和明确Mock标记也属于有意保留的产品边界。只有获得新的官方视觉证据并完成最新正式实例走查后，才能重新审计该目标。
