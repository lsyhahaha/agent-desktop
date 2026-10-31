# Markdown 渲染修复与验收

日期：2026-10-31。用户已明确批准引入react-markdown和remark-gfm。

## 根因与最小复现

原`App.tsx`直接将message.text作为React文本子节点输出，并替换连续空行；没有Markdown解析器。`##`、`**`和代码围栏显示原文，是缺少渲染层；对空行的替换还会破坏代码块格式。

实际运行临时Electron复现命令 `node_modules/.bin/electron /private/tmp/agent-markdown-repro.cjs`，在真实renderer中注入包含标题、强调和代码块的受控消息：修复前heading/bold/code均为false；修复后同一命令均为true，页面分别生成h2、strong、pre/code。未使用真实模型或用户会话。

## 实现与取舍

- 固定`react-markdown@10.1.0`、`remark-gfm@4.0.1`，同步package-lock。两者MIT许可；官方来源：[react-markdown](https://github.com/remarkjs/react-markdown)、[remark-gfm](https://github.com/remarkjs/remark-gfm)。核对现有React 19满足peer要求，安装未改变已有包版本。安装当时npm audit报告0个已知漏洞，不视为完整安全审计。
- `MarkdownReply.tsx`只负责Agent回复渲染，插件/组件映射模块级复用，memo按原始text缓存历史回复。当前流式消息继续解析最新内容；用户消息、工具输出、模型上下文、数据库和Runtime不变。
- 删除Agent显示路径的空行替换；保留段落、代码缩进和空行。代码块/表格局部横向滚动，Markdown容器使用正常块级排版，适配浅深色。
- 禁用原始HTML，不使用dangerouslySetInnerHTML；图片只显示alt提示，不产生img请求。URL转换只允许长度≤2048、无用户名密码的绝对HTTPS。其他协议、相对路径及危险链接降为不可点击文本。
- Markdown链接target=_blank，Main的setWindowOpenHandler再次校验HTTPS后调用shell.openExternal，始终deny新Electron窗口；will-navigate继续拒绝应用内导航。没有向renderer开放通用shell/IPC。打开失败记录固定错误类别并显示原生错误反馈，不记录完整URL。
- 首版不引入语法高亮、数学公式、HTML插件或远程字体。构建日志renderer JS产物约由710.75KB增至1103.10KB，增量约392KB；这是当前构建文件大小，未测压缩传输或内存占用。此成本用于复用成熟CommonMark/GFM解析，不手写不完整解析器。

## 实际验收

独立临时userData运行生产Electron 45.1.0。通过既有chat:event注入受控Markdown，外部浏览器及错误对话框使用测试桩，未真实外发URL、调用模型或执行工具。

- 标题、强调、行内代码、围栏代码、有序/无序列表相关排版、引用、表格、任务列表与删除线使用成熟解析路径。实际DOM断言覆盖标题、强调、代码、无序列表、引用、表格、任务列表和删除线；代码中的连续空行保持原样，用户消息仍为原文。
- 恶意原始script/img不执行或生成元素；Markdown图片只显示说明。javascript、file、应用协议和带凭据HTTPS均不生成可点击链接；只有合法HTTPS保留anchor。
- 原生鼠标点击HTTPS链接只进入系统浏览器桩且不新建Electron窗口；直接尝试file新窗口仍被Main拒绝；受控openExternal失败触发错误反馈，没有未处理Promise。
- 默认1320×860深色、最小1000×680浅色截图已实际查看，长代码仅在代码区滚动，页面无横向溢出，输入框仍100px。
- 未闭合的流式代码围栏可显示，后续补齐后强调等内容正确更新；Markdown改变DOM高度后Minimap仍能显示去格式化的摘要。
- `npm run build`（含类型检查）、依赖版本检查、`git diff --check`通过。未编写单元测试，未提交Git。Zod上游注释警告仍存在，不影响构建。

[检查结果](evidence/markdown-acceptance.json)；[深色效果](evidence/markdown-dark.png)、[浅色效果](evidence/markdown-light.png)。截图是受控格式与安全样本，不是用户项目分析结果。

## 官方参考与边界

Electron参考项目本地`docs/vendor/electron/docs/tutorial/security.md`第14/15项和`api/shell.md`，并核对安装版本45.1.0的electron.d.ts。未改sandbox、contextIsolation或nodeIntegration。

未对真实OS默认浏览器进行外发验证，未测真实模型长时流式、大量历史Markdown的性能极限、跨平台或所有Markdown扩展；Minimap预览仍为摘要，不提供完整Markdown排版。已实现代码块排版，但没有语言语法着色。
