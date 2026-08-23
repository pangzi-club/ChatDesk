import { randomUUID } from "node:crypto";
import { open, readFile, unlink } from "node:fs/promises";
import path from "node:path";

type LockFile = {
  pid: number;
  token: string;
  startedAt: string;
};

export type DataDirectoryLock = {
  path: string;
  release: () => Promise<void>;
};

const LOCK_FILE_NAME = ".chatdesk-instance.lock";

export async function acquireDataDirectoryLock(dataDirectory: string): Promise<DataDirectoryLock> {
  const lockPath = path.join(dataDirectory, LOCK_FILE_NAME);
  const token = randomUUID();
  const contents: LockFile = {
    pid: process.pid,
    token,
    startedAt: new Date().toISOString(),
  };

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const handle = await open(lockPath, "wx", 0o600);
      await handle.writeFile(`${JSON.stringify(contents)}\n`, "utf8");
      await handle.close();
      return {
        path: lockPath,
        release: async () => {
          const current = await readLock(lockPath);
          if (current?.token === token) await unlink(lockPath).catch(ignoreMissingFile);
        },
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const current = await readLock(lockPath);
      if (current && isProcessRunning(current.pid)) {
        throw new Error(`Chat Server 数据目录已被进程 ${current.pid} 占用：${lockPath}`);
      }
      await unlink(lockPath).catch(ignoreMissingFile);
    }
  }

  throw new Error(`无法取得 Chat Server 数据目录锁：${lockPath}`);
}

async function readLock(lockPath: string): Promise<LockFile | null> {
  try {
    const value: unknown = JSON.parse(await readFile(lockPath, "utf8"));
    if (!value || typeof value !== "object") return null;
    const lock = value as Partial<LockFile>;
    if (
      typeof lock.pid !== "number" ||
      !Number.isInteger(lock.pid) ||
      typeof lock.token !== "string" ||
      typeof lock.startedAt !== "string"
    ) {
      return null;
    }
    return lock as LockFile;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    return null;
  }
}

function isProcessRunning(pid: number) {
  if (pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

function ignoreMissingFile(error: unknown) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
}
