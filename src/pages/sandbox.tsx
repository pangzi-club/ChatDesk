import { useChat } from "@ai-sdk/react";
import { code } from "@streamdown/code";
import { useQuery } from "@tanstack/react-query";
import { getToolName, isToolUIPart, type UIMessage } from "ai";
import { ArrowUp, Bot, CircleStop, Plus, Sparkles, User } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Streamdown } from "streamdown";
import "streamdown/styles.css";

import { ChatToolCallCard } from "@/components/chat-tool-call-card";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { loadModels } from "@/lib/models";
import { createSandboxAgentTransport, type SandboxAgentMode } from "@/lib/sandbox-agent-tools";
import { createSandboxWriteGate, type SandboxWriteRequest } from "@/lib/sandbox-write-gate";
import { loadWorkspaceProjects, type WorkspaceProject } from "@/lib/workspaces";

const EXAMPLE_PROMPTS = [
  "列出当前目录下有哪些文件",
  "在 sandbox-note.txt 写入一句问候",
  "读取 README.md 并总结前几段",
];

function SandboxPage() {
  const { data: projects = [], isLoading: isProjectsLoading } = useQuery({
    queryKey: ["workspace-projects"],
    queryFn: loadWorkspaceProjects,
  });
  const { data: configuredModels, isLoading: isModelsLoading } = useQuery({
    queryKey: ["models"],
    queryFn: loadModels,
  });

  const models = useMemo(
    () => (configuredModels ?? []).filter((model) => !model.baseUrl.startsWith("local://")),
    [configuredModels],
  );

  const [selectedModelId, setSelectedModelId] = useState("");
  const [workspaceKey, setWorkspaceKey] = useState("");
  const [mode, setMode] = useState<SandboxAgentMode>("sandbox");
  const [sessionId, setSessionId] = useState(() => crypto.randomUUID());
  const [input, setInput] = useState("");
  const [pendingWrite, setPendingWrite] = useState<SandboxWriteRequest | null>(null);
  const isComposingRef = useRef(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const cwdRef = useRef("");
  const modeRef = useRef<SandboxAgentMode>("sandbox");
  const writeGateRef = useRef(createSandboxWriteGate());

  const selectedModel = models.find((model) => model.id === selectedModelId) ?? models[0];
  const selectedCwd = resolveSelectedCwd(workspaceKey, projects);
  const modelRef = useRef(selectedModel);
  cwdRef.current = selectedCwd;
  modeRef.current = mode;
  modelRef.current = selectedModel;

  const transport = useMemo(
    () =>
      createSandboxAgentTransport({
        getModel: () => modelRef.current,
        getCwd: () => cwdRef.current,
        getMode: () => modeRef.current,
        writeGate: writeGateRef.current,
      }),
    [],
  );

  const { messages, setMessages, sendMessage, stop, status, error } = useChat({
    id: sessionId,
    transport,
    onError: (chatError) => {
      console.error("Sandbox agent request failed", chatError);
    },
  });

  const isGenerating = status === "submitted" || status === "streaming";
  const lastMessage = messages[messages.length - 1];
  const hasAssistantMessage =
    lastMessage?.role === "assistant" &&
    (messageText(lastMessage).trim().length > 0 || messageHasToolParts(lastMessage));
  const canSend = Boolean(selectedCwd) && Boolean(selectedModel?.supportsTools) && !isGenerating;

  useEffect(() => {
    return writeGateRef.current.subscribe(setPendingWrite);
  }, []);

  useEffect(() => {
    if (models.length > 0 && !models.some((model) => model.id === selectedModelId)) {
      setSelectedModelId(models.find((model) => model.isDefault)?.id ?? models[0].id);
    }
  }, [models, selectedModelId]);

  useEffect(() => {
    if (workspaceKey) return;
    if (projects.length > 0) {
      setWorkspaceKey(projects[0].id);
    }
  }, [projects, workspaceKey]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: these values intentionally trigger the scroll effect.
  useEffect(() => {
    const node = scrollRef.current;
    if (!node) return;
    node.scrollTop = node.scrollHeight;
  }, [messages, status, pendingWrite]);

  function resetSession() {
    if (pendingWrite) {
      writeGateRef.current.respond(pendingWrite.id, false);
    }
    void stop();
    setSessionId(crypto.randomUUID());
    setMessages([]);
    setInput("");
  }

  function handleWorkspaceChange(nextKey: string) {
    if (nextKey === workspaceKey) return;
    resetSession();
    setWorkspaceKey(nextKey);
  }

  function handleModeChange(next: SandboxAgentMode) {
    if (next === mode) return;
    setMode(next);
  }

  function submitMessage() {
    const text = input.trim();
    if (!text || !canSend || pendingWrite) return;
    setInput("");
    void sendMessage({ text });
  }

  function respondToWrite(approved: boolean) {
    if (!pendingWrite) return;
    writeGateRef.current.respond(pendingWrite.id, approved);
  }

  const workspaceOptions = useMemo(
    () =>
      projects.map((project) => ({
        key: project.id,
        label: pathBasename(project.path),
        path: project.path,
      })),
    [projects],
  );

  return (
    <div className="chat-page h-full min-h-0">
      <header className="chat-header">
        <div className="chat-brand">
          <div className="chat-brand-mark">
            <Sparkles className="size-4" />
          </div>
          <div>
            <p className="chat-kicker">Sandbox Agent</p>
            <h1>工作区助手</h1>
          </div>
        </div>
        <div className="chat-header-actions">
          <Button
            aria-label="新建会话"
            className="chat-icon-button"
            size="icon"
            type="button"
            variant="ghost"
            onClick={resetSession}
          >
            <Plus className="size-4" />
          </Button>
        </div>
      </header>

      <div className="chat-stage" ref={scrollRef}>
        <div className="chat-content">
          <div className="chat-context-row">
            <span className="chat-status-dot" />
            <span>{mode === "sandbox" ? "沙箱模式" : "完全访问"}</span>
            <span className="chat-context-rule" />
            <span className="truncate" title={selectedCwd || undefined}>
              {selectedCwd ? pathBasename(selectedCwd) : "未选择工作目录"}
            </span>
          </div>

          {messages.length === 0 ? (
            <div className="chat-tools-hint">
              {!selectedCwd ? (
                <p>
                  请先在底部选择 Workspaces 中的目录。若列表为空，请先到{" "}
                  <Link to="/dev-tools/workspaces">Workspaces</Link> 添加项目。
                </p>
              ) : selectedModel && !selectedModel.supportsTools ? (
                <p>
                  当前模型未开启「支持 Tools」。可在 <Link to="/settings/models">模型设置</Link>{" "}
                  中开启，或更换模型。
                </p>
              ) : models.length === 0 && !isModelsLoading ? (
                <p>
                  尚未配置模型。请先到 <Link to="/settings/models">模型设置</Link> 添加 API。
                </p>
              ) : (
                <>
                  <p>已绑定工作目录。沙箱模式下写入文件会先征求你的同意；完全访问则直接修改。</p>
                  <div className="chat-tools-hint-chips">
                    {EXAMPLE_PROMPTS.map((example) => (
                      <button key={example} type="button" onClick={() => setInput(example)}>
                        {example}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          ) : null}

          {messages.map((message) => (
            <MessageBubble
              key={message.id}
              isStreaming={status === "streaming" && message.id === lastMessage?.id}
              message={message}
            />
          ))}

          {isGenerating && !hasAssistantMessage ? (
            <div className="chat-message assistant-message">
              <div className="chat-avatar assistant-avatar">
                <Bot className="size-4" />
              </div>
              <div className="chat-message-body">
                <div className="chat-message-meta">
                  <strong>Sandbox Agent</strong>
                  <span>思考中</span>
                </div>
                <p className="chat-message-text text-muted-foreground">正在处理…</p>
              </div>
            </div>
          ) : null}

          {error ? (
            <p className="mt-4 text-destructive text-sm">
              {error.message || "请求失败，请稍后重试。"}
            </p>
          ) : null}
        </div>
      </div>

      <div className="chat-composer-wrap">
        {pendingWrite ? (
          <div className="mb-2 rounded-lg border border-border/80 bg-muted/40 px-3 py-2.5">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <p className="font-medium text-foreground text-sm">请求写入文件</p>
                <p
                  className="mt-0.5 truncate text-muted-foreground text-xs"
                  title={pendingWrite.path}
                >
                  {pendingWrite.path || "未知路径"}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                <Button
                  size="sm"
                  type="button"
                  variant="ghost"
                  onClick={() => respondToWrite(false)}
                >
                  拒绝
                </Button>
                <Button size="sm" type="button" onClick={() => respondToWrite(true)}>
                  允许
                </Button>
              </div>
            </div>
            <pre className="mt-2 max-h-28 overflow-auto rounded-md border border-border/60 bg-background/70 p-2 text-[11px] leading-relaxed whitespace-pre-wrap text-muted-foreground">
              {truncatePreview(pendingWrite.content) || "—"}
            </pre>
          </div>
        ) : null}
        <div className="chat-composer">
          <textarea
            disabled={!selectedCwd || pendingWrite !== null}
            placeholder={
              pendingWrite
                ? "请先处理上方的写入确认…"
                : selectedCwd
                  ? "描述你想在工作区里做的事…"
                  : "请先选择工作目录后再输入…"
            }
            rows={3}
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onCompositionEnd={() => {
              isComposingRef.current = false;
            }}
            onCompositionStart={() => {
              isComposingRef.current = true;
            }}
            onKeyDown={(event) => {
              if (event.key !== "Enter" || event.shiftKey || isComposingRef.current) return;
              event.preventDefault();
              submitMessage();
            }}
          />
          <div className="chat-composer-footer">
            <div className="chat-composer-tools">
              <Select
                disabled={isModelsLoading || models.length === 0}
                value={selectedModel?.id}
                onValueChange={setSelectedModelId}
              >
                <SelectTrigger className="h-8 w-[140px] text-xs">
                  <SelectValue placeholder="选择模型" />
                </SelectTrigger>
                <SelectContent>
                  {models.map((model) => (
                    <SelectItem key={model.id} value={model.id}>
                      {model.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <span aria-hidden className="mx-0.5 h-4 w-px shrink-0 bg-border" />
              <Select
                disabled={isProjectsLoading}
                value={workspaceKey || undefined}
                onValueChange={handleWorkspaceChange}
              >
                <SelectTrigger aria-label="选择工作目录" className="h-8 w-[120px] text-xs">
                  <SelectValue placeholder={isProjectsLoading ? "加载中…" : "工作区"} />
                </SelectTrigger>
                <SelectContent>
                  {workspaceOptions.length === 0 ? (
                    <SelectItem disabled value="__empty">
                      暂无工作区
                    </SelectItem>
                  ) : (
                    workspaceOptions.map((option) => (
                      <SelectItem key={option.key} title={option.path} value={option.key}>
                        {option.label}
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
              <span aria-hidden className="mx-0.5 h-4 w-px shrink-0 bg-border" />
              <Select
                value={mode}
                onValueChange={(value) => handleModeChange(value as SandboxAgentMode)}
              >
                <SelectTrigger aria-label="访问模式" className="h-8 w-[110px] text-xs">
                  <SelectValue placeholder="沙箱" />
                </SelectTrigger>
                <SelectContent className="w-[220px]">
                  <SelectItem description="写入前需要确认" value="sandbox">
                    沙箱
                  </SelectItem>
                  <SelectItem
                    description={
                      <span className="text-amber-700 dark:text-amber-400">
                        写入将直接执行，请谨慎
                      </span>
                    }
                    value="full"
                  >
                    完全访问
                  </SelectItem>
                </SelectContent>
              </Select>
              {selectedModel && !selectedModel.supportsTools ? (
                <Link className="chat-settings-link text-xs" to="/settings/models">
                  模型未开 Tools
                </Link>
              ) : null}
            </div>
            <div className="chat-composer-actions">
              <Button
                aria-label={isGenerating ? "停止生成" : "发送消息"}
                className="chat-send-button"
                disabled={isGenerating ? false : !input.trim() || !canSend || pendingWrite !== null}
                size="icon"
                type="button"
                onClick={() => {
                  if (isGenerating) {
                    if (pendingWrite) {
                      writeGateRef.current.respond(pendingWrite.id, false);
                    }
                    void stop();
                    return;
                  }
                  submitMessage();
                }}
              >
                {isGenerating ? <CircleStop className="size-4" /> : <ArrowUp className="size-4" />}
              </Button>
            </div>
          </div>
        </div>
        <p className="chat-disclaimer">写入仅限所选工作目录；请核实 AI 生成的内容后再批准。</p>
      </div>
    </div>
  );
}

function MessageBubble({ message, isStreaming }: { message: UIMessage; isStreaming: boolean }) {
  const text = messageText(message);
  const isUser = message.role === "user";
  const toolParts = message.parts.filter(isToolUIPart);
  if (!isUser && !text.trim() && toolParts.length === 0) return null;

  return (
    <div className={`chat-message ${isUser ? "user-message" : "assistant-message"}`}>
      <div className={`chat-avatar ${isUser ? "user-avatar" : "assistant-avatar"}`}>
        {isUser ? <User className="size-4" /> : <Bot className="size-4" />}
      </div>
      <div className="chat-message-body">
        <div className="chat-message-meta">
          <strong>{isUser ? "你" : "Sandbox Agent"}</strong>
          <span>{isUser ? "刚刚" : isStreaming ? "生成中" : "已完成"}</span>
        </div>
        {!isUser && toolParts.length > 0 ? (
          <div className="chat-tool-calls">
            {toolParts.map((part) => (
              <ChatToolCallCard
                key={part.toolCallId}
                errorText={"errorText" in part ? part.errorText : undefined}
                input={part.input}
                output={"output" in part ? part.output : undefined}
                preliminary={"preliminary" in part ? Boolean(part.preliminary) : false}
                state={part.state}
                toolName={getToolName(part)}
              />
            ))}
          </div>
        ) : null}
        {text.trim() ? (
          <div className="chat-message-text">
            <Streamdown isAnimating={!isUser && isStreaming} plugins={{ code }}>
              {text}
            </Streamdown>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function resolveSelectedCwd(workspaceKey: string, projects: WorkspaceProject[]) {
  if (!workspaceKey) return "";
  return projects.find((project) => project.id === workspaceKey)?.path ?? "";
}

function pathBasename(path: string) {
  const parts = path.split(/[/\\]/).filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

function messageText(message: UIMessage) {
  return message.parts
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("");
}

function messageHasToolParts(message: UIMessage) {
  return message.parts.some(isToolUIPart);
}

function truncatePreview(content: string, max = 1200) {
  if (content.length <= max) return content;
  return `${content.slice(0, max)}\n…（已截断，共 ${content.length} 字符）`;
}

export { SandboxPage };
