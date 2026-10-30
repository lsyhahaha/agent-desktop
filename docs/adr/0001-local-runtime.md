---
status: proposed
---
# 本地Runtime拥有会话事实，桌面壳与前端通过协议访问

建议以Electron renderer、desktop main和独立Agent Runtime三个进程角色构成第一版。Runtime集中持有会话调度、执行状态和持久化所有权，避免窗口重载破坏任务，也使未来CLI/远程连接可以复用同一协议；代价是必须从第一版处理消息验证、取消和重连，而不能依赖进程内函数调用隐式传递状态。
