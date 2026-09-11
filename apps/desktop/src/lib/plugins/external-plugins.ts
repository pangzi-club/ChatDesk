import {
  DESKTOP_PLUGIN_API_VERSION,
  type DesktopPluginManifest,
  type DesktopPluginModule,
  type DesktopUiSlot,
  type ExternalPluginModuleExport,
} from "@chatdesk/desktop-plugin-sdk";
import { DESKTOP_UI_SLOTS } from "@chatdesk/shared";
import React from "react";
import { resolveDesktopIcon } from "@/lib/plugins/desktop-icons";
import type {
  DiscoveredPlugin,
  PluginValidationError,
} from "@/lib/plugins/desktop-plugin-discovery";
import { getDesktopBridge } from "@/lib/runtime/desktop-bridge";
import { settingsStore } from "@/lib/settings/settings-store";

const validSlots = new Set<string>(DESKTOP_UI_SLOTS);
const EXTERNAL_DIRECTORIES_KEY = "externalPluginDirectories";

/** External plugin loading needs the desktop bridge; the web preview degrades gracefully. */
export function externalPluginsSupported() {
  return !!getDesktopBridge()?.scanExternalPlugins;
}

export type ExternalPluginEntry = {
  manifest: DesktopPluginManifest;
  entrySource: string;
};

export type ExternalPluginRefreshResult = {
  supported: boolean;
  plugins: DiscoveredPlugin[];
  entries: Map<string, ExternalPluginEntry>;
};

export function validateExternalPluginManifest(
  manifest: unknown,
  options: { directoryId: string },
): PluginValidationError[] {
  const errors: PluginValidationError[] = [];
  if (!manifest || typeof manifest !== "object")
    return [{ code: "manifest", message: "缺少 plugin.json 内容" }];
  const value = manifest as Record<string, unknown>;
  const id = typeof value.id === "string" ? value.id.trim() : "";
  if (!id) errors.push({ code: "id", message: "plugin.json 缺少 id" });
  else if (!/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/.test(id))
    errors.push({ code: "id", message: `插件 id 不合法：${id}（仅小写字母、数字、中划线和点）` });
  else if (id !== options.directoryId)
    errors.push({
      code: "id.mismatch",
      message: `plugin.json 的 id 必须与目录名一致：${options.directoryId}`,
    });
  if (value.name !== undefined && (typeof value.name !== "string" || !value.name.trim()))
    errors.push({ code: "name", message: "插件 name 必须是非空字符串" });
  if (
    value.description !== undefined &&
    (typeof value.description !== "string" || !value.description.trim())
  )
    errors.push({ code: "description", message: "插件 description 必须是非空字符串" });
  if (typeof value.version !== "string" || !/^\d+\.\d+\.\d+$/.test(value.version))
    errors.push({
      code: "version",
      message: `插件版本不合法：${String(value.version)}（应为 major.minor.patch）`,
    });
  if (value.apiVersion !== undefined && value.apiVersion !== DESKTOP_PLUGIN_API_VERSION)
    errors.push({
      code: "apiVersion",
      message: `不支持的插件格式版本：${String(value.apiVersion)}`,
    });
  if (value.icon !== undefined && (typeof value.icon !== "string" || !value.icon.trim()))
    errors.push({ code: "icon", message: "插件 icon 必须是非空字符串" });
  if (
    !Array.isArray(value.contributes) ||
    value.contributes.some((slot) => typeof slot !== "string" || !validSlots.has(slot))
  )
    errors.push({ code: "contributes", message: "plugin.json contributes 含未知扩展点" });
  else if (new Set(value.contributes).size !== value.contributes.length)
    errors.push({ code: "contributes.duplicate", message: "plugin.json contributes 含重复项" });
  if (
    value.permissions !== undefined &&
    (!Array.isArray(value.permissions) || value.permissions.length > 0)
  )
    errors.push({ code: "permissions", message: "外部插件不支持权限声明，须省略或为空数组" });
  return errors;
}

/**
 * Compile the entry source without running it. Uninstalled plugins must never
 * execute; the compiled function is discarded immediately.
 */
export function checkExternalEntrySyntax(source: string): PluginValidationError | null {
  try {
    new Function("require", "module", "exports", `"use strict";\n${source}`);
    return null;
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    return { code: "entry.syntax", message: `index.js 语法错误：${detail}` };
  }
}

type ExternalFactory = (
  requireModule: (request: string) => unknown,
  moduleObject: { exports: unknown },
  exportsObject: Record<string, unknown>,
) => void;

/**
 * Evaluate an external plugin's `index.js` in the page context. The only
 * available `require` is the host's React instance, so plugin components share
 * the renderer's React and hooks work. Everything else (fetch, timers, DOM) is
 * reachable by design: external plugins are trusted code, not sandboxed.
 */
export function evaluateExternalPluginModule(source: string): ExternalPluginModuleExport {
  const factory = new Function(
    "require",
    "module",
    "exports",
    `"use strict";\n${source}`,
  ) as unknown as ExternalFactory;
  const moduleObject: { exports: unknown } = { exports: {} };
  const requireModule = (request: string) => {
    if (request === "react") return React;
    throw new Error(`外部插件只能 require("react")，不支持：${request}`);
  };
  factory(requireModule, moduleObject, moduleObject.exports as Record<string, unknown>);
  const plugin = moduleObject.exports;
  if (
    !plugin ||
    typeof plugin !== "object" ||
    Array.isArray(plugin) ||
    typeof (plugin as { apply?: unknown }).apply !== "function"
  ) {
    throw new Error("index.js 必须导出插件模块：module.exports = { inject, apply(ctx) {…} }");
  }
  return plugin as ExternalPluginModuleExport;
}

/**
 * Wrap the plugin's `apply` with the public context facade: contributions may
 * reference icons by string key, which the host resolves before registering.
 */
export function createExternalPluginModule(entry: ExternalPluginEntry): DesktopPluginModule {
  const pluginExport = evaluateExternalPluginModule(entry.entrySource);
  const apply = pluginExport.apply;
  const wrappedApply: DesktopPluginModule["apply"] = (ctx) => {
    const facade = {
      desktopUi: {
        register: (slot: string, contribution: unknown) =>
          ctx.desktopUi.register(slot as never, resolveIconInContribution(contribution) as never),
      },
      chatLayouts: ctx.chatLayouts,
      effect: (effect: () => () => void, label?: string) => ctx.effect(effect, label),
    };
    return apply(facade as Parameters<DesktopPluginModule["apply"]>[0]);
  };
  return {
    manifest: entry.manifest,
    // The facade always exposes both host services. Cordis requires every
    // service read while constructing the facade to be listed in `inject`.
    inject: [...new Set([...(pluginExport.inject ?? []), "desktopUi", "chatLayouts"])],
    apply: wrappedApply,
  };
}

function resolveIconInContribution(contribution: unknown) {
  if (!contribution || typeof contribution !== "object" || !("icon" in contribution)) {
    return contribution;
  }
  return {
    ...(contribution as object),
    icon: resolveDesktopIcon((contribution as { icon?: unknown }).icon),
  };
}

/**
 * Scan external plugin directories through the desktop bridge and validate
 * every plugin without executing it. `entries` carries the material needed to
 * evaluate each valid plugin later, at install time only.
 */
export async function refreshExternalPlugins(
  options: { reservedIds?: ReadonlySet<string>; installedIds?: readonly string[] } = {},
): Promise<ExternalPluginRefreshResult> {
  const reservedIds = options.reservedIds ?? new Set<string>();
  const installedIds = options.installedIds ?? [];
  const bridge = getDesktopBridge();
  if (!bridge?.scanExternalPlugins) {
    return { supported: false, plugins: [], entries: new Map() };
  }
  const stored = await settingsStore.get<unknown>(EXTERNAL_DIRECTORIES_KEY);
  const directories = Array.isArray(stored)
    ? stored.filter((item): item is string => typeof item === "string" && item.trim() !== "")
    : [];
  const scan = await bridge.scanExternalPlugins(directories);

  const entries = new Map<string, ExternalPluginEntry>();
  const seenIds = new Set<string>();
  const plugins: DiscoveredPlugin[] = [];
  for (const item of scan.plugins) {
    const errors: PluginValidationError[] = [];
    if (item.error) errors.push({ code: "scan", message: item.error });
    let manifest:
      | {
          id: string;
          name?: string;
          description?: string;
          version: string;
          icon?: string;
          contributes: readonly DesktopUiSlot[];
        }
      | undefined;
    if (item.manifestJson !== null) {
      try {
        const parsed: unknown = JSON.parse(item.manifestJson);
        const validation = validateExternalPluginManifest(parsed, { directoryId: item.id });
        if (validation.length) errors.push(...validation);
        else manifest = parsed as typeof manifest;
      } catch {
        errors.push({ code: "manifest.json", message: "plugin.json 不是合法 JSON" });
      }
    }
    if (item.entrySource !== null) {
      const syntaxError = checkExternalEntrySyntax(item.entrySource);
      if (syntaxError) errors.push(syntaxError);
    }
    if (manifest) {
      if (reservedIds.has(manifest.id))
        errors.push({
          code: "id.reserved",
          message: `插件 id 与内置插件冲突：${manifest.id}`,
        });
      if (seenIds.has(manifest.id))
        errors.push({ code: "id.duplicate", message: `重复的外部插件 id：${manifest.id}` });
      seenIds.add(manifest.id);
    }
    const installable = errors.length === 0 && !!manifest && item.entrySource !== null;
    const fullManifest: DesktopPluginManifest | undefined = manifest
      ? {
          id: manifest.id,
          name: manifest.name,
          description: manifest.description,
          version: manifest.version,
          icon: manifest.icon,
          apiVersion: DESKTOP_PLUGIN_API_VERSION,
          entry: `external/${manifest.id}`,
          contributes: [...manifest.contributes],
          permissions: [],
        }
      : undefined;
    if (installable && fullManifest && item.entrySource !== null) {
      entries.set(fullManifest.id, { manifest: fullManifest, entrySource: item.entrySource });
    }
    plugins.push({
      manifest: fullManifest,
      entry: `external/${item.id}`,
      installable,
      installed: installable && installedIds.includes(manifest?.id ?? item.id),
      errors,
      source: "external",
      directory: item.directory,
      iconKey: manifest?.icon,
    });
  }
  plugins.sort((a, b) => (a.manifest?.id ?? a.entry).localeCompare(b.manifest?.id ?? b.entry));
  return { supported: scan.supported, plugins, entries };
}

export async function loadExternalPluginDirectories(): Promise<string[]> {
  const stored = await settingsStore.get<unknown>(EXTERNAL_DIRECTORIES_KEY);
  return Array.isArray(stored)
    ? stored.filter((item): item is string => typeof item === "string" && item.trim() !== "")
    : [];
}

export async function saveExternalPluginDirectories(directories: readonly string[]): Promise<void> {
  await settingsStore.set(EXTERNAL_DIRECTORIES_KEY, [...directories]);
  await settingsStore.save();
}

export async function revealExternalPluginDirectory(directory: string): Promise<boolean> {
  const bridge = getDesktopBridge();
  if (!bridge?.revealPluginDirectory) return false;
  await bridge.revealPluginDirectory(directory);
  return true;
}
