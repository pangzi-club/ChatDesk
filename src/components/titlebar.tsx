import { getCurrentWindow } from "@tauri-apps/api/window";

const appWindow = getCurrentWindow();

/** 窗口拖拽区，双击切换最大化 */
function TitlebarDragRegion({ className = "" }: { className?: string }) {
  return (
    <div
      className={`h-full min-w-0 flex-1 ${className}`}
      data-tauri-drag-region
      onDoubleClick={() => appWindow.toggleMaximize()}
    />
  );
}

export { TitlebarDragRegion };
