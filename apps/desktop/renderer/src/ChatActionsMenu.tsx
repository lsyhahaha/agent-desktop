import type { ReactNode, RefObject } from "react";

export type ChatMenuTarget = { id: string; title: string };
export type ProjectMenuTarget = { name: string };

function SidebarMenuShell({
  id,
  menuRef,
  label,
  children,
  onClose,
}: {
  id: string;
  menuRef: RefObject<HTMLDivElement | null>;
  label: string;
  children: ReactNode;
  onClose: () => void;
}) {
  return <div id={id} ref={menuRef} className="chat-actions-popover" popover="auto" role="menu" tabIndex={-1} aria-label={label}
    onToggle={(event) => {
      if (event.newState === "open") (event.currentTarget.querySelector<HTMLButtonElement>("button:not(:disabled)") ?? event.currentTarget).focus();
      else onClose();
    }}>
    {children}
  </div>;
}

/**
 * 聊天行的原生 Popover 菜单。
 *
 * 重命名沿用现有真实命令；置顶和归档没有持久化协议，必须保持禁用并显示 Mock。
 * 原生 Popover 负责 Escape 与点击外部关闭，避免再造一套全局点击监听。
 */
export function ChatActionsMenu({
  menuRef,
  target,
  onRename,
  onClose,
}: {
  menuRef: RefObject<HTMLDivElement | null>;
  target: ChatMenuTarget | null;
  onRename: (target: ChatMenuTarget) => void;
  onClose: () => void;
}) {
  return <SidebarMenuShell id="chat-actions-menu" menuRef={menuRef} label={target ? `${target.title} 聊天操作` : "聊天操作"} onClose={onClose}>
    <button type="button" role="menuitem" disabled={!target} onClick={() => target && onRename(target)}>重命名</button>
    <button type="button" role="menuitem" disabled title="置顶状态尚未接入">置顶 <small>Mock</small></button>
    <button type="button" role="menuitem" disabled title="归档状态尚未接入">归档 <small>Mock</small></button>
  </SidebarMenuShell>;
}

/** 项目菜单只展示官方层级；设置与移除尚无协议，均保持禁用。 */
export function ProjectActionsMenu({
  menuRef,
  target,
  onClose,
}: {
  menuRef: RefObject<HTMLDivElement | null>;
  target: ProjectMenuTarget | null;
  onClose: () => void;
}) {
  return <SidebarMenuShell id="project-actions-menu" menuRef={menuRef} label={target ? `${target.name} 项目操作` : "项目操作"} onClose={onClose}>
    <button type="button" role="menuitem" disabled title="项目设置尚未接入">项目设置 <small>Mock</small></button>
    <button type="button" role="menuitem" disabled title="移除项目尚未接入">移除项目 <small>Mock</small></button>
  </SidebarMenuShell>;
}
