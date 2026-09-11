import { Navigate, useLocation } from "react-router-dom";
import { useDesktopUiSlot } from "@/components/desktop-ui-provider";
import type { DesktopRouteContribution } from "@/lib/plugins/desktop-ui";

export function resolveDesktopRoute(routes: readonly DesktopRouteContribution[], pathname: string) {
  return routes.find((candidate) => candidate.path === pathname);
}

export function DesktopRouteHost() {
  const location = useLocation();
  const routes = useDesktopUiSlot("route");
  const route = resolveDesktopRoute(routes, location.pathname);
  if (!route) return <Navigate replace to="/chat" />;
  const Page = route.component;
  return <Page />;
}
