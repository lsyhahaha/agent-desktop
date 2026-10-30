import { useCallback, useEffect, useState } from "react";
import type { DesktopStatus, WorkspaceSelection } from "@protocol";
export function App() {
  const [status, setStatus] = useState<DesktopStatus | null>(null);
  const [workspace, setWorkspace] = useState<WorkspaceSelection>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [choosing, setChoosing] = useState(false);
  const refresh = useCallback(async () => {
    setBusy(true);
    setError("");
    try {
      setStatus(await window.desktop.getStatus());
    } catch (error) {
      setStatus(null);
      setError(error instanceof Error ? error.message : "连接失败");
    } finally {
      setBusy(false);
    }
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  async function choose() {
    setChoosing(true);
    try {
      const selected = await window.desktop.selectWorkspace();
      if (selected) setWorkspace(selected);
    } catch (error) {
      setError(error instanceof Error ? error.message : "无法选择项目");
    } finally {
      setChoosing(false);
    }
  }
  return (
    <div className="app">
      <header className="titlebar">
        <span>Agent Desktop</span>
        <span className="stage">开发工作区 · v0.1</span>
      </header>
      <div className="layout">
        <aside className="sidebar">
          <div className="brand">
            <span className="mark">a</span>
            <div>
              Agent Desktop<small>你的本地开发搭档</small>
            </div>
          </div>
          <button
            className="project"
            onClick={() => void choose()}
            disabled={choosing}
          >
            <span className="folder">▣</span>
            <span>
              {workspace?.name ?? "选择项目目录"}
              <small>{workspace ? "点击切换项目" : "从一个真实项目开始"}</small>
            </span>
            <span>⌄</span>
          </button>
          <div className="section-label">工作空间</div>
          <div className="nav active">
            ◈<span>新对话</span>
            <kbd>01</kbd>
          </div>
          <div className="nav muted">
            ▤<span>会话历史</span>
            <small>待接入</small>
          </div>
          <div className="nav muted">
            ◇<span>变更审阅</span>
            <small>待接入</small>
          </div>
          <div className="sidebar-bottom">
            <span className={"dot " + (status ? "green" : "")}></span>
            {status ? "本地 Runtime 已连接" : "Runtime 未连接"}
            <small>文件操作与模型调用尚未启用</small>
          </div>
        </aside>
        <main>
          <div className="main-top">
            <span>工作台</span>
            <span className="pill">桌面骨架</span>
          </div>
          <section className="welcome">
            <div className="eyebrow">A SPACE TO BUILD</div>
            <h1>
              从一个想法，
              <br />
              <span>到一次真实的改变。</span>
            </h1>
            <p>
              理解项目、探索方案、审阅每一次修改。
              <br />
              让执行过程清晰可见，让决定始终在你手中。
            </p>
            <div className="cards">
              <article>
                <span>01 / 理解</span>
                <h3>读懂你的项目</h3>
                <p>梳理代码结构与关键链路</p>
              </article>
              <article>
                <span>02 / 实现</span>
                <h3>推进一次修改</h3>
                <p>连接工具，执行并验证方案</p>
              </article>
              <article>
                <span>03 / 审阅</span>
                <h3>看清每处变化</h3>
                <p>检查 Diff 后再应用变更</p>
              </article>
            </div>
            <div className="composer">
              <label htmlFor="prompt">你想在这个项目中做些什么？</label>
              <textarea
                id="prompt"
                disabled
                placeholder="模型接入后，在这里描述你的任务…"
              />
              <div className="composer-footer">
                <span>
                  {workspace ? workspace.name : "尚未选择项目"} · 未配置模型
                </span>
                <button disabled aria-label="发送任务">
                  ↑
                </button>
              </div>
            </div>
            <div className="hint">
              当前已打通桌面 → 主进程 → 独立 Runtime。这里暂不执行任务。
            </div>
          </section>
        </main>
        <aside className="inspector">
          <div className="inspector-title">
            运行状态
            <button onClick={() => void refresh()} disabled={busy}>
              {busy ? "检查中" : "刷新"}
            </button>
          </div>
          <div className="status-card">
            <span className={"dot " + (status ? "green" : "")}></span>
            <strong>
              {status ? "Runtime 就绪" : busy ? "正在连接" : "连接不可用"}
            </strong>
            <p>独立 Node.js 进程</p>
          </div>
          {error && (
            <div role="alert" className="error">
              {error}
            </div>
          )}
          <dl>
            <dt>Electron</dt>
            <dd>{status?.electronVersion ?? "—"}</dd>
            <dt>Runtime Node.js</dt>
            <dd>{status?.runtime.nodeVersion ?? "—"}</dd>
            <dt>Runtime PID</dt>
            <dd>{status?.runtime.pid ?? "—"}</dd>
            <dt>应用版本</dt>
            <dd>{status?.appVersion ?? "—"}</dd>
          </dl>
          <div className="section-label">当前项目</div>
          <div className="path">
            {workspace?.path ??
              "选择目录后显示路径。当前不会读取或修改项目文件。"}
          </div>
          <div className="next">
            <span>下一步</span>
            <p>接入模型与会话持久化，完成第一条可运行的对话链路。</p>
          </div>
        </aside>
      </div>
      <footer>
        <span>TYPE SCRIPT / REACT / ELECTRON</span>
        <span>本地优先 · 过程可见</span>
      </footer>
    </div>
  );
}
