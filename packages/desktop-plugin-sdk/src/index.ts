import type { DESKTOP_UI_SLOTS } from "@chatdesk/shared";
import type { UIMessage } from "ai";
import type { ComponentType, ReactNode } from "react";

export const DESKTOP_PLUGIN_API_VERSION = 1 as const;
export type DesktopUiSlot = (typeof DESKTOP_UI_SLOTS)[number];
export type DesktopIcon = ComponentType<{ className?: string }>;
export type ChatLayoutProps = { children: ReactNode };
export type ChatLayoutComponent = ComponentType<ChatLayoutProps>;
export type ChatLayout = string;
export type DesktopPluginManifest = {
  id: string;
  builtin?: boolean;
  name?: string;
  description?: string;
  icon?: string;
  version: string;
  apiVersion: typeof DESKTOP_PLUGIN_API_VERSION;
  entry: string;
  contributes: readonly DesktopUiSlot[];
  permissions: readonly [];
};
export type DesktopShortcut = {
  alt: boolean;
  code?: string;
  ctrl: boolean;
  key: string;
  meta: boolean;
  shift: boolean;
};
export type DesktopActionScope = { pathname: string; navigate: (to: string) => void };
export type DesktopActionContribution = {
  id: string;
  label: string;
  icon: DesktopIcon;
  keywords?: string[];
  order?: number;
  shortcut?: DesktopShortcut;
  run: (scope: DesktopActionScope) => void | Promise<void>;
};
export type DesktopShellScope = { pathname: string; isChatPage: boolean };
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
export type WorkspaceTab<K extends string = string, D extends object = object> = {
  id: string;
  type: K;
  title: string;
  data: D;
};
export type WorkspaceTabScope = {
  workspaceId: string;
  cwd: string;
  sessionId: string | null;
  messages: UIMessage[];
  sideChatOpening: boolean;
  openSideChat: (draft?: string) => Promise<WorkspaceTab<"chat"> | undefined>;
};
export type WorkspaceTabRenderProps<K extends string = string, D extends object = object> = {
  tab: WorkspaceTab<K, D>;
  scope: WorkspaceTabScope;
  updateTab: (patch: Partial<D> & { title?: string }) => void;
};
export type WorkspaceTabContribution<K extends string = string, D extends object = object> = {
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
  WorkspaceTabContribution<string, object>,
  "renderer" | "onClose"
> & {
  renderer?: ComponentType<never>;
  onClose?: (tab: never, scope: WorkspaceTabScope) => void | Promise<void>;
};
export type DesktopContributionMap = {
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
  "chat.composer.float": ChatRegionContribution;
  "chat.message.action": ChatMessageActionContribution;
};
export interface DesktopUiServiceContract {
  register<K extends DesktopUiSlot>(slot: K, contribution: DesktopContributionMap[K]): () => void;
}
export interface ChatLayoutServiceContract {
  register(id: string, component: ComponentType<{ children: React.ReactNode }>): () => void;
}
export interface DesktopPluginContext {
  desktopUi: DesktopUiServiceContract;
  chatLayouts: ChatLayoutServiceContract;
  effect(effect: () => undefined, label?: string): unknown;
  effect(effect: () => () => void, label?: string): unknown;
}
export type DesktopPluginModule = {
  manifest: DesktopPluginManifest;
  inject?: readonly string[];
  apply: (ctx: DesktopPluginContext) => unknown;
};
/**
 * Contract for the `plugin.json` file inside an external plugin directory.
 * The manifest is the single source of truth for identity; `index.js` only
 * provides the module export (see `ExternalPluginModuleExport`). `id` must
 * equal the directory name. Omit `apiVersion` for the current format; other
 * values are rejected so future formats can be distinguished.
 */
export type ExternalPluginManifest = {
  id: string;
  name?: string;
  description?: string;
  version: string;
  apiVersion?: typeof DESKTOP_PLUGIN_API_VERSION;
  icon?: string;
  contributes: readonly DesktopUiSlot[];
  permissions?: readonly [];
};
/**
 * Shape exported by an external plugin's `index.js` (plain JavaScript, CommonJS
 * style). `React` is available through the injected `require("react")`; build
 * elements with `React.createElement` because JSX is not supported.
 */
export type ExternalPluginModuleExport = {
  inject?: readonly string[];
  apply: (ctx: DesktopPluginContext) => unknown;
};
export function defineDesktopPlugin<T extends DesktopPluginModule>(plugin: T): T {
  return plugin;
}

export type DesktopPluginHandle = { id: string; dispose: () => Promise<void> };
export type DesktopPluginInstallResult =
  | { ok: true; id: string; handle: DesktopPluginHandle }
  | { ok: false; id: string; error: Error };
export type BuiltinWorkspaceTabType = keyof WorkspaceTabDataMap;
export type WorkspaceTabDataMap = Record<string, object>;
export type WorkspaceTabType = string;
export type WorkspaceTabData<K extends WorkspaceTabType> = K extends keyof WorkspaceTabDataMap
  ? WorkspaceTabDataMap[K]
  : object;
