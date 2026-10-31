import { useEffect, useRef, useState } from "react";

const storageKey = "agent-desktop.theme";
const choices = [
  { value: "light", label: "浅色模式" },
  { value: "dark", label: "深色模式" },
  { value: "system", label: "跟随系统" },
] as const;
type Theme = (typeof choices)[number]["value"];
const systemTheme = window.matchMedia("(prefers-color-scheme: dark)");

/** 仅保存外观偏好；不涉及凭据、会话或 Runtime，损坏值退回系统主题。 */
function readTheme(): Theme {
  try {
    const stored = localStorage.getItem(storageKey);
    return choices.find((item) => item.value === stored)?.value ?? "system";
  } catch {
    return "system";
  }
}
function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme =
    theme === "system" ? (systemTheme.matches ? "dark" : "light") : theme;
}
const initialTheme = readTheme();
// 模块在 createRoot 前加载，首次渲染即应用偏好，避免先绘制浅色内容。
applyTheme(initialTheme);

/** 原生弹出层处理外部点击与 Escape；系统监听随组件卸载清理。 */
export function ThemePicker() {
  const [theme, setTheme] = useState<Theme>(initialTheme);
  const [saveError, setSaveError] = useState("");
  const menu = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    applyTheme(theme);
    const update = () => applyTheme(theme);
    systemTheme.addEventListener("change", update);
    return () => systemTheme.removeEventListener("change", update);
  }, [theme]);
  function select(next: Theme) {
    applyTheme(next);
    setTheme(next);
    try {
      localStorage.setItem(storageKey, next);
      setSaveError("");
    } catch {
      // 存储失败不阻断换肤，也不误报已记住偏好。
      console.warn("[theme] preference_save_failed");
      setSaveError("外观已切换，但无法保存偏好；重启后可能恢复默认。");
    }
    menu.current?.hidePopover();
    trigger.current?.focus();
  }
  return (
    <div className="theme-controls">
      <button ref={trigger} className="settings-trigger" type="button"
        aria-label="换肤" title="换肤" popoverTarget="theme-menu">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="m8 3-5 4-2 5 4 2 2-3v10h10V11l2 3 4-2-2-5-5-4c0 4-8 4-8 0Z" />
        </svg>
      </button>
      <div id="theme-menu" ref={menu} className="settings-popover theme-popover"
        popover="auto" role="dialog" aria-label="外观模式"
        onToggle={(event) => {
          if (event.newState === "open")
            event.currentTarget.querySelector<HTMLButtonElement>('[aria-pressed="true"]')?.focus();
        }}>
        {choices.map((item) => (
          <button key={item.value} type="button" className="settings-menu-item"
            aria-pressed={theme === item.value} onClick={() => select(item.value)}>
            <span>{item.label}</span><span className="theme-check" aria-hidden="true">{theme === item.value ? "✓" : ""}</span>
          </button>
        ))}
      </div>
      {saveError && <p className="theme-save-error error" role="status">{saveError}</p>}
    </div>
  );
}
