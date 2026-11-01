# 自进化记录持久化

2026-11-01。复用已有SQLite/单写入Worker，无新依赖。首次进化记录已正式补录，不只是保留Markdown。

## 存储与语义

业务库：`<app.getPath("userData")>/storage/sessions.sqlite`，新增`evolution_records`表，数据库schema v4→v5。项目路径+记录key唯一；id、创建时间、序号和内容摘要由Worker生成。没有Session/Run级联外键，清空聊天不删除进化历史；实验runId可来自隔离验收库，由证据文件引用，不冒充当前会话中的轮次。

每条记录保存触发任务、基线提交、实际改动、验证陈述、前后模型/工具/tokens指标、限制和证据路径/SHA-256。来源固定为`developer_recorded`：哈希证明导入时文件对应，不证明实验结论正确或任务正确性。普通本地SQLite，不新增云端同步、模型调用或自动更新策略。

仅追加：相同项目/key/内容重复导入返回原记录；同key不同内容拒绝覆盖，更正请追加新key并在说明中引用旧记录。数据和证据列表有界；持久化读写均校验，内容损坏不返回成功。项目按规范路径归属，不自动迁移移动后的项目路径。

## 维护入口

当前通过受限本机CLI维护，未新增前端页面或Agent工具，renderer/模型不能写入“自进化成功”记录。CLI与正式应用共用单实例锁；必须先正常退出应用，防止两个Worker同时写库，也避免在线迁移。它不会强杀实例。`--user-data`仅是可信本机维护/隔离验收参数，不暴露给模型或renderer。

先构建，再执行：

```sh
npm run build
npm run evolution -- --import=/Users/a1111/Desktop/agent-desktop/docs/evolution-records/self-evolution-1.json
npm run evolution -- --list --project=/Users/a1111/Desktop/agent-desktop
npm run evolution -- --get=18b623c1-4ce0-468c-ac68-dca9ad21e99e --project=/Users/a1111/Desktop/agent-desktop
```

列表每页最多20条，只返回摘要；后续页用`--after=<上一页nextCursor>`。详情需同项目路径。CLI导入前检查有界普通JSON文件、严格schema、证据项目路径及哈希；拒绝链接、硬链接、逃逸、过大文件及读取期间变化。不会读取或发送凭据，不把文件全文复制进进化记录。

后续每轮进化先形成同格式结构化记录，验证后通过该入口追加，不能把修改意图、模拟或模型自述记成已经验证的成果。记录维护入口不自动扫描文档或导入，也不自行修改代码。后续新增的显式固定策略评估、v6实验报告和人工启用历史见[策略实验室](strategy-lab.md)，它不等于自动搜索或自动推广。

## 本次实际补录与验证

- 正式库：`/Users/a1111/Library/Application Support/agent-desktop/storage/sessions.sqlite`。
- 第1轮key：`self-evolution-1`；id：`18b623c1-4ce0-468c-ac68-dca9ad21e99e`。
- 用户确认草稿已保存并授权正常退出、备份、补录、重启。通过原生Quit退出；退出后用SQLite backup API做一致性备份，未强杀、未清空会话。
- 升级前备份：`/private/tmp/agent-desktop-evolution-backup-fn0xzpgt/sessions-before-import.sqlite`（目录0700、文件0600；含用户会话，请作为私密备份保管，不提交仓库）。
- 正式库冷CLI查询与摘要校验通过；原3个会话、29轮运行、58条消息、57条工具审计、176条时间线记录行数保持。库权限0600。原应用已用新构建重新启动，恢复历史成功，没有发起模型请求；历史中的旧6轮失败记录仍保留原事实。

[正式补录证据](evidence/evolution-storage-live.json)、[8项受控检查](evidence/evolution-storage-acceptance.json)。受控检查使用v4实验库一致性副本，覆盖迁移保留业务行数、幂等/重开、结构化详情、游标/摘要、项目隔离、冲突/非法路径/哈希、SQLite插入失败回滚、损坏记录拒绝；无付费请求或新增单元测试。

代码入口：`apps/runtime/src/evolution-record.ts`定义有界记录，`storage-worker.ts`拥有事务与迁移，`storage.ts`提供内部追加/分页/详情，`apps/desktop/main/evolution-admin.ts`是可信本机维护入口。

Electron参考为本地官方快照`api/app.md`的requestSingleInstanceLock与`tutorial/process-model.md`；核对安装版本45.1.0的API声明，复用已有单实例能力，不关闭安全选项。

v5由新版本支持，旧v4应用拒绝未知版本；不会自动降级或覆盖。若需回退，必须完整退出后由用户决定恢复一致性备份（将丢失备份后新增记录），本次未执行恢复。未验证磁盘满、断电、恶意宿主并发换路径及Windows/Linux；摘要不是防篡改签名，记录不可覆盖指应用接口约束，不代表文件系统不可修改。


## 后续v6部署

2026-11-02经用户授权完成v5→v6升级，第2轮self-evolution-2-strategy-lab已补录，ID为10d9eada-0f6d-4786-b56c-8e7429398696。升级前一致性备份位于/private/tmp/agent-desktop-before-v6-dmw559mr/sessions.sqlite（私密本地备份，不提交仓库）。原3个会话、30轮运行、60条消息、65条工具审计、194条时间线行数保持；两条进化记录摘要校验通过。策略选择表为空，未启用候选、未发起真实评估。见[部署证据](evidence/strategy-lab-deployment.json)。
