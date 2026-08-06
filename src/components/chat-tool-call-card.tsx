import { ChevronDown, LoaderCircle, Wrench } from "lucide-react";
import { useState } from "react";

import { CHAT_TOOL_DISPLAY_NAMES } from "@/lib/chat-tool-defs";

type ChatToolCallCardProps = {
  toolName: string;
  state: string;
  input?: unknown;
  output?: unknown;
  errorText?: string;
};

function formatJson(value: unknown) {
  if (value === undefined) return "—";
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function isEmptyInput(value: unknown) {
  if (value === undefined || value === null) return true;
  if (typeof value !== "object") return false;
  return Object.keys(value as Record<string, unknown>).length === 0;
}

/** OpenAI web_search 入参恒为空；查询词在 output.action 里。 */
function extractWebSearchSummary(output: unknown): {
  actionLabel?: string;
  queries: string[];
  sources: string[];
} | null {
  if (!output || typeof output !== "object") return null;
  const record = output as {
    action?: {
      type?: string;
      query?: string;
      queries?: string[];
      url?: string | null;
      pattern?: string | null;
    };
    sources?: Array<{ type?: string; url?: string; name?: string }>;
  };
  const action = record.action;
  const queries: string[] = [];
  if (action?.type === "search") {
    if (Array.isArray(action.queries)) {
      for (const query of action.queries) {
        if (typeof query === "string" && query.trim()) queries.push(query.trim());
      }
    }
    if (queries.length === 0 && typeof action.query === "string" && action.query.trim()) {
      queries.push(action.query.trim());
    }
  } else if (action?.type === "openPage" && typeof action.url === "string" && action.url.trim()) {
    queries.push(action.url.trim());
  } else if (action?.type === "findInPage") {
    const parts = [action.url, action.pattern].filter(
      (value): value is string => typeof value === "string" && value.trim().length > 0,
    );
    if (parts.length > 0) queries.push(parts.join(" · "));
  }

  const sources = (record.sources ?? [])
    .map((source) => {
      if (source.type === "url" && typeof source.url === "string") return source.url;
      if (source.type === "api" && typeof source.name === "string") return source.name;
      return null;
    })
    .filter((value): value is string => Boolean(value));

  if (!action && sources.length === 0) return null;
  return {
    actionLabel: action?.type,
    queries,
    sources,
  };
}

function statusLabel(state: string, errorText?: string) {
  if (state === "output-error" || errorText) return "失败";
  if (state === "output-available") return "成功";
  if (state === "input-streaming" || state === "input-available") return "调用中";
  return state;
}

export function ChatToolCallCard({
  toolName,
  state,
  input,
  output,
  errorText,
}: ChatToolCallCardProps) {
  const [open, setOpen] = useState(false);
  const title = CHAT_TOOL_DISPLAY_NAMES[toolName] ?? toolName;
  const status = statusLabel(state, errorText);
  const pending = state === "input-streaming" || state === "input-available";
  const failed = state === "output-error" || Boolean(errorText);
  const webSearch =
    toolName === "web_search" || toolName === "web_search_preview"
      ? extractWebSearchSummary(output)
      : null;
  const showInput = !webSearch || !isEmptyInput(input);
  const summaryQuery = webSearch?.queries[0];

  return (
    <div className={`chat-tool-call ${failed ? "is-error" : ""} ${pending ? "is-pending" : ""}`}>
      <button
        aria-expanded={open}
        className="chat-tool-call-summary"
        type="button"
        onClick={() => setOpen((value) => !value)}
      >
        <span className="chat-tool-call-icon">
          {pending ? (
            <LoaderCircle className="size-3.5 animate-spin" />
          ) : (
            <Wrench className="size-3.5" />
          )}
        </span>
        <span className="chat-tool-call-title">
          {title}
          {summaryQuery ? ` · ${summaryQuery}` : ""}
        </span>
        <span className="chat-tool-call-status">{status}</span>
        <ChevronDown className={`chat-tool-call-chevron ${open ? "is-open" : ""}`} />
      </button>
      {open ? (
        <div className="chat-tool-call-body">
          {showInput ? (
            <div className="chat-tool-call-section">
              <p className="chat-tool-call-label">参数</p>
              <pre>{formatJson(input)}</pre>
            </div>
          ) : null}
          {webSearch && (webSearch.queries.length > 0 || webSearch.sources.length > 0) ? (
            <div className="chat-tool-call-section">
              <p className="chat-tool-call-label">搜索</p>
              <pre>
                {formatJson({
                  ...(webSearch.actionLabel ? { action: webSearch.actionLabel } : {}),
                  ...(webSearch.queries.length > 0 ? { queries: webSearch.queries } : {}),
                  ...(webSearch.sources.length > 0 ? { sources: webSearch.sources } : {}),
                })}
              </pre>
            </div>
          ) : null}
          <div className="chat-tool-call-section">
            <p className="chat-tool-call-label">{failed ? "错误" : "结果"}</p>
            <pre>{failed ? (errorText ?? formatJson(output)) : formatJson(output)}</pre>
          </div>
        </div>
      ) : null}
    </div>
  );
}
