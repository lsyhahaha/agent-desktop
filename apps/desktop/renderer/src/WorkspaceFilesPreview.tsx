function TreeMark({ kind }: { kind: "open" | "closed" | "file" }) {
  const path = kind === "open" ? "m5 7 5 6 5-6" : kind === "closed" ? "m7 5 6 5-6 5" : "M6 3h6l3 3v11H6zM12 3v4h4";
  return <svg width="14" height="14" viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d={path} /></svg>;
}

/** 文件树只读视觉预览；不直接读取文件系统，也不授予打开权限。 */
export function WorkspaceFilesPreview({ workspaceName }: { workspaceName: string }) {
  return (
    <section className="workspace-files-preview" aria-label="文件树界面预览">
      <header><strong>文件</strong><span>界面预览 · Mock</span></header>
      <div className="workspace-files-scroll">
        <ul>
          <li><button disabled aria-expanded="true"><TreeMark kind="open" /><strong>{workspaceName}</strong></button></li>
          <li className="depth-1"><button disabled aria-expanded="false"><TreeMark kind="closed" />apps</button></li>
          <li className="depth-1"><button disabled aria-expanded="false"><TreeMark kind="closed" />packages</button></li>
          <li className="depth-1"><button disabled aria-expanded="false"><TreeMark kind="closed" />docs</button></li>
          <li className="depth-1"><button disabled><TreeMark kind="file" />README.md</button></li>
          <li className="depth-1"><button disabled><TreeMark kind="file" />package.json</button></li>
        </ul>
        <p>目录展开、搜索和文件打开尚未连接Renderer协议。</p>
      </div>
    </section>
  );
}
