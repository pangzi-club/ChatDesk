import { toggleWindowMaximize } from "@/lib/runtime/desktop-bridge";

/**
 * 窗口拖拽区。拖拽由 Electron 的 `-webkit-app-region: drag` 原生处理；平台未在
 * 拖拽区上响应双击时，这里补上鼠标双击与键盘 Enter/Space 的最大化切换。
 */
function TitlebarDragRegion({ className = "" }: { className?: string }) {
  return (
    // biome-ignore lint/a11y/useSemanticElements: drag region, not a native button element
    <div
      className={`h-full min-w-0 flex-1 ${className}`}
      style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
      role="button"
      tabIndex={0}
      aria-label="切换窗口最大化"
      onDoubleClick={() => {
        toggleWindowMaximize();
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          toggleWindowMaximize();
        }
      }}
    />
  );
}

export { TitlebarDragRegion };
