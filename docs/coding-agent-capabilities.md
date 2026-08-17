# 通用编码 Agent 能力清单（apps/server 对照）

> 目标：回答「apps/server 现在做的事情是不是就是 Claude Code / Codex 做的事」，以及还差什么。
> 参照系：Claude Code、Codex CLI、Cursor 这类通用编码 agent。
> 基于 `apps/server/src/` 当前实现逐一对照（2026-08-15）。

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
| | Todo 规划 | 复杂任务拆分为步骤并实时跟踪进度（todo_write） |
| | 计划模式 | plan（只调研、只更新 session 计划文件）与 apply（执行）分离 |
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
- **Agentic loop**：`run-registry.ts` 基于 Vercel AI SDK `streamText` + 工具调用 + `stopWhen(stepCountIs(100))`，支持多步工具调用直至完成；单次模型请求对可重试故障最多重试 3 次。
- **任务规划**：`todo-tool.ts` 提供 `todo_write` 工具（全量替换语义，免审批），系统提示词约定使用时机（3+ 非平凡步骤）与更新节奏（每完成一步即更新）；前端 `chat-todo-panel.tsx` 从消息流派生最新进度，在输入框上方与 git pill 并排展示，hover 查看逐条状态。
- **中断/停止**：`AbortController`，`/runs/stop` 接口。
- **流式输出**：UIMessage stream 双 tee（客户端流 + 服务端观察者），SSE 推送 `message.delta`。
- **崩溃恢复**：`run-journal.ts` 在启动时恢复中断的 run 并标记 error。
- **Plan Mode**：`/plan` 创建 session 级 `plan-<随机版本>.md`；plan mode 只允许读取 workspace 和 `plan_write`，计划通过 `plan.updated` SSE 实时刷新，确认后切换 apply。

### ✅ 环境感知
- **文件工具**：`workspace-tools.ts` 提供 list_dir / read_file / write_file / edit_file / search_files。受限模式默认限制在 workspace 或显式只读白名单内，读取单文件上限为 512KB。
- **文件搜索**：`file-search.ts` 优先调用 ripgrep，支持 glob、大小写不敏感的固定文本搜索、命中行摘要和 `.gitignore`；没有 `rg` 时回退到 Git 文件清单与内置遍历。只启用终端而未启用 `search_files` 时，模型可直接通过 Bash 使用 `rg`。
- **终端**：`bash` 工具，120s 超时，2MB 输出截断。
- **浏览器**：`client-tools.ts` + `browser-runtime.ts`，隔离的 headless Chromium session，open / screenshot / click / eval / close 全套。`browser_screenshot` 把截图写入当前聊天 session 的 `attachments/`（与用户上传、生成图同一目录），落盘前走统一 Sharp 压缩，输出可能是 WebP。开发态用 `import.meta.url` / 仓库相对路径回退到源码 `browser-worker.mjs`；打包态由 Tauri 注入普通 JS worker 路径，Chat Server 使用共享 Node 的 `process.execPath` 启动，缺失则启动失败。

### ✅ 上下文与记忆
- **会话历史**：`store.ts` 持久化，CRUD 齐全。
- **长期记忆**：`memory-store.ts`，可编辑的 JSON 记忆注入 system prompt。
- **标题自动生成**：`deriveTitle` 取首条用户消息前 40 字。
- **自动压缩**：`prepareStep` 在上下文超过动态阈值时剪枝旧 reasoning 与工具结果，并通过 SSE 和消息 metadata 向用户提示；完整聊天记录不受影响。详见 `docs/chat-context-compaction.md`。

### ✅ 工具生态
- **MCP**：`mcp-runtime.ts` 支持 stdio 子进程 + remote HTTP 两种 transport，start / listTools / callTool / stop / test 全套，手写 JSON-RPC 2.0。
- **Skills**：`skills-store.ts` 扫描 8 个目录（`~/.agents`、`~/.agent`、`~/.codex`、`~/.claude` 及对应 workspace 目录），解析 SKILL.md frontmatter，可多选启用并注入。
- **内置工具**：web_search（responses 协议内置）、图片生成。

### 内置工具目录

下表记录 Chat 运行时直接注册的工具。MCP 工具由已连接的服务器动态提供，不属于固定内置清单。

| 工具 | 用途与关键输入 | 前置条件 | 执行与权限 |
|---|---|---|---|
| `todo_write` | 全量更新任务步骤与状态 | Apply 模式、模型支持工具 | 服务端内存工具，不访问 workspace |
| `plan_write` | 写入当前 session 的计划内容 | Plan 模式且存在 active plan | 服务端写入计划存储，不开放普通写文件工具 |
| `list_dir` | 列出 `path` 下的文件和目录 | 已选择 workspace，并启用对应工具包 | 结构化文件 helper；受沙箱和读取白名单限制 |
| `search_files` | 用 `pattern` glob 搜文件名，或用 `query` 搜内容；返回路径及首个命中行 | 已选择 workspace，并启用对应工具包 | 优先 ripgrep，内置实现回退；遵循 Git ignore，结果上限 500 |
| `read_file` | 读取 `path` 文本内容 | 已选择 workspace，并启用对应工具包 | 结构化文件 helper；单文件上限 512KB |
| `write_file` | 创建或完整覆盖 `path` | Apply 模式、已选择 workspace，并启用对应工具包 | 写操作进入沙箱审批路径 |
| `edit_file` | 对 `path` 做唯一 `oldText` → `newText` 替换 | Apply 模式、已选择 workspace，并启用对应工具包 | 写操作进入沙箱审批路径；拒绝 0 次或多次匹配 |
| `bash` | 在 workspace 中执行 `command` | 已选择 workspace，并启用“终端” | 默认 120 秒、2MB 输出上限；权限由 ask/auto/full 模式决定 |
| `browser_open` | 打开 URL，创建或复用 browser session | 启用 Browser，且已配置 browser worker | 隔离 Headless Chromium，不继承用户登录态 |
| `browser_screenshot` | 截取 browser session 页面，压缩后落入当前聊天 session 的 attachments | 启用 Browser，已有 session | Headless Chromium；内部写入 `sessions/<id>/attachments/`，可能是 WebP |
| `browser_click` | 按 CSS selector 点击页面元素 | 启用 Browser，已有 session | Headless Chromium |
| `browser_eval` | 在页面执行受限长度的 JavaScript 表达式 | 启用 Browser，已有 session | Headless Chromium 页面上下文 |
| `browser_close` | 关闭 browser session | 启用 Browser，已有 session | Headless Chromium |
| `web_search` | 查询近期公开信息 | 启用 Web Search，模型使用 Responses API | OpenAI Responses provider 内置工具 |
| `image_generation` | 按 prompt、宽高比和分辨率生成图片 | 启用 Image Generation，并配置 KIE API Key | 服务端 KIE 请求，等待任务完成后返回 URL |

固定工具的参数 schema 以 `client-tools.ts`、`workspace-tools.ts`、`business-tools.ts`、`todo-tool.ts` 和 `plan-tool.ts` 为准；设置页工具包及可用性以 `apps/desktop/src/lib/chat-tools.ts` 为准。

### ✅ 模型与配置
- 多模型配置（`chat-config.ts`），任意 OpenAI 兼容 baseUrl。
- responses / chat 双协议（`responsive` 开关）。
- 工具白名单（`toolNames`），客户端工具/服务端工具/业务工具分层选择。

### ✅ 安全与审批
- **三层沙箱模式**：`sandboxMode` 支持 `ask`（工作区内读操作直接执行，写入/越界暂停等待用户批准）、`auto`（先在沙箱内执行，仅实际被拦截时交 reviewer 判断）、`full`（不使用 Seatbelt，允许外部路径）。
- **Seatbelt 沙箱执行**：`sandbox-exec.ts` 使用 macOS Seatbelt `(deny default)` profile，限制工作区外写入和网络访问；非登录 shell（`-c`）、最小化环境变量、独立 `HOME` 和缓存目录。
- **工具审批**：`createToolApproval` 在 AI SDK `toolApproval` 回调中实现交互式审批，区分 workspace 工具与非 workspace 工具，支持已批准的 toolCallId 重放。
- **边界 Reviewer**：`sandbox-boundary-reviewer.ts` 对越界操作做 AI 辅助判断，`auto` 模式下可自动批准或拒绝沙箱拦截后的重试。
- **审批日志**：`sandbox-review-log.ts` 记录每次审批决策（approver/reviewer/user-approval）、原因和错误信息。
- **结构化文件沙箱 worker**：`runSandboxedFile` 通过独立子进程执行 `list_dir`/`read_file`/`search_files`/`write_file`/`edit_file`，打包后解析 `chat-server-sandbox` 二进制；成功解析结构化响应后仅依据 `blocked` 字段判断沙箱拒绝，避免把文件内容中的安全关键词误判为控制信号。
- **额外读取目录白名单**：Settings > 沙箱页面可配置 `sandboxReadablePaths`，加入 Seatbelt 只读范围。

### ✅ 用量统计
- **AI Usage 日志**：`ai-usage-log.ts` 持久化每次 AI 调用的 token 用量（输入、输出、缓存读写、推理 token），`GET /v1/ai-usage` 接口可查询。
- **实时用量**：`messageMetadata` 在 `onFinish` 时写入 `usage: part.totalUsage`，前端可直接从消息 metadata 读取。
- **Git commit 消息生成**：自动生成 commit message 时也记录 AI usage。

### ✅ 会话归档
- `archive-store.ts`：扫描并导入 `~/.codex`、`~/.claude` 的历史 jsonl 会话，含 index 与详情。

## 三、apps/server 部分实现

| 能力 | 现状 | 差距 |
|---|---|---|
| 上下文管理 | 已支持基于窗口阈值剪枝旧 reasoning 与工具结果 | 第一版不生成早期自然语言对话摘要 |
| 并行工具调用 | 依赖模型单次返回多个 tool call（AI SDK 支持并行执行） | 无显式编排 |
| Checkpoint / 回滚 | Git diff/restore/commit 接口已实现（`app.ts`） | 无基于 run 生命周期的自动快照 |

## 四、apps/server 未实现（→ TODO）

按优先级从高到低：

1. **Hooks 系统**
   - PreToolUse / PostToolUse / Stop / SessionStart / SessionEnd 等生命周期事件。
   - 可执行用户配置的脚本或 HTTP webhook。
   - 与审批模式天然衔接（hook 可以返回 block/allow）。

2. **Subagents（Task 工具）**
   - 暴露 `task` 工具：把独立子任务（如「调查这个目录的结构」「并行写三个测试文件」）交给子代理执行，返回结构化结果。
   - 需要：子 run 管理、结果回收、与主循环合并。
   - 收益：长任务吞吐、上下文隔离（子任务不污染主上下文）。

3. **Checkpoint / 回滚**
   - 每次 run 前后基于 git 或目录快照保存状态。
   - 支持「回滚到某次变更前」。
   - 依赖：run 生命周期事件已存在（`run.done` / `run.error`），接入成本低。

4. **Web Fetch 工具**
   - 已有 web_search，缺 `web_fetch`（打开 URL 读正文）。对调研类任务很常用。

6. **终端交互增强**
   - 交互式命令（sudo 密码、选择器）目前无法处理。
   - 至少：检测到交互时提示用户或直接失败并给替代方案。

7. **语义代码搜索 / RAG**
    - 现在只有 grep 级搜索。可接入代码索引（如 ripgrep + embedding），对大仓库提升显著。

8. **会话分享 / 导出**
    - 归档已有 JSON，可加 Markdown/HTML 导出，或生成可分享链接。

## 五、结论

apps/server 已经是一个**结构完整的编码 agent**：核心循环、文件/终端/浏览器工具、MCP、Skills、记忆、崩溃恢复、Seatbelt 沙箱、交互式审批、AI 用量统计都有，且分层清晰（客户端工具走 Tauri 侧、服务端工具走 Node 侧、业务工具独立）。

离 Claude Code / Codex 的差距集中在**任务编排**方向：

- 编排：subagents、checkpoint、计划模式 —— 决定能否高效处理复杂长任务；
- 生命周期：Hooks 系统 —— 决定能否接入自定义工作流。

这些方向对应文档开头全景表里「任务编排」和「可靠性」两行，建议按 TODO 顺序优先做 1–4 项。
