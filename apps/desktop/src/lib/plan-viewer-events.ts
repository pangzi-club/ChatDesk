export type PlanViewerOpenRequest = {
  sessionId: string;
  planId: string;
  fileName: string;
  content: string;
};

export type PlanViewerUpdatedRequest = PlanViewerOpenRequest;

const EVENT_NAME = "chatdesk:plan-viewer-open";

export function openPlanViewer(request: PlanViewerOpenRequest) {
  window.dispatchEvent(new CustomEvent<PlanViewerOpenRequest>(EVENT_NAME, { detail: request }));
}

export function subscribePlanViewerOpen(listener: (request: PlanViewerOpenRequest) => void) {
  const handler = (event: Event) => {
    const detail = (event as CustomEvent<PlanViewerOpenRequest>).detail;
    if (detail) listener(detail);
  };
  window.addEventListener(EVENT_NAME, handler);
  return () => window.removeEventListener(EVENT_NAME, handler);
}

const UPDATED_EVENT_NAME = "chatdesk:plan-viewer-updated";

export function updatePlanViewer(request: PlanViewerUpdatedRequest) {
  window.dispatchEvent(
    new CustomEvent<PlanViewerUpdatedRequest>(UPDATED_EVENT_NAME, { detail: request }),
  );
}

export function subscribePlanViewerUpdated(listener: (request: PlanViewerUpdatedRequest) => void) {
  const handler = (event: Event) => {
    const detail = (event as CustomEvent<PlanViewerUpdatedRequest>).detail;
    if (detail) listener(detail);
  };
  window.addEventListener(UPDATED_EVENT_NAME, handler);
  return () => window.removeEventListener(UPDATED_EVENT_NAME, handler);
}
