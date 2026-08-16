# 模型适配（Model Adaptor）

ChatDesk 通过 `@ai-sdk/openai` 接入 OpenAI 兼容的 Chat Completions 和 Responses
API。供应商在协议细节上并不一致：有的参数会被静默忽略，有的默认值会把多轮历史
发成对端无法解析的引用。`apps/server/src/model-adaptor.ts` 把这些差异收口到创建
语言模型的路径上，避免每个 `streamText` / `generateText` 调用点各自打补丁。

现有请求体改写仍放在供应商自己的 fetch 包装里：Kimi 见 `apps/server/src/kimi.ts`，
MiniMax 见 `apps/server/src/minimax.ts`。适配器负责 **SDK 调用参数**（例如
`providerOptions`），fetch 包装负责 **HTTP JSON 字段**。

## 接入点

所有服务端模型调用应使用 `createConfiguredLanguageModel()`，包括：

- Agent run（`run-registry.ts`）
- 会话标题
- 沙箱越界 reviewer
- Git 提交说明
- 设置页模型连通性测试

该函数会：

1. 规范化 `baseUrl`（去掉尾斜杠和 `/chat/completions`、`/responses` 后缀）
2. 按供应商套上 Kimi / MiniMax fetch
3. 对 `responsive` 模型走 `provider.responses()`，否则走 `provider.chat()`
4. 对无状态 Responses 供应商包一层 `wrapLanguageModel` 中间件

## DeepSeek Responses：关闭 `store`

AI SDK 的 OpenAI Responses 实现默认 `store: true`。有 `itemId` 的历史 assistant
文本、reasoning 和 provider-executed 工具会被收成：

```json
{ "type": "item_reference", "id": "<itemId>" }
```

这在 OpenAI 上成立：服务端保存了上一轮 response，引用即可还原正文。

DeepSeek Responses API 是无状态的：

| OpenAI 参数 | DeepSeek |
| --- | --- |
| `store` | 不支持，响应里恒为 `store: false` |
| `previous_response_id` / `conversation` | 不支持 |
| `item_reference` | 属于未列出的 input 类型，**静默忽略** |
| 多轮上下文 | 客户端必须在每次请求的 `input` 里发送完整历史 |

因此默认 `store: true` 时，下一轮请求只带上用户消息和被忽略的引用。模型看不到自己
已经给出的答案，会把线程里的旧问题再答一遍（例如问 cwd 时重答「你是哪个模型」，
或重搜已经回答过的天气）。

适配器对 DeepSeek 的 Responses 调用强制：

```ts
providerOptions: { openai: { store: false } }
```

SDK 于是把历史 assistant 以 `output_text` / `function_call` 原文放进 `input`，而不是
`item_reference`。识别规则与 `supportsRequiredToolChoice` 相同：`provider`、
`baseUrl` 或 `name` 包含 `deepseek`。

`store: false` 由 `wrapLanguageModel` 的 `transformParams` 注入，覆盖 generate 与
stream，包括 Agent 循环里的后续 step 和上下文检查点。调用方不必再手写
`providerOptions`。

## 已知限制

- **Provider-executed `web_search`**：即便 `store: false`，AI SDK 也不会把
  `web_search_call` 按 DeepSeek 要求原样回传。历史终答文本会进入上下文，但搜索
  证据可能丢失；模型仍可能再次联网。这是 SDK 转换层限制，不是 `store` 默认值本身。
- **空 reasoning**：DeepSeek Flash 常返回空的 reasoning 文本且没有
  `encrypted_content`。`store: false` 时 SDK 会丢掉这类 reasoning item。Flash 对
  缺失 thinking passback 通常仍返回 200；Pro 在带工具的多轮里可能更严格。
- **Chat Completions**：Kimi / MiniMax 的差异仍由各自 fetch 包装处理，不走
  Responses 的 `store` 中间件。

## 以后加供应商时

1. 先确认差异属于 SDK 参数还是 HTTP 请求体。
2. 无状态 Responses（忽略 `store` / `item_reference`）加入
   `usesStatelessResponsesApi()`。
3. 请求体字段改写放进该供应商的 fetch 包装，并在 `createConfiguredLanguageModel`
   里接上。
4. 更新本文的供应商表和限制。
