import { createWindowEventBus } from "@/lib/runtime/window-event-bus";

export type SideChatOpenRequest = {
  draft?: string;
};

const sideChatBus = createWindowEventBus<SideChatOpenRequest>("chatdesk:side-chat-open");

export function openSideChat(request: SideChatOpenRequest = {}) {
  sideChatBus.dispatch(request);
}

export function subscribeSideChatOpen(listener: (request: SideChatOpenRequest) => void) {
  return sideChatBus.subscribe(listener);
}
