import { cloneElement, useEffect, useId, useRef, useState } from "react";
import type { ButtonHTMLAttributes, ReactElement } from "react";

interface Props {
  content: string;
  children: ReactElement<ButtonHTMLAttributes<HTMLButtonElement>>;
  align?: "start" | "end";
  className?: string;
}

/** 按钮辅助说明：延迟显示，离开/失焦/点击/Escape 关闭，不拦截原按钮动作。 */
export function Tooltip({ content, children, align = "start", className = "" }: Props) {
  const id = useId();
  const [visible, setVisible] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  function cancelTimer() {
    clearTimeout(timer.current);
    timer.current = undefined;
  }
  function show() {
    cancelTimer();
    timer.current = setTimeout(() => setVisible(true), 300);
  }
  function hide() {
    cancelTimer();
    setVisible(false);
  }
  useEffect(() => () => clearTimeout(timer.current), []);
  // disabled 按钮不接收焦点，由包装层提供辅助说明；仍保留原生禁用行为。
  const disabled = children.props.disabled;
  return (
    <span className={`tooltip-anchor ${className}`}
      tabIndex={disabled ? 0 : undefined}
      role={disabled ? "group" : undefined}
      aria-label={disabled ? children.props["aria-label"] : undefined}
      aria-describedby={disabled ? id : undefined}
      onPointerEnter={show} onPointerLeave={hide}
      onFocus={show} onBlur={hide} onClickCapture={hide}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          hide();
          if (visible) event.stopPropagation();
        }
      }}>
      {cloneElement(children, {
        "aria-describedby": [children.props["aria-describedby"], id].filter(Boolean).join(" "),
      })}
      <span id={id} role="tooltip" className={`tooltip tooltip-${align}`} hidden={!visible}>
        {content}
      </span>
    </span>
  );
}
