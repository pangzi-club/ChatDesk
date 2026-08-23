import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, it } from "vitest";

const bin = fileURLToPath(new URL("./chatdesk.mjs", import.meta.url));

describe("chatdesk bin", () => {
  it("prints help through the node wrapper", () => {
    const result = spawnSync(process.execPath, [bin, "--help"], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /用法:/);
    assert.match(result.stdout, /-p, --prompt/);
  });
});
