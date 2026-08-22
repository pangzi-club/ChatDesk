import { type RefObject, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import {
  CHAT_MESSAGE_NAV_MIN_WIDTH,
  resolveActiveUserMessageId,
  type UserMessageNavItem,
} from "@/lib/chat-message-nav";

const NAV_HIGHLIGHT_MS = 160;
const NAV_ACTIVE_OFFSET = 24;

type ChatMessageNavProps = {
  items: UserMessageNavItem[];
  onJump: (id: string) => void;
  scrollRef: RefObject<HTMLDivElement | null>;
};

function queryMessageNode(scrollElement: HTMLDivElement, id: string) {
  return scrollElement.querySelector(`[data-message-id="${CSS.escape(id)}"]`);
}

export function ChatMessageNav({ items, onJump, scrollRef }: ChatMessageNavProps) {
  const [activeId, setActiveId] = useState<string | null>(items[0]?.id ?? null);
  const [wideEnough, setWideEnough] = useState(false);
  const highlightTimerRef = useRef<number | null>(null);

  useLayoutEffect(() => {
    const scrollElement = scrollRef.current;
    if (!scrollElement) return;

    const updateWidth = () => {
      setWideEnough(scrollElement.clientWidth >= CHAT_MESSAGE_NAV_MIN_WIDTH);
    };
    const resizeObserver = new ResizeObserver(updateWidth);
    resizeObserver.observe(scrollElement);
    updateWidth();
    return () => resizeObserver.disconnect();
  }, [scrollRef]);

  useLayoutEffect(() => {
    const scrollElement = scrollRef.current;
    if (!scrollElement || items.length === 0) {
      setActiveId(null);
      return;
    }

    const updateActive = () => {
      const viewportTop = scrollElement.getBoundingClientRect().top + NAV_ACTIVE_OFFSET;
      setActiveId(
        resolveActiveUserMessageId(
          items,
          (id) => {
            const node = queryMessageNode(scrollElement, id);
            return node instanceof HTMLElement ? node.getBoundingClientRect().top : null;
          },
          viewportTop,
        ),
      );
    };

    let frame: number | null = null;
    const scheduleUpdate = () => {
      if (frame !== null) return;
      frame = requestAnimationFrame(() => {
        frame = null;
        updateActive();
      });
    };

    const observer = new IntersectionObserver(scheduleUpdate, {
      root: scrollElement,
      threshold: [0, 0.01, 1],
    });
    for (const item of items) {
      const node = queryMessageNode(scrollElement, item.id);
      if (node) observer.observe(node);
    }
    scrollElement.addEventListener("scroll", scheduleUpdate, { passive: true });
    updateActive();
    return () => {
      if (frame !== null) cancelAnimationFrame(frame);
      observer.disconnect();
      scrollElement.removeEventListener("scroll", scheduleUpdate);
    };
  }, [items, scrollRef]);

  useEffect(() => {
    return () => {
      if (highlightTimerRef.current !== null) window.clearTimeout(highlightTimerRef.current);
    };
  }, []);

  const handleJump = useCallback(
    (id: string) => {
      onJump(id);
      const scrollElement = scrollRef.current;
      const node = scrollElement ? queryMessageNode(scrollElement, id) : null;
      if (!(node instanceof HTMLElement)) return;
      const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      const previousBehavior = scrollElement?.style.scrollBehavior;
      if (scrollElement && reduceMotion) scrollElement.style.scrollBehavior = "auto";
      node.scrollIntoView({ block: "start", behavior: reduceMotion ? "auto" : "smooth" });
      if (scrollElement && reduceMotion) {
        scrollElement.style.scrollBehavior = previousBehavior ?? "";
      }
      scrollElement?.querySelector(".is-nav-target")?.classList.remove("is-nav-target");
      node.classList.add("is-nav-target");
      if (highlightTimerRef.current !== null) window.clearTimeout(highlightTimerRef.current);
      highlightTimerRef.current = window.setTimeout(() => {
        node.classList.remove("is-nav-target");
        highlightTimerRef.current = null;
      }, NAV_HIGHLIGHT_MS);
    },
    [onJump, scrollRef],
  );

  if (!wideEnough || items.length < 3) return null;

  return (
    <nav aria-label="跳转到用户消息" className="chat-message-nav">
      {items.map((item) => {
        const isActive = item.id === activeId;
        const showSnippet = Boolean(item.snippet) && item.snippet !== item.title;
        return (
          <HoverCard closeDelay={80} key={item.id} openDelay={150}>
            <HoverCardTrigger asChild>
              <button
                aria-current={isActive ? "location" : undefined}
                aria-label={`跳转到「${item.title}」`}
                className={`chat-message-nav-tick${isActive ? " is-active" : ""}`}
                onClick={() => handleJump(item.id)}
                type="button"
              >
                <span aria-hidden="true" className="chat-message-nav-tick-bar" />
              </button>
            </HoverCardTrigger>
            <HoverCardContent
              align="center"
              className="chat-message-nav-preview"
              collisionPadding={12}
              side="right"
              sideOffset={10}
            >
              <p className="chat-message-nav-preview-title">{item.title}</p>
              {showSnippet ? (
                <p className="chat-message-nav-preview-snippet">{item.snippet}</p>
              ) : null}
            </HoverCardContent>
          </HoverCard>
        );
      })}
    </nav>
  );
}
