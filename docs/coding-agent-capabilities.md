# 通用编码 Agent 能力清单（apps/server 对照）

> 目标：回答「apps/server 现在做的事情是不是就是 Claude Code / Codex 做的事」，以及还差什么。
> 参照系：Claude Code、Codex CLI、Cursor 这类通用编码 agent。
> 基于 `apps/server/src/` 当前实现逐一对照（2025-08-08）。

## 一、通用编码 Agent 的能力全景

一个通用编码 agent 通常由以下几层构成：

| 层 | 能力 | 说明 |
|---|---|---|
| 核心循环 | Agentic loop | 思考 → 调工具 → 看结果 → 继续，直到任务完成或达到步数上限 |
| 环境感知 | 文件系统工具 | list / read / write / edit / search |
| | 终端执行 | 跑命令、超时、输出截断 |
| | 浏览器 | 打开、截图、点击、执行 JS |
| | 代码搜索 | 内容 grep、文件名模式、语义检索 |
| 上下文 | 会话历史 | 多轮对话、流式输出 |
| | 长期记忆 | 跨会话注入用户偏好 |
| | 压缩 | 上下文过长时自动摘要（compact） |
| 工具生态 | MCP | 标准协议接入外部工具 |
| | Skills | 可发现、可选用的提示词/流程包 |
| | 内置工具 | web_search、web_fetch |
| 任务编排 | Subagents | 派生子代理并行做独立子任务 |
| | 计划模式 | plan（只调研不落盘）与 apply（执行）分离 |
| 安全 | 审批 | 敏感操作允许/拒绝/询问 |
| | 权限规则 | 路径白名单、命令白名单 |
| | 沙箱 | 隔离执行环境，限制副作用 |
| 可靠性与体验 | Checkpoint | 变更快照、可回滚 |
| | Hooks | PreToolUse / PostToolUse / Stop 等生命周期钩子 |
| | 崩溃恢复 | 中断后恢复未完成任务 |
| | 用量统计 | token 计数、成本 |
| | 会话归档 | 导入/导出历史 |

## 二、apps/server 已实现

对照上面的全景，apps/server 已经覆盖的部分：

### ✅ 核心循环
- **Agentic loop**：`run-registry.ts` 基于 Vercel AI SDK `streamText` + 工具调用 + `stopWhen(stepCountIs(20))`，支持多步工具调用直至完成。
- **中断/停止**：`AbortController`，`/runs/stop` 接口。
- **流式输出**：UIMessage stream 双 tee（客户端流 + 服务端观察者），SSE 推送 `message.delta`。
- **崩溃恢复**：`run-journal.ts` 在启动时恢复中断的 run 并标记 error。

### ✅ 环境感知
- **文件工具**：`workspace-tools.ts` 提供 list_dir / read_file / write_file / edit_file / search_files，全部限制在 workspace 内（`withinRoot` 路径校验），512KB 文件上限。
- **终端**：`bash` 工具，120s 超时，2MB 输出截断。
- **浏览器**：`client-tools.ts` + `browser-runtime.ts`，隔离的 headless Chromium session，open / screenshot / click / eval / close 全套。

### ✅ 上下文与记忆
- **会话历史**：`store.ts` 持久化，CRUD 齐全。
- **长期记忆**：`memory-store.ts`，可编辑的 JSON 记忆注入 system prompt。
- **标题自动生成**：`deriveTitle` 取首条用户消息前 40 字。

### ✅ 工具生态
- **MCP**：`mcp-runtime.ts` 支持 stdio 子进程 + remote HTTP 两种 transport，start / listTools / callTool / stop / test 全套，手写 JSON-RPC 2.0。
- **Skills**：`skills-store.ts` 扫描 8 个目录（`~/.agents`、`~/.agent`、`~/.codex`、`~/.claude` 及对应 workspace 目录），解析 SKILL.md frontmatter，可多选启用并注入。
- **内置工具**：web_search（responses 协议内置）、图片生成。

### ✅ 模型与配置
- 多模型配置（`chat-config.ts`），任意 OpenAI 兼容 baseUrl。
- responses / chat 双协议（`responsive` 开关）。
- 工具白名单（`toolNames`），客户端工具/服务端工具/业务工具分层选择。

### ✅ 会话归档
- `archive-store.ts`：扫描并导入 `~/.codex`、`~/.claude` 的历史 jsonl 会话，含 index 与详情。

## 三、apps/server 部分实现

| 能力 | 现状 | 差距 |
|---|---|---|
| 权限边界 | 文件路径强制限制在 workspace 内 | 没有「允许/拒绝/询问」交互式审批 |
| 上下文管理 | 无压缩，但 draft 消息 + 增量事件避免全量重发 | 无 auto-compact |
| 并行工具调用 | 依赖模型单次返回多个 tool call（AI SDK 支持并行执行） | 无显式编排 |
| 用量统计 | 归档 index 有 `usageTotal` 字段 | 无实时 token 计数展示/成本估算 |

## 四、apps/server 未实现（→ TODO）

按优先级从高到低：

1. **审批模式**（Permission / Approval）
   - 敏感命令（rm -rf、git push、npm publish）执行前弹窗确认。
   - 会话级「自动允许/总是拒绝」记住选择。
   - 这是从「自己玩的工具」到「敢在真实项目上用的工具」的关键门槛。

2. **沙箱执行**（Sandbox）
   - 可选的隔离环境：容器（如 `bun run --cwd` 隔离 / Docker / seatbelt 类方案）。
   - 限制网络、文件系统副作用的策略开关。
   - 参考：`docs/agent-sandbox-permission-controls.md`、`docs/aisdk-seatbelt-sandbox.md` 已有调研。

3. **Hooks 系统**
   - PreToolUse / PostToolUse / Stop / SessionStart / SessionEnd 等生命周期事件。
   - 可执行用户配置的脚本或 HTTP webhook。
   - 与审批模式天然衔接（hook 可以返回 block/allow）。

4. **Subagents（Task 工具）**
   - 暴露 `task` 工具：把独立子任务（如「调查这个目录的结构」「并行写三个测试文件」）交给子代理执行，返回结构化结果。
   - 需要：子 run 管理、结果回收、与主循环合并。
   - 收益：长任务吞吐、上下文隔离（子任务不污染主上下文）。

5. **Checkpoint / 回滚**
   - 每次 run 前后基于 git 或目录快照保存状态。
   - 支持「回滚到某次变更前」。
   - 依赖：run 生命周期事件已存在（`run.done` / `run.error`），接入成本低。

6. **上下文自动压缩（auto-compact）**
   - 当消息超过阈值时自动生成摘要替换早期消息。
   - 需要：摘要模型调用、压缩后的消息重建、UI 提示「已压缩 N 条消息」。

7. **计划模式（Plan / Apply 分离）**
   - 进入 plan 模式时只允许只读工具（read/search/list），产出计划；确认后切 apply 模式执行。
   - 收益：减少误操作，接近 Claude Code 的默认行为。

8. **Web Fetch 工具**
   - 已有 web_search，缺 `web_fetch`（打开 URL 读正文）。对调研类任务很常用。

9. **终端交互增强**
   - 交互式命令（sudo 密码、选择器）目前无法处理。
   - 至少：检测到交互时提示用户或直接失败并给替代方案。

10. **语义代码搜索 / RAG**
    - 现在只有 grep 级搜索。可接入代码索引（如 ripgrep + embedding），对大仓库提升显著。

11. **实时 token 用量与成本**
    - 前端有 token 统计诉求，服务端归档已有 `usageTotal`，可把每次 run 的用量实时推到 SSE。

12. **会话分享 / 导出**
    - 归档已有 JSON，可加 Markdown/HTML 导出，或生成可分享链接。

## 五、结论

apps/server 已经是一个**结构完整的编码 agent 骨架**：核心循环、文件/终端/浏览器工具、MCP、Skills、记忆、崩溃恢复都有，且分层清晰（客户端工具走 Tauri 侧、服务端工具走 Node 侧、业务工具独立）。

但目前更像「**能对话、能干活的工作台**」，离 Claude Code / Codex 的差距集中在**安全与任务编排**两个方向：

- 安全：审批、沙箱、hooks —— 决定能否在真实项目上放心用；
- 编排：subagents、checkpoint、计划模式 —— 决定能否高效处理复杂长任务。

这两个方向正好对应文档开头那张全景表里「任务编排」和「安全」两行，建议按 TODO 顺序优先做 1–3 项。
