# 只读 exec_command 实现与验收

日期：2026-10-31。状态：已实现、构建并完成临时样例的真实OS命令和受控模型集成验收；本轮未发起真实DeepSeek请求。

## 实现与入口

- `apps/runtime/src/exec-command.ts`：复用经用户批准的 `@anthropic-ai/sandbox-runtime@0.0.81`（Apache-2.0）及Node `spawn`。固定非登录bash，模型不能设置环境、关闭沙箱或提权。不是复制Codex私有执行器，不声称所有参数或平台等价。
- `tools.ts`在同一注册表新增 `exec_command`、`write_stdin`、`stop_process`，现有Agent循环和目录/文件工具保留。首次命令明确审批，标准输入沿用该命令权限。句柄绑定当前Run，不接受任意PID或其他会话句柄。
- `exec_command`输入 `command`、项目相对 `path`（默认`.`）、`timeout_ms`（默认30秒、上限60秒）、`yield_time_ms`（0–1000ms）。返回执行UUID、状态、退出码、信号、累计输出及截断标记。
- `write_stdin`输入 `execution_id`、可选 `chars`（最多4096字符）及等待时间；支持非TTY标准输入，也可只轮询。`stop_process`终止进程组并等待清理。工具轮询也计入12次工具预算。
- 输出按到达顺序合并stdout/stderr，原始字节累计32KiB，UTF8解码保留完整字符/替代符；达到上限终止进程，前端约100ms合并投影，模型轮询得到累计输出。
- 当前Run最多1个活跃命令、12个句柄；每个结果有界。保留6次模型请求、12次工具调用、120秒总预算。模型最终回答前、用户停止及正常应用退出均清理自有进程组。TERM后250ms升级KILL，1.5秒关闭遗留管道；初始化有5秒上限。
- `packages/protocol`新增有界执行结果和审批种类；前端区分文件/命令授权，展示命令、运行状态、退出码和可展开输出。失败工具不会被标成执行成功；命令失败与模型Run结束分开表达。

## 权限与限制

- 仅macOS启用；其他平台拒绝执行，不回退无保护shell。Electron独立Runtime自身不是沙箱，只有被包装的命令受该沙箱约束。
- SDK存在默认可写临时路径，因此显式 `denyWrite:[{path:"/",literal:true}]` 覆盖默认写入；项目和宿主文件均不能删除、覆盖、创建。构建、安装和需要临时文件的部分读取程序可能失败，这是当前只读模式的预期限制。
- 读取默认拒绝根目录，仅放行当前项目和系统工具/库目录（/bin、/sbin、/usr、/System、/dev、/Library/Developer、/opt/homebrew）；禁止普通项目外读取。额外拒绝常见.env、私钥扩展及凭据名。审批覆盖命令可能读取的项目内容，不等价于read_file的单文件审批；不承诺识别普通源码里的所有秘密。
- 工作目录用既有路径校验，拒绝穿越、链接和跨设备目录；项目根路径使用literal规则，拼接凭据glob前拒绝根路径中的glob特殊字符。Git外置worktree元数据、外部源码链接可能不可读。
- 禁止网络及任意Unix socket，不提供提权入口。子进程环境只构造系统PATH、虚拟HOME、locale及Git非交互选项，不传递模型Key或继承process.env。Runtime本身增加固定系统PATH，供SDK内部which查找shell。
- macOS `/usr/bin/git`是工具链shim，在严格读限制下会尝试访问xcode-select路径；优先使用已安装的CommandLineTools/usr/bin中的真实Git。其他工具链安装布局尚未验收，失败时不自动放宽权限。
- SDK仍为研究预览，需要锁版本并在升级时重验。没有CPU/内存/PID硬配额，不承诺抵抗fork bomb、主动脱离进程组的守护进程或宿主/Runtime强制崩溃后的完整清理。升级成可写Coding Runner前需要独立设计执行环境和变更审阅，不能只把当前写拒绝关掉。

## 真实验证

临时脚本与样例放在 `/private/tmp`，未新增仓库单元测试，未触碰真实用户文件或密钥。

1. 实际OS沙箱：临时Git仓库log读取、cat管道成功；rm、shell重定向覆盖、Perl unlink失败且样例原文不变；项目外路径、逃逸符号链接、.env读取失败；本机TCP连接拒绝；超时、32KiB输出上限、取消与显式停止通过。见 `docs/evidence/exec-command-os.json`。
2. Electron45.1.0 / Node24.22.1，独立userData与utilityProcess，使用产品构建的Runtime、preload和React界面。模型HTTP使用受控SSE替身，Main授权路由使用验收替身：真实Git输出进入工具反馈并渲染、删除失败显示、句柄轮询与stdin、用户拒绝不启动、取消传播至真实进程、原list_directory/read_file逐次审批回归均通过。未访问真实Key、未产生模型费用。见 `exec-command-electron.json` 及截图 `exec-command-controlled.png`。
3. `npm run build`（包含typecheck）、`git diff --check`通过。安装时旧传递Zod报告高危集合验证DoS，改用项目已有Zod4.6.7的兼容入口并锁定override，实际SDK与Electron集成通过，npm audit报告0漏洞。

## 参考与架构审视

- 官方SDK： https://github.com/anthropics/sandbox-runtime ，安装版本README和dist类型/源码为本次直接实现依据。
- Node spawn： https://nodejs.org/api/child_process.html 。Electron参考本地 `docs/vendor/electron/docs/api/utility-process.md`，API按安装版本45.1.0验证。
- 最小改动保留原Agent循环和工具注册，不新增通用插件总线或独立远端服务。新增进程句柄管理属于真实执行生命周期需要。当前结果最多约384KiB/Run，20个会话保留最近工具结果约7.5MiB上限量级（不含消息、SDK和临时快照）；stdout不逐chunk发送整个会话，减少IPC开销。
- 本次没有自动commit或重启用户现有应用。构建已更新，重启加载新Runtime；内存会话会丢失。
