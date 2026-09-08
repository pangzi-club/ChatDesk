import { Context, Service } from "cordis";
import {
  type ComponentType,
  createContext,
  type ReactNode,
  useContext,
  useSyncExternalStore,
} from "react";
import { type ChatLayout, ChatLayoutService } from "@/lib/chat-layout";

export type DesktopUiSlot = "sidebar.navigation" | "settings.page";
export type DesktopIcon = ComponentType<{ className?: string }>;

export type SidebarNavigationContribution = {
  id: string;
  path: string;
  label: string;
  icon: DesktopIcon;
  order?: number;
  section?: "primary" | "secondary";
  keywords?: string[];
};

export type SettingsPageContribution = {
  id: string;
  path: string;
  label: string;
  icon: DesktopIcon;
  keywords: string[];
  order?: number;
  visible?: boolean;
  layout?: "standard" | "full";
  component: ComponentType;
};

export type DesktopCommandContribution = SidebarNavigationContribution | SettingsPageContribution;

type SlotMap = {
  "sidebar.navigation": SidebarNavigationContribution;
  "settings.page": SettingsPageContribution;
};

function sortContributions<T extends { order?: number }>(items: T[]) {
  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => (a.item.order ?? 0) - (b.item.order ?? 0) || a.index - b.index)
    .map(({ item }) => item);
}

export class DesktopUiService extends Service {
  private readonly definitions: { [K in DesktopUiSlot]: Map<string, SlotMap[K]> } = {
    "sidebar.navigation": new Map(),
    "settings.page": new Map(),
  };
  private readonly listeners = new Set<() => void>();
  private snapshots: Record<
    DesktopUiSlot,
    readonly (SidebarNavigationContribution | SettingsPageContribution)[]
  > = {
    "sidebar.navigation": [],
    "settings.page": [],
  };

  constructor(ctx: Context) {
    super(ctx, "desktopUi");
  }

  register<K extends DesktopUiSlot>(slot: K, contribution: SlotMap[K]) {
    const definitions = this.definitions[slot];
    if (definitions.has(contribution.id)) {
      throw new Error(`desktop UI contribution already registered: ${slot}:${contribution.id}`);
    }
    definitions.set(contribution.id, contribution);
    this.refresh(slot);
    return () => {
      if (!definitions.delete(contribution.id)) return;
      this.refresh(slot);
    };
  }

  getSnapshot = <K extends DesktopUiSlot>(slot: K): readonly SlotMap[K][] =>
    this.snapshots[slot] as readonly SlotMap[K][];

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private refresh<K extends DesktopUiSlot>(slot: K) {
    this.snapshots[slot] = sortContributions([...this.definitions[slot].values()]);
    for (const listener of this.listeners) listener();
  }
}

declare module "cordis" {
  interface Context {
    desktopUi: DesktopUiService;
  }
}

export type DesktopUiRuntime = {
  ctx: Context;
  service: DesktopUiService;
  chatLayouts: ChatLayoutService;
  dispose: () => Promise<void>;
};

export async function createDesktopUiRuntime(initialLayout: ChatLayout): Promise<DesktopUiRuntime> {
  const ctx = new Context();
  await ctx.plugin(ChatLayoutService);
  await ctx.plugin(DesktopUiService);
  const modules = await Promise.all([
    import("@/layouts/chat-standard"),
    import("@/layouts/chat-cute"),
    import("@/layouts/chat-geek"),
    import("@/lib/desktop-ui-builtins"),
  ]);
  const fibers = await Promise.all(
    modules.map((module) =>
      ctx.plugin({ name: module.name, inject: module.inject, apply: module.apply }),
    ),
  );
  ctx.chatLayouts.activate(initialLayout);
  return {
    ctx,
    service: ctx.desktopUi,
    chatLayouts: ctx.chatLayouts,
    dispose: async () => {
      for (const fiber of fibers.reverse()) await fiber.dispose();
      await ctx.fiber.dispose();
    },
  };
}

const DesktopUiContext = createContext<DesktopUiService | null>(null);

export function DesktopUiProvider({
  service,
  children,
}: {
  service: DesktopUiService;
  children: ReactNode;
}) {
  return <DesktopUiContext.Provider value={service}>{children}</DesktopUiContext.Provider>;
}

export function useDesktopUiSlot<K extends DesktopUiSlot>(slot: K): readonly SlotMap[K][] {
  const service = useContext(DesktopUiContext);
  if (!service) throw new Error("useDesktopUiSlot must be used within DesktopUiProvider");
  return useSyncExternalStore(
    service.subscribe,
    () => service.getSnapshot(slot),
    () => service.getSnapshot(slot),
  );
}

export function useDesktopUi() {
  const service = useContext(DesktopUiContext);
  if (!service) throw new Error("useDesktopUi must be used within DesktopUiProvider");
  return service;
}
