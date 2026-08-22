import {
  CREATE_TASK_TOOL_NAME,
  type CreateTaskStatus,
  type CreateTaskToolGlance,
  parseCreateTaskOutput,
} from "@chatdesk/shared";
import { getToolName } from "ai";
import { Check, ChevronDown, CircleAlert, LoaderCircle, Square } from "lucide-react";
import { useState } from "react";
import type { ChatToolPart } from "@/lib/chat-message-blocks";
import { CHAT_TOOL_DISPLAY_NAMES } from "@/lib/chat-tool-defs";
import { compactToolText } from "./chat-tool-call-utils";

export type ChatTaskListProps = {
  parts: ChatToolPart[];
};

type TaskItemView = {
  id: string;
  title: string;
  prompt: string;
  headings: string[];
  tools: CreateTaskToolGlance[];
  status: CreateTaskStatus | "pending";
  error?: string;
  running: boolean;
};

function getStringField(value: unknown, key: string) {
  if (!value || typeof value !== "object") return "";
  const property = (value as Record<string, unknown>)[key];
  return typeof property === "string" ? property.trim() : "";
}

function statusLabel(status: TaskItemView["status"]) {
  if (status === "running" || status === "pending") return "进行中";
  if (status === "stopped") return "已停止";
  if (status === "error") return "失败";
  return "";
}

function sameText(left: string, right: string) {
  return compactToolText(left) === compactToolText(right);
}

function toolDisplayName(name: string) {
  return CHAT_TOOL_DISPLAY_NAMES[name] ?? name;
}

function formatToolGlance(tool: CreateTaskToolGlance) {
  const name = toolDisplayName(tool.name);
  return tool.detail ? `${name} · ${tool.detail}` : name;
}

function headlineFromPrompt(prompt: string) {
  const firstLine = prompt.split(/\r?\n/, 1)[0] ?? "";
  const compact = compactToolText(firstLine);
  if (!compact) return "";
  if (compact.length <= 72) return compact;
  return `${compact.slice(0, 71).trimEnd()}…`;
}

function taskFromPart(part: ChatToolPart): TaskItemView {
  const input = "input" in part ? part.input : undefined;
  const prompt = getStringField(input, "prompt");
  const namedTitle = getStringField(input, "title");
  const output = "output" in part ? parseCreateTaskOutput(part.output) : null;
  const preliminary = "preliminary" in part ? Boolean(part.preliminary) : false;
  const running =
    preliminary || part.state === "input-streaming" || part.state === "input-available";
  const errorText = "errorText" in part && typeof part.errorText === "string" ? part.errorText : "";
  const status: TaskItemView["status"] = running
    ? "running"
    : (output?.status ?? (part.state === "output-error" || errorText ? "error" : "pending"));
  return {
    id: part.toolCallId,
    title: output?.title || namedTitle || headlineFromPrompt(prompt) || "后台任务",
    prompt,
    headings: output?.headings ?? [],
    tools: output?.tools ?? [],
    status,
    ...(output?.error || errorText ? { error: output?.error || errorText } : {}),
    running,
  };
}

function TaskStatusIcon({ task }: { task: TaskItemView }) {
  if (task.running || task.status === "pending") {
    return <LoaderCircle aria-hidden="true" className="size-3.5 animate-spin" />;
  }
  if (task.status === "completed") {
    return <Check aria-hidden="true" className="size-3.5" />;
  }
  if (task.status === "stopped") {
    return <Square aria-hidden="true" className="size-3 fill-current" />;
  }
  return <CircleAlert aria-hidden="true" className="size-3.5" />;
}

function TaskOutlineList({
  items,
  label,
  kind,
}: {
  items: string[];
  label: string;
  kind: "headings" | "tools";
}) {
  if (items.length === 0) return null;
  return (
    <div className={`chat-task-item-outline is-${kind}`}>
      <span className="chat-task-item-meta">{label}</span>
      <ul>
        {items.map((item) => (
          <li className="chat-task-item-outline-item" key={item} title={item}>
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}

function ChatTaskItem({ task }: { task: TaskItemView }) {
  const [open, setOpen] = useState(false);
  const toolLines = task.tools.map(formatToolGlance);
  const collapsedGlance =
    task.headings.at(-1) || (toolLines.length > 0 ? (toolLines.at(-1) ?? "") : "");
  const showInlinePreview = Boolean(
    collapsedGlance && !open && !sameText(collapsedGlance, task.title),
  );
  const promptAddsDetail = Boolean(task.prompt && !sameText(task.prompt, task.title));
  const expandable = Boolean(
    promptAddsDetail || task.error || task.headings.length > 0 || toolLines.length > 0,
  );
  const failed = task.status === "error";
  const status = statusLabel(task.status);
  const summaryBody = (
    <>
      <span className="chat-task-item-icon">
        <TaskStatusIcon task={task} />
      </span>
      <span className="chat-task-item-copy">
        <span className="chat-task-item-title" title={task.title}>
          {task.title}
        </span>
        {showInlinePreview ? (
          <span className="chat-task-item-inline-preview">{collapsedGlance}</span>
        ) : null}
      </span>
      {status ? <span className="chat-task-item-status">{status}</span> : null}
      {expandable ? (
        <ChevronDown className={`chat-task-item-chevron ${open ? "is-open" : ""}`} />
      ) : null}
    </>
  );

  return (
    <article
      className={`chat-task-item ${task.running ? "is-running" : ""} ${failed ? "is-error" : ""}`}
    >
      {expandable ? (
        <button
          aria-expanded={open}
          className="chat-task-item-summary"
          onClick={() => setOpen((value) => !value)}
          type="button"
        >
          {summaryBody}
        </button>
      ) : (
        <div className="chat-task-item-summary">{summaryBody}</div>
      )}
      {open && expandable ? (
        <div className="chat-task-item-body">
          {promptAddsDetail ? (
            <p className="chat-task-item-prompt">
              <span className="chat-task-item-meta">任务</span>
              {task.prompt}
            </p>
          ) : null}
          <TaskOutlineList items={task.headings} kind="headings" label="标题" />
          <TaskOutlineList items={toolLines} kind="tools" label="工具" />
          {task.error ? (
            <p className="chat-task-item-error">
              <span className="chat-task-item-meta">错误</span>
              {task.error}
            </p>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}

export function ChatTaskList({ parts }: ChatTaskListProps) {
  const tasks = parts
    .filter((part) => getToolName(part) === CREATE_TASK_TOOL_NAME)
    .map(taskFromPart);
  if (tasks.length === 0) return null;
  return (
    <div className="chat-task-list">
      {tasks.map((task) => (
        <ChatTaskItem key={task.id} task={task} />
      ))}
    </div>
  );
}
