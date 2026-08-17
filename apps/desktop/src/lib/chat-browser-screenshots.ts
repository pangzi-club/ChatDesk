import { getToolName, isToolUIPart, type UIMessage } from "ai";

import type { ChatAttachment } from "@/lib/chat-store";

export const BROWSER_SCREENSHOT_TOOL_NAME = "browser_screenshot";
export const BROWSER_SCREENSHOT_MEDIA_TYPE = "image/png";

export type BrowserScreenshotOutput = {
  attachmentId: string;
  fileName: string;
  path: string;
  mediaType: string;
  width?: number;
  height?: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

/** 从 browser_screenshot tool output 读取已落盘的附件信息。 */
export function readBrowserScreenshotOutput(output: unknown): BrowserScreenshotOutput | null {
  if (!isRecord(output) || output.ok !== true) return null;
  const data = isRecord(output.data) ? output.data : output;
  const attachmentId =
    typeof data.attachmentId === "string" && data.attachmentId.trim()
      ? data.attachmentId.trim()
      : undefined;
  const filePath = typeof data.path === "string" && data.path.trim() ? data.path.trim() : undefined;
  if (!attachmentId || !filePath) return null;
  const mediaType =
    typeof data.mimeType === "string" && data.mimeType.trim()
      ? data.mimeType.trim()
      : BROWSER_SCREENSHOT_MEDIA_TYPE;
  const fileName =
    typeof data.fileName === "string" && data.fileName.trim()
      ? data.fileName.trim()
      : `${attachmentId}.png`;
  return {
    attachmentId,
    fileName,
    path: filePath,
    mediaType,
    ...(typeof data.width === "number" ? { width: data.width } : {}),
    ...(typeof data.height === "number" ? { height: data.height } : {}),
  };
}

function mergeAttachments(
  existing: ChatAttachment[],
  incoming: ChatAttachment[],
): ChatAttachment[] {
  if (incoming.length === 0) return existing;
  const byId = new Map(existing.map((item) => [item.id, item]));
  for (const item of incoming) {
    byId.set(item.id, item);
  }
  return [...byId.values()];
}

/** 把已落盘的 browser_screenshot 结果合并进 session.attachments，不重复上传。 */
export function materializeBrowserScreenshots(
  messages: UIMessage[],
  existingAttachments: ChatAttachment[] = [],
): { attachments: ChatAttachment[]; changed: boolean } {
  const created: ChatAttachment[] = [];
  const seen = new Set(existingAttachments.map((item) => item.id));
  const now = new Date().toISOString();

  for (const message of messages) {
    for (const part of message.parts) {
      if (!isToolUIPart(part) || getToolName(part) !== BROWSER_SCREENSHOT_TOOL_NAME) continue;
      if (!("output" in part) || part.output === undefined) continue;
      const screenshot = readBrowserScreenshotOutput(part.output);
      if (!screenshot || seen.has(screenshot.attachmentId)) continue;
      seen.add(screenshot.attachmentId);
      created.push({
        id: screenshot.attachmentId,
        kind: "image",
        mediaType: screenshot.mediaType,
        fileName: screenshot.fileName,
        path: screenshot.path,
        source: "generated",
        createdAt: now,
        ...(screenshot.width !== undefined ? { width: screenshot.width } : {}),
        ...(screenshot.height !== undefined ? { height: screenshot.height } : {}),
      });
    }
  }

  if (created.length === 0) return { attachments: existingAttachments, changed: false };
  return { attachments: mergeAttachments(existingAttachments, created), changed: true };
}
