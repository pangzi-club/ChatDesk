import { describe, expect, it } from "vitest";
import type { DiscoveredPlugin } from "@/lib/plugins/desktop-plugin-discovery";
import { getPluginCategory, isDemoPlugin, shouldShowPlugin } from "@/lib/plugins/plugin-catalog";

function plugin(id: string, installed = false): DiscoveredPlugin {
  return {
    manifest: {
      id,
      name: id,
      description: "",
      version: "1.0.0",
      apiVersion: 1,
      entry: `plugins/${id}`,
      contributes: [],
      permissions: [],
    },
    entry: `plugins/${id}`,
    installable: true,
    installed,
    errors: [],
    source: "builtin",
  };
}

describe("plugin catalog", () => {
  it("groups demo plugins together", () => {
    expect(isDemoPlugin(plugin("demo-pomodoro"))).toBe(true);
    expect(getPluginCategory(plugin("demo-pomodoro"))).toBe("Demo");
    expect(getPluginCategory(plugin("chat-layout-standard"))).toBe("精选");
  });

  it("keeps installed demos visible when the test plugin switch is off", () => {
    expect(shouldShowPlugin(plugin("demo-pomodoro"), false)).toBe(false);
    expect(shouldShowPlugin(plugin("demo-pomodoro", true), false)).toBe(true);
    expect(shouldShowPlugin(plugin("demo-pomodoro"), true)).toBe(true);
    expect(shouldShowPlugin(plugin("chat-layout-standard"), false)).toBe(true);
  });
});
