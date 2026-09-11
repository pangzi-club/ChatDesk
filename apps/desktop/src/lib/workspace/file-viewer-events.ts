export type FileViewerOpenRequest = {
  mode: "source" | "diff";
  path: string;
  workspaceId?: string;
  cwd?: string;
  content?: string;
};

const EVENT_NAME = "chatdesk:file-viewer-open";

export function openFileViewer(request: FileViewerOpenRequest) {
  window.dispatchEvent(new CustomEvent<FileViewerOpenRequest>(EVENT_NAME, { detail: request }));
}

export function subscribeFileViewerOpen(listener: (request: FileViewerOpenRequest) => void) {
  const handler = (event: Event) => {
    const detail = (event as CustomEvent<FileViewerOpenRequest>).detail;
    if (detail) listener(detail);
  };
  window.addEventListener(EVENT_NAME, handler);
  return () => window.removeEventListener(EVENT_NAME, handler);
}
