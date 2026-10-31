import { RuntimeRequest, BUILD_ID, PROTOCOL_VERSION } from "@protocol";
import { Sessions } from "./sessions";
import { stopAllCommands } from "./exec-command";
const port = process.parentPort;
if (!port) throw new Error("Runtime requires parent port");
const path = process.argv
  .find((value) => value.startsWith("--database="))
  ?.slice(11);
if (!path) throw new Error("Main must supply the application database path");
const sessions = new Sessions(
  (snapshot) =>
    port.postMessage({ version: 1, type: "agent.snapshot", payload: snapshot }),
  path,
);
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
        await sessions.close();
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
      } else
        payload = await sessions.command(
          request.command,
          request.context,
          request.workspace,
        );
      port.postMessage({
        version: 1,
        id: request.id,
        type: "rpc.result",
        payload,
      });
      if (request.type === "runtime.shutdown")
        setImmediate(() => process.exit(0));
    } catch {
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
    (request.type === "agent.command" &&
      ["snapshot", "cancel", "approve", "answer"].includes(request.command.type))
  )
    void handle();
  else queue = queue.then(handle, handle);
});
process.on("uncaughtException", () => {
  console.error("[runtime] uncaught exception");
  stopAllCommands();
  process.exit(1);
});
process.on("unhandledRejection", () => {
  console.error("[runtime] unhandled rejection");
  stopAllCommands();
  process.exit(1);
});
