import { randomUUID } from "node:crypto";
import { copyFile, mkdir, unlink } from "node:fs/promises";
import path from "node:path";

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
