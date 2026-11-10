type SearchResult = {
  id: string;
  title: string;
  updatedAt: number;
  workspaceName?: string | null;
  snippet?: string;
};

/**
 * 真实会话搜索工作面。
 * 查询和分页仍由Runtime/SQLite负责；本模块只呈现当前有界结果，不缓存完整会话正文。
 */
export function SearchPage({
  query,
  results,
  busy,
  onQuery,
  onSelect,
}: {
  query: string;
  results: SearchResult[];
  busy: boolean;
  onQuery: (query: string) => void;
  onSelect: (id: string) => void;
}) {
  return (
    <section className="search-page" aria-labelledby="search-heading">
      <header className="page-heading"><h1 id="search-heading">搜索聊天</h1><p>按标题或对话正文查找本机聊天。</p></header>
      <label className="search-field">
        <svg width="16" height="16" viewBox="0 0 20 20" fill="none" aria-hidden="true"><circle cx="8.5" cy="8.5" r="4.5" /><path d="m12 12 4 4" /></svg>
        <input autoFocus maxLength={200} value={query} onChange={(event) => onQuery(event.target.value)} placeholder="搜索聊天" aria-label="搜索聊天" />
      </label>
      <div className="search-results" aria-live="polite">
        {!results.length ? <p className="search-empty">{query ? "没有匹配的聊天" : "没有可显示的最近聊天"}</p> : results.map((result) => (
          <button key={result.id} disabled={busy} onClick={() => onSelect(result.id)}>
            <span><strong>{result.title}</strong><small>{result.workspaceName ?? "无项目"} · {new Date(result.updatedAt).toLocaleString()}</small></span>
            {result.snippet && <p>{result.snippet}</p>}
            <svg width="16" height="16" viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M6 14 14 6M8 6h6v6" /></svg>
          </button>
        ))}
      </div>
    </section>
  );
}
