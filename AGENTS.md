# Agent Desktop 开发约定

- 主语言 TypeScript；桌面 Electron，界面 React，本地后端独立 Runtime。
- 开发前阅读 README.md、CONTEXT.md 和整体架构设计.md；设计文档是提案，不代表功能已实现。
- 所有跨进程输入都需校验；renderer 不得获得通用 IPC、文件系统、shell 或密钥接口。
- 真实能力与占位界面明确区分，不以模拟结果冒充模型或工具执行。
- Runtime 及工具生命周期须包含取消、超时和清理；独立进程不等于安全沙箱。
- 不写单元测试，除非用户明确要求。根据本次需求做类型检查、构建和必要的实际运行验证。
- 未经用户明确要求，不自动提交、推送、上传密钥或发布安装包。用户要求 commit 只授权本地提交，不自动推送。

## Electron 官方文档参考

编写或修改 Electron 相关代码时，**优先查阅项目内的官方文档快照，再决定实现方式**，不要只凭记忆推测 API 行为。

- 文档入口：`docs/vendor/electron/docs/README.md`。
- 快照来源、commit、下载日期及版本说明：`docs/vendor/electron/SOURCE.md`；文件校验清单：`source.json`。
- 进程与通信：`tutorial/process-model.md`、`tutorial/ipc.md`，以及 `api/utility-process.md`、`api/message-port-main.md`。
- preload、IPC 与窗口安全：`tutorial/security.md`、`tutorial/context-isolation.md`、`tutorial/sandbox.md`，以及 `api/context-bridge.md`、`api/ipc-main.md`、`api/ipc-renderer.md`、`api/browser-window.md`。
- 凭据与性能：`api/safe-storage.md`、`tutorial/performance.md`。

上述简写路径均相对于 `docs/vendor/electron/docs/`。按当前任务阅读相关章节，不必每次加载整个文档目录。

本地快照来自 **main 开发分支**，不保证与项目安装版本一致。先核对 `package-lock.json` 和已安装的 `node_modules/electron/package.json`，结合该版本的 `electron.d.ts` 判断 API 可用性；存在差异或本地资料不足时，再查对应版本 tag 的官方文档。不得为了迁就 main 文档而擅自升级 Electron、关闭安全选项或使用尚不支持的 API。

关键 Electron 设计应在变更说明中写明参考章节和适用版本，并做与变更范围相称的实际验证。保留既有“未经用户要求不编写单元测试”的约定。上游快照保持原样；需要更新时记录新的 commit 和校验清单，不把它称为会自动同步的最新文档。

## Git 提交说明

每次 commit 都必须写清楚**本次完成的工作**和**后续参考时的关键细节**。标题简洁概括目的，正文提供足够上下文，让没有读过聊天记录的人也能理解此次提交。

提交正文至少包含：

- **完成工作**：实际新增、修改或修复了什么，解决什么问题；明确已实现能力与占位或设计提案，不把计划写成成果。
- **验证结果**：实际执行了哪些检查及结果；未执行或未覆盖的项目明确说明，不虚构验证，也不因此擅自编写单元测试。
- **后续参考**：相关入口和关键文件、重要设计取舍、版本及运行条件、容易误用的细节，以及尚未实现或未验证的边界。只记录与本次变更有关的内容；不适用时明确写明。

使用 Conventional Commits 风格标题（例如 `feat: ...`、`fix: ...`、`docs: ...`）。正文写最终实现及其依据，不罗列对话过程，不记录密钥或其他敏感值。不能只写“更新代码”“完成开发”等无法帮助复查的说明。

提交前检查暂存区范围，排除依赖目录、构建产物、缓存、日志和真实凭据。第三方文档快照保留许可证、来源 commit 与校验记录。使用多行提交正文时优先用消息文件配合 `git commit -F`，保留实际换行。
