import { createHash } from "node:crypto";
import { ReadingStrategyId } from "@protocol";
export const baselineGuidance = `按用户目标控制取证深度：改动概览需要说明改动主题、主要行为变化、关键文件和未检查范围，不默认逐文件审查或运行构建。先识别用户指定的比较基线；未指定时查看当前未提交改动，包括已暂存、未暂存、未跟踪三类。Git仓库优先取status和按文件统计，不为改动概览先遍历整个目录或读取无关历史。普通git diff不含未跟踪文件；不能只读Diff就声称覆盖新增模块。
取得清单后优先选择行为入口、跨层契约和关键新增源码；文档、截图、证据JSON等非源码只在问题需要时读取。关键新增文件优先read_file，禁止把文件名或行数当作内容证据。数个互不依赖的读取或查询应在同一响应发起多个工具调用，Runtime仍串行执行并分别审批；依赖前一步结果的调用必须等真实结果。不要为了减少调用拼接无关echo分隔、反复status/stat或巨量全文输出。命令中的head/sed等只提供片段，执行器truncated=false不代表源文件读全；缺失范围如实说明，需要时定向补读。
停止条件由用户任务决定：改动概览在主要主题已有证据、关键新增模块已读取或明确无法读取、重要限制可说明时就直接回答，不等预算耗尽；深入审查、修改和验收按用户实际要求继续，不套用概览的浅层完成条件。回答区分已经读取的事实、基于片段的判断和未验证事项，不以命令成功代替任务正确性。`;
/** 候选仅替换取证指引，不持有工具、权限、预算或评价器；生产默认策略保持不变。 */
const guidance = {
  "baseline-v1": baselineGuidance,
  "evidence-first-v1": `${baselineGuidance}\n改动概览候选A：先用Git清单区分暂存、未暂存和未跟踪；获得清单后，优先直接read_file读取最影响行为的新增源码，再在同一响应定向读取相关契约和调用入口。不要把时间先花在历史、文档或逐文件全量Diff上。证据齐备即总结，并明确未读范围。`,
  "module-batch-v1": `${baselineGuidance}\n改动概览候选B：取得Git状态与统计后按模块分组，一轮提出多个互不依赖的查询；每组选择一个关键修改入口和相关新增源码。新增文件用read_file；暂存与未暂存分别取证。不要盲目合并巨量输出，定向补足缺口后总结，不以更少调用掩盖漏读。`,
};
export function readingStrategy(raw: unknown) {
  const id = ReadingStrategyId.parse(raw),
    instructions = guidance[id];
  return {
    id,
    instructions,
    digest: createHash("sha256").update(instructions).digest("hex"),
  };
}
