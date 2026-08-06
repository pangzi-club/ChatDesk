import { createOpenAI } from "@ai-sdk/openai";
import { useChat } from "@ai-sdk/react";
import { code } from "@streamdown/code";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import {
  type ChatTransport,
  convertToModelMessages,
  streamText,
  toUIMessageStream,
  type UIMessage,
  type UIMessageChunk,
} from "ai";
import { Streamdown } from "streamdown";
import "streamdown/styles.css";
import {
  ArrowUp,
  Bot,
  ChevronDown,
  CircleStop,
  Copy,
  FilePlus2,
  History,
  Mic,
  MoreHorizontal,
  Paperclip,
  Plus,
  RefreshCw,
  Settings,
  Settings2,
  Sparkles,
  Trash2,
  User,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";

import { ChatSettingsDialog } from "@/components/chat-settings-dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  type ChatDisplaySettings,
  DEFAULT_CHAT_DISPLAY,
  loadChatDisplaySettings,
  saveChatDisplaySettings,
} from "@/lib/chat-settings";
import {
  type ChatIndexItem,
  type ChatSession,
  createSessionId,
  deleteChatSession,
  deriveChatTitle,
  loadChatIndex,
  loadChatSession,
  saveChatSession,
} from "@/lib/chat-store";
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
    responsive: false,
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
    responsive: false,
    isDefault: false,
  },
];

function ChatPage() {
  const queryClient = useQueryClient();
  const { data: chatIndex = [], isLoading: isChatHistoryLoading } = useQuery({
    queryKey: ["chat-index"],
    queryFn: loadChatIndex,
  });
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
  const [sessionId, setSessionId] = useState(createSessionId);
  const [sessionTitle, setSessionTitle] = useState("新对话");
  const sessionCreatedAtRef = useRef(new Date().toISOString());
  const suppressSaveRef = useRef(false);
  const pendingSessionRef = useRef<ChatSession | null>(null);
  const initializedHistoryRef = useRef(false);
  const savedFingerprintRef = useRef("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const isComposingRef = useRef(false);
  const [sessionToDelete, setSessionToDelete] = useState<ChatIndexItem | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [chatDisplay, setChatDisplay] = useState<ChatDisplaySettings>(DEFAULT_CHAT_DISPLAY);
  const selectedModel = models.find((model) => model.id === selectedModelId) ?? models[0];
  const transport = useMemo(() => createModelTransport(selectedModel), [selectedModel]);
  const { messages, setMessages, sendMessage, stop, status, error } = useChat({
    id: sessionId,
    transport,
  });
  useEffect(() => {
    void loadChatDisplaySettings().then(setChatDisplay);
  }, []);

  const updateChatDisplay = (next: ChatDisplaySettings) => {
    setChatDisplay(next);
    void saveChatDisplaySettings(next);
  };

  const isGenerating = status === "submitted" || status === "streaming";
  const lastMessage = messages[messages.length - 1];
  const hasAssistantMessage =
    lastMessage?.role === "assistant" && messageText(lastMessage).trim().length > 0;

  useEffect(() => {
    if (models.length > 0 && !models.some((model) => model.id === selectedModelId)) {
      setSelectedModelId(models.find((model) => model.isDefault)?.id ?? models[0].id);
    }
  }, [models, selectedModelId]);

  useEffect(() => {
    if (initializedHistoryRef.current || isChatHistoryLoading) return;
    initializedHistoryRef.current = true;
    const latest = chatIndex[0];
    if (!latest) return;
    void loadChatSession(latest.id).then((session) => {
      if (!session) return;
      pendingSessionRef.current = session;
      setSessionId(session.id);
    });
  }, [chatIndex, isChatHistoryLoading]);

  useEffect(() => {
    const session = pendingSessionRef.current;
    if (!session || session.id !== sessionId) return;
    pendingSessionRef.current = null;
    suppressSaveRef.current = true;
    setSessionTitle(session.title);
    sessionCreatedAtRef.current = session.createdAt;
    setMessages(session.messages);
    if (session.modelId) setSelectedModelId(session.modelId);
  }, [sessionId, setMessages]);

  useEffect(() => {
    if (status !== "ready" || messages.length === 0) return;
    if (suppressSaveRef.current) {
      suppressSaveRef.current = false;
      return;
    }
    const lastMessage = messages[messages.length - 1];
    if (lastMessage?.role !== "assistant" || !messageText(lastMessage).trim()) return;
    const fingerprint = `${sessionId}:${messages.length}:${lastMessage.id}:${messageText(lastMessage)}`;
    if (savedFingerprintRef.current === fingerprint) return;
    savedFingerprintRef.current = fingerprint;
    const now = new Date().toISOString();
    const title = deriveChatTitle(messages);
    setSessionTitle(title);
    void saveChatSession({
      schemaVersion: 1,
      id: sessionId,
      title,
      createdAt: sessionCreatedAtRef.current,
      updatedAt: now,
      modelId: selectedModel?.id,
      messages,
      attachments: [],
    })
      .then(() => queryClient.invalidateQueries({ queryKey: ["chat-index"] }))
      .catch((saveError) => console.error("Failed to save chat session", saveError));
  }, [messages, queryClient, selectedModel?.id, sessionId, status]);

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

  function startNewSession() {
    stop();
    setSessionId(createSessionId());
    sessionCreatedAtRef.current = new Date().toISOString();
    setSessionTitle("新对话");
    savedFingerprintRef.current = "";
    suppressSaveRef.current = false;
    setMessages([]);
    setInput("");
  }

  function openSession(item: ChatIndexItem) {
    if (item.id === sessionId) return;
    void loadChatSession(item.id).then((session) => {
      if (!session) return;
      stop();
      savedFingerprintRef.current = "";
      pendingSessionRef.current = session;
      setSessionId(session.id);
    });
  }

  async function confirmRemoveSession() {
    const item = sessionToDelete;
    if (!item) return;
    try {
      await deleteChatSession(item.id);
      await queryClient.invalidateQueries({ queryKey: ["chat-index"] });
      if (item.id === sessionId) startNewSession();
    } catch (deleteError) {
      console.error("Failed to delete chat session", deleteError);
    } finally {
      setSessionToDelete(null);
    }
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (
      event.key === "Enter" &&
      !event.shiftKey &&
      !event.nativeEvent.isComposing &&
      event.keyCode !== 229 &&
      !isComposingRef.current
    ) {
      event.preventDefault();
      submitMessage();
    }
  }

  return (
    <div
      className="chat-page"
      data-chat-font-size={chatDisplay.fontSize}
      data-chat-spacing={chatDisplay.spacing}
    >
      <header className="chat-header">
        <div className="chat-brand">
          <div className="chat-brand-mark">
            <Sparkles className="size-4" />
          </div>
          <div>
            <p className="chat-kicker">Workspace assistant</p>
            <h1>{sessionTitle}</h1>
          </div>
        </div>
        <div className="chat-header-actions">
          <Button
            aria-label="新建对话"
            className="chat-icon-button"
            size="icon"
            variant="ghost"
            type="button"
            onClick={startNewSession}
          >
            <Plus className="size-4" />
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                aria-label="更多选项"
                className="chat-icon-button"
                size="icon"
                variant="ghost"
                type="button"
              >
                <MoreHorizontal className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="chat-history-menu" sideOffset={8}>
              <DropdownMenuLabel>
                <span className="chat-history-menu-label">
                  <History className="size-3.5" />
                  历史对话
                </span>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              {isChatHistoryLoading && <DropdownMenuItem disabled>加载中...</DropdownMenuItem>}
              {!isChatHistoryLoading && chatIndex.length === 0 && (
                <DropdownMenuItem disabled>暂无历史对话</DropdownMenuItem>
              )}
              {chatIndex.map((item) => (
                <div className="chat-history-menu-item" key={item.id}>
                  <button
                    className="chat-history-menu-open"
                    type="button"
                    onClick={() => openSession(item)}
                  >
                    <span className="chat-history-menu-title">{item.title}</span>
                    <span className="chat-history-menu-count">{item.messageCount}</span>
                  </button>
                  <span className="chat-history-menu-actions">
                    <button
                      aria-label={`删除${item.title}`}
                      className="chat-history-menu-delete"
                      title="删除对话"
                      type="button"
                      onClick={() => setSessionToDelete(item)}
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </span>
                </div>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <Button
            aria-label="显示设置"
            className="chat-icon-button"
            size="icon"
            variant="ghost"
            type="button"
            onClick={() => setSettingsOpen(true)}
          >
            <Settings className="size-4" />
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
            <MessageBubble
              key={message.id}
              message={message}
              isStreaming={status === "streaming" && message.id === lastMessage?.id}
            />
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
            onCompositionStart={() => {
              isComposingRef.current = true;
            }}
            onCompositionEnd={() => {
              isComposingRef.current = false;
            }}
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
                      {formatModelLabel(model)}
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
      <ChatSettingsDialog
        onOpenChange={setSettingsOpen}
        onSettingsChange={updateChatDisplay}
        open={settingsOpen}
        settings={chatDisplay}
      />
      <AlertDialog
        open={sessionToDelete !== null}
        onOpenChange={(open) => {
          if (!open) setSessionToDelete(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除历史对话？</AlertDialogTitle>
            <AlertDialogDescription>
              确定要删除“{sessionToDelete?.title ?? "这条对话"}”吗？删除后无法恢复。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => void confirmRemoveSession()}>
              删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function MessageBubble({ message, isStreaming }: { message: UIMessage; isStreaming: boolean }) {
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
          <Streamdown isAnimating={!isUser && isStreaming} plugins={{ code }}>
            {text}
          </Streamdown>
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

function formatModelLabel(model: ModelConfig) {
  return model.responsive ? `${model.name} · Responses` : model.name;
}

function createModelTransport(model: ModelConfig | undefined): ChatTransport<UIMessage> {
  return {
    async sendMessages({ messages, abortSignal }) {
      if (!model || model.baseUrl.startsWith("local://")) {
        throw new Error("请先在设置中配置一个真实的模型 API。");
      }
      if (model.responsive) {
        return sendResponsiveMessages(model, messages, abortSignal);
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

async function sendResponsiveMessages(
  model: ModelConfig,
  messages: UIMessage[],
  abortSignal: AbortSignal | undefined,
): Promise<ReadableStream<UIMessageChunk>> {
  const provider = createOpenAI({
    apiKey: model.apiKey,
    baseURL: resolveOpenAICompatibleBaseURL(model.baseUrl),
    fetch: resolveFetch(),
  });
  const result = streamText({
    model: provider.responses(resolveModelId(model)),
    messages: await convertToModelMessages(messages),
    abortSignal,
  });
  return toUIMessageStream({ stream: result.stream });
}

/** Strip Chat Completions / Responses path suffixes so AI SDK can append `/responses`. */
function resolveOpenAICompatibleBaseURL(baseUrl: string): string {
  return baseUrl
    .trim()
    .replace(/\/+$/, "")
    .replace(/\/chat\/completions$/i, "")
    .replace(/\/responses$/i, "");
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
