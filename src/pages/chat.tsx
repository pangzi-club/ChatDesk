import { useChat } from "@ai-sdk/react";
import { useQuery } from "@tanstack/react-query";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import type { ChatTransport, UIMessage, UIMessageChunk } from "ai";
import {
  ArrowUp,
  Bot,
  ChevronDown,
  CircleStop,
  Copy,
  FilePlus2,
  Mic,
  MoreHorizontal,
  Paperclip,
  Plus,
  RefreshCw,
  Settings2,
  Sparkles,
  User,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";

import { Button } from "@/components/ui/button";
import { loadModels, type ModelConfig } from "@/lib/models";

const demoModels: ModelConfig[] = [
  {
    id: "local-aurora",
    name: "Aurora 2.1",
    provider: "m-dashboard",
    baseUrl: "local://demo",
    apiKey: "demo",
    supportsTools: true,
    supportsImages: false,
    supportsReasoning: true,
    customProtocol: false,
    isDefault: true,
  },
  {
    id: "local-scribe",
    name: "Scribe Mini",
    provider: "m-dashboard",
    baseUrl: "local://demo",
    apiKey: "demo",
    supportsTools: false,
    supportsImages: false,
    supportsReasoning: false,
    customProtocol: false,
    isDefault: false,
  },
];

function ChatPage() {
  const { data: configuredModels, isLoading: isModelsLoading } = useQuery({
    queryKey: ["models"],
    queryFn: loadModels,
  });
  const models = useMemo(
    () => (configuredModels && configuredModels.length > 0 ? configuredModels : demoModels),
    [configuredModels],
  );
  const [selectedModelId, setSelectedModelId] = useState("");
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const selectedModel = models.find((model) => model.id === selectedModelId) ?? models[0];
  const transport = useMemo(() => createModelTransport(selectedModel), [selectedModel]);
  const { messages, setMessages, sendMessage, stop, status, error } = useChat({
    id: "m-dashboard-chat",
    transport,
  });
  const isGenerating = status === "submitted" || status === "streaming";
  const lastMessage = messages[messages.length - 1];
  const hasAssistantMessage =
    lastMessage?.role === "assistant" && messageText(lastMessage).trim().length > 0;

  useEffect(() => {
    if (models.length > 0 && !models.some((model) => model.id === selectedModelId)) {
      setSelectedModelId(models.find((model) => model.isDefault)?.id ?? models[0].id);
    }
  }, [models, selectedModelId]);

  // Scroll when a message arrives or the local response indicator changes.
  // biome-ignore lint/correctness/useExhaustiveDependencies: these values intentionally trigger the scroll effect.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages.length, isGenerating]);

  function submitMessage() {
    const text = input.trim();
    if (!text || isGenerating) return;
    setInput("");
    void sendMessage({ text });
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      submitMessage();
    }
  }

  return (
    <div className="chat-page">
      <header className="chat-header">
        <div className="chat-brand">
          <div className="chat-brand-mark">
            <Sparkles className="size-4" />
          </div>
          <div>
            <p className="chat-kicker">Workspace assistant</p>
            <h1>新对话</h1>
          </div>
        </div>
        <div className="chat-header-actions">
          <Button
            aria-label="新建对话"
            className="chat-icon-button"
            size="icon"
            variant="ghost"
            type="button"
            onClick={() => setMessages([])}
          >
            <Plus className="size-4" />
          </Button>
          <Button
            aria-label="更多选项"
            className="chat-icon-button"
            size="icon"
            variant="ghost"
            type="button"
          >
            <MoreHorizontal className="size-4" />
          </Button>
        </div>
      </header>

      <div className="chat-stage" ref={scrollRef}>
        <div className="chat-content">
          <div className="chat-context-row">
            <span className="chat-status-dot" />
            <span>{selectedModel?.provider ?? "m-dashboard"} workspace</span>
            <span className="chat-context-rule" />
            <span>本地会话</span>
          </div>
          {messages.map((message) => (
            <MessageBubble key={message.id} message={message} />
          ))}
          {isGenerating && !hasAssistantMessage && (
            <div className="chat-message assistant-message">
              <div className="chat-avatar assistant-avatar">
                <Bot className="size-4" />
              </div>
              <div className="chat-message-body">
                <div className="chat-thinking">
                  <span />
                  <span />
                  <span />
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="chat-composer-wrap">
        {error && <p className="chat-error">{error.message}</p>}
        <div className="chat-composer">
          <textarea
            aria-label="输入消息"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="问问你的工作空间..."
            rows={2}
          />
          <div className="chat-composer-footer">
            <div className="chat-composer-tools">
              <Button
                aria-label="添加附件"
                className="chat-tool-button"
                size="icon"
                type="button"
                variant="ghost"
              >
                <Paperclip className="size-4" />
              </Button>
              <Button
                aria-label="添加文件"
                className="chat-tool-button hidden sm:inline-flex"
                size="icon"
                type="button"
                variant="ghost"
              >
                <FilePlus2 className="size-4" />
              </Button>
              <div className="chat-model-picker">
                <Settings2 className="size-3.5" />
                <select
                  aria-label="选择模型"
                  disabled={isModelsLoading}
                  value={selectedModel?.id ?? ""}
                  onChange={(event) => setSelectedModelId(event.target.value)}
                >
                  {models.map((model) => (
                    <option key={model.id} value={model.id}>
                      {model.name}
                    </option>
                  ))}
                </select>
                <ChevronDown className="size-3.5" />
              </div>
              {configuredModels?.length === 0 && (
                <Link className="chat-settings-link" to="/settings/models">
                  配置模型
                </Link>
              )}
            </div>
            <div className="chat-composer-actions">
              <Button
                aria-label="语音输入"
                className="chat-tool-button hidden sm:inline-flex"
                size="icon"
                type="button"
                variant="ghost"
              >
                <Mic className="size-4" />
              </Button>
              <Button
                aria-label={isGenerating ? "停止生成" : "发送消息"}
                className="chat-send-button"
                disabled={!input.trim() && !isGenerating}
                onClick={isGenerating ? () => stop() : submitMessage}
                size="icon"
                type="button"
              >
                {isGenerating ? <CircleStop className="size-4" /> : <ArrowUp className="size-4" />}
              </Button>
            </div>
          </div>
        </div>
        <p className="chat-disclaimer">AI 生成的内容可能存在偏差，请核实重要信息。</p>
      </div>
    </div>
  );
}

function MessageBubble({ message }: { message: UIMessage }) {
  const text = messageText(message);
  const isUser = message.role === "user";
  if (!isUser && !text.trim()) return null;

  return (
    <div className={`chat-message ${isUser ? "user-message" : "assistant-message"}`}>
      <div className={`chat-avatar ${isUser ? "user-avatar" : "assistant-avatar"}`}>
        {isUser ? <User className="size-4" /> : <Bot className="size-4" />}
      </div>
      <div className="chat-message-body">
        <div className="chat-message-meta">
          <strong>{isUser ? "你" : "m-dashboard"}</strong>
          <span>{isUser ? "刚刚" : "已完成"}</span>
        </div>
        <div className="chat-message-text">
          {text.split("\n").map((line) => (
            <p key={`${message.id}-${line}`}>{line || "\u00a0"}</p>
          ))}
        </div>
        {!isUser && (
          <div className="chat-message-actions">
            <Button aria-label="复制回复" size="icon" variant="ghost">
              <Copy className="size-3.5" />
            </Button>
            <Button aria-label="重新生成" size="icon" variant="ghost">
              <RefreshCw className="size-3.5" />
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

function messageText(message: UIMessage) {
  return message.parts
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n");
}

function makeId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function createModelTransport(model: ModelConfig | undefined): ChatTransport<UIMessage> {
  return {
    async sendMessages({ messages, abortSignal }) {
      if (!model || model.baseUrl.startsWith("local://")) {
        throw new Error("请先在设置中配置一个真实的模型 API。");
      }
      const response = await resolveFetch()(model.baseUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${model.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: resolveModelId(model),
          stream: true,
          messages: messages.map((message) => ({
            role: message.role,
            content: message.parts
              .filter((part) => part.type === "text")
              .map((part) => part.text)
              .join(""),
          })),
        }),
        signal: abortSignal,
      });
      if (!response.ok || !response.body) {
        throw new Error(await readModelError(response));
      }
      return response.body.pipeThrough(createOpenAIStreamTransform());
    },
    async reconnectToStream() {
      return null;
    },
  };
}

function resolveModelId(model: ModelConfig): string {
  if (model.provider !== "深度求索 / DeepSeek") return model.name;
  const legacyNames: Record<string, string> = {
    "DeepSeek-V4 Flash": "deepseek-v4-flash",
    "DeepSeek-V4 Pro": "deepseek-v4-pro",
    "deepseek-chat": "deepseek-v4-flash",
    "deepseek-reasoner": "deepseek-v4-flash",
  };
  return legacyNames[model.name] ?? model.name;
}

async function readModelError(response: Response): Promise<string> {
  let detail = "";
  try {
    const payload = (await response.json()) as { error?: { message?: string }; message?: string };
    detail = payload.error?.message ?? payload.message ?? "";
  } catch {
    // Some proxies return an empty or non-JSON error response.
  }
  return detail
    ? `模型请求失败（${response.status}）：${detail}`
    : `模型请求失败（${response.status}）`;
}

function resolveFetch(): typeof fetch {
  return ("__TAURI_INTERNALS__" in window ? tauriFetch : window.fetch.bind(window)) as typeof fetch;
}

function createOpenAIStreamTransform() {
  const textId = makeId("text");
  let buffer = "";
  return new TransformStream<Uint8Array, UIMessageChunk>({
    start(controller) {
      controller.enqueue({ type: "text-start", id: textId });
    },
    transform(chunk, controller) {
      buffer += new TextDecoder().decode(chunk, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.startsWith("data:")) continue;
        const value = line.slice(5).trim();
        if (value === "[DONE]") continue;
        try {
          const delta = JSON.parse(value).choices?.[0]?.delta?.content;
          if (typeof delta === "string" && delta.length > 0) {
            controller.enqueue({ type: "text-delta", id: textId, delta });
          }
        } catch {
          // Provider chunks can be split across SSE lines.
        }
      }
    },
    flush(controller) {
      controller.enqueue({ type: "text-end", id: textId });
    },
  });
}

export { ChatPage };
