import {
  ChevronDown,
  Code2,
  FilePenLine,
  FileText,
  Folder,
  Globe2,
  Image,
  LoaderCircle,
  type LucideIcon,
  MousePointerClick,
  Search,
  Sparkles,
  Terminal,
  UserRoundCheck,
  Wrench,
} from "lucide-react";
import { ScrollArea as ScrollAreaPrimitive } from "radix-ui";
import { useMemo, useState } from "react";

import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import {
  BROWSER_SCREENSHOT_TOOL_NAME,
  readBrowserScreenshotOutput,
} from "@/lib/chat-browser-screenshots";
import {
  IMAGE_GENERATION_MEDIA_TYPE,
  IMAGE_GENERATION_TOOL_NAME,
  readImageGenerationOutput,
} from "@/lib/chat-image-generation";
import { CHAT_TOOL_DISPLAY_NAMES } from "@/lib/chat-tool-defs";
import { CHAT_WORKSPACE_TOOL_DISPLAY_NAMES } from "@/lib/chat-workspace-tools";
import { openFileViewer } from "@/lib/file-viewer-events";
import { assetUrl } from "@/lib/platform";
import {
  extractBrowserToolDetail,
  extractBrowserToolTitle,
  extractReadSkillDetail,
  extractWorkspaceToolSummary,
  extractWorkspaceToolTitle,
  formatToolJson,
  getLastPathSegment,
  getToolCallInputFields,
  getToolCallOutputFields,
  headlineToolText,
  previewToolText,
  resolveWorkspaceToolFileTarget,
  type ToolCallField,
} from "./chat-tool-call-utils";

export type ChatToolCallCardProps = {
  id?: string;
  toolName: string;
  state: string;
  input?: unknown;
  output?: unknown;
  errorText?: string;
  approval?: {
    approved?: boolean;
    isAutomatic?: boolean;
    reason?: string;
  };
  /** AI SDK 流式中间结果（如 image_generation partial_image）。 */
  preliminary?: boolean;
  /** 仅显示调用标题，不展示参数和结果。 */
  compact?: boolean;
  workspaceId?: string;
  cwd?: string;
};

export type ChatToolCallGroupProps = {
  calls: ChatToolCallCardProps[];
  active?: boolean;
  workspaceId?: string;
  cwd?: string;
};

function isEmptyInput(value: unknown) {
  if (value === undefined || value === null) return true;
  if (typeof value !== "object") return false;
  return Object.keys(value as Record<string, unknown>).length === 0;
}

function CollapsiblePre({ text, tone }: { text: string; tone?: ToolCallField["tone"] }) {
  const [expanded, setExpanded] = useState(false);
  const preview = previewToolText(text);
  const display = expanded || !preview.truncated ? text : preview.text;

  return (
    <div className={`chat-tool-call-pre ${tone ? `is-${tone}` : ""}`}>
      <pre>
        {tone === "command" ? (
          <span aria-hidden="true" className="chat-tool-call-prompt">
            $
          </span>
        ) : null}
        <code>{display || "—"}</code>
      </pre>
      {preview.truncated ? (
        <button
          className="chat-tool-call-more"
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            setExpanded((value) => !value);
          }}
        >
          {expanded ? "收起" : "展开全部"}
        </button>
      ) : null}
    </div>
  );
}

function ToolCallFields({ fields }: { fields: ToolCallField[] }) {
  const codeFields = fields.filter((field) => field.kind === "code");
  const showCodeLabels = codeFields.length > 1;

  return (
    <div className="chat-tool-call-fields">
      {fields.map((field) =>
        field.kind === "meta" ? (
          <p className="chat-tool-call-meta" key={field.label} title={field.text}>
            <span className="chat-tool-call-meta-label">{field.label}</span>
            <span className="chat-tool-call-meta-value">{field.text}</span>
          </p>
        ) : (
          <div className="chat-tool-call-field" key={field.label}>
            {showCodeLabels ? <p className="chat-tool-call-sublabel">{field.label}</p> : null}
            <CollapsiblePre text={field.text} tone={field.tone} />
          </div>
        ),
      )}
    </div>
  );
}

function getSummaryDetail(call: ChatToolCallCardProps) {
  if (call.toolName === "web_search" || call.toolName === "web_search_preview") {
    const query = extractWebSearchSummary(call.output)?.queries[0];
    return query ? headlineToolText(query) : "";
  }
  if (CHAT_WORKSPACE_TOOL_DISPLAY_NAMES[call.toolName]) {
    return extractWorkspaceToolSummary(call.toolName, call.input, call.output).replace(/^ · /, "");
  }
  const browserDetail = extractBrowserToolDetail(call.toolName, call.input);
  if (browserDetail) return browserDetail;
  if (call.toolName === IMAGE_GENERATION_TOOL_NAME) {
    const prompt =
      call.input && typeof call.input === "object"
        ? (call.input as { prompt?: unknown }).prompt
        : undefined;
    return typeof prompt === "string" ? headlineToolText(prompt) : "";
  }
  if (call.toolName === "read_skill") {
    return extractReadSkillDetail(call.input, call.output);
  }
  return "";
}

function getSummaryTooltip(call: ChatToolCallCardProps) {
  if (call.toolName === "web_search" || call.toolName === "web_search_preview") {
    return extractWebSearchSummary(call.output)?.queries[0] ?? "";
  }
  if (CHAT_WORKSPACE_TOOL_DISPLAY_NAMES[call.toolName]) {
    return extractWorkspaceToolTitle(call.toolName, call.input, call.output);
  }
  const browserTitle = extractBrowserToolTitle(call.toolName, call.input);
  if (browserTitle) return browserTitle;
  if (call.toolName === IMAGE_GENERATION_TOOL_NAME) {
    const prompt =
      call.input && typeof call.input === "object"
        ? (call.input as { prompt?: unknown }).prompt
        : undefined;
    return typeof prompt === "string" ? headlineToolText(prompt, 400) : "";
  }
  if (call.toolName === "read_skill") {
    return extractReadSkillDetail(call.input, call.output);
  }
  return "";
}

export function getChatToolTitle(toolName: string) {
  return (
    CHAT_TOOL_DISPLAY_NAMES[toolName] ?? CHAT_WORKSPACE_TOOL_DISPLAY_NAMES[toolName] ?? toolName
  );
}

function getChatToolIcon(toolName: string): LucideIcon {
  if (toolName === "bash") return Terminal;
  if (toolName === "list_dir") return Folder;
  if (toolName === "read_file") return FileText;
  if (toolName === "write_file" || toolName === "edit_file" || toolName === "apply_patch")
    return FilePenLine;
  if (toolName === "search_files" || toolName === "web_search") return Search;
  if (toolName === "browser_open" || toolName === "browser_close") return Globe2;
  if (toolName === "browser_click") return MousePointerClick;
  if (toolName === "browser_eval") return Code2;
  if (toolName === BROWSER_SCREENSHOT_TOOL_NAME || toolName === IMAGE_GENERATION_TOOL_NAME)
    return Image;
  if (toolName === "read_skill") return Sparkles;
  return Wrench;
}

export function getChatToolSummary(call: ChatToolCallCardProps) {
  const title = getChatToolTitle(call.toolName);
  const detail = getSummaryDetail(call);
  return `${title}${detail ? ` · ${detail}` : ""}`;
}

export function getChatToolRunningSummary(call: ChatToolCallCardProps) {
  return `正在${getChatToolSummary(call)}`;
}

function isToolCallPending(call: ChatToolCallCardProps) {
  return isToolCallRunning(call) || call.state === "approval-requested";
}

function isToolCallRunning(call: ChatToolCallCardProps) {
  return call.preliminary || call.state === "input-streaming" || call.state === "input-available";
}

function getToolCallError(call: ChatToolCallCardProps) {
  if (call.errorText) return call.errorText;
  const outputError = extractToolOutputError(call.output);
  if (outputError) return outputError;
  if (call.toolName === "bash" && call.output && typeof call.output === "object") {
    const result = call.output as { success?: unknown; code?: unknown; timedOut?: unknown };
    if (result.success === false) {
      if (result.timedOut === true) return "命令执行超时";
      return typeof result.code === "number"
        ? `命令执行失败（退出码 ${result.code}）`
        : "命令执行失败";
    }
  }
  return undefined;
}

function isToolCallFailed(call: ChatToolCallCardProps) {
  return call.state === "output-error" || Boolean(getToolCallError(call));
}

export function getChatToolGroupSummary(calls: ChatToolCallCardProps[]) {
  const lastCall = calls[calls.length - 1];
  return lastCall ? getChatToolSummary(lastCall) : "";
}

export function getChatToolGroupStatus(calls: ChatToolCallCardProps[]) {
  const pendingCalls = calls.filter(isToolCallPending);
  if (
    pendingCalls.some((call) => call.state === "approval-requested" && !call.approval?.isAutomatic)
  ) {
    return "待确认";
  }
  if (pendingCalls.length > 0) return "执行中";

  const failedCalls = calls.filter(isToolCallFailed);
  if (failedCalls.length === calls.length) {
    return calls.every((call) => call.state === "output-denied") ? "已拒绝" : "失败";
  }
  return "已完成";
}

/** 业务 tool 经 withToolError 失败时返回 { error }，SDK 仍标为 output-available。 */
function extractToolOutputError(output: unknown): string | undefined {
  if (!output || typeof output !== "object") return undefined;
  const error = (output as { error?: unknown }).error;
  return typeof error === "string" && error.trim() ? error.trim() : undefined;
}

function extractJobResult(output: unknown) {
  if (!output || typeof output !== "object") return null;
  const value = output as {
    jobId?: unknown;
    status?: unknown;
    exitCode?: unknown;
    preview?: unknown;
    out?: unknown;
  };
  if (typeof value.jobId !== "string" || typeof value.status !== "string") return null;
  return {
    jobId: value.jobId,
    status: value.status,
    exitCode: typeof value.exitCode === "number" ? value.exitCode : undefined,
    preview:
      typeof value.preview === "string"
        ? value.preview
        : typeof value.out === "string"
          ? value.out
          : "",
  };
}

/** 支持 provider 搜索结果和 Chat 自有 web_search 的统一摘要格式。 */
function extractWebSearchSummary(
  output: unknown,
  input?: unknown,
): {
  actionLabel?: string;
  queries: string[];
  sources: string[];
} | null {
  if (!output || typeof output !== "object") return null;
  const record = output as {
    queries?: string[];
    action?: {
      type?: string;
      query?: string;
      queries?: string[];
      url?: string | null;
      pattern?: string | null;
    };
    sources?: Array<{ type?: string; url?: string; name?: string } | string>;
  };
  const action = record.action;
  const queries: string[] = [];
  if (Array.isArray(record.queries)) {
    for (const query of record.queries) {
      if (typeof query === "string" && query.trim()) queries.push(query.trim());
    }
  }
  if (queries.length === 0 && input && typeof input === "object") {
    const inputQueries = (input as { queries?: unknown }).queries;
    if (Array.isArray(inputQueries)) {
      for (const query of inputQueries) {
        if (typeof query === "string" && query.trim()) queries.push(query.trim());
      }
    }
  }
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
      if (typeof source === "string") return source;
      if (source.type === "url" && typeof source.url === "string") return source.url;
      if (typeof source.url === "string") return source.url;
      if (source.type === "api" && typeof source.name === "string") return source.name;
      return null;
    })
    .filter((value): value is string => Boolean(value));

  if (!action && queries.length === 0 && sources.length === 0) return null;
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
    return assetUrl(materialized.path);
  }
  if (remoteUrl) return remoteUrl;
  if (rawBase64) {
    if (rawBase64.startsWith("data:")) return rawBase64;
    return `data:${IMAGE_GENERATION_MEDIA_TYPE};base64,${rawBase64}`;
  }
  return null;
}

function resolveBrowserScreenshotSrc(output: unknown): string | null {
  const screenshot = readBrowserScreenshotOutput(output);
  if (screenshot) return assetUrl(screenshot.path);
  if (!output || typeof output !== "object") return null;
  const result = output as {
    ok?: boolean;
    data?: { path?: unknown };
  };
  if (result.ok !== true || typeof result.data?.path !== "string") return null;
  return assetUrl(result.data.path);
}

function statusLabel(options: {
  toolName: string;
  state: string;
  errorText?: string;
  approval?: ChatToolCallCardProps["approval"];
  preliminary?: boolean;
  hasImagePreview: boolean;
}) {
  const { toolName, state, errorText, approval, preliminary, hasImagePreview } = options;
  if (state === "output-error" || errorText) return "失败";
  if (toolName === IMAGE_GENERATION_TOOL_NAME) {
    if (preliminary || state === "input-streaming" || state === "input-available") {
      return hasImagePreview ? "预览中" : "生成中";
    }
    if (state === "output-available") return "成功";
    return state;
  }
  if (state === "output-denied") {
    return approval?.isAutomatic ? "Reviewer 已拒绝" : "已拒绝";
  }
  if (approval?.isAutomatic && approval.approved === true) return "Reviewer 已批准";
  if (state === "output-available") return preliminary ? "更新中" : "成功";
  if (state === "approval-requested") return "待批准";
  if (state === "approval-responded") return "已响应";
  if (state === "input-streaming" || state === "input-available") return "调用中";
  return state;
}

function renderToolIcon(options: {
  pending: boolean;
  toolIcon: LucideIcon;
  manualApproval?: boolean;
}) {
  if (options.manualApproval) return <UserRoundCheck className="size-3.5" />;
  if (options.pending) return <LoaderCircle className="size-3.5 animate-spin" />;
  const ToolIcon = options.toolIcon;
  return <ToolIcon className="size-3.5" />;
}

export function ChatToolCallCard({
  toolName,
  state,
  input,
  output,
  errorText,
  approval,
  preliminary = false,
  compact = false,
  workspaceId,
  cwd,
}: ChatToolCallCardProps) {
  const [open, setOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const title = getChatToolTitle(toolName);
  const outputError = extractToolOutputError(output);
  const job = toolName === "bash" ? extractJobResult(output) : null;
  const fileTarget = resolveWorkspaceToolFileTarget(toolName, input, output);
  const resolvedError = errorText || outputError;
  const failed = state === "output-error" || Boolean(resolvedError);
  const manualApproval = state === "approval-requested" && !approval?.isAutomatic;
  const webSearch =
    toolName === "web_search" || toolName === "web_search_preview"
      ? extractWebSearchSummary(output, input)
      : null;
  const isImageGeneration = toolName === IMAGE_GENERATION_TOOL_NAME;
  const isBrowserScreenshot = toolName === BROWSER_SCREENSHOT_TOOL_NAME;
  const imagePreviewSrc = useMemo(
    () =>
      !failed
        ? isImageGeneration
          ? resolveImagePreviewSrc(output)
          : isBrowserScreenshot
            ? resolveBrowserScreenshotSrc(output)
            : null
        : null,
    [failed, isBrowserScreenshot, isImageGeneration, output],
  );
  const imageMeta = useMemo(() => {
    if (failed) return null;
    if (isBrowserScreenshot) {
      const screenshot = readBrowserScreenshotOutput(output);
      if (!screenshot) return null;
      return {
        attachmentId: screenshot.attachmentId,
        fileName: screenshot.fileName,
        mediaType: screenshot.mediaType,
      };
    }
    if (!isImageGeneration) return null;
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
  }, [failed, isBrowserScreenshot, isImageGeneration, output]);
  const running =
    !failed && (preliminary || state === "input-streaming" || state === "input-available");
  const pending = running || (!failed && state === "approval-requested");
  const denied = state === "output-denied";
  const status = job
    ? job.status === "running" || job.status === "queued"
      ? "后台运行中"
      : job.status === "stopped"
        ? "后台任务已停止"
        : job.status === "interrupted"
          ? "后台任务已中断"
          : job.status === "exited"
            ? "后台任务已完成"
            : "后台任务失败"
    : statusLabel({
        toolName,
        state,
        errorText: resolvedError,
        approval,
        preliminary,
        hasImagePreview: Boolean(imagePreviewSrc),
      });
  const showInput = (!webSearch && !isImageGeneration) || !isEmptyInput(input);
  const callProps = {
    toolName,
    state,
    input,
    output,
    errorText,
    approval,
    preliminary,
  } satisfies ChatToolCallCardProps;
  const summaryQuery = webSearch?.queries[0] ? headlineToolText(webSearch.queries[0]) : "";
  const workspaceSummary = CHAT_WORKSPACE_TOOL_DISPLAY_NAMES[toolName]
    ? extractWorkspaceToolSummary(toolName, input, output)
    : "";
  const browserDetail = extractBrowserToolDetail(toolName, input);
  const skillDetail = toolName === "read_skill" ? extractReadSkillDetail(input, output) : "";
  const summaryTooltip = imageMeta?.fileName || getSummaryTooltip(callProps);
  const inputFields = getToolCallInputFields(toolName, input);
  const outputFields = getToolCallOutputFields(toolName, output);
  const ToolIcon = getChatToolIcon(toolName);
  const summaryTitle = running ? getChatToolRunningSummary(callProps) : title;

  function openToolFile() {
    if (!fileTarget) return;
    openFileViewer({
      mode: "source",
      path: fileTarget.path,
      workspaceId,
      cwd,
      content: fileTarget.content,
    });
  }

  function toggleOpen() {
    if (!compact) setOpen((value) => !value);
  }

  return (
    <div
      className={`chat-tool-call ${compact ? "is-compact" : ""} ${failed || denied ? "is-error" : ""} ${pending ? "is-pending" : ""}`}
    >
      {/* biome-ignore lint/a11y/noStaticElementInteractions: the summary contains an inline file link. */}
      {/* biome-ignore lint/a11y/useAriaPropsSupportedByRole: role is conditional for compact cards. */}
      <div
        aria-expanded={compact ? undefined : open}
        className="chat-tool-call-summary"
        onClick={compact ? undefined : toggleOpen}
        onKeyDown={
          compact
            ? undefined
            : (event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  toggleOpen();
                }
              }
        }
        role={compact ? undefined : "button"}
        tabIndex={compact ? undefined : 0}
      >
        <span
          className={`chat-tool-call-icon ${manualApproval ? "is-manual" : ""}`}
          title={
            manualApproval
              ? "等待人工确认"
              : failed
                ? "调用失败"
                : denied
                  ? "调用被拒绝"
                  : running
                    ? "调用中"
                    : undefined
          }
        >
          {renderToolIcon({
            pending: running,
            toolIcon: ToolIcon,
            manualApproval,
          })}
        </span>
        <span className="chat-tool-call-title" title={summaryTooltip || undefined}>
          <span className="chat-tool-call-title-name">{summaryTitle}</span>
          {!running && summaryQuery ? (
            <span className="chat-tool-call-title-detail"> · {summaryQuery}</span>
          ) : null}
          {!running && imageMeta?.fileName ? (
            <span className="chat-tool-call-title-detail"> · {imageMeta.fileName}</span>
          ) : null}
          {!running && !summaryQuery && !imageMeta?.fileName && browserDetail ? (
            <span className="chat-tool-call-title-detail"> · {browserDetail}</span>
          ) : null}
          {!running && !summaryQuery && !imageMeta?.fileName && !browserDetail && skillDetail ? (
            <span className="chat-tool-call-title-detail"> · {skillDetail}</span>
          ) : null}
          {!running && job ? (
            <span className="chat-tool-call-title-detail"> · Job {job.jobId.slice(0, 8)}</span>
          ) : null}
          {!running && workspaceSummary ? (
            fileTarget ? (
              <>
                <span className="chat-tool-call-title-detail"> · </span>
                <a
                  aria-label={`打开文件 ${fileTarget.path}`}
                  className="chat-tool-call-title-detail chat-tool-call-file-link"
                  href={`#file:${fileTarget.path}`}
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    openToolFile();
                  }}
                  title={fileTarget.path}
                >
                  {getLastPathSegment(fileTarget.path)}
                </a>
              </>
            ) : (
              <span className="chat-tool-call-title-detail">{workspaceSummary}</span>
            )
          ) : null}
        </span>
        <span className="chat-tool-call-status">{status}</span>
        {!compact ? (
          <ChevronDown className={`chat-tool-call-chevron ${open ? "is-open" : ""}`} />
        ) : null}
      </div>
      {imagePreviewSrc && !failed ? (
        <div className="chat-tool-call-preview px-3 pb-2">
          {preliminary ? (
            <p className="mb-1.5 text-[11px] text-muted-foreground">中间预览，仍在生成…</p>
          ) : null}
          <button
            aria-label="查看大图"
            className="block max-w-full cursor-zoom-in rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            type="button"
            onClick={() => setPreviewOpen(true)}
          >
            <img
              alt={
                isBrowserScreenshot
                  ? "browser screenshot"
                  : (imageMeta?.fileName ?? "generated image")
              }
              className={`max-h-64 max-w-full rounded-md object-contain ${
                preliminary ? "opacity-90" : ""
              }`}
              src={imagePreviewSrc}
            />
          </button>
          <Dialog onOpenChange={setPreviewOpen} open={previewOpen}>
            <DialogContent className="max-h-[95vh] max-w-[min(96vw,1400px)] overflow-hidden border-0 bg-black/95 p-2">
              <DialogTitle className="sr-only">查看大图</DialogTitle>
              <img
                alt={
                  isBrowserScreenshot
                    ? "browser screenshot"
                    : (imageMeta?.fileName ?? "generated image")
                }
                className="max-h-[90vh] w-full object-contain"
                src={imagePreviewSrc}
              />
            </DialogContent>
          </Dialog>
        </div>
      ) : null}
      {open && !compact ? (
        <div className={`chat-tool-call-body ${toolName === "bash" ? "is-shell" : ""}`}>
          {showInput ? (
            <div className="chat-tool-call-section">
              <p className="chat-tool-call-label">{toolName === "bash" ? "命令" : "参数"}</p>
              {inputFields ? (
                <ToolCallFields fields={inputFields} />
              ) : (
                <CollapsiblePre text={formatToolJson(input)} />
              )}
            </div>
          ) : null}
          {webSearch && (webSearch.queries.length > 0 || webSearch.sources.length > 0) ? (
            <div className="chat-tool-call-section">
              <p className="chat-tool-call-label">搜索</p>
              <CollapsiblePre
                text={formatToolJson({
                  ...(webSearch.actionLabel ? { action: webSearch.actionLabel } : {}),
                  ...(webSearch.queries.length > 0 ? { queries: webSearch.queries } : {}),
                  ...(webSearch.sources.length > 0 ? { sources: webSearch.sources } : {}),
                })}
              />
            </div>
          ) : null}
          {approval?.reason ? (
            <div className="chat-tool-call-section">
              <p className="chat-tool-call-label">审批理由</p>
              <CollapsiblePre text={approval.reason} />
            </div>
          ) : null}
          <div className="chat-tool-call-section">
            <p className="chat-tool-call-label">
              {failed ? "错误" : toolName === "bash" ? "输出" : "结果"}
            </p>
            {failed ? (
              <CollapsiblePre text={resolvedError ?? formatToolJson(output)} />
            ) : isImageGeneration ? (
              <CollapsiblePre
                text={formatToolJson(
                  imageMeta ?? {
                    note: imagePreviewSrc
                      ? preliminary
                        ? "中间预览见上方，最终图生成中"
                        : "图片预览见上方"
                      : "暂无图片输出",
                  },
                )}
              />
            ) : job ? (
              <CollapsiblePre
                text={formatToolJson({
                  jobId: job.jobId,
                  status: job.status,
                  ...(job.exitCode !== undefined ? { exitCode: job.exitCode } : {}),
                  ...(job.preview ? { preview: job.preview } : {}),
                })}
              />
            ) : fileTarget ? (
              <button
                className="chat-tool-call-open-file"
                onClick={openToolFile}
                title={fileTarget.path}
                type="button"
              >
                {getLastPathSegment(fileTarget.path)}
              </button>
            ) : outputFields ? (
              <ToolCallFields fields={outputFields} />
            ) : (
              <CollapsiblePre text={formatToolJson(output)} />
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function ChatToolCallGroup({
  calls,
  active = false,
  workspaceId,
  cwd,
}: ChatToolCallGroupProps) {
  const [open, setOpen] = useState(false);
  const activeCall = calls[calls.length - 1];
  if (!activeCall) return null;
  if (calls.length === 1) {
    return <ChatToolCallCard {...activeCall} cwd={cwd} workspaceId={workspaceId} />;
  }
  const running = calls.some(isToolCallRunning);
  const pending = calls.some(isToolCallPending);
  const hasError =
    !pending && calls.every((call) => isToolCallFailed(call) || call.state === "output-denied");
  const manualApproval =
    activeCall.state === "approval-requested" && !activeCall.approval?.isAutomatic;
  const ToolIcon = calls.length === 1 ? getChatToolIcon(activeCall.toolName) : Wrench;
  const summary = getChatToolGroupSummary(calls);
  const status = getChatToolGroupStatus(calls);
  const displaySummary = running ? getChatToolRunningSummary(activeCall) : summary;
  const summaryTooltip = getSummaryTooltip(activeCall);

  return (
    <div
      className={`chat-tool-call-group ${active ? "is-active" : ""} ${pending ? "is-pending" : ""} ${hasError ? "is-error" : ""}`}
    >
      <button
        aria-expanded={open}
        className="chat-tool-call-group-summary"
        onClick={() => setOpen((value) => !value)}
        type="button"
      >
        <span
          className={`chat-tool-call-icon ${manualApproval ? "is-manual" : ""}`}
          title={
            manualApproval
              ? "等待人工确认"
              : hasError
                ? "包含失败的调用"
                : running
                  ? "调用中"
                  : undefined
          }
        >
          {renderToolIcon({
            pending: active && running,
            toolIcon: ToolIcon,
            manualApproval,
          })}
        </span>
        <span className="chat-tool-call-title" title={summaryTooltip || displaySummary}>
          {displaySummary}
        </span>
        {status !== "已完成" ? <span className="chat-tool-call-status">{status}</span> : null}
        <ChevronDown className={`chat-tool-call-chevron ${open ? "is-open" : ""}`} />
      </button>
      {open ? (
        <ScrollAreaPrimitive.Root className="chat-tool-call-group-items" type="always">
          <ScrollAreaPrimitive.Viewport className="chat-tool-call-group-viewport">
            {calls.map((call) => (
              <ChatToolCallCard
                key={call.id ?? call.toolName}
                {...call}
                cwd={cwd}
                workspaceId={workspaceId}
              />
            ))}
          </ScrollAreaPrimitive.Viewport>
          <ScrollAreaPrimitive.Scrollbar
            className="chat-tool-call-group-scrollbar"
            orientation="vertical"
          >
            <ScrollAreaPrimitive.Thumb className="chat-tool-call-group-scrollbar-thumb" />
          </ScrollAreaPrimitive.Scrollbar>
        </ScrollAreaPrimitive.Root>
      ) : null}
    </div>
  );
}
