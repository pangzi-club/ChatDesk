import type { ChatAttachment, ChatAttachmentKind } from "@chatdesk/shared";

import { writeChatAttachment } from "@/lib/chat-store";

export type { ChatAttachmentKind };

/** 单文件大小上限（20MB）。 */
export const MAX_ATTACHMENT_SIZE = 20 * 1024 * 1024;
/** 单次待发附件数量上限。 */
export const MAX_ATTACHMENT_COUNT = 9;

export type PendingAttachmentStatus = "uploading" | "ready" | "error";

/** 一个已选择/拖入但尚未随消息发送的附件。 */
export type PendingAttachment = {
  /** 本地临时 id，用于列表渲染与状态更新。 */
  localId: string;
  file: File;
  fileName: string;
  mediaType: string;
  size: number;
  kind: ChatAttachmentKind;
  /** 图片附件的本地预览 objectURL，移除时需 revoke。 */
  previewUrl?: string;
  status: PendingAttachmentStatus;
  /** 上传成功后的服务端附件 id。 */
  attachmentId?: string;
  /** 上传成功后的落盘路径。 */
  path?: string;
  error?: string;
};

const EXTENSION_MEDIA_TYPES: Record<string, string> = {
  pdf: "application/pdf",
  txt: "text/plain",
  md: "text/markdown",
  csv: "text/csv",
  json: "application/json",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  zip: "application/zip",
};

export function inferAttachmentKind(mediaType: string): ChatAttachmentKind {
  if (mediaType.startsWith("image/")) return "image";
  if (mediaType.startsWith("video/")) return "video";
  if (mediaType.startsWith("audio/")) return "audio";
  return "file";
}

/** 优先用浏览器给出的 File.type，未知类型按扩展名兜底。 */
export function resolveMediaType(file: File): string {
  if (file.type) return file.type;
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  return EXTENSION_MEDIA_TYPES[extension] ?? "application/octet-stream";
}

export function formatAttachmentSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"] as const;
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 100 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}

/** 校验能否加入待发队列，返回错误文案；可加入返回 null。 */
export function validateAttachment(file: File, currentCount: number): string | null {
  if (currentCount >= MAX_ATTACHMENT_COUNT) return `一次最多添加 ${MAX_ATTACHMENT_COUNT} 个文件`;
  if (file.size > MAX_ATTACHMENT_SIZE)
    return `「${file.name}」超过 ${formatAttachmentSize(MAX_ATTACHMENT_SIZE)} 上限`;
  return null;
}

export function createPendingAttachment(file: File): PendingAttachment {
  const mediaType = resolveMediaType(file);
  return {
    localId: crypto.randomUUID(),
    file,
    fileName: file.name,
    mediaType,
    size: file.size,
    kind: inferAttachmentKind(mediaType),
    previewUrl: mediaType.startsWith("image/") ? URL.createObjectURL(file) : undefined,
    status: "uploading",
  };
}

/** 上传单个待发附件，返回可并入 session.attachments 的元数据。 */
export async function uploadPendingAttachment(
  sessionId: string,
  pending: PendingAttachment,
): Promise<ChatAttachment> {
  const bytes = new Uint8Array(await pending.file.arrayBuffer());
  const attachmentId = crypto.randomUUID();
  const path = await writeChatAttachment(sessionId, attachmentId, bytes, pending.fileName);
  return {
    id: attachmentId,
    kind: pending.kind,
    mediaType: pending.mediaType,
    fileName: pending.fileName,
    size: pending.size,
    path: path ?? "",
    source: "upload",
    createdAt: new Date().toISOString(),
  };
}

/** 按 id 合并附件元数据（与 chat-image-generation 的 mergeAttachments 同一约定）。 */
export function mergeChatAttachments(
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
