export type WorkspaceToolFileTarget = {
  path: string;
  content?: string;
};

function getStringProperty(value: unknown, key: string) {
  if (!value || typeof value !== "object") return "";
  const property = (value as Record<string, unknown>)[key];
  return typeof property === "string" ? property : "";
}

export function getLastPathSegment(value: string) {
  const normalized = value.replace(/[\\/]+$/, "");
  const segments = normalized.split(/[\\/]/);
  return segments[segments.length - 1] || normalized;
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

export function extractWorkspaceToolSummary(toolName: string, input: unknown, output: unknown) {
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
  const subject =
    toolName === "search_files"
      ? searchKeyword
      : fileTarget
        ? fileTarget.path
        : toolName === "read_file"
          ? getLastPathSegment(inputPath || outputPath)
          : inputPath ||
            (toolName === "bash" && typeof inputRecord.command === "string"
              ? inputRecord.command
              : "");
  const compact = subject.replace(/\s+/g, " ").trim();
  const details = compact ? ` · ${compact}` : "";
  const code =
    toolName === "bash" && typeof outputRecord.code === "number"
      ? ` · exit ${outputRecord.code}`
      : "";
  const truncated = outputRecord.truncated === true ? " · 已截断" : "";
  return `${details}${code}${truncated}`;
}
