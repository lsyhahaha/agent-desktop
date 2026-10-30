# Agent Desktop

TypeScript + Electron + React 的本地 Coding Agent 项目。

## 运行

```sh
npm install
npm run dev
```

关闭开发终端请按 Ctrl+C。应用菜单退出为 Cmd+Q；macOS 关闭窗口后仍可从 Dock 重开。

```sh
npm run typecheck
npm run build
npm start
```

`build` 生成 out/ 中的主进程、预加载、Runtime 和前端产物；当前不生成安装包或签名发行版。依赖以 package-lock.json 锁定，后续复现使用 npm ci。

## 已实现

- DeepSeek Chat Completions 真实请求适配，默认 `deepseek-flash`、关闭思考模式，模型名可修改。
- 当前进程内的连续对话、流式文本、取消和错误展示；失败/取消的轮次不会进入后续模型上下文。
- `list_directory`：在工作区内有界列目录；用户输入“看看当前项目”后先探索目录，再自主选择关键文件。
- 受限 `read_file`：用户先选择工作区，Runtime 默认提供该工具，每次读取前确认是否将该文件内容发送给 DeepSeek。
- `exec_command`：经用户确认后在只读macOS沙箱运行bash命令；支持管道、实时输出、退出码、`write_stdin`轮询/标准输入及`stop_process`停止。禁止文件写入/删除与网络，不提供关闭沙箱或提权入口。
- 最多6次模型请求、12次工具调用、120秒总运行；单请求60秒、流空闲30秒；无自动重试。
- API Key 用 Electron safeStorage 系统加密后保存于应用 userData；不回传已保存的明文 Key，也不进入 Runtime 环境变量或日志。

## 使用

1. `npm run dev`（或构建后 `npm start`）启动应用，点击“模型设置”或输入框旁的“管理模型”，输入 DeepSeek API Key 并保存。不要把密钥放到源码、聊天记录或截图中。
2. 普通对话无需选择目录。发送“你好”，然后连续追问，验证当前会话上下文；运行中可点击停止。
3. 选择一个不含敏感资料的项目目录，发送“看看当前项目”。Agent会先列目录，再自行选文件读取并分析；文件内容读取仍需逐次批准，批准后会发往DeepSeek。
4. 新建任务保留旧任务，侧栏可切换、按标题搜索和改名；切换到不同工作区会开启独立任务。草稿、上下文和工作区按会话隔离。运行中暂不允许切换任务或目录。最多20个内存会话，重启后不恢复。

当前不实现会话数据库、历史恢复、文件修改或完整资源隔离环境。命令执行沙箱当前仅验收macOS，最长60秒、累计输出32KiB、每次只运行一条命令，不支持TTY；安装依赖、构建等需要写入的命令也会被拒绝。`read_file` 只允许32KiB以内普通UTF-8文本，拒绝隐藏文件、符号/硬链接、路径越界、常见私钥扩展及二进制。它依赖普通文件系统检查，不能承诺抵抗恶意进程持续并发改名等宿主攻击，也不会自动清除普通文本中的秘密；请在批准前确认文件可发送。

## 当前界面范围

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

## 只读命令执行验收

重启加载新工具后，选择项目并输入“看看当前git历史”，确认命令后可查看输出。重启会丢失内存会话。实现、权限边界和受控Electron验收见[命令执行记录](docs/exec-command-verification.md)。
