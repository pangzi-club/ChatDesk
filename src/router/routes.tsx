import { createHashRouter, Navigate, RouterProvider } from "react-router-dom";

import { AppShell } from "@/layouts/app-shell";
import { AnalyticsPage } from "@/pages/analytics";
import { CommitPage } from "@/pages/commit";
import { DashboardPage } from "@/pages/dashboard";
import { EncryptPage } from "@/pages/encrypt";
import { LookerDetailPage, LookerPage } from "@/pages/looker";
import { SettingsPage } from "@/pages/settings";
import { VitePortsPage } from "@/pages/vite-ports";

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
        path: "analytics",
        element: <AnalyticsPage />,
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
        element: <SettingsPage />,
      },
      {
        path: "vite-ports",
        element: <VitePortsPage />,
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
