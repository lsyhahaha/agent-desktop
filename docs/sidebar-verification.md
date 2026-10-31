# 侧栏折叠验收

日期：2026-10-31。

## 实现

- 窗口左下角圆圈箭头按钮在对话和模型设置中均可展开/收起侧栏，提供动作名称、`aria-expanded`、`aria-controls` 和可见焦点。
- React 局部状态只控制布局；导航保持挂载，`hidden` 排除隐藏内容的显示、焦点和可访问树。折叠不会提交命令、切换任务或清空草稿；重启默认展开。
- 按钮距窗口左侧20px、底部16px，展开时朝左、收起时朝右；导航底部预留按钮位置。收起后主工作面占满可用宽度；为原生窗口控制按钮预留 94px 顶栏空间，切换按钮使用 `no-drag`。
- 不新增依赖、IPC、持久化、模型调用或后台进程；没有增加动画。任务导航和设置入口展开后使用。

## 验证

- `npm run build`（含类型检查）通过。构建存在上游 Zod 注释提示，不影响完成。
- Electron 45.1.0 使用独立临时 userData 启动实际生产 Main、preload、renderer、Runtime；未配置 Key、未发送模型请求、未操作用户已有任务。
- 实际鼠标点击收起、Space 键展开，在 1320×860 和 1000×680 检查折叠状态、主区宽度、无整页横向溢出、输入草稿与侧栏搜索保留、按钮焦点、左下角固定位置、发送入口未越界。
- 实际进入模型设置、折叠/展开并返回工作区，保存入口可见、原对话草稿保留。已查看最小窗口展开与收起截图。
- 结果：[结构化检查](evidence/sidebar-acceptance.json)；截图：[默认收起](evidence/sidebar-collapsed-1320.png)、[最小收起](evidence/sidebar-collapsed-1000.png)、[最小展开](evidence/sidebar-expanded-1000.png)、[最小设置页](evidence/sidebar-settings-1000.png)。截图仅包含受控验收草稿和搜索词。

## 边界

本次未运行付费模型、工具审批或取消链路，也未验证 Windows/Linux、屏幕阅读器和原生窗口拖动手势。运行与停止入口代码未被改动；不把这一事实表述为本轮已经重验其端到端行为。没有编写单元测试或提交 Git。

Electron 交互参考为本地 `docs/vendor/electron/docs/tutorial/custom-window-interactions.md` 的 drag/no-drag 规则，快照来源见 `docs/vendor/electron/SOURCE.md`，实际运行版本 45.1.0。

## 设置入口调整

- 移除侧栏底部常驻的“模型设置”和凭据状态文字；齿轮按钮与折叠按钮同排，侧栏收起后仍可使用。连接状态提示保留，实际模型配置页不变。
- 复用当前 Electron 45.1.0 Chromium 的原生自动 popover，不增加依赖、全局监听或通用弹窗框架。菜单当前只有“模型设置”；打开后聚焦设置项，Escape/点击外部关闭，选中后关闭并进入现有设置页。
- 类型检查、构建及 `git diff --check` 通过。独立临时 userData 的实际鼠标/键盘验收验证了上述行为、Space 打开、Escape 返回齿轮焦点、侧栏折叠后打开菜单、设置往返草稿保留；默认与最小窗口折叠检查同时通过。未发送真实模型请求，未使用用户凭据，未编写单元测试。
- [检查结果](evidence/settings-menu-acceptance.json)；[已查看的最小窗口菜单截图](evidence/settings-menu-1000.png)。截图为受控输入，不代表真实模型执行。未验证其他操作系统或屏幕阅读器。
