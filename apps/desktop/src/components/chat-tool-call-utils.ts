export type WorkspaceToolFileTarget = {
  path: string;
  content?: string;
};

export type ToolCallField = {
  kind: "code" | "meta";
  label: string;
  text: string;
  tone?: "command" | "output";
};

export const TOOL_SUMMARY_MAX_CHARS = 72;
export const TOOL_TITLE_MAX_CHARS = 400;
export const TOOL_BODY_PREVIEW_CHARS = 2_000;
export const TOOL_BODY_PREVIEW_LINES = 40;

function getStringProperty(value: unknown, key: string) {
  if (!value || typeof value !== "object") return "";
  const property = (value as Record<string, unknown>)[key];
  return typeof property === "string" ? property : "";
}

function getNumberProperty(value: unknown, key: string) {
  if (!value || typeof value !== "object") return undefined;
  const property = (value as Record<string, unknown>)[key];
  return typeof property === "number" && Number.isFinite(property) ? property : undefined;
}

export function getLastPathSegment(value: string) {
  const normalized = value.replace(/[\\/]+$/, "");
  const segments = normalized.split(/[\\/]/);
  return segments[segments.length - 1] || normalized;
}

export function compactToolText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

export function truncateToolText(value: string, maxChars = TOOL_SUMMARY_MAX_CHARS) {
  const compact = compactToolText(value);
  if (!compact || compact.length <= maxChars) return compact;
  return `${compact.slice(0, Math.max(1, maxChars - 1)).trimEnd()}…`;
}

export function headlineToolText(value: string, maxChars = TOOL_SUMMARY_MAX_CHARS) {
  const firstLine = value.split(/\r?\n/, 1)[0] ?? "";
  return truncateToolText(firstLine, maxChars);
}

export function previewToolText(
  value: string,
  maxChars = TOOL_BODY_PREVIEW_CHARS,
  maxLines = TOOL_BODY_PREVIEW_LINES,
) {
  const lines = value.split(/\r?\n/);
  if (value.length <= maxChars && lines.length <= maxLines) {
    return { text: value, truncated: false as const };
  }

  let text = lines.length > maxLines ? lines.slice(0, maxLines).join("\n") : value;
  if (text.length > maxChars) text = text.slice(0, maxChars);
  return { text: `${text.replace(/\s+$/g, "")}\n…`, truncated: true as const };
}

export function resolveWorkspaceToolFileTarget(
  toolName: string,
  input: unknown,
  output: unknown,
): WorkspaceToolFileTarget | null {
  if (toolName !== "read_file" && toolName !== "write_file" && toolName !== "edit_file") {
    return null;
  }

  const outputPath = getStringProperty(output, "path");
  const inputPath = getStringProperty(input, "path");
  const path = outputPath || inputPath;
  if (!path) return null;

  const content = toolName === "read_file" ? getStringProperty(output, "content") : "";
  return {
    path,
    ...(content ? { content } : {}),
  };
}

function extractWorkspaceToolSubject(toolName: string, input: unknown, output: unknown) {
  const inputRecord = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  const outputRecord =
    output && typeof output === "object" ? (output as Record<string, unknown>) : {};
  const inputPath = typeof inputRecord.path === "string" ? inputRecord.path : "";
  const outputPath = typeof outputRecord.path === "string" ? outputRecord.path : "";
  const fileTarget = resolveWorkspaceToolFileTarget(toolName, input, output);
  const searchKeyword =
    typeof inputRecord.query === "string" && inputRecord.query.trim()
      ? inputRecord.query
      : typeof outputRecord.query === "string" && outputRecord.query.trim()
        ? outputRecord.query
        : typeof inputRecord.pattern === "string"
          ? inputRecord.pattern
          : "";

  if (toolName === "search_files") return searchKeyword;
  if (toolName === "bash") {
    return typeof inputRecord.command === "string" ? inputRecord.command : "";
  }
  if (
    toolName === "list_dir" ||
    toolName === "read_file" ||
    toolName === "write_file" ||
    toolName === "edit_file"
  ) {
    return getLastPathSegment(fileTarget?.path || inputPath || outputPath);
  }
  return fileTarget?.path || inputPath;
}

export function extractWorkspaceToolSummary(toolName: string, input: unknown, output: unknown) {
  const subject = extractWorkspaceToolSubject(toolName, input, output);
  const compact =
    toolName === "bash" || toolName === "search_files"
      ? headlineToolText(subject)
      : truncateToolText(subject);
  return compact ? ` · ${compact}` : "";
}

export function extractWorkspaceToolTitle(toolName: string, input: unknown, output: unknown) {
  const subject = extractWorkspaceToolSubject(toolName, input, output);
  return truncateToolText(compactToolText(subject), TOOL_TITLE_MAX_CHARS);
}

export function extractBrowserToolDetail(toolName: string, input: unknown) {
  if (toolName === "browser_open") return headlineToolText(getStringProperty(input, "url"));
  if (toolName === "browser_click") return headlineToolText(getStringProperty(input, "selector"));
  if (toolName === "browser_eval") return headlineToolText(getStringProperty(input, "expression"));
  return "";
}

export function extractBrowserToolTitle(toolName: string, input: unknown) {
  if (toolName === "browser_open") return getStringProperty(input, "url");
  if (toolName === "browser_click") return getStringProperty(input, "selector");
  if (toolName === "browser_eval") {
    return truncateToolText(
      compactToolText(getStringProperty(input, "expression")),
      TOOL_TITLE_MAX_CHARS,
    );
  }
  return "";
}

function pushMetaField(fields: ToolCallField[], label: string, text: string) {
  if (!text.trim()) return;
  fields.push({ kind: "meta", label, text });
}

function pushCodeField(
  fields: ToolCallField[],
  label: string,
  text: string | undefined,
  tone?: ToolCallField["tone"],
) {
  if (typeof text !== "string") return;
  fields.push({ kind: "code", label, text, ...(tone ? { tone } : {}) });
}

export function getToolCallInputFields(toolName: string, input: unknown): ToolCallField[] | null {
  if (!input || typeof input !== "object") return null;

  if (toolName === "bash") {
    const command = getStringProperty(input, "command");
    if (!command) return null;
    const fields: ToolCallField[] = [];
    pushMetaField(fields, "目录", getStringProperty(input, "cwd"));
    pushCodeField(fields, "命令", command, "command");
    return fields;
  }

  if (toolName === "write_file") {
    const path = getStringProperty(input, "path");
    const content = getStringProperty(input, "content");
    if (!path && !content) return null;
    const fields: ToolCallField[] = [];
    pushMetaField(fields, "路径", path);
    pushCodeField(fields, "内容", content);
    return fields;
  }

  if (toolName === "edit_file") {
    const path = getStringProperty(input, "path");
    const oldText = getStringProperty(input, "oldText");
    const newText = getStringProperty(input, "newText");
    if (!path && !oldText && !newText) return null;
    const fields: ToolCallField[] = [];
    pushMetaField(fields, "路径", path);
    pushCodeField(fields, "原文", oldText);
    pushCodeField(fields, "替换为", newText);
    return fields;
  }

  if (toolName === "browser_eval") {
    const expression = getStringProperty(input, "expression");
    if (!expression) return null;
    const fields: ToolCallField[] = [];
    pushMetaField(fields, "会话", getStringProperty(input, "sessionId"));
    pushCodeField(fields, "脚本", expression);
    return fields;
  }

  if (toolName === "image_generation") {
    const prompt = getStringProperty(input, "prompt");
    if (!prompt) return null;
    const fields: ToolCallField[] = [];
    pushCodeField(fields, "描述", prompt);
    pushMetaField(fields, "比例", getStringProperty(input, "aspect_ratio"));
    pushMetaField(fields, "分辨率", getStringProperty(input, "resolution"));
    return fields;
  }

  return null;
}

export function getToolCallOutputFields(toolName: string, output: unknown): ToolCallField[] | null {
  if (!output || typeof output !== "object") return null;

  if (toolName === "bash") {
    const out = getStringProperty(output, "out");
    const code = getNumberProperty(output, "code");
    if (!out && code === undefined) return null;
    const fields: ToolCallField[] = [];
    if (code !== undefined) pushMetaField(fields, "退出码", String(code));
    pushCodeField(fields, "输出", out || "(无输出)", "output");
    return fields;
  }

  return null;
}

export function formatToolJson(value: unknown) {
  if (value === undefined) return "—";
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}
