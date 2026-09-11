import { describe, expect, it } from "vitest";
import { defaultTaskCwd, joinTaskCwd, resolveDefaultSessionCwd } from "./workspace-path";

describe("default session cwd", () => {
  const tasksRoot = "/Users/demo/.chatdesk/tasks";
  const sessionId = "temp-id";

  it("joins the session directory under the default tasks root", () => {
    expect(joinTaskCwd(tasksRoot, sessionId)).toBe("/Users/demo/.chatdesk/tasks/temp-id");
    expect(defaultTaskCwd([{ id: "default", path: tasksRoot }], sessionId)).toBe(
      "/Users/demo/.chatdesk/tasks/temp-id",
    );
  });

  it("uses the session directory instead of the tasks root", () => {
    expect(resolveDefaultSessionCwd(tasksRoot, sessionId)).toBe(
      "/Users/demo/.chatdesk/tasks/temp-id",
    );
    expect(resolveDefaultSessionCwd(tasksRoot, sessionId, tasksRoot)).toBe(
      "/Users/demo/.chatdesk/tasks/temp-id",
    );
    expect(resolveDefaultSessionCwd(tasksRoot, sessionId, `${tasksRoot}/`)).toBe(
      "/Users/demo/.chatdesk/tasks/temp-id",
    );
  });

  it("keeps a nested path inside the session directory", () => {
    expect(resolveDefaultSessionCwd(tasksRoot, sessionId, `${tasksRoot}/${sessionId}/src`)).toBe(
      "/Users/demo/.chatdesk/tasks/temp-id/src",
    );
  });
});
