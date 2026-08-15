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

export function workspaceSearchInstructions(toolNames: Iterable<string>) {
  const requested = new Set(toolNames);
  if (requested.has("search_files")) {
    return "本地源码检索规则：按文件名或关键词查找时优先使用 search_files；pattern 支持 glob，query 会返回命中行并遵循 workspace 的 Git 排除规则。";
  }
  if (requested.has("bash") || requested.has("terminal")) {
    return "本地源码检索规则：当前未启用 search_files，可通过 Bash 使用 rg 搜索文件名或内容；搜索时遵循 .gitignore，并排除 node_modules、.git、dist、target。";
  }
  return "";
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
