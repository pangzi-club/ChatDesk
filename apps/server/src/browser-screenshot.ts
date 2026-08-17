import { randomUUID } from "node:crypto";
import { copyFile, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { compressChatImage, replaceImageFileName } from "./image-compress.ts";

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

function sanitizeAttachmentFileName(fileName: string) {
  return fileName.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 180) || "attachment";
}

export function retargetScreenshotAttachment(
  target: ScreenshotAttachmentTarget,
  fileName: string,
): ScreenshotAttachmentTarget {
  return {
    ...target,
    fileName,
    path: path.join(
      path.dirname(target.path),
      `${target.attachmentId}-${sanitizeAttachmentFileName(fileName)}`,
    ),
  };
}

async function writeAttachmentFile(targetPath: string, bytes: Uint8Array) {
  await mkdir(path.dirname(targetPath), { recursive: true });
  const temporary = `${targetPath}.tmp`;
  await writeFile(temporary, bytes);
  await rename(temporary, targetPath);
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

  const original = await readFile(target.path).catch(() => null);
  if (!original) return decorateScreenshotResult(result, target);

  const compressed = await compressChatImage(original);
  let next = target;
  if (compressed.changed) {
    const nextName = compressed.mediaType
      ? replaceImageFileName(target.fileName, compressed.mediaType)
      : target.fileName;
    next = retargetScreenshotAttachment(target, nextName);
    await writeAttachmentFile(next.path, compressed.bytes);
    if (path.resolve(next.path) !== path.resolve(target.path)) {
      await unlink(target.path).catch(() => undefined);
    }
  }

  return decorateScreenshotResult(
    {
      ...result,
      data: {
        ...data,
        ...(compressed.mediaType ? { mimeType: compressed.mediaType } : {}),
        ...(compressed.width ? { width: compressed.width } : {}),
        ...(compressed.height ? { height: compressed.height } : {}),
      },
    },
    next,
  );
}
