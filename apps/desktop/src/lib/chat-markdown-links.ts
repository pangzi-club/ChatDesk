import { findLocalBrowserPreviewLinks } from "@/lib/browser-preview";

type MarkdownNode = {
  children?: MarkdownNode[];
  type: string;
  url?: string;
  value?: string;
};

const LINK_PARENT_TYPES = new Set(["link", "linkReference"]);

export function remarkLocalBrowserLinks() {
  return (tree: MarkdownNode) => transformLocalBrowserLinks(tree);
}

export function transformLocalBrowserLinks(node: MarkdownNode): MarkdownNode {
  if (!node.children || LINK_PARENT_TYPES.has(node.type)) return node;

  const nextChildren: MarkdownNode[] = [];
  for (const child of node.children) {
    if (child.type !== "text" || !child.value) {
      nextChildren.push(transformLocalBrowserLinks(child));
      continue;
    }

    const links = findLocalBrowserPreviewLinks(child.value);
    if (links.length === 0) {
      nextChildren.push(child);
      continue;
    }

    let offset = 0;
    for (const link of links) {
      if (link.start > offset) {
        nextChildren.push({ type: "text", value: child.value.slice(offset, link.start) });
      }
      nextChildren.push({
        type: "link",
        url: link.url,
        children: [{ type: "text", value: link.text }],
      });
      offset = link.end;
    }
    if (offset < child.value.length) {
      nextChildren.push({ type: "text", value: child.value.slice(offset) });
    }
  }

  node.children = nextChildren;
  return node;
}
