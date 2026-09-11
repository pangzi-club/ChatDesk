import { createWindowEventBus } from "@/lib/runtime/window-event-bus";

export type FileViewerOpenRequest = {
  mode: "source" | "diff";
  path: string;
  workspaceId?: string;
  cwd?: string;
  content?: string;
};

const fileViewerBus = createWindowEventBus<FileViewerOpenRequest>("chatdesk:file-viewer-open");

export function openFileViewer(request: FileViewerOpenRequest) {
  fileViewerBus.dispatch(request);
}

export function subscribeFileViewerOpen(listener: (request: FileViewerOpenRequest) => void) {
  return fileViewerBus.subscribe(listener);
}
