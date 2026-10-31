# Agent 执行时间线

日期：2026-10-31。参考 [Codex App Server](https://learn.chatgpt.com/docs/app-server) 的 Thread / Turn / Item 分层，复用本项目 Runtime，不接入 Codex 后端；无新增依赖、无单元测试。

## 实现与事件映射

- `packages/protocol/src/timeline.ts`：有界判别联合，稳定 UUID、runId、首次出现顺序 seq、生命周期 phase、独立 Item status、时间戳和类型化详情。Runtime 的 add / finish 及真实流回调生成事实，50–100ms合并发布快照，前端不根据关键词识别事件。
- `apps/runtime/src/agent.ts`：模型调用独立于公开输出；同次请求的文本 delta 只更新一个 message Item。计划使用一个节点和修订数组；未来待办只在计划内部显示。目录/读取/命令来自工具注册表，verification 由显式 purpose 标记。审批与提问有单独交互节点及原操作关联。
- `ExecutionTimeline.tsx` 与 `App.tsx`：按 Run 展示时间线，当前轮实时更新、历史按轮按需读取；长参数、日志、前后对照只在展开时挂载。沿用 Markdown、主题、Minimap、输入与窄桥接；上滚不拉回，提供回到最新。
- `useAgentSession.ts`：只接受更高 revision，重复或旧快照不回退；先监听再读取，窗口重新获得焦点时重取权威快照，不重发执行命令。
- `storage-worker.ts`：数据库v1→v2事务迁移，新增 timeline_items 与版本字段。旧记录为 null 版本，不合成不存在的时间线。历史通过 inspect_run 读取；成功上下文仍与终态原子提交。

## 状态与操作语义

已持久化接纳 queued → running → waiting_approval / waiting_input → running → completed / failed / cancelled。queued不是并发任务队列。中断恢复使用 interrupted；waiting_user仅兼容旧数据。没有paused、自动重试或retry_scheduled能力。

Item独立使用pending/running/completed/failed/skipped/cancelled/interrupted/unknown。拒绝操作标skipped，整轮可继续；非零退出标局部失败，不自动将整轮判失败。completed表示本轮执行结束，不承诺目标已达成。计划步骤由Agent申报，不是执行证据。

审批/回答/取消绑定sessionId和runId，交互额外绑定interactionId；同一回复同步移除接收入口，重复、过期、跨轮回复由Runtime拒绝。停止先显示正在停止，模型/交互取消及命令进程组清理后才公开终态。已发布投影与内部正在提交的状态隔离；终态提交返回前查询不会提前显示完成。已保存终态禁止后续checkpoint覆盖。

主动执行预算120秒，等待用户暂停预算；每次等待最多10分钟，超时失败。模型60秒、流空闲30秒及命令最长60秒独立限制不因用户等待暂停。无额外模型调用或后台轮询。

## 文件修改与持久化边界

仅支持本轮已批准读取的已有普通UTF-8文本；修改前后最多32KiB，不创建/删除/重命名文件，不支持批量原子提交。read_file返回base_hash，edit_file提交相对路径、base_hash及完整新内容。审批显示Runtime捕获的前后全文对照，批准绑定候选内容与基线。应用前复核内容、dev/ino、mtime和权限，变化则拒绝覆盖；成功后需要重新读取才能再次修改。

写入意图先保存，再以同目录独占临时文件、刷盘、复核、rename替换与目录刷盘应用，保留原常规权限。原目录的隐藏文件、链接、跨设备、凭据和应用数据保护沿用原策略。Shell仍只读且禁止网络，不为运行构建或测试关闭沙箱。

异常恢复不自动重执行。未决写入核对目标摘要：候选一致为已应用、原摘要一致为未应用，其余或核对失败为unknown；这证明当前内容的匹配关系，不证明中间没有其他写入。旧审批与句柄失效；未知真实结束时间不补造结束时间。正常结束清理临时文件；在临时文件创建后、替换前被强杀可能留下隐藏临时文件，目前不自动扫描删除工作区文件。

路径检查不等于对抗恶意宿主并发改名的OS隔离；单文件替换不保证保留ACL、扩展属性或其他非普通权限元数据。该版本用于普通源码文本修改，不适用于依赖这些元数据的文件。内容与审批记录保存在既有未加密本地会话库，获准读取及工具输出继续进入DeepSeek上下文；没有新增遥测。

文本检查点约500ms合并，慢存储期间只保留一个后台检查点写入，关键操作串行持久化。保存失败停止执行并显示保存异常，不降级为内存成功。Item最多128个，预留错误/总结位置；模型请求6次、工具12次、原文本/输出预算保留。详情按轮加载，不宣称已完成大规模性能压测。

## 实际验证

受控SSE仅替换Provider网络；Electron、Main/preload、utilityProcess、Runtime、真实文件和SQLite、macOS命令沙箱使用产品构建。全部使用临时userData和临时项目，没有真实密钥或私密源码，没有调用真实模型。

- [端到端记录](evidence/timeline-acceptance.json)：计划修订、目录/文件读取与审批、修改审阅与应用、问答、真实验证命令、拒绝、版本冲突、非法工具/路径/未读取修改、重复/跨轮回复、非零退出、命令取消/超时/输出截断、Provider失败、流式取消、历史加载与滚动、真实强杀后重启、SSE节点去重。
- [数据库与协议边界](evidence/timeline-boundaries.json)：迁移、未决写入核对、无工作区问答、旧/重复快照、终态提交延迟与迟到取消一致性、实际SQLite写锁故障。
- [预算与等待](evidence/timeline-timing.json)：独立验收进程缩短计时器验证等待暂停预算、交互超时、主动超时；产品常量仍为120秒/10分钟，不宣称实际等待了10分钟。
- [修改审批](evidence/timeline-approval.png)、[完成浅色](evidence/timeline-completed-light.png)、[最小窗口深色](evidence/timeline-minimum-dark.png)：受控数据截图，实际查看布局；截图不能替代上述链路验收。

最终执行 `npm run build`（包含 `npm run typecheck`）及 `git diff --check` 均通过。构建仅有现有Zod依赖的PURE注释处理提示，无构建错误。参考本地Electron官方快照 tutorial/ipc.md、tutorial/context-isolation.md，运行版本Electron45.1.0，保留contextIsolation/sandbox与受限bridge。未新增Electron API或放宽安全配置。

未覆盖：真实DeepSeek对新增工具的自主选择质量、真实付费端到端请求、Windows/Linux、读屏软件、真实中文输入法全流程、大规模负载、磁盘物理故障、恶意宿主竞态、每一个文件系统崩溃窗口。MCP仅协议预留，界面不会产生模拟MCP节点。文件对照为完整前后文本，不是最小行级补丁。

本机临时验收入口：`/private/tmp/timeline-acceptance.cjs`、`/private/tmp/timeline-boundaries.cjs`、`/private/tmp/timeline-timing.cjs`；使用受控Provider包装器和既有Playwright安装，不构成项目新增依赖或可移植测试套件。完整端到端在已发布投影隔离版本上复验，最终构建增加的结算取消保护由实际SQLite写锁场景专项验证。
