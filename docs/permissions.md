# Agent权限模式与验收

2026-10-31。当前功能事实；取代早期文档中“Agent只读禁网、文件逐次人工审批”的描述。复用现有React、Zod、DeepSeek模型适配、沙箱SDK、SQLite和JSONL日志，没有新增依赖或第二套执行循环。

## 内置删除审批钩子（优先于模式）

2026-10-31补充：Agent命令涉及删除必须人工审批，`ask / auto_review / full_access`均不豁免，模型不能代批。规则在Runtime工具执行前生效，复用原Interaction、绑定Run/交互ID、持久化、拒绝、取消和超时链路。手动PTY终端不受此Agent钩子约束。

不能通过`rm`黑名单可靠识别任意Shell程序的副作用。当前SDK没有逐次文件删除审批接口，因此采取保守的正向子集：只自动放行单条、无Shell求值的字面量查询命令（pwd/echo/printf/true/false/ls/cat/head/tail/wc/stat/basename/dirname/uname/whoami/id，系统路径或命令名）；printf的选项形式不自动放行。不能将git、解释器、包管理器或可执行预处理器的工具加入该集合。

删除命令、脚本、包装器、复合命令、重定向、替换、未覆盖语法及其他未知命令一律人工审批。这意味着`npm run build`、`git status`、普通Shell写文件也可能多一次确认；纯文件读取和结构化编辑沿用下表。非空`write_stdin`同样必须人工确认并展示输入预览，可展开原工具参数查看完整内容；空输入轮询和停止不增加审批。

强制钩子不更改原`needs`权限范围：普通模式批准删除命令不等于允许项目外/网络访问，仍在原沙箱中执行；显式边界外授权才可走宿主。批准的完整命令及后代可能执行多次删除，一次确认授权的是该次调用，不是逐个文件/系统调用拦截。依赖系统二进制与宿主可信，不承诺抵抗恶意宿主替换程序；修改代码文件、原子替换自身的清理不是Shell删除命令。

新增入口`apps/runtime/src/command-approval-hook.ts`是有界字面量识别器，不是完整Shell解析器；无新依赖，不新增Hook插件框架。优先级：强制人工钩子 → 会话模式 → 操作执行。JSONL `approval.hook_required`只记录工具、模式、条目ID及固定原因码，不写命令/输入正文。

本轮实际验收：三种模式中`rm`拒绝保留文件、批准后实际删除；`find -delete`、`git clean`、Python删除、`r''m`、命令替换、bash包装、npm构建及printf数组赋值均等待人工；引用后的纯输出文本不会误报执行；普通模式批准删除不放宽宿主范围；非空stdin等待人工且取消后无残留运行态。已通过类型检查、构建、受控Electron界面与JSONL检查，无单元测试或真实付费模型调用。以下记录中的早期“Shell自动写入”验收发生于该钩子加入前，当前以本节为准。

## 用户行为与边界

| 模式 | 工作区普通文件/命令 | 项目外、敏感路径、联网命令 |
| --- | --- | --- |
| 请求批准 `ask` | 自动执行 | 每次人工确认具体操作 |
| 帮我批准 `auto_review` | 自动执行 | 独立无工具模型审查，只有明确allow自动批准，否则转人工 |
| 完全访问权限 `full_access` | 当前用户宿主权限，命令仍受强制钩子约束 | 普通常规操作无逐次审批；删除/无法确认无删除的命令必须人工 |

输入区左侧菜单保存到当前会话；新会话默认ask，旧数据迁移也默认ask。每轮接纳时冻结模式，运行中更改被Runtime拒绝，必须先停止。切换模式不更改历史Run的模式和执行结果。完全访问模式启用前由Main显示原生确认，取消不改变模式；renderer不能传“已确认”绕过Main。手动PTY终端保持独立、自动启动、不审批。

选择工作区后才开放文件与命令工具。读取的文本和工具结果会进入主模型上下文；自动审查还会向同一Provider发送原始本轮用户任务、工作区路径、工具名及完整候选参数（包含候选编辑内容）。审查不发送完整对话、API Key或环境变量；**不会自动对输入内容中的秘密脱敏**。应选择可发送模型的工作区。API Key仍仅用于Provider请求认证。

## 执行策略

- 默认命令使用现有 `@anthropic-ai/sandbox-runtime` 的macOS沙箱，允许工作区读写，禁止直接联网，保护应用数据目录和常见凭据路径。SDK提供必需的系统读取、临时目录写入以及额外内部保护，不能将其描述为严格“只能访问项目内”的虚拟机。隐含临时目录写权限沿用SDK，不承诺隔离所有系统资源。
- 需要联网或项目外访问时，模型必须显式提交 `exec_command.sandbox_permissions="require_escalated"`，或指定项目外工作目录。Runtime在执行前人工审批/独立审查。普通命令失败不会自动转宿主，也不通过命令关键词猜测风险。未声明网络需求的命令可能先被沙箱拒绝，模型需另行明确申请。
- 一次批准的宿主命令以当前用户权限执行完整命令，包括该命令创建的后代；批准不是只放行某一个URL或文件。审批界面显示完整命令/参数，授权仅绑定当次调用，下一次边界外调用重新审批。SDK不可用时普通模式失败关闭，不静默降级宿主。
- 宿主命令也使用非登录bash及最小固定环境，不继承Provider密钥环境变量、不加载个人Shell配置；HOME为`/nonexistent`。完全访问是文件/网络权限，不是交互登录Shell；没有TTY或sudo交互。手动PTY才加载个人配置。
- `read_file`/`list_directory`将绝对路径或相对路径落实到实际检查；工作区普通路径自动允许，项目外/隐藏/凭据类路径请求授权。普通模式继续拒绝链接、跨设备等不支持情形；批准路径仍保护应用数据目录，full模式可访问该目录。文件检查不能抵御恶意宿主持续并发改名。
- `edit_file`仍限本轮已读取的已有普通UTF-8文件，前后最多32KiB；Runtime保存前后对照与摘要，复核身份/版本后同目录临时文件替换并保留权限。授权范围改变不会取消冲突检查。需要创建、删除、大文件或更广文件操作时使用相应权限的Shell。
- 原有命令60秒、32KiB累计输出、单活跃命令、进程组清理及每轮6次主模型/12次工具/120秒主动预算继续有效；完全访问也不会绕过预算和取消。

## 独立审查与失败

`approval-review.ts`调用现有modelStep创建独立上下文，不携带工具定义，不执行审查输出中的工具。要求严格JSON决策；非allow、工具输出、非法JSON、输入超过32KiB、Provider失败或15秒超时均转原人工Interaction，不重试、不默认允许。模型生成的理由不进入日志/界面，避免泄漏输入或隐藏推理。

审查不是另一个可信权限服务，也不是经过安全评测的策略引擎；它与主Agent使用相同配置的模型，但请求、上下文和职责独立。没有执行真实模型审查质量评估，不能保证抵抗所有提示注入或识别任意命令副作用。

每个待授权工具最多增加一次审查，输出上限1024tokens；计入本轮120秒主动预算。人工等待暂停主动预算，沿用10分钟等待上限。真实返回的审查Token加入本轮汇总并显示于审查条目，缺少用量标为不完整。取消审查中止请求，取消/超时不会被当成批准；等待期间停止使旧交互失效。

## 数据、日志与代码入口

- 协议v8：`PermissionMode`、`set_permission`、`SessionSnapshot.permissionMode`；`ChatSnapshot.runPermissionMode`及历史Run/Inspection的permissionMode保存冻结配置。
- SQLite schema4：sessions/runs分别新增permission_mode；v0/1/2/3迁移，保留旧业务记录与停用日志表；旧记录默认ask。终态Run快照不随会话配置变更。
- 工具审计增加permissionMode和approvalSource（workspace/user/review/full），保留审批结果。关键操作仍先持久化意图再执行，编辑恢复仅核对摘要，不重放写入。
- `approval_review`是真实时间线条目，显示正在审查、批准或转人工、摘要指纹及可用Token；人工审批沿用原交互条目。任务在审查时为running、转人工时为waiting_approval，批准后running，拒绝工具skipped后Agent可继续。
- 固定 `runtime.jsonl`新增 `permission.changed`、`approval.review_started/completed`；run.created含冻结permissionMode，审查记录digest、decision、耗时、状态码和实际用量。不写审查Prompt、原始理由、文件正文或命令正文。
- 主要入口：`PermissionPicker.tsx`/`useAgentSession.ts`、Main chat handler、`sessions.ts`/`agent.ts`、`permissions.ts`/`approval-review.ts`、`workspace-path.ts`/`exec-command.ts`、`storage-worker.ts`、protocol。
- Electron沿用45.1.0；原生确认参考本地官方文档 `api/dialog.md#dialogshowmessageboxwindow-options`，没有升级Electron或改变窗口安全设置。

## 实际验证与边界

未编写单元测试。执行`npm run typecheck`、`npm run build`及临时验收脚本；不将受控Provider输出当作真实模型质量验收。Electron、Runtime、SQLite、OS沙箱与工具进程均为真实构建，所有文件与HTTP服务位于临时非敏感工作区。

已验证：

- 工作区相对/绝对路径读取自动完成；结构化修改自动应用；Shell实际写入项目文件。
- 普通沙箱拒绝项目外写入和本机HTTP联网；人工批准后实际读取项目外文件、宿主命令写入项目外文件、请求本机HTTP服务；拒绝不执行。
- 运行中改模式及重复/过期审批回复被拒绝；审批等待期间取消结束原Run。
- 独立审查allow执行，ask及HTTP429转人工；不使用主Agent上下文中的工具结果来代替审查。
- 完全访问原生确认取消保持原模式；确认后项目外实际写入，无逐次审批；重启恢复原模式与历史Run。
- 新会话默认ask；从模拟v3旧库迁移保留业务历史和停用日志表，默认ask。
- JSONL含模式与审查决策，不含验收命令正文；浅色与1000×680深色实际界面，菜单展开及Escape关闭。

已实际验证审查请求中取消，无残留运行态；15秒真实超时后转人工，拒绝后正常结束。未覆盖：真实付费模型判断质量、Windows/Linux沙箱、恶意宿主隔离、全部命令/网络协议、完整构建工具链与大规模性能压测；旧版v1/v2迁移路径通过代码检查，受控升级重点为v3。
