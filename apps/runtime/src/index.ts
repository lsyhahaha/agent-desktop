import { RuntimeRequest } from "@protocol";
const port = process.parentPort;
if (!port) throw new Error("Runtime requires an Electron parent port");
port.on("message", ({ data }: { data: unknown }) => {
  const result = RuntimeRequest.safeParse(data);
  if (!result.success) {
    console.warn("[runtime] rejected invalid message");
    return;
  }
  port.postMessage({
    version: 1,
    id: result.data.id,
    type: "runtime.status",
    payload: {
      state: "ready",
      pid: process.pid,
      nodeVersion: process.versions.node,
      uptimeSeconds: process.uptime(),
    },
  });
});
process.on("uncaughtException", (error) => {
  console.error("[runtime] uncaught exception", error);
  process.exit(1);
});
process.on("unhandledRejection", (error) => {
  console.error("[runtime] unhandled rejection", error);
  process.exit(1);
});
