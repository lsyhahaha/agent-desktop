# Agent Desktop 的 Coding Agent Benchmark 选型

日期：2026-11-10
状态：一手资料调研与接入建议；未安装评测框架、未下载数据或镜像、未调用模型、未运行 benchmark。

## 结论

不能用一个自选任务评价 Agent Desktop。推荐采用“同一模型、同一提示、同一预算、固定任务集、隔离执行、隐藏测试判定”的公开基准，并把 **Agent 能力评估** 与 **单项机制消融** 分开。

推荐顺序：

1. **先接 Harbor，跑固定的小规模 SWE-bench Verified 预检集**：目的不是发布分数，而是验证 Agent Desktop 能否无人工操作地接收任务、在隔离工作区修改代码、输出 patch、保存 trace 与用量，并让官方 grader 判定。
2. **适配稳定后跑完整 SWE-bench Verified 500**：作为与公开研究最容易对照的第一条正式基线。
3. **再跑 SWE-bench Pro V2 HARD-51，之后才考虑完整 642**：检验更长任务和多语言仓库；但它与 Agent Desktop 当前 120 秒、12 次工具的硬预算明显冲突，不能直接跑完后把低分解释成模型能力差。
4. **用 SWE-rebench V2 的冻结保留集检验新鲜任务泛化**：它比反复使用 SWE-bench Verified 更能缓解污染，但 32K 是训练/任务资源，不应直接全量当作一次桌面 Agent 排行评测。
5. **Terminal-Bench 2.x 作为第二条能力轴**：它测广义终端工作，不等于代码仓库 issue 修复；应单列结果，不能与 SWE-bench 的 resolved rate 混成一个总分。

RepoBench 和 CyberGym 不适合作为当前主基准：前者主要是仓库级代码补全，后者是高风险且资源巨大的漏洞 PoC 生成环境。它们分别测错了产品主能力，或超出了当前项目的安全与基础设施范围。

## 候选对比

| 基准 | 主要测量对象 | 规模/指标 | 官方运行条件 | 对 Agent Desktop 的适配判断 |
|---|---|---|---|---|
| SWE-bench Verified | 给定真实 GitHub issue，在仓库中生成可通过回归测试的 patch | 500 个经人工确认的实例；resolved rate（所需失败测试转通过且既有通过测试不回归） | 官方 SWE-bench Docker harness；官方建议 x86_64、约 120GB 空闲磁盘、16GB RAM、8 核；ARM 支持仍标为实验性 | **第一正式基线**。知名度和可比性最好，但公开多年，需明确污染风险 |
| SWE-bench Multilingual | 同类 issue 修复，但覆盖更多语言/仓库 | 官方数据集 300 行、41 个仓库；同类二元 resolved 判定 | 已被 SWE-bench v5 CLI 以 `multilingual` alias 支持；容器评测 | **第二阶段语言覆盖**。不能因数据集名中的 Multilingual 就宣称自然语言提示多语；其任务提示页面标注为英语，重点是编程语言/项目生态扩展 |
| SWE-bench Pro V2 | 更长、更复杂的真实工程任务 | 642 个验证任务、11 个仓库；另有 HARD-51；隐藏 fail-to-pass/pass-to-pass 测试 | Harbor task 格式；公开 GHCR 镜像为 linux/amd64；V2 规定 agent 阶段 no-network，默认长时预算 | **长期主目标**。HARD-51 比完整集更适合先跑，但当前 Agent Desktop 的硬预算与无头运行能力不足 |
| SWE-rebench V2 | 新鲜、多语言、跨大量仓库的可执行任务 | 32.1K 可执行任务、20 种编程语言、3,600+ 仓库；二元测试奖励 | Docker 镜像、官方 eval 脚本；数据集为 CC-BY-4.0，构建/评估代码为 MIT | **泛化与污染检查**。应固定发布日期、数据 commit、语言分层和保留 task IDs；不可边看任务边选样本 |
| Terminal-Bench 2.x | Agent 在容器终端完成广义工程/科学/安全任务 | Terminal-Bench 2.0 论文报告 89 个任务；Harbor 输出 reward、状态、时间、token 与费用 | 官方 Harbor + Docker；需要为自定义 Agent 实现 `BaseInstalledAgent` 或 `BaseAgent` 适配 | **第二能力轴**。适合验证命令执行、长任务与产物，但不是纯 Coding Agent issue 修复榜单 |
| RepoBench v1.1 | 跨文件仓库上下文下的代码补全 | Python/Java；Exact Match、Edit Similarity、CodeBLEU | 普通数据集推理，无交互式真实仓库修复闭环 | **不作为主基准**。它更适合测模型补全和检索，不足以评价 Agent Runtime、权限、恢复或工具循环 |
| CyberGym | 在真实历史漏洞上生成 PoC/进行漏洞分析 | 数据约 240GB，完整动态环境可达约 10TB；成功以漏洞复现/最终 PoC 为核心 | 本地 Docker；官方明确要求绝不能把提交服务暴露公网，并需控制网络以防答案泄漏 | **当前排除**。安全风险、磁盘和运维成本过高，能力目标也不是普通 Coding Agent 修复 |

## 一手证据

### SWE-bench 系列

- [SWE-bench 官方仓库](https://github.com/SWE-bench/SWE-bench)将任务定义为“给定 codebase 与 issue，生成解决问题的 patch”，其 v5 CLI 直接支持 `verified`、`multilingual`、`multimodal` 等数据集别名；官方同时给出了 Docker 资源建议和 ARM 实验性说明。
- [SWE-bench Verified 官方页面](https://www.swebench.com/verified)说明 Verified 是 500 个由人工确认清晰、测试正确且可解的实例。
- [SWE-bench Multilingual 官方数据集](https://huggingface.co/datasets/SWE-bench/SWE-bench_Multilingual)当前为 300 行、41 个仓库、MIT 许可，并包含容器镜像、测试脚本、FAIL_TO_PASS 与 PASS_TO_PASS 字段。
- [SWE-bench experiments 官方仓库](https://github.com/SWE-bench/experiments)自 2025-11-18 起限制 Verified/Multilingual 官方榜单提交资格。Agent Desktop 即使完成本地可复现评测，也不应承诺能进入官方榜单。

### SWE-bench Pro V2

- [Scale 官方开源仓库](https://github.com/scaleapi/SWE-bench_Pro-os)以 MIT 许可发布；V2 为 642 个验证任务，提供 HARD-51、公开任务镜像和 Harbor task 目录。
- [V2 官方运行说明](https://github.com/scaleapi/SWE-bench_Pro-os/blob/main/v2/README.md)声明镜像为 `linux/amd64`，仓库历史经过清理，agent 阶段为 no-network，且 reference solution 与 empty patch 均有 release gate。
- V2 在 2026 年发布过大规模修复。实验必须固定仓库 commit、Harbor 版本、数据集 revision 与镜像 digest，不能只写“跑了 SWE-bench Pro”。

### SWE-rebench V2

- [论文](https://arxiv.org/abs/2602.23866)报告 32,000+ 可执行任务、20 种语言、3,600+ 仓库，并强调语言无关的自动采集与可复现镜像。
- [官方构建与评估仓库](https://github.com/SWE-rebench/SWE-rebench-V2)提供 Docker image 构建、patch 评估与日志解析代码；代码许可为 MIT。
- [官方数据集](https://huggingface.co/datasets/nebius/SWE-rebench-V2)当前显示 32.1K 行、20 种编程语言、CC-BY-4.0。它是大规模任务资源，不等于一个已经冻结且人工逐项验证的 32K 榜单测试集。

### Terminal-Bench / Harbor

- [Terminal-Bench 2.0 官方仓库](https://github.com/harbor-framework/terminal-bench-2)将其定位为容器环境中的有价值工作任务，任务包含代码调试、安全修复和非代码工程工作。
- [Terminal-Bench 论文](https://arxiv.org/abs/2601.11868)报告 89 个经策划的困难任务。
- [Harbor 官方仓库](https://github.com/harbor-framework/harbor)说明它是 Terminal-Bench 2.0 的官方 harness，并支持自定义 agent adapter、Docker/云环境、轨迹与评测运行。
- Harbor 官方示例给出的全量耗时/费用只是特定模型和环境的示例，不能当成 Agent Desktop 的预算承诺；正式运行前必须先做 10–20 个任务的成本探针。

### 不选为主基准的项目

- [RepoBench 官方仓库](https://github.com/Leolty/repobench)把任务定义为代码补全，并使用 Exact Match、Edit Similarity 与 CodeBLEU。它没有覆盖一个 Coding Agent 从定位、编辑到执行测试的闭环。
- [CyberGym 官方仓库](https://github.com/sunblaze-ucb/cybergym)要求 Python、Docker 和大规模数据；其 [FAQ](https://github.com/sunblaze-ucb/cybergym/blob/main/FAQ.md)明确警告提交服务能执行上传的 PoC，必须仅在受控本地私网运行，并需防止联网查找修复答案。

## Agent Desktop 目前不能直接参加这些评测的原因

### 1. 没有稳定的无头 Agent 接口

项目目前以 Electron UI 接收任务并选择目录，README 和代码中没有面向 benchmark runner 的 CLI/HTTP adapter。Harbor 和 SWE-bench 需要按 task ID 自动创建隔离环境、注入 prompt、等待终态并收集 patch；用 UI 自动点击既不稳定，也会把界面自动化误差混进 Agent 能力分数。

建议：复用现有独立 Runtime，增加最小的 benchmark adapter，而不是复制一套 Agent Loop。Adapter 只负责：接收任务目录和 prompt、冻结模型/权限/预算配置、运行一轮、导出 patch/trace/usage/终态。它不能绕过 Runtime 的校验，也不能读取隐藏测试或 reference solution。

### 2. 当前硬预算不匹配长任务

当前项目最多 10 次主模型请求、12 次工具调用、120 秒主动预算；命令最长 60 秒、输出 32KiB、不支持 TTY。SWE-bench Pro V2 和 Terminal-Bench 的任务设计允许更长时间、更复杂构建。直接用当前预算跑，结果主要测“预算是否过小”，而不是 Harness 质量。

正式比较至少应设置两条 track：

- **Product-default track**：保留当前产品预算，回答真实默认体验能解多少任务。
- **Benchmark-budget track**：采用固定且公开的较长预算，回答在可比资源下 Runtime 能力如何。

两条结果必须分开报告，不能只公布较高者。

### 3. 平台隔离边界不同

Agent Desktop 当前 OS 沙箱只在 macOS 验收；主流 benchmark 通过 Linux Docker/Harbor 隔离任务。不能把宿主 macOS 的“完全访问”模式直接指向 benchmark 工作区，也不能让 Agent 访问 Docker socket、宿主文件或隐藏 verifier。

建议让 benchmark harness 拥有环境生命周期，Agent Runtime 只通过受限 adapter 操作任务容器。Harness 是评测控制面，Runtime 是模型—工具循环；两者职责不要合并。

### 4. 人工审批会破坏可重复性

公开 benchmark 运行不能依赖每个工具调用由人临场选择。必须预先定义一套 benchmark 权限策略：只允许 task container 内的文件和命令，禁止宿主、网络、隐藏测试、删除任务边界外资源，并把所有拒绝记录进 trace。策略是实验配置，不应静默改写产品默认权限。

## 推荐实施阶段

### 阶段 A：评测适配器与金样验证

目标不是测模型分数，而是证明评测链可信。

1. 先选择 Harbor 作为统一 runner 候选，评估其 `BaseAgent` / `BaseInstalledAgent` 接口；按照项目 AGENTS.md，安装依赖和正式接入前需由用户批准。
2. 建立只读的 benchmark manifest，固定：数据集 revision、task IDs、容器 digest、模型完整版本、温度、最大 token、Runtime commit、权限策略、网络策略和预算。
3. 对 3–5 个实例依次运行：oracle、empty patch、故意错误 patch。官方 grader 必须分别得到成功、失败、失败；否则不能运行模型。
4. 验证 Agent 看不到 test patch、gold patch、solution、grader 输出和宿主文件。
5. 导出每任务 patch、终态、工具轨迹、模型轮数、token、费用、墙钟时间、失败分类和容器日志。

### 阶段 B：固定预检集

从 SWE-bench Verified 预先冻结 20–30 个任务，按仓库和难度/变更规模分层，用固定 seed 一次生成 task IDs 并提交到仓库。它只用于迭代与成本探针，不对外称为 Verified 得分。

通过门槛不应只看 resolved rate，还包括：

- 100% 运行有可解析终态，不允许丢任务或把超时算失败后静默跳过；
- patch 能在干净容器重放；
- 无宿主越界、隐藏测试读取和网络泄漏；
- 同一任务至少两次运行时记录方差；
- 费用、token、耗时和失败原因完整。

### 阶段 C：正式基线

1. 完整 SWE-bench Verified 500，至少报告 resolved、error、timeout、invalid patch、no patch 五类。
2. 同一模型与预算下做机制消融：baseline、+子 Agent、+插件策略、+恢复机制。一次只改变一个因素。
3. 每个配置至少重复 3 次或给出置信区间；若费用不足，宁可缩小预先注册的任务集，也不能只重复成功样本。
4. 保存 task-level 结果和轨迹，公开结果时同时公开失败样本；不要只报总分。

### 阶段 D：长任务与新鲜任务

- 跑 SWE-bench Pro V2 HARD-51，再决定是否承担 642 个任务的成本。
- 从 SWE-rebench V2 按语言、仓库、日期和难度元数据预注册冻结集，确保 Agent 开发人员在锁定前不查看 gold patch/test patch。
- Terminal-Bench 单独成表，衡量终端操作和产物任务；不要与 SWE-bench 平均。

## 正式报告必须包含的字段

- Agent Desktop commit、Runtime/adapter commit、模型供应商与完整模型版本；
- benchmark 名称、版本、数据 revision、task IDs、镜像 digest、runner 版本；
- 网络、权限、沙箱、CPU、内存、平台与并发；
- 每任务/总模型轮数、工具数、token、费用、agent time、wall time；
- resolved、timeout、infra error、agent error、invalid/no patch；
- 重试策略与尝试次数；
- 是否启用子 Agent、插件、审批替代策略、恢复机制；
- 污染控制和开发人员是否查看过任务/解答；
- 未覆盖项和结果不能外推到的能力。

## 关键判断

公开 benchmark 能解决“代表性”和“可比较性”，但不能自动证明 Agent Desktop 的所有产品价值。SWE-bench 的 patch 成功率不会测出：应用重启后的未知副作用处理、人工审批体验、会话持久化正确性、插件故障隔离或 UI 可用性。这些仍需项目自己的故障注入与产品验收。合理的评估体系应是：

> 公共任务集衡量外部任务结果；机制消融解释哪些 Runtime 能力带来收益；项目内故障验收守住安全、恢复和产品边界。
