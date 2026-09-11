export type ComposerMark = {
  type: string;
};

export type ComposerJSON = {
  type?: string;
  text?: string;
  marks?: ComposerMark[];
  attrs?: Record<string, unknown>;
  content?: ComposerJSON[];
};

export const EMPTY_COMPOSER_DOC: ComposerJSON = {
  type: "doc",
  content: [{ type: "paragraph" }],
};

type InlineGroup =
  | { kind: "paragraph"; text: string }
  | { kind: "bullet"; items: string[] }
  | { kind: "ordered"; start: number; items: string[] };

const UNORDERED_LIST_PATTERN = /^[-*] (.*)$/;
const ORDERED_LIST_PATTERN = /^(\d+)\. (.*)$/;

export function parseComposerMarkdown(text: string): ComposerJSON {
  const normalized = text.replace(/\r\n/g, "\n");
  if (!normalized) return cloneEmptyDoc();

  const blocks: ComposerJSON[] = [];
  for (const group of groupLines(normalized.split("\n"))) {
    if (group.kind === "paragraph") {
      blocks.push(parseParagraph(group.text));
      continue;
    }
    if (group.kind === "bullet") {
      blocks.push({
        type: "bulletList",
        content: group.items.map(parseListItem),
      });
      continue;
    }
    blocks.push({
      type: "orderedList",
      attrs: { start: group.start },
      content: group.items.map(parseListItem),
    });
  }

  return { type: "doc", content: blocks.length > 0 ? blocks : [{ type: "paragraph" }] };
}

export function serializeComposerMarkdown(doc: ComposerJSON | null | undefined): string {
  const blocks = doc?.content ?? [];
  if (blocks.length === 0) return "";
  return blocks.map(serializeBlock).join("\n");
}

function cloneEmptyDoc(): ComposerJSON {
  return {
    type: EMPTY_COMPOSER_DOC.type,
    content: [{ type: "paragraph" }],
  };
}

function groupLines(lines: string[]): InlineGroup[] {
  const groups: InlineGroup[] = [];

  for (const line of lines) {
    const unordered = UNORDERED_LIST_PATTERN.exec(line);
    if (unordered) {
      const last = groups[groups.length - 1];
      if (last?.kind === "bullet") last.items.push(unordered[1]);
      else groups.push({ kind: "bullet", items: [unordered[1]] });
      continue;
    }

    const ordered = ORDERED_LIST_PATTERN.exec(line);
    if (ordered) {
      const index = Number(ordered[1]);
      const last = groups[groups.length - 1];
      if (last?.kind === "ordered" && last.start + last.items.length === index) {
        last.items.push(ordered[2]);
      } else {
        groups.push({ kind: "ordered", start: index, items: [ordered[2]] });
      }
      continue;
    }

    groups.push({ kind: "paragraph", text: line });
  }

  return groups;
}

function parseParagraph(text: string): ComposerJSON {
  const content = parseInlines(text);
  return content.length > 0 ? { type: "paragraph", content } : { type: "paragraph" };
}

function parseListItem(text: string): ComposerJSON {
  return {
    type: "listItem",
    content: [parseParagraph(text)],
  };
}

function parseInlines(text: string): ComposerJSON[] {
  const nodes: ComposerJSON[] = [];
  let index = 0;

  while (index < text.length) {
    if (text[index] === "`") {
      const end = text.indexOf("`", index + 1);
      if (end > index + 1) {
        nodes.push(textNode(text.slice(index + 1, end), [{ type: "code" }]));
        index = end + 1;
        continue;
      }
    }

    if (text.startsWith("**", index)) {
      const end = text.indexOf("**", index + 2);
      if (end > index + 2) {
        for (const node of parseInlines(text.slice(index + 2, end))) {
          nodes.push(applyBold(node));
        }
        index = end + 2;
        continue;
      }
    }

    let next = index + 1;
    while (next < text.length) {
      if (text[next] === "`") break;
      if (text.startsWith("**", next)) break;
      next += 1;
    }
    nodes.push(textNode(text.slice(index, next)));
    index = next;
  }

  return nodes;
}

function applyBold(node: ComposerJSON): ComposerJSON {
  if (node.type !== "text") return node;
  if (node.marks?.some((mark) => mark.type === "code")) return node;
  const marks = [...(node.marks ?? []), { type: "bold" }];
  return textNode(node.text ?? "", marks);
}

function textNode(text: string, marks?: ComposerMark[]): ComposerJSON {
  return marks && marks.length > 0 ? { type: "text", text, marks } : { type: "text", text };
}

function serializeBlock(node: ComposerJSON): string {
  if (node.type === "paragraph") return serializeInlines(node.content);
  if (node.type === "bulletList") {
    return (node.content ?? []).map((item) => `- ${serializeListItem(item)}`).join("\n");
  }
  if (node.type === "orderedList") {
    const start = toStartIndex(node.attrs?.start);
    return (node.content ?? [])
      .map((item, index) => `${start + index}. ${serializeListItem(item)}`)
      .join("\n");
  }
  if (node.type === "listItem") return serializeListItem(node);
  if (node.content) return node.content.map(serializeBlock).join("\n");
  return node.text ?? "";
}

function serializeListItem(node: ComposerJSON): string {
  const blocks = node.content ?? [];
  if (blocks.length === 0) return "";
  return blocks.map((block) => serializeInlines(block.content)).join(" ");
}

function serializeInlines(nodes: ComposerJSON[] | undefined): string {
  if (!nodes || nodes.length === 0) return "";
  let output = "";
  let index = 0;
  while (index < nodes.length) {
    const node = nodes[index];
    if (node.type === "hardBreak") {
      output += "\n";
      index += 1;
      continue;
    }
    if (node.type !== "text") {
      output += serializeBlock(node);
      index += 1;
      continue;
    }

    if (hasMark(node, "code") && !hasMark(node, "bold")) {
      output += wrapCode(
        collectMarkedRun(nodes, index, (item) => hasMark(item, "code") && !hasMark(item, "bold")),
      );
      index = skipMarkedRun(
        nodes,
        index,
        (item) => hasMark(item, "code") && !hasMark(item, "bold"),
      );
      continue;
    }

    if (hasMark(node, "bold") || (hasMark(node, "code") && hasMark(node, "bold"))) {
      const end = skipBoldRun(nodes, index);
      output += `**${serializeBoldRun(nodes.slice(index, end))}**`;
      index = end;
      continue;
    }

    output += node.text ?? "";
    index += 1;
  }
  return output;
}

function serializeBoldRun(nodes: ComposerJSON[]): string {
  let output = "";
  for (const node of nodes) {
    if (node.type === "hardBreak") {
      output += "\n";
      continue;
    }
    if (hasMark(node, "code")) {
      output += wrapCode(node.text ?? "");
      continue;
    }
    output += node.text ?? "";
  }
  return output;
}

function collectMarkedRun(
  nodes: ComposerJSON[],
  start: number,
  matches: (node: ComposerJSON) => boolean,
): string {
  let text = "";
  for (let index = start; index < nodes.length; index += 1) {
    if (nodes[index].type !== "text" || !matches(nodes[index])) break;
    text += nodes[index].text ?? "";
  }
  return text;
}

function skipMarkedRun(
  nodes: ComposerJSON[],
  start: number,
  matches: (node: ComposerJSON) => boolean,
): number {
  let index = start;
  while (index < nodes.length && nodes[index].type === "text" && matches(nodes[index])) {
    index += 1;
  }
  return index;
}

function skipBoldRun(nodes: ComposerJSON[], start: number): number {
  let index = start;
  while (index < nodes.length) {
    const node = nodes[index];
    if (node.type === "hardBreak") {
      index += 1;
      continue;
    }
    if (node.type !== "text") break;
    if (hasMark(node, "bold") || hasMark(node, "code")) {
      index += 1;
      continue;
    }
    break;
  }
  return index;
}

function wrapCode(text: string): string {
  return text ? `\`${text}\`` : "";
}

function hasMark(node: ComposerJSON, type: string): boolean {
  return Boolean(node.marks?.some((mark) => mark.type === type));
}

function toStartIndex(value: unknown): number {
  const start = typeof value === "number" ? value : Number(value);
  return Number.isFinite(start) && start >= 1 ? Math.floor(start) : 1;
}

export function mapPlainOffsetToPmPos(
  doc: {
    content: { size: number };
    textBetween: (from: number, to: number, blockSeparator: string) => string;
  },
  offset: number,
): number {
  const maxPlain = doc.textBetween(0, doc.content.size, "\n").length;
  const target = Math.max(0, Math.min(offset, maxPlain));
  let low = 0;
  let high = doc.content.size;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (doc.textBetween(0, mid, "\n").length < target) low = mid + 1;
    else high = mid;
  }
  return low;
}
