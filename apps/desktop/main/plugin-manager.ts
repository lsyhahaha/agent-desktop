import { app, MessageChannelMain, utilityProcess, type UtilityProcess } from "electron";
import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import {
  access,
  chmod,
  cp,
  lstat,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import {
  InstalledPlugin,
  PluginHostResponse,
  PluginManifestV1,
  PluginList,
  type InstalledPlugin as Plugin,
  type PluginCommand,
} from "@protocol";
import type { RuntimeHost } from "./runtime";
import { z } from "zod";

const Registry = z.object({ plugins: z.array(InstalledPlugin).max(64) }).strict();
type Host = { child: UtilityProcess; plugin: Plugin };

/** 插件安装与进程监督属于Main；不会把源目录路径或任意文件接口交给renderer。 */
export class PluginManager {
  private plugins: Plugin[] = [];
  private hosts = new Map<string, Host>();
  private saving = false;
  constructor(
    private readonly directory: string,
    private readonly hostEntry: string,
    private readonly runtime: RuntimeHost,
    private readonly active: () => boolean,
  ) {
    runtime.setPluginStatusHandler((value) => {
      void this.handleRuntimeStatus(value);
    });
  }
  private get registryPath() { return join(this.directory, "registry.json"); }
  private get packagesPath() { return join(this.directory, "packages"); }

  /** 启动时校验注册表和安装摘要；损坏插件会被禁用，不加载未经确认的代码。 */
  async load() {
    await mkdir(this.packagesPath, { recursive: true, mode: 0o700 });
    try {
      this.plugins = Registry.parse(JSON.parse((await readFile(this.registryPath)).toString())).plugins;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw new Error("插件注册表损坏");
    }
    for (const plugin of this.plugins) {
      try {
        const scanned = await scanPlugin(join(this.packagesPath, plugin.manifest.id));
        if (
          scanned.digest !== plugin.digest ||
          scanned.manifest.id !== plugin.manifest.id ||
          scanned.manifest.version !== plugin.manifest.version
        )
          throw new Error("插件安装内容与注册摘要不一致");
      } catch (error) {
        plugin.enabled = false;
        plugin.status = "failed";
        plugin.lastError = error instanceof Error ? error.message.slice(0, 500) : "插件完整性检查失败";
      }
    }
    await this.restartEnabled();
  }
  /** 返回renderer可见的脱敏投影，不暴露安装路径、进程句柄或Hook端口。 */
  view() { return PluginList.parse({ plugins: this.plugins, activeRun: this.active() }); }

  /** 扫描、复制、复扫并探针验证后原子切换；任一步失败都不更新注册表。 */
  async install(source: string) {
    this.assertMutable();
    const previousPlugins = structuredClone(this.plugins);
    const sourceScan = await scanPlugin(source);
    const duplicate = this.plugins.find((item) => item.manifest.id.toLowerCase() === sourceScan.manifest.id.toLowerCase());
    const staging = join(this.directory, `.install-${randomUUID()}`);
    const target = join(this.packagesPath, sourceScan.manifest.id);
    let committed = false;
    let movedOld = false;
    try {
      await cp(source, staging, { recursive: true, errorOnExist: true, force: false, verbatimSymlinks: true });
      // 复制后重新扫描，关闭源目录在检查与复制之间变化的TOCTOU窗口。
      const scanned = await scanPlugin(staging);
      if (scanned.digest !== sourceScan.digest) throw new Error("插件来源在安装期间发生变化，请重试");
      await this.probe(staging, scanned.manifest);
      await rm(target + ".old", { recursive: true, force: true });
      try {
        await rename(target, target + ".old");
        movedOld = true;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      await rename(staging, target);
      const next: Plugin = {
        manifest: scanned.manifest,
        digest: scanned.digest,
        enabled: duplicate?.enabled ?? false,
        order: duplicate?.order ?? this.plugins.length,
        status: "disabled",
        lastError: null,
      };
      this.plugins = duplicate
        ? this.plugins.map((item) => item.manifest.id === duplicate.manifest.id ? next : item)
        : [...this.plugins, next];
      await this.save();
      committed = true;
      await rm(target + ".old", { recursive: true, force: true }).catch(() => {
        console.warn("[plugin] old package cleanup failed", { id: scanned.manifest.id });
      });
      if (next.enabled) {
        try { await this.start(next); }
        catch (error) {
          next.status = "failed";
          next.lastError = error instanceof Error ? error.message.slice(0, 500) : "插件启动失败";
          await this.save();
        }
      }
    } catch (error) {
      await rm(staging, { recursive: true, force: true });
      if (!committed) {
        this.plugins = previousPlugins;
        if (movedOld) {
          try {
            await rm(target, { recursive: true, force: true });
            await rename(target + ".old", target);
          } catch (rollbackError) {
            console.error("[plugin] install rollback failed", { id: sourceScan.manifest.id });
            throw new AggregateError(
              [error, rollbackError],
              "插件安装失败，且旧版本目录恢复失败；请检查应用插件目录",
            );
          }
        } else {
          await rm(target, { recursive: true, force: true }).catch((cleanupError) => {
            console.error("[plugin] failed install cleanup failed", { id: sourceScan.manifest.id });
            throw new AggregateError([error, cleanupError], "插件安装失败，且新目录清理失败");
          });
        }
      }
      throw error;
    }
    return this.view();
  }

  /** 管理命令只在无活跃Run时接纳；启用失败会回滚enabled并保存错误状态。 */
  async command(command: PluginCommand) {
    if (command.type === "list") return this.view();
    if (command.type === "install") throw new Error("安装必须通过原生目录选择入口");
    this.assertMutable();
    const index = this.plugins.findIndex((item) => item.manifest.id === command.id);
    if (index < 0) throw new Error("插件不存在");
    if (command.type === "set_enabled") {
      const plugin = this.plugins[index];
      if (command.enabled && !plugin.enabled && this.plugins.filter((item) => item.enabled).length >= 8)
        throw new Error("最多同时启用8个插件");
      plugin.enabled = command.enabled;
      plugin.lastError = null;
      if (command.enabled) {
        try { await this.start(plugin); }
        catch (error) {
          await this.stop(plugin.manifest.id);
          plugin.enabled = false;
          plugin.status = "failed";
          plugin.lastError = error instanceof Error ? error.message.slice(0, 500) : "插件启动失败";
        }
      } else await this.stop(plugin.manifest.id);
    } else if (command.type === "move") {
      const target = command.direction === "up" ? index - 1 : index + 1;
      if (target >= 0 && target < this.plugins.length)
        [this.plugins[index], this.plugins[target]] = [this.plugins[target], this.plugins[index]];
      this.plugins.forEach((item, order) => (item.order = order));
      await this.restartEnabled();
    } else {
      if (this.plugins[index].enabled) throw new Error("请先停用插件");
      await this.stop(command.id);
      await rm(join(this.packagesPath, command.id), { recursive: true, force: true });
      this.plugins.splice(index, 1);
      this.plugins.forEach((item, order) => (item.order = order));
    }
    await this.save();
    return this.view();
  }

  /** 应用退出前请求全部宿主进程结束，并有界等待exit；超时不会伪报已清理。 */
  async close() {
    await Promise.all([...this.hosts.keys()].map((id) => this.stop(id)));
  }
  private assertMutable() {
    if (this.active()) throw new Error("运行期间不能更改插件");
  }
  /** Runtime禁用连接后同步停用配置并结束Host，避免重启时自动重新加载失败插件。 */
  private async handleRuntimeStatus(value: { id: string; status: "failed" | "disabled"; error: string }) {
    const plugin = this.plugins.find((item) => item.manifest.id === value.id);
    if (!plugin) return;
    plugin.enabled = false;
    await this.stop(value.id);
    plugin.status = value.status;
    plugin.lastError = value.error;
    await this.save().catch(() => console.warn("[plugin] failed to persist runtime status", { id: value.id }));
  }
  private async save() {
    if (this.saving) throw new Error("插件配置正在保存");
    this.saving = true;
    try {
      const temporary = this.registryPath + ".tmp";
      await writeFile(temporary, JSON.stringify({ plugins: this.plugins }), { mode: 0o600 });
      await chmod(temporary, 0o600);
      await rename(temporary, this.registryPath);
    } finally { this.saving = false; }
  }
  private async restartEnabled() {
    await Promise.all([...this.hosts.keys()].map((id) => this.stop(id)));
    for (const plugin of this.plugins.filter((item) => item.enabled).sort((a, b) => a.order - b.order).slice(0, 8)) {
      try { await this.start(plugin); }
      catch (error) {
        plugin.status = "failed";
        plugin.lastError = error instanceof Error ? error.message.slice(0, 500) : "插件启动失败";
      }
    }
    await this.save();
  }
  private spawn(directory: string, manifest: Plugin["manifest"]) {
    const entry = resolve(directory, manifest.entry);
    return utilityProcess.fork(
      this.hostEntry,
      [`--entry=${entry}`, `--manifest=${Buffer.from(JSON.stringify(manifest)).toString("base64url")}`],
      {
        cwd: directory,
        env: { PATH: "/usr/bin:/bin:/usr/sbin:/sbin", NODE_ENV: app.isPackaged ? "production" : "development" },
        stdio: "pipe",
        serviceName: `Agent Desktop Plugin: ${manifest.name}`,
        ...(process.platform === "darwin" ? { disclaim: true } : {}),
      },
    );
  }
  private async probe(directory: string, manifest: Plugin["manifest"]) {
    const child = this.spawn(directory, manifest);
    const { port1, port2 } = new MessageChannelMain();
    child.postMessage({ type: "attach" }, [port1]);
    const id = randomUUID();
    let diagnostic = "";
    child.stderr?.on("data", (chunk: Buffer) => {
      diagnostic = (diagnostic + chunk.toString()).slice(-500);
    });
    try {
      await new Promise<void>((resolveProbe, reject) => {
        let settled = false;
        const finish = (error?: Error) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          error ? reject(error) : resolveProbe();
        };
        const timer = setTimeout(
          () => finish(new Error(diagnostic ? `插件启动探针超时：${diagnostic}` : "插件启动探针超时")),
          3000,
        );
        child.once("exit", (code) =>
          finish(new Error(diagnostic ? `插件探针进程退出（${code}）：${diagnostic}` : `插件探针进程退出（${code}）`)),
        );
        port2.on("message", ({ data }) => {
          const response = PluginHostResponse.safeParse(data);
          if (!response.success || response.data.id !== id) return;
          response.data.type === "ready" ? finish() : finish(new Error("插件启动探针失败"));
        });
        port2.start();
        port2.postMessage({ type: "probe", id, manifest });
      });
    } finally {
      port2.close();
      await terminateUtility(child);
    }
  }
  private async start(plugin: Plugin) {
    await this.stop(plugin.manifest.id);
    plugin.status = "starting";
    const directory = join(this.packagesPath, plugin.manifest.id);
    const child = this.spawn(directory, plugin.manifest);
    const { port1, port2 } = new MessageChannelMain();
    child.postMessage({ type: "attach" }, [port1]);
    child.on("exit", (code) => {
      if (this.hosts.get(plugin.manifest.id)?.child !== child) return;
      this.hosts.delete(plugin.manifest.id);
      plugin.status = "failed";
      plugin.lastError = `插件进程退出（${code}）`;
      void this.save().catch(() => {});
    });
    child.stderr?.on("data", () => {});
    child.stdout?.on("data", () => {});
    try {
      await this.runtime.attachPlugin({
        id: plugin.manifest.id,
        name: plugin.manifest.name,
        version: plugin.manifest.version,
        digest: plugin.digest,
        hooks: plugin.manifest.hooks,
        order: plugin.order,
      }, port2);
    } catch (error) {
      port2.close();
      await terminateUtility(child);
      throw error;
    }
    this.hosts.set(plugin.manifest.id, { child, plugin });
    plugin.status = "ready";
    plugin.lastError = null;
  }
  /** kill在POSIX只发送SIGTERM，因此必须等待实际exit后才完成生命周期结算。 */
  private async stop(id: string) {
    const host = this.hosts.get(id);
    if (!host) return;
    this.hosts.delete(id);
    const confirmed = await terminateUtility(
      host.child,
      () => this.runtime.detachPlugin(id).then(() => undefined),
    );
    host.plugin.status = confirmed ? "disabled" : "failed";
    if (!confirmed) host.plugin.lastError = "插件进程未在终止时限内确认退出";
  }
}

/** Electron的kill只承诺发送终止信号；调用者必须根据真实exit决定是否完成清理。 */
async function terminateUtility(
  child: UtilityProcess,
  graceful?: () => Promise<void>,
): Promise<boolean> {
  const waitForExit = (timeout: number) => {
    if (child.pid === undefined) return Promise.resolve(true);
    return new Promise<boolean>((resolveExit) => {
      let timer: ReturnType<typeof setTimeout>;
      const done = () => { clearTimeout(timer); resolveExit(true); };
      child.once("exit", done);
      timer = setTimeout(() => {
        child.removeListener("exit", done);
        resolveExit(false);
      }, timeout);
    });
  };
  if (graceful) {
    const exited = waitForExit(500);
    await graceful().catch(() => {});
    if (await exited) return true;
  }
  const pid = child.pid;
  const terminated = waitForExit(1500);
  child.kill();
  if (await terminated) return true;
  if (pid && child.pid === pid) {
    try { process.kill(pid, "SIGKILL"); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
    }
  }
  return waitForExit(1000);
}

async function scanPlugin(source: string) {
  const root = await lstat(source);
  if (!root.isDirectory() || root.isSymbolicLink()) throw new Error("插件来源必须是普通目录");
  const manifest = PluginManifestV1.parse(JSON.parse((await readFile(join(source, "manifest.json"))).toString()));
  let count = 0, total = 0;
  const hash = createHash("sha256");
  async function walk(directory: string) {
    for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = join(directory, entry.name), rel = relative(source, path);
      if (!rel || rel.startsWith(".." + sep) || rel.includes("\0")) throw new Error("插件路径非法");
      if (entry.isSymbolicLink()) throw new Error("插件不能包含符号链接");
      if (entry.isDirectory()) { await walk(path); continue; }
      if (!entry.isFile()) throw new Error("插件只能包含普通文件");
      const stat = await lstat(path);
      if (++count > 256 || stat.size > 10 * 1024 * 1024 || (total += stat.size) > 20 * 1024 * 1024)
        throw new Error("插件超过文件数量或大小限制");
      hash.update(rel).update("\0").update(await readFile(path)).update("\0");
    }
  }
  await walk(source);
  const entry = resolve(source, manifest.entry);
  if (!entry.startsWith(resolve(source) + sep)) throw new Error("插件入口逃逸来源目录");
  await access(entry, constants.R_OK);
  return { manifest, digest: hash.digest("hex") };
}
