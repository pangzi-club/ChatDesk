import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

export class ArchiveStore {
  private readonly root: string;
  private readonly indexFile: string;

  constructor(dataDir: string) {
    this.root = path.join(dataDir, "archive");
    this.indexFile = path.join(this.root, "index.json");
  }

  async init(legacyRoot?: string) {
    await mkdir(path.join(this.root, "sessions"), { recursive: true });
    const current = await readFile(this.indexFile, "utf8").catch(() => undefined);
    if (!current && legacyRoot) {
      const legacyIndex = await readFile(path.join(legacyRoot, "index.json"), "utf8").catch(() => "[]");
      await writeFile(this.indexFile, legacyIndex);
      const entries = JSON.parse(legacyIndex) as Array<{ id?: unknown }>;
      for (const entry of entries) {
        if (typeof entry.id !== "string") continue;
        const source = path.join(legacyRoot, "sessions", entry.id, "session.json");
        const target = path.join(this.root, "sessions", entry.id, "session.json");
        const contents = await readFile(source, "utf8").catch(() => undefined);
        if (!contents) continue;
        await mkdir(path.dirname(target), { recursive: true });
        await writeFile(target, contents);
      }
    }
  }

  async list() {
    try {
      const value = JSON.parse(await readFile(this.indexFile, "utf8")) as unknown;
      return Array.isArray(value) ? value : [];
    } catch {
      return [];
    }
  }

  async get(id: string) {
    try {
      return JSON.parse(
        await readFile(path.join(this.root, "sessions", id, "session.json"), "utf8"),
      ) as unknown;
    } catch {
      return null;
    }
  }

  async save(value: { id: string }) {
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
    await rm(path.join(this.root, "sessions", id), { recursive: true, force: true });
    const index = (await this.list()).filter((item) => !item || typeof item !== "object" || (item as { id?: unknown }).id !== id);
    await writeFile(this.indexFile, JSON.stringify(index, null, 2));
  }
}
