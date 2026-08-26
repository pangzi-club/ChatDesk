export const WORKSPACE_TOOL_NAMES = [
  "list_dir",
  "search_files",
  "read_file",
  "write_file",
  "edit_file",
  "apply_patch",
  "bash",
] as const;

export function hasWorkspace(cwd: string | undefined): cwd is string {
  return Boolean(cwd?.trim());
}

export function workspaceSearchInstructions(toolNames: Iterable<string>) {
  const requested = new Set(toolNames);
  if (requested.has("search_files")) {
    return "本地源码检索规则：优先使用 search_files，不要用 Bash 的 find/grep/rg 代替；pattern 用于文件 glob，query 用于内容搜索，include 限制文件类型，regex=true 启用 ripgrep 正则。匹配后用 read_file 获取上下文。";
  }
  if (requested.has("bash") || requested.has("terminal")) {
    return "本地源码检索规则：当前未启用 search_files，可通过 Bash 使用 rg 搜索文件名或内容；搜索时遵循 .gitignore，并排除 node_modules、.git、dist、target。";
  }
  return "";
}

export function selectWorkspaceToolNames(toolNames: Iterable<string>): string[] {
  const requested = new Set(toolNames);
  return WORKSPACE_TOOL_NAMES.filter(
    (name) =>
      requested.has(name) ||
      (name === "apply_patch" && requested.has("edit_file")) ||
      (name === "bash" && requested.has("terminal")),
  );
}

export function selectPlanWorkspaceToolNames(toolNames: Iterable<string>): string[] {
  const requested = new Set(toolNames);
  return ["list_dir", "search_files", "read_file"].filter((name) => requested.has(name));
}
