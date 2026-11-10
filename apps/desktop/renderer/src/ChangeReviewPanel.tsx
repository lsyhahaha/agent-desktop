import type { SessionSnapshot, TimelineItem } from "@protocol";
import { CopyText } from "./MarkdownReply";

/** 仅按Diff行前缀着色；文本保持原样，禁止把仓库内容解释成HTML。 */
function diffLineKind(line: string) {
  if (line.startsWith("@@")) return "hunk";
  if (line.startsWith("diff --git") || line.startsWith("index ") || line.startsWith("--- ") || line.startsWith("+++ ")) return "meta";
  if (line.startsWith("+")) return "added";
  if (line.startsWith("-")) return "removed";
  return "context";
}

/**
 * 只读改动审阅模块。
 *
 * Interface 只接收已确认的会话投影与窄动作；Git 比较基准、文件访问和路径校验仍由
 * Runtime/Main 拥有。stage/revert/commit 只允许作为明确禁用的 Mock，刷新失败也不会
 * 将旧快照伪装成当前结果。选中文件仅从当前 Diff 首行推导，解析失败时不猜测。
 */
export function ChangeReviewPanel({
  changes,
  items,
  workspacePath,
  busy,
  pending,
  openError,
  onRefresh,
  onOpenFile,
}: {
  changes?: SessionSnapshot["changes"];
  items: TimelineItem[];
  workspacePath: string | null;
  busy: boolean;
  pending: boolean;
  openError: string;
  onRefresh: (path?: string) => void;
  onOpenFile: (path: string) => void;
}) {
  const changedCount = changes?.git ? changes.files.length : 0;
  // `workspace_changes(path)` 的详情以标准 diff header 开头；只在路径两侧一致时标记选中，
  // 避免从文件顺序或用户可控正文猜测当前文件。带引号的复杂路径暂不高亮。
  const detailPath = changes?.git
    ? changes.detail.match(/^diff --git a\/(.+) b\/\1$/m)?.[1] ?? null
    : null;
  const diffLines = changes?.git ? changes.detail.split("\n") : [];
  // 评论只锚定首个真实新增行；内容是显式Mock，不根据仓库文本臆测缺陷或优先级。
  const inlineCommentIndex = diffLines.findIndex((line) => diffLineKind(line) === "added");
  return (
    <section className="changes-panel" aria-label="工作区改动">
      <header className="changes-summary">
        <div>
          <strong>工作区改动</strong>
          <small>{changes ? `${changedCount} 个文件 · 修改归属未确认` : "尚未读取"}</small>
        </div>
        <div className="changes-summary-actions">
          <button disabled title="暂存写操作尚未实现">暂存 · Mock</button>
          <button disabled title="还原写操作尚未实现">还原 · Mock</button>
          <button disabled={pending || busy || !workspacePath} onClick={() => onRefresh()}>{pending ? "读取中…" : "刷新"}</button>
        </div>
      </header>
      <nav className="review-scope-bar" aria-label="改动审阅范围">
        <span aria-current="page">全部改动</span>
        <button type="button" disabled title="Last turn 范围尚未接入 · Mock">Last turn</button>
        <i aria-hidden="true" />
        <button type="button" disabled title="未暂存范围尚未接入 · Mock">未暂存</button>
        <button type="button" disabled title="已暂存范围尚未接入 · Mock">已暂存</button>
        <button type="button" disabled title="与 main 比较尚未接入 · Mock">main</button>
        <small>Mock</small>
      </nav>
      {openError && <p className="error" role="alert">{openError}</p>}
      {!workspacePath && <p className="review-empty">请先选择项目</p>}
      {changes && (
        <div className="changes-meta">
          <span>{new Date(changes.capturedAt).toLocaleString()}</span>
          <span>{changes.git ? "工作区相对暂存区" : "本轮结构化修改"}</span>
        </div>
      )}
      {changes?.git && (
        <>
          {!changes.files.length ? (
            <p className="review-empty">工作区无改动</p>
          ) : (
            <ul className="change-file-list">
              {changes.files.map((file) => (
                <li className={detailPath === file.path ? "selected" : undefined} key={file.path}>
                  <button
                    className="change-file"
                    aria-current={detailPath === file.path ? "true" : undefined}
                    disabled={pending || busy}
                    onClick={() => onRefresh(file.path)}
                  >
                    <code>{file.index}{file.worktree}</code>
                    <span>{file.path}</span>
                  </button>
                  <button
                    className="change-open"
                    disabled={pending || busy}
                    onClick={() => onOpenFile(file.path)}
                  >
                    打开
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      {changes && !changes.git && (
        <div className="non-git-changes">
          <p>{changes.detail}</p>
          <h4>本轮已确认文件修改</h4>
          {items
            .filter((item) => item.type === "file_change" && item.data.outcome === "applied")
            .map((item) => (
              <p key={item.id}>{item.type === "file_change" && item.data.path}</p>
            ))}
          <small>仅覆盖本轮结构化修改记录，Shell 与外部写入未全面核对。</small>
        </div>
      )}
      {changes?.git && changes.detail && (
        <div className="diff-view">
          <div className="diff-toolbar">
            <span>差异</span>
            <div><button disabled title="行内评论尚未实现">行内评论 · Mock</button><CopyText text={changes.detail} label="复制差异" /></div>
          </div>
          <div className="diff-code" aria-label="差异内容">{diffLines.map((line, index) => (
            <div className="diff-row" key={`${index}-${line.slice(0, 24)}`}>
              <span className={`diff-line ${diffLineKind(line)}`}>{line || "\u00a0"}</span>
              {index === inlineCommentIndex && <aside className="inline-review-comment" role="note">
                <div><strong>评论预览 · Mock</strong><small>确认新增行为是否覆盖对应失败分支。</small></div>
                <button type="button" disabled>Dismiss · Mock</button>
              </aside>}
            </div>
          ))}</div>
        </div>
      )}
    </section>
  );
}
