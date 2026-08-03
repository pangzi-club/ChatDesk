import { getCurrentWindow } from "@tauri-apps/api/window";
import { Minus, Plus, X } from "lucide-react";

const appWindow = getCurrentWindow();

/** macOS 风格红绿灯按钮（不能放在 drag region 内，否则点击会触发拖拽） */
function TrafficLights() {
  return (
    <div className="group flex shrink-0 items-center gap-2 px-3 max-md:gap-1.5 max-md:px-2.5">
      <WindowButton
        ariaLabel="Close window"
        colorClass="bg-[#ff5f57]"
        onClick={() => appWindow.close()}
      >
        <X className="size-2.5" strokeWidth={3} />
      </WindowButton>
      <WindowButton
        ariaLabel="Minimize window"
        colorClass="bg-[#febc2e]"
        onClick={() => appWindow.minimize()}
      >
        <Minus className="size-2.5" strokeWidth={3} />
      </WindowButton>
      <WindowButton
        ariaLabel="Maximize window"
        colorClass="bg-[#28c840]"
        onClick={() => appWindow.toggleMaximize()}
      >
        <Plus className="size-2.5" strokeWidth={3} />
      </WindowButton>
    </div>
  );
}

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

function WindowButton({
  ariaLabel,
  colorClass,
  onClick,
  children,
}: {
  ariaLabel: string;
  colorClass: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      aria-label={ariaLabel}
      className={`flex size-3 items-center justify-center rounded-full ${colorClass} text-black/60 transition-colors`}
      onClick={onClick}
      type="button"
    >
      {/* 图标仅在悬停按钮组时显示，模拟 macOS 行为 */}
      <span className="opacity-0 transition-opacity group-hover:opacity-100">{children}</span>
    </button>
  );
}

export { TitlebarDragRegion, TrafficLights };
