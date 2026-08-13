import { createHashRouter, Navigate, RouterProvider, useParams } from "react-router-dom";

import { AppShell } from "@/layouts/app-shell";
import { AutomationsPage } from "@/pages/automations";
import { ChatPage } from "@/pages/chat";
import { DashboardPage } from "@/pages/dashboard";
import { DevToolsLayout, DevToolsPage } from "@/pages/dev-tools";
import { EncryptPage } from "@/pages/encrypt";
import { HistoryDetailPage } from "@/pages/history";
import { ImageGenerationPage } from "@/pages/image-generation";
import {
  ApiKeysSettingsPage,
  ChatServerSettingsPage,
  McpSettingsPage,
  MemorySettingsPage,
  ModelsSettingsPage,
  SandboxSettingsPage,
  SettingsLayout,
  ShortcutsSettingsPage,
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
          { path: "shortcuts", element: <ShortcutsSettingsPage /> },
          { path: "keys", element: <ApiKeysSettingsPage /> },
          { path: "models", element: <ModelsSettingsPage /> },
          { path: "mcp", element: <McpSettingsPage /> },
          { path: "skills", element: <SkillsSettingsPage /> },
          { path: "tools", element: <ToolsSettingsPage /> },
          { path: "sandbox", element: <SandboxSettingsPage /> },
          { path: "memory", element: <MemorySettingsPage /> },
          { path: "history", element: <Navigate replace to="/settings/statistics" /> },
          { path: "history/analysis", element: <Navigate replace to="/settings/statistics" /> },
          { path: "history/:source/:id", element: <HistoryDetailPage /> },
          { path: "statistics", element: <StatisticsSettingsPage /> },
          { path: "tray", element: <TraySettingsPage /> },
          { path: "chat-server", element: <ChatServerSettingsPage /> },
          { path: "logs", element: <SystemLogsSettingsPage /> },
        ],
      },
      { path: "encrypt", element: <Navigate replace to="/dev-tools/encrypt" /> },
      { path: "vite-ports", element: <Navigate replace to="/dev-tools/vite-ports" /> },
      { path: "history", element: <Navigate replace to="/settings/statistics" /> },
      {
        path: "history/analysis",
        element: <Navigate replace to="/settings/statistics" />,
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
