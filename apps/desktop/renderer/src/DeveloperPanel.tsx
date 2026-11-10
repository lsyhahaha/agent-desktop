import { lazy, Suspense, useState } from "react";
import type { SessionSnapshot, TimelineItem } from "@protocol";
import { ChangeReviewPanel } from "./ChangeReviewPanel";
import { WorkspaceFilesPreview } from "./WorkspaceFilesPreview";
import { ArtifactPreviewMock } from "./ArtifactPreviewMock";
const TerminalPanel = lazy(() =>
  import("./TerminalPanel").then((module) => ({
    default: module.TerminalPanel,
  })),
);
/** 同一面板承载终端、只读改动及显式Mock预览；终端由外层布局放入底部抽屉，其余视图位于右侧。 */
export function DeveloperPanel({
  sessionId,
  workspacePath,
  onClose,
  onCollapse,
  maximized,
  onMaximize,
  view,
  onViewChange,
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
  view: "terminal" | "changes" | "files" | "preview";
  onViewChange: (view: "terminal" | "changes" | "files" | "preview") => void;
}) {
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
    <aside className={`developer-panel developer-panel-${view}`} aria-label="开发者面板">
      <header className="terminal-panel-header">
        {view === "terminal" ? <div className="terminal-drawer-title"><strong>Terminal</strong><small>本机 Shell</small></div> : <nav aria-label="开发者视图">
          <button aria-pressed={view === "changes"} onClick={() => { onViewChange("changes"); if (!changes) void refresh(); }}>改动</button>
          <button aria-pressed={view === "files"} onClick={() => onViewChange("files")}>文件</button>
          <button aria-pressed={view === "preview"} onClick={() => onViewChange("preview")}>预览</button>
        </nav>}
        <div>
          {view !== "terminal" && <button
            aria-label={maximized ? "还原面板" : "最大化面板"}
            onClick={onMaximize}
          >
            {maximized ? "↙" : "↗"}
          </button>}
          {view !== "terminal" && <button aria-label="收起面板" onClick={onCollapse}>
            —
          </button>}
          <button aria-label="关闭开发者面板" onClick={onClose}>
            ×
          </button>
        </div>
      </header>
      {view === "changes" && (
        <ChangeReviewPanel
          changes={changes}
          items={items}
          workspacePath={workspacePath}
          busy={busy}
          pending={pending}
          openError={openError}
          onRefresh={(path) => void refresh(path)}
          onOpenFile={(path) => void openFile(path)}
        />
      )}
      {view === "files" && <WorkspaceFilesPreview workspaceName={workspacePath?.split("/").filter(Boolean).at(-1) ?? "当前项目"} />}
      {view === "preview" && <ArtifactPreviewMock />}
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
