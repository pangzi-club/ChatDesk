import { describe, expect, it } from "vitest";
import { DESKTOP_PLUGIN_API_VERSION, type DesktopPluginModule, defineDesktopPlugin } from "./index";

describe("desktop plugin SDK", () => {
  it("defines a plugin without changing its public module", () => {
    const plugin = defineDesktopPlugin({
      manifest: {
        id: "demo.sdk",
        version: "1.0.0",
        apiVersion: DESKTOP_PLUGIN_API_VERSION,
        entry: "demo/sdk",
        contributes: [],
        permissions: [],
      },
      apply: () => undefined,
    } satisfies DesktopPluginModule);

    expect(plugin.manifest.apiVersion).toBe(1);
    expect(plugin.manifest.id).toBe("demo.sdk");
  });

  it("supports builtin manifests", () => {
    const plugin = defineDesktopPlugin({
      manifest: {
        id: "builtin.sdk",
        builtin: true,
        version: "1.0.0",
        apiVersion: DESKTOP_PLUGIN_API_VERSION,
        entry: "plugins/builtin-sdk",
        contributes: [],
        permissions: [],
      },
      apply: () => undefined,
    } satisfies DesktopPluginModule);
    expect(plugin.manifest.builtin).toBe(true);
  });
});
