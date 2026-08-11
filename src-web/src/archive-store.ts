import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

function validId(id: unknown): id is string {
  return typeof id === "string" && /^[a-zA-Z0-9-]{1,128}$/.test(id);
}

export class ArchiveStore {
  private readonly root: string;
  private readonly indexFile: string;

  constructor(dataDir: string) {
    this.root = path.join(dataDir, "archive");
    this.indexFile = path.join(this.root, "index.json");
  }

  async init(_legacyRoot?: string) {
    await mkdir(path.join(this.root, "sessions"), { recursive: true });
  }

  async list() {
    try {
      const value = JSON.parse(await readFile(this.indexFile, "utf8")) as unknown;
      return Array.isArray(value)
        ? value.filter(
            (item): item is { id: string } =>
              Boolean(item) && typeof item === "object" && validId((item as { id?: unknown }).id),
          )
        : [];
    } catch {
      return [];
    }
  }

  async get(id: string) {
    if (!validId(id)) return null;
    try {
      return JSON.parse(
        await readFile(path.join(this.root, "sessions", id, "session.json"), "utf8"),
      ) as unknown;
    } catch {
      return null;
    }
  }

  async save(value: { id: string }) {
    if (!validId(value.id)) throw new Error("invalid archive id");
    const directory = path.join(this.root, "sessions", value.id);
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, "session.json"), JSON.stringify(value, null, 2));
    const session = value as typeof value & {
      source?: unknown;
      externalId?: unknown;
      title?: unknown;
      cwd?: unknown;
      sourcePath?: unknown;
      createdAt?: unknown;
      updatedAt?: unknown;
      importedAt?: unknown;
      messages?: unknown[];
      assetCount?: unknown;
      usageTotal?: unknown;
    };
    const indexItem = {
      id: session.id,
      source: session.source,
      externalId: session.externalId,
      title: session.title,
      cwd: session.cwd,
      sourcePath: session.sourcePath,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      importedAt: session.importedAt,
      messageCount: Array.isArray(session.messages) ? session.messages.length : 0,
      assetCount: typeof session.assetCount === "number" ? session.assetCount : 0,
      usageTotal: session.usageTotal,
    };
    const index = (await this.list()).filter((item) => item && typeof item === "object" && (item as { id?: unknown }).id !== value.id);
    index.push(indexItem);
    const temporary = `${this.indexFile}.tmp`;
    await writeFile(temporary, JSON.stringify(index, null, 2));
    await rename(temporary, this.indexFile);
  }

  async delete(id: string) {
    if (!validId(id)) return;
    await rm(path.join(this.root, "sessions", id), { recursive: true, force: true });
    const index = (await this.list()).filter((item) => !item || typeof item !== "object" || (item as { id?: unknown }).id !== id);
    await writeFile(this.indexFile, JSON.stringify(index, null, 2));
  }
}
