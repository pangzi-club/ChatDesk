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
  ChatServerSettingsPage,
  McpSettingsPage,
  MemorySettingsPage,
  ModelsSettingsPage,
  SettingsLayout,
  SkillsSettingsPage,
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
        path: "image-generation",
        element: <ImageGenerationPage />,
      },
      {
        path: "automations",
        element: <AutomationsPage />,
      },
      {
        path: "workspaces",
        element: <WorkspacesPage />,
      },
      {
        path: "workspaces/:projectId",
        element: <WorkspaceDetailPage />,
      },
      {
        path: "dev-tools",
        children: [
          { index: true, element: <DevToolsPage /> },
          { path: "workspaces", element: <Navigate replace to="/workspaces" /> },
          {
            path: "workspaces/:projectId",
            element: <WorkspaceProjectRedirect />,
          },
          {
            element: <DevToolsLayout />,
            children: [
              { path: "encrypt", element: <EncryptPage /> },
              { path: "vite-ports", element: <VitePortsPage /> },
              { path: "inputs", element: <InputsPage /> },
              { path: "analytics", element: <AnalyticsPage /> },
              { path: "commit", element: <CommitPage /> },
              { path: "looker", element: <LookerPage /> },
              { path: "looker/:ref", element: <LookerDetailPage /> },
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
          { path: "mcp", element: <McpSettingsPage /> },
          { path: "skills", element: <SkillsSettingsPage /> },
          { path: "tools", element: <ToolsSettingsPage /> },
          { path: "memory", element: <MemorySettingsPage /> },
          { path: "history", element: <HistoryPage /> },
          { path: "history/analysis", element: <HistoryAnalysisPage /> },
          { path: "history/:source/:id", element: <HistoryDetailPage /> },
          { path: "statistics", element: <StatisticsSettingsPage /> },
          { path: "tray", element: <TraySettingsPage /> },
          { path: "chat-server", element: <ChatServerSettingsPage /> },
          { path: "logs", element: <SystemLogsSettingsPage /> },
        ],
      },
      { path: "encrypt", element: <Navigate replace to="/dev-tools/encrypt" /> },
      { path: "vite-ports", element: <Navigate replace to="/dev-tools/vite-ports" /> },
      { path: "inputs", element: <Navigate replace to="/dev-tools/inputs" /> },
      { path: "analytics", element: <Navigate replace to="/dev-tools/analytics" /> },
      { path: "commit", element: <Navigate replace to="/dev-tools/commit" /> },
      { path: "looker", element: <Navigate replace to="/dev-tools/looker" /> },
      {
        path: "looker/:ref",
        element: <LookerRedirect />,
      },
      { path: "sandbox", element: <Navigate replace to="/dev-tools/sandbox" /> },
      { path: "history", element: <Navigate replace to="/settings/history" /> },
      {
        path: "history/analysis",
        element: <Navigate replace to="/settings/history/analysis" />,
      },
      {
        path: "history/:source/:id",
        element: <HistoryLegacyRedirect />,
      },
    ],
  },
  {
    path: "*",
    element: <Navigate replace to="/dashboard" />,
  },
]);

function LookerRedirect() {
  const { ref } = useParams();
  return <Navigate replace to={`/dev-tools/looker/${ref ?? ""}`} />;
}

function WorkspaceProjectRedirect() {
  const { projectId } = useParams();
  return <Navigate replace to={`/workspaces/${projectId ?? ""}`} />;
}

function HistoryLegacyRedirect() {
  const { source, id } = useParams();
  return <Navigate replace to={`/settings/history/${source ?? ""}/${id ?? ""}`} />;
}

function AppRouter() {
  return <RouterProvider router={router} />;
}

export { AppRouter };
