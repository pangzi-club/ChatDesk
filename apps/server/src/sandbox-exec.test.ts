import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildSeatbeltProfile,
  isSandboxBlockedOutput,
  resolveCommandCwd,
  runSandboxedRead,
  SandboxPathError,
} from "./sandbox-exec.ts";

describe("sandbox execution errors", () => {
  it("only classifies recognizable Seatbelt denial output as sandbox blocked", () => {
    expect(isSandboxBlockedOutput("sandbox-exec: deny file-write-data")).toBe(true);
    expect(isSandboxBlockedOutput("sandbox-exec: sandbox_apply: Operation not permitted")).toBe(
      false,
    );
    expect(isSandboxBlockedOutput("command failed: exit status 1")).toBe(false);
    expect(isSandboxBlockedOutput("permission denied by application")).toBe(false);
  });

  it("uses a stable error code for invalid boundary paths", () => {
    expect(() => resolveCommandCwd("/tmp", "/etc", "ask")).toThrow(SandboxPathError);
    try {
      resolveCommandCwd("/tmp", "/etc", "ask");
    } catch (error) {
      expect(error).toMatchObject({
        code: "sandbox_path_invalid",
        message: "Bash cwd 必须是 workspace 内的相对路径或 workspace 内的绝对路径",
      });
    }
  });

  it("adds configured paths to the read policy without adding them to writable paths", () => {
    const profile = buildSeatbeltProfile("/tmp/workspace", ["/tmp/read-only"]);
    expect(profile).toContain('(subpath "/tmp/read-only")');
    expect(profile).toContain("(deny default)");
    expect(profile).toContain('(allow file-read* (subpath "/tmp/read-only"))');
    expect(profile).toContain('(allow file-write* (subpath "/tmp/workspace"))');
    expect(profile).not.toContain("require-not");
  });

  it("runs structured read operations in the helper process", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "chatdesk-sandbox-read-"));
    await mkdir(path.join(root, "node_modules", "aws4fetch"), { recursive: true });
    await writeFile(path.join(root, "node_modules", "aws4fetch", "README.md"), "aws4fetch", "utf8");

    const file = await runSandboxedRead(
      { operation: "read_file", workspace: root, path: "node_modules/aws4fetch/README.md" },
      { mode: "full" },
    );
    expect(file.sandboxBlocked).toBe(false);
    expect(file.result).toMatchObject({ content: "aws4fetch" });

    const directory = await runSandboxedRead(
      { operation: "list_dir", workspace: root, path: "node_modules/aws4fetch" },
      { mode: "full" },
    );
    expect(directory.sandboxBlocked).toBe(false);
    expect(directory.result).toMatchObject({ entries: [{ name: "README.md" }] });
  });
});
