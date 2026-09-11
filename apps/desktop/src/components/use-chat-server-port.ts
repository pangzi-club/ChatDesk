import { useEffect, useState } from "react";
import { loadChatServerPort } from "@/lib/server/chat-server";

/**
 * Resolve the user-configurable Chat Server port once on mount.
 *
 * Returns `null` until the port is known so callers can wait for the resolved
 * value instead of subscribing to a stale default port first.
 */
export function useChatServerPort(): number | null {
  const [port, setPort] = useState<number | null>(null);
  useEffect(() => {
    let active = true;
    void loadChatServerPort().then((nextPort) => {
      if (active) setPort(nextPort);
    });
    return () => {
      active = false;
    };
  }, []);
  return port;
}
