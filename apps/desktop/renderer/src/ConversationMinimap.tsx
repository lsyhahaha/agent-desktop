import { useEffect, useRef, useState } from "react";
import type { RefObject } from "react";

type Entry = {
  id: string;
  y: number;
  node: HTMLElement;
  kind: string;
  label: string;
  preview: string;
  answer?: string;
  top: number;
  height: number;
};
interface Props {
  viewport: RefObject<HTMLDivElement | null>;
  onNavigate: () => void;
}

/** 当前已渲染内容的导航投影：只测量DOM，不请求历史、不触发工具或更改会话状态。 */
export function ConversationMinimap({ viewport, onNavigate }: Props) {
  const rail = useRef<HTMLDivElement>(null);
  // 放大直接更新本组件的线条transform；mousemove不触发React页面重渲染。
  const animationFrame = useRef(0);
  const pointer = useRef<number | null>(null);
  const [railOffset, setRailOffset] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const pending = useRef<HTMLElement | null>(null);
  const [layout, setLayout] = useState({ items: [] as Entry[], total: 1, page: 1, rail: 1, offset: 0 });
  const [scrollTop, setScrollTop] = useState(0);
  const [previewNode, setPreviewNode] = useState<HTMLElement | null>(null);
  const [keyboardNode, setKeyboardNode] = useState<HTMLElement | null>(null);

  useEffect(() => {
    const scroll = viewport.current, track = rail.current;
    if (!scroll || !track) return;
    let measureTimer: ReturnType<typeof setTimeout> | undefined;
    let frame = 0;
    function measure() {
      measureTimer = undefined;
      if (!scroll || !track) return;
      const origin = scroll.getBoundingClientRect().top;
      // 一次User及同runId的回复/工具算一轮；仅裁剪导航数据，绝不移除正文DOM。
      const rounds = Array.from(scroll.querySelectorAll<HTMLElement>('[data-minimap-kind="user"]'))
        .map((node) => node.dataset.minimapRound).filter((id): id is string => !!id);
      const recent = new Set(Array.from(new Set(rounds)).slice(-20));
      const items = Array.from(scroll.querySelectorAll<HTMLElement>('[data-minimap-kind]'))
        .filter((node) => !!node.dataset.minimapId && recent.has(node.dataset.minimapRound ?? ""))
        .filter((node) => node.getClientRects().length && node.getBoundingClientRect().height > 0)
        .map((node, index): Entry => {
          const rect = node.getBoundingClientRect();
          return {
            id: node.dataset.minimapId!, y: 2 + index * 10,
            node, kind: node.dataset.minimapKind ?? "system",
            label: node.dataset.minimapLabel ?? "会话事件",
            // 预览限长、按文本呈现；永远不执行消息中的HTML或外部链接。
            preview: (node.dataset.minimapPreview ?? node.textContent ?? "").slice(0, 1200),
            top: rect.top - origin + scroll.scrollTop, height: rect.height,
          };
        });
      // 一个User提问只画一条线；回复和工具只参与轮次预览及实际范围计算。
      const turns = Array.from(recent).flatMap((round, index): Entry[] => {
        const members = items.filter((entry) => entry.node.dataset.minimapRound === round);
        const user = members.find((entry) => entry.kind === 'user');
        if (!user) return [];
        return [{ ...user, y: recent.size === 1 ? 12 : 7 + index * 10,
          height: Math.max(...members.map((entry) => entry.top + entry.height)) - user.top,
          // 卡片仅呈现提问与回复摘要，不混入角色标签、工具输出或完整正文。
          preview: user.preview.replace(/\s+/g, ' ').slice(0, 200),
          answer: members.filter((entry) => entry.kind === 'assistant').map((entry) => entry.preview).join(' ').replace(/\s+/g, ' ').slice(0, 400),
        }];
      });
      setLayout({ items: turns, total: Math.max(1, scroll.scrollHeight), page: scroll.clientHeight, rail: track.clientHeight, offset: track.getBoundingClientRect().top - origin });
      setScrollTop(scroll.scrollTop);
    }
    // 流式文本、工具展开和窗口变化合并测量，避免每个token遍历历史。
    const schedule = () => {
      if (measureTimer === undefined) measureTimer = setTimeout(measure, 80);
    };
    const onScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => { frame = 0; setScrollTop(scroll.scrollTop); });
    };
    const resize = new ResizeObserver(schedule);
    resize.observe(scroll);
    resize.observe(track);
    const content = scroll.querySelector('.conversation-content');
    if (content) resize.observe(content);
    const mutations = new MutationObserver(schedule);
    mutations.observe(scroll, { subtree: true, childList: true, characterData: true, attributes: true });
    scroll.addEventListener('scroll', onScroll, { passive: true });
    measure();
    return () => {
      clearTimeout(measureTimer);
      clearTimeout(timer.current);
      cancelAnimationFrame(animationFrame.current);
      pointer.current = null;
      cancelAnimationFrame(frame);
      resize.disconnect(); mutations.disconnect();
      scroll.removeEventListener('scroll', onScroll);
    };
  }, [viewport]);

  function closePreview() {
    clearTimeout(timer.current);
    pending.current = null;
    setPreviewNode(null);
  }
  function preview(entry: Entry | undefined) {
    if (!entry || pending.current === entry.node) return;
    clearTimeout(timer.current);
    pending.current = entry.node;
    setPreviewNode(null);
    timer.current = setTimeout(() => setPreviewNode(entry.node), 200);
  }
  function magnify(clientY: number | null) {
    pointer.current = clientY;
    if (animationFrame.current) return;
    let previous = performance.now();
    const step = (now: number) => {
      const track = rail.current;
      if (!track) { animationFrame.current = 0; return; }
      const y = pointer.current === null ? null : pointer.current - track.getBoundingClientRect().top + track.scrollTop;
      // 基于帧间隔追随目标，避免每次mousemove重启220ms CSS过渡而产生拖尾。
      const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      const alpha = reduced ? 1 : 1 - Math.exp(-Math.min(64, now - previous) / (y === null ? 65 : 40));
      previous = now;
      let moving = false;
      track.querySelectorAll<SVGRectElement>('.minimap-line').forEach((line) => {
        const distance = y === null ? 30 : Math.abs(Number(line.dataset.center) - y);
        const influence = distance >= 30 ? 0 : Math.pow(1 - distance / 30, 1.3);
        const target = (12 + 24 * influence) / 12;
        const current = Number(line.dataset.scale ?? 1);
        const next = Math.abs(target - current) < .003 ? target : current + (target - current) * alpha;
        line.dataset.scale = String(next);
        line.style.transform = `scaleX(${next})`;
        if (Math.abs(target - next) >= .003) moving = true;
      });
      animationFrame.current = moving ? requestAnimationFrame(step) : 0;
    };
    animationFrame.current = requestAnimationFrame(step);
  }
  useEffect(() => { magnify(pointer.current); }, [layout]);
  function nearest(y: number) {
    const track = rail.current;
    if (!track) return undefined;
    const position = Math.max(0, y - track.getBoundingClientRect().top + track.scrollTop);
    return layout.items.reduce<Entry | undefined>((best, entry) =>
      !best || Math.abs(entry.y - position) <
        Math.abs(best.y - position) ? entry : best, undefined);
  }
  function navigate(entry: Entry | undefined) {
    const scroll = viewport.current;
    if (!entry || !scroll || !scroll.contains(entry.node)) return;
    onNavigate();
    const top = entry.node.getBoundingClientRect().top - scroll.getBoundingClientRect().top + scroll.scrollTop;
    // 即时定位避免流式期间平滑滚动与自动跟随互相竞争，也尊重减少动态效果偏好。
    scroll.scrollTo({ top: Math.max(0, top - 16), behavior: 'instant' });
    setKeyboardNode(entry.node);
    closePreview();
  }
  const active = layout.items.reduce((best, entry, index) =>
    entry.top <= scrollTop + 24 ? index : best, -1);
  const selected = Math.max(0, layout.items.findIndex((entry) => entry.node === keyboardNode));
  const shown = layout.items.find((entry) => entry.node === previewNode);
  const contentHeight = Math.max(layout.rail, layout.items.length * 10 + 2);
  // 只转换展示坐标；原有原文坐标、定位与scroll监听保持不变。
  function positionFor(top: number) {
    const items = layout.items;
    if (!items.length || top <= items[0].top) return 0;
    const index = items.findIndex((entry) => entry.top > top);
    if (index < 0) {
      const last = items[items.length - 1];
      return Math.min(items.length * 10, last.y + (top - last.top) / Math.max(1, last.height) * 8);
    }
    const before = items[index - 1], after = items[index];
    return before.y + (top - before.top) / Math.max(1, after.top - before.top) * (after.y - before.y);
  }
  const thumbTop = positionFor(scrollTop);
  const thumbHeight = Math.max(3, positionFor(scrollTop + layout.page) - thumbTop);
  const previewTop = shown ? Math.max(-layout.offset, Math.min(layout.page - layout.offset - Math.min(220, layout.page), shown.y - railOffset - 30)) : 0;

  return (
    <aside className="conversation-minimap" style={{ maxHeight: Math.max(24, layout.items.length * 10 + 4) }} aria-label="对话缩略导航" onPointerLeave={() => { magnify(null); closePreview(); }}>
      <div ref={rail} className="minimap-rail" role="slider" tabIndex={layout.items.length ? 0 : -1}
        aria-label="对话位置，方向键浏览，回车定位" aria-orientation="vertical"
        aria-valuemin={1} aria-valuemax={Math.max(1, layout.items.length)}
        aria-valuenow={Math.max(1, keyboardNode ? selected + 1 : active + 1)}
        aria-valuetext={layout.items[keyboardNode ? selected : active]?.label ?? (layout.items.length ? "当前位置早于最近20轮" : "无消息")}
        aria-describedby={shown ? 'minimap-preview' : undefined}
        onPointerMove={(event) => { magnify(event.clientY); preview(nearest(event.clientY)); }}
        onPointerLeave={() => magnify(null)}
        onScroll={(event) => { setRailOffset(event.currentTarget.scrollTop); magnify(pointer.current); }}
        onClick={(event) => navigate(nearest(event.clientY))}
        onFocus={() => preview(layout.items[active])}
        onBlur={() => { closePreview(); setKeyboardNode(null); }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') { closePreview(); return; }
          const index = keyboardNode ? selected : active;
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault(); navigate(layout.items[index]); return;
          }
          const next = event.key === 'Home' ? 0 : event.key === 'End' ? layout.items.length - 1 :
            event.key === 'ArrowDown' || event.key === 'ArrowRight' ? index + 1 :
            event.key === 'ArrowUp' || event.key === 'ArrowLeft' ? index - 1 : null;
          if (next !== null) {
            event.preventDefault();
            const entry = layout.items[Math.max(0, Math.min(layout.items.length - 1, next))];
            if (entry) {
              const track = rail.current;
              if (track && (entry.y < track.scrollTop || entry.y > track.scrollTop + track.clientHeight - 10))
                track.scrollTop = Math.max(0, entry.y - track.clientHeight / 2);
              setKeyboardNode(entry.node); preview(entry);
            }
          }
        }}>
        {!!layout.items.length && <span className="minimap-viewport" aria-hidden="true" style={{ top: thumbTop, height: thumbHeight }} />}
        <svg width="44" height={contentHeight} aria-hidden="true">
          {layout.items.map((entry, index) => (
            <rect key={entry.id} data-message-id={entry.id} data-center={entry.y}
              x="0" y={entry.y - 1.5} width="12" height="3" rx="2"
              className={`minimap-line ${index === active ? 'is-active' : ''}`} />
          ))}
        </svg>
      </div>
      {shown && <span className="minimap-preview-bridge" aria-hidden="true" style={{ top: previewTop, height: Math.min(220, layout.page) }} />}
      {shown && <div id="minimap-preview" role="tooltip" className="minimap-preview" style={{ top: previewTop, maxHeight: Math.min(220, layout.page) }}>
        <p className="minimap-question" aria-label="提问摘要">{shown.preview || '暂无文本内容'}</p>
        {shown.answer && <p className="minimap-answer" aria-label="回复摘要">{shown.answer}</p>}
      </div>}
    </aside>
  );
}
