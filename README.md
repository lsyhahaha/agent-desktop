# Agent Desktop

[![Subagent CI](https://github.com/lsyhahaha/agent-desktop/actions/workflows/subagent-ci.yml/badge.svg?branch=feature%2Fsubagent)](https://github.com/lsyhahaha/agent-desktop/actions/workflows/subagent-ci.yml?query=branch%3Afeature%2Fsubagent)


TypeScript + Electron + React 的本地 Coding Agent 项目。

## 运行

```sh
npm install
npm run dev
```

新依赖安装后会自动为Electron45.1.0重建node-pty；若需手动修复原生模块，运行`npm run rebuild:native`。使用`npm ci`时保留开发依赖。

关闭开发终端请按 Ctrl+C。应用菜单退出为 Cmd+Q；macOS 关闭窗口后仍可从 Dock 重开。

```sh
npm run typecheck
npm run build
npm start
```

`build` 生成 out/ 中的主进程、预加载、Runtime 和前端产物；当前不生成安装包或签名发行版。依赖以 package-lock.json 锁定，后续复现使用 npm ci。

## 已实现

- DeepSeek Chat Completions 真实请求适配，默认 `deepseek-flash`、关闭思考模式，模型名可修改。
- 本地SQLite保存会话、消息、逐轮工具审计和成功模型上下文，重启后可继续追问；保留流式、取消和失败轮次不进入后续上下文的规则。
- `list_directory`：在工作区内有界列目录；用户输入“看看当前项目”后先探索目录，再自主选择关键文件。
- `read_file`：选择工作区后可读取普通 UTF-8 文件；审批由会话权限模式决定，读取内容会进入 DeepSeek 上下文。
- Agent 权限菜单提供请求批准、独立模型帮我批准、完全访问权限。普通模式沙箱允许项目读写，项目外及联网操作须显式申请审批；完全访问经启用确认后使用宿主权限。所有模式中删除及无法确认无删除的命令必须人工审批，脚本/复合命令/非空stdin也会触发确认。细节与验收见 [权限说明](docs/permissions.md)。
- `exec_command` 支持管道、输出、退出码、`write_stdin` 轮询/标准输入及 `stop_process`；运行结束清理命令。
- 最多6次主模型请求、12次工具调用；每个边界外工具至多增加一次独立审查（15秒、最多1024输出tokens），仍共用120秒主动预算；审批与提问等待独立限10分钟，单请求60秒、流空闲30秒；无自动重试。
- 逐轮Agent执行时间线：模型、公开回复、计划、工具、审批、提问、修改、错误与总结；支持折叠详情、历史恢复和停止。工具及文件修改边界见 [时间线说明与验收](docs/execution-timeline-verification.md)。
- 右侧仅提供真实本机PTY终端：自动打开、免启动审批、可写联网；与Run独立且不放宽Agent工具权限。Run Logs/Trace界面及其查询、分析、导出已移除，聊天执行时间线保留；Runtime关键节点现以Pino写本地JSONL。
- API Key 用 Electron safeStorage 系统加密后保存于应用 userData；不回传已保存的明文 Key，也不进入 Runtime 环境变量或日志。

## 使用

1. `npm run dev`（或构建后 `npm start`）启动应用，点击“模型设置”或输入框旁的“管理模型”，输入 DeepSeek API Key 并保存。不要把密钥放到源码、聊天记录或截图中。
2. 普通对话无需选择目录。发送“你好”，然后连续追问，验证当前会话上下文；运行中可点击停止。
3. 选择一个不含敏感资料的项目目录，发送“看看当前项目”。Agent会先列目录，再自行选文件读取并分析；项目内普通文件默认自动读取并发往DeepSeek；可在输入区切换权限模式。
4. 新建任务保留旧任务，侧栏可切换、按当前页标题搜索和改名；切换工作区会开启独立任务。会话索引每页20条，历史工具按轮展开；重启恢复最后选中的任务与成功上下文。草稿仍只在前端内存，运行中暂不允许切换任务或目录。每个会话仍受50轮/上下文预算约束，达到后请新建任务。

会话数据库位于应用userData下的 `storage/sessions.sqlite`，由独立Worker持有连接；对话、读取源码及工具输出保存在普通本地文件中（不是加密会话库），Provider Key单独使用safeStorage。结构化编辑工具仍限本轮已读取的已有文本文件（32KiB），保留版本冲突和原子替换检查；Shell可在权限范围内创建、删除及构建文件。命令最长60秒、输出32KiB、不支持TTY，沙箱当前仅验收macOS。文件工具仍有普通文件、大小、链接及身份检查；完全访问可经Shell完成更广操作。不会自动清除普通文本中的秘密，选择工作区及权限前应确认数据可发往模型。当前权限规则以 [权限说明](docs/permissions.md) 为准，早期验收文档中的只读策略为历史范围。

## 当前界面范围

Agent回复支持Markdown标题、强调、列表、引用、代码块和GFM表格/任务列表；适配浅深色。用户输入与工具输出保留原文，远程图片不自动加载，HTTPS链接点击后在系统浏览器打开。实现、安全边界与验收见 [Markdown验收](docs/markdown-verification.md)。

左下角衣服图标支持浅色、深色和跟随系统；默认跟随系统，本机记住手动选择。外观不改变任务或工具权限。验证范围见 [主题验收](docs/theme-verification.md)。

参考提供的截图采用浅色侧栏、中央对话输入区和独立模型设置页。只保留本次真实对话与 read_file 所需的入口；未实现自动化、插件市场、多供应商管理、套餐或统计页面。前端复用现有 React 和受限 IPC，没有新增框架或依赖。

## 验证状态

见 [本轮验证记录](docs/agent-loop-verification.md)。已通过真实 DeepSeek 回答、连续追问、流式显示、停止及临时文件读取/拒绝链路；另外保留此前受控集成检查的独立范围，资源极限不冒充已做付费真实压测。请求完整地址为 `https://api.deepseek.com/v1/chat/completions`，已实际验证可用。

## 目录

- apps/desktop/main：窗口、IPC、Runtime 生命周期。
- apps/desktop/preload：受限桥接。
- apps/desktop/renderer：React 界面。
- apps/runtime/src：独立 Node.js Runtime。
- packages/protocol/src：跨进程结构和校验。

## 设计资料

- [整体架构](整体架构设计.md)
- [领域术语](CONTEXT.md)
- [架构决策草案](docs/adr/)

Electron 自带的 Node.js 用于应用运行；开发机 Node.js 仅用于构建工具。独立进程不等于安全沙箱。命令只经Runtime在受限沙箱中执行；真实凭据只经应用设置输入并保存在应用数据目录。

## Electron 官方参考

已将官方 main 分支文档保存到 [本地文档索引](docs/vendor/electron/docs/README.md)。版本与来源见 [快照说明](docs/vendor/electron/SOURCE.md)，开发参考要求见 [AGENTS.md](AGENTS.md)。

## 自主项目探索验收

根因、工具注册与真实模型验收记录见 [项目探索修复记录](docs/project-exploration-verification.md)。执行结束不等于任务完成，任务完成由用户单独确认。

## 命令执行验收

选择项目并输入“看看当前git历史”可查看输出。当前规则见[权限说明](docs/permissions.md)，早期受控验收见[命令执行记录](docs/exec-command-verification.md)。

## 会话持久化与恢复

见[持久化实现与验收](docs/persistence-verification.md)。用户输入先保存再请求模型；流式内容约500ms合并检查点，成功终态与模型上下文原子提交。退出前等待取消和刷盘；异常退出后的未决运行标为“已中断”，没有结果的工具标为“结果未确认”。旧审批和进程句柄不恢复，不自动重跑命令。

文件和命令工具禁止读取应用自己的会话数据目录，即使它落在一个宽工作区中。数据库写入失败会停止当前执行并提示保存异常，不自动重试或静默切换为内存模式。升级前旧版本里尚未保存的内存会话不会自动转存；新版本首次启动后产生的记录才开始持久化。尚无自动续跑、数据库加密、云同步或前端草稿恢复。

## 启动与日志排查

修改代码、重新构建后应完整退出旧应用（在Agent Desktop中按⌘Q），再启动。只关闭窗口、刷新页面或再次执行npm start不等于重启后台。已有实例时新启动会输出 `[desktop] startup_blocked` 并退出，不自动结束旧实例或清空其内存会话。

```sh
cd /Users/a1111/Desktop/agent-desktop
npm start 2>&1 | tee -a /tmp/agent-desktop.log
```

另一个终端可运行 `tail -n 100 -f /tmp/agent-desktop.log`；筛选本次问题使用 `rg 'protocol_mismatch|startup_blocked|client_diagnostic' /tmp/agent-desktop.log`。该启动诊断文件由tee保存，不自动轮转。Run Logs与Trace代码已删除；排查进程异常仍使用启动诊断，聊天时间线继续记录执行步骤。已有旧进程的stdout仍连接其原启动终端，不会自动转接到新终端。

preload校验失败会在开发者工具Console（⌘⌥I）记录 `[agent-desktop:diagnostic]`，新版Main将受约束的诊断转发为 `[desktop] client_diagnostic` 到启动终端。日志只含类别、操作和schema字段名，不打印原始快照、消息/工具正文或Key。

组件通过协议代际与同次构建标识校验后才接纳操作；版本冲突显示可读的完整退出重启提示，配置状态标为待确认，不把协议异常误报成Key丢失。新操作会被阻止，取消仍可送达。不要为解决协议错误删除SQLite数据库或重置密钥。复现与验证见[协议错误日志修复记录](docs/protocol-diagnostics-verification.md)。

## 真实终端

顶部开发者入口→Terminal，默认恢复已有会话或自动打开一个终端，直接进入用户交互Shell。支持个人Shell配置、ANSI、最多四个会话标签、尺寸同步、Ctrl+C、复制粘贴；关闭面板保留会话，切换项目或退出应用结束。终端不发送到模型，不保存为Run历史。平台、资源限制和证据见[终端对齐](docs/terminal-alignment.md)。

当前手动终端是可写、可联网的本机开发环境，Agent权限由会话模式控制。权限、资源限制与本轮验收见[终端对齐](docs/terminal-alignment.md)。

## Agent Runtime JSONL日志

任务接纳、Loop、模型、工具、审批/回答、文件操作、命令退出、取消清理与最终结果记录在`userData/logs/agent-runtime/`，启动输出`[runtime-log] directory`显示实际位置。所有任务和Runtime启动/恢复统一追加到固定`runtime.jsonl`；runId保留在记录中区分任务。10MiB滚动、最多五份编号备份。可用编辑器或`tail -f`查看，不需要日志面板。默认不写Prompt、源码、工具正文或手动终端内容。格式、保留策略、预算及验收见[Runtime日志说明](docs/runtime-jsonl.md)。

跟随固定日志：`tail -n 100 -F "/实际userData路径/logs/agent-runtime/runtime.jsonl"`，任务切换后无需重新选择文件。
