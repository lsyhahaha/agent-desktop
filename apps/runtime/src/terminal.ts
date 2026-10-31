import { randomUUID } from "node:crypto";
import type { IPty } from "node-pty";
import { realpath, stat } from "node:fs/promises";
import {
  type TerminalCommand,
  type TerminalSnapshot,
  type TerminalProfile,
  type TerminalTab,
} from "@protocol";

/** 单个本机PTY的生命周期；不向Agent或日志复制用户终端内容。 */
class TerminalSession {
  private process: IPty | undefined;
  private state: TerminalSnapshot | undefined;
  private opening = false;
  private watchedSession: string | null = null;
  private controller: AbortController | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private lifetime: ReturnType<typeof setTimeout> | undefined;
  private stopTimer: ReturnType<typeof setTimeout> | undefined;
  private received = 0;
  private inputTotal = 0;
  private inputWindow = 0;
  private inputBytes = 0;
  private done: Promise<void> = Promise.resolve();
  private resolveDone: (() => void) | undefined;
  stopSync() {
    try {
      this.process?.kill("SIGHUP");
    } catch {
      console.warn("[terminal] exit_cleanup_failed");
    }
  }
  constructor(private notify: (state: TerminalSnapshot) => void) {}
  snapshot(sessionId: string) {
    return this.state?.sessionId === sessionId
      ? structuredClone(this.state)
      : null;
  }
  /** 列表只复制身份和状态，不在每次按键回包中复制所有标签的回显。 */
  tab(sessionId: string): TerminalTab | null {
    const s = this.state;
    if (!s || s.sessionId !== sessionId) return null;
    return {
      terminalId: s.terminalId,
      sessionId: s.sessionId,
      cwd: s.cwd,
      shell: s.shell,
      state: s.state,
      exitCode: s.exitCode,
    };
  }
  private publish() {
    if (!this.state) return;
    this.state.seq++;
    if (this.watchedSession !== this.state.sessionId) return;
    this.notify(structuredClone(this.state));
  }
  private schedule() {
    if (!this.timer)
      this.timer = setTimeout(() => {
        this.timer = undefined;
        this.publish();
      }, 75);
  }
  async open(
    sessionId: string,
    root: string,
    cols: number,
    rows: number,
    profile: TerminalProfile,
  ) {
    if (this.opening || this.process) throw new Error("已有终端会话，请先关闭");
    this.opening = true;
    this.controller = new AbortController();
    const signal = this.controller.signal;
    try {
      const canonical = await realpath(root);
      if (canonical !== root || !(await stat(canonical)).isDirectory())
        throw new Error("工作区目录已变化");
      const terminalId = randomUUID();
      // 本机开发终端有用户权限；启动文件按用户选择加载。仅传递开发所需环境，不复制Main中的Provider密钥。
      const pty = await import("node-pty");
      signal.throwIfAborted();
      const child = pty.spawn(profile.shell, ["-l", "-i"], {
        name: "xterm-256color",
        cols,
        rows,
        cwd: canonical,
        env: {
          PATH: profile.path,
          HOME: profile.home,
          USER: profile.user,
          LOGNAME: profile.user,
          SHELL: profile.shell,
          LANG: profile.lang,
          TERM: "xterm-256color",
          COLORTERM: "truecolor",
          TMPDIR: profile.tmp,
          BASH_SILENCE_DEPRECATION_WARNING: "1",
        },
      });
      this.process = child;
      this.received = 0;
      this.inputTotal = 0;
      this.inputWindow = Date.now();
      this.inputBytes = 0;
      this.done = new Promise((resolve) => {
        this.resolveDone = resolve;
      });
      this.state = {
        terminalId,
        sessionId,
        cwd: canonical,
        shell: profile.shell,
        state: "running",
        seq: 0,
        offset: 0,
        output: "",
        truncated: false,
        cols,
        rows,
        exitCode: null,
        error: null,
      };
      child.onData((data) => {
        if (this.process !== child || !this.state) return;
        this.received += Buffer.byteLength(data);
        this.state.offset += data.length;
        this.state.output = (this.state.output + data).slice(-65536);
        if (this.state.offset > 65536) this.state.truncated = true;
        if (this.received > 4 * 1024 * 1024) {
          this.state.error = "终端累计输出超过4MiB上限，会话已停止";
          void this.close().catch(() =>
            console.warn("[terminal] close_unconfirmed"),
          );
        }
        this.schedule();
      });
      child.onExit(({ exitCode }) => {
        if (this.process !== child || !this.state) return;
        this.process = undefined;
        clearTimeout(this.lifetime);
        clearTimeout(this.stopTimer);
        clearTimeout(this.timer);
        this.timer = undefined;
        this.state.state = this.state.error ? "failed" : "exited";
        this.state.exitCode = exitCode;
        this.publish();
        this.resolveDone?.();
      });
      // 独立终端不继承Run的120秒预算，最长30分钟；退出应用或切换工作区时关闭。
      this.lifetime = setTimeout(
        () => {
          if (this.state) this.state.error = "终端达到30分钟会话上限";
          void this.close().catch(() =>
            console.warn("[terminal] close_unconfirmed"),
          );
        },
        30 * 60 * 1000,
      );
      this.publish();
      return this.snapshot(sessionId);
    } finally {
      this.opening = false;
    }
  }
  async command(command: TerminalCommand) {
    if (
      command.type === "list" ||
      command.type === "remove" ||
      command.type === "close_all"
    )
      throw new Error("终端管理命令必须经会话注册表处理");
    if (command.type === "watch") {
      if (command.enabled) this.watchedSession = command.sessionId;
      else if (this.watchedSession === command.sessionId)
        this.watchedSession = null;
      return { terminal: null };
    }
    if (command.type === "snapshot")
      return { terminal: this.snapshot(command.sessionId) };
    if (command.type === "paste") throw new Error("剪贴板仅可由Main处理");
    if (command.type === "open")
      throw new Error("终端启动必须经过Main工作区校验");
    if (
      !this.state ||
      this.state.sessionId !== command.sessionId ||
      this.state.terminalId !== command.terminalId
    )
      throw new Error("终端会话已失效");
    if (command.type === "close") {
      await this.close();
      return { terminal: this.snapshot(command.sessionId) };
    }
    const child = this.process;
    if (!child || this.state.state !== "running") throw new Error("终端未运行");
    if (command.type === "write") {
      const bytes = Buffer.byteLength(command.data);
      if (Date.now() - this.inputWindow >= 1000) {
        this.inputWindow = Date.now();
        this.inputBytes = 0;
      }
      if (this.inputBytes + bytes > 65536)
        throw new Error("终端输入速率超过64KiB/秒，请稍后重试");
      if (this.inputTotal + bytes > 1024 * 1024) {
        this.state.error = "终端累计输入超过1MiB，会话已停止";
        await this.close();
        throw new Error(this.state.error);
      }
      this.inputBytes += bytes;
      this.inputTotal += bytes;
      child.write(command.data);
    }
    if (command.type === "interrupt") child.write("\x03");
    if (command.type === "resize") {
      child.resize(command.cols, command.rows);
      this.state.cols = command.cols;
      this.state.rows = command.rows;
      this.publish();
    }
    return { terminal: null };
  }
  async close() {
    this.controller?.abort();
    const child = this.process;
    if (!child) return;
    if (this.state && this.state.state !== "stopping") {
      this.state.state = "stopping";
      this.publish();
      // SIGHUP让交互bash通知其作业，随后升级KILL；不操作任意外部PID。
      try {
        child.kill("SIGHUP");
      } catch {
        console.warn("[terminal] hangup_failed");
      }
      this.stopTimer = setTimeout(() => {
        if (this.process === child)
          try {
            child.kill("SIGKILL");
          } catch {
            console.warn("[terminal] kill_failed");
          }
      }, 300);
    }
    let deadline: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        this.done,
        new Promise<never>((_, reject) => {
          deadline = setTimeout(
            () => reject(new Error("终端停止结果未确认")),
            2000,
          );
        }),
      ]);
    } catch (error) {
      if (this.state) {
        this.state.error = "终端停止结果未确认，请完整退出应用后检查。";
        this.state.state = "failed";
        this.publish();
      }
      throw error;
    } finally {
      clearTimeout(deadline);
    }
  }
}

/** 至多四个真实PTY；列表和选中态属于界面，进程与资源预算各自独立。 */
export class TerminalManager {
  private sessions = new Map<string, TerminalSession>();
  private watched: string | null = null;
  private opening = false;
  private selected: string | undefined;
  private pending: { sessionId: string; value: TerminalSession } | undefined;
  constructor(private notify: (snapshot: TerminalSnapshot) => void) {}
  private list(sessionId: string): TerminalTab[] {
    return [...this.sessions.values()]
      .map((value) => value.tab(sessionId))
      .filter((tab): tab is TerminalTab => !!tab);
  }
  snapshot(sessionId: string, id?: string) {
    if (id && !this.sessions.get(id)?.tab(sessionId)) return null;
    if (id) this.selected = id;
    const chosen = id ?? this.selected;
    const row =
      chosen && this.sessions.get(chosen)?.tab(sessionId)
        ? this.sessions.get(chosen)
        : [...this.sessions.values()]
            .reverse()
            .find((value) => value.tab(sessionId));
    return row?.snapshot(sessionId) ?? null;
  }
  async open(
    sessionId: string,
    root: string,
    cols: number,
    rows: number,
    profile: TerminalProfile,
  ) {
    if (this.opening) throw new Error("正在启动终端");
    this.opening = true;
    try {
      if (this.sessions.size >= 4) {
        for (const [id, value] of this.sessions) {
          const state = value.snapshot(sessionId);
          if (state?.exitCode !== null && state) {
            this.sessions.delete(id);
            break;
          }
        }
      }
      if (this.sessions.size >= 4)
        throw new Error("终端最多四个，请先关闭一个标签");
      const value = new TerminalSession((snapshot) => this.notify(snapshot));
      this.pending = { sessionId, value };
      if (this.watched === sessionId)
        await value.command({ type: "watch", sessionId, enabled: true });
      const snapshot = await value.open(sessionId, root, cols, rows, profile);
      if (snapshot) {
        this.sessions.set(snapshot.terminalId, value);
        this.selected = snapshot.terminalId;
      }
      return snapshot;
    } finally {
      this.opening = false;
      this.pending = undefined;
    }
  }
  async command(command: TerminalCommand) {
    if (command.type === "open") throw new Error("启动须经Main工作区校验");
    if (command.type === "list")
      return { terminal: null, terminals: this.list(command.sessionId) };
    if (command.type === "snapshot")
      return {
        terminal: this.snapshot(command.sessionId, command.terminalId),
        terminals: this.list(command.sessionId),
      };
    if (command.type === "watch") {
      if (command.enabled) this.watched = command.sessionId;
      else if (this.watched === command.sessionId) this.watched = null;
      for (const value of this.sessions.values()) await value.command(command);
      return { terminal: null };
    }
    if (command.type === "close_all") {
      if (this.pending?.sessionId === command.sessionId)
        await this.pending.value.close();
      for (const [id, value] of this.sessions)
        if (value.snapshot(command.sessionId)) {
          await value.close();
          this.sessions.delete(id);
        }
      return { terminal: null, terminals: this.list(command.sessionId) };
    }
    const value = this.sessions.get(command.terminalId);
    if (!value?.snapshot(command.sessionId)) throw new Error("终端标签已失效");
    if (command.type === "remove") {
      await value.close();
      this.sessions.delete(command.terminalId);
      return { terminal: null, terminals: this.list(command.sessionId) };
    }
    const reply = await value.command(command);
    return { ...reply, terminals: this.list(command.sessionId) };
  }
  async close() {
    await this.pending?.value.close();
    await Promise.all(
      [...this.sessions.values()].map((value) => value.close()),
    );
    this.sessions.clear();
    this.selected = undefined;
  }
  stopSync() {
    for (const value of this.sessions.values()) value.stopSync();
  }
}
