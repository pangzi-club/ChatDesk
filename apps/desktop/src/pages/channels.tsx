import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bot, RefreshCw, Send } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  chatServerRequest,
  loadChatServerPort,
  loadFeishuChannelStatus,
  loadFeishuContacts,
  loadFeishuMessages,
  loadFeishuUnread,
  markFeishuContactRead,
  subscribeChatServerEvents,
} from "@/lib/chat-server";

function formatMessageTime(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

export function ChannelsPage() {
  const client = useQueryClient();
  const [selected, setSelected] = useState<string>();
  const [text, setText] = useState("");
  const contacts = useQuery({ queryKey: ["feishu-contacts"], queryFn: () => loadFeishuContacts() });
  const unread = useQuery({ queryKey: ["feishu-unread"], queryFn: () => loadFeishuUnread() });
  const channelStatus = useQuery({
    queryKey: ["feishu-status"],
    queryFn: () => loadFeishuChannelStatus(),
  });
  useEffect(() => {
    void Promise.all([contacts.refetch(), unread.refetch()]);
  }, [contacts.refetch, unread.refetch]);
  const messages = useQuery({
    queryKey: ["feishu-messages", selected],
    queryFn: () => loadFeishuMessages(selected ?? ""),
    enabled: Boolean(selected),
  });
  useEffect(() => {
    let active = true;
    let cleanup: (() => void) | undefined;
    void loadChatServerPort().then((port) => {
      if (!active) return;
      cleanup = subscribeChatServerEvents(port, {
        onChannelMessageReceived: (event) => {
          void client.invalidateQueries({ queryKey: ["feishu-contacts"] });
          void client.invalidateQueries({ queryKey: ["feishu-unread"] });
          if (event.channelMessage?.contactId === selected) {
            void client.invalidateQueries({ queryKey: ["feishu-messages", selected] });
          }
        },
      });
    });
    return () => {
      active = false;
      cleanup?.();
    };
  }, [client, selected]);
  const send = useMutation({
    mutationFn: async () => {
      const response = await chatServerRequest(
        `/v1/channels/feishu/contacts/${encodeURIComponent(selected ?? "")}/messages`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text }),
        },
      );
      return response.json();
    },
    onSuccess: async () => {
      setText("");
      await messages.refetch();
    },
  });
  const contact = contacts.data?.find((item) => item.id === selected);
  const select = useCallback(
    async (id: string) => {
      setSelected(id);
      await markFeishuContactRead(id);
      window.dispatchEvent(new Event("chatdesk:feishu-unread-updated"));
      await client.invalidateQueries({ queryKey: ["feishu-unread"] });
      await client.invalidateQueries({ queryKey: ["feishu-contacts"] });
    },
    [client],
  );
  useEffect(() => {
    if (!selected && contacts.data?.[0]) void select(contacts.data[0].id);
  }, [contacts.data, select, selected]);
  return (
    <div className="flex h-full min-h-0 w-full overflow-hidden bg-background">
      <aside className="w-[260px] shrink-0 overflow-y-auto border-border border-r p-3">
        <div className="mb-3 flex items-center justify-between">
          <h1 className="font-semibold text-sm">Channel</h1>
          <Button
            aria-label="刷新联系人"
            disabled={contacts.isFetching}
            onClick={() => void contacts.refetch()}
            size="icon"
            variant="ghost"
          >
            <RefreshCw className="size-4" />
          </Button>
        </div>
        {contacts.isPending ? (
          <div className="space-y-2">
            <div className="h-12 animate-pulse rounded-md bg-accent" />
            <div className="h-12 animate-pulse rounded-md bg-accent" />
          </div>
        ) : contacts.data?.length ? (
          contacts.data.map((item) => (
            <button
              className={`flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm hover:bg-accent ${selected === item.id ? "bg-accent" : ""}`}
              key={item.id}
              onClick={() => void select(item.id)}
              type="button"
            >
              <span className="relative">
                <Avatar className="size-8">
                  <AvatarFallback>{item.name.slice(0, 1)}</AvatarFallback>
                </Avatar>
                {(unread.data?.find((entry) => entry.contactId === item.id)?.unreadCount ?? 0) >
                0 ? (
                  <span className="absolute -top-1 -right-1 size-3 rounded-full bg-primary" />
                ) : null}
              </span>
              <span className="min-w-0 flex-1 truncate">{item.name}</span>
              {(unread.data?.find((entry) => entry.contactId === item.id)?.unreadCount ?? 0) > 0 ? (
                <span className="shrink-0 rounded-full bg-primary px-1.5 text-[10px] leading-4 text-primary-foreground">
                  {unread.data?.find((entry) => entry.contactId === item.id)?.unreadCount}
                </span>
              ) : null}
            </button>
          ))
        ) : (
          <p className="px-2 py-8 text-center text-muted-foreground text-xs">暂无飞书联系人</p>
        )}
      </aside>
      <main className="flex min-w-0 flex-1 flex-col">
        {contact ? (
          <>
            <header className="flex h-12 shrink-0 items-center gap-2 border-border border-b px-5">
              <Avatar className="size-7" title={channelStatus.data?.agentName || "绑定 Agent"}>
                <AvatarFallback className="text-[11px]">
                  {channelStatus.data?.agentAvatar || <Bot className="size-3.5" />}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0">
                <div className="truncate font-medium text-sm">{contact.name}</div>
                <div className="text-muted-foreground text-xs">飞书单聊</div>
              </div>
            </header>
            <section className="min-h-0 flex-1 overflow-y-auto">
              <div className="mx-auto flex w-full max-w-[820px] flex-col gap-5 px-5 py-6">
                {messages.isPending ? (
                  <div className="space-y-5">
                    <div className="h-16 animate-pulse rounded-md bg-accent/60" />
                    <div className="ml-auto h-14 w-2/3 animate-pulse rounded-md bg-accent/60" />
                  </div>
                ) : messages.data?.length ? (
                  messages.data.map((item, index) => {
                    const outbound = item.direction === "outbound";
                    const previous = messages.data?.[index - 1];
                    const shouldShowTime =
                      !previous ||
                      Number.isNaN(Date.parse(previous.createdAt)) ||
                      Number.isNaN(Date.parse(item.createdAt)) ||
                      Date.parse(item.createdAt) - Date.parse(previous.createdAt) >= 5 * 60 * 1000;
                    return (
                      <div key={item.id}>
                        {shouldShowTime ? (
                          <div className="py-1 text-center text-muted-foreground text-[11px]">
                            {formatMessageTime(item.createdAt)}
                          </div>
                        ) : null}
                        <div
                          className={`flex items-start gap-2 ${outbound ? "justify-end" : "justify-start"}`}
                        >
                          {!outbound ? (
                            <Avatar
                              aria-label={contact.name}
                              className="size-7 shrink-0"
                              title={contact.name}
                            >
                              <AvatarFallback className="text-[11px]">
                                {contact.name.slice(0, 1)}
                              </AvatarFallback>
                            </Avatar>
                          ) : null}
                          <div
                            className={`flex max-w-[min(680px,85%)] flex-col ${outbound ? "items-end" : "items-start"}`}
                          >
                            <div
                              className={`whitespace-pre-wrap break-words text-sm leading-6 ${outbound ? "rounded-lg bg-accent px-4 py-2.5 text-foreground" : "rounded-lg border border-border/70 bg-card px-4 py-2.5 text-foreground"}`}
                            >
                              {item.text}
                            </div>
                          </div>
                          {outbound ? (
                            <Avatar
                              aria-label={channelStatus.data?.agentName || "绑定 Agent"}
                              className="size-7 shrink-0"
                              title={channelStatus.data?.agentName || "绑定 Agent"}
                            >
                              <AvatarFallback className="text-[11px]">
                                {channelStatus.data?.agentAvatar || <Bot className="size-3.5" />}
                              </AvatarFallback>
                            </Avatar>
                          ) : null}
                        </div>
                      </div>
                    );
                  })
                ) : (
                  <div className="flex flex-1 items-center justify-center py-20 text-muted-foreground text-sm">
                    暂无消息，发送一条消息开始对话
                  </div>
                )}
              </div>
            </section>
            <form
              className="px-5 py-4"
              onSubmit={(event) => {
                event.preventDefault();
                if (text.trim() && !send.isPending) void send.mutateAsync();
              }}
            >
              <div className="mx-auto flex w-full max-w-[820px] items-center gap-2">
                <div className="relative flex-1">
                  <Input
                    className="h-10 bg-background pr-12"
                    onChange={(event) => setText(event.target.value)}
                    placeholder="发送消息"
                    value={text}
                  />
                  <Button
                    aria-label="发送消息"
                    className="absolute top-1 right-1 size-8"
                    disabled={!text.trim() || send.isPending}
                    size="icon"
                    type="submit"
                  >
                    <Send className="size-4" />
                  </Button>
                </div>
              </div>
            </form>
          </>
        ) : (
          <div className="flex flex-1 items-center justify-center text-muted-foreground text-sm">
            选择联系人查看对话
          </div>
        )}
      </main>
    </div>
  );
}
