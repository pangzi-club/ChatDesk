import { useEffect, useRef } from "react";
import type { ChatCommand } from "@/lib/chat-commands";

export type ChatCommandPopupProps = {
  commands: ChatCommand[];
  activeIndex: number;
  onHover: (index: number) => void;
  onSelect: (command: ChatCommand) => void;
};

export function ChatCommandPopup({
  activeIndex,
  commands,
  onHover,
  onSelect,
}: ChatCommandPopupProps) {
  const listRef = useRef<HTMLDivElement>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: 选中项变化时需要把高亮项滚入可视区域
  useEffect(() => {
    const active = listRef.current?.querySelector('[aria-selected="true"]');
    active?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, commands]);

  return (
    <div
      aria-label="命令"
      className="chat-command-popup"
      id="chat-command-popup"
      ref={listRef}
      role="listbox"
    >
      {commands.map((command, index) => (
        // biome-ignore lint/a11y/useFocusableInteractive: 键盘导航由 Composer 输入框接管
        // biome-ignore lint/a11y/useKeyWithClickEvents: 键盘选择发生在 Composer 输入框上
        <div
          aria-selected={index === activeIndex}
          className={`chat-command-popup-item${index === activeIndex ? " is-active" : ""}`}
          key={command.name}
          onClick={() => onSelect(command)}
          onMouseDown={(event) => event.preventDefault()}
          onMouseEnter={() => onHover(index)}
          role="option"
        >
          <span className="chat-command-popup-name">{command.name}</span>
          <span className="chat-command-popup-desc">{command.description}</span>
        </div>
      ))}
    </div>
  );
}
