import type { QueryClient } from "@tanstack/react-query";
import { regenerateChatSessionTitle, updateChatSessionTitle } from "@/lib/server/chat-server";

/** Sidebar conversation index, refreshed whenever a session title changes. */
const CHAT_INDEX_QUERY_KEY = ["chat-index"];

/** Regenerate a session title on the Chat Server, then refresh the chat index. */
export async function regenerateChatSessionTitleAndRefresh(
  queryClient: QueryClient,
  sessionId: string,
): Promise<{ title: string }> {
  const result = await regenerateChatSessionTitle(sessionId);
  await queryClient.invalidateQueries({ queryKey: CHAT_INDEX_QUERY_KEY });
  return result;
}

/** Save a session title on the Chat Server, then refresh the chat index. */
export async function saveChatSessionTitleAndRefresh(
  queryClient: QueryClient,
  sessionId: string,
  title: string,
): Promise<{ title: string }> {
  const result = await updateChatSessionTitle(sessionId, title);
  await queryClient.invalidateQueries({ queryKey: CHAT_INDEX_QUERY_KEY });
  return result;
}
