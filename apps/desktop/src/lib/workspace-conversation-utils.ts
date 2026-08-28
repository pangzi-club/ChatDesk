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

export type ConversationCluster<T = ChatIndexItem> = {
  root: T;
  children: T[];
};

export type NestedConversationItem<T = ChatIndexItem> = {
  session: T;
  nested: boolean;
};

export function filterSidebarConversations<T extends Pick<ChatIndexItem, "source">>(sessions: T[]) {
  return sessions.filter((session) => session.source !== "feishu");
}

function conversationTime(value: string | undefined) {
  return typeof value === "string" ? value : "";
}

function compareConversationsByCreatedAt<
  T extends Pick<ChatIndexItem, "createdAt" | "updatedAt" | "id">,
>(left: T, right: T) {
  const createdDifference = conversationTime(right.createdAt).localeCompare(
    conversationTime(left.createdAt),
  );
  if (createdDifference !== 0) return createdDifference;
  const updatedDifference = conversationTime(right.updatedAt).localeCompare(
    conversationTime(left.updatedAt),
  );
  if (updatedDifference !== 0) return updatedDifference;
  return left.id.localeCompare(right.id);
}

export function sortConversationsByCreatedAt<
  T extends Pick<ChatIndexItem, "createdAt" | "updatedAt" | "id">,
>(sessions: T[]) {
  return [...sessions].sort(compareConversationsByCreatedAt);
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

function clusterUpdatedAt<T extends Pick<ChatIndexItem, "updatedAt">>(
  cluster: ConversationCluster<T>,
) {
  let latest = conversationTime(cluster.root.updatedAt);
  for (const child of cluster.children) {
    if (child.updatedAt > latest) latest = child.updatedAt;
  }
  return latest;
}

export function clusterConversations<
  T extends Pick<ChatIndexItem, "id" | "parentSessionId" | "kind" | "createdAt">,
>(sessions: T[]): ConversationCluster<T>[] {
  const byId = new Map(sessions.map((session) => [session.id, session]));
  const childrenByParent = new Map<string, T[]>();

  for (const session of sessions) {
    if (session.kind !== "task") continue;
    const parentId = session.parentSessionId?.trim();
    if (!parentId || parentId === session.id) continue;
    const parent = byId.get(parentId);
    if (!parent || parent.parentSessionId === session.id) continue;
    const siblings = childrenByParent.get(parentId) ?? [];
    siblings.push(session);
    childrenByParent.set(parentId, siblings);
  }

  for (const children of childrenByParent.values()) {
    children.sort((left, right) => {
      const created = conversationTime(left.createdAt).localeCompare(
        conversationTime(right.createdAt),
      );
      if (created !== 0) return created;
      return left.id.localeCompare(right.id);
    });
  }

  const nestedIds = new Set<string>();
  for (const children of childrenByParent.values()) {
    for (const child of children) nestedIds.add(child.id);
  }

  const clusters: ConversationCluster<T>[] = [];
  for (const session of sessions) {
    if (nestedIds.has(session.id)) continue;
    clusters.push({
      root: session,
      children: childrenByParent.get(session.id) ?? [],
    });
  }
  return clusters;
}

export function flattenConversationClusters<T>(
  clusters: ConversationCluster<T>[],
): NestedConversationItem<T>[] {
  const items: NestedConversationItem<T>[] = [];
  for (const cluster of clusters) {
    items.push({ session: cluster.root, nested: false });
    for (const child of cluster.children) {
      items.push({ session: child, nested: true });
    }
  }
  return items;
}

export function sortConversationClustersByCreatedAt<
  T extends Pick<ChatIndexItem, "createdAt" | "updatedAt" | "id">,
>(clusters: ConversationCluster<T>[]) {
  return [...clusters].sort((left, right) =>
    compareConversationsByCreatedAt(left.root, right.root),
  );
}

export function sortConversationClustersByUpdatedAt<
  T extends Pick<ChatIndexItem, "updatedAt" | "id">,
>(clusters: ConversationCluster<T>[]) {
  return [...clusters].sort((left, right) => {
    const updatedDifference = clusterUpdatedAt(right).localeCompare(clusterUpdatedAt(left));
    if (updatedDifference !== 0) return updatedDifference;
    return left.root.id.localeCompare(right.root.id);
  });
}

export function groupConversationClustersByLocalDate<
  T extends Pick<ChatIndexItem, "createdAt" | "id">,
>(
  clusters: ConversationCluster<T>[],
  now = new Date(),
): ConversationDateGroup<NestedConversationItem<T>>[] {
  return groupConversationsByLocalDate(
    clusters.map((cluster) => cluster.root),
    now,
  ).map((group) => {
    const roots = new Set(group.sessions.map((session) => session.id));
    return {
      ...group,
      sessions: flattenConversationClusters(
        clusters.filter((cluster) => roots.has(cluster.root.id)),
      ),
    };
  });
}

export function listNavigableConversationIds<
  T extends Pick<ChatIndexItem, "id" | "parentSessionId" | "kind" | "createdAt" | "updatedAt">,
>(sessions: T[], now = new Date()) {
  return groupConversationClustersByLocalDate(
    sortConversationClustersByCreatedAt(clusterConversations(sessions)),
    now,
  ).flatMap((group) => group.sessions.map((item) => item.session.id));
}

export function adjacentConversationId(
  ids: string[],
  currentId: string | null,
  direction: "previous" | "next",
) {
  if (ids.length === 0) return null;
  const index = currentId ? ids.indexOf(currentId) : -1;
  if (index === -1) return ids[0] ?? null;
  const offset = direction === "previous" ? -1 : 1;
  return ids[(index + offset + ids.length) % ids.length] ?? null;
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
