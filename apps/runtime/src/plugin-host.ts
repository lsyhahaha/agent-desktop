import { pathToFileURL } from "node:url";
import {
  HookDecision,
  PluginHostRequest,
  PluginHostResponse,
  PluginManifestV1,
} from "@protocol";

const parent = process.parentPort;
if (!parent) throw new Error("Plugin Host requires parent port");
const entry = process.argv.find((value) => value.startsWith("--entry="))?.slice(8);
const rawManifest = process.argv.find((value) => value.startsWith("--manifest="))?.slice(11);
if (!entry || !rawManifest) throw new Error("Plugin Host requires entry and manifest");
const pluginEntry = entry;
const manifest = PluginManifestV1.parse(JSON.parse(Buffer.from(rawManifest, "base64url").toString("utf8")));

type PluginModule = {
  default?: { handleHook?: (request: unknown) => unknown | Promise<unknown> };
  handleHook?: (request: unknown) => unknown | Promise<unknown>;
};
let handler: ((request: unknown) => unknown | Promise<unknown>) | undefined;
let port: import("electron").MessagePortMain | undefined;

/** 第三方代码只在本进程加载；所有跨进程值返回前再次通过协议校验。 */
async function load() {
  const module = (await import(pathToFileURL(pluginEntry).href)) as PluginModule;
  const candidate = module.default?.handleHook ?? module.handleHook;
  if (typeof candidate !== "function") throw new Error("插件入口必须导出handleHook函数");
  handler = candidate.bind(module.default ?? module);
}

function send(value: unknown) {
  port?.postMessage(PluginHostResponse.parse(value));
}

async function receive(raw: unknown) {
  const request = PluginHostRequest.parse(raw);
  try {
    if (request.type === "shutdown") {
      send({ type: "ready", id: request.id, hooks: manifest.hooks.map((hook) => hook.stage) });
      port?.close();
      setImmediate(() => process.exit(0));
      return;
    }
    if (!handler) await load();
    if (request.type === "probe") {
      if (request.manifest.id !== manifest.id || request.manifest.version !== manifest.version)
        throw new Error("插件清单与启动参数不一致");
      send({ type: "ready", id: request.id, hooks: manifest.hooks.map((hook) => hook.stage) });
      return;
    }
    const declared = manifest.hooks.find((hook) => hook.stage === request.context.stage);
    if (!declared || declared.mode !== request.mode) throw new Error("插件未声明该Hook或模式不一致");
    const execute = handler;
    if (!execute) throw new Error("插件入口尚未加载");
    const decision = HookDecision.parse(await execute(request.context));
    if (request.mode === "observe" && (decision.action === "deny" || decision.patch))
      throw new Error("观察Hook不能拒绝或改写执行");
    if (decision.action === "continue" && decision.patch && decision.patch.stage !== request.context.stage)
      throw new Error("Hook patch阶段不一致");
    send({ type: "result", id: request.id, decision });
  } catch (error) {
    send({
      type: "error",
      id: request.id,
      code: "plugin_hook_failed",
      message: error instanceof Error ? error.message.slice(0, 500) : "插件执行失败",
    });
  }
}

parent.once("message", (event: import("electron").MessageEvent) => {
  const attached = event.ports?.[0];
  if (!attached) throw new Error("Plugin Host requires transferred MessagePort");
  port = attached;
  port.on("message", (message) => void receive(message.data).catch(() => process.exit(1)));
  port.start();
});

process.on("uncaughtException", () => process.exit(1));
process.on("unhandledRejection", () => process.exit(1));
