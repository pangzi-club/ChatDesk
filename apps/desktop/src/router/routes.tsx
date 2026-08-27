import {
  createHashRouter,
  Navigate,
  Outlet,
  RouterProvider,
  useLocation,
  useParams,
} from "react-router-dom";

import { AppShell } from "@/layouts/app-shell";
import { chatIndexRedirectPath } from "@/lib/chat-routes";
import { AutomationsPage } from "@/pages/automations";
import { ChatPage } from "@/pages/chat";
import { HistoryDetailPage } from "@/pages/history";
import { ImageGenerationPage } from "@/pages/image-generation";
import {
  ApiKeysSettingsPage,
  ChatServerSettingsPage,
  DevelopmentSettingsPage,
  EnvironmentSettingsPage,
  GeneralSettingsPage,
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
        children: [
          { index: true, element: <ChatIndexRedirect /> },
          {
            element: <ChatPage />,
            children: [
              { path: "new", element: <Outlet /> },
              { path: ":sessionId", element: <Outlet /> },
            ],
          },
        ],
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
          { index: true, element: <Navigate replace to="general" /> },
          { path: "general", element: <GeneralSettingsPage /> },
          { path: "theme", element: <ThemeSettingsPage /> },
          { path: "shortcuts", element: <ShortcutsSettingsPage /> },
          { path: "keys", element: <ApiKeysSettingsPage /> },
          { path: "models", element: <ModelsSettingsPage /> },
          { path: "mcp", element: <McpSettingsPage /> },
          { path: "skills", element: <SkillsSettingsPage /> },
          { path: "tools", element: <ToolsSettingsPage /> },
          { path: "sandbox", element: <SandboxSettingsPage /> },
          { path: "environment", element: <EnvironmentSettingsPage /> },
          { path: "development", element: <DevelopmentSettingsPage /> },
          { path: "memory", element: <MemorySettingsPage /> },
          { path: "history", element: <Navigate replace to="/settings/statistics" /> },
          { path: "history/analysis", element: <Navigate replace to="/settings/statistics" /> },
          { path: "history/:source/:id", element: <HistoryDetailPage /> },
          { path: "statistics", element: <StatisticsSettingsPage /> },
          { path: "tray", element: <Navigate replace to="/settings/general" /> },
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

function ChatIndexRedirect() {
  const location = useLocation();
  return <Navigate replace to={chatIndexRedirectPath(location.search)} />;
}

function HistoryLegacyRedirect() {
  const { source, id } = useParams();
  return <Navigate replace to={`/settings/history/${source ?? ""}/${id ?? ""}`} />;
}

function AppRouter() {
  return <RouterProvider router={router} />;
}

export { AppRouter };
