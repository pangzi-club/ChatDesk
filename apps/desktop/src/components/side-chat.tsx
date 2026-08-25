import { useChat } from "@ai-sdk/react";
import { useQuery } from "@tanstack/react-query";
import type { UIMessage } from "ai";
import { DefaultChatTransport } from "ai";
import { ArrowUp, LoaderCircle, Square } from "lucide-react";
import { useMemo, useState } from "react";
import { ChatComposerInput } from "@/components/chat-composer-input";
import { ChatMarkdown } from "@/components/chat-markdown";
import { Button } from "@/components/ui/button";
import {
  chatServerFetch,
  chatServerHeaders,
  chatServerUrl,
  initializeChatServer,
} from "@/lib/chat-server";
import { loadModels } from "@/lib/models";

function textOf(message: UIMessage) {
  return message.parts
    .filter(
      (part): part is Extract<UIMessage["parts"][number], { type: "text" }> => part.type === "text",
    )
    .map((part) => part.text)
    .join("\n");
}

export function SideChat({
  sessionId,
  contextMessages,
}: {
  sessionId: string;
  contextMessages: UIMessage[];
}) {
  const [input, setInput] = useState("");
  const modelsQuery = useQuery({ queryKey: ["models"], queryFn: loadModels });
  const model = modelsQuery.data?.[0];
  const transport = useMemo(
    () =>
      new DefaultChatTransport<UIMessage>({
        api: `${chatServerUrl()}/v1/sessions/${sessionId}/runs`,
        fetch: (input, init) => chatServerFetch(input, init),
        headers: async () => {
          await initializeChatServer();
          return chatServerHeaders();
        },
        prepareSendMessagesRequest: async ({ messages }) => {
          if (!model) throw new Error("请先配置模型");
          await initializeChatServer();
          return {
            body: {
              messages,
              contextMessages,
              modelId: model.id,
              model: { ...model, apiKey: undefined },
              title: "侧边聊天",
            },
            api: `${chatServerUrl()}/v1/sessions/${sessionId}/runs`,
            headers: chatServerHeaders(),
          };
        },
      }),
    [contextMessages, model, sessionId],
  );
  const { error, messages, sendMessage, status, stop } = useChat({ id: sessionId, transport });
  const busy = status === "submitted" || status === "streaming";

  async function submit() {
    const value = input.trim();
    if (!value || busy) return;
    setInput("");
    await sendMessage({ text: value });
  }

  return (
    <section className="side-chat chat-page">
      <div className="chat-stage-shell">
        <div className="chat-stage">
          <div className="chat-content">
            {contextMessages.map((message) => (
              <div
                className={`chat-message ${message.role === "user" ? "user-message" : "assistant-message"}`}
                key={`context-${message.id}`}
              >
                <div className="chat-message-body">
                  <div className="chat-message-text-wrap">
                    <div className="chat-message-text">
                      <ChatMarkdown isAnimating={false}>{textOf(message)}</ChatMarkdown>
                    </div>
                  </div>
                </div>
              </div>
            ))}
            {contextMessages.length ? (
              <div className="side-chat-context-divider">
                <span>侧边聊天</span>
              </div>
            ) : null}
            {messages.map((message) => (
              <div
                className={`chat-message ${message.role === "user" ? "user-message" : "assistant-message"}`}
                key={message.id}
              >
                <div className="chat-message-body">
                  <div className="chat-message-text-wrap">
                    <div className="chat-message-text">
                      <ChatMarkdown
                        isAnimating={busy && message.id === messages[messages.length - 1]?.id}
                      >
                        {textOf(message)}
                      </ChatMarkdown>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="chat-composer-wrap">
        {error ? <p className="side-chat-error">{error.message}</p> : null}
        <div className="chat-composer">
          <ChatComposerInput
            ariaControls="side-chat-composer"
            ariaExpanded={false}
            disabled={busy}
            onChange={(next) => setInput(next.markdown)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                void submit();
                return true;
              }
              return false;
            }}
            onPasteFiles={() => undefined}
            placeholder="问问当前对话..."
            value={input}
          />
          <div className="chat-composer-footer">
            <div className="chat-composer-tools">
              <span className="side-chat-context-label">当前对话上下文</span>
            </div>
            <div className="chat-composer-actions">
              <Button
                aria-label={busy ? "停止生成" : "发送消息"}
                className="chat-send-button !size-9 !rounded-[10px]"
                disabled={!busy && (!input.trim() || !model)}
                onClick={() => (busy ? void stop() : void submit())}
                size="icon"
                title={busy ? "停止生成" : "发送消息"}
                type="button"
              >
                {busy ? (
                  <Square className="size-4 fill-current" />
                ) : modelsQuery.isLoading ? (
                  <LoaderCircle className="size-4 animate-spin" />
                ) : (
                  <ArrowUp className="size-4" />
                )}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
