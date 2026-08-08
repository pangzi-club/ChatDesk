import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

export type RunJournalEntry = {
  sessionId: string;
  runId: string;
  startedAt: string;
};

const SAFE_ID = /^[a-zA-Z0-9-]{1,128}$/;

function isEntry(value: unknown): value is RunJournalEntry {
  if (!value || typeof value !== "object") return false;
  const entry = value as Partial<RunJournalEntry>;
  return (
    typeof entry.sessionId === "string" &&
    SAFE_ID.test(entry.sessionId) &&
    typeof entry.runId === "string" &&
    SAFE_ID.test(entry.runId) &&
    typeof entry.startedAt === "string"
  );
}

export class RunJournal {
  private readonly directory: string;

  constructor(dataDir: string) {
    this.directory = path.join(dataDir, "runs");
  }

  async init() {
    await mkdir(this.directory, { recursive: true });
  }

  async begin(entry: RunJournalEntry) {
    if (!isEntry(entry)) throw new Error("invalid run journal entry");
    await this.init();
    const target = this.filePath(entry.runId);
    const temporary = `${target}.${process.pid}.tmp`;
    await writeFile(temporary, JSON.stringify(entry, null, 2), "utf8");
    await rename(temporary, target);
  }

  async recover() {
    await this.init();
    const entries = await readdir(this.directory, { withFileTypes: true }).catch(() => []);
    const recovered: RunJournalEntry[] = [];
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
      const value = await readFile(path.join(this.directory, entry.name), "utf8")
        .then((contents) => JSON.parse(contents) as unknown)
        .catch(() => null);
      if (isEntry(value)) recovered.push(value);
    }
    return recovered;
  }

  async clear(runId: string) {
    if (!SAFE_ID.test(runId)) return;
    await rm(this.filePath(runId), { force: true });
  }

  private filePath(runId: string) {
    return path.join(this.directory, `${runId}.json`);
  }
}
