# 设置页地图

打开方式：侧栏底部头像 → Settings，或 ⌘/Ctrl+K 搜页面名。设置是覆盖式布局，用「返回应用」回到 Chat。

| 页面 | 路由 | 做什么 |
|---|---|---|
| 常规 | `/settings/general` | 通知等通用行为 |
| 主题 | `/settings/theme` | 明暗、配色、对话字体 |
| 快捷键 | `/settings/shortcuts` | Chat 侧栏等键盘组合键 |
| API Keys | `/settings/keys` | 本机密钥；不回显，输入新值即覆盖 |
| 模型 | `/settings/models` | OpenAI 兼容模型，以及自动审批用的 Reviewer |
| MCP | `/settings/mcp` | 从 Registry 添加 MCP，并在 Chat 里选用 |
| Skills | `/settings/skills` | 安装本机 `.agents` / `.codex` / `.claude` 的 SKILL.md，供 Chat 工具栏启用。产品说明、创建 skill、从 GitHub 安装是内置的，不必在这里安装 |
| Tools | `/settings/tools` | Chat 可调用的本地开发、终端、联网和业务工具包 |
| 沙箱 | `/settings/sandbox` | 受限 Bash 的额外只读目录；不能通过沙箱写入 |
| 环境 | `/settings/environment` | 受限终端可调用的本机开发工具 PATH |
| 长期记忆 | `/settings/memory` | 跨会话用户记忆 |
| 托盘 | `/settings/tray` | 菜单栏 / 系统托盘 |
| Chat Server | `/settings/chat-server` | 本地服务端口，或手动重启 |
| 使用量 | `/settings/statistics` | 本机 token 统计；可导入对话 |
| 活动记录 | `/settings/logs` | 本机运行日志 |

第一次建议顺序：API Keys → 模型 → 回到 Chat 选 workspace。
