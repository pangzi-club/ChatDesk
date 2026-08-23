---
name: chatdesk-doc
description: ChatDesk 产品用法指南。在用户询问如何使用 ChatDesk、功能在哪、设置入口、模型/API Keys/MCP/Skills/沙箱/环境/快捷键怎么配、第一次如何开始、Chat 工具栏或分屏工作区怎么用时使用。
---

# ChatDesk 使用说明

先读本文件再作答。需要某一设置页或 Chat 细节时，再用 `read_skill` 读取 references。

## 答法

- 跟随用户语言。
- 用界面路径，不写源码路径、仓库文件或内部实现。
- 先给入口，再给页内要点。不要整页复述。
- 不要把工程师文档（架构、打包、沙箱实现）讲给最终用户。

## 入口

- 打开设置：侧栏底部头像菜单 → Settings。也可以 ⌘/Ctrl+K 搜「设置」或页面名。
- 侧栏里的「搜索设置...」只是占位，不能点、不能搜。真正可搜的是 ⌘/Ctrl+K。
- 设置是覆盖式全屏布局，用「返回应用」回到 Chat。
- 第一次：Settings → API Keys 填密钥 → 模型里添加模型 → 回到 Chat 选 workspace 开聊。

## 参考

- 各设置页：`read_skill`，`skillId` 为 `builtin:chatdesk-doc`，`path` 为 `references/settings.md`
- Chat 与工作区：`path` 为 `references/chat.md`
