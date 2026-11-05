# Runtime Hooks 与本地插件

状态：已实现第一版。适用版本：Electron 45.1.0，Plugin Runtime API v1。

## 能力与信任边界

Agent Desktop 可以从设置页安装用户明确审查并信任的本地插件目录。插件是本地可执行代码：每个启用插件运行在独立 Electron Utility Process，独立进程用于故障和生命周期隔离，**不是抵抗恶意插件的安全沙箱**。插件代码仍可能以当前用户身份访问文件或网络。

Runtime 不向插件发送 Provider API Key、safeStorage 数据、数据库句柄、权限对象或可执行函数。插件不能注册新工具、短路模型或工具、提升权限、改变硬预算、覆盖删除审批或把失败运行改为成功。

Hook 覆盖 `run.before`、`model.before`、`model.after`、`tool.before`、`tool.after`、`run.after`。`observe` 只能观察；`mutate` 可以返回当前阶段允许的结构化 patch 或拒绝。工具参数被改写后必须重新通过 schema、路径和审批，旧授权不会复用；工具执行后的 patch 只改变反馈给模型的内容，Timeline 中的真实执行结果保持不变。

观察 Hook 失败会在本轮禁用该插件并继续；改写 Hook 失败、超时、崩溃或返回非法结构会终止当前 Run。单次 Hook 最长3秒，单阶段累计最长10秒，最多同时启用8个插件。插件集合和顺序在 Run 接纳时冻结。

## 插件目录

目录必须包含 `manifest.json` 和已经构建好的 ESM 入口。安装过程不会执行 npm、postinstall 或其他生命周期脚本，也不会从网络下载依赖。插件需要把运行依赖预先打包进目录。

```json
{
  "schemaVersion": 1,
  "id": "example.audit-plugin",
  "name": "Audit Plugin",
  "version": "1.0.0",
  "entry": "index.mjs",
  "runtimeApiVersion": 1,
  "hooks": [
    { "stage": "run.before", "mode": "observe" },
    { "stage": "tool.before", "mode": "mutate" }
  ]
}
```

插件 ID 使用小写、点号或连字符分段；版本使用 SemVer 基本形式；入口必须是目录内的相对 `.js` 或 `.mjs` 路径。目录不能包含符号链接或特殊文件，最多256个文件、总计20MiB、单文件10MiB。

入口导出统一处理函数：

```js
export async function handleHook(context) {
  if (context.stage === "tool.before" && context.call.name === "read_file") {
    return {
      action: "continue",
      patch: {
        stage: "tool.before",
        arguments: context.call.arguments
      }
    };
  }
  return { action: "continue" };
}
```

拒绝使用 `{ action: "deny", code, message }`。不能返回任意 JSON Patch；每个阶段的输入和 patch 都由 `packages/protocol/src/plugins.ts` 的 Zod schema 校验。观察 Hook 返回 patch 或 deny 会被视为协议错误。

## 安装与运行

设置 → 插件 → 安装或更新插件，选择插件目录。Main 会扫描普通文件、计算 SHA-256、启动临时 Plugin Host 做入口探针，成功后再原子替换应用管理目录中的副本。更新失败保留旧版本；运行期间只能查看，不能安装、启停、排序或卸载。

插件注册表位于应用 userData 的 `plugins/registry.json`，安装副本位于 `plugins/packages/<plugin-id>/`。注册表以 `0600` 原子保存；会话 SQLite 不保存插件代码。启动时会重新扫描副本并核对清单和摘要，内容不一致时禁用。

Main 使用 `MessageChannelMain` 把专用端口分别移交 Runtime 和 Plugin Host，后续 Hook 调用不经过 Main。依据项目锁定的 Electron 45.1.0 `utilityProcess.postMessage(message, transfer)` 与 `MessagePortMain` 接口；Main 仍负责插件进程退出监督和应用退出清理。

JSONL 与 Timeline 仅记录插件 ID、阶段、结果、变更字段和输入/输出摘要，不复制 Prompt、源码或工具正文。纯观察成功不产生 Timeline 噪声；改写、拒绝和失败会生成 Middleware 条目。

## 当前限制

- 首轮只在 macOS 与 Electron 45.1.0 验收；Windows/Linux 尚未验证。
- 没有插件签名、市场、自动更新、不可信代码沙箱或工具插件。
- 插件状态页展示进程启动/退出错误；本轮内 Hook 降级的权威事实以 Timeline 和 Runtime JSONL 为准。
- 配置修改只影响下一轮；历史运行不会重新执行插件。

## 本轮验证

受控验收使用临时userData、临时SQLite、真实Electron 45.1.0 Runtime/Utility Process/MessagePort和本地测试插件；未使用真实Key或调用Provider。覆盖探针与结构化改写、安装/启停/卸载、symlink拒绝、观察Hook降级、改写Hook超时、状态回流、JSONL脱敏，以及最小/默认窗口浅深主题实际渲染。范围和未覆盖项见[受控证据](evidence/runtime-hooks-controlled.json)。
