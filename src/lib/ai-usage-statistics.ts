import type { UIMessage } from "ai";

import {
  type ArchiveMessage,
  type ArchiveSource,
  loadArchiveIndex,
  loadArchiveSession,
} from "@/lib/chat-archive";
import { loadChatIndex, loadChatSession } from "@/lib/chat-store";
import { addTokenUsage, emptyTokenUsage, getMessageUsage, type TokenUsage } from "@/lib/chat-usage";
import { loadModels, type ModelConfig } from "@/lib/models";

export type UsagePeriod = "today" | "week" | "month" | "30d" | "year";

export type UsageRecord = {
  date: string;
  source: ArchiveSource;
  provider: string;
  model: string;
  usage: TokenUsage;
  cost?: number;
  messageCount: number;
};

export type UsageAggregate = {
  provider: string;
  model: string;
  source: ArchiveSource | "mixed";
  messageCount: number;
  usage: TokenUsage;
  cost?: number;
  hasUnknownCost: boolean;
};

export type DailyUsage = { date: string; usage: TokenUsage; messageCount: number; cost?: number };

export type AiUsageStatistics = {
  period: UsagePeriod;
  from: string;
  to: string;
  total: UsageAggregate;
  daily: DailyUsage[];
  byProvider: UsageAggregate[];
  byModel: UsageAggregate[];
  details: UsageAggregate[];
  heatmap: DailyUsage[];
};

const DAY_MS = 86_400_000;

function dateKey(value: string | undefined, fallback: Date): string {
  const date = value ? new Date(value) : fallback;
  if (Number.isNaN(date.getTime())) return formatDate(fallback);
  return formatDate(date);
}

function formatDate(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function startOfDay(date: Date) {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next;
}

function periodStart(period: UsagePeriod, now: Date) {
  const start = startOfDay(now);
  if (period === "today") return start;
  if (period === "week") {
    const day = start.getDay() || 7;
    start.setDate(start.getDate() - day + 1);
    return start;
  }
  if (period === "month") return new Date(start.getFullYear(), start.getMonth(), 1);
  if (period === "30d") return new Date(start.getTime() - 29 * DAY_MS);
  return new Date(start.getFullYear() - 1, start.getMonth(), start.getDate());
}

function usageTokens(usage: TokenUsage) {
  return (
    usage.totalTokens ??
    [
      usage.inputTokens,
      usage.outputTokens,
      usage.cacheReadTokens,
      usage.cacheWriteTokens,
      usage.reasoningOutputTokens,
    ]
      .filter((value): value is number => typeof value === "number")
      .reduce((sum, value) => sum + value, 0)
  );
}

function costForUsage(usage: TokenUsage, model?: ModelConfig, fallbackModel?: ModelConfig) {
  const prices: Array<[keyof TokenUsage, keyof ModelConfig]> = [
    ["inputTokens", "inputPricePerMillion"],
    ["outputTokens", "outputPricePerMillion"],
    ["cacheReadTokens", "cacheReadPricePerMillion"],
    ["cacheWriteTokens", "cacheWritePricePerMillion"],
  ];
  let cost = 0;
  for (const [usageKey, priceKey] of prices) {
    const tokens = usage[usageKey];
    if (typeof tokens !== "number" || tokens === 0) continue;
    const baseInputPrice = model?.inputPricePerMillion ?? fallbackModel?.inputPricePerMillion;
    const price =
      model?.[priceKey] ??
      fallbackModel?.[priceKey] ??
      (priceKey === "cacheReadPricePerMillion" || priceKey === "cacheWritePricePerMillion"
        ? baseInputPrice === undefined
          ? undefined
          : baseInputPrice / 10
        : undefined);
    if (typeof price !== "number" || price < 0) return undefined;
    cost += (tokens / 1_000_000) * price;
  }
  return cost;
}

function addAggregate(target: Map<string, UsageAggregate>, record: UsageRecord, key: string) {
  const current = target.get(key);
  if (!current) {
    target.set(key, {
      provider: record.provider,
      model: record.model,
      source: record.source,
      messageCount: record.messageCount,
      usage: record.usage,
      cost: record.cost,
      hasUnknownCost: record.cost === undefined && usageTokens(record.usage) > 0,
    });
    return;
  }
  current.messageCount += record.messageCount;
  current.usage = addTokenUsage(current.usage, record.usage);
  current.source = current.source === record.source ? current.source : "mixed";
  current.hasUnknownCost ||= record.cost === undefined && usageTokens(record.usage) > 0;
  if (record.cost !== undefined) current.cost = (current.cost ?? 0) + record.cost;
}

function recordFromMessage(
  source: ArchiveSource,
  provider: string,
  model: string,
  message: UIMessage | ArchiveMessage,
  fallbackDate: Date,
  modelConfig?: ModelConfig,
  fallbackModel?: ModelConfig,
): UsageRecord | null {
  if (message.role !== "assistant") return null;
  const usage =
    "parts" in message
      ? (getMessageUsage(message) ?? emptyTokenUsage())
      : (message.usage ?? emptyTokenUsage());
  return {
    date: dateKey("createdAt" in message ? message.createdAt : undefined, fallbackDate),
    source,
    provider,
    model,
    usage,
    cost: costForUsage(usage, modelConfig, fallbackModel),
    messageCount: 1,
  };
}

async function collectRecords(models: ModelConfig[]): Promise<UsageRecord[]> {
  const records: UsageRecord[] = [];
  const fallbackModel = models.find((model) => model.isDefault) ?? models[0];
  const modelById = new Map(models.map((model) => [model.id, model]));
  const modelByName = new Map(models.map((model) => [model.name, model]));
  const [nativeIndex, archiveIndex] = await Promise.all([loadChatIndex(), loadArchiveIndex()]);

  await Promise.all(
    nativeIndex.map(async (item) => {
      const session = await loadChatSession(item.id);
      if (!session) return;
      const config = session.modelId ? modelById.get(session.modelId) : undefined;
      const model = config?.name ?? session.modelId ?? "未知模型";
      const provider = config?.provider ?? "未知供应商";
      for (const message of session.messages) {
        const record = recordFromMessage(
          "native",
          provider,
          model,
          message,
          new Date(session.updatedAt),
          config,
          fallbackModel,
        );
        if (record) records.push(record);
      }
    }),
  );

  await Promise.all(
    archiveIndex.map(async (item) => {
      const session = await loadArchiveSession(item.id);
      if (!session) return;
      const config = session.model ? modelByName.get(session.model) : undefined;
      const model = session.model ?? "未知模型";
      const provider = config?.provider ?? (session.source === "codex" ? "Codex" : "Claude Code");
      for (const message of session.messages) {
        const record = recordFromMessage(
          session.source,
          provider,
          model,
          message,
          new Date(session.updatedAt),
          config,
          fallbackModel,
        );
        if (record) records.push(record);
      }
    }),
  );
  return records;
}

export async function analyzeAiUsage(
  period: UsagePeriod = "month",
  now = new Date(),
): Promise<AiUsageStatistics> {
  const start = periodStart(period, now);
  const end = new Date(startOfDay(now).getTime() + DAY_MS);
  const records = await collectRecords(await loadModels());
  const filtered = records.filter((record) => {
    const date = new Date(`${record.date}T00:00:00`);
    return date >= start && date < end;
  });
  const byProvider = new Map<string, UsageAggregate>();
  const byModel = new Map<string, UsageAggregate>();
  const details = new Map<string, UsageAggregate>();
  const dailyMap = new Map<string, DailyUsage>();
  for (const record of filtered) {
    addAggregate(byProvider, record, record.provider);
    addAggregate(byModel, record, record.model);
    addAggregate(details, record, `${record.provider}:${record.model}:${record.source}`);
    const day = dailyMap.get(record.date) ?? {
      date: record.date,
      usage: emptyTokenUsage(),
      messageCount: 0,
      cost: 0,
    };
    day.usage = addTokenUsage(day.usage, record.usage);
    day.messageCount += 1;
    if (record.cost === undefined) day.cost = undefined;
    else if (day.cost !== undefined) day.cost += record.cost;
    dailyMap.set(record.date, day);
  }
  const total = [...byModel.values()].reduce<UsageAggregate>(
    (acc, value) => {
      acc.messageCount += value.messageCount;
      acc.usage = addTokenUsage(acc.usage, value.usage);
      acc.hasUnknownCost ||= value.hasUnknownCost;
      if (value.cost !== undefined) acc.cost = (acc.cost ?? 0) + value.cost;
      return acc;
    },
    {
      provider: "全部",
      model: "全部",
      source: "mixed",
      messageCount: 0,
      usage: emptyTokenUsage(),
      cost: 0,
      hasUnknownCost: false,
    },
  );
  if (total.hasUnknownCost) total.cost = undefined;
  const heatmapStart = new Date(startOfDay(now).getTime() - 139 * DAY_MS);
  const heatmapMap = new Map<string, DailyUsage>();
  for (const record of records) {
    const date = new Date(`${record.date}T00:00:00`);
    if (date < heatmapStart || date >= end) continue;
    const day = heatmapMap.get(record.date) ?? {
      date: record.date,
      usage: emptyTokenUsage(),
      messageCount: 0,
      cost: 0,
    };
    day.usage = addTokenUsage(day.usage, record.usage);
    day.messageCount += 1;
    if (record.cost === undefined) day.cost = undefined;
    else if (day.cost !== undefined) day.cost += record.cost;
    heatmapMap.set(record.date, day);
  }
  const heatmap = [...heatmapMap.values()];
  for (
    let cursor = heatmapStart;
    cursor <= startOfDay(now);
    cursor = new Date(cursor.getTime() + DAY_MS)
  ) {
    const key = formatDate(cursor);
    if (!heatmap.some((item) => item.date === key))
      heatmap.push({ date: key, usage: emptyTokenUsage(), messageCount: 0, cost: 0 });
  }
  const sortByTokens = (left: UsageAggregate, right: UsageAggregate) =>
    usageTokens(right.usage) - usageTokens(left.usage);
  return {
    period,
    from: formatDate(start),
    to: formatDate(new Date(end.getTime() - DAY_MS)),
    total,
    daily: [...dailyMap.values()].sort((a, b) => a.date.localeCompare(b.date)),
    heatmap: heatmap.sort((a, b) => a.date.localeCompare(b.date)),
    byProvider: [...byProvider.values()].sort(sortByTokens),
    byModel: [...byModel.values()].sort(sortByTokens),
    details: [...details.values()].sort(sortByTokens),
  };
}

export function tokenTotal(usage: TokenUsage) {
  return usageTokens(usage);
}
