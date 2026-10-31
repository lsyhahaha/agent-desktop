# 本地会话持久化：实现与验收

日期：2026-10-31。状态：已实现、独立临时数据目录验收；未自动提交、推送或重启用户当前旧版应用。

## 结构与职责

- Main使用 `app.getPath("userData")/storage/sessions.sqlite` 指定路径，经utilityProcess启动参数交给Runtime；renderer、模型和工具不能选择数据库位置。
- Runtime保留现有Sessions/Agent控制循环。`storage.ts`提供有界Worker RPC，`storage-worker.ts`独占内置`node:sqlite`的DatabaseSync连接；同步磁盘操作不在UI或Agent事件循环中执行。没有新增npm依赖、ORM、事件溯源框架或远端服务。
- 实际Electron45.1.0、Node24.22.1已经验证SQLite在Worker中可用。构建增加独立storage-worker入口，preload继续打包协议校验，不新增通用数据库/文件IPC。
- 初始schema版本1，user_version高于支持值时拒绝打开，不删库重建；创建和迁移在事务内完成。启用foreign_keys、WAL、synchronous=FULL、busy_timeout=3000。应用数据目录创建权限0700、数据库0600，拒绝符号/硬链接文件。

## 五张表

| 表 | 所有的数据 |
| --- | --- |
| sessions | 标题、自定义标题标志、工作区、任务完成状态、创建/更新时间、最后选中项 |
| runs | 按自增seq确定轮次顺序，保存模型名、状态、用量、错误和检查点revision |
| messages | 用户/展示回答、run_id、轮内顺序、完整/中断状态 |
| tool_calls | 每轮工具的原始参数、返回给模型的原始结果、审批决定、开始/结束时间和UI投影 |
| session_context | 当前有效成功模型上下文、格式版本和对应成功run_id |

展示回答与模型上下文分别保存：当前UI将一轮多个模型步骤合并显示，不能直接用这些展示文字重建工具协议。每个会话只存一份当前有效context，不为每次HTTP请求复制整段历史；Provider配置和API Key不进入保存DTO。用户消息或批准读取的源码本身可能包含秘密，本功能不是自动脱敏器。

## 保存与恢复语义

1. 发送先持久化运行和用户输入，再调用模型并返回接纳结果；写入失败不调用模型。
2. 流式回答和命令输出约500ms合并保存，仅保留一个后台检查点，临界写入按顺序排队；不是逐token写盘。正常工具边界和终态立即保存，不等定时器。
3. 工具审批记录持久化后才公开可回复的interaction；实际工具开始前先保存授权决定及执行意图，结果保存后才进入下一模型步骤。
4. 成功时事务提交最终展示消息、工具结果、Run状态与新context，成功提交后才公开completed并采用context。提交点之后到达的取消不回滚已经完成的事务。
5. 失败/取消保存部分展示和已知工具结果，context保留上一份成功版本。历史工具记录不再被新一轮清空，而是按run_id保留并按需读取。
6. 正常退出先取消模型/命令、等待Run终态保存、关闭Worker，再退出。Main等待有超时，不无限卡住退出。
7. 冷启动将running/waiting_user运行标为interrupted，流式消息标为interrupted；等待审批的工具失效，缺少最终结果的已开始工具标为unknown，并保留已经保存的输出。已知成功/拒绝结果保持原样。不会恢复Controller、审批闭包、计时器或进程句柄，不自动发起模型请求/工具重放。
8. 恢复工作区后，发送前重新检查目录存在、可读及规范路径；历史文件/命令结果只代表当时观察，system prompt提醒重新核对当前状态。

SQLite事务失败、Worker异常或存储超时会停止接纳新任务并提示保存异常；活动Run收到storage_error取消信号。不会自动重试不确定的写入，也不会静默降级为“内存成功”。不存在的历史ID按业务拒绝处理，不把它误判成数据库全局故障。

## 界面、资源与隐私

- 后端只加载当前Agent和每页20条索引，磁盘会话数不再受原20个内存会话限制。搜索当前页，上一页/下一页浏览其他记录；不宣称实现全库全文搜索。
- 仍保留每个会话最多50轮、上下文/显示输出、6次模型请求/12次工具/120秒总运行及命令60秒/32KiB限制；存储检查点和审批耗时计入运行时间。更长任务请新建会话，不偷偷扩张模型预算。
- 当前轮与历史轮复用ToolRecords组件，历史列表只带摘要，用户展开时取该轮工具投影，不在每个token快照中复制全部历史输出。
- 应用会话目录登记为受保护路径，read_file/list_directory和命令OS沙箱共同拒绝读取；宽工作区选择也不能借工具访问其他项目的会话数据。
- API Key继续由safeStorage保存；会话/源码片段/命令输出是普通本地SQLite数据，不宣称加密或自动脱敏。前端草稿未持久化。
- 数据保留在本机，数据库及WAL/SHM被.gitignore排除。没有自动删历史、归档、云同步、磁盘配额/自动清理、灾备或数据库加密；磁盘满走明确失败路径。
- 异常退出可能丢失最后尚未提交的流式片段；已开始但未保存结果的工具不能靠恢复数据库证明其最终状态。SQLite耐久性仍依赖OS/存储设备遵守刷盘语义，不保证恶意宿主和硬件故障下的数据恢复。
- 升级前旧进程只有内存数据，本次未从旧进程读取/导入历史；首次运行新版本后开始保存，旧内存会话无法自动补存。

## 实际验证范围

未新增仓库单元测试。一次性集成探针及数据库全部在/private/tmp；没有读取或修改真实用户Key/会话库，没有真实DeepSeek费用。成功响应来自受控SSE模型替身，不声称验证真实模型质量。

- 内置能力探针：实际Electron Node24.22.1的Worker建表、绑定参数写入、查询成功。
- 会话集成：真实SQLite Worker+Sessions+Agent+目录/文件/OS命令，验证重启恢复标题、任务状态、工作区、消息、命令输出；继续追问保留工具原始上下文，失败轮不进入上下文；超过20个任务的分页、非当前任务改名、历史工具按需加载通过。Provider Key标记未进入context/审计。见 `docs/evidence/persistence-session.json`。
- 故障集成：独立子进程在审批和流式输出中实际exit，重启恢复interrupted、保留已提交部分文本、旧审批过期；另用未决工具检查点fixture验证unknown结果而不制造真实孤儿进程。SQLite触发器使终态context写入失败，消息终态/context事务一起回滚，旧成功上下文保留。见 `persistence-recovery.json`。
- 边界集成：宽工作区内文件和实际OS命令均不能读受保护应用数据目录；取消停止真实命令，SQLite写锁期间取消响应保持可用，解锁后不请求模型。见 `persistence-boundary.json`。
- 实际产品进程：独立userData运行生产Main、preload、React、utility Runtime和Worker，仅替换模型网络与临时原生目录选择，使用虚构Key。正常退出再冷启动恢复同一任务、加密模型配置、工具结果；没有自动请求；继续追问包含此前原始文件工具结果；页面渲染本地保存提示和逐轮历史入口。见 `persistence-electron.json`。
- 已实际查看独立验收实例的1320×860与1000×680渲染截图，修正最小窗口分页文字换行。1000×680下页面scrollWidth=1000、发送按钮底部609，未出现整页横向溢出或发送入口越界；截图为受控数据，见 `docs/evidence/persistence-default.png` 与 `persistence-minimum.png`。未将原有旧版用户窗口截图作为新版验收。
- npm run build（含typecheck）和git diff --check通过。没有重跑真实付费模型压力、物理断电、长稳、多设备或恶意文件系统竞争验收。

## 官方参考

- Node24 SQLite：https://nodejs.org/docs/latest-v24.x/api/sqlite.html 。内置模块在该分支仍标记为Release Candidate；不依据最新Node26接口开发，实际运行版本已单独验证。
- SQLite事务：https://www.sqlite.org/transactional.html 。WAL/事务不能代替应用层的“恢复历史而不重放外部执行”规则。
- Electron：本地docs/vendor/electron/docs/api/utility-process.md、tutorial/process-model.md、tutorial/security.md；安装版本45.1.0实际验证。
