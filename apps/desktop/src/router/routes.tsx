import { createHashRouter, Navigate, RouterProvider, useParams } from "react-router-dom";

import { AppShell } from "@/layouts/app-shell";
import { AutomationsPage } from "@/pages/automations";
import { ChatPage } from "@/pages/chat";
import { HistoryDetailPage } from "@/pages/history";
import { ImageGenerationPage } from "@/pages/image-generation";
import {
  ApiKeysSettingsPage,
  ChatServerSettingsPage,
  EnvironmentSettingsPage,
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

const router = createHashRouter([
  {
    path: "/",
    element: <AppShell />,
    children: [
      {
        index: true,
        element: <Navigate replace to="/chat" />,
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
          { path: "environment", element: <EnvironmentSettingsPage /> },
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
    element: <Navigate replace to="/chat" />,
  },
]);

function HistoryLegacyRedirect() {
  const { source, id } = useParams();
  return <Navigate replace to={`/settings/history/${source ?? ""}/${id ?? ""}`} />;
}

function AppRouter() {
  return <RouterProvider router={router} />;
}

export { AppRouter };
