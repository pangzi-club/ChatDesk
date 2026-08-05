import { createHashRouter, Navigate, RouterProvider } from "react-router-dom";

import { AppShell } from "@/layouts/app-shell";
import { AnalyticsPage } from "@/pages/analytics";
import { AutomationsPage } from "@/pages/automations";
import { ChatPage } from "@/pages/chat";
import { CommitPage } from "@/pages/commit";
import { DashboardPage } from "@/pages/dashboard";
import { EncryptPage } from "@/pages/encrypt";
import { ImageGenerationPage } from "@/pages/image-generation";
import { InputsPage } from "@/pages/inputs";
import { LookerDetailPage, LookerPage } from "@/pages/looker";
import {
  ApiKeysSettingsPage,
  ModelsSettingsPage,
  SettingsLayout,
  SystemLogsSettingsPage,
  ThemeSettingsPage,
  TraySettingsPage,
} from "@/pages/settings";
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
        path: "inputs",
        element: <InputsPage />,
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
        path: "encrypt",
        element: <EncryptPage />,
      },
      {
        path: "settings",
        element: <SettingsLayout />,
        children: [
          { index: true, element: <Navigate replace to="theme" /> },
          { path: "theme", element: <ThemeSettingsPage /> },
          { path: "keys", element: <ApiKeysSettingsPage /> },
          { path: "models", element: <ModelsSettingsPage /> },
          { path: "tray", element: <TraySettingsPage /> },
          { path: "logs", element: <SystemLogsSettingsPage /> },
        ],
      },
      {
        path: "vite-ports",
        element: <VitePortsPage />,
      },
      {
        path: "workspaces",
        element: <WorkspacesPage />,
      },
      {
        path: "workspaces/:projectId",
        element: <WorkspaceDetailPage />,
      },
    ],
  },
  {
    path: "*",
    element: <Navigate replace to="/dashboard" />,
  },
]);

function AppRouter() {
  return <RouterProvider router={router} />;
}

export { AppRouter };
