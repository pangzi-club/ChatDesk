import { defineDesktopPlugin } from "@chatdesk/desktop-plugin-sdk";
import { Timer } from "lucide-react";
import { useEffect, useState } from "react";

function PomodoroPage() {
  const [seconds, setSeconds] = useState(25 * 60);
  useEffect(() => {
    const id = window.setInterval(() => setSeconds((value) => Math.max(0, value - 1)), 1000);
    return () => window.clearInterval(id);
  }, []);
  const minutes = Math.floor(seconds / 60)
    .toString()
    .padStart(2, "0");
  const rest = (seconds % 60).toString().padStart(2, "0");
  return (
    <main className="h-full bg-background p-8">
      <h1 className="font-semibold text-xl">专注番茄钟</h1>
      <p className="mt-2 text-muted-foreground">给自己 25 分钟安静时间。</p>
      <div className="mt-12 font-mono text-7xl tabular-nums">
        {minutes}:{rest}
      </div>
    </main>
  );
}
const plugin = defineDesktopPlugin({
  manifest: {
    id: "demo-pomodoro",
    name: "Pomodoro 专注钟",
    description: "提供一个 25 分钟本地倒计时页面，并演示插件路由和 Sidebar 导航的注册与卸载。",
    version: "1.0.0",
    apiVersion: 1,
    entry: "plugins/demo-pomodoro",
    contributes: ["route", "sidebar.navigation"],
    permissions: [],
  },
  inject: ["desktopUi"],
  apply(ctx) {
    ctx.effect(() => {
      const dispose = [
        ctx.desktopUi.register("route", {
          id: "demo-pomodoro",
          path: "/plugins/pomodoro",
          title: "Pomodoro",
          icon: Timer,
          keywords: ["专注", "番茄钟"],
          component: PomodoroPage,
        }),
        ctx.desktopUi.register("sidebar.navigation", {
          id: "demo-pomodoro",
          path: "/plugins/pomodoro",
          label: "Pomodoro",
          icon: Timer,
          section: "secondary",
          order: 80,
        }),
      ];
      return () => {
        dispose.reverse().forEach((item) => {
          item();
        });
      };
    }, "pomodoro demo");
  },
});

export const manifest = plugin.manifest;
export const inject = plugin.inject;
export const apply = plugin.apply;
