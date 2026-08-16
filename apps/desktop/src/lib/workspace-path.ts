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

export function defaultTaskCwd(projects: Array<{ id: string; path: string }>, sessionId: string) {
  const root = projects.find((project) => project.id === DEFAULT_WORKSPACE_ID)?.path;
  return root ? joinTaskCwd(root, sessionId) : "";
}

export function resolveDefaultSessionCwd(
  tasksRoot: string | undefined,
  sessionId: string,
  cwd?: string,
) {
  if (!tasksRoot?.trim() || !sessionId.trim()) return cwd?.trim() || "";
  const sessionRoot = joinTaskCwd(tasksRoot, sessionId);
  const requested = cwd?.trim();
  if (!requested) return sessionRoot;
  const normalizedRequested = normalizeWorkspacePath(requested);
  const normalizedRoot = normalizeWorkspacePath(tasksRoot);
  const normalizedSession = normalizeWorkspacePath(sessionRoot);
  if (normalizedRequested === normalizedRoot) return sessionRoot;
  if (
    normalizedRequested === normalizedSession ||
    normalizedRequested.startsWith(`${normalizedSession}/`)
  ) {
    return requested;
  }
  return sessionRoot;
}
