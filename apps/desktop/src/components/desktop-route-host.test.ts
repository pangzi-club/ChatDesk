import { MessageCircle } from "lucide-react";
import { describe, expect, it } from "vitest";
import { resolveDesktopRoute } from "@/components/desktop-route-host";
import type { DesktopRouteContribution } from "@/lib/desktop-ui";

function EmptyPage() {
  return null;
}

const routes: DesktopRouteContribution[] = [
  {
    id: "channels",
    path: "/channels",
    title: "Channel",
    icon: MessageCircle,
    keywords: ["channel"],
    component: EmptyPage,
  },
];

describe("resolveDesktopRoute", () => {
  it("resolves registered pages and rejects unknown or unloaded paths", () => {
    expect(resolveDesktopRoute(routes, "/channels")?.id).toBe("channels");
    expect(resolveDesktopRoute(routes, "/unknown")).toBeUndefined();
    expect(resolveDesktopRoute([], "/channels")).toBeUndefined();
  });
});
