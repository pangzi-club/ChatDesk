import { cjk } from "@streamdown/cjk";
import { code } from "@streamdown/code";
import { createMathPlugin } from "@streamdown/math";
import { Fish, Terminal } from "lucide-react";
import {
  type ComponentProps,
  memo,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
import { type Components, defaultRemarkPlugins, Streamdown } from "streamdown";
import "katex/dist/katex.min.css";
import "streamdown/styles.css";
import { isLocalBrowserPreviewUrl, normalizeBrowserPreviewUrl } from "@/lib/browser-preview";
import { openBrowserPreview } from "@/lib/browser-preview-events";
import { type ChatLayout, useChatLayoutId } from "@/lib/chat-layout";
import { resolveMarkdownImageSrc } from "@/lib/chat-markdown-images";
import { remarkLocalBrowserLinks } from "@/lib/chat-markdown-links";

const STREAMDOWN_PLUGINS = {
  cjk,
  code,
  math: createMathPlugin({ singleDollarTextMath: true }),
};
const CHAT_REMARK_PLUGINS = [...Object.values(defaultRemarkPlugins), remarkLocalBrowserLinks];

type ChatMarkdownProps = {
  children: string;
  isAnimating: boolean;
  variant?: ChatLayout;
};

type MarkdownExtraProps = {
  node?: unknown;
};

const BASE_MARKDOWN_COMPONENTS: Components = {
  a: ChatMarkdownLink,
  img: ChatMarkdownImage,
  inlineCode: ChatMarkdownInlineCode,
};

const CUTE_MARKDOWN_COMPONENTS: Components = {
  ...BASE_MARKDOWN_COMPONENTS,
  h1: CuteMarkdownH1,
  h2: CuteMarkdownH2,
  h3: CuteMarkdownH3,
  blockquote: CuteMarkdownBlockquote,
};

const GEEK_MARKDOWN_COMPONENTS: Components = {
  ...BASE_MARKDOWN_COMPONENTS,
  h1: GeekMarkdownH1,
  h2: GeekMarkdownH2,
  h3: GeekMarkdownH3,
};

function componentsForLayout(layout: ChatLayout): Components {
  if (layout === "cute") return CUTE_MARKDOWN_COMPONENTS;
  if (layout === "geek") return GEEK_MARKDOWN_COMPONENTS;
  return BASE_MARKDOWN_COMPONENTS;
}

export const ChatMarkdown = memo(function ChatMarkdown({
  children,
  isAnimating,
  variant,
}: ChatMarkdownProps) {
  const activeLayout = useChatLayoutId();
  const layout = variant ?? activeLayout;
  return (
    <div className={`chat-markdown chat-markdown-${layout}`} data-chat-markdown-style={layout}>
      <Streamdown
        components={componentsForLayout(layout)}
        isAnimating={isAnimating}
        mode={isAnimating ? "streaming" : "static"}
        plugins={STREAMDOWN_PLUGINS}
        remarkPlugins={CHAT_REMARK_PLUGINS}
      >
        {children}
      </Streamdown>
    </div>
  );
});

function CuteMarkdownH1({
  children,
  node: _node,
  ...props
}: ComponentProps<"h1"> & MarkdownExtraProps) {
  return (
    <h1 {...props} data-chat-markdown-heading="cute">
      <Fish aria-hidden="true" className="chat-markdown-heading-icon" />
      {children}
    </h1>
  );
}

function CuteMarkdownH2({
  children,
  node: _node,
  ...props
}: ComponentProps<"h2"> & MarkdownExtraProps) {
  return (
    <h2 {...props} data-chat-markdown-heading="cute">
      <Fish aria-hidden="true" className="chat-markdown-heading-icon" />
      {children}
    </h2>
  );
}

function CuteMarkdownH3({
  children,
  node: _node,
  ...props
}: ComponentProps<"h3"> & MarkdownExtraProps) {
  return (
    <h3 {...props} data-chat-markdown-heading="cute">
      <Fish aria-hidden="true" className="chat-markdown-heading-icon" />
      {children}
    </h3>
  );
}

function CuteMarkdownBlockquote({
  children,
  node: _node,
  ...props
}: ComponentProps<"blockquote"> & MarkdownExtraProps) {
  return (
    <blockquote {...props} data-chat-markdown-blockquote="cute">
      {children}
    </blockquote>
  );
}

function GeekMarkdownH1({
  children,
  node: _node,
  ...props
}: ComponentProps<"h1"> & MarkdownExtraProps) {
  return (
    <h1 {...props} data-chat-markdown-heading="geek">
      <Terminal aria-hidden="true" className="chat-markdown-heading-icon" />
      {children}
    </h1>
  );
}

function GeekMarkdownH2({
  children,
  node: _node,
  ...props
}: ComponentProps<"h2"> & MarkdownExtraProps) {
  return (
    <h2 {...props} data-chat-markdown-heading="geek">
      <Terminal aria-hidden="true" className="chat-markdown-heading-icon" />
      {children}
    </h2>
  );
}

function GeekMarkdownH3({
  children,
  node: _node,
  ...props
}: ComponentProps<"h3"> & MarkdownExtraProps) {
  return (
    <h3 {...props} data-chat-markdown-heading="geek">
      <Terminal aria-hidden="true" className="chat-markdown-heading-icon" />
      {children}
    </h3>
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

function ChatMarkdownImage({
  alt,
  node: _node,
  src,
  ...props
}: ComponentProps<"img"> & MarkdownExtraProps) {
  const resolved = src ? resolveMarkdownImageSrc(src) : src;
  return <img {...props} alt={alt ?? ""} data-streamdown="image" src={resolved} />;
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
