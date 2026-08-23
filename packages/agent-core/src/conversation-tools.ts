import { type ToolSet, tool } from "ai";
import { z } from "zod";
import { type ChatSession, textFromMessage } from "./protocol.ts";
import type { SessionStore } from "./store.ts";

const cursorSchema = z.string().regex(/^\d+$/).nullable().optional();
const limitSchema = z.number().int().min(1).max(50).optional();
const sortKeySchema = z.enum(["created_at", "updated_at", "recency_at", "section_position"]);
const sortDirectionSchema = z.enum(["asc", "desc"]);

type ThreadSummary = {
  id: string;
  title: string;
  preview: string;
  status: "idle";
  createdAt: string;
  updatedAt: string;
  archived: boolean;
  cwd?: string;
  workspaceId?: string;
};

function pageOffset(cursor: string | null | undefined) {
  return cursor ? Number(cursor) : 0;
}

function page<T>(items: T[], cursor: string | null | undefined, limit: number) {
  const offset = pageOffset(cursor);
  const data = items.slice(offset, offset + limit);
  const next = offset + data.length < items.length ? String(offset + data.length) : null;
  return {
    data,
    ...(next ? { nextCursor: next } : {}),
    ...(offset > 0 ? { backwardsCursor: String(Math.max(0, offset - limit)) } : {}),
  };
}

function messageText(session: ChatSession) {
  return session.messages
    .filter((message) => message.role === "user" || message.role === "assistant")
    .map((message) => textFromMessage(message))
    .filter(Boolean);
}

function preview(session: ChatSession) {
  const text = messageText(session).at(-1) ?? "";
  return text.length > 240 ? `${text.slice(0, 240)}...` : text;
}

function summary(session: ChatSession): ThreadSummary {
  return {
    id: session.id,
    title: session.title,
    preview: preview(session),
    status: "idle",
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    archived: false,
    ...(session.cwd ? { cwd: session.cwd } : {}),
    ...(session.workspaceId ? { workspaceId: session.workspaceId } : {}),
  };
}

function sortSessions(
  sessions: ChatSession[],
  sortKey: z.infer<typeof sortKeySchema>,
  direction: z.infer<typeof sortDirectionSchema>,
) {
  const getValue = (session: ChatSession) => {
    if (sortKey === "created_at") return session.createdAt;
    return session.updatedAt;
  };
  const factor = direction === "asc" ? 1 : -1;
  return [...sessions].sort(
    (left, right) => factor * getValue(left).localeCompare(getValue(right)),
  );
}

function normalizeTerm(term: string) {
  return term.normalize("NFKC").toLocaleLowerCase();
}

function snippet(text: string, matchIndex: number, termLength: number) {
  const start = Math.max(0, matchIndex - 120);
  const end = Math.min(text.length, matchIndex + termLength + 120);
  const value = text.slice(start, end);
  return {
    snippet: value,
    snippetMatchRange: {
      start: matchIndex - start,
      end: matchIndex - start + termLength,
    },
  };
}

async function allSessions(store: SessionStore) {
  const items = await store.list(undefined, undefined, { limit: 100 });
  const sessions = await Promise.all(items.map((item) => store.get(item.id)));
  return sessions.filter((session): session is ChatSession => session !== null);
}

export function createConversationTools(store: SessionStore): ToolSet {
  return {
    list_threads: tool({
      description: "列出 ChatDesk 历史对话线程，支持标题/预览、工作目录、排序和分页。",
      inputSchema: z.object({
        cursor: cursorSchema,
        limit: limitSchema,
        sortKey: sortKeySchema.optional(),
        sortDirection: sortDirectionSchema.optional(),
        archived: z.boolean().optional(),
        searchTerm: z.string().optional(),
        cwd: z.union([z.string(), z.array(z.string()).max(50)]).optional(),
        modelProviders: z.array(z.string()).max(50).optional(),
        sourceKinds: z.array(z.string()).max(50).optional(),
        sectionId: z.string().optional(),
        projectId: z.string().optional(),
        useStateDbOnly: z.boolean().optional(),
      }),
      execute: async ({
        cursor,
        limit = 20,
        sortKey = "updated_at",
        sortDirection = "desc",
        searchTerm,
        cwd,
        archived,
      }) => {
        const requestedCwds = new Set(
          (Array.isArray(cwd) ? cwd : cwd ? [cwd] : []).map((value) => value.trim()),
        );
        const query = searchTerm?.trim().toLocaleLowerCase();
        let sessions = archived === true ? [] : await allSessions(store);
        sessions = sessions.filter((session) => {
          if (requestedCwds.size > 0 && !requestedCwds.has(session.cwd ?? "")) return false;
          if (!query) return true;
          return `${session.title} ${preview(session)}`.toLocaleLowerCase().includes(query);
        });
        return page(sortSessions(sessions, sortKey, sortDirection).map(summary), cursor, limit);
      },
    }),
    search_threads: tool({
      description: "跨多个 ChatDesk 历史对话搜索可见的用户和助手消息，并返回命中线程与上下文片段。",
      inputSchema: z.object({
        searchTerm: z.string().trim().min(1),
        cursor: cursorSchema,
        limit: limitSchema,
        sortKey: z.enum(["created_at", "updated_at", "recency_at"]).optional(),
        sortDirection: sortDirectionSchema.optional(),
        archived: z.boolean().optional(),
        sourceKinds: z.array(z.string()).max(50).optional(),
      }),
      execute: async ({
        searchTerm,
        cursor,
        limit = 20,
        sortKey = "recency_at",
        sortDirection = "desc",
        archived,
      }) => {
        const term = normalizeTerm(searchTerm);
        const matches = (archived === true ? [] : await allSessions(store))
          .map((session) => {
            const text = messageText(session).join("\n");
            const index = normalizeTerm(text).indexOf(term);
            return index < 0 ? null : { session, index, text };
          })
          .filter(
            (value): value is { session: ChatSession; index: number; text: string } =>
              value !== null,
          )
          .sort((left, right) => {
            const leftValue =
              sortKey === "created_at" ? left.session.createdAt : left.session.updatedAt;
            const rightValue =
              sortKey === "created_at" ? right.session.createdAt : right.session.updatedAt;
            return (sortDirection === "asc" ? 1 : -1) * leftValue.localeCompare(rightValue);
          })
          .map(({ session, index, text }) => ({
            thread: summary(session),
            ...snippet(text, index, searchTerm.length),
          }));
        return page(matches, cursor, limit);
      },
    }),
    search_thread_occurrences: tool({
      description: "在指定 ChatDesk 对话中定位搜索词出现的消息、消息 ID 和片段范围。",
      inputSchema: z.object({
        threadId: z.string().min(1),
        searchTerm: z.string().trim().min(1),
        cursor: cursorSchema,
        limit: limitSchema,
      }),
      execute: async ({ threadId, searchTerm, cursor, limit = 50 }) => {
        const session = await store.get(threadId);
        if (!session) return { error: "对话不存在" };
        const term = normalizeTerm(searchTerm);
        const occurrences: Array<Record<string, unknown>> = [];
        for (const message of session.messages) {
          if (message.role !== "user" && message.role !== "assistant") continue;
          const text = textFromMessage(message);
          const normalized = normalizeTerm(text);
          let start = normalized.indexOf(term);
          while (start >= 0) {
            occurrences.push({
              turnId: message.id,
              itemId: message.id,
              ...snippet(text, start, searchTerm.length),
              turnCursor: String(occurrences.length),
            });
            start = normalized.indexOf(term, start + Math.max(term.length, 1));
          }
        }
        return page(occurrences, cursor, limit);
      },
    }),
    read_thread: tool({
      description:
        "根据线程 ID 读取 ChatDesk 对话元数据；includeTurns 为 true 时返回完整可见消息。",
      inputSchema: z.object({ threadId: z.string().min(1), includeTurns: z.boolean().optional() }),
      execute: async ({ threadId, includeTurns = false }) => {
        const session = await store.get(threadId);
        if (!session) return { error: "对话不存在" };
        const thread = summary(session);
        if (!includeTurns) return { thread };
        return {
          thread: {
            ...thread,
            turns: session.messages
              .filter((message) => message.role === "user" || message.role === "assistant")
              .map((message) => ({ id: message.id, items: [message] })),
          },
        };
      },
    }),
  };
}
