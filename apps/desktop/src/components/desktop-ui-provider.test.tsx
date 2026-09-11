import { Context } from "cordis";
import { MessageCircle } from "lucide-react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  DesktopUiProvider,
  useDesktopUi,
  useDesktopUiSlot,
} from "@/components/desktop-ui-provider";
import { DesktopUiService } from "@/lib/plugins/desktop-ui";

async function createService() {
  const ctx = new Context();
  await ctx.plugin(DesktopUiService);
  return ctx.desktopUi;
}

describe("DesktopUiProvider", () => {
  it("renders registered slot contributions in order", async () => {
    const service = await createService();
    service.register("sidebar.navigation", {
      id: "nav.later",
      path: "/later",
      label: "Later",
      icon: MessageCircle,
      order: 20,
    });
    service.register("sidebar.navigation", {
      id: "nav.earlier",
      path: "/earlier",
      label: "Earlier",
      icon: MessageCircle,
      order: 10,
    });

    function Consumer() {
      const items = useDesktopUiSlot("sidebar.navigation");
      return (
        <ul>
          {items.map((item) => (
            <li key={item.id}>{item.label}</li>
          ))}
        </ul>
      );
    }

    const html = renderToString(
      <DesktopUiProvider service={service}>
        <Consumer />
      </DesktopUiProvider>,
    );
    expect(html).toBe("<ul><li>Earlier</li><li>Later</li></ul>");
  });

  it("exposes the active service to consumers", async () => {
    const service = await createService();

    function Consumer() {
      return <span>{useDesktopUi() === service ? "same" : "other"}</span>;
    }

    const html = renderToString(
      <DesktopUiProvider service={service}>
        <Consumer />
      </DesktopUiProvider>,
    );
    expect(html).toBe("<span>same</span>");
  });

  it("throws a clear error when a slot hook is used without its provider", () => {
    function Consumer() {
      useDesktopUiSlot("route");
      return null;
    }

    expect(() => renderToString(<Consumer />)).toThrow(
      "useDesktopUiSlot must be used within DesktopUiProvider",
    );
  });

  it("throws a clear error when the service hook is used without its provider", () => {
    function Consumer() {
      useDesktopUi();
      return null;
    }

    expect(() => renderToString(<Consumer />)).toThrow(
      "useDesktopUi must be used within DesktopUiProvider",
    );
  });
});
