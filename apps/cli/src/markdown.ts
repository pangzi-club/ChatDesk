import { Box, Text } from "ink";
import { createElement as h, type ReactNode } from "react";

export type MarkdownInline =
  | { type: "text"; value: string }
  | { type: "strong"; children: MarkdownInline[] }
  | { type: "em"; children: MarkdownInline[] }
  | { type: "codespan"; value: string }
  | { type: "link"; href: string; children: MarkdownInline[] }
  | { type: "image"; href: string; alt: string }
  | { type: "math"; value: string };

export type MarkdownBlock =
  | { type: "heading"; depth: number; children: MarkdownInline[] }
  | { type: "paragraph"; children: MarkdownInline[] }
  | { type: "list"; ordered: boolean; items: MarkdownInline[][] }
  | { type: "blockquote"; children: MarkdownBlock[] }
  | { type: "code"; language?: string; value: string }
  | { type: "hr" };

export type MarkdownRenderOptions = {
  color?: boolean;
};

const ANSI = {
  reset: "\x1b[0m",
  bold: "1",
  italic: "3",
  underline: "4",
  dim: "2",
  cyan: "36",
  yellow: "33",
  blue: "34",
  gray: "90",
};

type InlineStyle = {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  dim?: boolean;
  color?: string;
};

function isEscaped(source: string, index: number) {
  let slashes = 0;
  for (let cursor = index - 1; cursor >= 0 && source[cursor] === "\\"; cursor -= 1) slashes += 1;
  return slashes % 2 === 1;
}

function findClose(source: string, start: number, delimiter: string) {
  let index = start;
  while (index < source.length) {
    const found = source.indexOf(delimiter, index);
    if (found === -1) return -1;
    if (!isEscaped(source, found) && (delimiter !== "$" || source[found + 1] !== "$")) return found;
    index = found + delimiter.length;
  }
  return -1;
}

function takeCodespan(source: string, start: number) {
  let ticks = 0;
  while (source[start + ticks] === "`") ticks += 1;
  if (ticks === 0) return undefined;
  const open = source.slice(start, start + ticks);
  const closeAt = source.indexOf(open, start + ticks);
  if (closeAt === -1) return undefined;
  return { value: source.slice(start + ticks, closeAt), end: closeAt + ticks };
}

function takeLinkLike(source: string, start: number, image: boolean) {
  const open = image ? 2 : 1;
  if (image && (source[start] !== "!" || source[start + 1] !== "[")) return undefined;
  if (!image && source[start] !== "[") return undefined;
  const labelEnd = findClose(source, start + open, "]");
  if (labelEnd === -1 || source[labelEnd + 1] !== "(") return undefined;
  const hrefEnd = findClose(source, labelEnd + 2, ")");
  if (hrefEnd === -1) return undefined;
  const label = source.slice(start + open, labelEnd);
  const href = source.slice(labelEnd + 2, hrefEnd).trim();
  return { label, href, end: hrefEnd + 1 };
}

function parseInlines(source: string): MarkdownInline[] {
  const nodes: MarkdownInline[] = [];
  let buffer = "";
  const flush = () => {
    if (!buffer) return;
    nodes.push({ type: "text", value: buffer });
    buffer = "";
  };
  let index = 0;
  while (index < source.length) {
    const char = source[index] ?? "";
    if (char === "\\" && index + 1 < source.length) {
      buffer += source[index + 1];
      index += 2;
      continue;
    }
    if (char === "`") {
      const span = takeCodespan(source, index);
      if (span) {
        flush();
        nodes.push({ type: "codespan", value: span.value });
        index = span.end;
        continue;
      }
    }
    if (char === "!" && source[index + 1] === "[") {
      const image = takeLinkLike(source, index, true);
      if (image) {
        flush();
        nodes.push({ type: "image", href: image.href, alt: image.label });
        index = image.end;
        continue;
      }
    }
    if (char === "[") {
      const link = takeLinkLike(source, index, false);
      if (link) {
        flush();
        nodes.push({
          type: "link",
          href: link.href,
          children: parseInlines(link.label),
        });
        index = link.end;
        continue;
      }
    }
    if (char === "$") {
      const display = source[index + 1] === "$";
      const delimiter = display ? "$$" : "$";
      const closeAt = findClose(source, index + delimiter.length, delimiter);
      if (closeAt !== -1) {
        const value = source.slice(index + delimiter.length, closeAt).trim();
        if (value) {
          flush();
          nodes.push({ type: "math", value });
          index = closeAt + delimiter.length;
          continue;
        }
      }
    }
    const rest = source.slice(index);
    if (rest.startsWith("**") || rest.startsWith("__")) {
      const delimiter = rest.startsWith("**") ? "**" : "__";
      const closeAt = findClose(source, index + delimiter.length, delimiter);
      if (closeAt > index + delimiter.length) {
        flush();
        nodes.push({
          type: "strong",
          children: parseInlines(source.slice(index + delimiter.length, closeAt)),
        });
        index = closeAt + delimiter.length;
        continue;
      }
    }
    if (char === "*" || char === "_") {
      const closeAt = findClose(source, index + 1, char);
      if (closeAt > index + 1) {
        flush();
        nodes.push({
          type: "em",
          children: parseInlines(source.slice(index + 1, closeAt)),
        });
        index = closeAt + 1;
        continue;
      }
    }
    buffer += char;
    index += 1;
  }
  flush();
  return nodes;
}

function headingDepth(line: string) {
  const match = /^(#{1,6})[ \t]+(.+?)\s*$/.exec(line);
  return match ? { depth: match[1]?.length ?? 1, text: match[2] ?? "" } : undefined;
}

function fenceOpen(line: string) {
  const match = /^(```+|~~~+)([^\s`]*)\s*$/.exec(line);
  return match ? { fence: match[1] ?? "```", language: match[2] || undefined } : undefined;
}

function listItem(line: string) {
  const unordered = /^([-*+])[ \t]+(.*)$/.exec(line);
  if (unordered) return { ordered: false, text: unordered[2] ?? "" };
  const ordered = /^(\d+)\.[ \t]+(.*)$/.exec(line);
  if (ordered) return { ordered: true, text: ordered[2] ?? "" };
  return undefined;
}

function isHr(line: string) {
  return /^(?:(?:-\s*){3,}|(?:\*\s*){3,}|(?:_\s*){3,})$/.test(line.trim());
}

function quoteText(line: string) {
  const match = /^>[ \t]?(.*)$/.exec(line);
  return match ? (match[1] ?? "") : undefined;
}

export function parseMarkdown(source: string): MarkdownBlock[] {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const blocks: MarkdownBlock[] = [];
  let index = 0;

  const skipBlank = () => {
    while (index < lines.length && !(lines[index] ?? "").trim()) index += 1;
  };

  while (index < lines.length) {
    skipBlank();
    if (index >= lines.length) break;
    const line = lines[index] ?? "";
    const heading = headingDepth(line);
    if (heading) {
      blocks.push({ type: "heading", depth: heading.depth, children: parseInlines(heading.text) });
      index += 1;
      continue;
    }
    if (isHr(line)) {
      blocks.push({ type: "hr" });
      index += 1;
      continue;
    }
    const fence = fenceOpen(line);
    if (fence) {
      index += 1;
      const body: string[] = [];
      while (index < lines.length) {
        const current = lines[index] ?? "";
        if (current.startsWith(fence.fence)) break;
        body.push(current);
        index += 1;
      }
      if (index < lines.length) index += 1;
      blocks.push({
        type: "code",
        ...(fence.language ? { language: fence.language } : {}),
        value: body.join("\n"),
      });
      continue;
    }
    const quoted = quoteText(line);
    if (quoted !== undefined) {
      const inner: string[] = [];
      while (index < lines.length) {
        const next = quoteText(lines[index] ?? "");
        if (next === undefined) break;
        inner.push(next);
        index += 1;
      }
      blocks.push({ type: "blockquote", children: parseMarkdown(inner.join("\n")) });
      continue;
    }
    const item = listItem(line);
    if (item) {
      const ordered = item.ordered;
      const items: MarkdownInline[][] = [];
      while (index < lines.length) {
        const next = listItem(lines[index] ?? "");
        if (!next || next.ordered !== ordered) break;
        items.push(parseInlines(next.text));
        index += 1;
      }
      blocks.push({ type: "list", ordered, items });
      continue;
    }
    const paragraph: string[] = [];
    while (index < lines.length) {
      const current = lines[index] ?? "";
      if (!current.trim()) break;
      if (
        headingDepth(current) ||
        fenceOpen(current) ||
        isHr(current) ||
        quoteText(current) !== undefined
      ) {
        break;
      }
      if (listItem(current)) break;
      paragraph.push(current);
      index += 1;
    }
    if (paragraph.length > 0) {
      blocks.push({ type: "paragraph", children: parseInlines(paragraph.join("\n")) });
    }
  }
  return blocks;
}

function styleAnsi(text: string, style: InlineStyle, color: boolean) {
  if (!color || !text) return text;
  const codes: string[] = [];
  if (style.bold) codes.push(ANSI.bold);
  if (style.italic) codes.push(ANSI.italic);
  if (style.underline) codes.push(ANSI.underline);
  if (style.dim) codes.push(ANSI.dim);
  if (style.color) codes.push(style.color);
  if (codes.length === 0) return text;
  return `\x1b[${codes.join(";")}m${text}${ANSI.reset}`;
}

function renderInlinesAnsi(
  nodes: MarkdownInline[],
  color: boolean,
  style: InlineStyle = {},
): string {
  return nodes
    .map((node) => {
      if (node.type === "text") return styleAnsi(node.value, style, color);
      if (node.type === "strong")
        return renderInlinesAnsi(node.children, color, { ...style, bold: true });
      if (node.type === "em")
        return renderInlinesAnsi(node.children, color, { ...style, italic: true });
      if (node.type === "codespan") {
        return styleAnsi(node.value, { ...style, color: ANSI.yellow }, color);
      }
      if (node.type === "link") {
        const label = renderInlinesAnsi(node.children, color, {
          ...style,
          underline: true,
          color: ANSI.blue,
        });
        const href = node.href && node.href !== inlineText(node.children) ? ` (${node.href})` : "";
        return `${label}${styleAnsi(href, { ...style, dim: true }, color)}`;
      }
      if (node.type === "image") {
        const label = node.alt ? `[图片: ${node.alt}]` : "[图片]";
        const href = node.href ? `(${node.href})` : "";
        return styleAnsi(`${label}${href}`, { ...style, dim: true }, color);
      }
      return styleAnsi(`[公式] ${node.value}`, { ...style, dim: true }, color);
    })
    .join("");
}

function inlineText(nodes: MarkdownInline[]): string {
  return nodes
    .map((node) => {
      if (node.type === "text" || node.type === "codespan" || node.type === "math")
        return node.value;
      if (node.type === "image") return node.alt || node.href;
      if (node.type === "link") return inlineText(node.children) || node.href;
      return inlineText(node.children);
    })
    .join("");
}

function renderBlocksAnsi(blocks: MarkdownBlock[], color: boolean): string {
  return blocks
    .map((block) => {
      if (block.type === "heading") {
        const headingStyle =
          block.depth <= 1
            ? { bold: true, color: ANSI.cyan }
            : block.depth === 2
              ? { bold: true, color: ANSI.blue }
              : { bold: true };
        return renderInlinesAnsi(block.children, color, headingStyle);
      }
      if (block.type === "paragraph") return renderInlinesAnsi(block.children, color);
      if (block.type === "list") {
        return block.items
          .map((item, itemIndex) => {
            const bullet = block.ordered ? `${itemIndex + 1}. ` : "• ";
            return `${styleAnsi(bullet, { dim: true }, color)}${renderInlinesAnsi(item, color)}`;
          })
          .join("\n");
      }
      if (block.type === "blockquote") {
        const inner = renderBlocksAnsi(block.children, color);
        return inner
          .split("\n")
          .map((line) => `${styleAnsi("│ ", { dim: true }, color)}${line}`)
          .join("\n");
      }
      if (block.type === "code") {
        const language = block.language
          ? `${styleAnsi(block.language, { dim: true }, color)}\n`
          : "";
        return `${language}${styleAnsi(block.value, { color: ANSI.yellow }, color)}`;
      }
      return styleAnsi("───", { dim: true }, color);
    })
    .join("\n\n");
}

export function renderMarkdown(source: string, options: MarkdownRenderOptions = {}) {
  const color = options.color ?? false;
  return renderBlocksAnsi(parseMarkdown(source), color);
}

function renderInlinesInk(nodes: MarkdownInline[], keyPrefix: string): ReactNode[] {
  return nodes.map((node, index) => {
    const key = `${keyPrefix}-${index}`;
    if (node.type === "text") return node.value;
    if (node.type === "strong") {
      return h(Text, { key, bold: true }, ...renderInlinesInk(node.children, key));
    }
    if (node.type === "em") {
      return h(Text, { key, italic: true }, ...renderInlinesInk(node.children, key));
    }
    if (node.type === "codespan") return h(Text, { key, color: "yellow" }, node.value);
    if (node.type === "link") {
      const label = inlineText(node.children) || node.href;
      const href = node.href && node.href !== label ? ` (${node.href})` : "";
      return h(
        Text,
        { key },
        h(Text, { color: "blue", underline: true }, ...renderInlinesInk(node.children, key)),
        href ? h(Text, { dimColor: true }, href) : null,
      );
    }
    if (node.type === "image") {
      const label = node.alt ? `[图片: ${node.alt}]` : "[图片]";
      const href = node.href ? `(${node.href})` : "";
      return h(Text, { key, dimColor: true }, `${label}${href}`);
    }
    return h(Text, { key, dimColor: true }, `[公式] ${node.value}`);
  });
}

function renderBlocksInk(blocks: MarkdownBlock[], keyPrefix: string): ReactNode[] {
  return blocks.map((block, index) => {
    const key = `${keyPrefix}-${index}`;
    if (block.type === "heading") {
      const color = block.depth <= 1 ? "cyan" : block.depth === 2 ? "blue" : undefined;
      return h(Text, { key, bold: true, color }, ...renderInlinesInk(block.children, key));
    }
    if (block.type === "paragraph") {
      return h(Text, { key }, ...renderInlinesInk(block.children, key));
    }
    if (block.type === "list") {
      return h(
        Box,
        { key, flexDirection: "column" },
        ...block.items.map((item, itemIndex) =>
          h(
            Box,
            { key: `${key}-${itemIndex}` },
            h(Text, { dimColor: true }, block.ordered ? `${itemIndex + 1}. ` : "• "),
            h(Text, null, ...renderInlinesInk(item, `${key}-${itemIndex}`)),
          ),
        ),
      );
    }
    if (block.type === "blockquote") {
      return h(
        Box,
        { key },
        h(Text, { dimColor: true }, "│ "),
        h(Box, { flexDirection: "column" }, ...renderBlocksInk(block.children, key)),
      );
    }
    if (block.type === "code") {
      return h(
        Box,
        { key, flexDirection: "column" },
        block.language ? h(Text, { dimColor: true }, block.language) : null,
        h(Text, { color: "yellow" }, block.value),
      );
    }
    return h(Text, { key, dimColor: true }, "───");
  });
}

export function MarkdownView(props: { source: string }) {
  const blocks = parseMarkdown(props.source);
  if (blocks.length === 0) return h(Text, null, "");
  return h(Box, { flexDirection: "column" }, ...renderBlocksInk(blocks, "md"));
}
