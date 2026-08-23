import { getDesktopBridge } from "@/lib/desktop-bridge";

/** 窗口拖拽区，双击切换最大化 */
function TitlebarDragRegion({ className = "" }: { className?: string }) {
  return (
    // biome-ignore lint/a11y/useSemanticElements: 1
    <div
      className={`h-full min-w-0 flex-1 ${className}`}
      style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
      role="button"
      tabIndex={0}
      aria-label="切换窗口最大化"
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          void getDesktopBridge()?.toggleWindowMaximize();
        }
      }}
    />
  );
}

export { TitlebarDragRegion };
