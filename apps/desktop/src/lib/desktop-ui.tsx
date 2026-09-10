import type {
  DesktopPluginHandle as SdkDesktopPluginHandle,
  DesktopPluginInstallResult as SdkDesktopPluginInstallResult,
  DesktopPluginManifest as SdkDesktopPluginManifest,
  DesktopPluginModule as SdkDesktopPluginModule,
} from "@chatdesk/desktop-plugin-sdk";
import type { SystemPromptSnapshot } from "@chatdesk/shared";
import type { UIMessage } from "ai";
import { Context, type Fiber, Service } from "cordis";
import {
  type ComponentType,
  createContext,
  type ReactNode,
  useContext,
  useSyncExternalStore,
} from "react";
import type { BrowserNavigationState } from "@/lib/browser-preview";
import { type ChatLayout, type ChatLayoutContribution, ChatLayoutService } from "@/lib/chat-layout";
import type { ContextDetailPromptInput } from "@/lib/context-detail-events";
import {
  type DiscoveredPlugin,
  scanDesktopPlugins,
  validateDesktopPluginManifest,
} from "@/lib/desktop-plugin-discovery";
import {
  createExternalPluginModule,
  type ExternalPluginEntry,
  refreshExternalPlugins,
} from "@/lib/external-plugins";
import { settingsStore } from "@/lib/settings-store";

export const DESKTOP_PLUGIN_API_VERSION = 1 as const;

export type DesktopPluginManifest = SdkDesktopPluginManifest;

/** A build-time Desktop plugin installed into the application's shared Cordis context. */
export type DesktopPluginModule = SdkDesktopPluginModule;

export type DesktopPluginHandle = SdkDesktopPluginHandle;

export type DesktopPluginInstallResult = SdkDesktopPluginInstallResult;
export { validateDesktopPluginManifest };

export type DesktopUiSlot =
  | "sidebar.navigation"
  | "settings.page"
  | "route"
  | "workspace.tab"
  | "action"
  | "shell.overlay"
  | "shell.before"
  | "shell.after"
  | "sidebar.before"
  | "sidebar.after"
  | "sidebar.footer"
  | "chat.header.action"
  | "chat.composer.tool"
  | "chat.messages.before"
  | "chat.messages.after"
  | "chat.messages.empty"
  | "chat.composer.float"
  | "chat.message.action"
  | "chat.message.before"
  | "chat.message.after"
  | "chat.message.meta"
  | "chat.generating"
  | "chat.status"
  | "chat.theme"
  | "chat.layout";
export type DesktopIcon = ComponentType<{ className?: string }>;

export type DesktopShortcut = {
  alt: boolean;
  code?: string;
  ctrl: boolean;
  key: string;
  meta: boolean;
  shift: boolean;
};

export type DesktopActionScope = {
  pathname: string;
  navigate: (to: string) => void;
};

export type DesktopActionContribution = {
  id: string;
  label: string;
  icon: DesktopIcon;
  keywords?: string[];
  order?: number;
  shortcut?: DesktopShortcut;
  run: (scope: DesktopActionScope) => void | Promise<void>;
};

export type DesktopShellScope = {
  pathname: string;
  isChatPage: boolean;
};

export type DesktopShellContribution = {
  id: string;
  order?: number;
  component: ComponentType<{ scope: DesktopShellScope }>;
};

export type ChatContributionScope = {
  sessionId: string;
  workspaceId: string;
  cwd: string;
  isGenerating: boolean;
  isReadOnly: boolean;
};

export type ChatHeaderActionContribution = {
  id: string;
  order?: number;
  component: ComponentType<{ scope: ChatContributionScope }>;
};

export type ChatComposerToolProps = {
  scope: ChatContributionScope;
  value: string;
  disabled: boolean;
  insertText: (text: string) => void;
  focus: () => void;
};

export type ChatComposerToolContribution = {
  id: string;
  order?: number;
  component: ComponentType<ChatComposerToolProps>;
};

export type ChatRegionContribution = {
  id: string;
  order?: number;
  component: ComponentType<{ scope: ChatContributionScope }>;
};

export type ChatMessageScope = ChatContributionScope & {
  message: { id: string; role: string; text: string };
};

export type ChatMessageActionContribution = {
  id: string;
  order?: number;
  component: ComponentType<{ scope: ChatMessageScope }>;
};

export type ChatEmptyStateProps = {
  scope: ChatContributionScope;
  setInput: (value: string) => void;
  focus: () => void;
};

export type ChatEmptyStateContribution = {
  id: string;
  order?: number;
  component: ComponentType<ChatEmptyStateProps>;
};

export type ChatGenerationSnapshot = {
  phase: string;
  detail: string;
  elapsedLabel: string;
};

export type ChatGeneratingContribution = {
  id: string;
  order?: number;
  component: ComponentType<{
    scope: ChatContributionScope;
    generation: ChatGenerationSnapshot;
  }>;
};

export type ChatMessageRegionContribution = {
  id: string;
  order?: number;
  component: ComponentType<{ scope: ChatMessageScope }>;
};

export type ChatMessageMetaScope = ChatMessageScope & {
  generationStatus?: ChatGenerationSnapshot;
};

export type ChatMessageMetaContribution = {
  id: string;
  order?: number;
  component: ComponentType<{ scope: ChatMessageMetaScope }>;
};

export type ChatThemeContribution = {
  id: string;
  order?: number;
  className?: string;
  variables: Record<string, string>;
};

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

export type BuiltinWorkspaceTabType = keyof WorkspaceTabDataMap;
export type WorkspaceTabType = string;
export type WorkspaceTabData<K extends WorkspaceTabType> = K extends BuiltinWorkspaceTabType
  ? WorkspaceTabDataMap[K]
  : object;
export type WorkspaceTab<
  K extends WorkspaceTabType = WorkspaceTabType,
  D extends object = WorkspaceTabData<K>,
> = { id: string; type: K; title: string; data: D };

export type WorkspaceTabScope = {
  workspaceId: string;
  cwd: string;
  sessionId: string | null;
  messages: UIMessage[];
  sideChatOpening: boolean;
  openSideChat: (draft?: string) => Promise<WorkspaceTab<"chat"> | undefined>;
};

export type WorkspaceTabRenderProps<
  K extends WorkspaceTabType = WorkspaceTabType,
  D extends object = WorkspaceTabData<K>,
> = {
  tab: WorkspaceTab<K, D>;
  scope: WorkspaceTabScope;
  updateTab: (patch: Partial<D> & { title?: string }) => void;
};

export type WorkspaceTabContribution<
  K extends WorkspaceTabType = WorkspaceTabType,
  D extends object = WorkspaceTabData<K>,
> = {
  id: K;
  label: string;
  compactLabel?: string;
  icon: DesktopIcon;
  order?: number;
  renderer?: ComponentType<WorkspaceTabRenderProps<NoInfer<K>, NoInfer<D>>>;
  create?: (
    scope: WorkspaceTabScope,
  ) => WorkspaceTab<K, D> | Promise<WorkspaceTab<K, D> | undefined>;
  isAvailable?: (scope: WorkspaceTabScope) => boolean;
  onClose?: (
    tab: WorkspaceTab<NoInfer<K>, NoInfer<D>>,
    scope: WorkspaceTabScope,
  ) => void | Promise<void>;
};

export type AnyWorkspaceTabContribution = Omit<
  WorkspaceTabContribution<WorkspaceTabType, object>,
  "renderer" | "onClose"
> & {
  renderer?: ComponentType<never>;
  onClose?: (tab: never, scope: WorkspaceTabScope) => void | Promise<void>;
};

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
  action: DesktopActionContribution;
  "shell.overlay": DesktopShellContribution;
  "shell.before": DesktopShellContribution;
  "shell.after": DesktopShellContribution;
  "sidebar.before": DesktopShellContribution;
  "sidebar.after": DesktopShellContribution;
  "sidebar.footer": DesktopShellContribution;
  "chat.header.action": ChatHeaderActionContribution;
  "chat.composer.tool": ChatComposerToolContribution;
  "chat.messages.before": ChatRegionContribution;
  "chat.messages.after": ChatRegionContribution;
  "chat.messages.empty": ChatEmptyStateContribution;
  "chat.composer.float": ChatRegionContribution;
  "chat.message.action": ChatMessageActionContribution;
  "chat.message.before": ChatMessageRegionContribution;
  "chat.message.after": ChatMessageRegionContribution;
  "chat.message.meta": ChatMessageMetaContribution;
  "chat.generating": ChatGeneratingContribution;
  "chat.status": ChatRegionContribution;
  "chat.theme": ChatThemeContribution;
  "chat.layout": ChatLayoutContribution;
};

function sortContributions<T extends { order?: number }>(items: T[]) {
  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => (a.item.order ?? 0) - (b.item.order ?? 0) || a.index - b.index)
    .map(({ item }) => item);
}

export class DesktopUiService extends Service {
  scanPlugins: () => readonly DiscoveredPlugin[] = () => [];
  installDiscoveredPlugin: (id: string) => Promise<DesktopPluginInstallResult> = async (id) => ({
    ok: false,
    id,
    error: new Error("插件扫描尚未就绪"),
  });
  uninstallPlugin: (id: string) => Promise<boolean> = async () => false;
  refreshPlugins: () => Promise<void> = async () => {};
  private readonly definitions: { [K in DesktopUiSlot]: Map<string, SlotMap[K]> } = {
    "sidebar.navigation": new Map(),
    "settings.page": new Map(),
    route: new Map(),
    "workspace.tab": new Map(),
    action: new Map(),
    "shell.overlay": new Map(),
    "shell.before": new Map(),
    "shell.after": new Map(),
    "sidebar.before": new Map(),
    "sidebar.after": new Map(),
    "sidebar.footer": new Map(),
    "chat.header.action": new Map(),
    "chat.composer.tool": new Map(),
    "chat.messages.before": new Map(),
    "chat.messages.after": new Map(),
    "chat.messages.empty": new Map(),
    "chat.composer.float": new Map(),
    "chat.message.action": new Map(),
    "chat.message.before": new Map(),
    "chat.message.after": new Map(),
    "chat.message.meta": new Map(),
    "chat.generating": new Map(),
    "chat.status": new Map(),
    "chat.theme": new Map(),
    "chat.layout": new Map(),
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
      | DesktopActionContribution
      | DesktopShellContribution
      | ChatHeaderActionContribution
      | ChatComposerToolContribution
      | ChatRegionContribution
      | ChatMessageActionContribution
      | ChatEmptyStateContribution
      | ChatGeneratingContribution
      | ChatMessageRegionContribution
      | ChatMessageMetaContribution
      | ChatThemeContribution
      | ChatLayoutContribution
    )[]
  > = {
    "sidebar.navigation": [],
    "settings.page": [],
    route: [],
    "workspace.tab": [],
    action: [],
    "shell.overlay": [],
    "shell.before": [],
    "shell.after": [],
    "sidebar.before": [],
    "sidebar.after": [],
    "sidebar.footer": [],
    "chat.header.action": [],
    "chat.composer.tool": [],
    "chat.messages.before": [],
    "chat.messages.after": [],
    "chat.messages.empty": [],
    "chat.composer.float": [],
    "chat.message.action": [],
    "chat.message.before": [],
    "chat.message.after": [],
    "chat.message.meta": [],
    "chat.generating": [],
    "chat.status": [],
    "chat.theme": [],
    "chat.layout": [],
  };

  constructor(ctx: Context) {
    super(ctx, "desktopUi");
  }

  register(slot: "workspace.tab", contribution: AnyWorkspaceTabContribution): () => void;
  register<K extends Exclude<DesktopUiSlot, "workspace.tab">>(
    slot: K,
    contribution: SlotMap[K],
  ): () => void;
  register(slot: DesktopUiSlot, contribution: SlotMap[DesktopUiSlot]) {
    const definitions = this.definitions[slot];
    if (definitions.has(contribution.id)) {
      throw new Error(`desktop UI contribution already registered: ${slot}:${contribution.id}`);
    }
    definitions.set(contribution.id, contribution as never);
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
  uninstallPlugin: (id: string) => Promise<boolean>;
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
    import("@/plugins/chat-layout-standard"),
    import("@/plugins/chat-layout-cute"),
    import("@/plugins/chat-layout-geek"),
    import("@/plugins/desktop-navigation"),
    import("@/plugins/desktop-settings"),
    import("@/plugins/workspace-tabs-core"),
    import("@/plugins/workspace-tabs-chat"),
    import("@/plugins/workspace-tabs-content"),
  ]);
  const installed = new Map<string, Fiber>();
  const installOrder: string[] = [];

  const installPlugin = async (
    plugin: DesktopPluginModule,
  ): Promise<DesktopPluginInstallResult> => {
    const manifest = plugin.manifest;
    const id = typeof manifest?.id === "string" ? manifest.id.trim() : "";
    const fail = (message: string): DesktopPluginInstallResult => ({
      ok: false,
      id,
      error: new Error(message),
    });
    const validation = validateDesktopPluginManifest(manifest);
    if (validation.length) return fail(validation[0].message);
    if (installed.has(id)) {
      return {
        ok: false,
        id,
        error: new Error(`desktop plugin already installed: ${id}`),
      };
    }

    let fiber: Fiber | undefined;
    try {
      const pluginFiber = ctx.plugin({
        name: id,
        inject: plugin.inject,
        apply: plugin.apply as unknown as (ctx: Context) => unknown,
      });
      fiber = pluginFiber;
      await pluginFiber;
      installed.set(id, pluginFiber);
      installOrder.push(id);
      const handle: DesktopPluginHandle = {
        id,
        dispose: async () => {
          if (installed.get(id) !== pluginFiber) return;
          installed.delete(id);
          const index = installOrder.indexOf(id);
          if (index >= 0) installOrder.splice(index, 1);
          await pluginFiber.dispose();
          await ctx.desktopUi.flushWorkspaceTabClosures();
        },
      };
      return { ok: true, id, handle };
    } catch (cause) {
      await fiber?.dispose().catch(() => undefined);
      const error = cause instanceof Error ? cause : new Error(String(cause));
      console.error(`Failed to install desktop plugin "${id}"`, error);
      return { ok: false, id, error };
    }
  };

  const uninstallPlugin = async (id: string) => {
    const candidate = scanDesktopPlugins([...installedPluginIds]).find(
      (item) => item.manifest?.id === id,
    );
    if (candidate?.manifest?.builtin) return false;
    const fiber = installed.get(id);
    if (!fiber) return false;
    installed.delete(id);
    const index = installOrder.indexOf(id);
    if (index >= 0) installOrder.splice(index, 1);
    await fiber.dispose();
    await ctx.desktopUi.flushWorkspaceTabClosures();
    return true;
  };

  const defaultPlugins = modules.map(
    (module): DesktopPluginModule => ({
      manifest: module.manifest,
      inject: module.inject,
      apply: module.apply as unknown as DesktopPluginModule["apply"],
    }),
  );
  let installedPluginIds = new Set<string>();
  const storedIds = await settingsStore.get<unknown>("installedPluginIds");
  if (Array.isArray(storedIds))
    installedPluginIds = new Set(storedIds.filter((id): id is string => typeof id === "string"));
  let externalPlugins: DiscoveredPlugin[] = [];
  const externalEntries = new Map<string, ExternalPluginEntry>();
  const refreshExternalSnapshot = async () => {
    try {
      const result = await refreshExternalPlugins({
        reservedIds: new Set(
          scanDesktopPlugins()
            .map((item) => item.manifest?.id)
            .filter((id): id is string => !!id),
        ),
        installedIds: [...installedPluginIds],
      });
      externalPlugins = result.plugins;
      externalEntries.clear();
      for (const [id, entry] of result.entries) externalEntries.set(id, entry);
    } catch (cause) {
      console.error("外部插件扫描失败", cause);
      externalPlugins = [];
      externalEntries.clear();
    }
  };
  await refreshExternalSnapshot();
  const discovered = [...scanDesktopPlugins([...installedPluginIds]), ...externalPlugins];
  const availableIds = new Set(
    discovered
      .filter(
        (candidate) => candidate.installable && candidate.manifest && !candidate.manifest.builtin,
      )
      .map((candidate) => candidate.manifest?.id),
  );
  installedPluginIds = new Set([...installedPluginIds].filter((id) => availableIds.has(id)));
  await settingsStore.set("installedPluginIds", [...installedPluginIds]);
  await settingsStore.save();
  ctx.desktopUi.scanPlugins = () => [
    ...scanDesktopPlugins([...installedPluginIds]),
    ...externalPlugins.map((plugin) => ({
      ...plugin,
      installed: plugin.installable && installedPluginIds.has(plugin.manifest?.id ?? ""),
    })),
  ];
  ctx.desktopUi.installDiscoveredPlugin = async (id) => {
    const candidate = scanDesktopPlugins([...installedPluginIds]).find(
      (item) => item.manifest?.id === id,
    );
    if (candidate?.manifest) {
      if (!candidate.installable || !candidate.module)
        return {
          ok: false,
          id,
          error: new Error(candidate.errors[0]?.message ?? "插件不可安装"),
        };
      if (candidate.manifest.builtin)
        return { ok: false, id, error: new Error("内置插件始终启用，不能重复安装") };
      const result = await installPlugin(candidate.module);
      if (result.ok) {
        installedPluginIds.add(id);
        await settingsStore.set("installedPluginIds", [...installedPluginIds]);
        await settingsStore.save();
      }
      return result;
    }
    const externalEntry = externalEntries.get(id);
    if (!externalEntry) return { ok: false, id, error: new Error("插件不可安装") };
    let module: DesktopPluginModule;
    try {
      module = createExternalPluginModule(externalEntry);
    } catch (cause) {
      const error = cause instanceof Error ? cause : new Error(String(cause));
      console.error(`Failed to evaluate external plugin "${id}"`, error);
      return { ok: false, id, error };
    }
    const result = await installPlugin(module);
    if (result.ok) {
      installedPluginIds.add(id);
      await settingsStore.set("installedPluginIds", [...installedPluginIds]);
      await settingsStore.save();
    }
    return result;
  };
  ctx.desktopUi.refreshPlugins = async () => {
    await refreshExternalSnapshot();
  };
  const pluginResults: DesktopPluginInstallResult[] = [];
  for (const plugin of [...defaultPlugins, ...initialPlugins]) {
    pluginResults.push(await installPlugin(plugin));
  }
  for (const candidate of discovered) {
    if (!candidate.installed || candidate.manifest?.builtin) continue;
    if (candidate.source === "external") {
      const entry = externalEntries.get(candidate.manifest?.id ?? "");
      if (!entry) continue;
      try {
        await installPlugin(createExternalPluginModule(entry));
      } catch (cause) {
        console.error(`Failed to restore external plugin "${candidate.manifest?.id}"`, cause);
      }
    } else if (candidate.module) {
      await installPlugin(candidate.module);
    }
  }
  const originalUninstall = uninstallPlugin;
  const persistedUninstall = async (id: string) => {
    const result = await originalUninstall(id);
    if (result) {
      installedPluginIds.delete(id);
      await settingsStore.set("installedPluginIds", [...installedPluginIds]);
      await settingsStore.save();
    }
    return result;
  };
  ctx.desktopUi.uninstallPlugin = persistedUninstall;
  ctx.chatLayouts.activate(initialLayout);
  return {
    ctx,
    service: ctx.desktopUi,
    chatLayouts: ctx.chatLayouts,
    pluginResults,
    installPlugin,
    uninstallPlugin: persistedUninstall,
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
