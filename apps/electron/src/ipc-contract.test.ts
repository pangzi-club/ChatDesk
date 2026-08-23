import { describe, expect, it } from "vitest";
import { validateAssetPath, validateExternalUrl, validateUserStoreFile } from "./ipc-contract.js";

describe("Electron IPC validation", () => {
  it("allows only the desktop user stores", () => {
    expect(validateUserStoreFile("settings.json")).toBe("settings.json");
    expect(() => validateUserStoreFile("../secrets.json")).toThrow();
  });

  it("allows HTTP(S) URLs and rejects privileged protocols", () => {
    expect(validateExternalUrl("https://example.com/path")).toBe("https://example.com/path");
    expect(() => validateExternalUrl("file:///etc/passwd")).toThrow();
    expect(() => validateExternalUrl("javascript:alert(1)")).toThrow();
  });

  it("keeps asset reads inside explicitly allowed roots", () => {
    expect(validateAssetPath("/tmp/chatdesk/assets/image.png", ["/tmp/chatdesk"])).toBe(
      "/tmp/chatdesk/assets/image.png",
    );
    expect(() => validateAssetPath("/tmp/chatdesk-other/image.png", ["/tmp/chatdesk"])).toThrow();
  });
});
