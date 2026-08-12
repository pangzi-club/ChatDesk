import { describe, expect, it } from "vitest";
import type { ChatIndexItem } from "./chat-store";
import {
  getWorkspaceSessionKey,
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
});
