import { Navigate, useParams } from "react-router-dom";
import { useDesktopUiSlot } from "@/components/desktop-ui-provider";

export function SettingsRouteHost() {
  const { "*": path = "" } = useParams();
  const pages = useDesktopUiSlot("settings.page");
  const page = pages.find((candidate) => candidate.path === path && candidate.visible !== false);
  if (!page) return <Navigate replace to="/settings/general" />;
  const Page = page.component;
  return <Page />;
}
