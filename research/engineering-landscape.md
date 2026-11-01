# 自进化Agent的工程实现与业务场景

调研日期：2026-11-01。范围是公开可核对的项目与厂商一手资料，不是全行业清单。核对了官方文档、固定提交源码和本地实现；没有安装、运行外部项目、访问客户生产系统或发起模型请求。

## 1. 结论：先问“进化什么”，再判断是否落地

在本次样本中，实际工程主要覆盖五种对象：提示词/配置、工作流、可执行技能、业务实验产物、Agent实现。它们不等价。“能修改答案”“记录历史”“自动重试”“模型参数训练”也不能无条件混称为同一种自进化。

一个有证据的闭环至少要指出：**修改对象 → 反馈来源 → 候选生成 → 评价/选择 → 保存 → 后续使用**。若只有保存日志或向量记忆，没有后续使用与选择，只证明留存，不证明行为改善。这个判断框架是本次归纳，不是外部项目共同采用的标准。

| 项目/工程组合 | 对应业务或任务 | 实际改进对象 | 本次看到的工程闭环 | 证据边界 |
|---|---|---|---|---|
| GEPA + DSPy | 问答、RAG、多步LLM程序等有评价数据的任务 | 具名文本组件；常见为提示词，也可通过适配器定义其他文本候选 | 轨迹/分数反馈、变异、候选选择、验证集、状态与最佳候选 | 已核对优化器源码；未本机执行，不能称任意业务部署后自动变强 |
| MLflow + Databricks Agent Bricks路径 | 企业文档信息抽取；官方MLflow示例为论文句子章节分类 | 业务提示词版本，优化模型和服务模型可不同 | 优化API、scorer、提示词管理；Databricks公开了IE Bench评估 | 有平台集成和厂商评估材料，不是独立客户线上自动演化审计 |
| EvoAgentX | 代码生成、多跳问答、数学任务 | 提示词/指令，AFlow还优化工作流图与实现 | 优化、评估、保存final/best候选与历史轮次 | 框架与基准例程；未核验企业生产收益 |
| Microsoft RD-Agent | 量化因子/模型研发、数据科学研发 | 因子、模型、业务实验代码 | 假设、编码、运行、反馈、Trace、快照恢复 | 研发实验闭环；不能当成实盘盈利或整个框架自改 |
| Voyager | Minecraft采集、制作、开放式探索 | 可执行JavaScript技能库、任务课程 | 环境/critic反馈、程序修订、成功技能持久化并检索再用 | 游戏研究工程，不是机器人或企业生产部署证明 |
| SICA | Coding Agent工具与架构研发；软件工程基准 | Agent自身实现 | 历史性能归档、候选选择、复制代码、容器中改进、再评估 | 研究工程；没有核验客户仓库中的长期生产运行 |
| Darwin Gödel Machine | Coding Agent实现搜索；SWE/Polyglot任务 | Agent自身代码，保留多条候选谱系 | 父代选择、修改、候选检查、分阶段评估、更新archive | 研究工程；不代表所有控制器都无限自改或自动部署 |

GEPA/DSPy与MLflow这一行属于同一技术路线的不同工程层，不是两个独立算法证据。后面三个项目的细读及固定源码见[工程案例详解](engineering-project-cases.md)。SICA/DGM论文背景见[论文笔记](coding-self-modification.md)。

## 2. 提示词优化：GEPA/DSPy的实现已经超出“多问模型一次”

本次固定GEPA提交`8c7b697a71977980afc7537dac0881e784eef99f`。`optimize()`接收具名候选文本、trainset/valset、适配器与停止预算；`GEPAAdapter.evaluate/make_reflective_dataset`把业务执行结果与反馈接到优化器；引擎负责候选接纳/选择，结果对象暴露候选谱系、验证分数与best_candidate。`run_dir`支持保存/恢复优化状态。[API源码](https://github.com/gepa-ai/gepa/blob/8c7b697a71977980afc7537dac0881e784eef99f/src/gepa/api.py)、[适配器](https://github.com/gepa-ai/gepa/blob/8c7b697a71977980afc7537dac0881e784eef99f/src/gepa/core/adapter.py)、[引擎](https://github.com/gepa-ai/gepa/blob/8c7b697a71977980afc7537dac0881e784eef99f/src/gepa/core/engine.py)、[结果](https://github.com/gepa-ai/gepa/blob/8c7b697a71977980afc7537dac0881e784eef99f/src/gepa/core/result.py)。

DSPy的`GEPA.compile()`以程序/预测器为优化单位，对业务metric接受分数与文本反馈；它接入GEPA引擎，不是另训练基础模型权重。[DSPy实现，提交25162c4](https://github.com/stanfordnlp/dspy/blob/25162c4fc05c2d2d019b0ffb5b6b2a9f315ec007/dspy/teleprompt/gepa/gepa.py)。

**业务理解（推论）：** 企业知识问答、文档字段提取、分类和工具选择如果能形成固定评价集，可以离线改提示词、选候选，再由业务方决定版本推广。优化器找到最高验证分并不自动证明测试集泛化、权限安全或上线无回归。GEPA当前接口可扩展到代码等文本，但运行这些候选的隔离和业务评价仍由接入方负责，不能据通用API宣传推断已经安全自改所有Runtime。

## 3. 产品路径：MLflow集成和企业信息抽取

MLflow官方文档提供`optimize_prompts`和`GepaPromptOptimizer`，示例把论文句子分成背景、方法等章节标签；源码中的`MlflowGEPAAdapter`将业务评价转成GEPA反馈，最后取得优化后的提示词。文档把优化与提示词生命周期管理连接起来，但不等于不经业务审批自动替换线上版本。[官方文档](https://mlflow.org/docs/latest/genai/prompt-registry/optimize-prompts)、[固定源码f5defbab](https://github.com/mlflow/mlflow/blob/f5defbabd26a613e12cd15f24c4da42529b9601e/mlflow/genai/optimize/optimizers/gepa_optimizer.py)。

Databricks的2025-09-24一手案例针对企业信息抽取：将PDF/扫描文档转换成结构化记录，用IE Bench覆盖金融、法律、商业与医疗等文档域，评估优化提示词后的模型质量和服务成本。它描述的是业务任务上的离线优化与产品路线，不是Agent任意修改自身程序。[厂商案例](https://www.databricks.com/blog/building-state-art-enterprise-agents-90x-cheaper-automated-prompt-optimization)。

标题中的“90x cheaper”是该厂商对特定模型、数据集和服务成本比较的报告，**不是同一个Agent自进化后总费用降低90倍**；不能忽略优化阶段成本，也不能推广到本项目。本次没有独立复测该数字，也没有取得客户线上持续自动升级的运行记录。

**工程启发（推论）：** 这里更接近可控业务改进的部分是可评价数据、候选版本和显式推广，而不是“让线上Agent随时改自己”。接入Agent Desktop前应先解决固定样本与正确性评价；不因MLflow有集成就直接增加平台依赖。

## 4. Agent代码自改：SICA与DGM的源码路径

SICA固定提交`ed8275dca4d3c5dbf77229964351fe9b424797dc`：`runner.py`中`select_base_agent`读取历史统计与置信区间选择起点；`run_meta_agent_benchmark`复制所选代码，保留变更历史，在容器中运行改进任务；benchmark队列和统计再反馈下一轮。README给出`python runner.py`入口与结果归档目录。[runner实现](https://github.com/MaximeRobeyns/self_improving_coding_agent/blob/ed8275dca4d3c5dbf77229964351fe9b424797dc/runner.py)、[使用说明](https://github.com/MaximeRobeyns/self_improving_coding_agent/blob/ed8275dca4d3c5dbf77229964351fe9b424797dc/README.md)。

DGM固定提交`a565fd2d1dca504ef5104a7cc0f3bdc4ab9b4fd2`：`DGM_outer.py`提供`initialize_run`、`choose_selfimproves`、`filter_compiled`、`update_archive`和扩大评估范围的阈值逻辑；main把候选执行、评估与archive元数据串联，支持从已有输出继续。README公开SWE/Polyglot设置，并明确生成代码的执行风险。[外循环实现](https://github.com/jennyzzt/dgm/blob/a565fd2d1dca504ef5104a7cc0f3bdc4ab9b4fd2/DGM_outer.py)、[使用说明](https://github.com/jennyzzt/dgm/blob/a565fd2d1dca504ef5104a7cc0f3bdc4ab9b4fd2/README.md)。

**工程判断：** 两者具备可检视的自修改闭环；“可运行入口存在”不等于我们已运行成功。本次没有安装其Docker环境、执行模型生成代码或复核论文分数。它们最直接的场景是Agent研发/算法与工具实现搜索，而不是已经证明适合把每位终端用户的线上桌面Agent交给无人值守自改。

## 5. 当前Agent Desktop已经做到哪里

以下只针对当前工作区的已存在代码及既有验收材料；本次未重新执行这些实验，也未再次查询正式数据库。

| 环节 | 当前证据 | 当前状态与缺口 |
|---|---|---|
| 执行事实采集 | [Agent循环](../apps/runtime/src/agent.ts)、[日志实现](../apps/runtime/src/runtime-log.ts) | 已有工具/命令/用量/审批/终态记录；日志不是完整业务审计账本 |
| 有边界的取证策略 | agent.ts的investigationGuidance、10轮/12次预算 | 已有人工修改后生效的策略、批量接纳和收尾保护；没有自动策略搜索 |
| 经验/改进留存 | [evolution-record.ts](../apps/runtime/src/evolution-record.ts)、[storage-worker.ts](../apps/runtime/src/storage-worker.ts) | 已有不可覆盖记录、对照指标和证据摘要；来源developer_recorded，不是自动质量认证 |
| 第1轮结果 | [本地补录证据](../docs/evidence/evolution-storage-live.json)、[第1轮对照](../docs/self-evolution-1.md) | 既有材料记录正式补录及一次真实对照；不能推广为稳定正确率或自动学习 |
| 下一任务利用经验 | 本次检索appendEvolution/getEvolution/evolutionPage调用方，读取路径在维护CLI | 未发现Agent循环检索进化记录并注入下一任务的链路 |
| 候选与选择 | 当前记录是追加型工程记录 | 未见版本化可运行候选池、自动生成/评价/选择、失败候选搜索及推广闭环 |
| 固定评估与发布 | 现有受控检查、人工授权真实验收 | 有局部验证，缺固定项目快照+多任务保留集+重复采样；没有自动灰度/回滚 |

因此当前准确表述是：**人工主导、可观测、留有证据的工程自进化过程**。还不能称为SICA/DGM式自动代码进化，也不能因SQLite中有记录就称为Voyager式经验复用。

## 6. 适合本项目的推进次序（建议，尚未实施）

1. 先固定一个项目快照和少量真实任务：改动概览、带约束的定位、取消/恢复解释等；标注关键证据与禁止误报，保留未参与优化的任务。
2. 将读取策略作为小候选，不让候选修改评价器、权限、预算上限或原始结果。比较覆盖与错误，再比较成本；对真实随机模型重复采样。
3. 进化记录关联候选标识、评估配置和每题结果。已保存的文本不自动进入所有后续任务，经验使用需有适用范围与上下文预算。
4. 有稳定反馈后，再选择提示词优化器、工作流优化或代码候选搜索中的一条路线；选型需比较官方实现、依赖、许可证与执行成本，另经批准。
5. 正式运行仍选择已验收版本。研究候选与用户正在工作的实例分开，推广和回滚必须有明确入口和授权。

这次调研没有新增框架、运行外部项目、付费调用或修改Agent Desktop代码，也不新增数据库中的“进化成功”记录。只更新research材料。

## 7. 来源复查

- 固定源码提交与所读文件见[engineering-sources.json](engineering-sources.json)，案例详解中的三项目也固定了提交。
- 厂商材料单独标记，不用星数、下载量或README“production-ready”替代独立运行证据。
- 当前默认分支可能继续变化，后续选型应重新核验；本次“存在实现”的判断只适用于已引用提交。


后续实现更新：调研之后已实现两个受信任策略候选与固定评估基础，详见[策略实验室第一版](../docs/strategy-lab.md)。上文第5节保留调研时状态，不将后续基础设施实现写成自动策略搜索或真实候选收益。
