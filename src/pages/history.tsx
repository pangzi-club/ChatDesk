import { code } from "@streamdown/code";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useVirtualizer, type VirtualItem } from "@tanstack/react-virtual";
import { convertFileSrc } from "@tauri-apps/api/core";
import { getToolName, isToolUIPart, type UIMessage } from "ai";
import {
  ArrowLeft,
  ChartColumn,
  ChevronDown,
  ChevronUp,
  FileIcon,
  History as HistoryIcon,
  ImageIcon,
  Import,
  MessageCircle,
  Search,
  Trash2,
} from "lucide-react";
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Link, Navigate, useNavigate, useParams } from "react-router-dom";
import { Streamdown } from "streamdown";
import "streamdown/styles.css";

import { ChatToolCallGroup } from "@/components/chat-tool-call-card";
import { HistoryImportDialog } from "@/components/history-import-dialog";
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
import { Input } from "@/components/ui/input";
import {
  type ArchiveAsset,
  type ArchiveIndexItem,
  type ArchiveMessage,
  type ArchiveSource,
  type ArchiveToolCall,
  deleteArchiveSession,
  loadArchiveIndex,
  loadArchiveSession,
  pathExists,
  sourceLabel,
} from "@/lib/chat-archive";
import { IMAGE_GENERATION_TOOL_NAME, readImageGenerationOutput } from "@/lib/chat-image-generation";
import {
  type ChatIndexItem,
  deleteChatSession,
  loadChatIndex,
  loadChatSession,
} from "@/lib/chat-store";

const MESSAGE_COLLAPSE_CHARS = 700;
const MESSAGE_COLLAPSE_LINES = 12;
const HISTORY_ROW_ESTIMATE = 88;

type SourceFilter = "all" | ArchiveSource;

type HistoryListViewState = {
  scrollTop: number;
  measurements: VirtualItem[];
  search: string;
  sourceFilter: SourceFilter;
};

const historyListViewState: HistoryListViewState = {
  scrollTop: 0,
  measurements: [],
  search: "",
  sourceFilter: "all",
};

function saveHistoryListScroll(scrollTop: number, measurements?: VirtualItem[]) {
  historyListViewState.scrollTop = scrollTop;
  if (measurements) historyListViewState.measurements = measurements;
}

function saveHistoryListFilters(search: string, sourceFilter: SourceFilter) {
  historyListViewState.search = search;
  historyListViewState.sourceFilter = sourceFilter;
}

type UnifiedItem = {
  id: string;
  source: ArchiveSource;
  title: string;
  updatedAt: string;
  createdAt: string;
  messageCount: number;
  assetCount: number;
  cwd?: string;
  externalId?: string;
};

function historyItemKey(item: UnifiedItem) {
  return `${item.source}:${item.id}`;
}

function HistoryPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const listScrollRef = useRef<HTMLDivElement>(null);
  const restoreScrollPendingRef = useRef(historyListViewState.scrollTop > 0);
  const restoredScrollRef = useRef({
    offset: historyListViewState.scrollTop,
    measurements: historyListViewState.measurements,
  });
  const [search, setSearch] = useState(historyListViewState.search);
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>(historyListViewState.sourceFilter);
  const [importOpen, setImportOpen] = useState(false);
  const [itemToDelete, setItemToDelete] = useState<ArchiveIndexItem | null>(null);

  const nativeQuery = useQuery({
    queryKey: ["chat-index"],
    queryFn: loadChatIndex,
  });
  const archiveQuery = useQuery({
    queryKey: ["chat-archive-index"],
    queryFn: loadArchiveIndex,
  });

  const deleteMutation = useMutation({
    mutationFn: deleteArchiveSession,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["chat-archive-index"] });
      setItemToDelete(null);
    },
  });

  const isPending = nativeQuery.isPending || archiveQuery.isPending;
  const error = nativeQuery.error ?? archiveQuery.error;

  const items = useMemo(() => {
    const nativeItems: UnifiedItem[] = (nativeQuery.data ?? []).map((item: ChatIndexItem) => ({
      id: item.id,
      source: "native",
      title: item.title,
      updatedAt: item.updatedAt,
      createdAt: item.createdAt,
      messageCount: item.messageCount,
      assetCount: item.attachmentCount,
    }));
    const archiveItems: UnifiedItem[] = (archiveQuery.data ?? []).map((item) => ({
      id: item.id,
      source: item.source,
      title: item.title,
      updatedAt: item.updatedAt,
      createdAt: item.createdAt,
      messageCount: item.messageCount,
      assetCount: item.assetCount,
      cwd: item.cwd,
      externalId: item.externalId,
    }));
    return [...nativeItems, ...archiveItems].sort((left, right) =>
      right.updatedAt.localeCompare(left.updatedAt),
    );
  }, [archiveQuery.data, nativeQuery.data]);

  const filtered = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    return items.filter((item) => {
      if (sourceFilter !== "all" && item.source !== sourceFilter) return false;
      if (!keyword) return true;
      return (
        item.title.toLowerCase().includes(keyword) ||
        (item.cwd?.toLowerCase().includes(keyword) ?? false) ||
        (item.externalId?.toLowerCase().includes(keyword) ?? false)
      );
    });
  }, [items, search, sourceFilter]);

  const archiveById = useMemo(() => {
    const map = new Map<string, ArchiveIndexItem>();
    for (const item of archiveQuery.data ?? []) {
      map.set(item.id, item);
    }
    return map;
  }, [archiveQuery.data]);

  const showVirtualList = !isPending && filtered.length > 0;

  const rowVirtualizer = useVirtualizer({
    count: showVirtualList ? filtered.length : 0,
    getScrollElement: () => listScrollRef.current,
    estimateSize: () => HISTORY_ROW_ESTIMATE,
    overscan: 12,
    initialOffset: restoredScrollRef.current.offset,
    initialMeasurementsCache: restoredScrollRef.current.measurements,
    getItemKey: (index) => {
      const item = filtered[index];
      return item ? historyItemKey(item) : index;
    },
  });

  useEffect(() => {
    saveHistoryListFilters(search, sourceFilter);
  }, [search, sourceFilter]);

  useLayoutEffect(() => {
    if (!showVirtualList || !restoreScrollPendingRef.current) return;
    const offset = restoredScrollRef.current.offset;
    if (offset > 0) {
      rowVirtualizer.scrollToOffset(offset);
      const node = listScrollRef.current;
      if (node) node.scrollTop = offset;
    }
    // 等一帧后再放开 onScroll 写入，避免挂载阶段的 scrollTop=0 覆盖已保存位置
    const frame = requestAnimationFrame(() => {
      restoreScrollPendingRef.current = false;
    });
    return () => cancelAnimationFrame(frame);
  }, [showVirtualList, rowVirtualizer]);

  useEffect(() => {
    return () => {
      saveHistoryListScroll(
        rowVirtualizer.scrollOffset ??
          listScrollRef.current?.scrollTop ??
          historyListViewState.scrollTop,
        rowVirtualizer.takeSnapshot(),
      );
    };
  }, [rowVirtualizer]);

  function persistListScroll() {
    saveHistoryListScroll(
      listScrollRef.current?.scrollTop ?? rowVirtualizer.scrollOffset ?? 0,
      rowVirtualizer.takeSnapshot(),
    );
  }

  function resetListScroll() {
    saveHistoryListScroll(0, []);
    restoredScrollRef.current = { offset: 0, measurements: [] };
    restoreScrollPendingRef.current = false;
    if (listScrollRef.current) listScrollRef.current.scrollTop = 0;
    rowVirtualizer.scrollToOffset(0);
  }

  function openHistoryItem(item: UnifiedItem) {
    persistListScroll();
    void navigate(`/settings/history/${item.source}/${item.id}`);
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <header className="shrink-0 border-border border-b bg-background px-4 pt-12 pb-4 sm:px-6 lg:px-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="font-medium text-muted-foreground text-xs uppercase tracking-[0.16em]">
              Chat
            </p>
            <h1 className="mt-2 font-semibold text-3xl tracking-tight">History</h1>
            <p className="mt-2 text-muted-foreground text-sm">
              浏览本机对话，并导入 Codex / Claude Code 归档。
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              onClick={() => {
                persistListScroll();
                void navigate("/settings/history/analysis");
              }}
              type="button"
              variant="outline"
            >
              <ChartColumn className="size-4" /> 分析
            </Button>
            <Button onClick={() => setImportOpen(true)} type="button">
              <Import className="size-4" /> 导入
            </Button>
          </div>
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-3">
          <div className="relative min-w-[220px] flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="pl-9"
              onChange={(event) => {
                setSearch(event.target.value);
                resetListScroll();
              }}
              placeholder="搜索标题、路径…"
              value={search}
            />
          </div>
          <div className="flex flex-wrap gap-2">
            {(
              [
                ["all", "全部"],
                ["native", "本机"],
                ["codex", "Codex"],
                ["claude-code", "Claude Code"],
              ] as const
            ).map(([value, label]) => (
              <Button
                key={value}
                onClick={() => {
                  setSourceFilter(value);
                  resetListScroll();
                }}
                size="sm"
                type="button"
                variant={sourceFilter === value ? "default" : "outline"}
              >
                {label}
              </Button>
            ))}
          </div>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col px-4 py-6 sm:px-6 lg:px-8">
        {error ? (
          <p className="mb-4 shrink-0 rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-destructive text-sm">
            {error instanceof Error ? error.message : String(error)}
          </p>
        ) : null}

        {isPending ? (
          <div className="min-h-0 flex-1 overflow-y-auto">
            <HistoryListSkeleton />
          </div>
        ) : filtered.length === 0 ? (
          <div className="min-h-0 flex-1 overflow-y-auto">
            <EmptyHistory hasAny={items.length > 0} onImport={() => setImportOpen(true)} />
          </div>
        ) : (
          <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-border bg-card">
            <div className="shrink-0 border-border border-b px-5 py-4">
              <h2 className="font-medium text-sm">
                对话列表 <span className="ml-1 text-muted-foreground">{filtered.length}</span>
              </h2>
            </div>
            <div
              className="min-h-0 flex-1 overflow-y-auto"
              onScroll={(event) => {
                if (restoreScrollPendingRef.current) return;
                saveHistoryListScroll(event.currentTarget.scrollTop);
              }}
              ref={listScrollRef}
            >
              <div
                className="relative w-full"
                style={{ height: `${rowVirtualizer.getTotalSize()}px` }}
              >
                {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                  const item = filtered[virtualRow.index];
                  if (!item) return null;
                  return (
                    <div
                      key={virtualRow.key}
                      className="absolute top-0 left-0 w-full border-border border-b"
                      data-index={virtualRow.index}
                      ref={rowVirtualizer.measureElement}
                      style={{
                        transform: `translateY(${virtualRow.start}px)`,
                      }}
                    >
                      <HistoryRow
                        item={item}
                        onDelete={
                          item.source === "native"
                            ? undefined
                            : () => {
                                const archiveItem = archiveById.get(item.id);
                                if (archiveItem) setItemToDelete(archiveItem);
                              }
                        }
                        onOpen={() => openHistoryItem(item)}
                      />
                    </div>
                  );
                })}
              </div>
            </div>
          </section>
        )}
      </div>

      <HistoryImportDialog
        archiveIndex={archiveQuery.data ?? []}
        onImported={() => {
          void queryClient.invalidateQueries({ queryKey: ["chat-archive-index"] });
          void queryClient.invalidateQueries({ queryKey: ["history-analysis"] });
        }}
        onOpenChange={setImportOpen}
        open={importOpen}
      />

      <AlertDialog
        open={Boolean(itemToDelete)}
        onOpenChange={(open) => {
          if (!open) setItemToDelete(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除归档对话？</AlertDialogTitle>
            <AlertDialogDescription>
              将删除「{itemToDelete?.title}」。源文件不会被修改，之后可重新导入。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteMutation.isPending}>取消</AlertDialogCancel>
            <AlertDialogAction
              disabled={deleteMutation.isPending || !itemToDelete}
              onClick={(event) => {
                event.preventDefault();
                if (itemToDelete) void deleteMutation.mutateAsync(itemToDelete.id);
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

const HistoryRow = memo(function HistoryRow({
  item,
  onOpen,
  onDelete,
}: {
  item: UnifiedItem;
  onOpen: () => void;
  onDelete?: () => void;
}) {
  return (
    <article className="flex flex-wrap items-center gap-3 px-5 py-4 transition-colors hover:bg-accent/30">
      <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-accent text-muted-foreground">
        {item.source === "native" ? (
          <MessageCircle className="size-4" />
        ) : (
          <HistoryIcon className="size-4" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="font-medium text-sm">{item.title}</h3>
          <Badge variant="secondary">{sourceLabel(item.source)}</Badge>
        </div>
        <p className="mt-1 text-muted-foreground text-xs">
          {formatDateTime(item.updatedAt)} · {item.messageCount} 条消息
          {item.assetCount > 0 ? ` · ${item.assetCount} 个资源` : ""}
        </p>
        {item.cwd ? (
          <p className="mt-1 break-all font-mono text-muted-foreground text-xs">{item.cwd}</p>
        ) : null}
      </div>
      <div className="flex items-center gap-2">
        <Button onClick={onOpen} size="sm" type="button" variant="outline">
          查看
        </Button>
        {onDelete ? (
          <Button onClick={onDelete} size="sm" type="button" variant="ghost">
            <Trash2 className="size-4" />
          </Button>
        ) : null}
      </div>
    </article>
  );
});

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
      ]);
      void navigate("/settings/history");
    },
  });

  if (!id || !isHistorySource(source)) return <Navigate replace to="/settings/history" />;

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
            <Link to="/settings/history">
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
    return <Navigate replace to="/settings/history" />;
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <header className="shrink-0 border-border border-b bg-background px-4 pt-12 pb-4 sm:px-6 lg:px-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 flex-1 space-y-3">
            <Button asChild className="w-fit" size="sm" variant="ghost">
              <Link to="/settings/history">
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
                  void navigate(`/chat?sessionId=${encodeURIComponent(session.id)}`);
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
    if (getToolName(part) !== IMAGE_GENERATION_TOOL_NAME || !("output" in part)) return [];
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
  // 生成图已在 ChatToolCallCard 预览，避免与 ArchiveAssetView 重复渲染。
  const assets = useMemo(() => {
    const coveredIds = new Set<string>();
    for (const call of toolCalls) {
      if (call.toolName !== IMAGE_GENERATION_TOOL_NAME) continue;
      const { materialized } = readImageGenerationOutput(call.output);
      if (materialized) coveredIds.add(materialized.attachmentId);
      else coveredIds.add(call.id);
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
              <Streamdown plugins={{ code }}>{markdown}</Streamdown>
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
    let src = "";
    try {
      src = convertFileSrc(asset.path);
    } catch {
      src = "";
    }
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

function EmptyHistory({ hasAny, onImport }: { hasAny: boolean; onImport: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border px-6 py-16 text-center">
      <HistoryIcon className="size-8 text-muted-foreground" />
      <h2 className="mt-4 font-medium text-base">{hasAny ? "没有匹配的对话" : "还没有对话历史"}</h2>
      <p className="mt-2 max-w-md text-muted-foreground text-sm">
        {hasAny
          ? "试试调整搜索词或来源筛选。"
          : "在 Chat 中开始对话，或从 Codex / Claude Code 导入归档。"}
      </p>
      {!hasAny ? (
        <Button className="mt-5" onClick={onImport} type="button">
          <Import className="size-4" /> 导入对话
        </Button>
      ) : null}
    </div>
  );
}

function HistoryListSkeleton() {
  return (
    <section className="overflow-hidden rounded-lg border border-border bg-card">
      <div className="border-border border-b px-5 py-4">
        <div className="h-4 w-28 animate-pulse rounded bg-muted" />
      </div>
      <div className="divide-y divide-border">
        {["one", "two", "three", "four", "five", "six"].map((key) => (
          <div key={key} className="flex items-center gap-3 px-5 py-4">
            <div className="size-9 animate-pulse rounded-md bg-muted" />
            <div className="min-w-0 flex-1 space-y-2">
              <div className="h-4 w-1/3 animate-pulse rounded bg-muted" />
              <div className="h-3 w-1/2 animate-pulse rounded bg-muted" />
            </div>
            <div className="h-8 w-16 animate-pulse rounded-md bg-muted" />
          </div>
        ))}
      </div>
    </section>
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

export { HistoryDetailPage, HistoryPage };
