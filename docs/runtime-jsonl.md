# Agent Runtime 本地 JSONL 日志

2026-10-31。按用户批准采用Pino10.4.0，关注任务执行过程和关键节点；只写本地文件，不恢复Run Logs/Trace界面，不写独立SQLite日志表、不接远程服务。

## 文件在哪里，怎么看

当前Main将业务库放在userData/storage/sessions.sqlite，Runtime据此将日志放在：

```text
<应用userData>/logs/agent-runtime/
  runtime.jsonl       # 当前固定文件，所有任务与Runtime记录统一追加
  runtime.1.jsonl     # 最近一份滚动备份
  ...
  runtime.5.jsonl     # 最多五份备份
```

启动终端会输出`[runtime-log] directory`及实际目录。userData以运行配置为准；任务ID保留在每条记录的runId字段，不再用来命名文件。

```sh
# 此处为本机当前默认路径；如果启动输出显示其他目录，以实际输出为准。
tail -n 100 -F '/Users/a1111/Library/Application Support/agent-desktop/logs/agent-runtime/runtime.jsonl'
```

使用大写`-F`会跟随固定文件名，滚动替换或重启后仍可继续查看，不必按任务重新执行。普通`-f`只跟随当前文件描述符，发生滚动后可能继续停在旧文件。首次文件尚未创建时`-F`会等待重试。

每轮关键节点与Runtime启动、恢复、错误、退出写入同一文件。不同任务由sessionId/runId区分，重启由bootId区分。强杀后恢复记录在同一文件追加并关联原runId，不重放工具。旧版ID命名日志不自动合并或删除，也不再追加。

## 一条记录包含什么

Pino输出时间`time`（UTC ISO8601）、字符串`level`、固定中文`msg`、`event`、日志`schemaVersion=1`、构建标识、进程与pid、bootId及每次Runtime启动内递增seq（跨任务共享；重启以bootId区分）。任务记录额外绑定sessionId/runId；具体步骤记录适用的itemId、toolCallId、executionId、interactionId。没有的字段省略，不编造。

| 事件 | 实际含义 |
|---|---|
| run.received / storage.saved / run.created | 收到输入、业务保存完成、确认接纳；保存失败不会宣称已接纳 |
| run.started / run.state_changed | 运行开始及真实状态改变 |
| loop.started / loop.continued | 当前迭代、历史规模、上下文字符量；工具结果回填后继续模型 |
| model.started / model.completed / model.failed | 单次模型请求、观察耗时、文本字符数、调用数量或失败码 |
| model.usage | 仅Provider实际返回的输入/输出Token；缺失不估算，不当作完整账单 |
| tool.requested / tool.validated / tool.started | 模型提出调用、参数校验通过、开始实际操作；审批前不冒充实际执行 |
| interaction.requested / resolved / expired | 审批或提问及其允许/拒绝/回答/失效、等待耗时；不记正文 |
| plan.updated | Agent申报的计划修订和步骤数，不代表工具证据 |
| file.read / proposed / applied / failed | 获准读取、提出修改、实际写入确认或失败/未知 |
| tool.returned | 工具函数返回。state=running意味着进程仍未结束，不是命令成功 |
| execution.started / execution.completed | 命令真实spawn与最终退出，含executionId、状态、退出码、信号、输出量/截断元数据 |
| tool.failed | 工具局部错误、失败阶段及稳定错误码；不自动等于整轮失败 |
| run.cancel_requested / cleanup.started / cleanup.completed | 用户取消与本轮资源实际清理边界 |
| run.timeout / run.budget_exceeded | 实际触发的超时或预算上限；不制造不存在的重试事件 |
| run.completed / failed / cancelled | 业务终态结算后的结果、耗时、调用数及用量覆盖情况；执行完成不承诺任务目标达成 |
| recovery.* / run.interrupted | 会话恢复及被标记中断的任务，关联原runId |

Task层与工具/进程层结果分开。耗时为实际观察区间，整轮包含用户等待；并非各子项之和，也不是扣除等待后的主动执行预算。字符量不称为Token。

## 安全与资源策略

- 白名单只接受固定事件与受控标量；默认不记录Prompt、用户输入/回答、源码、修改全文、工具参数/正文、stdout/stderr正文、环境或用户手动PTY内容。文件事件可含已校验的相对路径，路径和模型名仍可能含项目命名信息。
- 已知当前Provider Key与常见令牌形式在采集端额外删除，Pino固定字段redact再做附加保护；不承诺正则能识别任意秘密。原始Error/stack不直接透传，错误用稳定code、阶段和关联ID定位。
- 目录0700，文件0600；固定文件打开时拒绝链接/非普通文件/硬链接并校正权限，初次或重启以追加方式打开，滚动后独占创建。日志目录加入原有Agent路径保护；人类本机终端的权限不改变。
- Pino destination使用异步文件输出，无额外日志worker线程/transport。启动/滚动期间缓冲最多128条且64KiB，destination配置maxLength=65536（按库计量）。仅关键边界记录，不逐token或逐stdout chunk落盘。
- 每任务最多512条及约1MiB的保守上下文预算；Runtime上下文每次启动最多5000条/约8MiB预算，达到上下文上限只停止该上下文，其他任务继续。写入失败或缓冲溢出则采集降级，启动终端输出固定`[runtime-log] degraded`类别，不把原始正文作为回退内容，不改变Agent结果。
- 当前固定文件按真实序列化字节计数，10MiB前排空/关闭Pino destination，将自有编号文件后移并重新打开runtime.jsonl，最多保留五份备份。不另装轮转transport，也不按任务新建文件；旧的100份任务/20份启动文件及14天保留策略停用。只操作runtime.jsonl和runtime.1～5.jsonl，不清理旧ID文件、业务库或其他文件；正常新增约60MiB保留量，不是硬磁盘配额。
- 重启追加前最多读取64KiB尾部；完整JSON仅缺换行则补换行，残缺JSON尾行则截断至最后完整行，并记录`runtime.log_repaired`及修复字节数。过大且无法确认边界的尾部拒绝追加并降级；不将新记录接到半行JSON后面。只处理末行，不声称修复任意历史损坏。
- 单个Run结束只关闭自己的日志上下文，不关闭共享文件；Runtime退出时排空并关闭共享destination，最多等待1.5秒。正常运行不等待日志保存来判定工具成功。正常退出、受控fatal退出会尝试排空；SIGKILL、原生崩溃、断电或停止超时可能丢失最后一批。不提供exactly-once审计或断电持久性保证。

## 代码入口与接入范围

- `apps/runtime/src/runtime-log.ts`：Pino单写者固定文件出口、child上下文、白名单/脱敏、有界缓冲、编号滚动与故障降级。
- `agent.ts`：真实Run/Loop/模型/工具/交互/文件/清理/终态节点；`exec-command.ts`只观察真实spawn/最终退出，观察者异常不抛回进程控制。
- `sessions.ts`与`index.ts`：Run日志工厂、启动恢复、RPC失败和退出生命周期；日志目录由可信业务库路径派生，不接受renderer指定。
- `storage-worker.ts`、`storage-types.ts`、`storage.ts`：仅将已有恢复操作的真实数量及前100个身份返回给Runtime用于关联日志；不新增日志表、业务写入方式或查询UI。
- package.json/package-lock.json只新增锁定Pino10.4.0，复用其原生异步destination。没有额外轮转依赖、自定义通用日志框架或全量console覆盖。

## 验证与边界

`npm run build`（包含typecheck）及`git diff --check`通过。真实Electron45.1.0、Pino10.4.0、SQLite及macOS沙箱，使用临时HOME、项目、数据目录与受控Provider，没有真实模型调用或新增单元测试。

[固定文件验收](evidence/runtime-fixed-jsonl-acceptance.json)覆盖：完整workflow节点、跨任务顺序/关联、实际usage、running与退出分离、取消/清理/结果、模型/工具失败、审批拒绝、敏感标记、0700/0600、Agent日志目录保护、正常退出、跨重启追加和恢复关联、目录故障不阻断业务，以及10MiB编号滚动后继续写固定路径。

[尾部修复验收](evidence/runtime-jsonl-tail.json)覆盖完整行后残缺JSON的恢复及完整JSON缺换行的补齐，均在真实Electron启动链路和临时文件上验证。早期按Run文件的验收记录保留为历史，不代表当前文件布局。

本机临时入口`/private/tmp/runtime-fixed-jsonl-acceptance.cjs`、`/private/tmp/runtime-tail-repair.cjs`。受控SSE替换模型网络，其余为真实产品链路；没有调用真实模型或写单元测试。未覆盖真实磁盘满/断电、全部滚动故障窗口、打包签名/asar、Windows/Linux或吞吐基准。日志不是业务审计账本，缺少一行不能据此断言操作未执行。
