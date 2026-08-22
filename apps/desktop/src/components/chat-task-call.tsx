import {
  CREATE_TASK_TOOL_NAME,
  type CreateTaskStatus,
  parseCreateTaskOutput,
} from "@chatdesk/shared";
import { getToolName } from "ai";
import { Check, ChevronDown, CircleAlert, LoaderCircle, Square } from "lucide-react";
import { useState } from "react";
import type { ChatToolPart } from "@/lib/chat-message-blocks";
import { compactToolText, headlineToolText, previewToolText } from "./chat-tool-call-utils";

export type ChatTaskListProps = {
  parts: ChatToolPart[];
};

type TaskItemView = {
  id: string;
  title: string;
  prompt: string;
  preview: string;
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
    title: output?.title || namedTitle || headlineToolText(prompt) || "后台任务",
    prompt,
    preview: output?.preview || "",
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

function ChatTaskItem({ task }: { task: TaskItemView }) {
  const [open, setOpen] = useState(false);
  const collapsedPreview = task.preview ? headlineToolText(task.preview, 96) : "";
  const showInlinePreview = Boolean(
    collapsedPreview && !open && !sameText(collapsedPreview, task.title),
  );
  const promptAddsDetail = Boolean(task.prompt && !sameText(task.prompt, task.title));
  const previewAddsDetail = Boolean(task.preview && !sameText(task.preview, task.title));
  const expandable = Boolean(promptAddsDetail || task.error || previewAddsDetail);
  const expandedPreview = task.preview ? previewToolText(task.preview, 800, 16).text : "";
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
          <span className="chat-task-item-inline-preview">{collapsedPreview}</span>
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
          {task.error ? (
            <p className="chat-task-item-error">
              <span className="chat-task-item-meta">错误</span>
              {task.error}
            </p>
          ) : null}
          {previewAddsDetail && expandedPreview ? (
            <div className="chat-task-item-preview">
              <span className="chat-task-item-meta">进展</span>
              <pre>{expandedPreview}</pre>
            </div>
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
