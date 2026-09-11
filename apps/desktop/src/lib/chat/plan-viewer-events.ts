import { createWindowEventBus } from "@/lib/runtime/window-event-bus";

export type PlanViewerOpenRequest = {
  sessionId: string;
  planId: string;
  fileName: string;
  content: string;
  canExecute?: boolean;
};

export type PlanViewerUpdatedRequest = Omit<PlanViewerOpenRequest, "content"> & {
  content?: string;
};

export type PlanExecutionRequest = Pick<PlanViewerOpenRequest, "sessionId" | "planId">;

const planViewerOpenBus = createWindowEventBus<PlanViewerOpenRequest>("chatdesk:plan-viewer-open");
const planViewerUpdatedBus = createWindowEventBus<PlanViewerUpdatedRequest>(
  "chatdesk:plan-viewer-updated",
);
const planExecutionBus = createWindowEventBus<PlanExecutionRequest>(
  "chatdesk:plan-execution-requested",
);

export function openPlanViewer(request: PlanViewerOpenRequest) {
  planViewerOpenBus.dispatch(request);
}

export function subscribePlanViewerOpen(listener: (request: PlanViewerOpenRequest) => void) {
  return planViewerOpenBus.subscribe(listener);
}

export function updatePlanViewer(request: PlanViewerUpdatedRequest) {
  planViewerUpdatedBus.dispatch(request);
}

export function subscribePlanViewerUpdated(listener: (request: PlanViewerUpdatedRequest) => void) {
  return planViewerUpdatedBus.subscribe(listener);
}

export function requestPlanExecution(request: PlanExecutionRequest) {
  planExecutionBus.dispatch(request);
}

export function subscribePlanExecutionRequested(listener: (request: PlanExecutionRequest) => void) {
  return planExecutionBus.subscribe(listener);
}
