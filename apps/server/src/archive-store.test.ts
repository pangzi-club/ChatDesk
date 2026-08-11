import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "vitest";
import { ArchiveStore } from "./archive-store.ts";

test("archive store rejects path traversal ids", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "chatdesk-archive-"));
  const store = new ArchiveStore(root);

  await assert.rejects(store.save({ id: "../outside" }), /invalid archive id/);
  assert.equal(await store.get("../outside"), null);
  await store.delete("../outside");
});

test("archive store initializes without legacy imports", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "chatdesk-archive-legacy-"));

  const store = new ArchiveStore(root);
  await assert.doesNotReject(store.init());
  assert.deepEqual(await store.list(), []);
});
