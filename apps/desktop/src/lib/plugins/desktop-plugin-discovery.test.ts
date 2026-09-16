import { describe, expect, it } from "vitest";
import { scanDesktopPlugins } from "@/lib/plugins/desktop-plugin-discovery";

describe("scanDesktopPlugins", () => {
  it("discovers builtin plugins from src/plugins", () => {
    const plugins = scanDesktopPlugins();
    const ids = plugins.map((item) => item.manifest?.id);
    expect(ids).toContain("desktop-settings");
    expect(ids).toContain("demo-pomodoro");
    expect(ids).toContain("workspace-tabs-core");
  });

  it("reports valid manifests as installable builtins", () => {
    const plugins = scanDesktopPlugins();
    expect(plugins.length).toBeGreaterThan(0);
    for (const item of plugins) {
      expect(item.errors).toEqual([]);
      expect(item.installable).toBe(true);
      // demo 插件按需安装；其余内置插件始终启用
      if (!item.manifest?.id?.startsWith("demo-")) {
        expect(item.installed).toBe(true);
      }
    }
  });
});
