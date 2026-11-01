import { readingStrategy } from "./reading-strategy";
import { checkEvaluation } from "./strategy-evaluation";
import { EvolutionRecord } from "./evolution-record";
import { createHash } from "node:crypto";
import { randomUUID } from "node:crypto";
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
import {
  isEvidenceRecord,
  RUNTIME_DIGEST,
  ChatSnapshot,
  Timeline,
  type TimelineItem,
} from "@protocol";
import { readVersion } from "./edit-file";
import { protectRuntimeDirectory } from "./workspace-path";
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
let version = db.prepare("PRAGMA user_version").get()?.user_version;
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
else if (
  version !== 1 &&
  version !== 2 &&
  version !== 3 &&
  version !== 4 &&
  version !== 5 &&
  version !== 6
)
  throw new Error("Unsupported database schema version");
// v1旧轮次保留空版本，不从工具摘要伪造完整执行历史。
if (version === 0 || version === 1)
  transaction(() =>
    db.exec(`
  ALTER TABLE runs ADD COLUMN timeline_version INTEGER;
  CREATE TABLE timeline_items(run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE, item_id TEXT NOT NULL, position INTEGER NOT NULL, data_json TEXT NOT NULL, PRIMARY KEY(run_id,item_id), UNIQUE(run_id,position)) STRICT;
  PRAGMA user_version=2;
`),
  );
// 会话模式和历史Run模式分列保存；旧数据默认ask，不会自动升级权限。
if (Number(version) <= 3)
  transaction(() =>
    db.exec(
      `ALTER TABLE sessions ADD COLUMN permission_mode TEXT NOT NULL DEFAULT 'ask'; ALTER TABLE runs ADD COLUMN permission_mode TEXT NOT NULL DEFAULT 'ask'; PRAGMA user_version=4;`,
    ),
  );
// v5进化记录独立于Session/Run：清空会话不级联删除项目改进历史。
if (Number(version) <= 4)
  transaction(() =>
    db.exec(`
    CREATE TABLE evolution_records(seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE, project_path TEXT NOT NULL, evolution_key TEXT NOT NULL, created_at REAL NOT NULL, digest TEXT NOT NULL, data_json TEXT NOT NULL, UNIQUE(project_path,evolution_key)) STRICT;
    CREATE INDEX evolution_project_seq ON evolution_records(project_path,seq);
    PRAGMA user_version=5;
  `),
  );
// v6策略启用历史只追加；候选指引来自当前受信任构建，不能从记录注入任意代码或权限。
if (Number(version) <= 5)
  transaction(() =>
    db.exec(`
 CREATE TABLE reading_strategy_selections(seq INTEGER PRIMARY KEY AUTOINCREMENT, project_path TEXT NOT NULL, strategy_id TEXT NOT NULL, strategy_digest TEXT NOT NULL, rationale TEXT NOT NULL, report_json TEXT, created_at REAL NOT NULL) STRICT;
 CREATE INDEX strategy_project_seq ON reading_strategy_selections(project_path,seq);
 CREATE TABLE reading_strategy_evaluations(id TEXT PRIMARY KEY, project_path TEXT NOT NULL, report_json TEXT NOT NULL, digest TEXT NOT NULL, created_at REAL NOT NULL) STRICT;
 PRAGMA user_version=6;
`),
  );
// v3仅多了已停用的日志表；保留现有数据，不创建、不查询、不清空这些表。
protectRuntimeDirectory(dirname(path));

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
    permissionMode: row.permission_mode,
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
    `INSERT INTO sessions(id,title,custom_title,task_status,workspace_json,created_at,updated_at,selected,permission_mode) VALUES (?,?,?,?,?,?,?,1,?) ON CONFLICT(id) DO UPDATE SET title=excluded.title, custom_title=excluded.custom_title, task_status=excluded.task_status, workspace_json=excluded.workspace_json, updated_at=excluded.updated_at, selected=1,permission_mode=excluded.permission_mode`,
  ).run(
    meta.id,
    meta.title,
    Number(meta.customTitle),
    meta.taskStatus,
    json(meta.workspace),
    meta.createdAt,
    meta.updatedAt,
    meta.permissionMode,
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
function itemRows(runId: string) {
  return Timeline.parse(
    db
      .prepare(
        "SELECT data_json FROM timeline_items WHERE run_id=? ORDER BY position LIMIT 129",
      )
      .all(runId)
      .map((row) => parse(row.data_json)),
  );
}
function saveRun(meta: SessionMeta, run: RunCheckpoint) {
  transaction(() => {
    const previous = db
      .prepare("SELECT session_id,revision,state FROM runs WHERE id=?")
      .get(run.runId);
    if (previous && previous.session_id !== meta.id)
      throw new Error("Run ownership mismatch");
    if (previous && Number(previous.revision) > run.revision)
      throw new Error("Stale checkpoint");
    if (
      previous &&
      ["completed", "failed", "cancelled", "interrupted"].includes(
        String(previous.state),
      )
    )
      throw new Error("Terminal run is immutable");
    if (run.context && run.state !== "completed")
      throw new Error("Uncommitted model context");
    saveMeta(meta);
    db.prepare(
      `INSERT INTO runs(id,session_id,model,state,created_at,revision,usage_json,error_json,permission_mode) VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET state=excluded.state,revision=excluded.revision,usage_json=excluded.usage_json,error_json=excluded.error_json`,
    ).run(
      run.runId,
      meta.id,
      run.model,
      run.state,
      run.createdAt,
      run.revision,
      json(run.usage),
      json(run.error),
      run.permissionMode,
    );
    db.prepare("UPDATE runs SET timeline_version=? WHERE id=?").run(
      run.timelineVersion,
      run.runId,
    );
    for (const item of run.items) {
      if (item.runId !== run.runId) throw new Error("Item ownership mismatch");
      db.prepare(
        "INSERT INTO timeline_items VALUES (?,?,?,?) ON CONFLICT(run_id,item_id) DO UPDATE SET data_json=excluded.data_json",
      ).run(run.runId, item.id, item.seq, json(item));
    }
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
async function recover() {
  const rows = db
    .prepare(
      "SELECT r.id,r.session_id,r.permission_mode,s.workspace_json FROM runs r JOIN sessions s ON s.id=r.session_id WHERE r.state IN ('queued','running','waiting_user','waiting_input','waiting_approval')",
    )
    .all();
  // 只核对已记录的写入，不重跑修改；核对失败保持unknown。
  const recovered = new Map<string, TimelineItem[]>();
  for (const row of rows) {
    const items = itemRows(String(row.id));
    for (const item of items) {
      if (item.type === "file_change" && item.data.outcome === "applying") {
        item.data.outcome = "unknown";
        item.status = "unknown";
        try {
          const workspace = SessionMeta.shape.workspace.parse(
            parse(row.workspace_json),
          );
          if (workspace) {
            const current = await readVersion(
              workspace.path,
              item.data.path,
              AbortSignal.timeout(5000),
              row.permission_mode === "full_access" ? "full" : "approved",
            );
            if (current.hash === item.data.targetHash) {
              item.data.outcome = "applied";
              item.status = "completed";
            } else if (current.hash === item.data.baseHash) {
              item.data.outcome = "not_applied";
              item.status = "interrupted";
            }
          }
        } catch {
          /* 无法核对不代表未发生写入。 */
        }
      } else if (["pending", "running"].includes(item.status)) {
        item.status =
          item.type === "tool" && item.data.executionId
            ? "unknown"
            : "interrupted";
        if (item.type === "interaction") item.data.decision = "expired";
      }
      if (
        ["unknown", "interrupted"].includes(item.status) ||
        item.endedAt === null
      ) {
        item.phase = "completed";
        item.updatedAt = Date.now(); /* 真实结束时间未知，不补造endedAt。 */
      }
    }
    recovered.set(String(row.id), items);
  }
  transaction(() => {
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
      for (const item of recovered.get(id) ?? [])
        db.prepare(
          "UPDATE timeline_items SET data_json=? WHERE run_id=? AND item_id=?",
        ).run(json(item), id, item.id);
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
  return {
    count: rows.length,
    runs: rows.slice(0, 100).map((row) => ({
      runId: String(row.id),
      sessionId: String(row.session_id),
    })),
    truncated: rows.length > 100,
  };
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
      runPermissionMode: last?.permission_mode ?? "ask",
      state: last?.state ?? "idle",
      messages,
      items: last ? itemRows(String(last.id)) : [],
      timelineVersion: last?.timeline_version ?? null,
      stopping: false,
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
      timelineVersion: run.timeline_version ?? null,
      permissionMode: run.permission_mode,
      toolCount: Number(
        db
          .prepare("SELECT COUNT(*) AS n FROM tool_calls WHERE run_id=?")
          .get(String(run.id))!.n,
      ),
    })),
  });
}
/** 已存JSON仍重新验证；摘要校验可发现损坏，不把读取成功等同于效果已证实。 */
function evolutionOf(row: Record<string, unknown>) {
  const data = parse(row.data_json);
  if (createHash("sha256").update(json(data)).digest("hex") !== row.digest)
    throw new Error("Evolution record integrity failure");
  return EvolutionRecord.parse({
    id: row.id,
    seq: row.seq,
    createdAt: row.created_at,
    provenance: "developer_recorded",
    digest: row.digest,
    data,
  });
}
parentPort!.on("message", async (raw: unknown) => {
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
      case "strategy_evaluation_append": {
        const body = json(request.report),
          digest = createHash("sha256").update(body).digest("hex");
        transaction(() => {
          const previous = db
            .prepare(
              "SELECT digest FROM reading_strategy_evaluations WHERE id=?",
            )
            .get(request.report.id);
          if (previous) {
            if (previous.digest !== digest)
              throw new RecordNotFound("Evaluation immutable");
            return;
          }
          db.prepare(
            "INSERT INTO reading_strategy_evaluations VALUES (?,?,?,?,?)",
          ).run(
            request.report.id,
            request.report.projectPath,
            body,
            digest,
            Date.now(),
          );
        });
        value = request.report.id;
        break;
      }
      case "strategy_selected": {
        const row = db
          .prepare(
            "SELECT strategy_id,strategy_digest,report_json FROM reading_strategy_selections WHERE project_path=? ORDER BY seq DESC LIMIT 1",
          )
          .get(request.projectPath);
        if (!row) {
          value = "baseline-v1";
          break;
        }
        const policy = readingStrategy(row.strategy_id);
        if (
          policy.digest !== row.strategy_digest ||
          (policy.id !== "baseline-v1" &&
            (!row.report_json ||
              (parse(row.report_json) as { runtimeDigest?: string })
                .runtimeDigest !== RUNTIME_DIGEST))
        ) {
          value = "baseline-v1";
          break;
        }
        value = policy.id;
        break;
      }
      case "strategy_select": {
        const policy = readingStrategy(request.strategyId);
        if (request.strategyId !== "baseline-v1") {
          const report = request.report;
          if (
            !report ||
            report.mode !== "live" ||
            report.runtimeDigest !== RUNTIME_DIGEST ||
            report.projectPath !== request.projectPath ||
            report.candidateId !== policy.id ||
            report.candidateDigest !== policy.digest ||
            report.baselineDigest !== readingStrategy("baseline-v1").digest
          )
            throw new RecordNotFound("Live candidate evidence required");
          try {
            checkEvaluation(report);
          } catch {
            throw new RecordNotFound("Evaluation incomplete or failed");
          }
        }
        transaction(() =>
          db
            .prepare(
              "INSERT INTO reading_strategy_selections(project_path,strategy_id,strategy_digest,rationale,report_json,created_at) VALUES (?,?,?,?,?,?)",
            )
            .run(
              request.projectPath,
              policy.id,
              policy.digest,
              request.rationale,
              request.report ? json(request.report) : null,
              Date.now(),
            ),
        );
        value = policy.id;
        break;
      }
      case "evolution_append": {
        value = transaction(() => {
          const body = json(request.record),
            digest = createHash("sha256").update(body).digest("hex");
          const previous = db
            .prepare(
              "SELECT * FROM evolution_records WHERE project_path=? AND evolution_key=?",
            )
            .get(request.record.projectPath, request.record.key);
          if (previous) {
            if (previous.digest !== digest)
              throw new RecordNotFound(
                "Evolution key content conflict; create a new record",
              );
            return evolutionOf(previous);
          }
          const id = randomUUID(),
            now = Date.now();
          db.prepare(
            "INSERT INTO evolution_records(id,project_path,evolution_key,created_at,digest,data_json) VALUES (?,?,?,?,?,?)",
          ).run(
            id,
            request.record.projectPath,
            request.record.key,
            now,
            digest,
            body,
          );
          return evolutionOf(
            db.prepare("SELECT * FROM evolution_records WHERE id=?").get(id)!,
          );
        });
        break;
      }
      case "evolution_get": {
        const row = db
          .prepare(
            "SELECT * FROM evolution_records WHERE project_path=? AND id=?",
          )
          .get(request.projectPath, request.id);
        if (!row)
          throw new RecordNotFound(
            "Evolution record missing or not owned by project",
          );
        value = evolutionOf(row);
        break;
      }
      case "evolution_page": {
        const rows = db
          .prepare(
            "SELECT * FROM evolution_records WHERE project_path=? AND seq>? ORDER BY seq LIMIT ?",
          )
          .all(request.projectPath, request.after, request.limit + 1);
        const records = rows.slice(0, request.limit).map((row) => {
          const { data, ...record } = evolutionOf(row);
          return { ...record, key: data.key, title: data.title };
        });
        value = {
          records,
          nextCursor: rows.length > request.limit ? records.at(-1)!.seq : null,
        };
        break;
      }
      case "recover":
        value = await recover();
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
      // 唯一允许修改终态的操作仅编辑验收说明，不改执行事实、模型上下文或工具审计。
      case "edit_acceptance": {
        transaction(() => {
          const run = db
            .prepare("SELECT state FROM runs WHERE id=? AND session_id=?")
            .get(request.runId, request.sessionId);
          if (
            !run ||
            !["completed", "failed", "cancelled", "interrupted"].includes(
              String(run.state),
            )
          )
            throw new RecordNotFound("Run not editable");
          const items = itemRows(request.runId);
          let item = items.find(
            (i): i is Extract<TimelineItem, { type: "acceptance" }> =>
              i.type === "acceptance",
          );
          if (!request.conditions && !request.link)
            throw new RecordNotFound("Empty edit");
          if (!item) {
            if (
              request.expectedRevision !== 0 ||
              !request.conditions ||
              items.length >= 128
            )
              throw new RecordNotFound("Acceptance not editable");
            const now = Date.now();
            item = {
              id: randomUUID(),
              runId: request.runId,
              seq: items.length + 1,
              type: "acceptance",
              status: "completed",
              phase: "completed",
              createdAt: now,
              updatedAt: now,
              endedAt: now,
              summary: "验收条件与证据",
              data: {
                revision: 0,
                revisions: [
                  {
                    revision: 0,
                    at: now,
                    source: "user",
                    conditions: request.conditions,
                  },
                ],
                links: [],
              },
            };
            items.push(item);
          } else {
            if (
              item.data.revision !== request.expectedRevision ||
              (request.conditions !== undefined &&
                item.data.revisions.length >= 24)
            )
              throw new RecordNotFound(
                "Acceptance changed or revision limit reached",
              );
            if (request.conditions) {
              const revision = ++item.data.revision;
              item.data.revisions.push({
                revision,
                at: Date.now(),
                source: "user",
                conditions: request.conditions,
              });
            }
          }
          if (request.link) {
            const target = items.find(
              (i) => i.id === request.link!.itemId && i.runId === request.runId,
            );
            if (
              !item.data.revisions
                .at(-1)!
                .conditions.some((c) => c.id === request.link!.conditionId) ||
              !target ||
              !isEvidenceRecord(target) ||
              item.data.links.length >= 48
            )
              throw new RecordNotFound("Invalid evidence reference");
            item.data.links.push({
              ...request.link,
              conditionRevision: item.data.revision,
              source: "user",
              at: Date.now(),
            });
          }
          item.updatedAt = Date.now();
          Timeline.parse(items);
          db.prepare(
            "INSERT INTO timeline_items VALUES (?,?,?,?) ON CONFLICT(run_id,item_id) DO UPDATE SET data_json=excluded.data_json",
          ).run(request.runId, item.id, item.seq, json(item));
          db.prepare(
            "UPDATE runs SET timeline_version=2, revision=revision+1 WHERE id=?",
          ).run(request.runId);
        });
        value = null;
        break;
      }
      case "inspect": {
        const owned = db
          .prepare(
            "SELECT id,timeline_version,permission_mode FROM runs WHERE id=? AND session_id=?",
          )
          .get(request.runId, request.sessionId);
        if (!owned) throw new RecordNotFound("Run not owned by session");
        value = {
          runId: request.runId,
          permissionMode: owned.permission_mode,
          items: itemRows(request.runId),
          timelineVersion: owned.timeline_version ?? null,
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
