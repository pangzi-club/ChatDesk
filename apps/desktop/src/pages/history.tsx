import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getToolName, isToolUIPart, type UIMessage } from "ai";
import {
  ArrowLeft,
  ChevronDown,
  ChevronUp,
  FileIcon,
  ImageIcon,
  MessageCircle,
  Trash2,
} from "lucide-react";
import { useMemo, useState } from "react";
import { Link, Navigate, useNavigate, useParams } from "react-router-dom";

import { ChatMarkdown } from "@/components/chat-markdown";
import { ChatToolCallGroup } from "@/components/chat-tool-call-card";
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  type ArchiveAsset,
  type ArchiveMessage,
  type ArchiveSource,
  type ArchiveToolCall,
  deleteArchiveSession,
  loadArchiveSession,
  pathExists,
  sourceLabel,
} from "@/lib/archive/chat-archive";
import {
  BROWSER_SCREENSHOT_TOOL_NAME,
  readBrowserScreenshotOutput,
} from "@/lib/chat/chat-browser-screenshots";
import {
  IMAGE_GENERATION_TOOL_NAME,
  readImageGenerationOutput,
} from "@/lib/chat/chat-image-generation";
import { chatSessionPath } from "@/lib/chat/chat-routes";
import { deleteChatSession, loadChatSession } from "@/lib/chat/chat-store";
import { assetUrl } from "@/lib/runtime/platform";

const MESSAGE_COLLAPSE_CHARS = 700;
const MESSAGE_COLLAPSE_LINES = 12;

type HistoryDetailView = {
  source: ArchiveSource;
  id: string;
  title: string;
  messages: ArchiveMessage[];
  messageCount: number;
  assetCount: number;
  updatedAt: string;
  createdAt: string;
  importedAt?: string;
  cwd?: string;
  model?: string;
};

function isHistorySource(value: string | undefined): value is ArchiveSource {
  return value === "native" || value === "codex" || value === "claude-code";
}

function HistoryDetailPage() {
  const { source, id } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const isNative = source === "native";

  const sessionQuery = useQuery({
    queryKey: ["history-detail", source, id],
    enabled: Boolean(id) && isHistorySource(source),
    queryFn: async (): Promise<HistoryDetailView | null> => {
      if (!id || !isHistorySource(source)) return null;
      if (source === "native") {
        const session = await loadChatSession(id);
        if (!session) return null;
        const messages = session.messages
          .filter((message) => message.role === "user" || message.role === "assistant")
          .map(uiMessageToArchiveMessage)
          .filter(
            (message) =>
              message.text.trim().length > 0 ||
              (message.assets?.length ?? 0) > 0 ||
              (message.toolCalls?.length ?? 0) > 0,
          );
        return {
          source: "native",
          id: session.id,
          title: session.title,
          messages,
          messageCount: session.messages.length,
          assetCount: session.attachments.length,
          updatedAt: session.updatedAt,
          createdAt: session.createdAt,
          model: session.modelId,
        };
      }
      const session = await loadArchiveSession(id);
      if (!session || session.source !== source) return null;
      return {
        source: session.source,
        id: session.id,
        title: session.title,
        messages: session.messages,
        messageCount: session.messages.length,
        assetCount: session.assetCount,
        updatedAt: session.updatedAt,
        createdAt: session.createdAt,
        importedAt: session.importedAt,
        cwd: session.cwd,
        model: session.model,
      };
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      if (!id || !isHistorySource(source)) return;
      if (source === "native") {
        await deleteChatSession(id);
        return;
      }
      await deleteArchiveSession(id);
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["chat-index"] }),
        queryClient.invalidateQueries({ queryKey: ["chat-archive-index"] }),
        queryClient.invalidateQueries({ queryKey: ["ai-usage-statistics"] }),
      ]);
      void navigate("/settings/statistics");
    },
  });

  if (!id || !isHistorySource(source)) return <Navigate replace to="/settings/statistics" />;

  if (sessionQuery.isPending) {
    return (
      <div className="flex h-full min-h-0 flex-col overflow-hidden">
        <div className="shrink-0 border-border border-b bg-background px-4 pt-12 pb-4 sm:px-6 lg:px-8">
          <div className="h-8 w-24 animate-pulse rounded bg-muted" />
          <div className="mt-4 h-8 w-1/2 animate-pulse rounded bg-muted" />
          <div className="mt-2 h-4 w-1/3 animate-pulse rounded bg-muted" />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-6 sm:px-6 lg:px-8">
          <HistoryDetailSkeleton />
        </div>
      </div>
    );
  }

  if (sessionQuery.isError) {
    return (
      <div className="flex h-full min-h-0 flex-col overflow-hidden">
        <div className="shrink-0 border-border border-b bg-background px-4 pt-12 pb-4 sm:px-6 lg:px-8">
          <Button asChild className="w-fit" size="sm" variant="ghost">
            <Link to="/settings/statistics">
              <ArrowLeft className="size-4" /> 返回
            </Link>
          </Button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-6 sm:px-6 lg:px-8">
          <p className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-destructive text-sm">
            {sessionQuery.error instanceof Error
              ? sessionQuery.error.message
              : String(sessionQuery.error)}
          </p>
        </div>
      </div>
    );
  }

  const session = sessionQuery.data;
  if (!session) {
    return <Navigate replace to="/settings/statistics" />;
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <header className="shrink-0 border-border border-b bg-background px-4 pt-12 pb-4 sm:px-6 lg:px-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 flex-1 space-y-3">
            <Button asChild className="w-fit" size="sm" variant="ghost">
              <Link to="/settings/statistics">
                <ArrowLeft className="size-4" /> 返回列表
              </Link>
            </Button>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="font-semibold text-2xl tracking-tight">{session.title}</h1>
                <Badge variant="secondary">{sourceLabel(session.source)}</Badge>
              </div>
              <p className="mt-2 text-muted-foreground text-sm">
                {session.messageCount} 条消息
                {session.assetCount > 0 ? ` · ${session.assetCount} 个资源` : ""}
                {session.importedAt
                  ? ` · 导入于 ${formatDateTime(session.importedAt)}`
                  : ` · 更新于 ${formatDateTime(session.updatedAt)}`}
              </p>
              {session.cwd ? (
                <p className="mt-1 break-all font-mono text-muted-foreground text-xs">
                  {session.cwd}
                </p>
              ) : null}
              {session.model ? (
                <p className="mt-1 text-muted-foreground text-xs">模型：{session.model}</p>
              ) : null}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {isNative ? (
              <Button
                onClick={() => {
                  void navigate(chatSessionPath(session.id));
                }}
                type="button"
              >
                <MessageCircle className="size-4" /> 继续对话
              </Button>
            ) : null}
            <Button onClick={() => setConfirmDelete(true)} type="button" variant="outline">
              <Trash2 className="size-4" /> {isNative ? "删除对话" : "删除归档"}
            </Button>
          </div>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-6 sm:px-6 lg:px-8">
        <section className="w-full space-y-4">
          {session.messages.length === 0 ? (
            <p className="rounded-md border border-border bg-muted/40 px-4 py-3 text-muted-foreground text-sm">
              此会话没有可显示的文本消息。
            </p>
          ) : (
            session.messages.map((message) => (
              <ArchiveMessageBubble key={message.id} message={message} />
            ))
          )}
        </section>
      </div>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{isNative ? "删除本机对话？" : "删除归档对话？"}</AlertDialogTitle>
            <AlertDialogDescription>
              {isNative
                ? `将删除「${session.title}」。此操作不可恢复。`
                : `将删除「${session.title}」。源文件不会被修改。`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteMutation.isPending}>取消</AlertDialogCancel>
            <AlertDialogAction
              disabled={deleteMutation.isPending}
              onClick={(event) => {
                event.preventDefault();
                void deleteMutation.mutateAsync();
              }}
            >
              删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function uiMessageToArchiveMessage(message: UIMessage): ArchiveMessage {
  const text = message.parts
    .filter(
      (part): part is Extract<UIMessage["parts"][number], { type: "text" }> => part.type === "text",
    )
    .map((part) => part.text)
    .join("\n")
    .trim();
  const toolParts = message.parts.filter(isToolUIPart);
  const toolCalls = toolParts.map((part): ArchiveToolCall => {
    return {
      id: part.toolCallId,
      toolName: getToolName(part),
      state: part.state,
      input: "input" in part ? part.input : undefined,
      output: "output" in part ? part.output : undefined,
      errorText: "errorText" in part ? part.errorText : undefined,
    };
  });
  const assets = toolParts.flatMap((part): ArchiveAsset[] => {
    if (!("output" in part)) return [];
    const toolName = getToolName(part);
    if (toolName === IMAGE_GENERATION_TOOL_NAME) {
      const { materialized, rawBase64 } = readImageGenerationOutput(part.output);
      if (materialized) {
        return [
          {
            id: materialized.attachmentId,
            kind: "image",
            fileName: materialized.fileName,
            mediaType: materialized.mediaType,
            ...(materialized.path ? { path: materialized.path } : {}),
            ...(materialized.url ? { url: materialized.url } : {}),
          },
        ];
      }
      if (rawBase64) {
        return [
          {
            id: part.toolCallId,
            kind: "image",
            fileName: `${part.toolCallId}.png`,
            mediaType: "image/png",
            url: `data:image/png;base64,${rawBase64}`,
          },
        ];
      }
      return [];
    }
    if (toolName === BROWSER_SCREENSHOT_TOOL_NAME) {
      const screenshot = readBrowserScreenshotOutput(part.output);
      if (!screenshot) return [];
      return [
        {
          id: screenshot.attachmentId,
          kind: "image",
          fileName: screenshot.fileName,
          mediaType: screenshot.mediaType,
          path: screenshot.path,
        },
      ];
    }
    return [];
  });
  return {
    id: message.id,
    role: message.role === "user" ? "user" : "assistant",
    text,
    ...(toolCalls.length > 0 ? { toolCalls } : {}),
    ...(assets.length > 0 ? { assets } : {}),
  };
}

function ArchiveMessageBubble({ message }: { message: ArchiveMessage }) {
  const isUser = message.role === "user";
  const markdown = useMemo(() => prepareArchiveMarkdown(message.text), [message.text]);
  const collapsible = useMemo(() => shouldCollapseMessage(message.text), [message.text]);
  const [expanded, setExpanded] = useState(false);
  const toolCalls = message.toolCalls ?? [];
  // 生成图和浏览器截图已在 ChatToolCallCard 预览，避免与 ArchiveAssetView 重复渲染。
  const assets = useMemo(() => {
    const coveredIds = new Set<string>();
    for (const call of toolCalls) {
      if (call.toolName === IMAGE_GENERATION_TOOL_NAME) {
        const { materialized } = readImageGenerationOutput(call.output);
        if (materialized) coveredIds.add(materialized.attachmentId);
        else coveredIds.add(call.id);
      }
      if (call.toolName === BROWSER_SCREENSHOT_TOOL_NAME) {
        const screenshot = readBrowserScreenshotOutput(call.output);
        if (screenshot) coveredIds.add(screenshot.attachmentId);
      }
    }
    return (message.assets ?? []).filter((asset) => !coveredIds.has(asset.id));
  }, [message.assets, toolCalls]);

  return (
    <article className={`flex w-full ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`history-message-bubble w-full max-w-full rounded-2xl border border-border bg-card px-4 py-3 text-sm sm:max-w-[min(100%,52rem)] ${
          isUser ? "history-message-user" : ""
        }`}
      >
        <div className="mb-2 flex items-center justify-between gap-3">
          <span className="font-medium text-muted-foreground text-xs">
            {isUser ? "用户" : "助手"}
          </span>
          {message.createdAt ? (
            <span className="text-[11px] text-muted-foreground">
              {formatDateTime(message.createdAt)}
            </span>
          ) : null}
        </div>

        {!isUser && toolCalls.length > 0 ? (
          <div className="chat-tool-calls mb-3">
            <ChatToolCallGroup
              calls={toolCalls.map((call) => ({
                id: call.id,
                toolName: call.toolName,
                state: call.state,
                input: call.input,
                output: call.output,
                errorText: call.errorText,
              }))}
            />
          </div>
        ) : null}

        {message.text ? (
          <div className="relative">
            <div
              className={`chat-message-text history-message-text ${
                collapsible && !expanded ? "history-message-collapsed" : ""
              }`}
            >
              <ChatMarkdown isAnimating={false}>{markdown}</ChatMarkdown>
            </div>
            {collapsible && !expanded ? <div className="history-message-fade" /> : null}
            {collapsible ? (
              <div className={`relative z-10 ${expanded ? "mt-3" : "mt-1"}`}>
                <Button
                  className="h-8 px-2 text-xs"
                  onClick={() => setExpanded((value) => !value)}
                  size="sm"
                  type="button"
                  variant="ghost"
                >
                  {expanded ? (
                    <>
                      <ChevronUp className="size-3.5" /> 收起
                    </>
                  ) : (
                    <>
                      <ChevronDown className="size-3.5" /> 展开全文
                    </>
                  )}
                </Button>
              </div>
            ) : null}
          </div>
        ) : null}

        {assets.length > 0 ? (
          <div className="mt-3 space-y-2">
            {assets.map((asset) => (
              <ArchiveAssetView key={asset.id} asset={asset} />
            ))}
          </div>
        ) : null}
      </div>
    </article>
  );
}

function ArchiveAssetView({ asset }: { asset: ArchiveAsset }) {
  const existsQuery = useQuery({
    queryKey: ["archive-asset-exists", asset.path],
    queryFn: () => pathExists(asset.path ?? ""),
    enabled: Boolean(asset.path),
  });

  if (asset.kind === "image" && asset.url) {
    return (
      <a
        className="block overflow-hidden rounded-lg"
        href={asset.url}
        rel="noreferrer"
        target="_blank"
      >
        <img
          alt={asset.fileName ?? "image"}
          className="max-h-64 max-w-full object-contain"
          src={asset.url}
        />
      </a>
    );
  }

  if (asset.kind === "image" && asset.path && existsQuery.data) {
    const src = assetUrl(asset.path);
    if (src) {
      return (
        <div className="overflow-hidden rounded-lg">
          <img
            alt={asset.fileName ?? "image"}
            className="max-h-64 max-w-full object-contain"
            src={src}
          />
        </div>
      );
    }
  }

  return (
    <div className="flex items-center gap-2 rounded-md bg-muted px-3 py-2 text-xs">
      {asset.kind === "image" ? (
        <ImageIcon className="size-3.5" />
      ) : (
        <FileIcon className="size-3.5" />
      )}
      <span className="truncate">{asset.fileName ?? asset.path ?? asset.url ?? "附件"}</span>
      {asset.path && existsQuery.data === false ? (
        <span className="text-muted-foreground">（文件不存在）</span>
      ) : null}
      {!asset.path && !asset.url ? (
        <span className="text-muted-foreground">（无本地路径）</span>
      ) : null}
    </div>
  );
}

function HistoryDetailSkeleton() {
  return (
    <div className="w-full space-y-4">
      {[
        { key: "first", alignment: "justify-end" },
        { key: "second", alignment: "justify-start" },
        { key: "third", alignment: "justify-end" },
        { key: "fourth", alignment: "justify-start" },
      ].map((item) => (
        <div key={item.key} className={`flex ${item.alignment}`}>
          <div className="h-24 w-full max-w-[min(100%,52rem)] animate-pulse rounded-2xl bg-muted" />
        </div>
      ))}
    </div>
  );
}

function shouldCollapseMessage(text: string) {
  if (!text) return false;
  if (text.length >= MESSAGE_COLLAPSE_CHARS) return true;
  return text.split(/\r?\n/).length > MESSAGE_COLLAPSE_LINES;
}

function prepareArchiveMarkdown(text: string) {
  const trimmed = text.trim();
  if (!trimmed) return text;

  if (/^```/.test(trimmed)) return text;

  if (
    (trimmed.startsWith("{") || trimmed.startsWith("[")) &&
    (trimmed.endsWith("}") || trimmed.endsWith("]"))
  ) {
    try {
      const pretty = JSON.stringify(JSON.parse(trimmed), null, 2);
      return `\`\`\`json\n${pretty}\n\`\`\``;
    } catch {
      return text;
    }
  }

  return text;
}

function formatDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-CN");
}

export { HistoryDetailPage };
