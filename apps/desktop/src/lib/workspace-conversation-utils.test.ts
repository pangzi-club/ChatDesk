import { describe, expect, it } from "vitest";
import type { ChatIndexItem } from "./chat-store";
import {
  adjacentConversationId,
  clusterConversations,
  filterSidebarConversations,
  flattenConversationClusters,
  getWorkspaceSessionKey,
  groupConversationClustersByLocalDate,
  groupConversationsByLocalDate,
  listNavigableConversationIds,
  resolveWorkspaceConversationLabel,
  sortConversationClustersByUpdatedAt,
  sortConversationsByCreatedAt,
  sortWorkspaceConversationGroups,
  sortWorkspaceProjects,
} from "./workspace-conversation-utils";
import type { WorkspaceProject } from "./workspaces";

const projects: WorkspaceProject[] = [
  { id: "alpha", path: "/work/alpha", createdAt: "2026-01-01T00:00:00.000Z" },
  { id: "beta", path: "/work/beta", createdAt: "2026-01-02T00:00:00.000Z" },
];

function session(
  id: string,
  values: Pick<ChatIndexItem, "workspaceId" | "cwd" | "updatedAt">,
): ChatIndexItem {
  return {
    id,
    title: id,
    createdAt: values.updatedAt,
    messageCount: 1,
    attachmentCount: 0,
    ...values,
  };
}

describe("workspace conversation utilities", () => {
  it("hides Feishu and automation conversations from the sidebar by default", () => {
    const visible = filterSidebarConversations([
      session("local", { updatedAt: "2026-01-01" }),
      { ...session("feishu", { updatedAt: "2026-01-02" }), source: "feishu" },
      {
        ...session("automation", { updatedAt: "2026-01-03" }),
        source: "automation",
      },
    ]);

    expect(visible.map((item) => item.id)).toEqual(["local"]);
  });

  it("shows every conversation when all tasks are enabled", () => {
    const visible = filterSidebarConversations(
      [
        session("local", { updatedAt: "2026-01-01" }),
        { ...session("feishu", { updatedAt: "2026-01-02" }), source: "feishu" },
        {
          ...session("automation", { updatedAt: "2026-01-03" }),
          source: "automation",
        },
      ],
      true,
    );

    expect(visible.map((item) => item.id)).toEqual(["local", "feishu", "automation"]);
  });

  it("uses a registered cwd when a legacy session has no workspace id", () => {
    expect(
      getWorkspaceSessionKey(
        session("legacy", { cwd: "/work/alpha", updatedAt: "2026-01-03" }),
        projects,
      ),
    ).toBe("alpha");
  });

  it("matches sessions to a workspace by path even when workspace ids differ", () => {
    expect(
      getWorkspaceSessionKey(
        session("legacy", {
          workspaceId: "old-id",
          cwd: "/work/alpha/",
          updatedAt: "2026-01-03",
        }),
        projects,
      ),
    ).toBe("alpha");
  });

  it("sorts workspaces by all conversations, including cwd-only sessions", () => {
    const sorted = sortWorkspaceProjects(
      projects,
      [
        session("legacy-1", { cwd: "/work/alpha", updatedAt: "2026-01-01" }),
        session("legacy-2", { cwd: "/work/alpha", updatedAt: "2026-01-02" }),
        session("beta-1", { workspaceId: "beta", cwd: "/work/beta", updatedAt: "2026-01-03" }),
      ],
      "count",
    );
    expect(sorted.map((project) => project.id)).toEqual(["alpha", "beta"]);
  });

  it("groups default workspace sessions under the default key", () => {
    const defaultProject: WorkspaceProject = {
      id: "default",
      path: "/Users/demo/.chatdesk/tasks",
      createdAt: "2026-01-01T00:00:00.000Z",
    };
    expect(
      getWorkspaceSessionKey(
        session("task", {
          workspaceId: "default",
          cwd: "/Users/demo/.chatdesk/tasks/task",
          updatedAt: "2026-01-03",
        }),
        [...projects, defaultProject],
      ),
    ).toBe("default");
  });

  it("sorts the default group with workspaces by conversation count", () => {
    const sorted = sortWorkspaceConversationGroups(
      [
        { label: "Default", sessions: [] },
        { label: "project", sessions: [{ id: "one" }, { id: "two" }] },
      ],
      "count",
    );

    expect(sorted.map((group) => group.label)).toEqual(["project", "Default"]);
  });

  it("sorts conversations by creation time with deterministic tie-breakers", () => {
    const sessions = [
      session("older", { updatedAt: "2026-08-21T12:00:00.000Z" }),
      {
        ...session("newer", { updatedAt: "2026-08-19T12:00:00.000Z" }),
        createdAt: "2026-08-20T00:00:00.000Z",
      },
      {
        ...session("same-created-b", { updatedAt: "2026-08-21T13:00:00.000Z" }),
        createdAt: "2026-08-19T00:00:00.000Z",
      },
      {
        ...session("same-created-a", { updatedAt: "2026-08-21T13:00:00.000Z" }),
        createdAt: "2026-08-19T00:00:00.000Z",
      },
    ];

    expect(sortConversationsByCreatedAt(sessions).map((item) => item.id)).toEqual([
      "older",
      "newer",
      "same-created-a",
      "same-created-b",
    ]);
  });

  it("resolves workspace labels from projects, cwd, ids, and Task", () => {
    expect(
      resolveWorkspaceConversationLabel(
        session("project", { workspaceId: "alpha", cwd: "/work/alpha", updatedAt: "2026-01-01" }),
        projects,
      ),
    ).toBe("alpha");
    expect(
      resolveWorkspaceConversationLabel(
        session("cwd", { cwd: "/work/legacy", updatedAt: "2026-01-01" }),
        projects,
      ),
    ).toBe("legacy");
    expect(
      resolveWorkspaceConversationLabel(
        session("id", { workspaceId: "Codex", updatedAt: "2026-01-01" }),
        projects,
      ),
    ).toBe("Codex");
    expect(
      resolveWorkspaceConversationLabel(
        session("task", { workspaceId: "default", cwd: "/work/task", updatedAt: "2026-01-01" }),
        projects,
      ),
    ).toBe("Task");
  });

  it("groups conversations by local calendar labels", () => {
    const now = new Date(2026, 7, 21, 15, 0, 0);
    const sessions = [
      {
        ...session("today", { updatedAt: "2026-08-21T00:00:00.000Z" }),
        createdAt: "2026-08-21T09:00:00.000Z",
      },
      {
        ...session("yesterday", { updatedAt: "2026-08-20T00:00:00.000Z" }),
        createdAt: "2026-08-20T09:00:00.000Z",
      },
      {
        ...session("weekday", { updatedAt: "2026-08-18T00:00:00.000Z" }),
        createdAt: "2026-08-18T09:00:00.000Z",
      },
      {
        ...session("older", { updatedAt: "2025-08-18T00:00:00.000Z" }),
        createdAt: "2025-08-18T09:00:00.000Z",
      },
    ];

    expect(groupConversationsByLocalDate(sessions, now).map((group) => group.label)).toEqual([
      "今天",
      "昨天",
      "星期二",
      "2025年8月18日",
    ]);
  });

  it("nests task sessions under the parent that is still in the list", () => {
    const parent = {
      ...session("parent", {
        workspaceId: "alpha",
        cwd: "/work/alpha",
        updatedAt: "2026-08-21T12:00:00.000Z",
      }),
      createdAt: "2026-08-21T10:00:00.000Z",
    };
    const olderChild = {
      ...session("task-a", {
        workspaceId: "alpha",
        cwd: "/work/alpha",
        updatedAt: "2026-08-21T11:00:00.000Z",
      }),
      createdAt: "2026-08-21T10:30:00.000Z",
      kind: "task" as const,
      parentSessionId: "parent",
    };
    const newerChild = {
      ...session("task-b", {
        workspaceId: "alpha",
        cwd: "/work/alpha",
        updatedAt: "2026-08-22T09:00:00.000Z",
      }),
      createdAt: "2026-08-21T10:45:00.000Z",
      kind: "task" as const,
      parentSessionId: "parent",
    };
    const orphan = {
      ...session("orphan", {
        workspaceId: "alpha",
        cwd: "/work/alpha",
        updatedAt: "2026-08-21T13:00:00.000Z",
      }),
      createdAt: "2026-08-21T13:00:00.000Z",
      kind: "task" as const,
      parentSessionId: "missing-parent",
    };
    const other = session("other", {
      workspaceId: "alpha",
      cwd: "/work/alpha",
      updatedAt: "2026-08-20T12:00:00.000Z",
    });

    const items = flattenConversationClusters(
      sortConversationClustersByUpdatedAt(
        clusterConversations([newerChild, orphan, other, parent, olderChild]),
      ),
    );

    expect(items.map((item) => [item.session.id, item.nested])).toEqual([
      ["parent", false],
      ["task-a", true],
      ["task-b", true],
      ["orphan", false],
      ["other", false],
    ]);
  });

  it("keeps nested tasks with the parent date group", () => {
    const now = new Date(2026, 7, 21, 15, 0, 0);
    const parent = {
      ...session("parent", { updatedAt: "2026-08-21T12:00:00.000Z" }),
      createdAt: "2026-08-21T09:00:00.000Z",
    };
    const child = {
      ...session("task", { updatedAt: "2026-08-20T12:00:00.000Z" }),
      createdAt: "2026-08-20T09:00:00.000Z",
      kind: "task" as const,
      parentSessionId: "parent",
    };
    const groups = groupConversationClustersByLocalDate(clusterConversations([parent, child]), now);

    expect(groups.map((group) => group.label)).toEqual(["今天"]);
    expect(groups[0]?.sessions.map((item) => [item.session.id, item.nested])).toEqual([
      ["parent", false],
      ["task", true],
    ]);
  });

  it("lists navigable conversation ids in sidebar list order, including nested tasks", () => {
    const now = new Date(2026, 7, 21, 15, 0, 0);
    const parent = {
      ...session("parent", { updatedAt: "2026-08-21T12:00:00.000Z" }),
      createdAt: "2026-08-21T09:00:00.000Z",
    };
    const child = {
      ...session("task", { updatedAt: "2026-08-20T12:00:00.000Z" }),
      createdAt: "2026-08-20T09:00:00.000Z",
      kind: "task" as const,
      parentSessionId: "parent",
    };
    const older = {
      ...session("older", { updatedAt: "2026-08-20T12:00:00.000Z" }),
      createdAt: "2026-08-20T08:00:00.000Z",
    };

    expect(listNavigableConversationIds([older, child, parent], now)).toEqual([
      "parent",
      "task",
      "older",
    ]);
  });

  it("resolves adjacent conversations, wrapping and falling back to the first item", () => {
    const ids = ["a", "b", "c"];
    expect(adjacentConversationId(ids, "b", "previous")).toBe("a");
    expect(adjacentConversationId(ids, "b", "next")).toBe("c");
    expect(adjacentConversationId(ids, "a", "previous")).toBe("c");
    expect(adjacentConversationId(ids, "c", "next")).toBe("a");
    expect(adjacentConversationId(ids, null, "previous")).toBe("a");
    expect(adjacentConversationId(ids, "missing", "next")).toBe("a");
    expect(adjacentConversationId([], "a", "next")).toBeNull();
  });
});
