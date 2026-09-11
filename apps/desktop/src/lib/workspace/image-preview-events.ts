import { createWindowEventBus } from "@/lib/runtime/window-event-bus";

export type ImagePreviewOpenRequest = {
  url: string;
  filename?: string;
  mediaType?: string;
};

const imagePreviewBus = createWindowEventBus<ImagePreviewOpenRequest>(
  "chatdesk:image-preview-open",
);

export function openImagePreview(request: ImagePreviewOpenRequest) {
  imagePreviewBus.dispatch(request);
}

export function subscribeImagePreviewOpen(listener: (request: ImagePreviewOpenRequest) => void) {
  return imagePreviewBus.subscribe(listener);
}
