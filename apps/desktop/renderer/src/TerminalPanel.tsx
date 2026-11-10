import { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import type { TerminalSnapshot, TerminalCommand, TerminalTab } from "@protocol";

/** xterm只负责终端呈现；shell、路径、环境、授权和进程生命周期都由可信后端拥有。 */
export function TerminalPanel({
  sessionId,
  workspacePath,
}: {
  sessionId: string | null;
  workspacePath: string | null;
}) {
  const host = useRef<HTMLDivElement>(null),
    terminal = useRef<Terminal | null>(null),
    current = useRef<TerminalSnapshot | null>(null);
  const [state, setState] = useState<TerminalSnapshot | null>(null),
    [error, setError] = useState(""),
    [starting, setStarting] = useState(false);
  const fit = useRef<FitAddon | null>(null);
  const [tabs, setTabs] = useState<TerminalTab[]>([]),
    [activeId, setActiveId] = useState<string | null>(null);
  const attempted = useRef(new Set<string>()),
    pendingStart = useRef(false),
    restoreCurrent = useRef<() => void>(() => {});
  const scope = useRef("");
  scope.current = `${sessionId}:${workspacePath}`;
  useEffect(() => {
    attempted.current.clear();
    setTabs([]);
    setActiveId(null);
  }, [sessionId, workspacePath]);
  async function command(value: TerminalCommand) {
    try {
      const reply = await window.desktop.terminal(value);
      if (reply.terminals) setTabs(reply.terminals);
      if (reply.terminal) receive.current(reply.terminal);
      return reply;
    } catch (e) {
      setError(e instanceof Error ? e.message : "终端操作失败");
      return null;
    }
  }
  const receive = useRef<(value: TerminalSnapshot) => void>(() => {});
  useEffect(() => {
    current.current = null;
    setState(null);
    setError("");
    const element = host.current;
    if (!element || !sessionId) return;
    let disposed = false,
      offset = 0,
      id = "",
      revision = -1,
      writes = Promise.resolve(),
      queued = 0,
      resizeTimer: ReturnType<typeof setTimeout> | undefined;
    const term = new Terminal({
      cursorBlink: true,
      fontFamily: 'Menlo, Monaco, "PingFang SC", monospace',
      fontSize: 12,
      scrollback: 2000,
      allowProposedApi: false,
      allowTransparency: false,
      convertEol: false,
    });
    const addon = new FitAddon();
    term.loadAddon(addon);
    term.open(element);
    terminal.current = term;
    fit.current = addon;
    const theme = () => {
      const css = getComputedStyle(document.documentElement);
      term.options.theme = {
        background: css.getPropertyValue("--surface").trim() || "#fafafa",
        foreground: css.getPropertyValue("--text").trim() || "#252729",
        cursor: css.getPropertyValue("--text").trim() || "#252729",
        selectionBackground: "#6a86a566",
      };
    };
    theme();
    const themeObserver = new MutationObserver(theme);
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    const report = (message: string) => {
      if (!disposed) setError(message);
    };
    const accept = (value: TerminalSnapshot) => {
      if (disposed || value.sessionId !== sessionId) return;
      setTabs((previous) =>
        previous.map((tab) =>
          tab.terminalId === value.terminalId
            ? { ...tab, state: value.state, exitCode: value.exitCode }
            : tab,
        ),
      );
      if (activeId && value.terminalId !== activeId) return;
      if (!activeId) setActiveId(value.terminalId);
      if (id === value.terminalId && value.seq <= revision) return;
      if (id !== value.terminalId) {
        term.reset();
        id = value.terminalId;
        offset = 0;
        revision = -1;
      }
      const delta = value.offset - offset;
      if (delta > value.output.length) {
        term.reset();
        term.writeln("[终端历史达到上限，仅恢复最近输出]");
        term.write(value.output);
      } else if (delta > 0) term.write(value.output.slice(-delta));
      offset = value.offset;
      revision = value.seq;
      current.current = value;
      setState(value);
      if (value.error) setError(value.error);
    };
    receive.current = accept;
    const stop = window.desktop.onTerminal(accept, report);
    let initialRestore = true;
    const restore = () => {
      void window.desktop
        .terminal({
          type: "snapshot",
          sessionId,
          ...(activeId ? { terminalId: activeId } : {}),
        })
        .then((reply) => {
          if (disposed) return;
          if (reply.terminals) setTabs(reply.terminals);
          if (reply.terminal) {
            accept(reply.terminal);
            if (initialRestore) {
              initialRestore = false;
              term.focus();
            }
          } else if (
            !activeId &&
            workspacePath &&
            !reply.terminals?.length &&
            !pendingStart.current
          ) {
            const key = `${sessionId}:${workspacePath}`;
            // 每次挂载/工作区仅自动尝试一次；失败不能触发循环创建进程。
            if (!attempted.current.has(key)) {
              attempted.current.add(key);
              void start();
            }
          }
        })
        .catch(() => report("终端连接失败，请完整重启应用。"));
    };
    restoreCurrent.current = restore;
    void window.desktop
      .terminal({ type: "watch", sessionId, enabled: true })
      .then(restore)
      .catch(() => report("终端订阅失败"));
    window.addEventListener("focus", restore);
    const send = (data: string) => {
      const scope = current.current;
      if (!scope || scope.state !== "running") return;
      if (data.length > 32768 || queued > 32) {
        report("输入缓冲达到上限，请分批粘贴。");
        return;
      }
      for (let from = 0; from < data.length;) {
        let end = Math.min(data.length, from + 4096);
        const code = data.charCodeAt(end - 1);
        if (code >= 0xd800 && code <= 0xdbff && end < data.length) end--;
        const part = data.slice(from, end);
        from = end;
        queued++;
        writes = writes
          .then(async () => {
            if (disposed) return;
            await window.desktop.terminal({
              type: "write",
              sessionId,
              terminalId: scope.terminalId,
              data: part,
            });
          })
          .catch(() => report("输入未发送，终端可能已结束。"))
          .finally(() => {
            queued--;
          });
      }
    };
    const input = term.onData(send);
    const resize = () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        if (disposed || element.clientHeight < 30 || element.clientWidth < 30)
          return;
        addon.fit();
        const s = current.current;
        if (s?.state === "running") {
          const cols = Math.max(20, Math.min(400, term.cols)),
            rows = Math.max(5, Math.min(200, term.rows));
          if (cols !== s.cols || rows !== s.rows)
            void window.desktop
              .terminal({
                type: "resize",
                sessionId,
                terminalId: s.terminalId,
                cols,
                rows,
              })
              .catch(() => report("终端尺寸同步失败。"));
        }
      }, 100);
    };
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    resize();
    term.attachCustomKeyEventHandler((event) => {
      if (
        event.type === "keydown" &&
        (event.metaKey || event.ctrlKey) &&
        event.key.toLowerCase() === "c" &&
        term.hasSelection()
      ) {
        void navigator.clipboard
          .writeText(term.getSelection())
          .catch(() => report("复制失败"));
        return false;
      }
      return true;
    });
    return () => {
      disposed = true;
      receive.current = () => {};
      clearTimeout(resizeTimer);
      observer.disconnect();
      themeObserver.disconnect();
      stop();
      void window.desktop
        .terminal({ type: "watch", sessionId, enabled: false })
        .catch(() => {});
      input.dispose();
      window.removeEventListener("focus", restore);
      term.dispose();
      terminal.current = null;
      fit.current = null;
    };
  }, [sessionId, workspacePath, activeId]);
  async function start() {
    if (!sessionId || !workspacePath || pendingStart.current) return;
    const openingScope = scope.current;
    pendingStart.current = true;
    setStarting(true);
    setError("");
    try {
      fit.current?.fit();
      const reply = await window.desktop.terminal({
        type: "open",
        sessionId,
        cols: Math.max(20, Math.min(400, terminal.current?.cols ?? 80)),
        rows: Math.max(5, Math.min(200, terminal.current?.rows ?? 24)),
      });
      if (scope.current !== openingScope) return;
      if (reply?.terminal) {
        setActiveId(reply.terminal.terminalId);
        const list = await window.desktop.terminal({ type: "list", sessionId });
        setTabs(list.terminals ?? []);
      }
      terminal.current?.focus();
    } catch (e) {
      if (scope.current === openingScope)
        setError(e instanceof Error ? e.message : "终端启动失败");
    } finally {
      pendingStart.current = false;
      setStarting(false);
      if (scope.current !== openingScope) restoreCurrent.current();
    }
  }
  async function control(type: "interrupt" | "close") {
    const s = current.current;
    if (s)
      await command({ type, sessionId: s.sessionId, terminalId: s.terminalId });
  }
  async function paste() {
    const s = current.current;
    if (!s) return;
    await command({
      type: "paste",
      sessionId: s.sessionId,
      terminalId: s.terminalId,
    });
    terminal.current?.focus();
  }
  return (
    <section className="terminal-panel" role="tabpanel" id="developer-terminal">
      <div
        className="terminal-session-tabs"
        role="tablist"
        aria-label="终端会话"
      >
        {tabs.map((tab, index) => (
          <div
            className={
              "terminal-session-tab" +
              (tab.terminalId === activeId ? " selected" : "")
            }
            key={tab.terminalId}
          >
            <button
              role="tab"
              aria-selected={tab.terminalId === activeId}
              title={`${tab.cwd} · ${tab.state}`}
              onClick={() => setActiveId(tab.terminalId)}
            >
              <span aria-hidden="true">›_</span> {tab.shell.split("/").at(-1)} ·{" "}
              {tab.cwd.split("/").at(-1) || "/"}
              {index ? ` ${index + 1}` : ""}
            </button>
            <button
              aria-label={`关闭终端${index + 1}`}
              onClick={async () => {
                if (!sessionId) return;
                const reply = await command({
                  type: "remove",
                  sessionId,
                  terminalId: tab.terminalId,
                });
                if (reply) {
                  const remaining = reply.terminals ?? [];
                  setTabs(remaining);
                  if (activeId === tab.terminalId)
                    setActiveId(remaining.at(-1)?.terminalId ?? null);
                }
              }}
            >
              ×
            </button>
          </div>
        ))}
        <button
          className="terminal-new"
          aria-label="新建终端"
          title="新建本机开发终端"
          onClick={() => void start()}
          disabled={!sessionId || starting || tabs.length >= 4}
        >
          +
        </button>
        <span className="terminal-session-spacer" />
        <details className="terminal-menu">
          <summary aria-label="终端菜单">···</summary>
          <div>
            <button
              onClick={() => void control("interrupt")}
              disabled={state?.state !== "running"}
            >
              中断 Ctrl+C
            </button>
            <button
              onClick={() => {
                const text = terminal.current?.getSelection();
                if (text)
                  void navigator.clipboard
                    .writeText(text)
                    .catch(() => setError("复制失败"));
              }}
            >
              复制选中
            </button>
            <button
              onClick={() => void paste()}
              disabled={state?.state !== "running"}
            >
              粘贴
            </button>
            <button onClick={() => terminal.current?.clear()}>清除显示</button>
            <button
              onClick={() => void control("close")}
              disabled={!state || state.exitCode !== null}
            >
              结束进程
            </button>
            <p>
              本机权限 · 可写 ·
              联网。加载个人Shell配置；不自动发送模型或写入Run日志。
            </p>
            <p>每标签最长30分钟、累计输入1MiB/输出4MiB；保留最近65536字符。</p>
            <p>
              {state
                ? `${state.cwd} · ${state.cols}×${state.rows} · ${state.state}${state.exitCode === null ? "" : ` · 退出码${state.exitCode}`}`
                : "尚未启动"}
            </p>
          </div>
        </details>
      </div>
      {starting && <small role="status">正在打开终端…</small>}
      {!workspacePath && <small role="status">请先选择项目目录</small>}
      {state?.exitCode !== null && state && (
        <small role="status">进程已结束 · 退出码 {state.exitCode}</small>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {!state && !starting && workspacePath && (
        <div className="terminal-empty">
          <strong>打开终端</strong>
          <p>在当前项目中启动真实的本机 Shell。</p>
          <button type="button" onClick={() => void start()}>新建终端</button>
        </div>
      )}
      <div className="pty-host" ref={host} aria-label="真实PTY终端" />
    </section>
  );
}
