import type { DesktopPluginManifest, DesktopPluginModule, DesktopUiSlot } from "@/lib/desktop-ui";

export type PluginValidationError = { code: string; message: string };
export type DiscoveredPlugin = {
  manifest?: DesktopPluginManifest;
  entry: string;
  installable: boolean;
  installed: boolean;
  errors: PluginValidationError[];
  module?: DesktopPluginModule;
};

const validSlots = new Set<DesktopUiSlot>([
  "sidebar.navigation",
  "settings.page",
  "route",
  "workspace.tab",
  "action",
  "shell.overlay",
  "shell.before",
  "shell.after",
  "sidebar.before",
  "sidebar.after",
  "sidebar.footer",
  "chat.header.action",
  "chat.composer.tool",
  "chat.messages.before",
  "chat.messages.after",
  "chat.composer.float",
  "chat.message.action",
]);

export function validateDesktopPluginManifest(manifest: unknown): PluginValidationError[] {
  const errors: PluginValidationError[] = [];
  if (!manifest || typeof manifest !== "object")
    return [{ code: "manifest", message: "缺少插件 manifest" }];
  const value = manifest as Record<string, unknown>;
  if (value.builtin !== undefined && typeof value.builtin !== "boolean")
    errors.push({ code: "builtin", message: "desktop plugin manifest builtin must be a boolean" });
  const id = typeof value.id === "string" ? value.id.trim() : "";
  if (!id) errors.push({ code: "id", message: "desktop plugin manifest id must not be empty" });
  else if (!/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/.test(id))
    errors.push({ code: "id", message: `desktop plugin manifest id is invalid: ${id}` });
  if (value.name !== undefined && (typeof value.name !== "string" || !value.name.trim()))
    errors.push({ code: "name", message: "desktop plugin manifest name must not be empty" });
  if (
    value.description !== undefined &&
    (typeof value.description !== "string" || !value.description.trim())
  )
    errors.push({
      code: "description",
      message: "desktop plugin manifest description must not be empty",
    });
  if (typeof value.version !== "string" || !/^\d+\.\d+\.\d+$/.test(value.version))
    errors.push({
      code: "version",
      message: `desktop plugin manifest version is invalid: ${String(value.version)}`,
    });
  if (value.apiVersion !== 1)
    errors.push({
      code: "apiVersion",
      message: `desktop plugin API version ${String(value.apiVersion)} is not supported; expected 1`,
    });
  if (typeof value.entry !== "string" || !value.entry.trim())
    errors.push({ code: "entry", message: "插件入口不能为空" });
  if (
    !Array.isArray(value.contributes) ||
    value.contributes.some(
      (slot) => typeof slot !== "string" || !validSlots.has(slot as DesktopUiSlot),
    )
  )
    errors.push({
      code: "contributes",
      message: "desktop plugin manifest contributes contains an unknown slot",
    });
  else if (new Set(value.contributes).size !== value.contributes.length)
    errors.push({
      code: "contributes.duplicate",
      message: "desktop plugin manifest contributes contains duplicates",
    });
  if (!Array.isArray(value.permissions) || value.permissions.length > 0)
    errors.push({
      code: "permissions",
      message: "desktop plugin manifest permissions must be an empty array",
    });
  return errors;
}

const staticModules = import.meta.glob<DesktopPluginModule>("../plugins/*/index.tsx", {
  eager: true,
});

export function scanDesktopPlugins(installedIds: readonly string[] = []): DiscoveredPlugin[] {
  const seenIds = new Set<string>();
  const seenEntries = new Set<string>();
  return Object.entries(staticModules)
    .map(([path, module]) => {
      const folder = path.match(/plugins\/([^/]+)\/index\.tsx$/)?.[1] ?? path;
      const entry = `plugins/${folder}`;
      const manifest = module?.manifest;
      const errors = validateDesktopPluginManifest(manifest);
      if (manifest && manifest.entry !== entry)
        errors.push({ code: "entry.mismatch", message: `manifest.entry 必须为 ${entry}` });
      if (manifest && seenIds.has(manifest.id))
        errors.push({ code: "id.duplicate", message: `重复插件 id：${manifest.id}` });
      if (seenEntries.has(entry))
        errors.push({ code: "entry.duplicate", message: `重复插件入口：${entry}` });
      if (manifest) seenIds.add(manifest.id);
      seenEntries.add(entry);
      if (!module?.inject || typeof module.apply !== "function")
        errors.push({ code: "module", message: "插件必须导出 inject 和 apply" });
      return {
        manifest,
        entry,
        installable: errors.length === 0,
        installed: !!manifest && (manifest.builtin === true || installedIds.includes(manifest.id)),
        errors,
        module: errors.length === 0 ? module : undefined,
      };
    })
    .sort((a, b) => (a.manifest?.id ?? a.entry).localeCompare(b.manifest?.id ?? b.entry));
}
