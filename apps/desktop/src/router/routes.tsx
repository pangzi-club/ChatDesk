import {
  createHashRouter,
  Navigate,
  Outlet,
  RouterProvider,
  useLocation,
  useParams,
} from "react-router-dom";
import { DesktopRouteHost } from "@/components/desktop-route-host";
import { SettingsRouteHost } from "@/components/settings-route-host";
import { AppShell } from "@/layouts/app-shell";
import { SettingsLayout } from "@/layouts/settings-layout";
import { chatIndexRedirectPath } from "@/lib/chat-routes";
import { ChatPage } from "@/pages/chat";
import { HistoryDetailPage } from "@/pages/history";
import { PluginDetailPage } from "@/pages/plugin-detail";
import { PluginsPage } from "@/pages/plugins";

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
        path: "plugins",
        children: [
          { index: true, element: <PluginsPage /> },
          { path: ":pluginId", element: <PluginDetailPage /> },
        ],
      },
      {
        path: "settings",
        element: <SettingsLayout />,
        children: [
          { index: true, element: <Navigate replace to="general" /> },
          { path: "history", element: <Navigate replace to="/settings/statistics" /> },
          { path: "history/analysis", element: <Navigate replace to="/settings/statistics" /> },
          { path: "history/:source/:id", element: <HistoryDetailPage /> },
          { path: "tray", element: <Navigate replace to="/settings/general" /> },
          { path: "*", element: <SettingsRouteHost /> },
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
      { path: "*", element: <DesktopRouteHost /> },
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
