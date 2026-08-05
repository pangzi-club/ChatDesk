#!/usr/bin/env node
import * as Lark from "@larksuiteoapi/node-sdk";
import readline from "node:readline";

const appId = process.env.FEISHU_APP_ID;
const appSecret = process.env.FEISHU_APP_SECRET;
const client = appId && appSecret ? new Lark.Client({ appId, appSecret, domain: Lark.Domain.Feishu }) : null;
let outputClosed = false;
const displayNameCache = new Map();
const sidecarLogger = {
  error(...args) {
    emit({ type: "log", level: "error", message: args.map(String).join(" ") });
  },
  warn(...args) {
    emit({ type: "log", level: "warning", message: args.map(String).join(" ") });
  },
  info(...args) {
    emit({ type: "log", level: "info", message: args.map(String).join(" ") });
  },
  debug() {},
  trace() {},
};
process.stdout.on("error", (error) => {
  if (error?.code === "EPIPE") outputClosed = true;
});

function emit(value) {
  if (outputClosed) return;
  try {
    process.stdout.write(`${JSON.stringify(value)}\n`);
  } catch (error) {
    if (error?.code === "EPIPE") outputClosed = true;
  }
}

function now() {
  return new Date().toISOString();
}

function textFromContent(content) {
  try {
    const parsed = JSON.parse(content ?? "{}");
    return typeof parsed.text === "string" ? parsed.text : "";
  } catch {
    return "";
  }
}

async function sendText(conversationId, text) {
  if (!client) throw new Error("飞书凭据未配置");
  await client.im.v1.message.create({
    params: { receive_id_type: "chat_id" },
    data: { receive_id: conversationId, content: JSON.stringify({ text }), msg_type: "text" },
  });
}

async function displayNameFor(openId) {
  if (!openId || !client) return openId;
  const cached = displayNameCache.get(openId);
  if (cached) return cached;
  try {
    const result = await client.contact.v3.user.get({ path: { user_id: openId }, params: { user_id_type: "open_id" } });
    const displayName = result?.data?.user?.name || result?.data?.user?.nickname || result?.data?.user?.en_name || result?.data?.name || openId;
    displayNameCache.set(openId, displayName);
    return displayName;
  } catch {
    return openId;
  }
}

async function displayNameWithTimeout(openId) {
  return Promise.race([
    displayNameFor(openId),
    new Promise((resolve) => setTimeout(() => resolve(openId), 2_000)),
  ]);
}

async function main() {
  if (!client) {
    emit({ type: "error", message: "FEISHU_APP_ID 或 FEISHU_APP_SECRET 缺失" });
    process.exitCode = 2;
    return;
  }

  emit({ type: "status", status: "starting", detail: "正在连接飞书长连接" });

  const dispatcher = new Lark.EventDispatcher({}).register({
    "im.message.receive_v1": async (data) => {
      try {
        const message = data?.message;
        const conversationId = message?.chat_id;
        const openId = data?.sender?.sender_id?.open_id ?? "";
        const text = textFromContent(message?.content);
        if (!conversationId || !text) return;
        const displayName = await displayNameWithTimeout(openId);
        const timestamp = now();
        emit({
          type: "message",
          payload: {
            conversation: {
              id: conversationId,
              openId,
              displayName: displayName || conversationId,
              lastMessage: text,
              lastMessageAt: timestamp,
              unreadCount: 1,
            },
            message: {
              id: message.message_id ?? `${conversationId}-${timestamp}`,
              conversationId,
              openId,
              direction: "inbound",
              text,
              timestamp,
            },
          },
        });
      } catch (error) {
        emit({ type: "error", message: error instanceof Error ? error.message : String(error) });
      }
    },
  });

  const wsClient = new Lark.WSClient({
    appId,
    appSecret,
    domain: Lark.Domain.Feishu,
    logger: sidecarLogger,
    handshakeTimeoutMs: 10_000,
    onReady: () => emit({ type: "ready" }),
    onReconnecting: () => emit({ type: "status", status: "starting", detail: "飞书长连接重连中" }),
    onReconnected: () => emit({ type: "ready" }),
    onError: (error) => emit({ type: "error", message: error instanceof Error ? error.message : String(error) }),
  });
  await wsClient.start({ eventDispatcher: dispatcher });

  const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  input.on("line", async (line) => {
    try {
      const command = JSON.parse(line);
      if (command.type === "stop") {
        input.close();
        process.exit(0);
      }
      if (command.type === "send_message") await sendText(command.conversationId, command.text);
    } catch (error) {
      emit({ type: "error", message: error instanceof Error ? error.message : String(error) });
    }
  });
}

main().catch((error) => {
  emit({ type: "error", message: error instanceof Error ? error.message : String(error) });
  process.exitCode = 1;
});
