import { createHashRouter, Navigate, RouterProvider, useParams } from "react-router-dom";

import { AppShell } from "@/layouts/app-shell";
import { AnalyticsPage } from "@/pages/analytics";
import { AutomationsPage } from "@/pages/automations";
import { ChatPage } from "@/pages/chat";
import { CommitPage } from "@/pages/commit";
import { DashboardPage } from "@/pages/dashboard";
import { DevToolsLayout, DevToolsPage } from "@/pages/dev-tools";
import { EncryptPage } from "@/pages/encrypt";
import { HistoryDetailPage, HistoryPage } from "@/pages/history";
import { HistoryAnalysisPage } from "@/pages/history-analysis";
import { ImageGenerationPage } from "@/pages/image-generation";
import { InputsPage } from "@/pages/inputs";
import { LookerDetailPage, LookerPage } from "@/pages/looker";
import { SandboxPage } from "@/pages/sandbox";
import {
  ApiKeysSettingsPage,
  MemorySettingsPage,
  ModelsSettingsPage,
  SettingsLayout,
  SystemLogsSettingsPage,
  ThemeSettingsPage,
  ToolsSettingsPage,
  TraySettingsPage,
} from "@/pages/settings";
import { StatisticsSettingsPage } from "@/pages/statistics";
import { VitePortsPage } from "@/pages/vite-ports";
import { WorkspaceDetailPage, WorkspacesPage } from "@/pages/workspaces";

const router = createHashRouter([
  {
    path: "/",
    element: <AppShell />,
    children: [
      {
        index: true,
        element: <Navigate replace to="/dashboard" />,
      },
      {
        path: "dashboard",
        element: <DashboardPage />,
      },
      {
        path: "chat",
        element: <ChatPage />,
      },
      {
        path: "history",
        element: <HistoryPage />,
      },
      {
        path: "history/analysis",
        element: <HistoryAnalysisPage />,
      },
      {
        path: "history/:source/:id",
        element: <HistoryDetailPage />,
      },
      {
        path: "image-generation",
        element: <ImageGenerationPage />,
      },
      {
        path: "analytics",
        element: <AnalyticsPage />,
      },
      {
        path: "automations",
        element: <AutomationsPage />,
      },
      {
        path: "commit",
        element: <CommitPage />,
      },
      {
        path: "looker",
        element: <LookerPage />,
      },
      {
        path: "looker/:ref",
        element: <LookerDetailPage />,
      },
      {
        path: "dev-tools",
        children: [
          { index: true, element: <DevToolsPage /> },
          {
            element: <DevToolsLayout />,
            children: [
              { path: "encrypt", element: <EncryptPage /> },
              { path: "vite-ports", element: <VitePortsPage /> },
              { path: "inputs", element: <InputsPage /> },
              { path: "workspaces", element: <WorkspacesPage /> },
              { path: "workspaces/:projectId", element: <WorkspaceDetailPage /> },
              { path: "sandbox", element: <SandboxPage /> },
            ],
          },
        ],
      },
      {
        path: "settings",
        element: <SettingsLayout />,
        children: [
          { index: true, element: <Navigate replace to="theme" /> },
          { path: "theme", element: <ThemeSettingsPage /> },
          { path: "keys", element: <ApiKeysSettingsPage /> },
          { path: "models", element: <ModelsSettingsPage /> },
          { path: "tools", element: <ToolsSettingsPage /> },
          { path: "memory", element: <MemorySettingsPage /> },
          { path: "statistics", element: <StatisticsSettingsPage /> },
          { path: "tray", element: <TraySettingsPage /> },
          { path: "logs", element: <SystemLogsSettingsPage /> },
        ],
      },
      { path: "encrypt", element: <Navigate replace to="/dev-tools/encrypt" /> },
      { path: "vite-ports", element: <Navigate replace to="/dev-tools/vite-ports" /> },
      { path: "inputs", element: <Navigate replace to="/dev-tools/inputs" /> },
      { path: "workspaces", element: <Navigate replace to="/dev-tools/workspaces" /> },
      { path: "sandbox", element: <Navigate replace to="/dev-tools/sandbox" /> },
      {
        path: "workspaces/:projectId",
        element: <WorkspaceProjectRedirect />,
      },
    ],
  },
  {
    path: "*",
    element: <Navigate replace to="/dashboard" />,
  },
]);

function WorkspaceProjectRedirect() {
  const { projectId } = useParams();
  return <Navigate replace to={`/dev-tools/workspaces/${projectId ?? ""}`} />;
}

function AppRouter() {
  return <RouterProvider router={router} />;
}

export { AppRouter };
