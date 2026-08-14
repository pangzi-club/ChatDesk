import { describe, expect, it } from "vitest";
import { detectMissingDevelopmentTools } from "./developer-environment.ts";

describe("developer environment guidance", () => {
  it("recognizes common missing-command formats for allowlisted tools", () => {
    expect(
      detectMissingDevelopmentTools({
        out: [
          "zsh:1: command not found: pnpm",
          "/bin/bash: line 1: python3: command not found",
          "fish: Unknown command: cargo",
        ].join("\n"),
      }),
    ).toEqual(["pnpm", "python3", "cargo"]);
  });

  it("does not guide for arbitrary commands or unrelated output", () => {
    expect(detectMissingDevelopmentTools({ out: "custom-tool: command not found" })).toEqual([]);
    expect(detectMissingDevelopmentTools({ out: "pnpm completed successfully" })).toEqual([]);
    expect(detectMissingDevelopmentTools("pnpm: command not found")).toEqual([]);
  });

  it("escapes tool names that contain regular expression characters", () => {
    expect(detectMissingDevelopmentTools({ out: "clang++: command not found" })).toEqual([
      "clang++",
    ]);
  });
});
