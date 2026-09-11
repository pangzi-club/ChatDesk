import { describe, expect, it } from "vitest";
import { isLocalFilesystemImageSrc, localFilesystemPathFromImageSrc } from "./chat-markdown-images";

describe("local Markdown image paths", () => {
  it("detects chat-server attachment paths used in assistant Markdown", () => {
    const src =
      "/Users/wangbohao/.chatdesk/chat-server/sessions/d090519d-f6f9-49a3-913f-2f3b87281e2d/attachments/e85e1b0f-afa9-4d56-b6a9-390ea7bb2687-screenshot-1786937887845.png";

    expect(isLocalFilesystemImageSrc(src)).toBe(true);
    expect(localFilesystemPathFromImageSrc(src)).toBe(src);
  });

  it("detects file URLs and Windows paths, and leaves web srcs alone", () => {
    expect(localFilesystemPathFromImageSrc("file:///Users/me/.chatdesk/chat-server/shot.png")).toBe(
      "/Users/me/.chatdesk/chat-server/shot.png",
    );
    expect(localFilesystemPathFromImageSrc("C:\\Users\\me\\.chatdesk\\shot.jpg")).toBe(
      "C:\\Users\\me\\.chatdesk\\shot.jpg",
    );
    expect(localFilesystemPathFromImageSrc("file:///C:/Users/me/shot.webp")).toBe(
      "C:/Users/me/shot.webp",
    );

    expect(isLocalFilesystemImageSrc("/logo.png")).toBe(false);
    expect(isLocalFilesystemImageSrc("https://example.com/shot.png")).toBe(false);
    expect(isLocalFilesystemImageSrc("data:image/png;base64,abc")).toBe(false);
    expect(isLocalFilesystemImageSrc("./shot.png")).toBe(false);
  });
});
