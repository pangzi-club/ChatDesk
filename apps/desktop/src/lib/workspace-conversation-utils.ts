import type { ChatIndexItem } from "@/lib/chat-store";
import type { WorkspaceProject } from "@/lib/workspaces";

export type WorkspaceSort = "name" | "updated" | "count";

export function getWorkspaceSessionKey(
  session: Pick<ChatIndexItem, "workspaceId" | "cwd">,
  projects: WorkspaceProject[],
) {
  if (session.workspaceId) return session.workspaceId;
  if (!session.cwd) return undefined;
  return projects.find((project) => project.path === session.cwd)?.id ?? `cwd:${session.cwd}`;
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

function pathBasename(path: string) {
  return (
    path
      .replace(/[\\/]+$/, "")
      .split(/[\\/]/)
      .pop() ?? path
  );
}
