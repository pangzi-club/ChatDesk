# ChatDesk 自动上下文压缩

本文记录 ChatDesk 编码 Agent 的自动上下文压缩策略、运行时数据流和界面提示。实现位于
Chat Server 的 run 循环中，适用于使用 `streamText` 执行的多步工具任务。

## 上下文窗口与触发阈值

ChatDesk 按以下优先级确定模型输入窗口：

1. 模型配置中有效的 `inputContext`。
2. 供应商模型列表返回并保存的 `context_length`。
3. ChatDesk 内置模型预设提供的窗口。
4. 用户为自定义模型填写的“输入上限”。
5. 无法获知时使用 `128,000` tokens 的默认窗口。

默认窗口是 ChatDesk 的兼容性回退值，不代表供应商声明。共享包中的
`resolveModelContextWindow` 是服务端和上下文弹窗的统一解析入口。

早期 ChatDesk 配置可能为 `deepseek-v4-flash` 或 `deepseek-v4-pro` 保存过 128K
窗口。模型配置加载时会把这一特定旧值迁移为当前内置预设的 1M；其他显式配置值仍优先保留。

自动压缩阈值按以下公式计算：

```text
min(floor(contextWindow * 0.75), 750,000)
```

因此，未知模型的默认 128K 窗口会在 96K 触发，1M 及更大窗口模型最多在 750K 触发；
小于 1M 的模型仍按窗口的 75% 触发。

## 压缩规则

Chat Server 在 `streamText.prepareStep` 中检查将发送给当前模型步骤的 `ModelMessage[]`。
消息 token 数使用 `JSON.stringify(messages).length / 4` 取整估算，并与上一轮供应商返回的实际
`inputTokens` 取较大值。超过阈值时调用 AI SDK
的 `pruneMessages`：

- 删除所有 assistant reasoning 内容；
- 删除最后 3 条消息之前的工具调用、工具结果和工具审批内容；
- 删除剪枝后没有内容的消息。

只有剪枝后的估算 token 数确实下降时，才认为发生了一次压缩。`prepareStep` 返回的新消息会
成为本次 Agent 循环后续步骤的基础，因此旧工具结果不会在下一步恢复；之后积累出新的旧工具
结果时仍可再次压缩。

压缩不修改传入 `toUIMessageStream` 的原始 UI 消息，也不覆盖 Session Store 中的历史记录。
用户仍能查看完整对话和工具调用，只有发给模型的运行时上下文被精简。

## 事件与消息 metadata

每次有效压缩都会通过 SSE 发布 `context.compacted`：

```ts
type ChatContextCompaction = {
  count: number;
  stepNumber: number;
  estimatedTokensBefore: number;
  estimatedTokensAfter: number;
};
```

`count` 是当前 run 内的累计压缩次数。最近一次压缩信息随最终 assistant 消息 metadata
一并保存，并与现有 `usage` metadata 合并，不会覆盖供应商返回的输入、输出、缓存或推理
token 用量。

Chat 页面收到事件后，将当前生成状态显示为“自动压缩上下文”，并提示正在清理旧推理与工具
结果。run 完成后，assistant 消息显示“已完成 · 已自动压缩上下文”；多次压缩会显示次数，
悬停可查看压缩前后的估算 token 数。

上下文弹窗使用相同的共享解析逻辑展示模型窗口和自动压缩阈值。模型未配置输入上限时显示
“128K（默认）”，并明确说明该值不是供应商声明。

## 用量与限制

剪枝本身不调用模型，因此不产生额外 AI usage，也不新增 usage 日志。正常模型步骤仍沿用现有
provider、model 和 token usage 持久化路径。

当前估算只计算 `prepareStep` 中的消息，不包含 system prompt、工具 schema 或供应商特有的
tokenizer 差异。上下文弹窗中最近一次 `inputTokens` 是供应商返回的实际用量，两者口径不同。
75% 阈值和 750K 上限为 system prompt、工具定义、输出与估算误差保留空间，但不能代替供应商
的精确 tokenizer。第一版只剪枝 reasoning 和工具数据，不对早期自然语言对话生成摘要。
