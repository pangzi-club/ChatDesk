import {
  AlertCircle,
  FileAudio,
  FileText,
  FileVideo,
  Image as ImageIcon,
  LoaderCircle,
  X,
} from "lucide-react";

import {
  type ChatAttachmentKind,
  formatAttachmentSize,
  type PendingAttachment,
} from "@/lib/chat-attachments";

type ChatAttachmentChipsProps = {
  attachments: PendingAttachment[];
  onPreview?: (attachment: PendingAttachment) => void;
  onRemove: (localId: string) => void;
};

function kindIcon(kind: ChatAttachmentKind) {
  if (kind === "image") return <ImageIcon className="size-3.5" />;
  if (kind === "video") return <FileVideo className="size-3.5" />;
  if (kind === "audio") return <FileAudio className="size-3.5" />;
  return <FileText className="size-3.5" />;
}

export function ChatAttachmentChips({
  attachments,
  onPreview,
  onRemove,
}: ChatAttachmentChipsProps) {
  if (attachments.length === 0) return null;
  return (
    <div className="chat-attachment-chips">
      {attachments.map((attachment) => {
        const previewable = Boolean(attachment.previewUrl && onPreview);
        const thumb = attachment.previewUrl ? (
          <img
            alt={attachment.fileName}
            className="chat-attachment-thumb"
            src={attachment.previewUrl}
          />
        ) : (
          <span className="chat-attachment-icon">{kindIcon(attachment.kind)}</span>
        );
        const meta = (
          <span className="chat-attachment-meta">
            <span className="chat-attachment-name" title={attachment.fileName}>
              {attachment.fileName}
            </span>
            <span className="chat-attachment-size">{formatAttachmentSize(attachment.size)}</span>
          </span>
        );
        return (
          <div
            className="chat-attachment-chip"
            data-status={attachment.status}
            key={attachment.localId}
          >
            {previewable ? (
              <button
                aria-label={`预览 ${attachment.fileName}`}
                className="chat-attachment-preview"
                onClick={() => onPreview?.(attachment)}
                title={`预览 ${attachment.fileName}`}
                type="button"
              >
                {thumb}
                {meta}
              </button>
            ) : (
              <>
                {thumb}
                {meta}
              </>
            )}
            {attachment.status === "uploading" ? (
              <LoaderCircle className="chat-attachment-spinner size-3.5 animate-spin" />
            ) : attachment.status === "error" ? (
              <AlertCircle className="chat-attachment-error-icon size-3.5" />
            ) : null}
            <button
              aria-label={`移除 ${attachment.fileName}`}
              className="chat-attachment-remove"
              onClick={() => onRemove(attachment.localId)}
              type="button"
            >
              <X className="size-3" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
