import { type ChatMessageScope, defineDesktopPlugin } from "@chatdesk/desktop-plugin-sdk";
import { Pin, PinOff, StickyNote, X } from "lucide-react";
import { useSyncExternalStore } from "react";

type ChatNote = { messageId: string; text: string };

let pinnedNotes: ChatNote[] = [];
const noteListeners = new Set<() => void>();

function emitNotes() {
  for (const listener of noteListeners) listener();
}

function togglePinnedNote(messageId: string, text: string) {
  const pinned = pinnedNotes.some((note) => note.messageId === messageId);
  pinnedNotes = pinned
    ? pinnedNotes.filter((note) => note.messageId !== messageId)
    : [{ messageId, text }, ...pinnedNotes];
  emitNotes();
}

function removePinnedNote(messageId: string) {
  pinnedNotes = pinnedNotes.filter((note) => note.messageId !== messageId);
  emitNotes();
}

function clearPinnedNotes() {
  pinnedNotes = [];
  emitNotes();
}

function subscribePinnedNotes(listener: () => void) {
  noteListeners.add(listener);
  return () => {
    noteListeners.delete(listener);
  };
}

function usePinnedNotes() {
  return useSyncExternalStore(subscribePinnedNotes, () => pinnedNotes);
}

function ChatNoteText({ text }: { text: string }) {
  return (
    <p className="line-clamp-2 min-w-0 flex-1 break-words text-muted-foreground text-xs whitespace-pre-wrap">
      {text}
    </p>
  );
}

function ChatNoteFloat() {
  const notes = usePinnedNotes();
  if (notes.length === 0) return null;
  return (
    <div className="flex w-[500px] max-w-full flex-col gap-1.5 rounded-lg border border-border bg-background/95 px-3 py-2 shadow-sm">
      <div className="flex items-center gap-2">
        <Pin aria-hidden="true" className="size-3.5 shrink-0 text-primary" />
        <span className="flex-1 text-muted-foreground text-xs">已钉住 {notes.length} 条便签</span>
        <button
          aria-label="清空全部便签"
          className="shrink-0 rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          onClick={clearPinnedNotes}
          title="清空全部便签"
          type="button"
        >
          <X aria-hidden="true" className="size-3.5" />
        </button>
      </div>
      <ul className="flex flex-col gap-1.5">
        {notes.map((note, index) => (
          <li className="flex items-start gap-2" key={note.messageId}>
            <span className="mt-0.5 w-4 shrink-0 text-right font-mono text-muted-foreground text-[10px]">
              {index + 1}
            </span>
            <ChatNoteText text={note.text} />
            <button
              aria-label={`移除便签 ${index + 1}`}
              className="mt-0.5 shrink-0 rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
              onClick={() => removePinnedNote(note.messageId)}
              title="移除便签"
              type="button"
            >
              <PinOff aria-hidden="true" className="size-3.5" />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ChatNoteHint() {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-dashed border-border px-4 py-3 text-muted-foreground text-xs">
      <StickyNote aria-hidden="true" className="size-3.5 shrink-0" />
      <span>
        demo-chat-note 已加载:点击消息下方的“钉住”按钮,可把多条消息钉到输入框上方,便签支持展开全文。
      </span>
    </div>
  );
}

function ChatNoteAfterCard() {
  const notes = usePinnedNotes();
  return (
    <div className="flex flex-col gap-1.5 rounded-lg border border-dashed border-border px-4 py-3 text-muted-foreground text-xs">
      <div className="flex items-center gap-2">
        <StickyNote aria-hidden="true" className="size-3.5 shrink-0" />
        <span>{notes.length === 0 ? "暂无钉住的消息" : `已钉住 ${notes.length} 条消息`}</span>
      </div>
      {notes.length > 0 ? (
        <ul className="flex flex-col gap-1.5">
          {notes.map((note, index) => (
            <li className="flex items-start gap-2" key={note.messageId}>
              <span className="mt-0.5 w-4 shrink-0 text-right font-mono text-[10px]">
                {index + 1}
              </span>
              <ChatNoteText text={note.text} />
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function ChatNoteMessageAction({ scope }: { scope: ChatMessageScope }) {
  const notes = usePinnedNotes();
  const pinned = notes.some((note) => note.messageId === scope.message.id);
  return (
    <button
      aria-label={pinned ? "取消钉住该消息" : "钉住该消息"}
      className={`rounded p-1.5 hover:bg-muted disabled:pointer-events-none disabled:opacity-50 ${
        pinned ? "text-primary" : "text-muted-foreground hover:text-foreground"
      }`}
      disabled={!scope.message.text.trim()}
      onClick={() => togglePinnedNote(scope.message.id, scope.message.text)}
      title={pinned ? "取消钉住" : "钉住该消息"}
      type="button"
    >
      {pinned ? (
        <PinOff aria-hidden="true" className="size-3.5" />
      ) : (
        <Pin aria-hidden="true" className="size-3.5" />
      )}
    </button>
  );
}

const plugin = defineDesktopPlugin({
  manifest: {
    id: "demo-chat-note",
    name: "Chat 便签",
    description:
      "演示 Chat 页面新增插件插槽:消息区前后置、输入区浮层与消息操作,支持把多条消息钉到输入框上方并展开全文。",
    version: "1.1.0",
    apiVersion: 1,
    entry: "plugins/demo-chat-note",
    contributes: [
      "chat.messages.before",
      "chat.messages.after",
      "chat.composer.float",
      "chat.message.action",
    ],
    permissions: [],
  },
  inject: ["desktopUi"],
  apply(ctx) {
    ctx.effect(() => {
      const dispose = [
        ctx.desktopUi.register("chat.messages.before", {
          id: "demo-chat-note.before",
          component: ChatNoteHint,
        }),
        ctx.desktopUi.register("chat.messages.after", {
          id: "demo-chat-note.after",
          component: ChatNoteAfterCard,
        }),
        ctx.desktopUi.register("chat.composer.float", {
          id: "demo-chat-note.float",
          component: ChatNoteFloat,
          order: 60,
        }),
        ctx.desktopUi.register("chat.message.action", {
          id: "demo-chat-note.action",
          component: ChatNoteMessageAction,
        }),
      ];
      return () => {
        dispose.reverse().forEach((item) => {
          item();
        });
        clearPinnedNotes();
      };
    }, "chat note demo");
  },
});

export const manifest = plugin.manifest;
export const inject = plugin.inject;
export const apply = plugin.apply;
