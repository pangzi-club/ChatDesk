import { afterEach, describe, expect, it, vi } from "vitest";
import { createWindowEventBus } from "@/lib/runtime/window-event-bus";

type Payload = { value: number };

function stubWindow() {
  const listeners = new Map<string, Set<(event: Event) => void>>();
  const windowStub = {
    addEventListener: vi.fn((name: string, listener: (event: Event) => void) => {
      const set = listeners.get(name) ?? new Set();
      set.add(listener);
      listeners.set(name, set);
    }),
    dispatchEvent: vi.fn((event: Event) => {
      for (const listener of listeners.get(event.type) ?? []) listener(event);
      return true;
    }),
    removeEventListener: vi.fn((name: string, listener: (event: Event) => void) => {
      listeners.get(name)?.delete(listener);
    }),
  };
  vi.stubGlobal("window", windowStub);
  vi.stubGlobal(
    "CustomEvent",
    class<T> {
      type: string;
      detail: T;
      constructor(type: string, init: { detail: T }) {
        this.type = type;
        this.detail = init.detail;
      }
    },
  );
  return windowStub;
}

describe("createWindowEventBus", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("delivers dispatched details to subscribers", () => {
    stubWindow();
    const bus = createWindowEventBus<Payload>("chatdesk:test");
    const listener = vi.fn();

    bus.subscribe(listener);
    bus.dispatch({ value: 7 });

    expect(listener).toHaveBeenCalledWith({ value: 7 });
  });

  it("stops delivering after unsubscribe", () => {
    const windowStub = stubWindow();
    const bus = createWindowEventBus<Payload>("chatdesk:test");
    const listener = vi.fn();

    const dispose = bus.subscribe(listener);
    dispose();
    bus.dispatch({ value: 1 });

    expect(listener).not.toHaveBeenCalled();
    expect(windowStub.removeEventListener).toHaveBeenCalledOnce();
  });

  it("ignores events without a detail payload", () => {
    stubWindow();
    const bus = createWindowEventBus<Payload>("chatdesk:test");
    const listener = vi.fn();

    bus.subscribe(listener);
    window.dispatchEvent(new Event("chatdesk:test"));

    expect(listener).not.toHaveBeenCalled();
  });
});
