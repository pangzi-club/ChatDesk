import { describe, expect, it } from "vitest";
import { explorerFileIconKind } from "./explorer-file-icon";

describe("explorerFileIconKind", () => {
  it("uses open and closed folder kinds for directories", () => {
    expect(explorerFileIconKind("src", { entryKind: "dir" })).toBe("folder");
    expect(explorerFileIconKind("src", { entryKind: "dir", expanded: true })).toBe("folder-open");
  });

  it("maps common source and document extensions", () => {
    expect(explorerFileIconKind("apps/desktop/src/app.tsx")).toBe("code-ts");
    expect(explorerFileIconKind("vite.config.js")).toBe("code-js");
    expect(explorerFileIconKind("src/main.rs")).toBe("code");
    expect(explorerFileIconKind("package.json")).toBe("json");
    expect(explorerFileIconKind("App.css")).toBe("style");
    expect(explorerFileIconKind("index.html")).toBe("markup");
    expect(explorerFileIconKind("README.md")).toBe("doc");
    expect(explorerFileIconKind("cover.png")).toBe("image");
  });

  it("falls back to a generic file kind", () => {
    expect(explorerFileIconKind("LICENSE")).toBe("file");
    expect(explorerFileIconKind("notes.bin")).toBe("file");
    expect(explorerFileIconKind("Dockerfile")).toBe("code");
  });
});
