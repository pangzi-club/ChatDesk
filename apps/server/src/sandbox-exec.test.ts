import { describe, expect, it } from "vitest";
import { isSandboxBlockedOutput, resolveCommandCwd, SandboxBlockedError } from "./sandbox-exec.ts";

describe("sandbox execution errors", () => {
  it("only classifies recognizable Seatbelt denial output as sandbox blocked", () => {
    expect(isSandboxBlockedOutput("sandbox-exec: deny file-write-data")).toBe(true);
    expect(isSandboxBlockedOutput("command failed: exit status 1")).toBe(false);
    expect(isSandboxBlockedOutput("permission denied by application")).toBe(false);
  });

  it("uses a stable error code for boundary validation failures", () => {
    expect(() => resolveCommandCwd("/tmp", "/etc", "ask")).toThrow(SandboxBlockedError);
    try {
      resolveCommandCwd("/tmp", "/etc", "ask");
    } catch (error) {
      expect(error).toMatchObject({
        code: "sandbox_blocked",
        message: "受限模式下 Bash 只能在当前 workspace 内执行",
      });
    }
  });
});
