export type ExplorerFileIconKind =
  | "folder"
  | "folder-open"
  | "files"
  | "git"
  | "code-ts"
  | "code-js"
  | "code"
  | "json"
  | "style"
  | "markup"
  | "doc"
  | "image"
  | "file";

const EXTENSION_KINDS: Record<string, ExplorerFileIconKind> = {
  ts: "code-ts",
  tsx: "code-ts",
  mts: "code-ts",
  cts: "code-ts",
  js: "code-js",
  jsx: "code-js",
  mjs: "code-js",
  cjs: "code-js",
  rs: "code",
  py: "code",
  go: "code",
  java: "code",
  rb: "code",
  php: "code",
  swift: "code",
  kt: "code",
  kts: "code",
  c: "code",
  h: "code",
  cpp: "code",
  cc: "code",
  json: "json",
  jsonc: "json",
  json5: "json",
  yml: "json",
  yaml: "json",
  toml: "json",
  css: "style",
  scss: "style",
  sass: "style",
  less: "style",
  html: "markup",
  htm: "markup",
  xml: "markup",
  svg: "markup",
  vue: "markup",
  svelte: "markup",
  md: "doc",
  mdx: "doc",
  txt: "doc",
  rst: "doc",
  png: "image",
  jpg: "image",
  jpeg: "image",
  gif: "image",
  webp: "image",
  ico: "image",
  bmp: "image",
  avif: "image",
};

const BASENAME_KINDS: Record<string, ExplorerFileIconKind> = {
  dockerfile: "code",
  makefile: "code",
};

export function explorerFileIconKind(
  path: string,
  options?: { entryKind?: "file" | "dir"; expanded?: boolean },
): ExplorerFileIconKind {
  if (options?.entryKind === "dir") {
    return options.expanded ? "folder-open" : "folder";
  }

  const name = path.replace(/\\/g, "/").split("/").pop()?.toLowerCase() ?? "";
  if (!name) return "file";
  if (BASENAME_KINDS[name]) return BASENAME_KINDS[name];

  const dot = name.lastIndexOf(".");
  if (dot <= 0) return "file";
  return EXTENSION_KINDS[name.slice(dot + 1)] ?? "file";
}
