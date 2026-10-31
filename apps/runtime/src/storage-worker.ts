import { parentPort, workerData } from "node:worker_threads";
import { DatabaseSync } from "node:sqlite";
import {
  mkdirSync,
  openSync,
  closeSync,
  lstatSync,
  chmodSync,
  constants,
} from "node:fs";
import { dirname, isAbsolute } from "node:path";
import { z } from "zod";
import { ChatSnapshot } from "@protocol";
import {
  StorageRequest,
  SessionMeta,
  LoadedSession,
  ToolAudit,
  type RunCheckpoint,
} from "./storage-types";

/** 唯一SQLite连接归此Worker所有。数据库路径只由Main给定，模型、renderer和命令不能指定。 */
const path = z.string().min(1).refine(isAbsolute).parse(workerData.path);
mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
const fd = openSync(
  path,
  constants.O_CREAT | constants.O_RDWR | constants.O_NOFOLLOW,
  0o600,
);
closeSync(fd);
const info = lstatSync(path);
if (!info.isFile() || info.nlink !== 1)
  throw new Error("Invalid database file");
chmodSync(path, 0o600);
const db = new DatabaseSync(path);
db.exec(
  "PRAGMA foreign_keys=ON; PRAGMA busy_timeout=3000; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;",
);
const version = db.prepare("PRAGMA user_version").get()?.user_version;
function transaction<T>(fn: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    try {
      db.exec("ROLLBACK");
    } catch {}
    throw error;
  }
}
if (version === 0)
  transaction(() =>
    db.exec(`
  CREATE TABLE sessions(id TEXT PRIMARY KEY, title TEXT NOT NULL, custom_title INTEGER NOT NULL, task_status TEXT NOT NULL, workspace_json TEXT NOT NULL, created_at REAL NOT NULL, updated_at REAL NOT NULL, selected INTEGER NOT NULL DEFAULT 0) STRICT;
  CREATE UNIQUE INDEX one_selected ON sessions(selected) WHERE selected=1;
  CREATE INDEX sessions_recent ON sessions(updated_at DESC,id DESC);
  CREATE TABLE runs(seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE, session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE, model TEXT NOT NULL, state TEXT NOT NULL, created_at REAL NOT NULL, revision INTEGER NOT NULL, usage_json TEXT NOT NULL, error_json TEXT NOT NULL) STRICT;
  CREATE INDEX runs_session ON runs(session_id,seq);
  CREATE TABLE messages(id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE, run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE, position INTEGER NOT NULL, data_json TEXT NOT NULL, UNIQUE(run_id,position)) STRICT;
  CREATE TABLE tool_calls(run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE, call_id TEXT NOT NULL, position INTEGER NOT NULL, audit_json TEXT NOT NULL, PRIMARY KEY(run_id,call_id)) STRICT;
  CREATE TABLE session_context(session_id TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE, format_version INTEGER NOT NULL, committed_run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE, messages_json TEXT NOT NULL) STRICT;
  PRAGMA user_version=1;
`),
  );
else if (version !== 1) throw new Error("Unsupported database schema version");

const json = (value: unknown) => JSON.stringify(value);
function parse(value: unknown): unknown {
  if (typeof value !== "string" || value.length > 2 * 1024 * 1024)
    throw new Error("Invalid stored JSON");
  return JSON.parse(value);
}
function metaOf(row: Record<string, unknown>): SessionMeta {
  return SessionMeta.parse({
    id: row.id,
    title: row.title,
    customTitle: !!row.custom_title,
    taskStatus: row.task_status,
    workspace: parse(row.workspace_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}
function saveMeta(meta: SessionMeta) {
  db.prepare("UPDATE sessions SET selected=0 WHERE selected=1 AND id<>?").run(
    meta.id,
  );
  db.prepare(
    `INSERT INTO sessions VALUES (?,?,?,?,?,?,?,1) ON CONFLICT(id) DO UPDATE SET title=excluded.title, custom_title=excluded.custom_title, task_status=excluded.task_status, workspace_json=excluded.workspace_json, updated_at=excluded.updated_at, selected=1`,
  ).run(
    meta.id,
    meta.title,
    Number(meta.customTitle),
    meta.taskStatus,
    json(meta.workspace),
    meta.createdAt,
    meta.updatedAt,
  );
}
function auditRows(runId: string) {
  return db
    .prepare(
      "SELECT audit_json FROM tool_calls WHERE run_id=? ORDER BY position LIMIT 13",
    )
    .all(runId)
    .map((row) => ToolAudit.parse(parse(row.audit_json)));
}
function saveRun(meta: SessionMeta, run: RunCheckpoint) {
  transaction(() => {
    const previous = db
      .prepare("SELECT session_id,revision FROM runs WHERE id=?")
      .get(run.runId);
    if (previous && previous.session_id !== meta.id)
      throw new Error("Run ownership mismatch");
    if (previous && Number(previous.revision) > run.revision)
      throw new Error("Stale checkpoint");
    if (run.context && run.state !== "completed")
      throw new Error("Uncommitted model context");
    saveMeta(meta);
    db.prepare(
      `INSERT INTO runs(id,session_id,model,state,created_at,revision,usage_json,error_json) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET state=excluded.state,revision=excluded.revision,usage_json=excluded.usage_json,error_json=excluded.error_json`,
    ).run(
      run.runId,
      meta.id,
      run.model,
      run.state,
      run.createdAt,
      run.revision,
      json(run.usage),
      json(run.error),
    );
    run.messages.forEach((message, index) => {
      if (message.runId !== run.runId)
        throw new Error("Message ownership mismatch");
      db.prepare(
        `INSERT INTO messages VALUES (?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET data_json=excluded.data_json`,
      ).run(message.id, meta.id, run.runId, index, json(message));
    });
    run.tools.forEach((tool, index) =>
      db
        .prepare(
          `INSERT INTO tool_calls VALUES (?,?,?,?) ON CONFLICT(run_id,call_id) DO UPDATE SET audit_json=excluded.audit_json`,
        )
        .run(run.runId, tool.view.id, index, json(tool)),
    );
    if (run.context)
      db.prepare(
        `INSERT INTO session_context VALUES (?,1,?,?) ON CONFLICT(session_id) DO UPDATE SET format_version=1,committed_run_id=excluded.committed_run_id,messages_json=excluded.messages_json`,
      ).run(meta.id, run.runId, json(run.context));
  });
}
/** 冷启动只修复未决状态，保留已知结果；不创建审批Promise、计时器、进程或工具重放。 */
function recover() {
  transaction(() => {
    const rows = db
      .prepare("SELECT id FROM runs WHERE state IN ('running','waiting_user')")
      .all();
    for (const row of rows) {
      const id = String(row.id);
      db.prepare(
        "UPDATE runs SET state='interrupted',error_json=?,usage_json=json_set(usage_json,'$.complete',json('false')) WHERE id=?",
      ).run(
        json({
          code: "process_interrupted",
          message: "上次运行因应用退出而中断；不会自动重跑命令。",
        }),
        id,
      );
      for (const message of db
        .prepare("SELECT id,data_json FROM messages WHERE run_id=?")
        .all(id)) {
        const value = ChatSnapshot.shape.messages.element.parse(
          parse(message.data_json),
        );
        if (value.state === "streaming") {
          value.state = "interrupted";
          db.prepare("UPDATE messages SET data_json=? WHERE id=?").run(
            json(value),
            String(message.id),
          );
        }
      }
      for (const audit of auditRows(id)) {
        if (audit.view.state === "running") {
          audit.view.state = "unknown";
          audit.view.detail = "上次退出前尚未保存最终结果，执行结果未确认";
          if (audit.view.execution) {
            audit.view.execution.status = "unknown";
            audit.view.execution.exit_code = null;
          }
        } else if (audit.view.state === "waiting") {
          audit.view.state = "interrupted";
          audit.view.detail = "上次审批或执行准备已失效";
        }
        if (audit.approval === "pending") audit.approval = "expired";
        db.prepare(
          "UPDATE tool_calls SET audit_json=? WHERE run_id=? AND call_id=?",
        ).run(json(audit), id, audit.view.id);
      }
    }
    return rows.length;
  });
}
class RecordNotFound extends Error {}
function load(id: string) {
  const row = db.prepare("SELECT * FROM sessions WHERE id=?").get(id);
  if (!row) throw new RecordNotFound("Session missing");
  const runs = db
    .prepare("SELECT * FROM runs WHERE session_id=? ORDER BY seq DESC LIMIT 50")
    .all(id)
    .reverse();
  const last = runs.at(-1);
  const messages = runs.flatMap((run) =>
    db
      .prepare(
        "SELECT data_json FROM messages WHERE run_id=? ORDER BY position LIMIT 3",
      )
      .all(String(run.id))
      .map((m) => parse(m.data_json)),
  );
  const context = db
    .prepare("SELECT * FROM session_context WHERE session_id=?")
    .get(id);
  if (context && context.format_version !== 1)
    throw new Error("Unsupported context format");
  return LoadedSession.parse({
    meta: metaOf(row),
    history: context ? parse(context.messages_json) : [],
    chat: {
      revision: last ? last.revision : 0,
      runId: last?.id ?? null,
      state: last?.state ?? "idle",
      messages,
      tools: last ? auditRows(String(last.id)).map((t) => t.view) : [],
      interaction: null,
      usage: last
        ? parse(last.usage_json)
        : { input: 0, output: 0, complete: true },
      error: last ? parse(last.error_json) : null,
    },
    runs: runs.map((run) => ({
      id: run.id,
      state: run.state,
      createdAt: run.created_at,
      toolCount: Number(
        db
          .prepare("SELECT COUNT(*) AS n FROM tool_calls WHERE run_id=?")
          .get(String(run.id))!.n,
      ),
    })),
  });
}
parentPort!.on("message", (raw: unknown) => {
  let id: number | undefined;
  try {
    // 双重校验：限制跨Worker输入大小，数据库所有字符串通过绑定参数传入。
    const envelope = z
      .object({ id: z.number().int().positive(), request: StorageRequest })
      .strict();
    if (JSON.stringify(raw).length > 8 * 1024 * 1024)
      throw new Error("Storage payload too large");
    const parsed = envelope.parse(raw);
    id = parsed.id;
    const request = parsed.request;
    let value: unknown;
    switch (request.op) {
      case "recover":
        value = recover();
        break;
      case "selected":
      case "draft": {
        const row =
          request.op === "selected"
            ? db.prepare("SELECT * FROM sessions WHERE selected=1").get()
            : db
                .prepare(
                  "SELECT * FROM sessions WHERE NOT EXISTS(SELECT 1 FROM runs WHERE session_id=sessions.id) ORDER BY created_at DESC LIMIT 1",
                )
                .get();
        value = row ? metaOf(row) : null;
        break;
      }
      case "meta":
        transaction(() => saveMeta(request.meta));
        value = null;
        break;
      case "rename":
        transaction(() => {
          const exists = db
            .prepare("SELECT id FROM sessions WHERE id=?")
            .get(request.meta.id);
          if (!exists) throw new RecordNotFound("Session missing");
          db.prepare(
            "UPDATE sessions SET title=?,custom_title=1,updated_at=? WHERE id=?",
          ).run(request.meta.title, request.meta.updatedAt, request.meta.id);
        });
        value = null;
        break;
      case "save":
        saveRun(request.meta, request.run);
        value = null;
        break;
      case "load":
        value = load(request.id);
        break;
      case "page": {
        const rows = db
          .prepare(
            `SELECT s.*,COALESCE((SELECT state FROM runs WHERE session_id=s.id ORDER BY seq DESC LIMIT 1),'idle') AS state FROM sessions s WHERE EXISTS(SELECT 1 FROM runs WHERE session_id=s.id) ORDER BY updated_at DESC,id DESC LIMIT 21 OFFSET ?`,
          )
          .all(request.page * 20);
        value = {
          sessions: rows.slice(0, 20).map((row) => ({
            id: row.id,
            title: row.title,
            state: row.state,
            taskStatus: row.task_status,
            workspaceName: metaOf(row).workspace?.name ?? null,
            updatedAt: row.updated_at,
          })),
          hasMore: rows.length > 20,
        };
        break;
      }
      case "inspect": {
        const owned = db
          .prepare("SELECT id FROM runs WHERE id=? AND session_id=?")
          .get(request.runId, request.sessionId);
        if (!owned) throw new RecordNotFound("Run not owned by session");
        value = {
          runId: request.runId,
          tools: auditRows(request.runId).map((t) => t.view),
        };
        break;
      }
      case "clear":
        transaction(() => {
          db.prepare("DELETE FROM session_context WHERE session_id=?").run(
            request.sessionId,
          );
          db.prepare("DELETE FROM runs WHERE session_id=?").run(
            request.sessionId,
          );
          db.prepare("UPDATE sessions SET task_status='open' WHERE id=?").run(
            request.sessionId,
          );
        });
        value = null;
        break;
      case "close":
        db.close();
        parentPort!.postMessage({ id, value: null });
        parentPort!.close();
        return;
    }
    parentPort!.postMessage({ id, value });
  } catch (error) {
    // 只记录错误类别，不记录SQL、参数、源码、输出或密钥。
    console.error("[storage] operation failed", {
      name: error instanceof Error ? error.name : "unknown",
    });
    parentPort!.postMessage({
      id,
      fatal: !(error instanceof RecordNotFound),
      error:
        error instanceof RecordNotFound
          ? "会话或运行记录不存在，请刷新任务列表。"
          : "本地会话存储失败；请检查磁盘空间、文件权限或数据库版本。",
    });
  }
});
