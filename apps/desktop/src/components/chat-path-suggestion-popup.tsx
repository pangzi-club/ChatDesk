import type { WorkspacePathSuggestion } from "@chatdesk/shared";
import { FileText, Folder } from "lucide-react";
import { useEffect, useRef } from "react";

export type ChatPathSuggestionPopupProps = {
  suggestions: WorkspacePathSuggestion[];
  activeIndex: number;
  isLoading?: boolean;
  onHover: (index: number) => void;
  onSelect: (suggestion: WorkspacePathSuggestion) => void;
};

export function ChatPathSuggestionPopup({
  activeIndex,
  isLoading = false,
  onHover,
  onSelect,
  suggestions,
}: ChatPathSuggestionPopupProps) {
  const listRef = useRef<HTMLDivElement>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: 选中项或候选集合变化时需要把高亮项滚入可视区域
  useEffect(() => {
    listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, suggestions]);

  return (
    <div
      aria-label="文件路径"
      className="chat-command-popup"
      id="chat-path-suggestion-popup"
      ref={listRef}
      role="listbox"
    >
      {isLoading && suggestions.length === 0
        ? ["one", "two", "three"].map((key) => (
            <div className="chat-path-suggestion-skeleton" key={key} />
          ))
        : suggestions.map((suggestion, index) => (
            // biome-ignore lint/a11y/useFocusableInteractive: 键盘导航由 Composer 输入框接管
            // biome-ignore lint/a11y/useKeyWithClickEvents: 键盘选择发生在 Composer 输入框上
            <div
              aria-selected={index === activeIndex}
              className={`chat-command-popup-item${index === activeIndex ? " is-active" : ""}`}
              key={`${suggestion.kind}:${suggestion.path}`}
              onClick={() => onSelect(suggestion)}
              onMouseDown={(event) => event.preventDefault()}
              onMouseEnter={() => onHover(index)}
              role="option"
            >
              {suggestion.kind === "dir" ? (
                <Folder aria-hidden="true" className="size-3.5" />
              ) : (
                <FileText aria-hidden="true" className="size-3.5" />
              )}
              <span className="chat-command-popup-name">
                @{suggestion.path}
                {suggestion.kind === "dir" ? "/" : ""}
              </span>
            </div>
          ))}
    </div>
  );
}
