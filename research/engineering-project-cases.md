# 公开工程案例：EvoAgentX、RD-Agent、Voyager

核验日期：2026-11-01。仅检视官方仓库、官方教程和实现，不安装、不执行、不调用真实模型。下文“源码存在”不等于本机运行成功，更不等于经过生产部署验证。源码链接固定到本次观察的提交；未据GitHub热度判断成熟度。

## 结论对照

| 项目 | 实际应用场景 | 被优化的对象 | 闭环证据 | 工程边界 |
|---|---|---|---|---|
| EvoAgentX | 代码生成、多跳问答、数学任务的多Agent工作流优化 | 提示词、指令；AFlow路径还优化工作流图/代码 | 优化器读取评估与历史结果，保存候选并选择验证得分较高者 | 通用框架和基准例程，不代表任意业务上线后自动持续变强 |
| Microsoft RD-Agent | 量化因子/预测模型研发、数据科学与Kaggle式模型研发 | 业务因子、模型及实验实现 | 假设→实验→编码→运行→反馈→Trace，支持会话快照 | 主要演化研发产物，不应称为框架所有核心代码自改；未核验实盘收益 |
| Voyager | Minecraft开放式探索、采集和制作任务 | 可执行JavaScript技能库及任务课程 | 执行事件/critic反馈→修订→成功技能入库→后续检索调用 | 游戏环境研究Agent，不是企业桌面自动化或真实机器人生产证明 |

## 1. EvoAgentX：工作流和提示词优化工程

原`EvoAgentX/EvoAgentX`链接经GitHub API返回Moved Permanently，当前官方仓库为[ANative-Lab/EvoAgentX](https://github.com/ANative-Lab/EvoAgentX)。本次固定提交[e3df900662443e94dd92141be5633b040a69a70a](https://github.com/ANative-Lab/EvoAgentX/commit/e3df900662443e94dd92141be5633b040a69a70a)（API所见最近提交日期2026-10-31）。迁移不等于第三方fork。

**源码事实。** `TextGradOptimizer.optimize/step/evaluate/save`把系统提示词和指令设为可优化变量，根据数据集反馈更新；支持周期评估、快照、低分回退、保存final/best工作流。`AFlowOptimizer._handle_optimization_round`读取历史图、提示词、经验和日志，生成候选，再经`_evaluate_and_save_optimization_results`评估保存。测试入口可选择最高验证得分轮次。见[TextGrad实现](https://github.com/ANative-Lab/EvoAgentX/blob/e3df900662443e94dd92141be5633b040a69a70a/evoagentx/optimizers/textgrad_optimizer.py)、[AFlow实现](https://github.com/ANative-Lab/EvoAgentX/blob/e3df900662443e94dd92141be5633b040a69a70a/evoagentx/optimizers/aflow_optimizer.py)。

**业务与证据等级。** 官方[AFlow教程](https://github.com/ANative-Lab/EvoAgentX/blob/e3df900662443e94dd92141be5633b040a69a70a/docs/tutorial/aflow_optimizer.md)用HumanEval代码生成演示训练/验证/测试；仓库另有HotpotQA与数学例程。这能证明存在工作流优化接口和使用例程，不能推出已在某家企业的生产问答服务获得持续收益。本次未运行任何优化器、未复核基准分数或客户部署。

**本项目建议（推论）。** 借鉴“候选与正式配置分开、验证后选择、保存失败候选”，先做固定改动概览任务上的策略比较。暂不直接引入整个框架。额外注意：该版本TextGrad模块导入时存在清理其新建`logs`目录的代码，说明接入前必须实际审阅文件与日志副作用，不能只看算法说明。

## 2. Microsoft RD-Agent：围绕业务研发实验演化

官方[microsoft/RD-Agent](https://github.com/microsoft/RD-Agent)，固定提交[484776c211e4fbbeef03e0ec00d6bbee7362a4f4](https://github.com/microsoft/RD-Agent/commit/484776c211e4fbbeef03e0ec00d6bbee7362a4f4)（API所见2026-09-23，release 1.0.0提交）。

**源码事实。** `RDLoop`包含`_propose/_exp_gen/coding/running/feedback/record`；提案依赖Trace，执行结果经summarizer反馈，`record`将实验与反馈同步进历史/DAG。`QuantRDLoop`分别路由因子与模型开发、运行和反馈。[通用循环](https://github.com/microsoft/RD-Agent/blob/484776c211e4fbbeef03e0ec00d6bbee7362a4f4/rdagent/components/workflow/rd_loop.py)、[量化循环](https://github.com/microsoft/RD-Agent/blob/484776c211e4fbbeef03e0ec00d6bbee7362a4f4/rdagent/app/qlib_rd_loop/quant.py)。`LoopBase._run_step/dump/load`保存并恢复步骤会话；这属于实验过程持久化，不是自动部署。[会话实现](https://github.com/microsoft/RD-Agent/blob/484776c211e4fbbeef03e0ec00d6bbee7362a4f4/rdagent/utils/workflow/loop.py)。

**业务与证据等级。** 官方[README](https://github.com/microsoft/RD-Agent/blob/484776c211e4fbbeef03e0ec00d6bbee7362a4f4/README.md)提供Qlib因子/模型联合迭代、财报因子提取和数据科学入口，并链接演示和实验轨迹。可以归类为量化研究与ML研发自动化工程；README也明确不提供可直接投资使用的产品或金融建议。这里没有核验实盘部署、客户收益或跨时间市场泛化，不能将回测/竞赛表现说成生产盈利。

**本项目建议（推论）。** 最值得学的是“把改进主张变成可重复实验”：保存假设、候选、运行结果和反馈归属。不能照搬它的数据、金融指标或检查点反序列化方案；研究场景与本机执行安全要求不同，接入仍要单独评估。

## 3. Voyager：技能生成、验证与积累

官方[MineDojo/Voyager](https://github.com/MineDojo/Voyager)，固定提交[55e45a880755d0c8c66ca7fb5fe7962ac8974f89](https://github.com/MineDojo/Voyager/commit/55e45a880755d0c8c66ca7fb5fe7962ac8974f89)（API所见默认分支最近提交2023-07-27；不是断言项目完全无人维护）。

**源码事实。** `Voyager.step`生成程序、执行到游戏环境、交给critic检查，随后用事件和批评修订；`learn`在任务成功后调用`SkillManager.add_new_skill`。技能代码、描述、`skills.json`和Chroma索引落盘；`retrieve_skills`在后续任务检索代码，`reset/step`将检索技能放回执行上下文。[主循环](https://github.com/MineDojo/Voyager/blob/55e45a880755d0c8c66ca7fb5fe7962ac8974f89/voyager/voyager.py)、[技能库实现](https://github.com/MineDojo/Voyager/blob/55e45a880755d0c8c66ca7fb5fe7962ac8974f89/voyager/agents/skill.py)。这不只是保存聊天记忆，而是保存之后实际可调用的程序技能；但没有据此证明基础模型权重或整个调度器会自我更新。

**业务与证据等级。** 官方[使用说明](https://github.com/MineDojo/Voyager/blob/55e45a880755d0c8c66ca7fb5fe7962ac8974f89/README.md)要求Minecraft环境，支持技能库恢复与新任务推理。它是可检视的游戏环境终身学习研究工程；未在本机运行，未验证其历史依赖在当前版本环境可直接复现，也没有企业/真实机器人生产部署证据。

**本项目建议（推论）。** 当前进化记录仅落库，下一任务不读取它，就仍缺少“经验参与未来行动”的环。可学习有界检索和适用范围，但不能把未经审查的历史生成代码当成可信技能直接运行，更不能让技能记录扩大权限。

## 跨项目判断

这些项目的共同点是：可修改对象、反馈来源、保存对象和下一轮使用方式都能在代码中找到。差异则很大：EvoAgentX优化工作流，RD-Agent演化业务实验，Voyager积累可执行技能。将三者统一称为“Agent不断自动变强”会掩盖实际工程边界。

本文只证明指定提交存在这些实现路径；没有复现成功、生产可用性或通用安全性的结论。后续选型应先明确本项目究竟要优化提示词、工具策略、技能还是Runtime代码，再做小范围验证；本次调研不授权引入依赖、付费实验或自动上线。
