import { getToolName, isToolUIPart, type UIMessage } from "ai";

import { type ChatAttachment, writeChatAttachment } from "@/lib/chat-store";
import { downloadGeneratedImage } from "@/lib/image-generation";

export const IMAGE_GENERATION_TOOL_NAME = "image_generation";
export const IMAGE_GENERATION_MEDIA_TYPE = "image/png";

export type MaterializedImageOutput = {
  attachmentId: string;
  mediaType: string;
  fileName: string;
  path?: string;
  url?: string;
  taskId?: string;
  sourceUrl?: string;
};

export type MaterializeGeneratedImagesResult = {
  messages: UIMessage[];
  attachments: ChatAttachment[];
  changed: boolean;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

function decodeBase64(base64: string): Uint8Array {
  const normalized = base64.includes(",") ? (base64.split(",").pop() ?? base64) : base64;
  const binary = atob(normalized);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function guessMediaType(url: string, fallback = IMAGE_GENERATION_MEDIA_TYPE): string {
  const lower = url.toLowerCase();
  if (lower.includes(".jpg") || lower.includes(".jpeg")) return "image/jpeg";
  if (lower.includes(".webp")) return "image/webp";
  if (lower.includes(".gif")) return "image/gif";
  if (lower.includes(".png")) return "image/png";
  return fallback;
}

function extensionForMediaType(mediaType: string): string {
  if (mediaType === "image/jpeg") return "jpg";
  if (mediaType === "image/webp") return "webp";
  if (mediaType === "image/gif") return "gif";
  return "png";
}

/** 从 tool output 读取已物化、远程 URL 或原始 base64 图片信息。 */
export function readImageGenerationOutput(output: unknown): {
  rawBase64?: string;
  remoteUrl?: string;
  taskId?: string;
  materialized?: MaterializedImageOutput;
} {
  if (!isRecord(output)) return {};
  if (typeof output.error === "string" && output.error.trim()) return {};

  const attachmentId =
    typeof output.attachmentId === "string" && output.attachmentId.trim()
      ? output.attachmentId.trim()
      : undefined;
  const mediaType =
    typeof output.mediaType === "string" && output.mediaType.trim()
      ? output.mediaType.trim()
      : IMAGE_GENERATION_MEDIA_TYPE;
  const fileName =
    typeof output.fileName === "string" && output.fileName.trim()
      ? output.fileName.trim()
      : undefined;
  const path =
    typeof output.path === "string" && output.path.trim() ? output.path.trim() : undefined;
  const url = typeof output.url === "string" && output.url.trim() ? output.url.trim() : undefined;
  const taskId =
    typeof output.taskId === "string" && output.taskId.trim() ? output.taskId.trim() : undefined;
  const result =
    typeof output.result === "string" && output.result.trim() ? output.result.trim() : undefined;
  const urls = Array.isArray(output.urls)
    ? output.urls.filter(
        (item): item is string => typeof item === "string" && item.trim().length > 0,
      )
    : [];

  if (attachmentId && (path || url) && !result) {
    return {
      taskId,
      materialized: {
        attachmentId,
        mediaType,
        fileName: fileName ?? `${attachmentId}.png`,
        ...(path ? { path } : {}),
        ...(url ? { url } : {}),
        ...(taskId ? { taskId } : {}),
        ...(typeof output.sourceUrl === "string" && output.sourceUrl.trim()
          ? { sourceUrl: output.sourceUrl.trim() }
          : {}),
      },
    };
  }

  if (result) {
    return { rawBase64: result, taskId };
  }

  const remoteUrl = url?.startsWith("http") ? url : urls.find((item) => item.startsWith("http"));
  if (remoteUrl) {
    return { remoteUrl, taskId };
  }

  if (url?.startsWith("data:")) {
    return { rawBase64: url, taskId };
  }

  return { taskId };
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

/** 将 image_generation 结果落盘（Tauri）或转为 data URL（Web），并改写 message parts。 */
export async function materializeGeneratedImages(
  sessionId: string,
  messages: UIMessage[],
  existingAttachments: ChatAttachment[] = [],
): Promise<MaterializeGeneratedImagesResult> {
  let changed = false;
  const created: ChatAttachment[] = [];
  const nextMessages: UIMessage[] = [];

  for (const message of messages) {
    let messageChanged = false;
    const nextParts: UIMessage["parts"] = [];

    for (const part of message.parts) {
      if (!isToolUIPart(part) || getToolName(part) !== IMAGE_GENERATION_TOOL_NAME) {
        nextParts.push(part);
        continue;
      }

      if (!("output" in part) || part.output === undefined) {
        nextParts.push(part);
        continue;
      }

      const { rawBase64, remoteUrl, materialized, taskId } = readImageGenerationOutput(part.output);
      if (materialized || (!rawBase64 && !remoteUrl)) {
        nextParts.push(part);
        continue;
      }

      const attachmentId = crypto.randomUUID();
      let bytes: Uint8Array;
      let mediaType = IMAGE_GENERATION_MEDIA_TYPE;
      let sourceUrl: string | undefined;

      if (rawBase64) {
        bytes = decodeBase64(rawBase64);
      } else if (remoteUrl) {
        sourceUrl = remoteUrl;
        mediaType = guessMediaType(remoteUrl);
        const blob = await downloadGeneratedImage(remoteUrl);
        mediaType = blob.type || mediaType;
        bytes = new Uint8Array(await blob.arrayBuffer());
      } else {
        nextParts.push(part);
        continue;
      }

      const fileName = `${attachmentId}.${extensionForMediaType(mediaType)}`;
      const uploaded = await writeChatAttachment(sessionId, attachmentId, bytes, fileName);
      const savedMediaType = uploaded.mediaType || mediaType;
      const savedFileName = uploaded.fileName || fileName;
      const path = uploaded.path;
      const now = new Date().toISOString();
      const output: MaterializedImageOutput = {
        attachmentId,
        mediaType: savedMediaType,
        fileName: savedFileName,
        ...(path ? { path } : { url: `data:${savedMediaType};base64,${bytesToBase64(bytes)}` }),
        ...(taskId ? { taskId } : {}),
        ...(sourceUrl ? { sourceUrl } : {}),
      };

      created.push({
        id: attachmentId,
        kind: "image",
        mediaType: savedMediaType,
        fileName: savedFileName,
        size: uploaded.size ?? bytes.byteLength,
        path: path ?? "",
        source: "generated",
        createdAt: now,
        ...(uploaded.width ? { width: uploaded.width } : {}),
        ...(uploaded.height ? { height: uploaded.height } : {}),
      });

      nextParts.push({
        ...part,
        output,
      } as UIMessage["parts"][number]);
      messageChanged = true;
      changed = true;
    }

    nextMessages.push(messageChanged ? { ...message, parts: nextParts } : message);
  }

  return {
    messages: nextMessages,
    attachments: mergeAttachments(existingAttachments, created),
    changed,
  };
}
