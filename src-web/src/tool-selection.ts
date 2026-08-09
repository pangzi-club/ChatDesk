export const WORKSPACE_TOOL_NAMES = [
  "list_dir",
  "search_files",
  "read_file",
  "write_file",
  "edit_file",
  "bash",
] as const;

export function selectWorkspaceToolNames(toolNames: Iterable<string>): string[] {
  const requested = new Set(toolNames);
  return WORKSPACE_TOOL_NAMES.filter(
    (name) => requested.has(name) || (name === "bash" && requested.has("terminal")),
  );
}
