# Chat 附件存储

本文记录 Chat 附件（用户上传文件、模型生成图片等）的存储与记录机制。附件机制随 `image_generation` 工具引入，用户文件输入复用同一套链路。相关整体架构见 [chat-http-server-architecture.md](chat-http-server-architecture.md)。

## 1. 三层存储结构

一个附件在磁盘上由三层共同描述，全部落在数据目录的 `sessions/<sessionId>/` 下：

```text
<数据目录>/sessions/<sessionId>/
├── meta.json                    # ChatSession 去掉 messages
├── messages.jsonl               # 每行一条 UIMessage
│   └── file / reasoning-file part 标记本条消息带了哪些附件
└── attachments/
    └── <attachmentId>-<fileName>      # 文件本体
```

- **文件本体**：`attachments/<attachmentId>-<fileName>`，二进制内容落盘。文件名经 `store.attachmentPath` 清洗（非 `[a-zA-Z0-9._-]` 字符替换为 `_`，截断到 180 字符）。
- **会话级元数据**：`ChatSession.attachments: ChatAttachment[]`，随 session 序列化进 `meta.json`。
- **消息级引用**：某条 `UIMessage` 的 `parts` 数组里放 `file` / `reasoning-file` 类型的 part，标记「这条消息」具体携带了哪几个附件，渲染侧由 `ChatMessageFiles` 消费。消息按行写在 `messages.jsonl`。

`ChatAttachment` 定义见 `packages/shared/src/chat.ts`：

```ts
type ChatAttachment = {
  id: string;
  kind: "image" | "video" | "audio" | "file";
  mediaType: string;
  fileName?: string;
  size?: number;
  width?: number;
  height?: number;
  durationMs?: number;
  path: string;                       // 落盘绝对路径
  source: "upload" | "generated" | "remote";
  createdAt: string;
};
```

## 2. HTTP 路由

路由注册于 `apps/server/src/app.ts`，均要求 `Bearer` token：

| 方法 | 路径 | 说明 |
|------|------|------|
| `POST` | `/v1/sessions/:id/attachments` | 上传附件。Body `{ id?, fileName?, base64 }`，base64 解码后落盘，返回 `{ id, fileName, path, size }` |
| `GET` | `/v1/sessions/:id/attachments/:attachmentId` | 按 id 读文件本体，返回 `application/octet-stream` |
| `DELETE` | `/v1/sessions/:id/attachments/:attachmentId` | 按 id 删文件本体（用于清理未发送的孤儿附件） |

## 3. Store 方法

`apps/server/src/store.ts` 的 `SessionStore`：

- `saveAttachment(sessionId, attachmentId, fileName, bytes)`：写入 `attachments/` 目录（先写 `.tmp` 再 `rename`，避免半截文件），返回落盘路径。
- `readAttachment(sessionId, attachmentId)`：按 `attachmentId-` 前缀在目录里找到文件并读出。
- `deleteAttachment(sessionId, attachmentId)`：定位后删除。

## 4. 关键细节：POST 不回填会话元数据

**`POST /attachments` 只负责把文件字节落盘并返回 `{ id, fileName, path, size }`，不会自动把这条记录写进 `session.attachments`。**

因此前端上传成功后必须自己补一步：

1. 用返回的 `id / path / size` 加上前端已知的 `mediaType / kind / fileName` 构造完整的 `ChatAttachment`（用户上传 `source: "upload"`）；
2. 合并进 `session.attachments`（按 `id` 去重，参考 `chat-image-generation.ts` 的 `mergeAttachments`）；
3. 通过 `PATCH /v1/sessions/:id` 保存整个 session，元数据才真正持久化。

少了这一步，文件本体在磁盘上、但 `meta.json` 里没有记录，重开会话后无法还原引用。

## 5. 前端上传链路

```text
用户文件 / 生成图片
  → uploadChatServerAttachment(sessionId, attachmentId, fileName, bytes)   # apps/desktop/src/lib/chat-server.ts
  → ChatServerClient.uploadAttachment                                       # packages/chat-client（base64 POST）
  → POST /v1/sessions/:id/attachments                                       # 落盘，返回 { path, ... }
  → 构造 ChatAttachment，merge 进 session.attachments
  → PATCH /v1/sessions/:id                                                  # 元数据持久化
```

## 6. 消息级引用与渲染

发送消息时，把待发附件转成 `file` part 放进该条用户消息的 `parts`（带 `mediaType` 与可取到文件的 url / attachmentId）。消息随 `ChatSession.messages` 一起写入 `messages.jsonl`。

渲染侧 `apps/desktop/src/pages/chat.tsx` 的 `ChatMessageFiles` 已支持 `file` / `reasoning-file` part：图片类渲染缩略图，其余渲染文件链接。注意附件内容读取要走带 `Authorization` 的客户端 fetch（`GET /attachments/:attachmentId`），`<img src>` 裸直链拿不到 token。

## 7. 现有调用方

- **image_generation（首个调用方）**：`apps/desktop/src/lib/chat-image-generation.ts` 的 `materializeGeneratedImages` 把生成图片落盘为 `source: "generated"` 的附件，并用 `mergeAttachments` 回填 `session.attachments`、改写消息 parts。这是「落盘 + 回填元数据 + 改写 parts」的完整范式。
- **用户文件输入**：composer 附件按钮与拖拽上传复用同一链路，`source: "upload"`。实现见 `apps/desktop/src/lib/chat-attachments.ts` 与 `apps/desktop/src/pages/chat.tsx`。

## 8. 限制与清理

- 用户文件输入侧的限制（单文件大小、单次数量上限）在前端 `lib/chat-attachments.ts` 约定；server 的 `POST /attachments` 本身不强制大小校验。
- 待发附件在上传后、发送前被移除时，应调 `DELETE /attachments/:attachmentId` 清掉已落盘的孤儿文件，避免 `attachments/` 目录只增不减。

## 9. 当前代码位置

- `packages/shared/src/chat.ts`：`ChatAttachment`、`ChatSession.attachments` 类型。
- `apps/server/src/app.ts`：`POST/GET/DELETE /v1/sessions/:id/attachments` 路由。
- `apps/server/src/store.ts`：`saveAttachment / readAttachment / deleteAttachment / attachmentPath`。
- `packages/chat-client/src/index.ts`：`ChatServerClient.uploadAttachment`。
- `apps/desktop/src/lib/chat-server.ts`：`uploadChatServerAttachment` 封装。
- `apps/desktop/src/lib/chat-image-generation.ts`：现有「落盘 + 回填 + 改写 parts」范式（`mergeAttachments` / `materializeGeneratedImages`）。
