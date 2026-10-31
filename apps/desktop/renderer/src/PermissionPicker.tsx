import { useRef } from "react";
import type { PermissionMode } from "@protocol";

const choices = [
  {
    mode: "ask",
    label: "请求批准",
    icon: "♧",
    detail: "工作区内自动执行；项目外或联网操作请求批准",
  },
  {
    mode: "auto_review",
    label: "帮我批准",
    icon: "◇",
    detail: "边界外操作由独立模型审查，无法批准时询问你",
  },
  {
    mode: "full_access",
    label: "完全访问权限",
    icon: "!",
    detail: "可读写电脑上的文件并联网；删除仍需确认",
  },
] as const;

/** 展示 Runtime 保存的会话权限；不乐观切换，也不代替 Main 的宿主访问确认。 */
export function PermissionPicker({
  mode,
  disabled,
  onSelect,
}: {
  mode: PermissionMode;
  disabled: boolean;
  onSelect: (mode: PermissionMode) => Promise<boolean>;
}) {
  const menu = useRef<HTMLDivElement>(null),
    trigger = useRef<HTMLButtonElement>(null);
  return (
    <div className="permission-picker">
      <button
        ref={trigger}
        type="button"
        className={`permission-trigger ${mode === "full_access" ? "full-access" : ""}`}
        disabled={disabled}
        popoverTarget="permission-menu"
        title={disabled ? "停止当前任务后可修改权限" : "设置 Agent 操作权限"}
      >
        <span aria-hidden="true">
          {choices.find((c) => c.mode === mode)?.icon}
        </span>{" "}
        {choices.find((c) => c.mode === mode)?.label}
      </button>
      <div
        id="permission-menu"
        ref={menu}
        popover="auto"
        className="permission-menu"
        role="dialog"
        aria-label="Agent 操作权限"
        onToggle={(event) => {
          if (event.newState === "open")
            event.currentTarget
              .querySelector<HTMLButtonElement>('[aria-pressed="true"]')
              ?.focus();
        }}
      >
        <p>应如何批准 Agent 操作？</p>
        {choices.map((choice) => (
          <button
            key={choice.mode}
            type="button"
            disabled={disabled}
            aria-pressed={mode === choice.mode}
            className={`permission-choice ${choice.mode === "full_access" ? "full-access" : ""}`}
            onClick={async () => {
              menu.current?.hidePopover();
              trigger.current?.focus();
              if (choice.mode !== mode) await onSelect(choice.mode);
            }}
          >
            <span aria-hidden="true">{choice.icon}</span>
            <span>
              <strong>{choice.label}</strong>
              <small>{choice.detail}</small>
            </span>
            <span aria-hidden="true">{mode === choice.mode ? "✓" : ""}</span>
          </button>
        ))}
        <small className="permission-note">
          仅影响后续任务。删除及无法确认无删除的命令始终人工审批。自动审查额外调用模型；手动终端独立。
        </small>
      </div>
    </div>
  );
}
