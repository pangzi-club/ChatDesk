import type { ChatRunSummary, ServerEvent } from "@chatdesk/shared";

export type CliToolStatus = "running" | "approval" | "completed" | "error";

export type CliToolActivity = {
  id: string;
  name: string;
  detail?: string;
  status: CliToolStatus;
  error?: string;
};

export type CliRunProgress = {
  phase: string;
  stepCount: number;
  toolCallCount: number;
};

export type CliTurnEvent =
  | { type: "text-delta"; delta: string }
  | { type: "snapshot"; text: string; tools: CliToolActivity[] }
  | { type: "progress"; progress: CliRunProgress }
  | { type: "finished"; summary?: ChatRunSummary }
  | { type: "event-error"; message: string };

type MessageLike = {
  role?: unknown;
  parts?: unknown;
};

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : undefined;
}

function textField(value: unknown, key: string) {
  const result = record(value)?.[key];
  return typeof result === "string" ? result.trim() : "";
}

function compact(value: string, max = 96) {
  const singleLine = value.replace(/\s+/g, " ").trim();
  return singleLine.length > max ? `${singleLine.slice(0, max - 1)}…` : singleLine;
}

function fileName(value: string) {
  const parts = value.replace(/\\/g, "/").split("/").filter(Boolean);
  return parts.at(-1) ?? value;
}

function toolName(part: Record<string, unknown>) {
  if (part.type === "dynamic-tool") return textField(part, "toolName");
  return typeof part.type === "string" && part.type.startsWith("tool-") ? part.type.slice(5) : "";
}

function toolDetail(name: string, input: unknown, output: unknown) {
  if (name === "bash") return compact(textField(input, "command"));
  if (name === "search_files") {
    return compact(textField(input, "query") || textField(input, "pattern"));
  }
  if (name === "web_search") {
    return compact(textField(input, "query") || textField(input, "search"));
  }
  if (name === "apply_patch") {
    const changedFiles = record(output)?.changedFiles;
    if (Array.isArray(changedFiles) && changedFiles.length > 0)
      return `${changedFiles.length} files`;
  }
  const path =
    textField(output, "path") || textField(input, "path") || textField(input, "file_path");
  if (path) return compact(fileName(path));
  return compact(
    textField(input, "url") ||
      textField(input, "query") ||
      textField(input, "pattern") ||
      textField(input, "title"),
  );
}

function toolStatus(part: Record<string, unknown>): CliToolStatus {
  const state = typeof part.state === "string" ? part.state : "";
  if (state === "output-error") return "error";
  if (state === "approval-requested") return "approval";
  if (state === "output-available") {
    const output = record(part.output);
    if (output?.success === false || (typeof output?.code === "number" && output.code !== 0)) {
      return "error";
    }
    return "completed";
  }
  return "running";
}

export function snapshotFromMessage(message: MessageLike | undefined) {
  const parts = Array.isArray(message?.parts) ? message.parts : [];
  const text = parts
    .map((part) => {
      const value = record(part);
      return value?.type === "text" && typeof value.text === "string" ? value.text : "";
    })
    .join("");
  const tools = new Map<string, CliToolActivity>();
  for (const rawPart of parts) {
    const part = record(rawPart);
    if (!part) continue;
    const name = toolName(part);
    const id = textField(part, "toolCallId");
    if (!name || !id) continue;
    const status = toolStatus(part);
    const error =
      status === "error"
        ? compact(textField(part, "errorText") || textField(part.output, "error"))
        : "";
    const detail = toolDetail(name, part.input, part.output);
    tools.set(id, {
      id,
      name,
      status,
      ...(detail ? { detail } : {}),
      ...(error ? { error } : {}),
    });
  }
  return { text, tools: [...tools.values()] };
}

export function cliTurnEventFromServer(event: ServerEvent): CliTurnEvent | undefined {
  if (event.type === "message.delta" && event.delta) {
    return { type: "text-delta", delta: event.delta };
  }
  if (event.type === "message.updated" && event.message) {
    return { type: "snapshot", ...snapshotFromMessage(event.message) };
  }
  if (event.type === "run.progress" && event.runProgress) {
    return {
      type: "progress",
      progress: {
        phase: event.runProgress.phase,
        stepCount: event.runProgress.stepCount,
        toolCallCount: event.runProgress.toolCallCount,
      },
    };
  }
  if (event.type === "run.done" || event.type === "run.error") {
    return { type: "finished", summary: event.runSummary };
  }
  return undefined;
}
