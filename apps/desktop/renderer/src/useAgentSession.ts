import { useCallback, useEffect, useState } from "react";
import type { SessionSnapshot, DesktopStatus, ModelSettings } from "@protocol";

/** 窗口只维护 Runtime 的显示投影；不在 React 中复制模型循环、文件权限或凭据存储。 */
export function useAgentSession() {
  const [status, setStatus] = useState<DesktopStatus | null>(null);

  const [settings, setSettings] = useState<ModelSettings>({
    model: "deepseek-flash",
    hasKey: false,
  });
  const [state, setState] = useState<SessionSnapshot | null>(null);
  const chat = state?.chat ?? null;
  const workspace = state?.workspace ?? null;
  const sessions = state?.sessions ?? [];
  const [error, setError] = useState("");
  const [connectionError, setConnectionError] = useState<
    "protocol_mismatch" | "connection_failed" | null
  >(null);
  const [pending, setPending] = useState(false);
  const [choosing, setChoosing] = useState(false);
  const [settingsReady, setSettingsReady] = useState(false);
  const active =
    !!chat &&
    [
      "queued",
      "running",
      "waiting_user",
      "waiting_input",
      "waiting_approval",
    ].includes(chat.state);
  const fail = useCallback((e: unknown) => {
    const message = e instanceof Error ? e.message : String(e);
    if (message.includes("[protocol_mismatch]")) {
      setStatus(null);
      setConnectionError("protocol_mismatch");
      setSettingsReady(false);
    } else if (message.includes("[connection_failed]")) {
      setStatus(null);
      setConnectionError("connection_failed");
    }
    setError(message);
  }, []);
  // 命令回包与异步事件可能交错，旧 revision 不得覆盖已经显示的新状态。
  const apply = useCallback(
    (next: SessionSnapshot) =>
      setState((previous) =>
        !previous || next.revision > previous.revision ? next : previous,
      ),
    [],
  );
  useEffect(() => {
    let disposed = false;
    const receive = (snapshot: SessionSnapshot) => {
      if (!disposed) apply(snapshot);
    };
    const report = (e: unknown) => {
      if (!disposed) fail(e);
    };
    // 先监听再读快照，避免初始化期间遗漏状态；卸载只释放本窗口监听。
    const stop = window.desktop.onChat(receive, report);
    void window.desktop.chat({ type: "snapshot" }).then(receive).catch(report);
    void window.desktop
      .getStatus()
      .then((value) => {
        if (!disposed) {
          setStatus(value);
          setConnectionError(null);
        }
      })
      .catch(report);
    void window.desktop
      .getSettings()
      .then((value) => {
        if (!disposed) {
          setSettings(value);
          setSettingsReady(true);
        }
      })
      .catch(report);
    // 窗口重新获得焦点时重新获取权威快照；不重发业务命令或恢复工具。
    const resync = () => {
      void window.desktop
        .chat({ type: "snapshot" })
        .then(receive)
        .catch(report);
    };
    window.addEventListener("focus", resync);
    return () => {
      window.removeEventListener("focus", resync);
      disposed = true;
      stop();
    };
  }, [apply, fail]);
  /** 返回是否已接纳，只有成功 ACK 才能清空用户尚未发送的输入。 */
  async function send(text: string): Promise<boolean> {
    if (
      !state?.sessionId ||
      !text.trim() ||
      pending ||
      active ||
      choosing ||
      !settingsReady ||
      !settings.hasKey ||
      !!state?.storageError ||
      !!connectionError
    )
      return false;
    setPending(true);
    setError("");
    try {
      apply(
        await window.desktop.chat({
          type: "send",
          text,
          sessionId: state.sessionId,
        }),
      );
      return true;
    } catch (e) {
      fail(e);
      return false;
    } finally {
      setPending(false);
    }
  }
  async function command(
    value: Parameters<typeof window.desktop.chat>[0],
  ): Promise<boolean> {
    const switching = [
      "new",
      "select",
      "rename",
      "clear",
      "inspect_run",
      "list_sessions",
    ].includes(value.type);
    if (
      switching &&
      (pending ||
        (active && value.type !== "inspect_run") ||
        choosing ||
        !!connectionError)
    )
      return false;
    if (switching) setPending(true);
    setError("");
    try {
      apply(await window.desktop.chat(value));
      return true;
    } catch (e) {
      fail(e);
      return false;
    } finally {
      if (switching) setPending(false);
    }
  }
  async function choose() {
    if (active || pending || choosing || !!connectionError) return;
    setChoosing(true);
    setError("");
    try {
      const selected = await window.desktop.selectWorkspace();
      if (selected) {
        apply(await window.desktop.chat({ type: "snapshot" }));
      }
    } catch (e) {
      fail(e);
    } finally {
      setChoosing(false);
    }
  }
  /** API Key 仅经受限配置接口提交；已保存密钥永远不从 Main 回传至 React。 */
  async function save(model: string, apiKey: string) {
    setError("");
    try {
      setSettings(
        await window.desktop.saveSettings({
          model,
          ...(apiKey ? { apiKey } : {}),
        }),
      );
    } catch (e) {
      fail(e);
      throw new Error("配置未保存，请查看页面提示");
    }
  }
  return {
    status,
    connectionError,
    title: state?.title ?? "新任务",
    sessionPage: state?.sessionPage ?? 0,
    hasMoreSessions: state?.hasMoreSessions ?? false,
    runs: state?.runs ?? [],
    inspectedRun: state?.inspectedRun ?? null,
    storageError: state?.storageError ?? null,
    sessionId: state?.sessionId ?? null,
    sessions,
    taskStatus: state?.taskStatus ?? "open",
    workspace,
    settings,
    settingsReady,
    chat,
    error,
    pending,
    choosing,
    active,
    send,
    command,
    choose,
    save,
  };
}
