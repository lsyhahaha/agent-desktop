import { useCallback, useEffect, useState } from "react";
import type { PluginList } from "@protocol";

interface Props { active: boolean }

/** 插件页只调用窄桥接；目录选择、文件复制与进程启动均由Main持有。 */
export function PluginSettingsPage({ active }: Props) {
  const [data, setData] = useState<PluginList | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    try { setData(await window.desktop.plugins({ type: "list" })); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "插件状态加载失败"); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  async function command(value: Parameters<typeof window.desktop.plugins>[0]) {
    if (busy || active) return;
    setBusy(true); setError("");
    try { setData(await window.desktop.plugins(value)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "插件操作失败"); }
    finally { setBusy(false); }
  }
  return (
    <section className="settings-page plugin-settings" aria-labelledby="plugins-heading">
      <header className="page-heading">
        <h1 id="plugins-heading">本地插件</h1>
        <p>安装受信任的本地中间件，观察或改写 Run、模型与工具生命周期。</p>
      </header>
      <div className="plugin-warning" role="note">
        <strong>本地插件是可执行代码，不是安全沙箱。</strong>
        <span>插件进程不会收到模型 API Key，也不能提高 Agent 权限；但插件自身仍可能以当前用户身份访问文件或网络。</span>
      </div>
      <div className="plugin-toolbar">
        <button className="primary" disabled={active || busy} onClick={() => void command({ type: "install" })}>
          {busy ? "处理中…" : "安装或更新插件"}
        </button>
        {active && <span className="inline-note">当前任务运行中，仅可查看；停止后才能更改插件。</span>}
      </div>
      {error && <p className="error" role="alert">{error}</p>}
      {!data ? (
        <p className="plugin-empty">正在加载插件…</p>
      ) : !data.plugins.length ? (
        <div className="plugin-empty"><strong>尚未安装插件</strong><span>请选择包含 manifest.json 和已构建 ESM 入口的本地目录。</span></div>
      ) : (
        <div className="plugin-list">
          {data.plugins.sort((a, b) => a.order - b.order).map((plugin, index) => (
            <article className="plugin-card" key={plugin.manifest.id}>
              <header>
                <div><h2>{plugin.manifest.name}</h2><code>{plugin.manifest.id}</code></div>
                <span className={`plugin-status ${plugin.status}`}>{statusLabel(plugin.status)}</span>
              </header>
              <p>版本 {plugin.manifest.version} · API v{plugin.manifest.runtimeApiVersion}</p>
              <div className="plugin-hooks" aria-label="声明的Hook">
                {plugin.manifest.hooks.map((hook) => <span key={hook.stage}>{hook.stage} · {hook.mode === "mutate" ? "可改写" : "只观察"}</span>)}
              </div>
              {plugin.lastError && <p className="error">{plugin.lastError}</p>}
              <footer>
                <button disabled={active || busy || index === 0} onClick={() => void command({ type: "move", id: plugin.manifest.id, direction: "up" })}>上移</button>
                <button disabled={active || busy || index === data.plugins.length - 1} onClick={() => void command({ type: "move", id: plugin.manifest.id, direction: "down" })}>下移</button>
                <button disabled={active || busy} onClick={() => void command({ type: "set_enabled", id: plugin.manifest.id, enabled: !plugin.enabled })}>{plugin.enabled ? "停用" : "启用"}</button>
                <button className="danger" disabled={active || busy || plugin.enabled} onClick={() => void command({ type: "remove", id: plugin.manifest.id })}>卸载</button>
              </footer>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function statusLabel(status: PluginList["plugins"][number]["status"]) {
  return ({ disabled: "已停用", starting: "正在启动", ready: "已启用", failed: "运行失败", incompatible: "版本不兼容" })[status];
}
