import { RuntimeRequest } from "@protocol";
import { Sessions } from "./sessions";
const port = process.parentPort;
if (!port) throw new Error("Runtime requires parent port");
const sessions = new Sessions((snapshot) =>
  port.postMessage({ version: 1, type: "agent.snapshot", payload: snapshot }),
);
port.on("message", ({ data }: { data: unknown }) => {
  const parsed = RuntimeRequest.safeParse(data);
  if (!parsed.success) {
    console.warn("[runtime] invalid request");
    return;
  }
  const request = parsed.data;
  try {
    const payload =
      request.type === "runtime.ping"
        ? {
            state: "ready",
            pid: process.pid,
            nodeVersion: process.versions.node,
            uptimeSeconds: process.uptime(),
          }
        : sessions.command(request.command, request.context, request.workspace);
    port.postMessage({
      version: 1,
      id: request.id,
      type: "rpc.result",
      payload,
    });
  } catch {
    port.postMessage({
      version: 1,
      id: request.id,
      type: "rpc.result",
      error: "操作被拒绝：请确认配置、会话状态和输入上限",
    });
  }
});
process.on("uncaughtException", () => {
  console.error("[runtime] uncaught exception");
  process.exit(1);
});
process.on("unhandledRejection", () => {
  console.error("[runtime] unhandled rejection");
  process.exit(1);
});
