import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MessageCircle, Send, Settings2, Trash2, WifiOff } from "lucide-react";
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
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  type AssistantConnection,
  type AssistantConversation,
  deleteAssistantConversation,
  listenAssistantError,
  listenAssistantMessage,
  listenAssistantStatus,
  loadAssistantConversations,
  loadAssistantEnabled,
  loadAssistantMessages,
  loadAssistantStatus,
  loadFeishuCredentials,
  markAssistantConversationRead,
  saveAssistantEnabled,
  sendAssistantMessage,
  startAssistant,
  stopAssistant,
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
  const assistantEnabledQuery = useQuery({
    queryKey: ["assistant-enabled"],
    queryFn: loadAssistantEnabled,
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
  const markReadMutation = useMutation({
    mutationFn: markAssistantConversationRead,
    onSuccess: (_, conversationId) => {
      queryClient.setQueryData<AssistantConversation[]>(["assistant-conversations"], (items = []) =>
        items.map((item) => (item.id === conversationId ? { ...item, unreadCount: 0 } : item)),
      );
    },
  });
  const connectionMutation = useMutation({
    mutationFn: async (enabled: boolean) => {
      let connection: AssistantConnection;
      if (!enabled) {
        connection = await stopAssistant();
      } else {
        const credentials = await loadFeishuCredentials();
        if (!credentials.appId || !credentials.appSecret) {
          throw new Error("missing credentials");
        }
        connection = await startAssistant(credentials.appId, credentials.appSecret);
      }
      await saveAssistantEnabled(enabled);
      return connection;
    },
    onError: () => setEventError("连接操作失败，请检查飞书配置。"),
    onSuccess: (connection, enabled) => {
      queryClient.setQueryData(["assistant-enabled"], enabled);
      queryClient.setQueryData(["assistant-status"], connection);
      if (connection.status === "connected") {
        void conversationsQuery.refetch();
      }
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
    return () => {
      cleanups.forEach((cleanup) => {
        cleanup();
      });
    };
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
  useEffect(() => {
    if (activeId && activeConversation?.unreadCount) {
      markReadMutation.mutate(activeId);
    }
  }, [activeConversation?.unreadCount, activeId, markReadMutation.mutate]);
  const connectionEnabled =
    status?.status === "connected" || status?.status === "starting"
      ? true
      : (assistantEnabledQuery.data ?? false);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex shrink-0 items-center justify-between border-border border-b px-8 pt-12 pb-4 dark:bg-neutral-950/40">
        <div>
          <p className="font-medium text-muted-foreground text-xs uppercase tracking-[0.16em]">
            Assistant
          </p>
          <h1 className="mt-1 font-semibold text-2xl">飞书助理</h1>
        </div>
        <div className="flex items-center gap-3 text-muted-foreground text-xs">
          <span className="flex items-center gap-1.5 whitespace-nowrap">
            <span
              className={`inline-flex size-2 rounded-full ${status?.status === "connected" ? "bg-emerald-500" : "bg-amber-500"}`}
            />
            <span>
              {statusLabels[status?.status ?? "stopped"]}
              {status?.status !== "stopped" && status?.detail ? ` · ${status.detail}` : ""}
            </span>
          </span>
          <Switch
            aria-label={connectionEnabled ? "断开飞书连接" : "连接飞书"}
            checked={connectionEnabled}
            disabled={
              connectionMutation.isPending ||
              statusQuery.isPending ||
              status?.status === "unconfigured"
            }
            onCheckedChange={(checked) => {
              setEventError("");
              connectionMutation.mutate(checked === true);
            }}
            size="sm"
            title={connectionEnabled ? "断开飞书连接" : "连接飞书"}
            className="dark:data-[state=checked]:bg-cyan-400 dark:data-[state=unchecked]:bg-neutral-700"
          />
          <Button
            asChild
            aria-label="打开助理设置"
            className="size-8"
            title="打开助理设置"
            size="icon"
            variant="ghost"
          >
            <Link to="/settings/assistant">
              <Settings2 className="size-4" />
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
        <aside className="w-[280px] shrink-0 overflow-y-auto border-border border-r bg-card p-3 dark:bg-slate-950/30">
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
                className={`mb-1 flex items-stretch rounded-md transition-colors ${conversation.id === activeId ? "bg-accent dark:bg-indigo-500/20 dark:text-indigo-50" : "hover:bg-accent/60 dark:hover:bg-indigo-500/10"}`}
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
                      <span
                        aria-label={`未读消息 ${conversation.unreadCount} 条`}
                        className="inline-flex min-w-4 shrink-0 items-center justify-center rounded-full bg-primary/12 px-1.5 py-0.5 font-medium text-[10px] text-primary dark:bg-cyan-400/20 dark:text-cyan-200"
                        role="status"
                        title={`未读消息 ${conversation.unreadCount} 条`}
                      >
                        {conversation.unreadCount > 99 ? "99+" : conversation.unreadCount}
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-1 truncate text-muted-foreground text-xs">
                    {conversation.lastMessage}
                  </p>
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
        <section className="flex min-w-0 flex-1 flex-col dark:bg-neutral-950/20">
          {!activeId ? (
            <div className="flex flex-1 flex-col items-center justify-center text-muted-foreground">
              <WifiOff className="size-8" />
              <p className="mt-3 font-medium text-sm">选择一个会话开始对话</p>
              <p className="mt-1 text-xs">飞书用户发来消息后会显示在这里。</p>
            </div>
          ) : (
            <>
              <div className="border-border border-b px-6 py-4 dark:bg-neutral-950/30">
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
                      className={`flex items-start gap-2 ${message.direction === "outbound" ? "justify-end" : "justify-start"}`}
                      key={message.id}
                    >
                      {message.direction === "inbound" ? (
                        <Avatar
                          aria-label={`${activeConversation?.displayName ?? "用户"}头像`}
                          size="sm"
                        >
                          <AvatarFallback className="dark:bg-emerald-500/20 dark:text-emerald-200">
                            {activeConversation?.displayName?.slice(0, 1) ?? "用"}
                          </AvatarFallback>
                        </Avatar>
                      ) : null}
                      <div
                        className={`max-w-[72%] rounded-lg px-3 py-2 text-sm ${message.direction === "outbound" ? "bg-primary text-primary-foreground dark:bg-cyan-400 dark:text-cyan-950" : "bg-accent dark:bg-emerald-950/50 dark:text-emerald-50"}`}
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
