import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "vitest";
import { SandboxReviewLogStore } from "./sandbox-review-log.ts";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true })),
  );
});

describe("sandbox review log", () => {
  it("persists bash commands and keeps older entries compatible", async () => {
    const dataDir = await mkdtemp(path.join(os.tmpdir(), "chatdesk-review-log-"));
    temporaryDirectories.push(dataDir);
    const store = new SandboxReviewLogStore(dataDir);
    await store.init();

    const entry = await store.append({
      toolName: "bash",
      command: "curl -H 'Authorization: Bearer [redacted]' https://example.com",
      reasons: ["network"],
      decision: "deny",
    });

    assert.equal(entry.command, "curl -H 'Authorization: Bearer [redacted]' https://example.com");
    assert.equal(store.list()[0]?.command, entry.command);
    assert.match(await readFile(path.join(dataDir, "sandbox-review-log.json"), "utf8"), /command/);
  });
});
