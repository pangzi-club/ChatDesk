import { code } from "@streamdown/code";
import type { ComponentProps, MouseEvent as ReactMouseEvent, ReactNode } from "react";
import { defaultRemarkPlugins, Streamdown } from "streamdown";
import "streamdown/styles.css";
import { isLocalBrowserPreviewUrl, normalizeBrowserPreviewUrl } from "@/lib/browser-preview";
import { openBrowserPreview } from "@/lib/browser-preview-events";
import { remarkLocalBrowserLinks } from "@/lib/chat-markdown-links";

const STREAMDOWN_PLUGINS = { code };
const CHAT_REMARK_PLUGINS = [...Object.values(defaultRemarkPlugins), remarkLocalBrowserLinks];

type ChatMarkdownProps = {
  children: string;
  isAnimating: boolean;
};

type MarkdownExtraProps = {
  node?: unknown;
};

export function ChatMarkdown({ children, isAnimating }: ChatMarkdownProps) {
  return (
    <Streamdown
      components={{ a: ChatMarkdownLink, inlineCode: ChatMarkdownInlineCode }}
      isAnimating={isAnimating}
      plugins={STREAMDOWN_PLUGINS}
      remarkPlugins={CHAT_REMARK_PLUGINS}
    >
      {children}
    </Streamdown>
  );
}

function ChatMarkdownLink({
  children,
  href,
  node: _node,
  onClick,
  ...props
}: ComponentProps<"a"> & MarkdownExtraProps) {
  const normalized = href ? normalizeBrowserPreviewUrl(href) : null;
  const local = normalized ? isLocalBrowserPreviewUrl(normalized) : false;

  function handleClick(event: ReactMouseEvent<HTMLAnchorElement>) {
    onClick?.(event);
    if (event.defaultPrevented || !normalized || !local) return;
    event.preventDefault();
    openBrowserPreview({ url: normalized });
  }

  return (
    <a
      {...props}
      data-streamdown="link"
      href={href}
      onClick={handleClick}
      rel="noreferrer"
      target="_blank"
    >
      {children}
    </a>
  );
}

function ChatMarkdownInlineCode({
  children,
  className,
  node: _node,
  ...props
}: ComponentProps<"code"> & MarkdownExtraProps) {
  const text = flattenText(children).trim();
  const normalized = normalizeBrowserPreviewUrl(text);
  if (normalized && isLocalBrowserPreviewUrl(normalized)) {
    return (
      <button
        className="chat-local-preview-code"
        onClick={() => openBrowserPreview({ url: normalized })}
        title={`在 Browser 中打开 ${text}`}
        type="button"
      >
        <code className={className} {...props}>
          {children}
        </code>
      </button>
    );
  }

  return (
    <code className={className} data-streamdown="inline-code" {...props}>
      {children}
    </code>
  );
}

function flattenText(value: ReactNode): string {
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (Array.isArray(value)) return value.map(flattenText).join("");
  return "";
}
