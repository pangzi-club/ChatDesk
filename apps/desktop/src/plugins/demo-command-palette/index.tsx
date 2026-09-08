import { defineDesktopPlugin } from "@chatdesk/desktop-plugin-sdk";
import { Sparkles } from "lucide-react";

const plugin = defineDesktopPlugin({
  manifest: {
    id: "demo-command-palette",
    name: "随机灵感命令",
    description: "向 Command Menu 注册“随机灵感”Action，用于验证插件命令的发现、执行和卸载。",
    version: "1.0.0",
    apiVersion: 1,
    entry: "plugins/demo-command-palette",
    contributes: ["action"],
    permissions: [],
  },
  inject: ["desktopUi"],
  apply(ctx) {
    ctx.effect(
      () =>
        ctx.desktopUi.register("action", {
          id: "demo-inspiration",
          label: "随机灵感",
          icon: Sparkles,
          keywords: ["彩蛋", "灵感"],
          run: () => {
            const ideas = ["给今天的自己写一封信", "把最难的问题拆成三步", "去窗边看看天空"];
            window.alert(ideas[Math.floor(Math.random() * ideas.length)]);
          },
        }),
      "inspiration action",
    );
  },
});

export const manifest = plugin.manifest;
export const inject = plugin.inject;
export const apply = plugin.apply;
