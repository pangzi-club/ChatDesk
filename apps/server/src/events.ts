import { randomUUID } from "node:crypto";
import type { ServerEvent } from "./protocol.ts";

type Listener = {
  sessionId?: string;
  queue: ServerEvent[];
  waiters: Array<(event: ServerEvent | null) => void>;
  closed: boolean;
};

export class EventHub {
  private readonly listeners = new Set<Listener>();

  publish(event: Omit<ServerEvent, "id" | "timestamp">) {
    const next: ServerEvent = {
      ...event,
      id: randomUUID(),
      timestamp: new Date().toISOString(),
    };
    for (const listener of this.listeners) {
      if (listener.sessionId && listener.sessionId !== next.sessionId) continue;
      const waiter = listener.waiters.shift();
      if (waiter) waiter(next);
      else listener.queue.push(next);
    }
    return next;
  }

  subscribe(sessionId?: string) {
    const listener: Listener = { sessionId, queue: [], waiters: [], closed: false };
    this.listeners.add(listener);
    return {
      next: (timeoutMs = 0) => {
        if (listener.closed) return Promise.resolve(null);
        const queued = listener.queue.shift();
        if (queued) return Promise.resolve(queued);
        return new Promise<ServerEvent | null>((resolve) => {
          listener.waiters.push(resolve);
          if (timeoutMs > 0) {
            setTimeout(() => {
              const index = listener.waiters.indexOf(resolve);
              if (index >= 0) listener.waiters.splice(index, 1);
              resolve(null);
            }, timeoutMs);
          }
        });
      },
      close: () => {
        listener.closed = true;
        this.listeners.delete(listener);
        for (const waiter of listener.waiters.splice(0)) waiter(null);
      },
    };
  }
}
