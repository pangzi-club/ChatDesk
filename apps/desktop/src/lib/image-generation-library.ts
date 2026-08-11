import type { ImageAspectRatio, ImageModel, ImageResolution } from "@/lib/image-generation";
import { settingsStore } from "@/lib/settings-store";

const STORE_KEY = "imageGenerationLibrary";
const STORAGE_KEY = "m-dashboard-image-generation-library-v1";
const MAX_RECORDS = 50;

export type ImageGenerationRecord = {
  id: string;
  createdAt: string;
  taskId: string;
  urls: string[];
  prompt: string;
  model: ImageModel;
  aspectRatio: ImageAspectRatio;
  resolution: ImageResolution;
};

function isTauri() {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

function asString(value: unknown, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function normalizeRecord(value: unknown): ImageGenerationRecord | null {
  if (!isRecord(value)) return null;
  const urls = Array.isArray(value.urls)
    ? value.urls.filter((url): url is string => typeof url === "string" && url.length > 0)
    : [];
  const createdAt = asString(value.createdAt);
  if (!urls.length || !createdAt || !asString(value.taskId) || !asString(value.prompt)) return null;
  return {
    id: asString(value.id, `${asString(value.taskId)}-${createdAt}`),
    createdAt,
    taskId: asString(value.taskId),
    urls,
    prompt: asString(value.prompt),
    model: asString(value.model, "gpt-image-2-text-to-image") as ImageModel,
    aspectRatio: asString(value.aspectRatio, "auto") as ImageAspectRatio,
    resolution: asString(value.resolution, "1K") as ImageResolution,
  };
}

function normalizeRecords(value: unknown): ImageGenerationRecord[] {
  if (!Array.isArray(value)) return [];
  return value
    .map(normalizeRecord)
    .filter((record): record is ImageGenerationRecord => Boolean(record))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, MAX_RECORDS);
}

export async function loadImageGenerationLibrary(): Promise<ImageGenerationRecord[]> {
  if (isTauri()) {
    try {
      return normalizeRecords(await settingsStore.get<unknown>(STORE_KEY));
    } catch (error) {
      console.error("Failed to load image generation library", error);
    }
  }
  try {
    return normalizeRecords(JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "[]"));
  } catch {
    return [];
  }
}

export async function saveImageGenerationRecord(record: ImageGenerationRecord) {
  const records = [
    record,
    ...(await loadImageGenerationLibrary()).filter((item) => item.id !== record.id),
  ].slice(0, MAX_RECORDS);
  if (isTauri()) {
    try {
      await settingsStore.set(STORE_KEY, records);
      await settingsStore.save();
      window.localStorage.removeItem(STORAGE_KEY);
      return records;
    } catch (error) {
      console.error("Failed to save image generation library", error);
    }
  }
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
  return records;
}
