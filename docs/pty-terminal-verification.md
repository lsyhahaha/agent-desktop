# 早期真实PTY验收记录

> 当前手动终端已按用户新指令改为可写、联网的本机开发终端，Agent权限不变。本文保留原阶段验收记录；当前终端行为以[终端对齐](terminal-alignment.md)为准。


日期：2026-10-31。用户已明确批准xterm/node-pty依赖方案和“启动时授权、只读禁网”的独立会话。Run Logs和Trace及其导出代码后续已按用户要求删除，当前右侧仅保留终端。没有新增单元测试，没有自动提交。

## 真实终端实现

- `packages/protocol/src/terminal.ts`：TerminalCommand/TerminalSnapshot/TerminalReply，协议代际升级为5。命令有open、snapshot、watch、write、resize、interrupt、paste、close；身份绑定sessionId和terminalId，不接受shell、环境、任意路径、PID或提权参数。
- `apps/runtime/src/terminal.ts`：单个真实node-pty会话，在既有SDK生成的macOS sandbox-exec配置中执行交互bash。复用`exec-command.ts`的只读禁网策略，仅该PTY会话增加allowPty设备访问，Agent工具继续allowPty=false及逐次审批，不自动退回宿主Shell。
- Main启动前展示原生授权对话框，说明目录、会话范围、限制和数据去向；拒绝不创建进程。实际批准目录由Main私有字段传给Runtime，在队列执行时再次与当前工作区核对，renderer不能伪造该字段。目录在审批期间变化则拒绝启动。即使空草稿复用相同Session ID，目录变化也关闭旧PTY。
- `TerminalPanel.tsx`：真实xterm.js渲染ANSI、中文与终端输入，FitAddon/ResizeObserver同步cols/rows。组件首次进入Terminal页才加载，避免把约423kB的终端JS加入聊天首屏主包（这是构建产物大小，不是启动性能基准）。支持Ctrl+C、复制选中、系统粘贴快捷键和原生粘贴按钮。
- 粘贴按钮只让Main读取剪贴板并直接写入已授权PTY，不向renderer返回剪贴板正文；多行粘贴经原生确认。每次最多32Ki字符，分片保留代理对。系统粘贴快捷键沿用真实终端粘贴行为。
- 原生模块只在用户授权启动时加载，安装或ABI加载错误不阻止普通Agent聊天启动；原生代码实际运行期间的崩溃仍属于Runtime风险。Terminal的stdout/stderr天然在同一个TTY流中，不伪造分流；Agent pipe命令在Run Logs中仍分别记录stdout/stderr事件。终端输入输出不进入模型上下文、SQLite或Run日志。

## 生命周期、取消与资源

终端与Agent Run独立。取消Run不停止终端；切Tab、关闭面板只取消输出订阅，进程保留。重新打开从有界内存快照恢复，offset/seq避免重复字符；普通重载不自动重启或重放命令。切换会话/项目、关闭窗口、renderer异常及正常退出应用会请求关闭终端。重启应用不恢复PTY进程。

环境使用固定PATH、HOME=/nonexistent、禁用用户启动文件与历史文件，不继承用户环境或Provider密钥。终端子进程仍受工作区和既有系统工具读取白名单约束，隐藏凭据/.env等沿用原策略；不能把本方案称为全Agent隔离。

- 单个PTY，最长30分钟；累计输入1MiB、输入速率64KiB/秒、累计输出4MiB。输入单RPC最多8192字符，UI分片4096字符，限制排队输入。
- 后端只保留最近65536个UTF-16字符的原始回显；xterm scrollback为2000行。超范围恢复提示截断，不宣称完整终端历史。输出按约75ms合并，仅有终端订阅时推送，隐藏面板不持续跨进程复制大回显。
- Ctrl+C向前台TTY发送中断字符；关闭先SIGHUP，300ms后升级SIGKILL，最多等待2秒。未确认停止时显示失败并保留句柄，不假称退出或接纳第二个PTY。交互bash开启huponexit，实际验收正常后台作业退出。
- 这是只读文件/网络边界，不是CPU、内存、PID命名空间或完整恶意进程树隔离。刻意脱离bash作业控制/忽略信号的后代没有完整系统级清理保证。原生PTY模块位于Runtime进程，native崩溃可能中断该Runtime；尚未拆分为单独终端宿主。

## 依赖与构建

锁定`@xterm/xterm@6.0.0`、`@xterm/addon-fit@0.11.0`、`node-pty@1.1.0`，开发依赖`@electron/rebuild@4.2.1`；Electron保持45.1.0。上述组件均MIT许可。`npm ci`需保留开发依赖，postinstall执行`npm run rebuild:native`；也可手动运行该命令。需要相应平台原生编译工具和Electron头文件缓存/下载，未发布安装包或验收asar签名打包。

参考本地Electron官方`api/utility-process.md`、`api/context-bridge.md`、`api/clipboard.md`、`tutorial/using-native-node-modules.md`和实际45.1.0 electron.d.ts；本版本clipboard.readText为异步API。保留contextIsolation、sandbox、发送者/来源检查及窄桥接。

## 实际验证

使用临时userData、临时项目和受控原生对话框。真实Electron45.1.0、node-pty、xterm、macOS arm64 sandbox-exec；没有真实Provider请求或私密文件，没有单元测试。

- [PTY验收](evidence/pty-acceptance.json)：拒绝不启动、isatty/tty/stty、真实键盘与ANSI、resize、文件创建/删除/.env/联网拒绝、Ctrl+C、关闭重开、系统与按钮粘贴、取消Run独立性、关闭后旧输入拒绝、会话切换后实际后台PID不存在。
- [资源和退出验收](evidence/pty-limits.json)：真实5MB输出触发4MiB上限并确认退出，回显有界；正常退出应用后后台sleep PID不存在。
- [授权目录竞态](evidence/pty-root-acceptance.json)：相同空草稿Session ID切换目录关闭旧PTY；授权确认期间目录变化拒绝启动。
- [终端视觉专项](evidence/pty-ui.json)：按需加载、真实ANSI、最小窗口深色主题与分栏；[深色截图](evidence/pty-terminal-dark.png)。
- [真实终端截图](evidence/pty-terminal.png)，已实际查看。日志元数据中的耗时和Token来自受控Provider返回，截图不是付费真实模型效果证明。

- `npm run build`（含typecheck）、`git diff --check`通过；node-pty已实际重建并运行。安装时npm audit报告0 vulnerabilities，仅代表当时依赖审计结果。构建存在既有Zod PURE注释提示，无错误。

本机临时验收入口：`/private/tmp/pty-acceptance.cjs`、`/private/tmp/pty-limit-acceptance.cjs`、`/private/tmp/pty-root-acceptance.cjs`、`/private/tmp/p2-trace-acceptance.cjs`、`/private/tmp/pty-ui-acceptance.cjs`。并非项目新增单测套件。

未覆盖：Windows/Linux、macOS其他架构、读屏、真实中文输入法全流程、恶意脱离作业控制后代、全部原生模块故障、30分钟真实长稳运行、物理断电、安装包签名/asar，以及大规模Trace性能基准。只读终端不能安装依赖、修改项目或运行需要写缓存的构建，不提供关闭保护的入口。

## 本轮主要文件

新增Terminal协议、Runtime TerminalManager、TerminalPanel；扩展RuntimeRequest、RuntimeHost、Main/preload与输出订阅、生命周期清理；exec-command提取共享策略但不放宽Agent权限；DeveloperPanel按需加载真实终端；package.json/package-lock.json锁定依赖与重建脚本。后续独立日志与Trace模块均已移除。现有用户的DEBUG.md未修改。
