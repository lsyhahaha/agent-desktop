import { nullRunLog, type RuntimeLogs } from "./runtime-log";
import { workspaceChanges } from "./workspace-changes";
import { randomUUID } from "node:crypto";
import { realpath, access } from "node:fs/promises";
import { constants } from "node:fs";
import { dirname } from "node:path";
import { protectRuntimeDirectory } from "./workspace-path";
import {
  ChatCommand,
  type SessionSnapshot,
  type WorkspaceSelection,
  type RuntimeContext,
} from "@protocol";
import type { z } from "zod";
import { Agent } from "./agent";
import { SessionStore } from "./storage";
import { SessionMeta } from "./storage-types";
import type { PluginConnections } from "./hook-pipeline";

type Entry = { meta: SessionMeta; agent: Agent; runs: SessionSnapshot["runs"] };
/** 数据库保留全部会话，内存只加载当前Agent和20条索引；单个时刻仍只运行一个任务。 */
export class Sessions {
  private entry: Entry | undefined;
  private revision = 0;
  private page = 0;
  private query = "";
  private draftText = "";
  private changes: SessionSnapshot["changes"];
  private summaries: SessionSnapshot["sessions"] = [];
  private hasMore = false;
  private inspected: SessionSnapshot["inspectedRun"] = null;
  private storageError: string | null = null;
  private store: SessionStore;
  constructor(
    private emit: (snapshot: SessionSnapshot) => void,
    private readonly databasePath: string,
    private readonly logs?: RuntimeLogs,
    private readonly plugins?: PluginConnections,
  ) {
    this.store = new SessionStore(databasePath, (message) => {
      this.storageError = message;
      this.entry?.agent.storageFailed();
      if (this.entry) this.publish();
    });
  }
  async initialize() {
    this.logs?.root.event("recovery.started");
    const recovery = await this.store.recover();
    for (const run of recovery.runs)
      this.logs?.root.event(
        "run.interrupted",
        {
          sessionId: run.sessionId,
          runId: run.runId,
          state: "interrupted",
          reason: "process_interrupted",
        },
        "warn",
      );
    this.logs?.root.event("recovery.completed", {
      count: recovery.count,
      truncated: recovery.truncated,
    });
    protectRuntimeDirectory(await realpath(dirname(this.databasePath)));
    const selected = await this.store.selected();
    await this.activate(selected ?? this.makeMeta(null));
    await this.refresh();
    this.publish();
  }
  private makeMeta(workspace: WorkspaceSelection): SessionMeta {
    const now = Date.now();
    return {
      id: randomUUID(),
      title: "新任务",
      customTitle: false,
      permissionMode: "ask",
      taskStatus: "open",
      workspace,
      createdAt: now,
      updatedAt: now,
    };
  }
  private async activate(meta: SessionMeta) {
    // 先落盘选择状态，再读取；上一次会话必须已空闲，不能让后台写入改变当前选择。
    await this.store.request({ op: "meta", meta });
    const loaded = await this.store.load(meta.id);
    const entry: Entry = {
      meta: loaded.meta,
      runs: loaded.runs,
      agent: undefined!,
    };
    entry.agent = new Agent(
      () => {
        this.updateSummary(entry);
        this.publish();
      },
      async (run) => {
        await this.store.request({ op: "save", meta: entry.meta, run });
        const summary = {
          id: run.runId,
          state: run.state,
          toolCount: run.tools.length,
          permissionMode: run.permissionMode,
          createdAt: run.createdAt,
          timelineVersion: run.timelineVersion,
        };
        const index = entry.runs.findIndex((r) => r.id === run.runId);
        if (index < 0) entry.runs.push(summary);
        else entry.runs[index] = summary;
      },
      (runId, secrets) =>
        this.logs?.run(entry.meta.id, runId, secrets) ?? nullRunLog,
      this.plugins,
    );
    entry.agent.restore(loaded.chat, loaded.history);
    this.draftText = String(await this.store.request({ op: "get_draft", sessionId: meta.id }));
    this.changes = undefined;
    this.entry = entry;
    this.inspected = null;
  }
  private current() {
    if (!this.entry) throw new Error("会话存储尚未就绪");
    return this.entry;
  }
  private updateSummary(entry: Entry) {
    const summary = this.summaries.find((s) => s.id === entry.meta.id);
    if (summary) {
      summary.state = entry.agent.view().state;
      summary.taskStatus = entry.meta.taskStatus;
    }
  }
  private async refresh() {
    const data = await this.store.page(this.page, this.current().meta.workspace, this.query);
    this.summaries = data.sessions;
    this.hasMore = data.hasMore;
    if (this.entry) this.updateSummary(this.entry);
  }
  snapshot(): SessionSnapshot {
    const entry = this.current();
    return {
      revision: this.revision,
      sessionId: entry.meta.id,
      title: entry.meta.title,
      taskStatus: entry.meta.taskStatus,
      permissionMode: entry.meta.permissionMode,
      workspace: entry.meta.workspace,
      changes: this.changes,
      draft: this.draftText,
      sessionPage: this.page,
      hasMoreSessions: this.hasMore,
      storageError: this.storageError,
      runs: entry.runs,
      inspectedRun: this.inspected,
      chat: entry.agent.view(),
      sessions: this.summaries,
    };
  }
  private publish() {
    this.revision++;
    this.emit(this.snapshot());
  }
  /** Runtime串行接纳变更；取消/审批绕过存储等待，防止磁盘慢时停止按钮失效。 */
  async command(
    raw: unknown,
    context?: z.infer<typeof RuntimeContext>,
    workspace?: WorkspaceSelection,
  ): Promise<SessionSnapshot> {
    const cmd = ChatCommand.parse(raw),
      current = this.current();
    if (cmd.type === "snapshot") return this.snapshot();
    if (
      cmd.type === "cancel" ||
      cmd.type === "approve" ||
      cmd.type === "answer"
    ) {
      if (cmd.sessionId !== current.meta.id) throw new Error("会话已切换");
      await current.agent.command(cmd);
      return this.snapshot();
    }
    if (this.storageError) throw new Error(this.storageError);
    if (cmd.type === "save_draft") {
      if (cmd.sessionId !== current.meta.id) throw new Error("会话已切换，草稿尚未保存");
      await this.store.request({ op: "save_draft", sessionId: cmd.sessionId, text: cmd.text });
      this.draftText = cmd.text;
      await this.refresh();
      this.publish();
      return this.snapshot();
    }
    if (cmd.type === "workspace_changes") {
      if (cmd.sessionId !== current.meta.id || !current.meta.workspace) throw new Error("请先选择项目");
      if (current.agent.busy()) throw new Error("请等待执行结束后刷新改动");
      this.changes = await workspaceChanges(current.meta.workspace.path, cmd.path);
      this.publish(); return this.snapshot();
    }
    if (cmd.type === "inspect_run") {
      if (cmd.sessionId !== current.meta.id) throw new Error("会话已切换");
      this.inspected =
        cmd.runId === current.agent.snapshot.runId
          ? {
              runId: cmd.runId,
              permissionMode: current.agent.snapshot.runPermissionMode,
              tools: structuredClone(current.agent.view().tools),
              items: structuredClone(current.agent.view().items),
              timelineVersion: current.agent.view().timelineVersion,
            }
          : await this.store.inspect(cmd.sessionId, cmd.runId);
      this.publish();
      return this.snapshot();
    }
    if (current.agent.busy()) throw new Error("请先停止当前任务");
    if (cmd.type === "edit_acceptance") {
      if (cmd.sessionId !== current.meta.id) throw new Error("会话已变化");
      await this.store.request({
        op: "edit_acceptance",
        sessionId: cmd.sessionId,
        runId: cmd.runId,
        expectedRevision: cmd.expectedRevision,
        conditions: cmd.conditions,
        link: cmd.link,
      });
      // 先事务提交，再重新读取权威投影；不复用结束Agent里已经封存的写队列。
      await this.activate(current.meta);
      this.inspected = await this.store.inspect(cmd.sessionId, cmd.runId);
      this.publish();
      return this.snapshot();
    }
    if (cmd.type === "set_permission") {
      if (cmd.sessionId !== current.meta.id) throw new Error("会话已变化");
      const meta = {
        ...current.meta,
        permissionMode: cmd.mode,
        updatedAt: Date.now(),
      };
      await this.store.request({ op: "meta", meta });
      current.meta = meta;
      this.logs?.root.event("permission.changed", {
        sessionId: meta.id,
        permissionMode: cmd.mode,
      });
      this.publish();
      return this.snapshot();
    }
    if (cmd.type === "list_sessions") {
      this.page = cmd.page;
      if (cmd.query !== undefined) this.query = cmd.query;
      await this.refresh();
      this.publish();
      return this.snapshot();
    }
    if (cmd.type === "new" || cmd.type === "no_project") {
      if (cmd.type === "no_project") workspace = null;
      // Main原生项目选择携带workspace，优先恢复该项目最近任务。
      const target = workspace === undefined ? current.meta.workspace : workspace;
      if (workspace !== undefined) {
        const recent = await this.store.request({ op: "project_recent", workspace });
        if (recent) {
          await this.activate(SessionMeta.parse(recent));
          this.page = 0; this.query = "";
          await this.refresh(); this.publish(); return this.snapshot();
        }
      }
      const draft = await this.store.draft(target);
      const meta =
        draft ??
        this.makeMeta(
          workspace === undefined ? current.meta.workspace : workspace,
        );
      meta.workspace =
        workspace === undefined ? current.meta.workspace : workspace;
      meta.permissionMode = "ask";
      await this.activate(meta);
      this.page = 0;
      await this.refresh();
      this.publish();
      return this.snapshot();
    }
    if (cmd.type === "select") {
      const loaded = await this.store.load(cmd.sessionId);
      await this.activate(loaded.meta);
      this.page = 0; this.query = "";
      await this.refresh();
      this.publish();
      return this.snapshot();
    }
    if (cmd.type === "rename") {
      const meta =
        cmd.sessionId === current.meta.id
          ? { ...current.meta }
          : (await this.store.load(cmd.sessionId)).meta;
      meta.title = cmd.title;
      meta.customTitle = true;
      meta.updatedAt = Date.now();
      // 修改目标任务的元数据，不改变数据库里当前选中的会话。
      await this.store.request({ op: "rename", meta });
      if (meta.id === current.meta.id) current.meta = meta;
      await this.refresh();
      this.publish();
      return this.snapshot();
    }
    if (cmd.type === "complete_task") {
      if (
        cmd.sessionId !== current.meta.id ||
        current.agent.snapshot.state !== "completed"
      )
        throw new Error("仅能确认已结束的当前任务");
      const meta = {
        ...current.meta,
        taskStatus: "completed" as const,
        updatedAt: Date.now(),
      };
      await this.store.request({ op: "meta", meta });
      current.meta = meta;
      await this.refresh();
      this.publish();
      return this.snapshot();
    }
    if (cmd.type === "clear") {
      await this.store.request({ op: "clear", sessionId: current.meta.id });
      current.meta.taskStatus = "open";
      await current.agent.command(cmd);
      current.runs = [];
      this.inspected = null;
      current.meta.taskStatus = "open";
      await this.store.request({ op: "meta", meta: current.meta });
      await this.refresh();
      this.publish();
      return this.snapshot();
    }
    if (cmd.type === "send") {
      if (
        cmd.sessionId !== current.meta.id ||
        !context ||
        context.root !== (current.meta.workspace?.path ?? null)
      )
        throw new Error("会话或工作区授权不一致");
      if (context.root) {
        if ((await realpath(context.root)) !== context.root)
          throw new Error("项目目录身份已变化，请重新选择工作区");
        await access(context.root, constants.R_OK);
      }
      current.meta.taskStatus = "open";
      current.meta.updatedAt = Date.now();
      if (!current.meta.customTitle && !current.agent.snapshot.messages.length)
        current.meta.title = Array.from(cmd.text.split(/\r?\n/).find((line) => line.trim())?.trim() ?? "新任务").slice(0, 32).join("");
      await current.agent.command(cmd, {
        ...context,
        permissionMode: context.evaluationOnly
          ? "ask"
          : current.meta.permissionMode,
        readingStrategyId:
          context.readingStrategyId ??
          (context.root
            ? await this.store.selectedReadingStrategy(context.root)
            : "baseline-v1"),
      });
      this.page = 0;
      await this.refresh();
      this.publish();
      return this.snapshot();
    }
    throw new Error("不支持的会话命令");
  }
  async close() {
    if (this.entry) {
      this.entry.agent.cancel();
      await this.entry.agent.waitForIdle();
    }
    await this.store.close();
  }
}
