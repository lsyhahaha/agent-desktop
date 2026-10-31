# 外观模式验收

日期：2026-10-31；Electron 45.1.0。

## 实现与边界

- 左下角新增衣服形换肤图标，复用原生自动 popover，提供三种模式和选中标记。支持键盘进入、Escape/点击外部关闭；侧栏收起后仍可使用。
- `ThemePicker.tsx` 管理外观偏好和系统媒体查询订阅，卸载时清理；模块加载时应用初始偏好，React 不持有另一套系统主题事实。无新增依赖、IPC、模型请求或轮询。
- localStorage 的 `agent-desktop.theme` 仅接受 light/dark/system；默认 system，非法/读取失败时回退。保存失败不阻断主题切换，提供就地提示和不含用户内容的诊断日志。
- CSS 使用带原浅色值回退的语义变量，深色集中定义颜色。覆盖对话、输入、设置输入框、菜单、工具输出、审批、错误和主操作，保留现有布局。系统滚动控件通过 color-scheme 响应主题。
- 此次只切换 renderer 外观；主进程启动底色、原生系统对话框和系统窗口按钮未改成随手动主题同步。不会声称首次原生窗口出现前完全没有浅色底色。

## 实际验证

- `npm run build`（包含 typecheck）通过；Zod 上游注释提示不阻断构建。`git diff --check` 通过。未编写单元测试、未提交 Git。
- 使用独立临时 userData 的生产 Electron 窗口，原生鼠标点击选择；应用进程内 nativeTheme 模拟系统浅/深色，不修改宿主系统偏好。验证默认跟随、系统变更、手动模式不被覆盖、重载读回偏好、非法值回退及受控存储写入失败提示。
- 验证最小窗口菜单未越界、选中标记、Escape 返回图标焦点、收起后换肤、深色设置输入框。已查看深色菜单、设置与状态样式截图。
- 工具/审批/错误截图是临时注入的受控 DOM 样式样本，明确标注“无真实执行”；不是完整 Agent 链路验收，不存入用户会话。没有 Key、没有付费模型请求。
- [检查结果](evidence/theme-acceptance.json)；[深色菜单](evidence/theme-dark-menu.png)、[深色设置](evidence/theme-dark-settings.png)、[状态样式样本](evidence/theme-dark-states.png)、[浅色收起](evidence/theme-light-collapsed.png)。

未覆盖其他操作系统、真实 OS 外观切换、冷启动进程的额外恢复实验、屏幕阅读器、全部颜色组合的对比度及真实工具运行/取消；重载恢复通过不等于完成所有冷启动与磁盘故障测试。
