export const WORKSPACE_TOOL_NAMES = [
  "list_dir",
  "search_files",
  "read_file",
  "write_file",
  "edit_file",
  "bash",
] as const;

export function hasWorkspace(cwd: string | undefined): cwd is string {
  return Boolean(cwd?.trim());
}

export function selectWorkspaceToolNames(toolNames: Iterable<string>): string[] {
  const requested = new Set(toolNames);
  return WORKSPACE_TOOL_NAMES.filter(
    (name) => requested.has(name) || (name === "bash" && requested.has("terminal")),
  );
}

export function selectPlanWorkspaceToolNames(toolNames: Iterable<string>): string[] {
  const requested = new Set(toolNames);
  return ["list_dir", "search_files", "read_file"].filter((name) => requested.has(name));
}
