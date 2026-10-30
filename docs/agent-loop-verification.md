# 最小 DeepSeek Agent Loop 验证

日期：2026-10-31；状态：核心链路已通过真实 DeepSeek 验收；资源极限/故障覆盖范围见最新记录。

## 实际完成

- TypeScript检查和Electron完整构建通过。
- 真正启动Electron 45.1.0，Renderer → preload → main → utility Runtime状态与会话snapshot请求通过，未捕获pageerror。
- safeStorage异步加密/解密使用非敏感fixture往返成功，没有保存或读取真实API Key。
- evidence/agent-loop.png 记录的是最初深色版本；后续界面已按用户参考图调整，见下方验证记录。
- 一次性受控集成探针使用真实Agent、流式解析与文件工具实现：拆分UTF-8/CRLF帧、模型→read_file→文件内容回传→回答、成功轮次追问上下文、取消、401错误分类、6步骤上限均通过。
- 实际临时文件验证：README文本允许；相对越界、绝对路径、.env、symlink、32KiB以上和非UTF-8文件均拒绝。
- 未新增单元测试或仓库测试套件；以上为一次性集成与实际运行检查，受控响应不证明DeepSeek生产行为。

## 初始阶段待验收项（后续已完成核心链路）

在应用设置输入有效DeepSeek Key，然后验收：正常流式回答、连续追问、停止长回答、读取README并批准/拒绝。未持有凭据，未调用成功的真实DeepSeek模型，不记录虚构usage或质量指标。

## 关键实现与边界

- DeepSeek固定HTTPS端点 https://api.deepseek.com/v1/chat/completions，拒绝重定向；无任意端点设置，避免把凭据发往未知服务。
- 官方参考：https://api-docs.deepseek.com/api/create-chat-completion/ 和 https://api-docs.deepseek.com/guides/tool_calls/ 。2026-10-31按非思考模式配置 thinking.type=disabled，默认模型deepseek-flash；用户可输入其账户可用的模型名。
- Electron参考本地 docs/vendor/electron/docs/api/safe-storage.md、tutorial/security.md、api/context-bridge.md；实际方法同时核对安装版本electron.d.ts。当前45.1.0支持所用异步safeStorage接口。
- 流必须有完整结束标记和结束原因；断流、超时、错误及空回答不记作成功上下文。usage缺失或失败轮次标记不完整，不当成零费用。
- 会话与工具记录仅在Runtime内存；应用重启不恢复，UI关闭会取消运行。失败/取消保留显示但整轮不加入下次请求。
- 审批绑定独立interactionId，回复过期审批被拒绝；用户拒绝后模型可能选择另一种回答或再次请求，仍受次数与总时长限制。
- 读取工具没有写入能力；文件文本本身可能含秘密，审批明确提示会发送到DeepSeek。路径检查不是OS沙箱，不能证明抵抗恶意并发文件系统攻击。
- 此次未提交Git，也没有更改或扫描其他应用的凭据配置。

## 参考图界面调整（2026-10-31）

- 复用现有 DeepSeek API、会话、取消、read_file 审批与执行上限；本轮不改写 Agent Loop，也不引入新包。
- 前端改为浅色工作区、独立模型设置页和单一 DeepSeek 配置表单。移除常驻右侧栏及旧版无用样式；参考图的自动化、插件、多供应商/套餐等不在范围内。
- `useAgentSession.ts` 统一连接现有桥接接口，按 revision 更新投影；页面切换保留会话和草稿，配置页卸载释放其未提交表单内存。
- 类型检查、完整构建通过；真实 Electron 窗口中检查了首页与设置页布局、管理模型入口、返回工作区，以及切页后草稿保留。检查结束已清除验证草稿。
- 没有保存或读取真实凭据。未配置Key时发送与空凭据保存按钮禁用；未选目录时read_file与读取建议禁用。
- 未新增单元测试；未提供真实DeepSeek Key，真实成功模型回答仍未验收。本轮未自动操作真实模型请求或文件读取审批，不将视觉检查代替端到端模型验收。

## 真实 DeepSeek 验收（2026-10-31）

用户在应用中自行输入并保存Key后，授权实际调用及完整链路测试。验收通过现有Electron界面、preload、Main、utility Runtime、DeepSeek及实际文件工具进行；未读取、回显、导出或另行保存Key明文，也未安装新依赖。

| 验收项 | 实际观察 | 结果 |
|---|---|---|
| 请求地址 | 现有 `https://api.deepseek.com/v1/chat/completions` 成功返回真实模型结果 | 通过，无需改URL |
| 普通回答 | 要求回复 `CONNECTED-7319`，实际返回完全相同标记 | 通过 |
| 多轮上下文 | 后续要求复述第一条消息标记，返回 `CONNECTED-7319`；该追问UI显示输入103/输出6 tokens | 通过 |
| 流式显示 | 长回答在running期间逐行增加，实际观察到部分编号文本 | 通过 |
| 停止 | 输出进行中点击停止，UI进入cancelled、标记部分输出未完成、恢复输入；随后检查文本未继续增长 | 通过 |
| 实际文件工具 | 临时样例README触发read_file，记录读取成功183字节，回答准确返回文件内 `FILE-6284-PASS` 与 `npm run fixture-start` | 通过 |
| 拒绝读取 | 实际观察DENY.md的waiting_user审批，点击拒绝；记录为denied/用户拒绝，模型正常结束且表示没有收到文件内容 | 通过 |

文件成功轮次UI显示输入817/输出63 tokens；拒绝轮次显示输入1080/输出60 tokens。此处仅记录各轮界面观察值，不是总计账单；取消轮次没有完整usage，不能估成零费用。

测试目录为 `/private/tmp/agent-desktop-live-acceptance`，文件均为本次生成的非敏感fixture。切换目录前，用户明确批准清空原内存会话。README成功轮次的具体批准点击未被自动化捕获，故不伪称由自动化执行了该点击；之后单独捕获并验证了审批拒绝分支。

模型为 `deepseek-flash`，未修改用户模型和凭据。官方当前示例使用基地址 `https://api.deepseek.com`、完整请求路径 `/chat/completions`，参考 https://api-docs.deepseek.com/en/ 。本次证明应用现有带 `/v1` 的完整请求实际可用；不据此推断所有兼容API或自定义网关都支持相同路径。

6次模型请求、12次工具调用、120秒、路径边界与断流错误等此前仅做受控集成或临时文件验证，本次没有刻意用付费真实请求耗尽这些资源限制，也未做长稳/并发/恶意文件系统竞争验收。没有新增单元测试，未提交Git。

结构化观察记录：`docs/evidence/deepseek-live-acceptance.json`。
