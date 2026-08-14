export type BrowserPreviewOpenRequest = {
  url: string;
};

const EVENT_NAME = "chatdesk:browser-preview-open";

export function openBrowserPreview(request: BrowserPreviewOpenRequest) {
  window.dispatchEvent(new CustomEvent<BrowserPreviewOpenRequest>(EVENT_NAME, { detail: request }));
}

export function subscribeBrowserPreviewOpen(
  listener: (request: BrowserPreviewOpenRequest) => void,
) {
  const handler = (event: Event) => {
    const detail = (event as CustomEvent<BrowserPreviewOpenRequest>).detail;
    if (detail) listener(detail);
  };
  window.addEventListener(EVENT_NAME, handler);
  return () => window.removeEventListener(EVENT_NAME, handler);
}
