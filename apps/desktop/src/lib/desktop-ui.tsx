import type { SystemPromptSnapshot } from "@chatdesk/shared";
import type { UIMessage } from "ai";
import { Context, type Fiber, type Inject, Service } from "cordis";
import {
  type ComponentType,
  createContext,
  type ReactNode,
  useContext,
  useSyncExternalStore,
} from "react";
import type { BrowserNavigationState } from "@/lib/browser-preview";
import { type ChatLayout, ChatLayoutService } from "@/lib/chat-layout";
import type { ContextDetailPromptInput } from "@/lib/context-detail-events";

/** A build-time Desktop plugin installed into the application's shared Cordis context. */
export type DesktopPluginModule = {
  name: string;
  inject?: Inject;
  apply: (ctx: Context) => unknown;
};

export type DesktopPluginHandle = {
  name: string;
  dispose: () => Promise<void>;
};

export type DesktopPluginInstallResult =
  | { ok: true; name: string; handle: DesktopPluginHandle }
  | { ok: false; name: string; error: Error };

export type DesktopUiSlot = "sidebar.navigation" | "settings.page" | "route" | "workspace.tab";
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

export type DesktopRouteContribution = {
  id: string;
  path: string;
  title: string;
  icon: DesktopIcon;
  keywords: string[];
  order?: number;
  navigation?: { label: string; section: "primary" | "secondary" };
  component: ComponentType;
};

export type WorkspaceTabDataMap = {
  explorer: {
    workspaceId?: string;
    cwd?: string;
    path?: string;
    view: "files" | "git";
    editorMode?: "source" | "diff";
    content?: string;
  };
  terminal: { cwd?: string };
  browser: {
    url?: string;
    navigation?: BrowserNavigationState;
    loadUrl?: string;
    refreshToken?: number;
  };
  image: { url?: string; refreshToken?: number };
  plan: {
    sessionId?: string;
    planId?: string;
    content?: string;
    canExecute?: boolean;
    activePlanId?: string;
    activePlanCanExecute?: boolean;
  };
  "context-detail": {
    sessionId?: string;
    messages?: UIMessage[];
    promptInput?: ContextDetailPromptInput;
    systemPrompt?: SystemPromptSnapshot;
  };
  chat: {
    sessionId?: string;
    workspaceId?: string;
    cwd?: string;
    messages?: UIMessage[];
    draft?: string;
    draftRevision?: number;
  };
  blank: Record<string, never>;
};

export type WorkspaceTabType = keyof WorkspaceTabDataMap;
export type WorkspaceTab<K extends WorkspaceTabType = WorkspaceTabType> = K extends WorkspaceTabType
  ? { id: string; type: K; title: string; data: WorkspaceTabDataMap[K] }
  : never;

export type WorkspaceTabScope = {
  workspaceId: string;
  cwd: string;
  sessionId: string | null;
  messages: UIMessage[];
  sideChatOpening: boolean;
  openSideChat: (draft?: string) => Promise<WorkspaceTab<"chat"> | undefined>;
};

export type WorkspaceTabRenderProps<K extends WorkspaceTabType = WorkspaceTabType> = {
  tab: WorkspaceTab<K>;
  scope: WorkspaceTabScope;
  updateTab: (patch: Partial<WorkspaceTabDataMap[K]> & { title?: string }) => void;
};

export type WorkspaceTabContribution<K extends WorkspaceTabType = WorkspaceTabType> = {
  id: K;
  label: string;
  compactLabel?: string;
  icon: DesktopIcon;
  order?: number;
  renderer?: ComponentType<WorkspaceTabRenderProps<K>>;
  create?: (scope: WorkspaceTabScope) => WorkspaceTab<K> | Promise<WorkspaceTab<K> | undefined>;
  isAvailable?: (scope: WorkspaceTabScope) => boolean;
  onClose?: (tab: WorkspaceTab<K>, scope: WorkspaceTabScope) => void | Promise<void>;
};

export type AnyWorkspaceTabContribution = {
  [K in WorkspaceTabType]: WorkspaceTabContribution<K>;
}[WorkspaceTabType];

type WorkspaceTabCloseHandler = (
  tab: WorkspaceTab,
  scope: WorkspaceTabScope,
) => void | Promise<void>;

export function closeWorkspaceTabContribution(
  contribution: AnyWorkspaceTabContribution | undefined,
  tab: WorkspaceTab,
  scope: WorkspaceTabScope,
) {
  if (!contribution?.onClose || contribution.id !== tab.type) return;
  return (contribution.onClose as WorkspaceTabCloseHandler)(tab, scope);
}

export function patchWorkspaceTab(
  tab: WorkspaceTab,
  patch: { title?: string } & Record<string, unknown>,
): WorkspaceTab {
  const { title, ...data } = patch;
  return {
    ...tab,
    ...(title ? { title } : {}),
    data: { ...tab.data, ...data },
  } as WorkspaceTab;
}

export type DesktopCommandContribution = SidebarNavigationContribution | SettingsPageContribution;

type SlotMap = {
  "sidebar.navigation": SidebarNavigationContribution;
  "settings.page": SettingsPageContribution;
  route: DesktopRouteContribution;
  "workspace.tab": AnyWorkspaceTabContribution;
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
    route: new Map(),
    "workspace.tab": new Map(),
  };
  private readonly listeners = new Set<() => void>();
  private readonly workspaceTabInstances = new Map<
    string,
    { tab: WorkspaceTab; scope: WorkspaceTabScope }
  >();
  private readonly pendingWorkspaceTabClosures = new Set<Promise<unknown>>();
  private snapshots: Record<
    DesktopUiSlot,
    readonly (
      | SidebarNavigationContribution
      | SettingsPageContribution
      | DesktopRouteContribution
      | AnyWorkspaceTabContribution
    )[]
  > = {
    "sidebar.navigation": [],
    "settings.page": [],
    route: [],
    "workspace.tab": [],
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
      if (slot === "workspace.tab") {
        this.closeWorkspaceTabsForContribution(contribution as AnyWorkspaceTabContribution);
      }
      this.refresh(slot);
    };
  }

  getSnapshot = <K extends DesktopUiSlot>(slot: K): readonly SlotMap[K][] =>
    this.snapshots[slot] as readonly SlotMap[K][];

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  trackWorkspaceTabs(tabs: readonly WorkspaceTab[], scope: WorkspaceTabScope) {
    for (const tab of tabs) this.workspaceTabInstances.set(tab.id, { tab, scope });
  }

  releaseWorkspaceTab(tab: WorkspaceTab, scope: WorkspaceTabScope) {
    if (!this.workspaceTabInstances.delete(tab.id)) return;
    const contribution = this.definitions["workspace.tab"].get(tab.type);
    return closeWorkspaceTabContribution(contribution, tab, scope);
  }

  async disposeWorkspaceTabs() {
    const instances = [...this.workspaceTabInstances.values()];
    this.workspaceTabInstances.clear();
    await Promise.allSettled(
      instances.map(({ tab, scope }) => {
        const contribution = this.definitions["workspace.tab"].get(tab.type);
        return closeWorkspaceTabContribution(contribution, tab, scope);
      }),
    );
    await this.flushWorkspaceTabClosures();
  }

  async flushWorkspaceTabClosures() {
    await Promise.allSettled([...this.pendingWorkspaceTabClosures]);
  }

  private refresh<K extends DesktopUiSlot>(slot: K) {
    this.snapshots[slot] = sortContributions([...this.definitions[slot].values()]);
    for (const listener of this.listeners) listener();
  }

  private closeWorkspaceTabsForContribution(contribution: AnyWorkspaceTabContribution) {
    const closures: Promise<unknown>[] = [];
    for (const [instanceId, { tab, scope }] of this.workspaceTabInstances) {
      if (tab.type !== contribution.id) continue;
      this.workspaceTabInstances.delete(instanceId);
      closures.push(Promise.resolve(closeWorkspaceTabContribution(contribution, tab, scope)));
    }
    if (!closures.length) return;
    const pending = Promise.allSettled(closures);
    this.pendingWorkspaceTabClosures.add(pending);
    void pending.finally(() => this.pendingWorkspaceTabClosures.delete(pending));
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
  pluginResults: readonly DesktopPluginInstallResult[];
  installPlugin: (plugin: DesktopPluginModule) => Promise<DesktopPluginInstallResult>;
  uninstallPlugin: (name: string) => Promise<boolean>;
  dispose: () => Promise<void>;
};

export async function createDesktopUiRuntime(
  initialLayout: ChatLayout,
  initialPlugins: readonly DesktopPluginModule[] = [],
): Promise<DesktopUiRuntime> {
  const ctx = new Context();
  await ctx.plugin(ChatLayoutService);
  await ctx.plugin(DesktopUiService);
  const modules = await Promise.all([
    import("@/layouts/chat-standard"),
    import("@/layouts/chat-cute"),
    import("@/layouts/chat-geek"),
    import("@/lib/desktop-ui-builtins"),
    import("@/lib/workspace-tab-builtins"),
  ]);
  const installed = new Map<string, Fiber>();
  const installOrder: string[] = [];

  const installPlugin = async (
    plugin: DesktopPluginModule,
  ): Promise<DesktopPluginInstallResult> => {
    const name = plugin.name.trim();
    if (!name) {
      return { ok: false, name, error: new Error("desktop plugin name must not be empty") };
    }
    if (installed.has(name)) {
      return {
        ok: false,
        name,
        error: new Error(`desktop plugin already installed: ${name}`),
      };
    }

    let fiber: Fiber | undefined;
    try {
      const pluginFiber = ctx.plugin({ name, inject: plugin.inject, apply: plugin.apply });
      fiber = pluginFiber;
      await pluginFiber;
      installed.set(name, pluginFiber);
      installOrder.push(name);
      const handle: DesktopPluginHandle = {
        name,
        dispose: async () => {
          if (installed.get(name) !== pluginFiber) return;
          installed.delete(name);
          const index = installOrder.indexOf(name);
          if (index >= 0) installOrder.splice(index, 1);
          await pluginFiber.dispose();
          await ctx.desktopUi.flushWorkspaceTabClosures();
        },
      };
      return { ok: true, name, handle };
    } catch (cause) {
      await fiber?.dispose().catch(() => undefined);
      const error = cause instanceof Error ? cause : new Error(String(cause));
      console.error(`Failed to install desktop plugin "${name}"`, error);
      return { ok: false, name, error };
    }
  };

  const uninstallPlugin = async (name: string) => {
    const fiber = installed.get(name);
    if (!fiber) return false;
    installed.delete(name);
    const index = installOrder.indexOf(name);
    if (index >= 0) installOrder.splice(index, 1);
    await fiber.dispose();
    await ctx.desktopUi.flushWorkspaceTabClosures();
    return true;
  };

  const defaultPlugins = modules.map(
    (module): DesktopPluginModule => ({
      name: module.name,
      inject: module.inject,
      apply: module.apply,
    }),
  );
  const pluginResults: DesktopPluginInstallResult[] = [];
  for (const plugin of [...defaultPlugins, ...initialPlugins]) {
    pluginResults.push(await installPlugin(plugin));
  }
  ctx.chatLayouts.activate(initialLayout);
  return {
    ctx,
    service: ctx.desktopUi,
    chatLayouts: ctx.chatLayouts,
    pluginResults,
    installPlugin,
    uninstallPlugin,
    dispose: async () => {
      await ctx.desktopUi.disposeWorkspaceTabs();
      for (const name of [...installOrder].reverse()) await uninstallPlugin(name);
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
