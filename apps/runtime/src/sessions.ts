import { randomUUID } from "node:crypto";
import {
  ChatCommand,
  type SessionSnapshot,
  type WorkspaceSelection,
  type RuntimeContext,
} from "@protocol";
import type { z } from "zod";
import { Agent } from "./agent";
type Entry = {
  id: string;
  title: string;
  customTitle: boolean;
  taskStatus: "open" | "completed";
  updatedAt: number;
  workspace: WorkspaceSelection;
  agent: Agent;
};

/** 轻量内存会话目录：复用 Agent 保存各自上下文；最多20个有内容的会话，不静默淘汰历史。 */
export class Sessions {
  private entries = new Map<string, Entry>();
  private selected = "";
  private revision = 0;
  constructor(private emit: (snapshot: SessionSnapshot) => void) {
    this.create(null);
  }
  private create(workspace: WorkspaceSelection) {
    const id = randomUUID();
    const entry: Entry = {
      id,
      title: "新任务",
      customTitle: false,
      taskStatus: "open",
      updatedAt: Date.now(),
      workspace,
      agent: new Agent(() => {
        entry.updatedAt = Date.now();
        this.publish();
      }),
    };
    this.entries.set(id, entry);
    this.selected = id;
    return entry;
  }
  private current() {
    const entry = this.entries.get(this.selected);
    if (!entry) throw new Error("当前会话不存在");
    return entry;
  }
  snapshot(): SessionSnapshot {
    const entry = this.current();
    return {
      revision: this.revision,
      sessionId: entry.id,
      taskStatus: entry.taskStatus,
      workspace: entry.workspace,
      chat: entry.agent.snapshot,
      sessions: [...this.entries.values()]
        .filter((e) => e.agent.snapshot.messages.length > 0)
        .map((e) => ({
          id: e.id,
          title: e.title,
          state: e.agent.snapshot.state,
          taskStatus: e.taskStatus,
          workspaceName: e.workspace?.name ?? null,
          updatedAt: e.updatedAt,
        }))
        .sort((a, b) => b.updatedAt - a.updatedAt),
    };
  }
  private publish() {
    this.revision++;
    this.emit(this.snapshot());
  }
  /** 运行中只允许取消或回复当前审批，暂不支持后台并发会话，避免跨会话执行归属混乱。 */
  command(
    raw: unknown,
    context?: z.infer<typeof RuntimeContext>,
    workspace?: WorkspaceSelection,
  ): SessionSnapshot {
    const cmd = ChatCommand.parse(raw);
    const current = this.current();
    if (cmd.type === "snapshot") return this.snapshot();
    if (current.agent.busy() && !["cancel", "approve"].includes(cmd.type))
      throw new Error("请先停止当前任务");
    if (cmd.type === "new") {
      // 重复新建复用空草稿；仅在首次发送后进入侧栏，避免产生大量“新任务”条目。
      const draft = [...this.entries.values()].find(
        (e) => e.agent.snapshot.messages.length === 0,
      );
      if (draft) {
        draft.workspace =
          workspace === undefined ? current.workspace : workspace;
        this.selected = draft.id;
      } else {
        if (this.entries.size >= 20)
          throw new Error("内存会话已达20个上限，请重启应用释放");
        this.create(workspace === undefined ? current.workspace : workspace);
      }
      this.publish();
      return this.snapshot();
    }
    if (cmd.type === "select") {
      if (!this.entries.has(cmd.sessionId)) throw new Error("会话不存在");
      this.selected = cmd.sessionId;
      this.publish();
      return this.snapshot();
    }
    if (cmd.type === "rename") {
      const entry = this.entries.get(cmd.sessionId);
      if (!entry || !entry.agent.snapshot.messages.length)
        throw new Error("会话不存在");
      entry.title = cmd.title;
      entry.customTitle = true;
      this.publish();
      return this.snapshot();
    }
    // 模型stop只表示执行结束；任务完成必须由用户确认，后续追问会重新打开任务。
    if (cmd.type === "complete_task") {
      if (
        cmd.sessionId !== current.id ||
        current.agent.snapshot.state !== "completed"
      )
        throw new Error("仅能确认已结束的当前任务");
      current.taskStatus = "completed";
      this.publish();
      return this.snapshot();
    }
    if (cmd.type === "send") {
      if (cmd.sessionId !== current.id)
        throw new Error("会话已切换，拒绝发送到错误会话");
      if (!context || context.root !== (current.workspace?.path ?? null))
        throw new Error("工作区授权不一致，请重新选择项目");
      current.taskStatus = "open";
      if (!current.customTitle && !current.agent.snapshot.messages.length)
        current.title = cmd.text.split("\n")[0].slice(0, 32) || "新任务";
    }
    current.agent.command(cmd, context);
    this.publish();
    return this.snapshot();
  }
}
