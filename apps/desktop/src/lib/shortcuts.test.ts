import { describe, expect, it } from "vitest";
import { DEFAULT_SHORTCUTS, matchesShortcut, normalizeShortcuts } from "@/lib/shortcuts";

describe("chat shortcuts", () => {
  it("defaults the main sidebar toggle to Meta+B", () => {
    expect(DEFAULT_SHORTCUTS.mainSidebar).toEqual({
      alt: false,
      code: "KeyB",
      ctrl: false,
      key: "b",
      meta: true,
      shift: false,
    });
  });

  it("defaults new conversation to Meta+N", () => {
    expect(DEFAULT_SHORTCUTS.newConversation).toEqual({
      alt: false,
      code: "KeyN",
      ctrl: false,
      key: "n",
      meta: true,
      shift: false,
    });
  });

  it("fills new shortcut settings for legacy configuration", () => {
    const normalized = normalizeShortcuts({
      chatSidebar: DEFAULT_SHORTCUTS.chatSidebar,
      chatSidebarMaximize: DEFAULT_SHORTCUTS.chatSidebarMaximize,
      previousConversation: DEFAULT_SHORTCUTS.previousConversation,
      nextConversation: DEFAULT_SHORTCUTS.nextConversation,
    });

    expect(normalized.mainSidebar).toEqual(DEFAULT_SHORTCUTS.mainSidebar);
    expect(normalized.newConversation).toEqual(DEFAULT_SHORTCUTS.newConversation);
  });

  it("fills new conversation for settings that predate both sidebar shortcuts", () => {
    const normalized = normalizeShortcuts({
      previousConversation: DEFAULT_SHORTCUTS.previousConversation,
      nextConversation: DEFAULT_SHORTCUTS.nextConversation,
    });

    expect(normalized.mainSidebar).toEqual(DEFAULT_SHORTCUTS.mainSidebar);
    expect(normalized.newConversation).toEqual(DEFAULT_SHORTCUTS.newConversation);
  });

  it("matches Meta+N and rejects extra modifiers", () => {
    const binding = DEFAULT_SHORTCUTS.newConversation;
    const event = (overrides: Partial<KeyboardEvent>) =>
      ({
        altKey: false,
        code: "KeyN",
        ctrlKey: false,
        key: "n",
        metaKey: true,
        shiftKey: false,
        ...overrides,
      }) as KeyboardEvent;
    expect(matchesShortcut(event({}), binding)).toBe(true);
    expect(matchesShortcut(event({ shiftKey: true }), binding)).toBe(false);
  });

  it("matches Meta+B for the main sidebar", () => {
    expect(
      matchesShortcut(
        {
          altKey: false,
          code: "KeyB",
          ctrlKey: false,
          key: "b",
          metaKey: true,
          shiftKey: false,
        } as KeyboardEvent,
        DEFAULT_SHORTCUTS.mainSidebar,
      ),
    ).toBe(true);
  });
});
