# Agent Desktop 日志组件调研

> 用户已批准采用Pino，本地JSONL关键节点实现及验收见[Runtime日志说明](runtime-jsonl.md)。本文保留选型时的调查结论，不替代接入验收。


日期：2026-10-31。仅调查官方文档、官方源码和npm registry；没有安装组件、实现日志、恢复Run Logs/Trace界面或运行性能基准。本建议不是接入验收结论。

## 决策建议

**用户已明确主要关注Agent Runtime，因此当前首选改为Pino，electron-log仅作为桌面诊断优先时的备选。** 首版聚焦Agent执行链路的结构化日志和本地文件，不恢复Run Logs/Trace界面，不重建SQLite事件库。

- Pino的JSON、child logger上下文及字段路径redact与按Run、模型调用和工具定位问题的目标更吻合；轮转组件、异步transport、Electron打包和关闭刷新仍需选定并实际验证。
- electron-log在桌面进程落盘方面接入更直接，但不是本次Runtime优先目标下的首选，也不建议同时引入两套logger。
- LogTape保留为备选，尤其当内置文件sink/轮转与TypeScript API比Pino生态更重要时；不能凭文档认定已兼容本项目。

以上排序是基于本项目架构的工程判断，不是组件吞吐排名。

## 版本、兼容与维护证据

本次通过`npm view <package> version engines license --json`只读查询官方registry。`latest`是发布者设置的dist-tag，不是我们审计后的安全或稳定性保证；正式接入前仍要锁版本并验收。四套候选及LogTape文件包许可证均为MIT。

| 候选 | 本次latest | 官方兼容证据 | 本项目尚需验证 |
|---|---|---|---|
| electron-log | 5.4.4 | README声明v5需Electron13+或Node14+；包engines为Node>=14 | Electron45.1.0、现有sandbox/preload与utilityProcess转发 |
| Pino | 10.4.0 | 该npm元数据未声明engines；不能据此认定任意Node均支持 | Electron实际Node版本、ESM/CJS外部依赖、transport worker与退出刷盘 |
| @logtape/logtape / @logtape/file | 2.4.2 / 2.4.2 | 官方支持Node/Deno/Bun/browser，建议Node从npm安装；本次元数据未声明engines | 当前Electron内嵌Node、异步上下文、file sink关闭和异常处理 |
| Winston | 3.19.0 | npm engines Node>=12 | Electron传输与格式链成本，实际文件transport行为 |

来源：[electron-log registry](https://registry.npmjs.org/electron-log/latest)、[Pino registry](https://registry.npmjs.org/pino/latest)、[LogTape registry](https://registry.npmjs.org/@logtape%2flogtape/latest)、[file registry](https://registry.npmjs.org/@logtape%2ffile/latest)、[Winston registry](https://registry.npmjs.org/winston/latest)、[electron-log README](https://github.com/megahertz/electron-log#installation)、[LogTape安装说明](https://logtape.org/manual/install)。

官方npm发布记录还核验到：5.4.4发布于2026-05-14，Pino10.4.0于2026-10-02，LogTape2.4.2于2026-10-18，Winston3.19.0于2025-12-07（按UTC日期）。[electron-log发布元数据](https://registry.npmjs.org/electron-log)、[Pino](https://registry.npmjs.org/pino)、[LogTape](https://registry.npmjs.org/@logtape%2flogtape)、[Winston](https://registry.npmjs.org/winston)

维护判断应看发布、变更记录和问题响应，不能只看star数。本轮核验了可访问的官方发布元数据和当前文档，未逐项审计未关闭issue、供应链安全或维护响应SLA。Node/Electron最低版本声明仅是必要条件，不等于本项目实测兼容。

## 组件能复用什么

### electron-log：桌面排障优先

内置Main/renderer入口、console/file transports、日志级别、scope与hooks/transforms；renderer通过IPC转发到Main。默认初始化会注入自己的preload，另有手动preload方式。**本项目宜保留已有受约束诊断入口，不直接开放任意参数logger或全量spyRendererConsole。** [初始化说明](https://github.com/megahertz/electron-log/blob/master/docs/initialize.md)、[主README](https://github.com/megahertz/electron-log)

文件transport默认同步写、阈值1MiB，超过后改名为一个`.old`文件；这不是按天或多文件保留策略。可调整sync、maxSize、format和archiveLogFn，但archive callback要求同步处理；自定义保留策略也有维护与阻塞成本。应明确选用现成能力还是适配，不能把默认值称为完整日志生命周期方案。[文件transport文档](https://github.com/megahertz/electron-log/blob/master/docs/transports/file.md)

官方明确utilityProcess日志不自动送Main，需显式转发。因此Main、Runtime及SQLite Worker仍需复用现有受验证通信做最小接入；不能多个进程无协调地写同一个轮转文件，也不能把stdout的每个chunk当成一条完整记录。[utilityProcess说明](https://github.com/megahertz/electron-log#utility-process)

### Pino：结构化与Runtime吞吐优先

原生JSON输出、child logger静态上下文、serializers及字段路径redact，适合带process/sessionId/runId/toolCallId/code等元数据。redact是大小写敏感的字段路径规则，不会识别任意自然语言或Shell输出中的秘密；规则应在初始化时固定，不能来自用户输入。[API](https://github.com/pinojs/pino/blob/main/docs/api.md)、[脱敏说明](https://github.com/pinojs/pino/blob/main/docs/redaction.md)

官方建议将转换/传输移出业务线程，v7+支持worker transport。worker路径、transport模块和额外产物是打包关注点；对本项目electron-vite必须验证，不应直接套用Webpack示例。增加worker也有内存、启动、刷新与退出成本，不能因为名为异步就认定无成本或无丢失。[transports](https://github.com/pinojs/pino/blob/main/docs/transports.md)、[bundling](https://github.com/pinojs/pino/blob/main/docs/bundling.md)

核心并非完整轮转保留服务，官方帮助推荐外部轮转并讨论重开文件与copytruncate风险。桌面软件不能默认要求用户安装系统logrotate；如选择Pino，需另行评估可维护的本地轮转transport或独立writer，不能未经比较就自研轮转。[日志轮转帮助](https://github.com/pinojs/pino/blob/main/docs/help.md#log-rotation)

官方性能定位与benchmarks不能替代当前Electron应用实测；本轮不引用“快几倍”作为选型依据。

### LogTape：TypeScript组件化备选

提供层级category、结构化属性与上下文API；Node侧上下文能力应按配置使用，跨进程仍需显式传递身份，不能自动跨utilityProcess/worker传播。[contexts](https://logtape.org/manual/contexts)、[结构化日志](https://logtape.org/manual/structured)

`@logtape/file`提供大小轮转和时间轮转；大小轮转可配置备份数，时间轮转可按年龄清理。当前文档列出默认8192字符缓冲、5000ms刷新及可选nonBlocking；这些参数只能缩小风险窗口，不保证强杀或断电不丢失。需验证sink关闭、错误诊断和慢盘行为。[文件sink](https://logtape.org/sinks/file)

`@logtape/redaction`是额外包，区分格式化文本模式和结构化字段两类脱敏，官方也明确脱敏不完美。核心零依赖/体积声明不代表加上file、redaction及其他sinks后仍保持同样依赖和体积。[脱敏](https://logtape.org/manual/redaction)、[官方首页](https://logtape.org/)

### Winston：可用，但本轮不优先

支持formats、JSON、child logger和多transport；若已有Winston生态可复用，没有必要仅因本次调研替换它。本项目没有这种存量。需避免同时配置多套重叠的format/transport，且要订阅logger/transport错误。[Winston官方README](https://github.com/winstonjs/winston)

维护方的`winston-daily-rotate-file`提供按日期/大小轮转及按数量/天数清理；文件系统错误会发error事件，文档明确要求监听以避免崩溃。这是额外依赖和配置，不属于Winston核心零配置能力；本轮未核验该transport的发布版本或安装运行。[轮转transport官方README](https://github.com/winstonjs/winston-daily-rotate-file)

## 对当前项目的最小适配边界

这里是建议，不是已实现设计：

1. 先做应用排障日志，不恢复Run Logs/Trace UI，不写业务SQLite事件流水。复用库的级别、文件写入与轮转；项目只维护必要的上下文与边界适配。
2. Runtime是主要采集点，业务使用带Run上下文的logger；落盘端通过Pino现成异步transport或受控writer实现，方案需验收后确定。renderer继续走窄诊断接口，不引入任意日志透传。多个进程选择分文件或明确单写者，不能无协调地共享轮转文件。
3. 统一最小字段：时间、级别、进程/模块、构建标识、错误code、相关ID、受控错误信息。当前Runtime部分错误被泛化、storage只记错误类别，补安全上下文比收集更多原文有价值。
4. 不默认采集Prompt、源码、环境、工具正文或用户手动终端内容。字段白名单先于脱敏；库的redact/hooks是附加保护，不是可以记录任意内容的通行证。
5. 明确保留文件数量/大小、队列/消息上限、丢弃与故障诊断、正常退出刷新。日志失败不改变Agent工具结果，也不要复用当前业务存储失败就中止Run的控制路径；日志记录不是命令完成凭据或可靠审计账本。

建议日志目录独立于业务库，接入现有路径保护，防止Agent在宽工作区内读取自身日志。目录0700/文件0600是项目应配置的目标，不是组件通用默认；electron-log文件transport文档默认mode为0666（受umask影响）。避免全量覆盖console后将库原始异常或PTY正文意外落盘；不要默认启用组件自动errorHandler接管Runtime退出，fatal与资源清理由原业务流程决定。[electron-log文件选项](https://github.com/megahertz/electron-log/blob/master/docs/transports/file.md)

真正的跨进程序号、断线回放、查询索引和UI搜索都不是以上logger自动提供的能力。本轮不推荐为了这些尚未重新确认的需求恢复已删掉的系统。

## 暂不优先上OpenTelemetry

它适合统一logs/traces/metrics并接采集后端，不是简单桌面轮转文件logger的替代品。官方JavaScript状态页当前将Logs列为Development；即使采用桥接，也要核对具体包与signal成熟度。当前没有确认远程观测需求，不建议先引入Collector或云服务。[OpenTelemetry JS状态](https://opentelemetry.io/docs/languages/js/)

## 接入前必须验证的事

最终选择后，再在临时数据中验证：Electron45.1.0打包产物可运行；Main/renderer/Runtime/worker日志可关联；库初始化不会扩大renderer能力；不重复采集；轮转/过期策略正确；磁盘权限和写入失败可诊断；高频输出不拖慢聊天；正常退出刷新与强杀丢失窗口有真实记录；秘密和原始用户终端内容不进入文件。不得将这份调研当作这些检查已经通过。

## Runtime优先后的采集范围

以下是待确认、待实现的建议，不是新增能力声明。

| 环节 | 应记录的安全信息 |
|---|---|
| Run | 接纳、开始、结束状态、结束原因、观察耗时 |
| Agent Loop | 迭代编号、选择继续模型/执行工具/等待用户/结束的实际控制分支 |
| 模型请求 | itemId、模型名、请求结果、耗时、超时/HTTP等错误码；实际返回的usage |
| 工具 | 工具名、toolCallId、输入校验/授权/执行/返回的实际结果、耗时；默认不记录参数和正文 |
| Agent命令 | executionId、进程状态、退出码、信号、输出截断等；stdout/stderr默认只记元数据 |
| 用户交互 | interactionId、申请/通过/拒绝/失效及等待耗时，不记回答正文 |
| 上下文和预算 | 历史条数、字符量/字节量等真实预算依据、上限触发原因；不把字符量称为Token |
| 取消和恢复 | 请求取消、资源清理是否确认、最终状态；重启后中断/未知结果的实际恢复结论 |
| 业务存储 | 保存操作类别、结果与耗时、失败码；不打印SQL参数或用户记录 |

优先复用现有sessionId/runId、时间线itemId、toolCallId、executionId和interactionId；传输requestId用于RPC关联。Pino child logger绑定静态上下文，跨进程显式携带ID，不宣称自动传播。首轮使用INFO记录关键边界，DEBUG仅用于有界诊断，不逐token写日志。

特别注意：工具返回了`running`不代表命令成功结束。工具调用的返回与底层执行句柄的最终退出分别记录；Run.completed也不等于任务目标已达成。当前Runtime没有自动重试，不应为满足日志清单制造retry事件。

当前真正的缺口包括：部分Runtime catch只返回泛化错误，存储只记异常类别，无法关联到具体操作。接入Pino时应补受控错误码、调用阶段和相关ID，而不是简单把所有console替换后打印完整Error/Prompt/工具结果。

采用Pino仍需另外核验轮转方案。调研阶段未批准或安装Pino及其transport；用户明确采用后再锁定依赖和验收，不恢复已删除的界面。
