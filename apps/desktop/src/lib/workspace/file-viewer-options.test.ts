import { describe, expect, it } from "vitest";
import { createDiffEditorOptions } from "./file-viewer-options";

describe("createDiffEditorOptions", () => {
  it("enables unchanged-region folding when requested", () => {
    expect(createDiffEditorOptions({ hideUnchangedRegions: true }).hideUnchangedRegions).toEqual({
      contextLineCount: 3,
      enabled: true,
      minimumLineCount: 3,
      revealLineCount: 1,
    });
  });

  it("disables unchanged-region folding when requested", () => {
    expect(
      createDiffEditorOptions({ hideUnchangedRegions: false }).hideUnchangedRegions?.enabled,
    ).toBe(false);
  });

  it("uses a side-by-side layout by default and a unified layout when requested", () => {
    expect(createDiffEditorOptions({ hideUnchangedRegions: true }).renderSideBySide).toBe(true);
    expect(
      createDiffEditorOptions({ hideUnchangedRegions: true, layout: "unified" }).renderSideBySide,
    ).toBe(false);
  });
});
