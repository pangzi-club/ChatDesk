export const CHAT_BASE_PATH = "/chat";
export const CHAT_NEW_SEGMENT = "new";
export const CHAT_NEW_PATH = `${CHAT_BASE_PATH}/${CHAT_NEW_SEGMENT}`;

export type ChatLocation =
  | { kind: "new"; workspaceId: string; workspaceCwd: string }
  | { kind: "session"; sessionId: string };

export type ChatDraftResetState = {
  resetChatDraft?: boolean;
};

export function isChatPath(pathname: string) {
  return pathname === CHAT_BASE_PATH || pathname.startsWith(`${CHAT_BASE_PATH}/`);
}

export function normalizeChatWorkspaceId(value: string | null | undefined) {
  if (!value || value === "default") return "";
  return value;
}

export function chatNewPath(options?: { workspaceId?: string; workspaceCwd?: string }) {
  const workspaceId = normalizeChatWorkspaceId(options?.workspaceId);
  const workspaceCwd = workspaceId ? (options?.workspaceCwd ?? "") : "";
  const params = new URLSearchParams();
  if (workspaceId) params.set("workspaceId", workspaceId);
  if (workspaceCwd) params.set("workspaceCwd", workspaceCwd);
  const search = params.toString();
  return search ? `${CHAT_NEW_PATH}?${search}` : CHAT_NEW_PATH;
}

export function chatSessionPath(sessionId: string) {
  return `${CHAT_BASE_PATH}/${encodeURIComponent(sessionId)}`;
}

export function chatNewNavigationState(): ChatDraftResetState {
  return { resetChatDraft: true };
}

export function chatIndexRedirectPath(search = "") {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const sessionId = params.get("sessionId")?.trim();
  if (sessionId) return chatSessionPath(sessionId);
  return chatNewPath({
    workspaceId: params.get("workspaceId") ?? "",
    workspaceCwd: params.get("workspaceCwd") ?? "",
  });
}

export function parseChatLocation(pathname: string, search = ""): ChatLocation {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const sessionIdFromQuery = params.get("sessionId")?.trim() ?? "";
  if (pathname === CHAT_BASE_PATH || pathname === `${CHAT_BASE_PATH}/`) {
    if (sessionIdFromQuery) return { kind: "session", sessionId: sessionIdFromQuery };
    return {
      kind: "new",
      workspaceId: normalizeChatWorkspaceId(params.get("workspaceId")),
      workspaceCwd: params.get("workspaceCwd") ?? "",
    };
  }
  if (pathname === CHAT_NEW_PATH) {
    return {
      kind: "new",
      workspaceId: normalizeChatWorkspaceId(params.get("workspaceId")),
      workspaceCwd: params.get("workspaceCwd") ?? "",
    };
  }
  if (pathname.startsWith(`${CHAT_BASE_PATH}/`)) {
    const sessionId = decodeURIComponent(
      pathname.slice(`${CHAT_BASE_PATH}/`.length).split("/")[0] ?? "",
    );
    if (sessionId && sessionId !== CHAT_NEW_SEGMENT) {
      return { kind: "session", sessionId };
    }
  }
  return {
    kind: "new",
    workspaceId: normalizeChatWorkspaceId(params.get("workspaceId")),
    workspaceCwd: params.get("workspaceCwd") ?? "",
  };
}

export function getChatWindowKey(pathname: string, search = "") {
  const route = parseChatLocation(pathname, search);
  if (route.kind === "session") return route.sessionId;
  return `workspace:${route.workspaceId || "new"}`;
}

export function chatRouteKey(location: ChatLocation) {
  if (location.kind === "session") return `session:${location.sessionId}`;
  return `new:${location.workspaceId}:${location.workspaceCwd}`;
}
