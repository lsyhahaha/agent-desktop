import { memo, useState, useRef, useEffect, type ReactNode } from "react";
import Markdown from "react-markdown";
import type { Components } from "react-markdown";
import remarkGfm from "remark-gfm";

const plugins = [remarkGfm];

/** 消息来自不可信模型：仅允许绝对HTTPS链接，图片不自动联网加载。 */
function safeUrl(value: string): string {
  if (value.length > 2048) return "";
  // 相对源码引用只投影为本页审计锚点，点击不能直接访问文件系统。
  if (/^(?![./])[^\s?#:]+\.(?:tsx?|jsx?|md|json|css|py|rs|go|txt)(?::[0-9]+)?$/.test(value))
    return "#file-ref=" + encodeURIComponent(value.replace(/:[0-9]+$/, ""));
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password ? url.href : "";
  } catch {
    return "";
  }
}
/** 复制只使用用户点击时的文本；失败保留可读反馈，不触发工具执行。 */
export function CopyText({ text, label = "复制" }: {
  text: string | (() => string);
  label?: string;
}) {
  const [feedback, setFeedback] = useState("");
  // 流式正文或代码变化后，旧的复制成功提示不再代表当前内容。
  useEffect(() => setFeedback(""), [text]);
  return (
    <button className="copy-text" aria-label={feedback || label}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(typeof text === "function" ? text() : text);
          setFeedback("已复制");
        } catch {
          setFeedback("复制失败，请手动选择文本");
        }
      }}>
      {feedback || label}
    </button>
  );
}
/** 从当前代码DOM取原文，复制按钮放在pre之外，避免混入复制结果。 */
function CodeBlock({ children }: { children?: ReactNode }) {
  const code = useRef<HTMLPreElement>(null);
  return (
    <div className="code-block">
      <CopyText text={() => code.current?.textContent ?? ""} label="复制代码" />
      <pre ref={code}>{children}</pre>
    </div>
  );
}
/** 链接来源不可信，只有现有执行记录可以被定位；缺记录明确提示。 */
function FileReference({ href, children }: { href: string; children?: ReactNode }) {
  const [missing, setMissing] = useState(false);
  return <><a href={href} onClick={(event) => {
    event.preventDefault();
    const path = decodeURIComponent(href.slice("#file-ref=".length));
    const node = event.currentTarget.closest(".execution-timeline")?.querySelector<HTMLElement>(`[data-file-path="${CSS.escape(path)}"]`);
    if (!node) { setMissing(true); return; }
    let parent = node.parentElement;
    while (parent) { if (parent instanceof HTMLDetailsElement) parent.open = true; parent = parent.parentElement; }
    node.scrollIntoView({block: "center"}); node.focus({preventScroll: true}); setMissing(false);
  }}>{children}</a>{missing && <small role="status">当前已加载记录中没有该文件，可展开对应历史轮次查看。</small>}</>;
}
const components: Components = {
  pre: CodeBlock,
  a: ({ href, children }) => href?.startsWith("#file-ref=")
    ? <FileReference href={href}>{children}</FileReference>
    : href ? <a href={href} target="_blank" rel="noopener noreferrer" title={href}>{children}</a>
    : <span>{children}</span>,
  img: ({ alt }) => <span className="markdown-image-note">[图片{alt ? `：${alt}` : ""}，未自动加载]</span>,
  table: ({ children }) => <div className="markdown-table-scroll"><table>{children}</table></div>,
};

/** 历史回复按原始文本缓存；流式当前回复仍正常更新，不改变存储或模型上下文。 */
export const MarkdownReply = memo(function MarkdownReply({ text }: { text: string }) {
  return (
    <div className="markdown-reply">
      <Markdown remarkPlugins={plugins} components={components} skipHtml urlTransform={safeUrl}>
        {text}
      </Markdown>
      <CopyText text={text} label="复制回复" />
    </div>
  );
});
