import { getCurrentWindow } from "@tauri-apps/api/window";

const appWindow = getCurrentWindow();

/** 窗口拖拽区，双击切换最大化 */
function TitlebarDragRegion({ className = "" }: { className?: string }) {
  return (
    // biome-ignore lint/a11y/useSemanticElements: 1
    <div
      className={`h-full min-w-0 flex-1 ${className}`}
      data-tauri-drag-region
      role="button"
      tabIndex={0}
      aria-label="切换窗口最大化"
      onDoubleClick={() => appWindow.toggleMaximize()}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          void appWindow.toggleMaximize();
        }
      }}
    />
  );
}

export { TitlebarDragRegion };
