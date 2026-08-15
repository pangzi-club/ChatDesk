import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it } from "vitest";
import { PlanStore } from "./plan-store.ts";

describe("PlanStore", () => {
  it("creates random versioned markdown files and updates them atomically", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "chatdesk-plan-store-"));
    try {
      const store = new PlanStore(root);
      const first = await store.create("session-1");
      const second = await store.create("session-1");
      assert.match(first.fileName, /^plan-[a-f0-9]{8}\.md$/);
      assert.match(second.fileName, /^plan-[a-f0-9]{8}\.md$/);
      assert.notEqual(first.id, second.id);

      const updated = await store.write("session-1", first.id, "# Plan\n\n- inspect\n");
      assert.equal(updated.content, "# Plan\n\n- inspect\n");
      assert.equal(
        await readFile(path.join(root, "sessions", "session-1", first.fileName), "utf8"),
        updated.content,
      );
      assert.equal((await store.list("session-1")).length, 2);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects invalid plan ids", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "chatdesk-plan-store-"));
    try {
      const store = new PlanStore(root);
      await assert.rejects(store.read("session-1", "../outside"), /invalid plan id/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
