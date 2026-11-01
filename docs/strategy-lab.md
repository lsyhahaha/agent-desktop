# 受控策略自进化第一版

状态：已实现策略候选、固定评估流程和人工启用入口；本轮只做受控验收，尚无真实候选收益结论，也未启用正式候选。按用户明确选择复用现有Runtime，不接入GEPA或新依赖。

## 能力与边界

- 三个受信任构建内的读取策略：baseline-v1（当前默认指引）、evidence-first-v1（证据/关键新增源码优先）、module-batch-v1（按模块批量取证）。后两者由开发者准备，候选不是模型自动生成，也不能从外部JSON注入任意策略代码。
- 策略按Run接纳时冻结，模型时间线和JSONL记录ID与文本摘要；可信安全规则、10次主模型/12次工具、取消/超时、审批和工具实现不由候选修改。没有选定版本时保持当前基线。
- 独立实验室使用同一Runtime、协议、工具和SQLite实现。每次生成临时合成Git项目、独立业务库和日志，不复制用户真实源码，不接入正式会话库，不自动升级正式策略。
- 固定6个案例：新增+修改、仅暂存、暂存/未暂存混合、嵌套新增、删除、无改动；前三个为开发组，后三个为保留组。实际文件内容和Git状态形成快照摘要，基线与候选必须匹配。它是小型公开合成集，不是严格盲测或业务泛化证明。
- 自动指标仅检查所需片段在成功工具输出中可见、正常终态、工作区未变、用量完整、策略/模型/版本/快照一致；不代表模型读懂，也不代表最终答案正确。答案和trace摘要保留，事实正确、覆盖充分、未误报仍须人工审阅。

## 命令流程

先构建。默认只准备文件，不读取凭据、不调用Provider：

```sh
npm run build
npm run strategy:lab -- --project=/Users/a1111/Desktop/agent-desktop
```

输出临时目录及plan.json，包含三个策略文本/摘要、任务切分与快照。可以反复准备核对快照一致性。

真实评估必须另行获得明确的Provider/数据/费用授权，然后由本机操作人显式执行，例如：

```sh
npm run strategy:lab -- --project=/Users/a1111/Desktop/agent-desktop --evaluate=evidence-first-v1 --live --max-requests=120
```

- 每批比较baseline和一个候选，各6项，共12个Run。另一个候选使用module-batch-v1，属于另一批；本轮没有执行这两批真实调用。
- 每Run仍最多10轮；整批max-requests范围10～120，开始下一Run前保守预留10轮。预算不足、取消、执行失败、修改工作区或用量不完整会停止进一步付费评估，保留已有记录，不宣布胜出。
- 从正式设置目录读取并在Main中解密已配置Key，只传至本次Runtime请求上下文；不写入实验报告、环境变量或控制台。准备模式不会走此路径。CLI不保存或改写真实模型设置。
- 评估模式固定ask，只向模型暴露现有读取/命令/轮询/停止工具；执行端也拒绝edit/子模型工具及工作区外/提权请求。Shell仍是受限工作区执行，不是OS只读沙箱；命令需按原钩子逐次人工确认，评估后检查副本未变，不能自动批准未知脚本。
- 审批问题最长等待60秒，每Case墙钟180秒，Ctrl+C传播取消并清理Runtime；Git准备命令有独立10秒上限。快照文件数、深度、字节和Git元数据遍历有界，拒绝链接、外部Git元数据和配置变化。没有新增Shell安全解析器或免审Git通道。

输出evaluation.json、summary.json、实验库data/storage/sessions.sqlite与日志。失败/部分批次也保存；summary的qualityGatePassed仅指上述机器门槛，manualReviewRequired始终为true、winner始终为null。实验报告追加至实验库reading_strategy_evaluations，不并行另开Runtime数据库写者。测试环境将来源降级为controlled，不允许据此启用；这个标签不是密码学真实性证明，维护入口仍信任本机操作人的审阅，不接受模型自报成绩。

## 人工选择与回退

读完报告、12个答案及对应证据后，可信本机维护入口才能启用。当前没有新增管理页，维护入口沿用单实例锁，先保存草稿并正常退出应用；不能在线另开正式库写者：

```sh
npm run evolution -- --select-strategy=evidence-first-v1 --project=/Users/a1111/Desktop/agent-desktop --evaluation=/absolute/lab/evaluation.json --human-reviewed --rationale=实际审阅理由
```

必须有完整live报告，匹配项目、当前策略摘要、套件摘要及稳定实现摘要；controlled、缺Case、失败、用量缺失、快照不一致、答案截断均拒绝。--human-reviewed是本机操作人的明确声明，不是自动判定语义正确。不能在实际未审阅时使用。

回到基线同样显式留理由，不删除历史：

```sh
npm run evolution -- --select-strategy=baseline-v1 --project=/Users/a1111/Desktop/agent-desktop --human-reviewed --rationale=回到已知基线
```

读取策略选择历史保存到正式库reading_strategy_selections。新Run从既有Worker读取，运行中不切换。启用依据过期（候选文本或受信任实现摘要变化）时保留历史，实际运行回到基线；模型条目显示实际采用的策略。实现摘要覆盖Runtime、协议、Main源码、构建配置与lock文件；同内容重新构建不会仅因随机buildId失效。buildId仍用于进程混用检测。源码注释/格式变化也可能保守失效，不承诺按语义判断兼容。

## 版本、验证与资源

数据库v5→v6只增实验报告和选择历史表，不改原会话/进化记录；协议9→10，旧数据的模型条目没有策略字段时不回填。正常用户聊天默认保持baseline，未引入候选自动搜索、评价器自改、自动部署或元优化器。

实际检查：npm run build（含类型检查）、git diff --check；无新增单元测试、真实API调用或正式候选选择。

- [准备与迁移](evidence/strategy-lab-prepare.json)：不同临时目录的6个快照摘要一致、三个策略版本、缺live参数拒绝、隔离v5→v6保留既有行数。
- [Runtime与选择边界](evidence/strategy-lab-controlled.json)：候选冻结及实际进入提示、评估固定ask、越权工具拒绝、证据缺失不伪造覆盖、报告幂等、controlled/不完整/版本不符/副本变更拒绝选择；恢复与回退的正向分支使用人工合成报告，只在隔离库检验条件，不是实测成绩。
- [完整受控批次](evidence/strategy-lab-full-controlled.json)：真实Main/utility Runtime/工具/Git/SQLite，只有Provider和凭据为替身，12次任务与12次明确审批均跑通；报告为controlled、没有获胜者或正式推广。早期发现macOS临时路径别名导致Run未开始，修正为规范路径后重跑通过；保留失败记录，没有绕过身份检查。
- [既有24项受控回归](evidence/observability-acceptance.json)通过，并查看浅深/最小窗口下的模型策略标签。UI只新增实际策略说明，沿用原滚动、输入和审批行为。

本轮不声称任何候选优于基线。六个合成任务未覆盖真实大仓库、重命名、子模块、完整安全故障矩阵或跨平台；片段匹配不能识别所有事实错误。后续先扩充固定业务样本，再获得费用授权做重复真实评估。每批可能达到120次主模型请求，不能沿用此前“单次问题验收”的授权。

源码：reading-strategy.ts拥有候选指引；strategy-evaluation.ts拥有固定Case与机器门槛；strategy-lab.ts复用RuntimeHost运行实验；storage-worker.ts拥有持久化与选择；evolution-admin.ts是人工维护入口。Electron参考本地utility-process与IPC/进程文档，适用45.1.0，不放宽preload或窗口安全选项。


本轮工程实现的结构化记录：[self-evolution-2-strategy-lab.json](evolution-records/self-evolution-2-strategy-lab.json)。用户确认草稿已保存、任务已结束并授权后，已正常退出、备份、升级正式库v6并补录。记录ID为10d9eada-0f6d-4786-b56c-8e7429398696；原会话和执行事实行数保持，正式策略选择表为空，仍为baseline-v1。部署证据见[正式补录与迁移](evidence/strategy-lab-deployment.json)。本次未做真实候选评估。
