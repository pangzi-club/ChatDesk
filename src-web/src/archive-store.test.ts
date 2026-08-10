import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import test from "node:test";
import { ArchiveStore } from "./archive-store.ts";

test("archive store rejects path traversal ids", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "chatdesk-archive-"));
  const store = new ArchiveStore(root);

  await assert.rejects(
    store.save({ id: "../outside" }),
    /invalid archive id/,
  );
  assert.equal(await store.get("../outside"), null);
  await store.delete("../outside");
});

test("archive store tolerates a corrupt legacy index", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "chatdesk-archive-legacy-"));
  const legacy = await mkdtemp(path.join(os.tmpdir(), "chatdesk-archive-source-"));
  await writeFile(path.join(legacy, "index.json"), "not-json");

  const store = new ArchiveStore(root);
  await assert.doesNotReject(store.init(legacy));
  assert.deepEqual(await store.list(), []);
});
