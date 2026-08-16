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

## 非 OpenAI Responses：关闭 `store`

AI SDK 的 OpenAI Responses 实现默认 `store: true`。有 `itemId` 的历史 assistant
文本、reasoning 和 provider-executed 工具会被收成：

```json
{ "type": "item_reference", "id": "<itemId>" }
```

这只在官方 OpenAI（以及同语义的 Azure OpenAI）上成立：服务端保存了上一轮
response，引用即可还原正文。兼容网关和其它供应商通常是无状态的，会静默忽略
`store` / `previous_response_id` / `item_reference`。

因此 ChatDesk 的默认是：

| 模型 | Responses `store` |
| --- | --- |
| `api.openai.com`、`*.openai.azure.com` | 保持 SDK 默认 `true` |
| 其它所有 Responses 供应商（DeepSeek、自定义网关等） | 强制 `false` |

`store: true` 套在无状态 API 上时，下一轮往往只带上用户消息和被忽略的引用。模型
看不到自己已经给出的答案，会把线程里的旧问题再答一遍（例如问 cwd 时重答「你是
哪个模型」，或重搜已经回答过的天气）。

适配器对非 OpenAI 的 Responses 调用强制：

```ts
providerOptions: { openai: { store: false } }
```

SDK 于是把历史 assistant 以 `output_text` / `function_call` 原文放进 `input`。识别
只看规范化后的 `baseUrl` 主机名，不看供应商显示名：即便 provider 写成 `OpenAI`，
只要不是官方 OpenAI 主机，仍会关闭 `store`。

`store: false` 由 `wrapLanguageModel` 的 `transformParams` 注入，覆盖 generate 与
stream，包括 Agent 循环里的后续 step 和上下文检查点。调用方不必再手写
`providerOptions`。DeepSeek 另外仍禁用 `toolChoice: required`，这与 `store` 无关。

## 已知限制

- **Provider-executed `web_search`**：即便 `store: false`，AI SDK 也不会把
  `web_search_call` 按 DeepSeek 要求原样回传。历史终答文本会进入上下文，但搜索
  证据可能丢失；模型仍可能再次联网。这是 SDK 转换层限制，不是 `store` 默认值本身。
- **空 reasoning**：DeepSeek Flash 常返回空的 reasoning 文本且没有
  `encrypted_content`。`store: false` 时 SDK 会丢掉这类 reasoning item。Flash 对
  缺失 thinking passback 通常仍返回 200；Pro 在带工具的多轮里可能更严格。这条
  是预期行为，`ai-sdk-warnings.ts` 只屏蔽对应的 AI SDK Warning，其它警告仍会打出。
- **Chat Completions**：Kimi / MiniMax 的差异仍由各自 fetch 包装处理，不走
  Responses 的 `store` 中间件。

## 以后加供应商时

1. 先确认差异属于 SDK 参数还是 HTTP 请求体。
2. 默认已对非 OpenAI Responses 关闭 `store`。只有确认对端会持久化 item 时，才把
   主机名加入 `isOpenAIResponsesStoreEnabled()`。
3. 请求体字段改写放进该供应商的 fetch 包装，并在 `createConfiguredLanguageModel`
   里接上。
4. 更新本文的供应商表和限制。
