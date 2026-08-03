import { createHashRouter, Navigate, RouterProvider } from "react-router-dom";

import { AppShell } from "@/layouts/app-shell";
import { AnalyticsPage } from "@/pages/analytics";
import { DashboardPage } from "@/pages/dashboard";
import { EncryptPage } from "@/pages/encrypt";
import { SettingsPage } from "@/pages/settings";

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
        path: "encrypt",
        element: <EncryptPage />,
      },
      {
        path: "settings",
        element: <SettingsPage />,
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
