import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it } from "vitest";
import { ActivityLogStore } from "./activity-log-store.ts";

describe("ActivityLogStore", () => {
  it("serializes concurrent appends without dropping log entries", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "chatdesk-activity-log-"));
    try {
      const store = new ActivityLogStore(directory);
      await store.init();
      await Promise.all(
        Array.from({ length: 20 }, (_, index) =>
          store.append({ level: "info", source: "test", message: `entry-${index}` }),
        ),
      );

      assert.equal(store.list().length, 20);
      const persisted = JSON.parse(
        await readFile(path.join(directory, "activity-logs.json"), "utf8"),
      ) as unknown[];
      assert.equal(persisted.length, 20);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
