# 本机开发终端对齐

2026-10-31。用户明确选择：去掉手动终端的只读与禁网限制，Agent工具权限不变。本文是当前能力说明，取代上一阶段只读PTY的权限描述。

## 当前行为

- 手动终端直接通过node-pty启动交互登录Shell，不再包裹sandbox-exec。以当前用户权限运行，可写文件、联网和执行正常开发命令；这也意味着可修改项目之外的用户可访问文件，不承诺工作区隔离。
- Shell仅由Main从宿主SHELL选择`/bin/zsh`或`/bin/bash`，未匹配时默认zsh。HOME、USER、PATH等开发必要环境由Main提供，renderer不能指定配置或目录；不会整体复制Main环境或Provider密钥。个人Shell配置可能自行设置凭据或运行命令，这是正常用户Shell行为。
- 用户启动时原生确认明确说明本机权限与个人启动配置加载；目录授权仍绑定Main批准的实际路径，队列执行前核对。启动授权和多行粘贴确认仍保留。
- 提示符、目录、Git分支、上一命令状态、别名及补全由个人Shell配置提供。没有在产品中伪造分支或命令状态，也没有只为外观加载整套新主题依赖。原来失效的PS1与两层Bash包装已移除；实际用户的Oh My Zsh配置可按正常Shell加载。
- Agent仍使用原SDK沙箱、逐次审批、只读/禁网和原有预算；手动终端输入输出不自动进入模型上下文或Run日志。手动终端放宽不等于给Agent提权。

## 界面对齐

默认进入Terminal；右侧仅保留Terminal标题与面板操作。每个真实PTY有独立会话标签，提供新建、选中及关闭，最多四个标签。控制、权限说明、目录、尺寸等移入菜单，不再占用正文顶部大块区域。保留浅深主题与可调整分栏。

PTY注册表只返回标签元数据，不在按键回包中复制全部终端输出。每个PTY分别维护进程、输入预算、回显、seq/offset；切换标签恢复自己的有界快照，关闭一个不影响其他会话。正在启动的PTY也纳入关闭流程，避免异步创建时遗漏清理。

切换项目或会话、窗口关闭、应用退出关闭所有相关PTY。回显仍仅在内存保留最近65536字符，xterm scrollback 2000行；不是完整持久化终端录像。当前保留每标签30分钟、累计输入1MiB/输出4MiB、64KiB/秒输入等资源预算，不宣称无限期开发服务或与Codex完全等价。

## 代码范围

- `apps/runtime/src/terminal.ts`：单PTY生命周期与最多四个PTY的注册表；本机Shell启动，独立关闭与输出。
- `packages/protocol/src/terminal.ts`、`index.ts`：标签列表、选中查询、单标签移除/全部关闭和Main私有Shell配置；协议代际6。
- `apps/desktop/main/index.ts`、`runtime.ts`：本机权限确认、可信Shell环境、实际目录绑定和关闭全部标签。
- `apps/desktop/renderer/src/TerminalPanel.tsx`、`DeveloperPanel.tsx`、`style.css`：紧凑页头、会话标签、菜单和默认Terminal。
- `apps/runtime/src/exec-command.ts`：移除不再需要的PTY共享策略参数，Agent策略保持allowPty=false。

无新增依赖或单元测试，未自动提交，未修改用户DEBUG.md。

## 验证

`npm run build`（包含typecheck）及`git diff --check`通过。

[受控Electron验收](evidence/terminal-alignment.json)使用真实zsh/node-pty，临时HOME中的用户配置、临时Git项目、本地HTTP服务及受控Provider：验证启动配置和彩色Git提示符、手动实际文件写入和联网、两个PTY环境隔离/回显切换、最小窗口浅深主题、UI单标签关闭和全部关闭；Agent写文件命令仍经审批并被沙箱拒绝。

[浅色预览](evidence/terminal-aligned-light.png) · [深色预览](evidence/terminal-aligned-dark.png)。截图的提示符由临时用户配置生成，不是执行真实个人初始化文件或产品内假提示符。

本机临时入口`/private/tmp/developer-terminal-acceptance.cjs`。未调用真实模型，未对用户真实项目进行写入/联网测试；只在临时项目中验证这些能力。未覆盖用户所有插件、fish/自定义Shell、Windows/Linux、长稳运行或恶意脱离Shell作业控制的进程。个人配置差异会影响实际提示符，不硬编码保证与某个Codex截图逐像素一致。

## 默认打开一个终端

进入Terminal后先恢复已有PTY，无终端且已选择项目时自动启动一个，取消额外空状态与按钮。工作区变更即使复用Session ID也重新检查；并发恢复/焦点事件不重复创建。不再弹出原生启动确认；失败仅自动尝试一次，可用“+”手动重试。未选目录不会创建进程。

`npm run build`（含typecheck）和`git diff --check`通过；[真实Electron验收](evidence/terminal-auto-open.json)覆盖选择项目后自动创建、Tab/面板重开复用、focus不重复启动及取消后不循环。使用临时HOME与受控原生确认，无真实个人配置执行、无新增单元测试。

## 取消启动审批

按用户明确要求删除手动终端启动确认，自动打开和“+”新建均直接启动。仍检查IPC来源、当前会话与目录，Agent工具审批和多行粘贴确认未修改。

构建（含类型检查）与diff检查通过；[真实Electron验收](evidence/terminal-no-confirm.json)将原生消息框调用计数并设为失败，验证两次PTY启动及恢复均无消息框，Agent命令仍进入waiting_approval。没有真实Provider调用或单元测试。

## 删除Run Logs与Trace

按用户要求删除这两部分完整代码：UI、Hook、事件协议、Runtime埋点、存储操作、通知和日志导出；右侧仅保留Terminal。聊天Timeline、模型用量展示、工具审批与会话SQLite保留。现有v3数据库中停用日志表不读取、不写入、不清空；新库使用业务与时间线schema v2，不创建额外日志表。协议代际升级为7，需完整退出旧应用再启动。

删除验收：[真实Electron与v3数据库兼容记录](evidence/remove-run-logs.json)验证终端自动启动、日志接口全部移除、旧会话/时间线可读、普通Run仍完成，且旧日志表行数在新Run前后不变。[终端独立面板截图](evidence/terminal-only.png)已查看。无新增单元测试或真实模型请求。
