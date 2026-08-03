import { createHashRouter, Navigate, RouterProvider } from "react-router-dom";

import { AppShell } from "@/layouts/app-shell";
import { DashboardPage } from "@/pages/dashboard";
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
