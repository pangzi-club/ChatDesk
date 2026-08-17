import { randomUUID } from "node:crypto";
import { copyFile, mkdir, readFile, unlink } from "node:fs/promises";
import path from "node:path";
import { getToolName, isToolUIPart, type ToolResultPart, type UIMessage } from "ai";

export type ScreenshotAttachmentStore = {
  attachmentPath(sessionId: string, attachmentId: string, fileName: string): string;
};

export type ScreenshotAttachmentTarget = {
  attachmentId: string;
  fileName: string;
  path: string;
};

export type BrowserToolResult = {
  ok: boolean;
  sessionId?: string;
  data?: unknown;
  code?: string;
  message?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

export function createScreenshotAttachmentTarget(
  store: ScreenshotAttachmentStore,
  chatSessionId: string,
  options: { now?: number; id?: string } = {},
): ScreenshotAttachmentTarget {
  const attachmentId = options.id ?? randomUUID();
  const fileName = `screenshot-${options.now ?? Date.now()}.png`;
  return {
    attachmentId,
    fileName,
    path: store.attachmentPath(chatSessionId, attachmentId, fileName),
  };
}

export function decorateScreenshotResult(
  result: BrowserToolResult,
  target: ScreenshotAttachmentTarget,
): BrowserToolResult {
  if (!result.ok) return result;
  const data = isRecord(result.data) ? result.data : {};
  return {
    ...result,
    data: {
      ...data,
      path: target.path,
      attachmentId: target.attachmentId,
      fileName: target.fileName,
      mimeType: typeof data.mimeType === "string" ? data.mimeType : "image/png",
    },
  };
}

export async function persistScreenshotResult(
  result: BrowserToolResult,
  target: ScreenshotAttachmentTarget,
): Promise<BrowserToolResult> {
  if (!result.ok) return result;
  const data = isRecord(result.data) ? result.data : {};
  const source = typeof data.path === "string" ? data.path.trim() : "";
  await mkdir(path.dirname(target.path), { recursive: true });
  if (source && path.resolve(source) !== path.resolve(target.path)) {
    await copyFile(source, target.path);
    await unlink(source).catch(() => undefined);
  }
  return decorateScreenshotResult(result, target);
}

export const BROWSER_SCREENSHOT_TOOL_NAME = "browser_screenshot";

export type ScreenshotFileUiPart = {
  type: "file";
  mediaType: string;
  filename: string;
  url: string;
};

export type ScreenshotModelOutput = ToolResultPart["output"];

function toJsonToolOutput(value: unknown): ScreenshotModelOutput {
  if (value === undefined) return { type: "json", value: null };
  try {
    return { type: "json", value: JSON.parse(JSON.stringify(value)) };
  } catch {
    return { type: "json", value: String(value) };
  }
}

function screenshotSummary(result: BrowserToolResult) {
  const data = isRecord(result.data) ? result.data : {};
  return {
    ok: result.ok,
    sessionId: result.sessionId,
    path: typeof data.path === "string" ? data.path : undefined,
    attachmentId: typeof data.attachmentId === "string" ? data.attachmentId : undefined,
    fileName: typeof data.fileName === "string" ? data.fileName : undefined,
    mimeType: typeof data.mimeType === "string" ? data.mimeType : "image/png",
    width: typeof data.width === "number" ? data.width : undefined,
    height: typeof data.height === "number" ? data.height : undefined,
  };
}

/** 与用户上传图片相同的 file part：data URL + mediaType + filename。 */
export async function screenshotFileUiPart(output: unknown): Promise<ScreenshotFileUiPart | null> {
  if (!isRecord(output)) return null;
  const result = output as BrowserToolResult;
  if (!result.ok) return null;
  const summary = screenshotSummary(result);
  const imagePath = summary.path?.trim() ?? "";
  if (!imagePath) return null;
  try {
    const bytes = await readFile(imagePath);
    const mediaType = summary.mimeType;
    return {
      type: "file",
      mediaType,
      filename: summary.fileName ?? "screenshot.png",
      url: `data:${mediaType};base64,${bytes.toString("base64")}`,
    };
  } catch {
    return null;
  }
}

function hasMatchingFilePart(parts: UIMessage["parts"], file: ScreenshotFileUiPart) {
  return parts.some(
    (part) => part.type === "file" && "filename" in part && part.filename === file.filename,
  );
}

/** 把截图附件转成与用户上传相同的 file part，供 convertToModelMessages 使用。 */
export async function appendScreenshotFileParts(messages: UIMessage[]): Promise<UIMessage[]> {
  const next: UIMessage[] = [];
  let changed = false;
  for (const message of messages) {
    if (message.role !== "assistant") {
      next.push(message);
      continue;
    }

    const parts: UIMessage["parts"] = [];
    let messageChanged = false;
    for (const part of message.parts) {
      parts.push(part);
      if (!isToolUIPart(part) || getToolName(part) !== BROWSER_SCREENSHOT_TOOL_NAME) continue;
      if (!("output" in part) || part.output === undefined) continue;
      const file = await screenshotFileUiPart(part.output);
      if (!file || hasMatchingFilePart(parts, file) || hasMatchingFilePart(message.parts, file)) {
        continue;
      }
      parts.push(file);
      messageChanged = true;
      changed = true;
    }
    next.push(messageChanged ? { ...message, parts } : message);
  }
  return changed ? next : messages;
}

export async function screenshotResultToModelOutput(
  output: unknown,
): Promise<ScreenshotModelOutput> {
  if (!isRecord(output)) return toJsonToolOutput(output);
  const result = output as BrowserToolResult;
  if (!result.ok) return toJsonToolOutput(result);

  const summary = screenshotSummary(result);
  const file = await screenshotFileUiPart(output);
  if (!file) {
    return {
      type: "content",
      value: [
        {
          type: "text",
          text: `${JSON.stringify(summary)}\n截图文件无法读取，模型看不到画面。`,
        },
      ],
    };
  }

  return {
    type: "content",
    value: [
      { type: "text", text: JSON.stringify(summary) },
      {
        type: "file",
        mediaType: file.mediaType,
        filename: file.filename,
        data: { type: "url", url: new URL(file.url) },
      },
    ],
  };
}
