# 组件协议不匹配与缺失日志修复

日期：2026-10-31。未自动退出用户现有进程、读取其消息正文/Key、删除数据库、提交或推送。

## 根因及实际复现

- 排查时本机仍有03:31启动的旧Agent Desktop主进程PID97108。旧Main和Runtime留在内存，但preload/renderer文件已被新构建覆盖；窗口重载可能出现新界面连接旧后台。
- 原先只有runtime.ping健康检查，没有组件构建身份校验。旧ping可以成功，界面显示已就绪，但旧SessionSnapshot缺少title/sessionPage/hasMoreSessions/storageError/runs/inspectedRun与message.runId。
- preload的SessionSnapshot.parse直接抛出ZodError，React的fail只把error.message放入页面，没有console输出；onChat的safeParse失败还会直接丢弃。这解释了“页面有一大段invalid_type、终端却没有对应日志”。
- 新启动失败的单实例分支原先只app.quit，CLI看起来只是“starting electron app...”后立即返回；原进程stdout也不会因为用户开了新终端而自动重定向。
- 最小一次性复现：实际生产preload/React连接临时旧版Main快照，包含10条虚构旧消息。`node /private/tmp/protocol-log-repro.cjs` 修复前结果 `rawValidationShown=true, diagnosticRecorded=false`（退出码1）；修复后 `false,true`（退出码0）。没有检查用户私密会话内容。

## 最小修复

1. 共享协议增加组件协议代际2及同一次Vite构建的buildId，Main、preload、Runtime核对后才接纳操作；持久化格式版本独立，不把构建ID写入会话数据，不因重建失效历史。
2. preload统一校验边界：界面显示重启提示/输入错误/连接失败，不再透传原始Zod详情；按错误类别和操作每10秒至多一条诊断。握手时只缓存最新快照，不积压全部事件；版本冲突后拒绝新执行和授权，安全取消仍可送达。
3. 新Main监听console-message，只转发符合ClientDiagnostic schema、长度<=4096的诊断；字段仅类别、操作和schema路径。普通renderer console错误仅记录级别/行号，不转发任意正文。RuntimeHost对健康和会话回包的校验也记录缺失字段并抛出可读错误。
4. 连接不匹配不显示准备就绪/Runtime就绪，配置未读取时显示待确认而不是未配置，不暗示用户重填Key。新实例无法取得单实例锁时明确输出startup_blocked，并以1退出；既有实例收到重复启动会记录是否构建不一致。
5. 复用原console和Electron能力，无新依赖、日志SDK或自动日志文件服务；终端落盘继续使用tee。旧版Main没有新日志转发逻辑，需要完整退出重启加载，不能靠刷新窗口修复后台。

入口：packages/protocol/src/index.ts、electron.vite.config.ts、apps/desktop/preload/index.ts、main/runtime.ts、main/index.ts及renderer/useAgentSession.ts。

## 实际验证

- build（含typecheck）及git diff --check通过；没有新增仓库单元测试。
- 原始旧协议复现绿灯，不显示invalid_type并实际捕获脱敏诊断。
- 实际产品Main/preload/Runtime链路注入缺少title及私密标记的坏快照：界面显示可读错误、终端收到client_diagnostic/protocol_mismatch，日志不含测试原始私密标记；新任务请求未送达、取消请求仍送达。
- 隔离userData下重复启动，第二实例退出码1并输出已有实例提示，未静默冒充重启成功。
- 正常SQLite冷启动、文件审批/上下文与继续追问链路通过；另外在两次启动之间执行一次完整build生成新buildId，原任务和成功上下文仍恢复，说明构建标识不影响持久化数据。
- 实际查看受控数据的协议错误截图，确认短错误提示、连接异常、配置状态待确认以及禁用的新任务/发送入口；没有把用户当前旧窗口当成新版验证。
- 结构化记录见docs/evidence/protocol-diagnostics.json；截图见protocol-mismatch-fixed.png。测试脚本均在/private/tmp；Main/协议使用真实产品实现，旧快照与坏响应为明确的临时注入，没有付费模型请求或真实Key访问。

## 局限与后续参考

- 当前新增的是既有日志链路的补全，没有宣称实现日志文件轮转、完整Trace或每个模型请求的详细监控。日志仍需从真正运行进程的启动终端或DevTools查看。
- 同一次构建的Main/preload/Runtime必须一起重启；只更新磁盘文件无法改变既有进程内存中的旧代码。不自动杀旧进程，以免丢失尚未保存的旧内存会话。
- Electron依据安装45.1.0类型及本地docs/vendor/electron/docs/api/app.md的requestSingleInstanceLock、second-instance和web-contents.md的console-message实现，未改变窗口安全设置。
- 保存和恢复的历史内容仍是不可信数据；错误日志绝不包含原始响应、工具内容、提示词或配置值。
