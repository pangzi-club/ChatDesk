# Desktop 代码审查（2026-09）

本文记录 2026-09-11 对 `apps/desktop/src` 的整体代码审查结果，覆盖 `pages/`、`components/`、`layouts/`、`lib/`、`hooks/`、`router/`，约 4.2 万行。整体结论：列表数据普遍使用 `@tanstack/react-query` + skeleton，破坏性操作普遍使用 `AlertDialog`，事件监听清理基本到位，代码库基础质量良好。下文按优先级列出值得修复的问题，均附文件与行号（行号对应审查时的 `main` 分支，后续提交可能漂移）。

建议的修复顺序：先修「P0 Bug 与规则违反」（其中死代码删除零风险），再处理「P1」里聊天页性能两项（收益最大），「P2 结构拆分」按页面渐进进行。

## P0：Bug 与规则违反

### 1. app-shell 硬编码 Chat Server 端口 14317

`apps/desktop/src/layouts/app-shell.tsx:442` 直接 `subscribeChatServerEvents(14317, ...)`，而端口是用户可配置的：同文件 1905 行、`pages/chat.tsx:979` 都会动态 `loadChatServerPort()`。用户修改端口后，飞书未读数、消息通知、`["feishu-unread"]` 失效逻辑会静默失效。

另外 `CHAT_SERVER_DEFAULT_PORT` 默认值在三处独立定义：`lib/server/chat-server.ts:37`、`apps/server/src/config.ts:14`、`packages/desktop-host/src/chat-server-supervisor.ts:53`（该常量目前没有任何 `.tsx` 引用）。应收敛到 `packages/shared` 并全仓使用。

### 2. 长期记忆的模型调用绕过 usage 统计

`lib/chat/chat-memory-ops.ts:82-137` 的 `generateModelText` 在浏览器端直接调用 AI SDK `generateText` 或裸 `fetch` POST `/chat/completions`，`result.usage` / response usage 字段被丢弃，没有任何持久化。这违反 AGENTS.md 的 AI 记账规则（"every AI/model invocation must record its token usage"）。

触发路径：

- 每轮对话后自动执行：`pages/chat.tsx` 的 `scheduleMemoryUpdateFromTurn` → `extractFactsFromTurn`；
- 手动整理：`pages/settings.tsx` 的 `handleCompact` → `compactChatMemory`。

这部分 token 消耗不会出现在 `["ai-usage-statistics"]` 统计中。建议改走 Chat Server（如 `regenerateChatSessionTitle` 的做法），或至少从返回中解析并记录 usage。

### 3. settings.tsx 订阅泄漏竞态

`pages/settings.tsx:490-501`（ComputerUseSettingsPage）：

```ts
void bridge.subscribe("computer-use-status", ...).then((dispose) => {
  unsubscribe = dispose;
});
return () => unsubscribe?.();
```

若组件在 promise resolve 前卸载，cleanup 时 `unsubscribe` 仍为 `undefined`，订阅永久泄漏。`app-shell.tsx:690-696` 有正确写法（`active` 标志 + resolve 后补偿清理），应复用同一模式或提取共享的 `subscribeBridgeEvent` 帮助函数。

### 4. 约 740 行死代码

- `pages/history-analysis.tsx`（296 行）整个文件无任何引用；其内部「回到 History」链接指向 `/settings/history`，该路由已被 `router/routes.tsx:53` 重定向到 statistics。
- `pages/history.tsx` 中 `HistoryPage`（约 440 行）未挂载，只有 `HistoryDetailPage` 被 routes 使用。随之可删：列表视图与 `embedded` prop（110-445 行）、模块级滚动恢复 store 及其 effects（70-92、207-250 行）、`EmptyHistory`、`HistoryListSkeleton`、文件内唯一的 `useVirtualizer` 引用、406 行处的 `HistoryImportDialog` 用法（存活的一份在 statistics.tsx:329）。

### 5. 两处破坏性操作缺少确认

- MCP 服务器删除：`pages/settings.tsx:2345-2353` 直接删除；且 `install`（2290）、`remove`（2347）、`toggleDefault`（2329）均为无 `.catch` 的 async 调用，失败时产生 unhandled rejection 且无用户反馈。
- 插件卸载：`pages/plugins.tsx:386-393` 与 `pages/plugin-detail.tsx:91-93` 的「卸载」直接执行；`plugins.tsx:287-294` 移除外部插件目录同样无确认。

其余破坏性操作均已使用共享 `AlertDialog`，这两处是规则缺口。相关不一致：automations 的删除确认用的是普通 `Dialog` 而非 `AlertDialog`。

### 6. 同一份数据使用两个 query key

- `pages/settings.tsx:2433`：`["skills-available"]`
- `pages/settings.tsx:3019`：`["available-skills"]`（同一个 `loadAvailableSkills` queryFn）

双份缓存导致重复请求与 staleness，`pages/chat.tsx:1058-1059` 被迫两个 key 都失效。应提取共享的 query-key 常量（如 `lib/server/skills.ts`）。

## P1：React 正确性与性能

### 7. 聊天输入每敲一个字重渲染整个 ChatPage

`pages/chat.tsx` 中 `input`（431）、`composerPlain`（455）、`commandCaret`（456）都住在 ChatPage 组件内，每次按键 `setInput` 触发 4000 行组件全量重渲染。`MessageBubble` 虽为 `memo`（3723），但被每次渲染重建的 `forkConversation`（2313，2805 处传入）全部击穿；锚定消息的 `planAttachment`/`generationStatus` 内联对象字面量（2810-2832）同样破坏 memo。

每次渲染重复执行的热路径计算：`sortModelsByName(models)`（427）、`promptKey` 两次 `JSON.stringify` + join（634-641）、`canFormatChatConversationMarkdown(messages)` 全量遍历（2328）。

修法（按成本递增）：`forkConversation` 包 `useCallback`、三处计算加 `useMemo`、把 composer 状态下沉到 `ChatComposerInput`（通过 ref 暴露值，组件已有 `replaceRange` 先例）。

### 8. SSE 期间 chat-index 被逐事件失效

`layouts/app-shell.tsx:2050、2065`：`subscribeChatServerEvents` 的每次 `onStatus`（包括 `submitted → streaming` 这类 token 级流转）都 `invalidateQueries({ queryKey: ["chat-index"] })`。一次运行中反复全量拉取会话索引并重渲染 `WorkspaceConversationGroups`（其约 15 个 `ConversationSidebarRow` 子组件未 memo 且每次接收新建的内联回调，2348-2352、2493-2497）。应只在 run 完成时失效，或做防抖。

### 9. 背景刷新会覆盖用户正在编辑的设置草稿

以下均为「query data 到本地 draft 的 useEffect 拷贝」模式，而 query 默认窗口聚焦重拉（未设 `refetchOnWindowFocus: false`），用户改到一半的输入会被静默覆盖：

- SandboxSettingsPage：`pages/settings.tsx:1649-1651`（`sandboxReadablePaths`）
- EnvironmentSettingsPage：`pages/settings.tsx:1855-1857`（`developerToolPaths`）
- ChatServerSettingsPage：`pages/settings.tsx:2584-2586`（端口）

建议改为 keyed remount 或渲染期派生 + dirty 守卫。

### 10. MCP 市场搜索每个按键发一次请求

`pages/settings.tsx:2141-2145` 的 queryKey 直接包含 `search`，`setSearch` 在每次 onChange 触发（2244），每个按键都新建 query key 并发起 `fetchMcpRegistry` 网络请求。`pages/chat.tsx:2404-2423` 已有 500ms 防抖的正确范例，可照搬或改为客户端过滤（SkillsSettingsPage 的做法）。

### 11. settings-store 的 JSON.parse 无保护

`lib/settings/settings-store.ts:24-29`：settings.json 一旦损坏，`load()` 永远抛错且 `loaded` 保持 false，所有 `get/set/save` 全部失败；`lib/plugins/desktop-ui.ts:671` 等调用点没有兜底，插件启动会挂。另外并发 `get()` 各自访问一次 bridge，应缓存 load promise。修复：parse 包 try/catch（损坏时回退 `{}`）+ in-flight promise 去重。

### 12. app-shell 飞书未读数绕开 react-query 自建状态

`layouts/app-shell.tsx:417、432-467`：`feishuUnreadCount` useState + 手动 `refresh()`，与 `pages/channels.tsx:55` 的 `["feishu-unread"]` query 平行维护两份数据；app-shell 自己还在 444、459 行失效该 key。应改为订阅同一个 query（在相同事件上 refetch）。

### 13. 渲染期间执行副作用

`layouts/app-shell.tsx:3255`：`ChatWorkspaceWindow` 的 render body 中直接调用 `desktopUi.trackWorkspaceTabs(state.tabs, tabScope)`，会修改 `lib/plugins/desktop-ui.ts:516` 的服务端 Map。应移入以 `state.tabs`/scope 为依赖的 `useEffect`。

## P2：结构（最大的技术债）

### 14. 三个 4000+ 行的文件

- `pages/settings.tsx`：4369 行，17 个设置页 + 3 个对话框挤在一处。应按页面拆到 `pages/settings/*.tsx`。
- `layouts/app-shell.tsx`：4290 行。
- `pages/chat.tsx`：4188 行，60+ 个 useState/useRef、约 25 个 useEffect，混合路由水合、SSE 分发、plan 状态机、队列、选择工具栏、composer 弹窗与全部渲染。

其中两点与 AGENTS.md 目录职责冲突：

- `ChatWorkspaceWindow`（app-shell.tsx:2727-3797，约 1070 行：文件树、git 面板、编辑器 tab、拖拽调宽、tab 拖放）与 `WorkspaceConversationGroups`（1890-2606，约 715 行）是完整产品界面而非 layout chrome，应搬到 `components/`。`chatWindowStates` 及五个订阅 effect（948-1263）建议提取为 reducer + provider。
- `ChannelDialog`（settings.tsx:1162-1273）、`AgentDialog`（3265-3416）、`ModelDialog`（3980-4284）三个手写 `fixed inset-0` modal 未使用共享 `Dialog`，焦点陷阱 / ESC 行为与别处不一致。`ModelDialog` 同时用 `queryClient.ensureQueryData`（3799）与 `useQuery({ enabled: false })`（3758）操作同一 key，应二选一。约 210 行 provider 预设常量（2805-2944）应移入 `lib/server/`。

其他可提取项：

- `CommandMenu`（app-shell.tsx:3922-4150）与 `ChatSearchMenu`（4152-4275）约 90% 重复（相同容器、输入、键盘导航、skeleton、footer），可提取参数化 palette 组件。
- chat.tsx 的持久化 effect（1574-1674，约 100 行，靠 `savedFingerprintRef` 等三个 ref 指纹协调保存、图片/截图物化、`chat-index` 失效、记忆调度）本质是持久化服务，应移到 `lib/chat/` 以便可单测。`waitForCanonicalSession`（4092-4108）50ms 轮询 8 次的做法可换服务端 settled 信号。
- chat.tsx 与 app-shell.tsx 各自维护一份相同的 `serverStatuses` 记录（chat.tsx:976-1132 / app-shell.tsx:2044-2069），可提取 `useChatServerSessionEvents`；另有 `useChatSessionHydration`、`usePlanMode`、`useComposerPopups`、`useSelectionToolbar` 等自然切分。

## P3：重复代码（值得一次性收敛）

### 15. 设置读写六连抄

同一套「desktop store 优先、localStorage 兜底、写后派发 change 事件」约 200 行在六处复制，仅 key 名与 normalize 函数不同：

- `lib/settings/general-settings.ts:37-71`
- `lib/settings/chat-settings.ts:27-59`
- `lib/settings/developer-settings.ts:28-62`
- `lib/settings/voice-settings.ts:14-31`（唯一没有 try/catch 兜底的一处）
- `lib/chat/chat-sandbox.ts:28-59`（server-config 优先变体）
- `lib/runtime/shortcuts.ts:113-147`

一个 `createSettingsAdapter<T>({ storeKey, storageKey, eventName, normalize })` 可全部收编，顺带统一 localStorage key 前缀（现状混用 `m-dashboard-*-v1` 与 `chatdesk-*-v1`）。注意：派发的 `general-settings-change` / `voice-settings-change` / `developer-settings-change` 事件在 src 内没有任何监听者（仅 `chat-display-settings-change` 被 `pages/chat.tsx:1139` 以字符串字面量消费），属死代码或应改为类型化订阅。

### 16. 窗口事件总线九连抄

`browser-preview-events`、`side-chat-events`、`image-preview-events`、`file-viewer-events`、`plan-viewer-events`（3 个事件）、`context-detail-events`（2 个事件）都是相同的 dispatch + 类型化 subscribe 六行样板，合计约 120 行。提取 `createWindowEventBus<T>(name)` 到 `lib/runtime/` 即可消除。

### 17. 小粒度重复

- `mergeAttachments` 逐字节相同出现 3 次：`lib/chat/chat-attachments.ts:133-143`、`lib/chat/chat-image-generation.ts:131-141`、`lib/chat/chat-browser-screenshots.ts:49-58`。
- `isRecord`/`asRecord` 以 3 个名字出现 6 次（chat-image-generation、chat-browser-screenshots、mcp、image-generation-library、importers/codex、importers/claude-code）；`fileNameFromPath`、`guessImageMediaType`/`guessMediaType`、`cleanString` 同类。
- 飞书 API 双实现：`lib/server/chat-server.ts:963-1039` 的 9 个函数与 `ChatServerClient` 已有方法重复且错误处理更差（裸 body 文本 vs 提取 `payload.error`），应委托 client。
- 四个仅字面量不同的 archive 扫描函数：`lib/archive/chat-archive.ts:295-317`（codex/claude/cursor/kimi），可合并为 `scanArchiveSessions(source)`。
- 跨文件重复：`describeError`（settings.tsx:182 / app-shell.tsx:2676）、`pathBasename`（app-shell.tsx:2661 / chat.tsx:3566）、「导入开发环境」AlertDialog（settings.tsx:2103-2127 / chat.tsx:3516-3559）、会话标题重生成/保存（app-shell.tsx:2177-2192 / chat.tsx:2341-2364）、Chat Server 端口加载 effect（app-shell.tsx:1999-2007 / chat.tsx:977-981）。

### 18. usage 统计加载策略两极且都重

- `lib/usage/chat-usage.ts:355-365`：`analyzeHistoryUsage` 逐会话串行 `await`，N 次往返的瀑布。
- `lib/usage/ai-usage-statistics.ts:171-190`：同一问题用无界 `Promise.all` 反向极端。

两者都为求和 token 元数据下载完整会话正文，值得共享一个限并发加载器，或增加服务端 usage 汇总端点。

## P4：小问题

- `pages/automations.tsx:640-648`：一个没有 `onClick` 的「更多操作」图标按钮，对用户呈现为坏掉的入口。删除或补全。
- `pages/image-generation.tsx:380-388、440-443`：`copied` 置 true 后永不复位，按钮一次复制后永远显示「已复制」。参照 `chat-context-dialog.tsx:41` 的 1.5s 复位模式。
- `components/theme-provider.tsx`：174-213 行 context value 每次渲染重建（无 `useMemo`），所有消费者跟着重渲染；222-230 行的 undefined 守卫因 context 有默认值（47-54）而永远不可达，缺 Provider 时静默无操作而非报错；93-112 与 114-130 两个相同的 mount-sync effect 可合并。
- `components/titlebar.tsx:7-19`：拖拽区有 `role="button"` 但没有 click 处理器，注释描述的「双击切换最大化」未对鼠标实现，交互角色与行为不匹配。
- `lib/server/chat-server.ts:203-212`：`createClient(port)` 每次调用新建 `ChatServerClient`（约 45 处调用），未来任何 per-client 状态（连接池、AbortController）都会静默失效，应按端口缓存单例；`resolveChatServerRequestInput`（186-191）是忽略入参的空壳抽象。
- `components/history-import-dialog.tsx:314-319`：首次扫描用 spinner 文本替代列表 skeleton，是全应用唯一违反 skeleton 规则的地方。
- `lib/settings/voice-settings.ts:15`：desktop 分支无 try/catch，与 general/chat/developer-settings 不一致，bridge 故障直接冒泡到 UI。
- `lib/plugins/external-plugins.ts:9`：`lib/` 内出现 React 值导入（为插件 `require("react")` 提供宿主实例），与 AGENTS.md「lib 仅允许 React 类型导入」冲突，要么在 AGENTS.md 记录例外，要么把宿主 React 供给移到 `components/`。
- `pages/components 直接调用 desktop bridge`：`components/titlebar.tsx:16`（`toggleWindowMaximize`）、`layouts/app-shell.tsx:687-712`（裸 `bridge.subscribe("tray-chat"...)`，同文件还有第二份拷贝）、`pages/settings.tsx:454`、`pages/chat.tsx:1076`。应在 `lib/runtime/` 增加薄封装。
- `pages/voice-settings.tsx:15-27`：把 query data 拷进本地 state 的镜像模式，且 `const next = { enabled }` 会静默丢弃未来新增字段；应直接渲染 `settingsQuery.data ?? DEFAULT` 并用 mutation / `setQueryData` 更新。
- `pages/channels.tsx`：`clearUnread`（150-168）与 `select`（184-194）重复同一段标记已读序列，62-64 行的强制 refetch effect 与 react-query 挂载即取的行为重复。
- `hooks/use-toast.ts:5-6`：固定 5s duration，无 per-toast `duration` 选项，需要用户交互的错误 toast 也会 5 秒消失。
- `lib/plugins/desktop-ui.ts`：slot 注册表四处同步维护（42-67 slot union、402-428 definitions、455-481 snapshots，加上 `@chatdesk/shared` 的 `DESKTOP_UI_SLOTS`），加一个 slot 需要改四处。
- `lib/server/chat-server.ts:389`：唯一一处超时是魔法数字 `AbortSignal.timeout(1500)`；`lib/server/mcp.ts:116-121` 的 `fetchMcpRegistry` 对外部 registry 无超时无 abort；其余约 40 个加载函数均不支持 AbortSignal。

## 已核查无问题项

以下经过专项核查，确认干净，无需行动：

- 三个巨型文件内无 `window.confirm` / 原生确认框（grep 验证）；全 desktop src 亦无。
- `lib/` 无 JSX；`@chatdesk/chat-server-client` 未被 pages/components 直接导入；`lib/` 根目录仅 `utils.ts`。
- `regenerateChatSessionTitle` 走 Chat Server（`lib/server/chat-server.ts:888`），服务端有记账。
- 列表 key 一致使用稳定 id/path，未发现 index key。
- `chat-composer-input.tsx` 正确处理 IME composition（`isComposing`/keyCode 229 守卫后再代理 Enter）。
- `chat-terminal.tsx` 清理 ResizeObserver/MutationObserver/rAF；`chat-message-nav.tsx`、`chat-todo-panel.tsx` 清理定时器。
- `lib/runtime/terminal.ts`、`lib/plugins/desktop-ui.ts` 的订阅/释放生命周期正确；`lib/server/mcp-client.ts` 指纹缓存与关闭路径可靠；`desktop-fetch.ts` 的 abort 竞态处理正确（含预中止场景）。
- `components/ui/` 仅含展示原语，无产品行为。
