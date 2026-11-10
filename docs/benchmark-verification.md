# Coding Agent Benchmark 接入

日期：2026-11-10。状态：已实现第一阶段无头任务入口与 preflight；尚未安装 Harbor、下载 SWE-bench 镜像、调用真实模型或运行官方 grader。

## 已实现边界

- `npm run benchmark:task` 复用生产 `RuntimeHost` 与独立 Runtime，不复制 Agent Loop。
- manifest 固定 benchmark、task ID、数据集 revision 与原始 problem statement；工作区必须是干净 Git 仓库。
- 当前仅核对仓库根与 `baseCommit`；`repository` 身份在报告中明确标为 `manifest_only_until_harness_adapter`，正式绑定由后续 Harbor 镜像 digest 完成。
- 输出目录必须位于任务工作区之外，避免 Agent 读取报告或后续 grader 数据。
- preflight 只验证输入、工作区身份和输出计划，不读取凭据或调用模型。
- 入口不向任务仓库写入标记或控制文件；失败也会在外部输出目录写结构化 `result.json`，并清理隔离会话目录。
- `--live` 才读取桌面应用已保存的模型配置，在隔离 SQLite 中运行；API Key 不进入参数、环境变量或报告。
- 固定任务不接受澄清。`evaluationOnly` 先硬拒绝工作区外访问和提权；无人值守入口只自动确认临时任务副本内仍受 Runtime 沙箱约束的复合命令、删除等操作，不改变宿主权限。该策略记录为 `evaluation_only_workspace_auto`。
- 结果输出 `patch.diff` 与 `result.json`；grader 状态明确为 `not_run`，不能把 Agent 正常结束冒充 SWE-bench resolved。
- 固定 scaffold 明确要求实际修复与验证；空 patch 记录为 `no_patch` 并以失败退出。隔离 Runtime 的脱敏 JSONL 在清理临时 profile 前复制到输出目录。
- 新增普通文件会进入 patch；新增空文件因 Git patch 无法可靠表达而明确失败，不静默遗漏。

## 使用

先从固定版本的官方数据集生成 manifest，不要手工改写 problem statement：

```sh
npm run benchmark:task -- \
  --manifest=/absolute/task.json \
  --workspace=/absolute/clean-task-repo \
  --output=/absolute/results
```

preflight 成功后，在用户明确授权真实模型费用时增加 `--live`。当前入口仍使用产品默认的 10 次主模型、12 次工具与 120 秒主动预算；这条结果只能标为 `product-default`，不能与更长预算的公开 Agent 排名直接比较。

`research/benchmark-tasks/swebench-verified-example.json` 已固定官方数据集 revision、`sympy/sympy` 基线提交与原始 problem statement；运行前仍须由外部 harness 准备完全匹配该提交的干净仓库。`scripts/acceptance/fixtures/benchmark-task-controlled.json` 只用于本地 preflight 链路验证，不是公开数据集实例。

## 尚未完成

- Harbor `BaseAgent` / `BaseInstalledAgent` 适配与依赖接入；
- 官方数据集 revision、任务容器 digest 与 20–30 个预注册任务 ID；
- oracle、empty patch、错误 patch 三类 grader 金样；
- Docker/Harbor 隔离，隐藏测试不可见性验证与官方 resolved 判定；
- benchmark-budget 长预算 track、重复运行、费用与方差报告。

当前实现只完成“外部 runner 能稳定调用同一 Runtime 并收集 patch”的最小产品侧接口。Harness 继续拥有任务环境和 grader；Runtime 只拥有模型—工具循环，不能读取 gold patch、test patch 或 grader 输出。

## 首次真实任务记录

固定任务 `sympy__sympy-20590` 使用数据集 revision `78f471bf655a3137b2e8a75af1501690ec009ec3` 与基线提交 `cffd4e0f86fefd4802349a9f9b19ed70934ea354`。未运行 Docker 官方 grader；本机 Docker 服务当时不可用。

- 第一轮在读取 safeStorage 时失败，未调用模型；根因是 CLI 未沿用桌面应用名，已修复。
- 第二轮和第三轮分别因无人值守审批过严、模型耗尽 12 次工具预算而生成空 patch；入口现把空 patch 记录为 `no_patch` 并失败退出。
- 第四轮使用固定 scaffold 和 `evaluation_only_workspace_auto`：DeepSeek Flash 运行 9 次模型请求、12 次工具调用，输入 59,403 tokens、输出 1,876 tokens，生成 861 字节 patch。
- patch 给 `Printable` 和 `Symbol` 都增加了 slots。使用 Python 3.10 与 mpmath 1.1.0 执行官方 `test_immutable` 等价行为时，SymPy 导入即因 `Dummy` 无法设置 `name` 而失败，证明新增 `Symbol.__slots__ = ()` 引入回归。

因此本次结论是：**无头 Runtime → 真实模型 → 工作区命令 → patch → 外部验证链路已跑通；该任务结果 unresolved。** 这不是 SWE-bench 官方分数，且单任务不能外推总体能力。
