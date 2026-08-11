import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

export type ImageGenerationRecord = {
  id: string;
  createdAt: string;
  taskId: string;
  urls: string[];
  prompt: string;
  model: string;
  aspectRatio: string;
  resolution: string;
};

function isRecord(value: unknown): value is ImageGenerationRecord {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<ImageGenerationRecord>;
  return (
    typeof item.id === "string" &&
    typeof item.createdAt === "string" &&
    typeof item.taskId === "string" &&
    Array.isArray(item.urls) &&
    item.urls.every((url) => typeof url === "string") &&
    typeof item.prompt === "string" &&
    typeof item.model === "string" &&
    typeof item.aspectRatio === "string" &&
    typeof item.resolution === "string"
  );
}

export class ImageGenerationStore {
  private readonly file: string;
  private value: ImageGenerationRecord[] = [];

  constructor(dataDir: string) {
    this.file = path.join(dataDir, "image-generation.json");
  }

  async init() {
    await mkdir(path.dirname(this.file), { recursive: true });
    try {
      const parsed = JSON.parse(await readFile(this.file, "utf8")) as unknown;
      this.value = Array.isArray(parsed) ? parsed.filter(isRecord).slice(0, 50) : [];
    } catch {
      this.value = [];
    }
  }

  list() {
    return structuredClone(this.value);
  }

  async save(value: unknown) {
    if (!isRecord(value)) throw new Error("图片记录无效");
    this.value = [value, ...this.value.filter((item) => item.id !== value.id)].slice(0, 50);
    await this.persist();
    return structuredClone(this.value);
  }

  async clear() {
    this.value = [];
    await this.persist();
  }

  private async persist() {
    const temporary = `${this.file}.${process.pid}.tmp`;
    await writeFile(temporary, JSON.stringify(this.value, null, 2), "utf8");
    await rename(temporary, this.file);
  }
}
