import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MessageCircle, RefreshCw, Send, Settings2, Trash2, WifiOff } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
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
import { Textarea } from "@/components/ui/textarea";
import {
  listenAssistantError,
  listenAssistantMessage,
  listenAssistantStatus,
  deleteAssistantConversation,
  loadAssistantConversations,
  loadAssistantMessages,
  loadAssistantStatus,
  sendAssistantMessage,
  type AssistantConnection,
} from "@/lib/assistant";

const statusLabels: Record<string, string> = {
  unconfigured: "未配置",
  starting: "连接中",
  connected: "已连接",
  stopped: "已停止",
  error: "连接错误",
};

export function AssistantPage() {
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<string>();
  const [text, setText] = useState("");
  const [eventError, setEventError] = useState("");
  const [conversationToDelete, setConversationToDelete] = useState<string | null>(null);
  const statusQuery = useQuery({
    queryKey: ["assistant-status"],
    queryFn: loadAssistantStatus,
    refetchInterval: 15_000,
  });
  const conversationsQuery = useQuery({
    queryKey: ["assistant-conversations"],
    queryFn: loadAssistantConversations,
  });
  const conversations = conversationsQuery.data ?? [];
  const activeId = selectedId ?? conversations[0]?.id;
  const messagesQuery = useQuery({
    queryKey: ["assistant-messages", activeId],
    queryFn: () => loadAssistantMessages(activeId as string),
    enabled: Boolean(activeId),
  });
  const sendMutation = useMutation({
    mutationFn: ({ id, value }: { id: string; value: string }) => sendAssistantMessage(id, value),
    onSuccess: (message) => {
      queryClient.setQueryData(
        ["assistant-messages", message.conversationId],
        (old: typeof messagesQuery.data = []) => [...(old ?? []), message],
      );
      setText("");
    },
  });
  const deleteMutation = useMutation({
    mutationFn: deleteAssistantConversation,
    onError: () => setEventError("删除会话失败，请重试。"),
    onSuccess: (_, conversationId) => {
      queryClient.removeQueries({ queryKey: ["assistant-messages", conversationId] });
      queryClient.invalidateQueries({ queryKey: ["assistant-conversations"] });
      if (selectedId === conversationId) setSelectedId(undefined);
      setConversationToDelete(null);
    },
  });

  useEffect(() => {
    let cleanups: Array<() => void> = [];
    void Promise.all([
      listenAssistantStatus((status) =>
        queryClient.setQueryData<AssistantConnection>(["assistant-status"], status),
      ),
      listenAssistantMessage((event) => {
        queryClient.invalidateQueries({ queryKey: ["assistant-conversations"] });
        queryClient.setQueryData(
          ["assistant-messages", event.message.conversationId],
          (old: typeof messagesQuery.data = []) => [
            ...(old ?? []).filter((item) => item.id !== event.message.id),
            event.message,
          ],
        );
      }),
      listenAssistantError(setEventError),
    ]).then((items) => {
      cleanups = items;
    });
    return () => cleanups.forEach((cleanup) => cleanup());
  }, [queryClient]);

  function submit() {
    if (!activeId || !text.trim() || sendMutation.isPending) return;
    sendMutation.mutate({ id: activeId, value: text.trim() });
  }
  const status = statusQuery.data;
  const activeConversation = useMemo(
    () => conversations.find((item) => item.id === activeId),
    [activeId, conversations],
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex shrink-0 items-center justify-between border-border border-b px-8 pt-12 pb-4">
        <div>
          <p className="font-medium text-muted-foreground text-xs uppercase tracking-[0.16em]">
            Assistant
          </p>
          <h1 className="mt-1 font-semibold text-2xl">飞书助理</h1>
        </div>
        <div className="flex items-center gap-2 text-muted-foreground text-xs">
          <span
            className={`inline-flex size-2 rounded-full ${status?.status === "connected" ? "bg-emerald-500" : "bg-amber-500"}`}
          />
          {statusLabels[status?.status ?? "stopped"]}
          {status?.detail ? ` · ${status.detail}` : ""}
          <Button
            aria-label="刷新助理状态"
            disabled={statusQuery.isFetching}
            onClick={() => void Promise.all([statusQuery.refetch(), conversationsQuery.refetch()])}
            size="icon"
            variant="ghost"
          >
            <RefreshCw className={statusQuery.isFetching ? "size-4 animate-spin" : "size-4"} />
          </Button>
          <Button asChild aria-label="打开助理设置" size="sm" variant="outline">
            <Link to="/settings/assistant">
              <Settings2 className="size-3.5" />
              设置
            </Link>
          </Button>
        </div>
      </header>
      {eventError ? (
        <p className="border-destructive/30 border-b bg-destructive/5 px-8 py-2 text-destructive text-xs">
          {eventError}
        </p>
      ) : null}
      <div className="flex min-h-0 flex-1">
        <aside className="w-[280px] shrink-0 overflow-y-auto border-border border-r p-3">
          <p className="px-2 py-2 font-medium text-muted-foreground text-xs">用户会话</p>
          {conversationsQuery.isPending ? (
            <div className="space-y-2 p-2">
              <div className="h-14 animate-pulse rounded-md bg-accent" />
              <div className="h-14 animate-pulse rounded-md bg-accent" />
            </div>
          ) : conversations.length === 0 ? (
            <div className="px-2 py-10 text-center text-muted-foreground text-xs">
              <MessageCircle className="mx-auto mb-2 size-6" />
              暂无飞书消息
            </div>
          ) : (
            conversations.map((conversation) => (
              <div
                className={`mb-1 flex items-stretch rounded-md transition-colors ${conversation.id === activeId ? "bg-accent" : "hover:bg-accent/60"}`}
                key={conversation.id}
              >
                <button
                  className="min-w-0 flex-1 px-3 py-2 text-left"
                  onClick={() => setSelectedId(conversation.id)}
                  type="button"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate font-medium text-sm">{conversation.displayName}</span>
                    {conversation.unreadCount > 0 ? (
                      <span className="rounded-full bg-primary px-1.5 text-[10px] text-primary-foreground">
                        {conversation.unreadCount}
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-1 truncate text-muted-foreground text-xs">{conversation.lastMessage}</p>
                </button>
                <Button
                  aria-label={`删除会话 ${conversation.displayName}`}
                  className="mr-1 self-center text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                  disabled={deleteMutation.isPending}
                  onClick={() => setConversationToDelete(conversation.id)}
                  size="icon"
                  type="button"
                  variant="ghost"
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </div>
            ))
          )}
        </aside>
        <section className="flex min-w-0 flex-1 flex-col">
          {!activeId ? (
            <div className="flex flex-1 flex-col items-center justify-center text-muted-foreground">
              <WifiOff className="size-8" />
              <p className="mt-3 font-medium text-sm">选择一个会话开始对话</p>
              <p className="mt-1 text-xs">飞书用户发来消息后会显示在这里。</p>
            </div>
          ) : (
            <>
              <div className="border-border border-b px-6 py-4">
                <h2 className="font-medium text-sm">{activeConversation?.displayName}</h2>
                <p className="mt-1 font-mono text-muted-foreground text-[11px]">
                  {activeConversation?.openId}
                </p>
              </div>
              <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-6">
                {messagesQuery.isPending ? (
                  <>
                    <div className="ml-auto h-12 w-2/5 animate-pulse rounded-md bg-accent" />
                    <div className="h-16 w-3/5 animate-pulse rounded-md bg-accent" />
                  </>
                ) : (
                  (messagesQuery.data ?? []).map((message) => (
                    <div
                      className={`flex ${message.direction === "outbound" ? "justify-end" : "justify-start"}`}
                      key={message.id}
                    >
                      <div
                        className={`max-w-[72%] rounded-lg px-3 py-2 text-sm ${message.direction === "outbound" ? "bg-primary text-primary-foreground" : "bg-accent"}`}
                      >
                        <p className="whitespace-pre-wrap">{message.text}</p>
                        <time className="mt-1 block text-[10px] opacity-60">
                          {new Date(message.timestamp).toLocaleString("zh-CN")}
                        </time>
                      </div>
                    </div>
                  ))
                )}
              </div>
              <form
                className="border-border border-t p-4"
                onSubmit={(event) => {
                  event.preventDefault();
                  submit();
                }}
              >
                <div className="flex items-end gap-2">
                  <Textarea
                    className="min-h-12 resize-none"
                    onChange={(event) => setText(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && !event.shiftKey) {
                        event.preventDefault();
                        submit();
                      }
                    }}
                    placeholder="输入回复…"
                    value={text}
                  />
                  <Button
                    aria-label="发送消息"
                    disabled={
                      !text.trim() || sendMutation.isPending || status?.status !== "connected"
                    }
                    size="icon"
                    type="submit"
                  >
                    <Send className="size-4" />
                  </Button>
                </div>
                {sendMutation.isError ? (
                  <p className="mt-2 text-destructive text-xs">发送失败，请检查连接后重试。</p>
                ) : null}
              </form>
            </>
          )}
        </section>
      </div>
      <AlertDialog
        onOpenChange={(open) => {
          if (!open && !deleteMutation.isPending) setConversationToDelete(null);
        }}
        open={conversationToDelete !== null}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除会话？</AlertDialogTitle>
            <AlertDialogDescription>这会删除本地保存的消息记录，无法恢复。</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteMutation.isPending}>取消</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deleteMutation.isPending}
              onClick={() => {
                if (conversationToDelete) deleteMutation.mutate(conversationToDelete);
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
