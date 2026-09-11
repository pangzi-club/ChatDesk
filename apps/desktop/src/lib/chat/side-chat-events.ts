export type SideChatOpenRequest = {
  draft?: string;
};

const EVENT_NAME = "chatdesk:side-chat-open";

export function openSideChat(request: SideChatOpenRequest = {}) {
  window.dispatchEvent(new CustomEvent<SideChatOpenRequest>(EVENT_NAME, { detail: request }));
}

export function subscribeSideChatOpen(listener: (request: SideChatOpenRequest) => void) {
  const handler = (event: Event) => {
    listener((event as CustomEvent<SideChatOpenRequest>).detail ?? {});
  };
  window.addEventListener(EVENT_NAME, handler);
  return () => window.removeEventListener(EVENT_NAME, handler);
}
