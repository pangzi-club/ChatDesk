import { createContext, type ReactNode, useContext, useEffect, useSyncExternalStore } from "react";
import type { ChatLayout, ChatLayoutService, ChatLayoutSnapshot } from "@/lib/plugins/chat-layout";

const ChatLayoutContext = createContext<ChatLayoutService | null>(null);
const fallbackLayoutSnapshot: ChatLayoutSnapshot = { id: "standard", component: undefined };
const fallbackSubscribe = (_listener: () => void) => () => undefined;
const getFallbackSnapshot = () => fallbackLayoutSnapshot;

/** Binds the shared Cordis `chatLayouts` service to the React tree. */
export function ChatLayoutProvider({
  service,
  children,
}: {
  service: ChatLayoutService;
  children: ReactNode;
}) {
  const snapshot = useSyncExternalStore(
    service.subscribe,
    service.getSnapshot,
    service.getSnapshot,
  );

  useEffect(() => {
    const root = window.document.documentElement;
    root.dataset.chatLayout = snapshot.id;
    return () => {
      if (root.dataset.chatLayout === snapshot.id) delete root.dataset.chatLayout;
    };
  }, [snapshot.id]);

  return <ChatLayoutContext.Provider value={service}>{children}</ChatLayoutContext.Provider>;
}

/** Returns the active layout when mounted in the app, with a standard fallback for isolated UI. */
export function useChatLayoutId(): ChatLayout {
  const service = useContext(ChatLayoutContext);
  return useSyncExternalStore(
    service?.subscribe ?? fallbackSubscribe,
    service?.getSnapshot ?? getFallbackSnapshot,
    service?.getSnapshot ?? getFallbackSnapshot,
  ).id;
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
