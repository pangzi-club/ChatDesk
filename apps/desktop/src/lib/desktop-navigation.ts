import type { Context } from "cordis";
import { Clock3, MessageCircle, MessageSquare, Sparkles } from "lucide-react";
import { AutomationsPage } from "@/pages/automations";
import { ChannelsPage } from "@/pages/channels";
import { ImageGenerationPage } from "@/pages/image-generation";
import type { DesktopPluginModule } from "@/plugin-api";

export const manifest = {
  id: "desktop-navigation",
  version: "1.0.0",
  apiVersion: 1,
  entry: "lib/desktop-navigation",
  contributes: ["sidebar.navigation", "route"],
  permissions: [],
} as const;
export const inject: DesktopPluginModule["inject"] = ["desktopUi"];

export function apply(ctx: Context) {
  ctx.effect(() => {
    const disposers = [
      ctx.desktopUi.register("sidebar.navigation", {
        id: "chat",
        path: "/chat",
        label: "Chat",
        icon: MessageCircle,
        section: "primary",
        order: 10,
        keywords: ["对话", "聊天"],
      }),
      ctx.desktopUi.register("route", {
        id: "channels",
        path: "/channels",
        title: "Channel",
        icon: MessageSquare,
        keywords: ["飞书", "消息", "联系人", "channel"],
        order: 20,
        navigation: { label: "Channel", section: "secondary" },
        component: ChannelsPage,
      }),
      ctx.desktopUi.register("route", {
        id: "automations",
        path: "/automations",
        title: "Automations",
        icon: Clock3,
        keywords: ["自动化", "任务"],
        order: 30,
        navigation: { label: "Automations", section: "secondary" },
        component: AutomationsPage,
      }),
      ctx.desktopUi.register("route", {
        id: "image-generation",
        path: "/image-generation",
        title: "Image Generation",
        icon: Sparkles,
        keywords: ["图片", "图像", "生成"],
        order: 40,
        component: ImageGenerationPage,
      }),
    ];
    return () => {
      disposers.reverse().forEach((dispose) => {
        dispose();
      });
    };
  }, "desktop navigation contributions");
}
