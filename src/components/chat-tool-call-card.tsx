import { convertFileSrc } from "@tauri-apps/api/core";
import { ChevronDown, LoaderCircle, Wrench } from "lucide-react";
import { useMemo, useState } from "react";

import {
  IMAGE_GENERATION_MEDIA_TYPE,
  IMAGE_GENERATION_TOOL_NAME,
  readImageGenerationOutput,
} from "@/lib/chat-image-generation";
import { CHAT_TOOL_DISPLAY_NAMES } from "@/lib/chat-tool-defs";

type ChatToolCallCardProps = {
  toolName: string;
  state: string;
  input?: unknown;
  output?: unknown;
  errorText?: string;
  /** AI SDK 流式中间结果（如 image_generation partial_image）。 */
  preliminary?: boolean;
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

/** 业务 tool 经 withToolError 失败时返回 { error }，SDK 仍标为 output-available。 */
function extractToolOutputError(output: unknown): string | undefined {
  if (!output || typeof output !== "object") return undefined;
  const error = (output as { error?: unknown }).error;
  return typeof error === "string" && error.trim() ? error.trim() : undefined;
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

function resolveImagePreviewSrc(output: unknown): string | null {
  const { rawBase64, remoteUrl, materialized } = readImageGenerationOutput(output);
  if (materialized?.url) return materialized.url;
  if (materialized?.path) {
    try {
      return convertFileSrc(materialized.path);
    } catch {
      return null;
    }
  }
  if (remoteUrl) return remoteUrl;
  if (rawBase64) {
    if (rawBase64.startsWith("data:")) return rawBase64;
    return `data:${IMAGE_GENERATION_MEDIA_TYPE};base64,${rawBase64}`;
  }
  return null;
}

function statusLabel(options: {
  toolName: string;
  state: string;
  errorText?: string;
  preliminary?: boolean;
  hasImagePreview: boolean;
}) {
  const { toolName, state, errorText, preliminary, hasImagePreview } = options;
  if (state === "output-error" || errorText) return "失败";
  if (toolName === IMAGE_GENERATION_TOOL_NAME) {
    if (preliminary || state === "input-streaming" || state === "input-available") {
      return hasImagePreview ? "预览中" : "生成中";
    }
    if (state === "output-available") return "成功";
    return state;
  }
  if (state === "output-available") return preliminary ? "更新中" : "成功";
  if (state === "input-streaming" || state === "input-available") return "调用中";
  return state;
}

export function ChatToolCallCard({
  toolName,
  state,
  input,
  output,
  errorText,
  preliminary = false,
}: ChatToolCallCardProps) {
  const [open, setOpen] = useState(false);
  const title = CHAT_TOOL_DISPLAY_NAMES[toolName] ?? toolName;
  const outputError = extractToolOutputError(output);
  const resolvedError = errorText || outputError;
  const failed = state === "output-error" || Boolean(resolvedError);
  const webSearch =
    toolName === "web_search" || toolName === "web_search_preview"
      ? extractWebSearchSummary(output)
      : null;
  const isImageGeneration = toolName === IMAGE_GENERATION_TOOL_NAME;
  const imagePreviewSrc = useMemo(
    () => (isImageGeneration && !failed ? resolveImagePreviewSrc(output) : null),
    [failed, isImageGeneration, output],
  );
  const imageMeta = useMemo(() => {
    if (!isImageGeneration || failed) return null;
    const { materialized, remoteUrl, taskId } = readImageGenerationOutput(output);
    if (materialized) {
      return {
        attachmentId: materialized.attachmentId,
        fileName: materialized.fileName as string | undefined,
        mediaType: materialized.mediaType,
        ...(materialized.taskId ? { taskId: materialized.taskId } : {}),
        ...(materialized.sourceUrl ? { sourceUrl: materialized.sourceUrl } : {}),
      };
    }
    if (remoteUrl || taskId) {
      return {
        fileName: undefined as string | undefined,
        ...(taskId ? { taskId } : {}),
        ...(remoteUrl ? { url: remoteUrl } : {}),
      };
    }
    return null;
  }, [failed, isImageGeneration, output]);
  const pending =
    !failed && (preliminary || state === "input-streaming" || state === "input-available");
  const status = statusLabel({
    toolName,
    state,
    errorText: resolvedError,
    preliminary,
    hasImagePreview: Boolean(imagePreviewSrc),
  });
  const showInput = (!webSearch && !isImageGeneration) || !isEmptyInput(input);
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
          {isImageGeneration && imageMeta?.fileName ? ` · ${imageMeta.fileName}` : ""}
        </span>
        <span className="chat-tool-call-status">{status}</span>
        <ChevronDown className={`chat-tool-call-chevron ${open ? "is-open" : ""}`} />
      </button>
      {imagePreviewSrc && !failed ? (
        <div className="chat-tool-call-preview px-3 pb-2">
          {preliminary ? (
            <p className="mb-1.5 text-[11px] text-muted-foreground">中间预览，仍在生成…</p>
          ) : null}
          <img
            alt={imageMeta?.fileName ?? "generated image"}
            className={`max-h-64 max-w-full rounded-md object-contain ${
              preliminary ? "opacity-90" : ""
            }`}
            src={imagePreviewSrc}
          />
        </div>
      ) : null}
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
            {failed ? (
              <pre>{resolvedError ?? formatJson(output)}</pre>
            ) : isImageGeneration ? (
              <pre>
                {formatJson(
                  imageMeta ?? {
                    note: imagePreviewSrc
                      ? preliminary
                        ? "中间预览见上方，最终图生成中"
                        : "图片预览见上方"
                      : "暂无图片输出",
                  },
                )}
              </pre>
            ) : (
              <pre>{formatJson(output)}</pre>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
