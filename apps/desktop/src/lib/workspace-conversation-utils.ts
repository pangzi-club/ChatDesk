import { DEFAULT_WORKSPACE_ID } from "@chatdesk/shared";
import type { ChatIndexItem } from "@/lib/chat-store";
import { normalizeWorkspacePath } from "./workspace-path";
import type { WorkspaceProject } from "./workspaces";

export type WorkspaceSort = "name" | "updated" | "count";
export type SidebarConversationView = "workspace" | "list";

export type WorkspaceConversationGroup<T = unknown> = {
  label: string;
  sessions: T[];
};

export type ConversationDateGroup<T = unknown> = {
  key: string;
  label: string;
  sessions: T[];
};

export function sortConversationsByCreatedAt<
  T extends Pick<ChatIndexItem, "createdAt" | "updatedAt" | "id">,
>(sessions: T[]) {
  return [...sessions].sort((left, right) => {
    const createdDifference = right.createdAt.localeCompare(left.createdAt);
    if (createdDifference !== 0) return createdDifference;
    const updatedDifference = right.updatedAt.localeCompare(left.updatedAt);
    if (updatedDifference !== 0) return updatedDifference;
    return left.id.localeCompare(right.id);
  });
}

export function resolveWorkspaceConversationLabel(
  session: Pick<ChatIndexItem, "workspaceId" | "cwd">,
  projects: WorkspaceProject[],
  fallback = "Task",
) {
  if (session.workspaceId === DEFAULT_WORKSPACE_ID) return fallback;
  const workspaceKey = getWorkspaceSessionKey(session, projects);
  if (!workspaceKey || workspaceKey === DEFAULT_WORKSPACE_ID) return fallback;

  const project = projects.find((candidate) => candidate.id === workspaceKey);
  if (project) return pathBasename(project.path);
  if (session.cwd?.trim()) return pathBasename(session.cwd);
  return session.workspaceId?.trim() || fallback;
}

export function groupConversationsByLocalDate<T extends Pick<ChatIndexItem, "createdAt">>(
  sessions: T[],
  now = new Date(),
): ConversationDateGroup<T>[] {
  const groups = new Map<string, ConversationDateGroup<T>>();
  for (const session of sessions) {
    const date = new Date(session.createdAt);
    const key = Number.isNaN(date.getTime()) ? "unknown" : localDateKey(date);
    const group = groups.get(key);
    if (group) {
      group.sessions.push(session);
      continue;
    }
    groups.set(key, {
      key,
      label: formatConversationDateGroupLabel(date, now),
      sessions: [session],
    });
  }
  return [...groups.values()];
}

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

function localDateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function startOfLocalDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

function formatConversationDateGroupLabel(date: Date, now: Date) {
  if (Number.isNaN(date.getTime())) return "未知时间";
  const dayDifference = Math.floor(
    (startOfLocalDay(now) - startOfLocalDay(date)) / (24 * 60 * 60 * 1000),
  );
  if (dayDifference === 0) return "今天";
  if (dayDifference === 1) return "昨天";
  if (dayDifference >= 2 && dayDifference < 7) {
    return ["星期日", "星期一", "星期二", "星期三", "星期四", "星期五", "星期六"][date.getDay()];
  }
  if (date.getFullYear() === now.getFullYear()) {
    return `${date.getMonth() + 1}月${date.getDate()}日`;
  }
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
}
