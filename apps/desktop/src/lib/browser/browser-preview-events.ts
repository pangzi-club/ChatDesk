import { createWindowEventBus } from "@/lib/runtime/window-event-bus";

export type BrowserPreviewOpenRequest = {
  frameName?: string;
  newTab?: boolean;
  source?: "frame";
  url: string;
};

const browserPreviewBus = createWindowEventBus<BrowserPreviewOpenRequest>(
  "chatdesk:browser-preview-open",
);

export function openBrowserPreview(request: BrowserPreviewOpenRequest) {
  browserPreviewBus.dispatch(request);
}

export function subscribeBrowserPreviewOpen(
  listener: (request: BrowserPreviewOpenRequest) => void,
) {
  return browserPreviewBus.subscribe(listener);
}
