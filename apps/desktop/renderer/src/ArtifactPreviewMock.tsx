/** 产物预览不执行HTML、脚本或用户文件，仅复刻官方并列审阅和批注层级。 */
export function ArtifactPreviewMock() {
  return (
    <section className="artifact-preview-mock" aria-label="产物预览界面预览">
      <header><div><strong>reviewable-output.pdf</strong><small>Preview · Mock</small></div><nav aria-label="预览工具Mock"><button disabled>批注 · Mock</button><button disabled>在系统中打开</button></nav></header>
      <div className="artifact-workspace">
        <aside aria-label="页面缩略图Mock"><button disabled aria-current="page">1</button><button disabled>2</button><button disabled>3</button></aside>
        <article><span>AGENT DESKTOP</span><h2>Reviewable output</h2><p>文档、图片、PDF和HTML产物将在这个工作面中预览。</p><div className="artifact-lines"><i /><i /><i /></div><b className="comment-pin" aria-label="批注位置Mock">1</b></article>
      </div>
      <footer>预览器、批注与产物身份尚未实现。</footer>
    </section>
  );
}
