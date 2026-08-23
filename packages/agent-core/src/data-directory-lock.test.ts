import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { acquireDataDirectoryLock } from "./data-directory-lock.ts";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("acquireDataDirectoryLock", () => {
  it("prevents two server processes from sharing one data directory", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "chatdesk-lock-"));
    temporaryDirectories.push(directory);
    const first = await acquireDataDirectoryLock(directory);
    const lockContents = JSON.parse(
      await readFile(path.join(directory, ".chatdesk-instance.lock"), "utf8"),
    ) as { pid: number; token: string };

    expect(lockContents.pid).toBe(process.pid);
    expect(lockContents.token).toEqual(expect.any(String));
    await expect(acquireDataDirectoryLock(directory)).rejects.toThrow("数据目录已被进程");

    await first.release();
    const second = await acquireDataDirectoryLock(directory);
    await second.release();
  });
});
