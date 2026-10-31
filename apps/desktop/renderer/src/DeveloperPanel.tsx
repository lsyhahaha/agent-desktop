import { lazy, Suspense } from "react";
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
}: {
  sessionId: string | null;
  workspacePath: string | null;
  onClose: () => void;
  onCollapse: () => void;
  maximized: boolean;
  onMaximize: () => void;
}) {
  return (
    <aside className="developer-panel" aria-label="终端面板">
      <header className="terminal-panel-header">
        <span>Terminal</span>
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
      <Suspense
        fallback={<p className="developer-unavailable">加载终端组件…</p>}
      >
        <TerminalPanel sessionId={sessionId} workspacePath={workspacePath} />
      </Suspense>
    </aside>
  );
}
