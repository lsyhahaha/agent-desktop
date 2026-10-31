import { RuntimeLogs } from "./runtime-log";
import { dirname, join } from "node:path";
import { protectRuntimeDirectory } from "./workspace-path";
import { TerminalManager } from "./terminal";
import { RuntimeRequest, BUILD_ID, PROTOCOL_VERSION } from "@protocol";
import { Sessions } from "./sessions";
import { stopAllCommands } from "./exec-command";
const port = process.parentPort;
if (!port) throw new Error("Runtime requires parent port");
const path = process.argv
  .find((value) => value.startsWith("--database="))
  ?.slice(11);
if (!path) throw new Error("Main must supply the application database path");
const logDirectory = join(dirname(dirname(path)), "logs", "agent-runtime");
protectRuntimeDirectory(logDirectory);
const logs = new RuntimeLogs(logDirectory);
logs.root.event("runtime.started", { nodeVersion: process.versions.node });
console.info("[runtime-log] directory", logDirectory);
const sessions = new Sessions(
  (snapshot) =>
    port.postMessage({ version: 1, type: "agent.snapshot", payload: snapshot }),
  path,
  logs,
);
const terminal = new TerminalManager((snapshot) =>
  port.postMessage({
    version: 1,
    type: "terminal.snapshot",
    payload: snapshot,
  }),
);
process.once("exit", () => terminal.stopSync());
const ready = sessions.initialize();
void ready.catch(() =>
  console.error("[runtime] persistent session initialization failed"),
);
let queue: Promise<unknown> = Promise.resolve();
let closing = false;
port.on("message", ({ data }: { data: unknown }) => {
  const parsed = RuntimeRequest.safeParse(data);
  if (!parsed.success) {
    console.warn("[runtime] invalid request");
    return;
  }
  const request = parsed.data;
  const handle = async () => {
    try {
      await ready;
      if (closing) throw new Error("Runtime closing");
      let payload: unknown;
      if (request.type === "runtime.shutdown") {
        closing = true;
        // 先取消模型/命令，再等待终态落盘和Worker关闭，不能直接exit丢掉最后一次事务。
        logs.root.event("runtime.stopping");
        await terminal.close();
        await sessions.close();
        logs.root.event("runtime.stopped");
        await logs.close();
        stopAllCommands();
        payload = null;
      } else if (request.type === "runtime.ping") {
        payload = {
          protocolVersion: PROTOCOL_VERSION,
          buildId: BUILD_ID,
          state: "ready",
          pid: process.pid,
          nodeVersion: process.versions.node,
          uptimeSeconds: process.uptime(),
        };
      } else if (request.type === "terminal.command") {
        const command = request.command;
        if (command.type === "open") {
          const current = sessions.snapshot();
          if (
            current.sessionId !== command.sessionId ||
            !current.workspace ||
            request.authorizedRoot !== current.workspace.path ||
            !request.profile
          )
            throw new Error("工作区已失效");
          payload = {
            terminal: await terminal.open(
              command.sessionId,
              current.workspace.path,
              command.cols,
              command.rows,
              request.profile!,
            ),
          };
        } else payload = await terminal.command(command);
      } else {
        const before = sessions.snapshot();
        const previousSession = before.sessionId,
          previousRoot = before.workspace?.path;
        payload = await sessions.command(
          request.command,
          request.context,
          request.workspace,
        );
        const after = sessions.snapshot();
        if (
          after.sessionId !== previousSession ||
          after.workspace?.path !== previousRoot
        )
          await terminal.close();
      }
      port.postMessage({
        version: 1,
        id: request.id,
        type: "rpc.result",
        payload,
      });
      if (request.type === "runtime.shutdown")
        setImmediate(() => process.exit(0));
    } catch {
      logs.root.event(
        "rpc.failed",
        {
          requestId: request.id,
          operation: request.type,
          code: "request_failed",
        },
        "error",
      );
      port.postMessage({
        version: 1,
        id: request.id,
        type: "rpc.result",
        error: "操作失败：请检查本地存储、项目路径、配置和会话状态。",
      });
      if (request.type === "runtime.shutdown") {
        stopAllCommands();
        setImmediate(() => process.exit(1));
      }
    }
  };
  // 变更按接纳顺序串行；停止和授权不能排在正在等待磁盘的发送/关闭请求后面。
  if (
    request.type === "runtime.ping" ||
    (request.type === "terminal.command" && request.command.type !== "open") ||
    (request.type === "agent.command" &&
      ["snapshot", "cancel", "approve", "answer"].includes(
        request.command.type,
      ))
  )
    void handle();
  else queue = queue.then(handle, handle);
});
// fatal退出策略仍由Runtime拥有：先清理业务资源，再给日志一个有上限的排空机会。
let fatal = false;
function exitAfterFatal(code: string) {
  if (fatal) {
    process.exit(1);
    return;
  }
  fatal = true;
  logs.root.event("runtime.error", { code }, "error");
  console.error("[runtime] fatal", { code });
  terminal.stopSync();
  stopAllCommands();
  void logs.close().then(
    () => process.exit(1),
    () => process.exit(1),
  );
}
process.on("uncaughtException", () => exitAfterFatal("uncaught_exception"));
process.on("unhandledRejection", () => exitAfterFatal("unhandled_rejection"));
