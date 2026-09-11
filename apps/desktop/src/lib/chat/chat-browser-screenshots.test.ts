import type { UIMessage } from "ai";
import { describe, expect, it } from "vitest";
import {
  materializeBrowserScreenshots,
  readBrowserScreenshotOutput,
} from "./chat-browser-screenshots";

describe("readBrowserScreenshotOutput", () => {
  it("reads attachment fields from a successful tool result", () => {
    expect(
      readBrowserScreenshotOutput({
        ok: true,
        data: {
          path: "/data/sessions/s1/attachments/att-1-screenshot-1.png",
          attachmentId: "att-1",
          fileName: "screenshot-1.png",
          mimeType: "image/png",
          width: 800,
          height: 600,
        },
      }),
    ).toEqual({
      attachmentId: "att-1",
      fileName: "screenshot-1.png",
      path: "/data/sessions/s1/attachments/att-1-screenshot-1.png",
      mediaType: "image/png",
      width: 800,
      height: 600,
    });
  });

  it("ignores failed results and temp-only paths without an attachment id", () => {
    expect(
      readBrowserScreenshotOutput({
        ok: false,
        data: { path: "/tmp/shot.png" },
      }),
    ).toBeNull();
    expect(
      readBrowserScreenshotOutput({
        ok: true,
        data: { path: "/tmp/shot.png", mimeType: "image/png" },
      }),
    ).toBeNull();
  });
});

describe("materializeBrowserScreenshots", () => {
  it("merges new screenshot attachments without duplicating existing ids", () => {
    const messages = [
      {
        id: "m1",
        role: "assistant",
        parts: [
          {
            type: "tool-browser_screenshot",
            toolCallId: "call-1",
            state: "output-available",
            input: { sessionId: "browser-1" },
            output: {
              ok: true,
              data: {
                attachmentId: "att-1",
                fileName: "screenshot-1.png",
                path: "/data/att-1-screenshot-1.png",
                mimeType: "image/png",
                width: 10,
                height: 20,
              },
            },
          },
          {
            type: "tool-browser_screenshot",
            toolCallId: "call-2",
            state: "output-available",
            input: { sessionId: "browser-1" },
            output: {
              ok: true,
              data: {
                attachmentId: "att-2",
                fileName: "screenshot-2.png",
                path: "/data/att-2-screenshot-2.png",
                mimeType: "image/png",
              },
            },
          },
        ],
      },
    ] as UIMessage[];

    const first = materializeBrowserScreenshots(messages, []);
    expect(first.changed).toBe(true);
    expect(first.attachments.map((item) => item.id)).toEqual(["att-1", "att-2"]);
    expect(first.attachments[0]).toMatchObject({
      kind: "image",
      source: "generated",
      fileName: "screenshot-1.png",
      path: "/data/att-1-screenshot-1.png",
      width: 10,
      height: 20,
    });

    const second = materializeBrowserScreenshots(messages, first.attachments);
    expect(second.changed).toBe(false);
    expect(second.attachments).toHaveLength(2);
  });
});
