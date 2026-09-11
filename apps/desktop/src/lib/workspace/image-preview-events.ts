export type ImagePreviewOpenRequest = {
  url: string;
  filename?: string;
  mediaType?: string;
};

const EVENT_NAME = "chatdesk:image-preview-open";

export function openImagePreview(request: ImagePreviewOpenRequest) {
  window.dispatchEvent(new CustomEvent<ImagePreviewOpenRequest>(EVENT_NAME, { detail: request }));
}

export function subscribeImagePreviewOpen(listener: (request: ImagePreviewOpenRequest) => void) {
  const handler = (event: Event) => {
    const detail = (event as CustomEvent<ImagePreviewOpenRequest>).detail;
    if (detail) listener(detail);
  };
  window.addEventListener(EVENT_NAME, handler);
  return () => window.removeEventListener(EVENT_NAME, handler);
}
