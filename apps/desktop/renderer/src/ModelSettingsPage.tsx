import { useState } from "react";
import type { ModelSettings } from "@protocol";
interface Props {
  settings: ModelSettings;
  ready: boolean;
  active: boolean;
  onSave: (model: string, key: string) => Promise<void>;
}

/** 只配置已支持的 DeepSeek。参考图的供应商列表不代表本产品支持其他供应商或套餐。 */
export function ModelSettingsPage({ settings, ready, active, onSave }: Props) {
  const [model, setModel] = useState(settings.model),
    [key, setKey] = useState(""),
    [saving, setSaving] = useState(false),
    [saved, setSaved] = useState(false),
    [failure, setFailure] = useState("");
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (saving || active || !ready) return;
    setSaving(true);
    setSaved(false);
    setFailure("");
    try {
      await onSave(model, key);
      setKey("");
      setSaved(true);
    } catch (e) {
      setFailure(e instanceof Error ? e.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }
  return (
    <section className="settings-page" aria-labelledby="settings-heading">
      <header className="page-heading">
        <h1 id="settings-heading">模型设置</h1>
        <p>配置 DeepSeek，开始当前会话中的流式对话。</p>
      </header>
      <div className="provider-panel">
        <aside className="provider-list">
          <span className="group-label">模型供应商</span>
          <div className="provider-selected">
            <span className="provider-logo">D</span>
            <strong>DeepSeek</strong>
            <span
              className={
                "connection-dot " + (settings.hasKey ? "configured" : "")
              }
              aria-label={
                !ready
                  ? "配置状态待确认"
                  : settings.hasKey
                    ? "已保存凭据"
                    : "未配置凭据"
              }
            />
          </div>
          <p>本次仅接入一个真实模型供应商。</p>
        </aside>
        <div className="provider-detail">
          <header>
            <div className="provider-heading">
              <span className="provider-logo large">D</span>
              <div>
                <h2>DeepSeek API</h2>
                <span>
                  {!ready
                    ? "配置状态待确认"
                    : settings.hasKey
                      ? "已保存凭据"
                      : "尚未配置"}
                </span>
              </div>
            </div>
            <span className="badge">Chat Completions</span>
          </header>
          <form onSubmit={(event) => void submit(event)}>
            <label>
              API 地址
              <input value="https://api.deepseek.com/v1" readOnly />
              <small>请求固定发送至 DeepSeek 官方 HTTPS 接口。</small>
            </label>
            <label>
              模型名称
              <input
                aria-label="模型名称"
                value={model}
                maxLength={100}
                disabled={active || saving || !ready}
                onChange={(e) => {
                  setModel(e.target.value);
                  setSaved(false);
                }}
                required
              />
              <small>填写当前账户可用的模型名称。</small>
            </label>
            <label>
              API Key
              <input
                aria-label="API Key"
                type="password"
                autoComplete="off"
                value={key}
                maxLength={512}
                disabled={active || saving || !ready}
                onChange={(e) => {
                  setKey(e.target.value);
                  setSaved(false);
                }}
                placeholder={
                  settings.hasKey
                    ? "已保存，留空保持不变"
                    : "输入 DeepSeek API Key"
                }
              />
            </label>
            <div className="credential-note">
              <span>◇</span>
              <p>
                密钥使用系统加密后保存在本机，不会回显。会话与工具记录保存在本机，对话及你批准读取的文件内容会发送至
                DeepSeek。
              </p>
            </div>
            {active && (
              <p className="inline-note">
                当前任务正在运行，停止后才能修改模型配置。
              </p>
            )}
            {failure && (
              <p role="alert" className="error">
                {failure}
              </p>
            )}
            <div className="form-footer">
              <span role="status">
                {saved ? "配置已保存。实际连接将在发送消息时验证。" : ""}
              </span>
              <button
                className="primary"
                type="submit"
                disabled={
                  active ||
                  saving ||
                  !ready ||
                  !model.trim() ||
                  (!key.trim() && !settings.hasKey)
                }
              >
                {saving ? "保存中…" : "保存配置"}
              </button>
            </div>
          </form>
        </div>
      </div>
    </section>
  );
}
