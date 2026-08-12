import type { ChatIndexItem } from "@/lib/chat-store";
import { normalizeWorkspacePath } from "./workspace-path";
import type { WorkspaceProject } from "./workspaces";

export type WorkspaceSort = "name" | "updated" | "count";

export type WorkspaceConversationGroup<T = unknown> = {
  label: string;
  sessions: T[];
};

export function getWorkspaceSessionKey(
  session: Pick<ChatIndexItem, "workspaceId" | "cwd">,
  projects: WorkspaceProject[],
) {
  if (session.cwd) {
    const normalizedCwd = normalizeWorkspacePath(session.cwd);
    const project = projects.find(
      (candidate) => normalizeWorkspacePath(candidate.path) === normalizedCwd,
    );
    if (project) return project.id;
    if (session.workspaceId && projects.some((candidate) => candidate.id === session.workspaceId)) {
      return session.workspaceId;
    }
    return `cwd:${normalizedCwd}`;
  }
  return session.workspaceId || undefined;
}

export function sortWorkspaceProjects(
  projects: WorkspaceProject[],
  sessions: ChatIndexItem[],
  sort: WorkspaceSort,
) {
  const sessionCountByWorkspace = new Map<string, number>();
  const latestSessionByWorkspace = new Map<string, string>();
  for (const session of sessions) {
    const workspaceKey = getWorkspaceSessionKey(session, projects);
    if (!workspaceKey) continue;
    sessionCountByWorkspace.set(workspaceKey, (sessionCountByWorkspace.get(workspaceKey) ?? 0) + 1);
    const current = latestSessionByWorkspace.get(workspaceKey);
    if (!current || session.updatedAt > current) {
      latestSessionByWorkspace.set(workspaceKey, session.updatedAt);
    }
  }

  return [...projects].sort((a, b) => {
    if (sort === "name") {
      return pathBasename(a.path).localeCompare(pathBasename(b.path), undefined, {
        sensitivity: "base",
      });
    }
    if (sort === "count") {
      const countDifference =
        (sessionCountByWorkspace.get(b.id) ?? 0) - (sessionCountByWorkspace.get(a.id) ?? 0);
      if (countDifference !== 0) return countDifference;
      return pathBasename(a.path).localeCompare(pathBasename(b.path), undefined, {
        sensitivity: "base",
      });
    }
    const aUpdated = latestSessionByWorkspace.get(a.id) ?? a.createdAt;
    const bUpdated = latestSessionByWorkspace.get(b.id) ?? b.createdAt;
    return bUpdated.localeCompare(aUpdated);
  });
}

export function sortWorkspaceConversationGroups<T extends WorkspaceConversationGroup<unknown>>(
  groups: T[],
  sort: WorkspaceSort,
) {
  if (sort !== "count") return groups;

  return [...groups].sort((left, right) => {
    const countDifference = right.sessions.length - left.sessions.length;
    if (countDifference !== 0) return countDifference;
    return left.label.localeCompare(right.label, undefined, { sensitivity: "base" });
  });
}

function pathBasename(path: string) {
  return (
    path
      .replace(/[\\/]+$/, "")
      .split(/[\\/]/)
      .pop() ?? path
  );
}
