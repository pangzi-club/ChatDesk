import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  DEFAULT_WORKSPACE_ID,
  MEMORY_CATEGORIES,
  type MemoryCategory,
  type MemoryItem,
  type MemoryJob,
  type MemoryOverview,
  type MemorySettings,
  type MemorySource,
  type MemorySummary,
} from "@chatdesk/shared";

const DEFAULT_SETTINGS: MemorySettings = {
  useMemories: true,
  generateMemories: true,
  skipExternalContext: true,
  maxUnusedDays: 90,
};

type MemoryDocument = {
  schemaVersion: 2;
  settings: MemorySettings;
  summaries: MemorySummary[];
  items: MemoryItem[];
  lastExtractedAt?: string;
  lastConsolidatedAt?: string;
};

const DEFAULT_DOCUMENT: MemoryDocument = {
  schemaVersion: 2,
  settings: DEFAULT_SETTINGS,
  summaries: [],
  items: [],
};

async function readJson(file: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(file, "utf8")) as unknown;
  } catch {
    return undefined;
  }
}

async function atomicWrite(file: string, value: unknown) {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(value, null, 2), "utf8");
  await rename(temporary, file);
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function memoryCategory(value: unknown): MemoryCategory {
  return typeof value === "string" && MEMORY_CATEGORIES.includes(value as MemoryCategory)
    ? (value as MemoryCategory)
    : "other";
}

function normalizeSettings(value: unknown): MemorySettings {
  const input = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  return {
    useMemories:
      typeof input.useMemories === "boolean" ? input.useMemories : DEFAULT_SETTINGS.useMemories,
    generateMemories:
      typeof input.generateMemories === "boolean"
        ? input.generateMemories
        : DEFAULT_SETTINGS.generateMemories,
    skipExternalContext:
      typeof input.skipExternalContext === "boolean"
        ? input.skipExternalContext
        : DEFAULT_SETTINGS.skipExternalContext,
    maxUnusedDays:
      typeof input.maxUnusedDays === "number" && Number.isFinite(input.maxUnusedDays)
        ? Math.max(1, Math.min(3650, Math.round(input.maxUnusedDays)))
        : DEFAULT_SETTINGS.maxUnusedDays,
    ...(stringValue(input.extractionModelId)
      ? { extractionModelId: stringValue(input.extractionModelId) }
      : {}),
    ...(stringValue(input.consolidationModelId)
      ? { consolidationModelId: stringValue(input.consolidationModelId) }
      : {}),
  };
}

function normalizeItem(value: unknown, now = new Date().toISOString()): MemoryItem | null {
  if (!value || typeof value !== "object") return null;
  const input = value as Record<string, unknown>;
  const content = stringValue(input.content);
  if (!content) return null;
  const createdAt = stringValue(input.createdAt) ?? now;
  const updatedAt = stringValue(input.updatedAt) ?? createdAt;
  const source = input.source === "generated" ? "generated" : "manual";
  const scope =
    input.scope === "workspace" && stringValue(input.workspaceId) ? "workspace" : "global";
  const legacySessionId = stringValue(input.sourceSessionId);
  const evidence = Array.isArray(input.evidence)
    ? input.evidence.flatMap((entry) => {
        if (!entry || typeof entry !== "object") return [];
        const record = entry as Record<string, unknown>;
        const sessionId = stringValue(record.sessionId);
        const excerpt = stringValue(record.excerpt);
        if (!sessionId || !excerpt) return [];
        return [
          {
            sessionId,
            ...(stringValue(record.messageId) ? { messageId: stringValue(record.messageId) } : {}),
            excerpt,
            capturedAt: stringValue(record.capturedAt) ?? updatedAt,
          },
        ];
      })
    : legacySessionId
      ? [{ sessionId: legacySessionId, excerpt: content, capturedAt: updatedAt }]
      : [];
  return {
    id: stringValue(input.id) ?? randomUUID(),
    content,
    scope,
    ...(scope === "workspace" ? { workspaceId: stringValue(input.workspaceId) } : {}),
    category: memoryCategory(input.category),
    status: input.status === "archived" ? "archived" : "active",
    pinned: typeof input.pinned === "boolean" ? input.pinned : source === "manual",
    source,
    keywords: Array.isArray(input.keywords)
      ? [...new Set(input.keywords.filter((item): item is string => typeof item === "string"))]
      : [],
    evidence,
    createdAt,
    updatedAt,
    ...(stringValue(input.archivedAt) ? { archivedAt: stringValue(input.archivedAt) } : {}),
    ...(stringValue(input.archiveReason)
      ? { archiveReason: stringValue(input.archiveReason) }
      : {}),
    usageCount:
      typeof input.usageCount === "number" && Number.isFinite(input.usageCount)
        ? Math.max(0, Math.round(input.usageCount))
        : 0,
    ...(stringValue(input.lastUsedAt) ? { lastUsedAt: stringValue(input.lastUsedAt) } : {}),
  };
}

function normalizeDocument(value: unknown): MemoryDocument {
  if (!value || typeof value !== "object") return structuredClone(DEFAULT_DOCUMENT);
  const input = value as Record<string, unknown>;
  const legacyEnabled = typeof input.enabled === "boolean" ? input.enabled : undefined;
  const settings = normalizeSettings(input.settings);
  if (legacyEnabled !== undefined && input.settings === undefined) {
    settings.useMemories = legacyEnabled;
    settings.generateMemories = legacyEnabled;
  }
  return {
    schemaVersion: 2,
    settings,
    summaries: Array.isArray(input.summaries)
      ? input.summaries.filter((item): item is MemorySummary => {
          if (!item || typeof item !== "object") return false;
          const summary = item as Partial<MemorySummary>;
          return (
            (summary.scope === "global" || summary.scope === "workspace") &&
            typeof summary.content === "string" &&
            typeof summary.updatedAt === "string" &&
            Array.isArray(summary.keywords)
          );
        })
      : [],
    items: Array.isArray(input.items)
      ? input.items.map((item) => normalizeItem(item)).filter((item): item is MemoryItem => !!item)
      : [],
    ...(stringValue(input.lastExtractedAt)
      ? { lastExtractedAt: stringValue(input.lastExtractedAt) }
      : {}),
    ...(stringValue(input.lastConsolidatedAt)
      ? { lastConsolidatedAt: stringValue(input.lastConsolidatedAt) }
      : {}),
  };
}

function searchableTerms(value: string) {
  const normalized = value.normalize("NFKC").toLocaleLowerCase().replace(/\s+/g, " ").trim();
  const terms = new Set(normalized.split(/[\s,，。！？、；：.!?;:()（）[\]{}]+/).filter(Boolean));
  const characters = Array.from(normalized.replace(/\s+/g, ""));
  for (let index = 0; index < characters.length - 1; index += 1) {
    terms.add(`${characters[index]}${characters[index + 1]}`);
  }
  return terms;
}

export class MemoryStore {
  private document: MemoryDocument = structuredClone(DEFAULT_DOCUMENT);
  private jobs: MemoryJob[] = [];
  private sources = new Map<string, MemorySource>();
  private readonly file: string;
  private readonly jobsFile: string;
  private readonly sourcesRoot: string;
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(dataDir: string) {
    this.file = path.join(dataDir, "memory.json");
    this.jobsFile = path.join(dataDir, "memory-jobs.json");
    this.sourcesRoot = path.join(dataDir, "memory-sources");
  }

  async init() {
    await mkdir(this.sourcesRoot, { recursive: true });
    this.document = normalizeDocument(await readJson(this.file));
    const jobs = await readJson(this.jobsFile);
    this.jobs = Array.isArray(jobs)
      ? jobs
          .filter((item): item is MemoryJob => !!item && typeof item === "object")
          .map((job) => (job.status === "running" ? { ...job, status: "queued" as const } : job))
      : [];
    const entries = await readdir(this.sourcesRoot, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
      const value = await readJson(path.join(this.sourcesRoot, entry.name));
      if (
        value &&
        typeof value === "object" &&
        typeof (value as MemorySource).sessionId === "string"
      ) {
        this.sources.set((value as MemorySource).sessionId, value as MemorySource);
      }
    }
  }

  get(): MemoryOverview {
    return {
      schemaVersion: 2,
      settings: structuredClone(this.document.settings),
      summaries: structuredClone(this.document.summaries),
      items: structuredClone(this.document.items),
      pipeline: {
        ...(this.document.lastExtractedAt
          ? { lastExtractedAt: this.document.lastExtractedAt }
          : {}),
        ...(this.document.lastConsolidatedAt
          ? { lastConsolidatedAt: this.document.lastConsolidatedAt }
          : {}),
        queuedJobs: this.jobs.filter((job) => job.status === "queued").length,
        runningJobs: this.jobs.filter((job) => job.status === "running").length,
        failedJobs: this.jobs.filter((job) => job.status === "failed").length,
      },
    };
  }

  getSettings() {
    return structuredClone(this.document.settings);
  }

  async updateSettings(value: Partial<MemorySettings>) {
    this.document.settings = normalizeSettings({ ...this.document.settings, ...value });
    await this.saveDocument();
    return this.get();
  }

  async createItem(input: Pick<MemoryItem, "content"> & Partial<MemoryItem>) {
    const item = normalizeItem({ ...input, id: randomUUID(), source: "manual", pinned: true });
    if (!item) throw new Error("记忆内容不能为空");
    this.document.items = [item, ...this.document.items];
    await this.saveDocument();
    return structuredClone(item);
  }

  async updateItem(id: string, input: Partial<MemoryItem>) {
    const index = this.document.items.findIndex((item) => item.id === id);
    if (index < 0) throw new Error("记忆不存在");
    const previous = this.document.items[index] as MemoryItem;
    const next = normalizeItem({ ...previous, ...input, id, updatedAt: new Date().toISOString() });
    if (!next) throw new Error("记忆内容不能为空");
    this.document.items[index] = next;
    await this.saveDocument();
    return structuredClone(next);
  }

  async deleteItem(id: string) {
    const length = this.document.items.length;
    this.document.items = this.document.items.filter((item) => item.id !== id);
    if (this.document.items.length === length) return false;
    await this.saveDocument();
    return true;
  }

  listSources() {
    return [...this.sources.values()]
      .sort((a, b) => b.generatedAt.localeCompare(a.generatedAt))
      .map((source) => structuredClone(source));
  }

  getSource(sessionId: string) {
    const source = this.sources.get(sessionId);
    return source ? structuredClone(source) : undefined;
  }

  async saveSource(source: MemorySource) {
    this.sources.set(source.sessionId, structuredClone(source));
    this.document.lastExtractedAt = source.generatedAt;
    await Promise.all([
      atomicWrite(path.join(this.sourcesRoot, `${source.sessionId}.json`), source),
      this.saveDocument(),
    ]);
  }

  async removeSource(sessionId: string) {
    this.sources.delete(sessionId);
    const now = new Date().toISOString();
    this.document.items = this.document.items.map((item) => {
      const evidence = item.evidence.filter((entry) => entry.sessionId !== sessionId);
      if (item.source !== "generated" || evidence.length > 0 || item.pinned)
        return { ...item, evidence };
      return {
        ...item,
        evidence,
        status: "archived" as const,
        archivedAt: now,
        archiveReason: "来源会话已删除",
        updatedAt: now,
      };
    });
    await Promise.all([
      rm(path.join(this.sourcesRoot, `${sessionId}.json`), { force: true }),
      this.saveDocument(),
    ]);
  }

  listJobs() {
    return structuredClone(this.jobs);
  }

  async saveJob(job: MemoryJob) {
    const index = this.jobs.findIndex((item) => item.id === job.id);
    if (index >= 0) this.jobs[index] = structuredClone(job);
    else this.jobs.push(structuredClone(job));
    await this.saveJobs();
    return structuredClone(job);
  }

  async replaceGenerated(items: MemoryItem[], summaries: MemorySummary[]) {
    const manual = this.document.items.filter((item) => item.source === "manual");
    this.document.items = [...manual, ...items];
    this.document.summaries = summaries;
    this.document.lastConsolidatedAt = new Date().toISOString();
    await this.saveDocument();
    return this.get();
  }

  formatSummary(workspaceId?: string) {
    if (!this.document.settings.useMemories) return "";
    const summaries = this.document.summaries.filter(
      (summary) =>
        summary.scope === "global" ||
        (workspaceId &&
          workspaceId !== DEFAULT_WORKSPACE_ID &&
          summary.workspaceId === workspaceId),
    );
    if (summaries.length === 0) return "";
    return [
      "以下是长期记忆导览。只在相关时使用；需要细节时调用 search_memory。",
      ...summaries.map((summary) => summary.content),
    ].join("\n\n");
  }

  async search(query: string, workspaceId?: string, limit = 8) {
    if (!this.document.settings.useMemories) return [];
    const queryTerms = searchableTerms(query);
    const now = Date.now();
    const ranked = this.document.items
      .filter(
        (item) =>
          item.status === "active" &&
          (item.scope === "global" ||
            (workspaceId &&
              workspaceId !== DEFAULT_WORKSPACE_ID &&
              item.workspaceId === workspaceId)),
      )
      .map((item) => {
        const terms = searchableTerms(`${item.content} ${item.keywords.join(" ")}`);
        let relevance = 0;
        for (const term of queryTerms) if (terms.has(term)) relevance += term.length > 1 ? 3 : 1;
        let score = relevance;
        if (item.scope === "workspace") score += 1;
        score += Math.log2(item.usageCount + 1);
        const ageDays = Math.max(0, now - Date.parse(item.updatedAt)) / 86_400_000;
        score += Math.max(0, 2 - ageDays / 30);
        return { item, relevance, score };
      })
      .filter(({ relevance }) => relevance > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, Math.max(1, Math.min(20, limit)));
    if (ranked.length > 0) {
      const usedAt = new Date().toISOString();
      const ids = new Set(ranked.map(({ item }) => item.id));
      this.document.items = this.document.items.map((item) =>
        ids.has(item.id) ? { ...item, usageCount: item.usageCount + 1, lastUsedAt: usedAt } : item,
      );
      await this.saveDocument();
    }
    return ranked.map(({ item }) => structuredClone(item));
  }

  async archiveUnused(now = new Date()) {
    const cutoff = now.getTime() - this.document.settings.maxUnusedDays * 86_400_000;
    let changed = false;
    this.document.items = this.document.items.map((item) => {
      if (
        item.source === "manual" ||
        item.pinned ||
        item.status === "archived" ||
        Date.parse(item.lastUsedAt ?? item.updatedAt) >= cutoff
      ) {
        return item;
      }
      changed = true;
      return {
        ...item,
        status: "archived" as const,
        archivedAt: now.toISOString(),
        archiveReason: `${this.document.settings.maxUnusedDays} 天未使用`,
        updatedAt: now.toISOString(),
      };
    });
    if (changed) await this.saveDocument();
  }

  private async saveDocument() {
    await this.enqueueWrite(() => atomicWrite(this.file, this.document));
  }

  private async saveJobs() {
    await this.enqueueWrite(() => atomicWrite(this.jobsFile, this.jobs));
  }

  private async enqueueWrite(write: () => Promise<void>) {
    const next = this.writeQueue.catch(() => undefined).then(write);
    this.writeQueue = next;
    await next;
  }
}
