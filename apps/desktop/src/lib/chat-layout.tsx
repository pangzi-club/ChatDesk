import { Context, Service } from "cordis";
import {
  type ComponentType,
  createContext,
  type ReactNode,
  useContext,
  useSyncExternalStore,
} from "react";

export type ChatLayout = "standard" | "cute" | "geek";

export type ChatLayoutProps = {
  children: ReactNode;
};

export type ChatLayoutComponent = ComponentType<ChatLayoutProps>;

type ChatLayoutSnapshot = {
  id: ChatLayout;
  component: ChatLayoutComponent | undefined;
};

declare module "cordis" {
  interface Context {
    chatLayouts: ChatLayoutService;
  }
}

export class ChatLayoutService extends Service {
  private readonly definitions = new Map<ChatLayout, ChatLayoutComponent>();
  private readonly listeners = new Set<() => void>();
  private snapshot: ChatLayoutSnapshot = { id: "standard", component: undefined };

  constructor(ctx: Context) {
    super(ctx, "chatLayouts");
  }

  register(id: ChatLayout, component: ChatLayoutComponent) {
    if (this.definitions.has(id)) throw new Error(`chat layout already registered: ${id}`);
    this.definitions.set(id, component);
    if (!this.snapshot.component) this.snapshot = { id, component };
    this.notify();
    return () => {
      this.definitions.delete(id);
      if (this.snapshot.id === id) {
        const next = this.definitions.entries().next().value as
          | [ChatLayout, ChatLayoutComponent]
          | undefined;
        this.snapshot = next
          ? { id: next[0], component: next[1] }
          : { id: "standard", component: undefined };
      }
      this.notify();
    };
  }

  getSnapshot = () => this.snapshot;

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  activate(id: ChatLayout) {
    const component = this.definitions.get(id);
    if (!component) throw new Error(`unknown chat layout: ${id}`);
    this.snapshot = { id, component };
    this.notify();
  }

  private notify() {
    for (const listener of this.listeners) listener();
  }
}

export type ChatLayoutRuntime = {
  ctx: Context;
  service: ChatLayoutService;
  dispose: () => Promise<void>;
};

export async function createChatLayoutRuntime(initial: ChatLayout): Promise<ChatLayoutRuntime> {
  const ctx = new Context();
  await ctx.plugin(ChatLayoutService);
  const service = ctx.chatLayouts;
  const modules = await Promise.all([
    import("@/layouts/chat-standard"),
    import("@/layouts/chat-cute"),
    import("@/layouts/chat-geek"),
  ]);
  const fibers = await Promise.all(
    modules.map((module) =>
      ctx.plugin({ name: module.name, inject: module.inject, apply: module.apply }),
    ),
  );
  service.activate(initial);
  return {
    ctx,
    service,
    dispose: async () => {
      for (const fiber of fibers.reverse()) await fiber.dispose();
      await ctx.fiber.dispose();
    },
  };
}

const ChatLayoutContext = createContext<ChatLayoutService | null>(null);

export function ChatLayoutProvider({
  service,
  children,
}: {
  service: ChatLayoutService;
  children: ReactNode;
}) {
  return <ChatLayoutContext.Provider value={service}>{children}</ChatLayoutContext.Provider>;
}

export function useChatLayout() {
  const service = useContext(ChatLayoutContext);
  if (!service) throw new Error("useChatLayout must be used within ChatLayoutProvider");
  const snapshot = useSyncExternalStore(
    service.subscribe,
    service.getSnapshot,
    service.getSnapshot,
  );
  return {
    ...snapshot,
    activate: (id: ChatLayout) => service.activate(id),
  };
}
