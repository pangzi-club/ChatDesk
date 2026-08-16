import { DEFAULT_WORKSPACE_ID } from "@chatdesk/shared";

export function normalizeWorkspacePath(value: string) {
  const normalized = value.trim().replace(/\\/g, "/").replace(/\/+$/, "");
  return normalized || "/";
}

export function isDefaultWorkspaceId(value: string | null | undefined) {
  return !value?.trim() || value.trim() === DEFAULT_WORKSPACE_ID;
}

export function joinTaskCwd(tasksRoot: string, sessionId: string) {
  return `${normalizeWorkspacePath(tasksRoot)}/${sessionId}`;
}
