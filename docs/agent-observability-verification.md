# Coding Agent 可观测性实现与验收

日期：2026-11-01。分支：design/agent-observability；基线main d847ae8，工作区改动未提交。

## 实现范围

- Runtime保留原始命令进程结果，按executionId归并轮询/停止审计；验证统计只认原始exec，退出0才命令通过，超时/截断/取消不冒充通过。实际工作目录、spawn/结束时间与权限等待区间来自执行端。
- 前端顶栏展示实际动作与等待原因；工具字段详情、按需输出、读取分组、父子分析归属、证据定位、低频进展时钟及分组用量复用现有React/CSS。
- update_acceptance提出最多12条条件；link_evidence仅引用本轮现有文件/读取/目录/原始命令记录。Runtime决定结果，来源与条件修订保留，模型不能自报人工验收。
- edit_acceptance经窄chat桥接和Runtime校验，SQLite事务确认后重载权威投影。只能编辑当前会话已结束的Run；expectedRevision阻止旧条件覆盖。历史最多24版/48条关联；旧关联保留在旧修订，用户可补充/编辑/移除条件及关联记录。
- 协议版本8→9、时间线版本1→2，构建标识继续校验。JSON时间线复用既有表，无新增数据库schema版本；旧时间线1/null继续读取，缺字段不推测。执行事实和模型上下文仍不可修改，唯一新增终态写操作限验收说明与关联。
- 新增协议纯函数供Runtime与UI共享，避免验证结果和证据范围出现两套规则。JSONL继续诊断用途，不用于重建业务通过结论。

## 关键边界与资源

关联检查通过只表示所引用操作成功，不证明条件语义已充分覆盖或需求全部达成。版本只覆盖本轮已知结构化修改；Shell、外部写入不做全仓快照/监视，Shell执行后的版本保守未确认，外部修改始终未全面核对。没有任务正确率或LLM裁判。

验收条件与解释保存到本地普通SQLite；Agent生成的条件及证据工具结果沿用本轮模型上下文。用户终态编辑只改本轮本地验收记录，不偷偷请求模型，也不自动改写已提交模型上下文或追溯更改执行事实。日志不新增条件/输出正文采集。无新依赖、外发通道、权限或额外模型请求；验收工具占用12次工具/10次主模型预算（主模型上限后按用户要求从6调整为10），复杂任务仍可能达到预算，需要用户拆分任务。界面不为统计自动轮询后台。

## 实际验证

npm run build包含类型检查；git diff --check。macOS Electron45.1.0，真实Main/preload/Runtime/SQLite/受限Shell/Renderer，临时HOME、工作区与userData；Provider为受控SSE，系统凭据加解密在隔离验收进程使用假Key替身。没有真实付费模型请求，没有新增单元测试。早期临时HOME尝试因系统凭据不可用停止，改为仅验收进程替身后通过；产品凭据代码未改。

临时入口：/private/tmp/observability-main.cjs、observability-fixture.mjs、observability-acceptance.cjs。它们不属于产品，不依赖它们启动正常应用。

详细结果：[集成证据](evidence/observability-acceptance.json)。覆盖：

- Agent条件与证据关联、用户真实UI编辑、旧关联失效、用户关联、旧修订/伪造/跨Run拒绝。
- 真实命令running→轮询→退出0仅计一次；非零退出、超时、输出截断、拒绝审批、运行中编辑拒绝与取消清理。
- 子分析父步骤关联、三个并行子任务在父结束时取消；非法工具启动前失败。
- 正常重启恢复修订与关联；真实SIGKILL后恢复中断，交互不恢复，不重放命令。
- 旧时间线版本1不自动合成条件或通过；无条件终态可由用户显式补充。
- SQLite trigger拒绝验收更新时事务回滚，原修订保持，前端保存异常，不确认成功。
- 24版条件修订上限拒绝继续修订，仍允许对当前条件关联证据。
- 最小1000×680深色与默认1320×860浅色、无页面水平溢出、证据跳转聚焦；长中文条件换行、Enter不提前保存。界面截图使用受控数据；未将合成键盘事件冒充系统中文输入法完整验收。

## 预览与未覆盖

[最小窗口深色](evidence/observability-minimum-dark.png)、[默认窗口浅色](evidence/observability-default-light.png)。完整退出旧应用后在项目根目录执行npm start查看当前构建，不能只刷新旧进程。

未验证真实Provider的工具选择质量、真实Keychain故障行为、长期压力、断电/磁盘满、所有清理失败窗口、完整读屏软件、Windows/Linux及签名发行包。构建通过不等于所有业务需求已验收；受控响应不代表真实模型质量。Electron参考为本地官方快照tutorial/ipc.md、tutorial/context-isolation.md，沿用45.1.0已有contextBridge/IPC能力，未扩展通用接口或关闭安全设置。


## 六轮预算与完整命令问题修正（2026-11-01）

真实用户轮次只读诊断确认：6轮主模型共11次exec_command；第6轮仍请求工具，结果返回后无收尾请求，因step_limit结束。请求上限不是“最多6次工具”，审批等待也不占模型轮数；未重新执行真实用户命令或调用真实Provider。

最后一轮（或工具预算耗尽后的下一轮）只总结已有结果和未覆盖范围，不再发工具；若Provider违反无工具约束，拒绝执行。工具请求JSONL新增完整命令及目录，保留脱敏与预算，工具参数全集、stdin和编辑内容不复制进日志。命令会增加本地敏感信息留存，旧日志不回填。

临时复现入口/private/tmp/observability-budget-check.cjs：旧构建实测failed/step_limit（红），新构建completed并提供有边界的总结（绿）；7707字符完整命令与已知假Key脱敏验证通过。证据见[evidence/observability-budget-command.json](evidence/observability-budget-command.json)。环境仍为真实Electron/Runtime/SQLite/Shell与受控SSE/凭据替身；未新增单元测试或真实模型调用。


## 主模型上限10轮及真实问题复测（2026-11-01）

按用户要求，主模型上限从6调整为10，用单一maxModelRequests常量驱动循环、最后一轮判定及错误提示。工具仍最多12次，主动时间仍120秒；最后一轮仅总结。构建（含类型检查）与git diff --check通过。

受控边界验证：[10轮证据](evidence/observability-budget-10.json)，准确执行9轮工具探索，第10轮无工具总结，正常结束；完整长命令与已知凭据脱敏仍通过，无真实Provider调用。

用户随后明确授权仅本次只读真实验收：使用已配置DeepSeek发送当前项目差异、相关源码和工具输出并产生费用。真实模型问题为“看看当前代码改了哪些什么？”，在隔离userData与会话数据库中运行，不关闭用户实例，不改真实模型配置。真实API与实际工具执行，使用正式safeStorage解密，无凭据/Provider替身；验收结束清除了临时拷贝的加密设置文件，未记录明文Key。

[真实运行证据](evidence/observability-live-10.json)：10次主模型请求、10次工具（9次Shell、1次目录），状态completed，无step_limit；实际用量input=117640、output=1719 tokens，Provider用量完整，不估算费用。9条Shell命令均有完整tool.requested.command和对应启动/结果记录；全为查看状态、历史、Diff和文本片段的只读操作。

回答正常总结协议/Runtime/前端/文档变化，并明确ExecutionTimeline/CSS部分实现及两个新模块尚未深读，也未运行验证。它证明预算内能够收尾，不证明全面代码审查或真实模型质量普遍达标。截图：[真实运行结束](evidence/observability-live-10.png)。自动审批起初因具体Provider/代码外发授权不足拒绝执行，获得用户明确授权后才发起真实请求。
