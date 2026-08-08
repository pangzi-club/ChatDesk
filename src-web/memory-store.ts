import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

const DEFAULT_MEMORY = { schemaVersion: 1, enabled: true, items: [] };

export class MemoryStore {
  private value: unknown = structuredClone(DEFAULT_MEMORY);
  private readonly file: string;

  constructor(dataDir: string) {
    this.file = path.join(dataDir, "memory.json");
  }

  async init(legacyFile?: string) {
    await mkdir(path.dirname(this.file), { recursive: true });
    let raw: string | undefined;
    if (legacyFile) raw = await readFile(legacyFile, "utf8").catch(() => undefined);
    if (!raw) raw = await readFile(this.file, "utf8").catch(() => undefined);
    if (raw) {
      try {
        this.value = JSON.parse(raw);
      } catch {
        this.value = structuredClone(DEFAULT_MEMORY);
      }
    }
    if (raw && legacyFile && !(await readFile(this.file, "utf8").catch(() => undefined))) {
      await this.save(this.value);
    }
  }

  get() {
    return structuredClone(this.value);
  }

  async save(value: unknown) {
    this.value = value && typeof value === "object" ? value : structuredClone(DEFAULT_MEMORY);
    const temporary = `${this.file}.tmp`;
    await writeFile(temporary, JSON.stringify(this.value, null, 2));
    await rename(temporary, this.file);
    return this.get();
  }
}

