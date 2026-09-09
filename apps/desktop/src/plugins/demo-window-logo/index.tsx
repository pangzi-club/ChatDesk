import { defineDesktopPlugin } from "@chatdesk/desktop-plugin-sdk";
import { toast } from "@/hooks/use-toast";

/** Demo 品牌标识：白字气泡 + 应用主色底，品牌标识允许固定色。 */
function WindowLogoOverlay() {
  return (
    <button
      aria-label="显示 ChatDesk 通知"
      className="fixed top-28 right-4 z-30 flex size-10 cursor-pointer items-center justify-center rounded-[10px] outline-none transition-[filter,transform] duration-150 hover:scale-105 hover:brightness-110 focus-visible:ring-2 focus-visible:ring-ring active:scale-95 motion-reduce:transition-none max-sm:right-3"
      onClick={() =>
        toast({
          title: "ChatDesk",
          description: "demo-window-logo：你点击了窗口右上角的 Logo。",
        })
      }
      title="点击显示通知"
      type="button"
    >
      <svg aria-hidden="true" className="size-10" viewBox="0 0 24 24">
        <rect fill="#2f80ed" height="20" rx="6" width="20" x="2" y="2" />
        <rect fill="#fff" height="7" rx="2" width="11" x="6.5" y="7.5" />
        <path d="M8.5 13.5v3.2l3-3.2z" fill="#fff" />
      </svg>
    </button>
  );
}

const plugin = defineDesktopPlugin({
  manifest: {
    id: "demo-window-logo",
    name: "窗口 Logo",
    description:
      "演示 shell.overlay 插槽：在窗口右上角、标题栏与页面头部之下常驻显示一个可点击的品牌 Logo，点击后弹出 shadcn toast 通知。",
    version: "1.2.0",
    apiVersion: 1,
    entry: "plugins/demo-window-logo",
    contributes: ["shell.overlay"],
    permissions: [],
  },
  inject: ["desktopUi"],
  apply(ctx) {
    ctx.effect(() => {
      return ctx.desktopUi.register("shell.overlay", {
        id: "demo-window-logo.overlay",
        component: WindowLogoOverlay,
      });
    }, "window logo demo");
  },
});

export const manifest = plugin.manifest;
export const inject = plugin.inject;
export const apply = plugin.apply;
