# 只读分析子Agent：实现与修复验收

2026-11-01。基于feature/subagent的4c0bdf3修复审查发现的四项问题，准备合入main；不把控制平面单类测试通过等同于完整执行链路通过。

## 能力与责任

- 主Agent可用spawn_agent创建独立分析请求、wait_agent获取结果、cancel_agent请求取消。每轮最多三个活跃子任务，stopping也占容量；所有控制调用计入原12次工具预算。
- 子Agent只收到最多4000字符的任务、固定系统说明和相同模型配置，不继承父对话、不提供文件或Shell工具、不允许再次委派。分析依赖父任务提供的内容，不能声称检查未提供的源码。当前模型声明只在已选择工作区时开放这些控制工具，普通对话没有这些声明。
- 子模型每次最多2048输出tokens，沿用60秒请求/30秒流空闲超时、父Run的取消与120秒主动预算；等待人工交互时父主动预算暂停，子请求的独立超时继续有效。
- 正常父任务结束也取消未完成子任务，并等待清理和记录结算；不自动等待其完成业务目标。子模型失败不自动使整个父Run失败，wait返回真实failed/error供主Agent判断。
- 子调用增加API成本；本轮用量包括所有实际返回的主/子请求及已有独立审查用量。任何已启动子请求缺失usage或异常中断则标为不完整，不估算。

## 修复的审查问题

1. 主/子模型共用recordModelUsage，累计真实输入输出；子模型返回工具调用等无效业务结果时，仍保留已获得的实际usage。
2. 子任务模型条目先为pending，写入其稳定childId（摘要）、对应工具参数及执行意图后才允许modelStep发出请求。控制操作也先保存意图再执行；持久化失败不得发出子请求。
3. 每个子请求复用已有model时间线条目，不新增协议类型或数据库schema。固定JSONL中的model.started/completed/failed/usage带childId、itemId，控制生命周期增加subagent.created/completed/cancel_requested。不写原始任务、模型正文或外部异常正文。
4. 无工具请求也校验实际响应，任何result.calls均以child_protocol失败，不能completed+空文本。不执行异常响应中的工具。

控制平面仍只管理内存生命周期，记录和计量由拥有父Run的Agent负责。children.wait结算观察者记录最终模型状态并持久化；父Run的finally等全部观察者刷盘后才提交终态，即使第一次microtask之前取消，也不会依赖模型回调一定执行。存储失败沿用storageFailed中止Run。重启只恢复展示，不重放子请求。

JSONL run完成记录中modelCalls为主模型与子模型请求数之和，同时列出primaryModelCalls和childModelCalls；独立审批审查仍由原审批事件单独表示，此字段不是完整API账单计数。子Agent UUID通过模型条目摘要及JSONL关联；spawn工具完成只表示已接纳，后续模型条目才表示分析执行状态。

## 实际验证

未新增单元测试、依赖或付费请求。使用隔离工作树、临时userData/SQLite及受控Provider，通过真实Electron45.1.0、Runtime、持久化Worker和界面执行：

- 正常spawn→wait→完成：主请求累计21/9，子请求101/29，最终122/38且complete=true；修复前为21/9。JSONL有全部4次model.started，并关联childId。
- 在临时Provider接收子请求时只读查询SQLite，确认spawn意图已落盘；修复前尚未落盘。
- 子响应工具调用：child_protocol、failed，已知用量仍累计；修复前completed+空结果。
- 子请求无usage：最终complete=false；HTTP429及未wait的子失败有真实failed条目、日志和不完整用量。
- 父Run在wait中取消、父模型提前正常结束：子条目cancelled，无残留pending/running。
- 同一轮请求四个长耗时子任务：只启动三个模型请求，第四个条目标skipped，结束时取消并清理三个活跃任务。
- 重启后加载包含cancelled子模型条目的历史，终态不恢复运行。
- 临时SQLite trigger阻止子模型条目插入：父Run失败，子Provider请求数没有增加，验证失败关闭。
- 实际查看异常子模型的时间线与用量展示；没有更改前端布局或权限策略。
- npm run build（含类型检查）、分支既有5项AgentControl生命周期测试、git diff --check通过。

未覆盖：真实模型分析质量、付费Provider计费对账、长时间压力、所有断电/存储损坏时序及其他操作系统。子任务摘要结果只通过wait进入父上下文，未等待的输出不另建持久化正文副本；模型条目保存的是执行元数据与用量。不能把该功能描述为可自主读代码或操作文件的多Agent系统。
