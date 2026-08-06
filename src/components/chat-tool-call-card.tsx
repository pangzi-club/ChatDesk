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
        <span className="chat-tool-call-title">{title}</span>
        <span className="chat-tool-call-status">{status}</span>
        <ChevronDown className={`chat-tool-call-chevron ${open ? "is-open" : ""}`} />
      </button>
      {open ? (
        <div className="chat-tool-call-body">
          <div className="chat-tool-call-section">
            <p className="chat-tool-call-label">参数</p>
            <pre>{formatJson(input)}</pre>
          </div>
          <div className="chat-tool-call-section">
            <p className="chat-tool-call-label">{failed ? "错误" : "结果"}</p>
            <pre>{failed ? (errorText ?? formatJson(output)) : formatJson(output)}</pre>
          </div>
        </div>
      ) : null}
    </div>
  );
}
