import { lazy, Suspense, useState } from "react";
import type { SessionSnapshot, TimelineItem } from "@protocol";
import { CopyText } from "./MarkdownReply";
const TerminalPanel = lazy(() =>
  import("./TerminalPanel").then((module) => ({
    default: module.TerminalPanel,
  })),
);
/** 右侧仅承载用户终端；聊天执行时间线继续由原会话投影负责。 */
export function DeveloperPanel({
  sessionId,
  workspacePath,
  onClose,
  onCollapse,
  maximized,
  onMaximize,
  changes, onRefresh, items = [], busy = false,
}: {
  changes?: SessionSnapshot["changes"];
  onRefresh: (path?: string) => Promise<boolean>;
  items?: TimelineItem[];
  busy?: boolean;
  sessionId: string | null;
  workspacePath: string | null;
  onClose: () => void;
  onCollapse: () => void;
  maximized: boolean;
  onMaximize: () => void;
}) {
  const [view, setView] = useState("terminal");
  const [pending, setPending] = useState(false);
  const [openError, setOpenError] = useState("");
  async function openFile(path: string) {
    if (!sessionId) return;
    try { await window.desktop.openWorkspaceFile({sessionId, path}); setOpenError(""); }
    catch { setOpenError("文件未能打开，请确认它仍是当前项目中的普通文本文件并配置系统编辑器。"); }
  }
  // 面板请求只选择已授权项目中的条目，失败显示在原工作区错误区。
  async function refresh(path?: string) {
    setPending(true);
    try { await onRefresh(path); } finally { setPending(false); }
  }
  return (
    <aside className="developer-panel" aria-label="终端面板">
      <header className="terminal-panel-header">
        <nav aria-label="开发者视图">
          <button aria-pressed={view === "terminal"} onClick={() => setView("terminal")}>终端</button>
          <button aria-pressed={view === "changes"} onClick={() => { setView("changes"); if (!changes) void refresh(); }}>改动</button>
        </nav>
        <div>
          <button
            aria-label={maximized ? "还原面板" : "最大化面板"}
            onClick={onMaximize}
          >
            {maximized ? "↙" : "↗"}
          </button>
          <button aria-label="收起面板" onClick={onCollapse}>
            —
          </button>
          <button aria-label="关闭开发者面板" onClick={onClose}>
            ×
          </button>
        </div>
      </header>
      {view === "changes" && <section className="changes-panel" aria-label="工作区改动">
        <button disabled={pending || busy || !workspacePath} onClick={() => void refresh()}>{pending ? "读取中…" : "刷新改动"}</button>
        {openError && <p role="alert">{openError}</p>}
        <p>工作区现有改动 · 修改归属未确认</p>
        {changes && <small>读取于 {new Date(changes.capturedAt).toLocaleString()}</small>}
        {!workspacePath && <p>请先选择项目</p>}
        {changes?.git && <><p>暂存区相对HEAD，工作区相对暂存区。未跟踪文本单独读取。</p>
          {!changes.files.length && <p>工作区无改动</p>}
          <ul>{changes.files.map((file) => <li key={file.path}>
            <button disabled={pending || busy} onClick={() => void refresh(file.path)}>
              <code>{file.index}{file.worktree}</code> {file.path}
            </button><button disabled={pending || busy} onClick={() => void openFile(file.path)}>打开文件</button></li>)}</ul></>}
        {changes && !changes.git && <><p>{changes.detail}</p><h4>本轮已确认文件修改</h4>
          {items.filter((item) => item.type === "file_change" && item.data.outcome === "applied").map((item) =>
            <p key={item.id}>{item.type === "file_change" && item.data.path}</p>)}
          <small>仅覆盖本轮结构化修改记录，Shell与外部写入未全面核对。</small></>}
        {changes?.git && changes.detail && <><CopyText text={changes.detail} label="复制差异" /><pre>{changes.detail}</pre></>}
      </section>}
      {/* 切换视图保留PTY组件与会话，避免重复启动Shell。 */}
      <div className="terminal-view" hidden={view !== "terminal"}>
      <Suspense
        fallback={<p className="developer-unavailable">加载终端组件…</p>}
      >
        <TerminalPanel sessionId={sessionId} workspacePath={workspacePath} />
      </Suspense>
      </div>
    </aside>
  );
}
