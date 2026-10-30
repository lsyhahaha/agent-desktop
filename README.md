# Agent Desktop

TypeScript + Electron + React 的本地 Coding Agent 项目。

## 运行

```sh
npm install
npm run dev
```

关闭开发终端请按 Ctrl+C。应用菜单退出为 Cmd+Q；macOS 关闭窗口后仍可从 Dock 重开。

```sh
npm run typecheck
npm run build
npm start
```

`build` 生成 out/ 中的主进程、预加载、Runtime 和前端产物；当前不生成安装包或签名发行版。依赖以 package-lock.json 锁定，后续复现使用 npm ci。

## 已实现

- DeepSeek真实对话、连续上下文、流式显示与停止。
- 浅色聊天工作台、模型设置页、32KiB受限read_file及授权记录。
- 最多6次模型请求、12次工具调用和120秒运行。

只有当前内存会话，新建或切换项目清空它；尚无多任务目录、目录枚举、命令执行和持久化。历史验收见docs/agent-loop-verification.md。

## 目录

- apps/desktop/main：窗口、IPC、Runtime 生命周期。
- apps/desktop/preload：受限桥接。
- apps/desktop/renderer：React 界面。
- apps/runtime/src：独立 Node.js Runtime。
- packages/protocol/src：跨进程结构和校验。

## 设计资料

- [整体架构](整体架构设计.md)
- [领域术语](CONTEXT.md)
- [架构决策草案](docs/adr/)

Electron 自带的 Node.js 用于应用运行；开发机 Node.js 仅用于构建工具。独立进程不等于安全沙箱。当前不暴露命令执行能力，不包含真实密钥。

## Electron 官方参考

已将官方 main 分支文档保存到 [本地文档索引](docs/vendor/electron/docs/README.md)。版本与来源见 [快照说明](docs/vendor/electron/SOURCE.md)，开发参考要求见 [AGENTS.md](AGENTS.md)。
