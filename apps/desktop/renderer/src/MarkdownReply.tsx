import { memo } from "react";
import Markdown from "react-markdown";
import type { Components } from "react-markdown";
import remarkGfm from "remark-gfm";

const plugins = [remarkGfm];

/** 消息来自不可信模型：仅允许绝对HTTPS链接，图片不自动联网加载。 */
function safeUrl(value: string): string {
  if (value.length > 2048) return "";
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password ? url.href : "";
  } catch {
    return "";
  }
}
const components: Components = {
  a: ({ href, children }) => href
    ? <a href={href} target="_blank" rel="noopener noreferrer" title={href}>{children}</a>
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
    </div>
  );
});
