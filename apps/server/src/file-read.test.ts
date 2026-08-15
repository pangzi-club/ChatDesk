import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "vitest";
import { MAX_READ_OUTPUT_BYTES, readTextFileRange } from "./file-read.ts";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true })));
});

async function fixture(content: string) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "chatdesk-read-"));
  directories.push(directory);
  const file = path.join(directory, "fixture.txt");
  await writeFile(file, content, "utf8");
  return file;
}

describe("read file ranges", () => {
  it("returns a complete small file and validates line ranges", async () => {
    const file = await fixture("一\ntwo\nthree");
    assert.deepEqual(await readTextFileRange(file, "fixture.txt"), {
      path: "fixture.txt",
      content: "一\ntwo\nthree",
      startLine: 1,
      endLine: 3,
      totalLines: 3,
      truncated: false,
    });
    await assert.rejects(() => readTextFileRange(file, "fixture.txt", { startLine: 0 }));
    await assert.rejects(() =>
      readTextFileRange(file, "fixture.txt", { startLine: 1, endLine: 401 }),
    );
  });

  it("truncates a long unicode line at a valid UTF-8 boundary", async () => {
    const file = await fixture("界".repeat(MAX_READ_OUTPUT_BYTES));
    const result = await readTextFileRange(file, "fixture.txt");
    assert.ok(Buffer.byteLength(result.content) <= MAX_READ_OUTPUT_BYTES);
    assert.equal(result.content.endsWith("�"), false);
    assert.equal(result.startLine, 1);
    assert.equal(result.endLine, 1);
    assert.equal(result.truncated, true);
  });

  it("reads beyond the former whole-file limit by range", async () => {
    const file = await fixture(`${"x".repeat(600_000)}\nlast`);
    const result = await readTextFileRange(file, "fixture.txt", { startLine: 2, endLine: 2 });
    assert.equal(result.content, "last");
    assert.equal(result.endLine, 2);
    assert.equal(result.truncated, true);
  });
});
