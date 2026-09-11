import { describe, expect, it } from "vitest";
import {
  CHAT_NEW_PATH,
  chatIndexRedirectPath,
  chatNewPath,
  chatRouteKey,
  chatSessionPath,
  getChatWindowKey,
  isChatPath,
  parseChatLocation,
} from "./chat-routes";

describe("chat route helpers", () => {
  it("builds a blank workspace path without a session id", () => {
    expect(chatNewPath()).toBe("/chat/new");
    expect(
      chatNewPath({
        workspaceId: "alpha",
        workspaceCwd: "/work/alpha",
      }),
    ).toBe("/chat/new?workspaceId=alpha&workspaceCwd=%2Fwork%2Falpha");
    expect(chatNewPath({ workspaceId: "default", workspaceCwd: "/tmp" })).toBe("/chat/new");
  });

  it("builds a session path and treats new as a reserved segment", () => {
    expect(chatSessionPath("8f3c1a2e-4b5d-4c6a-9d0e-1f2a3b4c5d6e")).toBe(
      "/chat/8f3c1a2e-4b5d-4c6a-9d0e-1f2a3b4c5d6e",
    );
    expect(parseChatLocation("/chat/new", "").kind).toBe("new");
    expect(parseChatLocation("/chat/8f3c1a2e-4b5d-4c6a-9d0e-1f2a3b4c5d6e").kind).toBe("session");
  });

  it("redirects legacy query urls onto the split paths", () => {
    expect(chatIndexRedirectPath("")).toBe("/chat/new");
    expect(chatIndexRedirectPath("sessionId=abc-123")).toBe("/chat/abc-123");
    expect(chatIndexRedirectPath("?workspaceId=alpha&workspaceCwd=/work/alpha")).toBe(
      "/chat/new?workspaceId=alpha&workspaceCwd=%2Fwork%2Falpha",
    );
  });

  it("parses current and legacy locations into a single identity", () => {
    expect(parseChatLocation("/chat/new", "workspaceId=alpha")).toEqual({
      kind: "new",
      workspaceId: "alpha",
      workspaceCwd: "",
    });
    expect(parseChatLocation("/chat", "sessionId=abc-123")).toEqual({
      kind: "session",
      sessionId: "abc-123",
    });
    expect(parseChatLocation("/chat", "workspaceId=default")).toEqual({
      kind: "new",
      workspaceId: "",
      workspaceCwd: "",
    });
  });

  it("keys the workspace window by draft workspace or session id", () => {
    expect(getChatWindowKey("/chat/new", "workspaceId=alpha")).toBe("workspace:alpha");
    expect(getChatWindowKey("/chat/abc-123")).toBe("abc-123");
    expect(isChatPath("/chat")).toBe(true);
    expect(isChatPath("/chat/new")).toBe(true);
    expect(isChatPath("/settings")).toBe(false);
    expect(chatRouteKey({ kind: "new", workspaceId: "alpha", workspaceCwd: "/work" })).toBe(
      "new:alpha:/work",
    );
    expect(CHAT_NEW_PATH).toBe("/chat/new");
  });
});
