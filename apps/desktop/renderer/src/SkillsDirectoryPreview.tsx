const skills = [
  ["代码审查", "按项目规范审阅改动并报告风险"],
  ["调试问题", "沿真实执行链定位失败根因"],
  ["实现功能", "根据需求实施、验证并交付"],
  ["研究资料", "从高可信一手来源形成研究记录"],
] as const;

/** Skills目录视觉预览；不发现、不加载也不执行本地SKILL.md。 */
export function SkillsDirectoryPreview() {
  return (
    <div className="skills-directory-preview" aria-label="Skills目录界面预览">
      <div className="plugin-preview-note" role="note">界面预览 · Mock。Skill发现、安装、启用和调用协议尚未接入。</div>
      <div className="skills-heading"><div><h2>让Agent按你的工作方式执行</h2><p>把稳定的工程流程封装成可复用Skill。</p></div><button disabled>创建Skill · Mock</button></div>
      <div className="skills-grid">{skills.map(([name,description])=><article key={name}><span aria-hidden="true">S</span><div><strong>{name}</strong><small>{description}</small></div><button disabled>添加 · Mock</button></article>)}</div>
    </div>
  );
}
