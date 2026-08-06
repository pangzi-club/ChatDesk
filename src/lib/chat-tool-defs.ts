import { openai } from "@ai-sdk/openai";
import { type ToolSet, tool } from "ai";
import { z } from "zod";

import {
  CHAT_TOOL_PACKS,
  type ChatToolPackId,
  type ChatToolsSettings,
  getPackMeta,
} from "@/lib/chat-tools";
import { fetchCommitOverview, fetchRecentCommits, loadCommitApiKey } from "@/lib/commit";
import {
  type DataerInterval,
  fetchAllSites,
  fetchSiteReport,
  loadDataerApiKey,
} from "@/lib/dataer";
import { fetchMonitor, fetchMonitors, loadLookerApiKey } from "@/lib/looker";
import type { ModelConfig } from "@/lib/models";

const INTERVAL_SCHEMA = z.enum(["today", "yesterday", "7d", "30d", "90d"]);
const REPORT_CONCURRENCY = 4;
const BUSINESS_PACKS = new Set<ChatToolPackId>(["analytics", "commit", "looker"]);

export const CHAT_TOOL_DISPLAY_NAMES: Record<string, string> = {
  list_analytics_sites: "Analytics · 站点列表",
  get_site_analytics: "Analytics · 单站报表",
  get_all_sites_analytics: "Analytics · 全站汇总",
  get_commit_overview: "Commit · 活跃度概览",
  list_recent_commits: "Commit · 最近提交",
  list_monitors: "Looker · 监控列表",
  read_monitor: "Looker · 监控详情",
  web_search: "Web Search · 联网搜索",
};

export type ResolveActiveToolsResult = {
  tools: ToolSet;
  activePacks: ChatToolPackId[];
  toolNames: string[];
};

function toolError(message: string) {
  return { error: message };
}

async function withToolError<T>(run: () => Promise<T>): Promise<T | { error: string }> {
  try {
    return await run();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return toolError(message || "工具调用失败");
  }
}

function createAnalyticsTools(apiKey: string): ToolSet {
  return {
    list_analytics_sites: tool({
      description: "列出全部 Analytics 站点（ref、名称、域名）。",
      inputSchema: z.object({}),
      execute: async () =>
        withToolError(async () => {
          const sites = await fetchAllSites(apiKey);
          return {
            sites: sites.map((site) => ({
              ref: site.ref,
              name: site.name,
              domains: site.domains,
              enabled: site.enabled,
            })),
            count: sites.length,
          };
        }),
    }),
    get_site_analytics: tool({
      description: "按站点 ref 与时间区间查询流量（views / visitors / bounceRate）。",
      inputSchema: z.object({
        siteRef: z.string().describe("站点 ref，可先用 list_analytics_sites 获取"),
        interval: INTERVAL_SCHEMA.describe("时间区间"),
      }),
      execute: async ({ siteRef, interval }) =>
        withToolError(async () => {
          const report = await fetchSiteReport(apiKey, siteRef, interval as DataerInterval);
          return {
            site: {
              ref: report.site.ref,
              name: report.site.name,
              domains: report.site.domains,
            },
            interval: report.interval,
            stats: report.stats,
            generatedAt: report.generatedAt,
          };
        }),
    }),
    get_all_sites_analytics: tool({
      description: "汇总全部站点在指定区间的流量数据。",
      inputSchema: z.object({
        interval: INTERVAL_SCHEMA.describe("时间区间"),
      }),
      execute: async ({ interval }) =>
        withToolError(async () => {
          const sites = await fetchAllSites(apiKey);
          const rows: Array<{
            ref: string;
            name: string;
            domains: string[];
            stats: { views: number; visitors: number; bounces: number; bounceRate: number } | null;
            error: string | null;
          }> = sites.map((site) => ({
            ref: site.ref,
            name: site.name,
            domains: site.domains,
            stats: null,
            error: null,
          }));
          const queue = [...sites];
          async function worker() {
            while (queue.length > 0) {
              const site = queue.shift();
              if (!site) return;
              const row = rows.find((item) => item.ref === site.ref);
              if (!row) continue;
              try {
                const report = await fetchSiteReport(apiKey, site.ref, interval as DataerInterval);
                row.stats = report.stats;
              } catch (error) {
                row.error = error instanceof Error ? error.message : String(error);
              }
            }
          }
          await Promise.all(Array.from({ length: REPORT_CONCURRENCY }, () => worker()));
          return { interval, rows, count: rows.length };
        }),
    }),
  };
}

function createCommitTools(apiKey: string): ToolSet {
  return {
    get_commit_overview: tool({
      description: "获取近一年提交活跃度概览与当月按仓库统计。",
      inputSchema: z.object({}),
      execute: async () =>
        withToolError(async () => {
          const overview = await fetchCommitOverview(apiKey);
          return {
            activity: {
              rangeStart: overview.activity.rangeStart,
              rangeEnd: overview.activity.rangeEnd,
              totalCommits: overview.activity.totalCommits,
              activeDays: overview.activity.activeDays,
              longestStreak: overview.activity.longestStreak,
              repositories: overview.activity.repositories,
            },
            currentMonth: overview.currentMonth,
          };
        }),
    }),
    list_recent_commits: tool({
      description: "列出最近的 Git 提交记录。",
      inputSchema: z.object({
        pageSize: z.number().int().min(1).max(50).optional().describe("返回条数，默认 20"),
      }),
      execute: async ({ pageSize }) =>
        withToolError(async () => {
          const result = await fetchRecentCommits(apiKey, pageSize ?? 20);
          return {
            total: result.total,
            commits: result.data.map((item) => ({
              sha: item.sha.slice(0, 7),
              message: item.message,
              author: item.authorLogin ?? item.authorName,
              committedAt: item.committedAt,
              repository: item.repository.fullName,
              htmlUrl: item.htmlUrl,
            })),
          };
        }),
    }),
  };
}

function createLookerTools(apiKey: string): ToolSet {
  return {
    list_monitors: tool({
      description: "列出 Looker 内容监控。",
      inputSchema: z.object({}),
      execute: async () =>
        withToolError(async () => {
          const result = await fetchMonitors(apiKey);
          return {
            monitors: result.monitors.map((monitor) => ({
              ref: monitor.ref,
              name: monitor.name,
              taskTypeName: monitor.taskTypeName,
              enabled: monitor.enabled,
              hasUpdate: monitor.hasUpdate,
              keywords: monitor.keywords,
              updatedAt: monitor.updatedAt,
              lastRunAt: monitor.lastRunAt,
            })),
            count: result.monitors.length,
            pageInfo: result.pageInfo,
          };
        }),
    }),
    read_monitor: tool({
      description: "读取某个监控的详情与最新内容预览。",
      inputSchema: z.object({
        ref: z.string().describe("监控 ref，可先用 list_monitors 获取"),
      }),
      execute: async ({ ref }) =>
        withToolError(async () => {
          const result = await fetchMonitor(ref, apiKey);
          return {
            monitor: {
              ref: result.monitor.ref,
              name: result.monitor.name,
              taskTypeName: result.monitor.taskTypeName,
              enabled: result.monitor.enabled,
              keywords: result.monitor.keywords,
              webUrl: result.monitor.webUrl,
              updatedAt: result.monitor.updatedAt,
              lastRunAt: result.monitor.lastRunAt,
            },
            items: result.items.map((item) => ({
              title: item.title,
              content: item.content,
              publishedAt: item.publishedAt,
              webUrl: item.webUrl,
              source: item.source,
              metrics: item.metrics,
            })),
            pageInfo: result.pageInfo,
          };
        }),
    }),
  };
}

async function loadPackApiKey(pack: ChatToolPackId): Promise<string> {
  if (pack === "analytics") return (await loadDataerApiKey()).trim();
  if (pack === "commit") return (await loadCommitApiKey()).trim();
  if (pack === "looker") return (await loadLookerApiKey()).trim();
  return "";
}

function createPackTools(pack: ChatToolPackId, apiKey: string): ToolSet {
  if (pack === "analytics") return createAnalyticsTools(apiKey);
  if (pack === "commit") return createCommitTools(apiKey);
  if (pack === "looker") return createLookerTools(apiKey);
  return {};
}

function createWebSearchTools(): ToolSet {
  // Provider-executed tools are accepted by streamText, but ToolSet's
  // intersection with Pick<..., 'execute' | ...> is too strict for them.
  return {
    web_search: openai.tools.webSearch({}) as unknown as ToolSet[string],
  };
}

function canActivatePack(
  pack: (typeof CHAT_TOOL_PACKS)[number],
  model: Pick<ModelConfig, "supportsTools" | "responsive">,
  apiKey: string,
): boolean {
  if (!model.supportsTools) return false;
  if (pack.requiresResponsive && !model.responsive) return false;
  if (pack.keyLabel && !apiKey) return false;
  return true;
}

/** 按启用 ∩ API Key / Responses ∩ 模型能力，动态组装当前可用 tools。 */
export async function resolveActiveTools(
  enabled: ChatToolsSettings,
  model: ModelConfig | undefined,
): Promise<ResolveActiveToolsResult> {
  if (!model?.supportsTools) {
    return { tools: {}, activePacks: [], toolNames: [] };
  }

  const tools: ToolSet = {};
  const activePacks: ChatToolPackId[] = [];

  for (const pack of CHAT_TOOL_PACKS) {
    if (!enabled[pack.id]) continue;
    const apiKey = BUSINESS_PACKS.has(pack.id) ? await loadPackApiKey(pack.id) : "";
    if (!canActivatePack(pack, model, apiKey)) continue;
    if (pack.id === "web_search") {
      Object.assign(tools, createWebSearchTools());
    } else {
      Object.assign(tools, createPackTools(pack.id, apiKey));
    }
    activePacks.push(pack.id);
  }

  return {
    tools,
    activePacks,
    toolNames: Object.keys(tools),
  };
}

/** 供 UI 判断哪些包「对模型实际可用」（启用且满足 Key / Responses 等前置条件）。 */
export async function resolveAvailablePacks(
  enabled: ChatToolsSettings,
  model: Pick<ModelConfig, "supportsTools" | "responsive"> | undefined,
): Promise<ChatToolPackId[]> {
  if (!model?.supportsTools) return [];
  const available: ChatToolPackId[] = [];
  for (const pack of CHAT_TOOL_PACKS) {
    if (!enabled[pack.id]) continue;
    const apiKey = BUSINESS_PACKS.has(pack.id) ? await loadPackApiKey(pack.id) : "";
    if (canActivatePack(pack, model, apiKey)) available.push(pack.id);
  }
  return available;
}

export function formatToolsSystemHint(activePacks: ChatToolPackId[]): string {
  if (activePacks.length === 0) return "";

  const lines = [
    "你可以使用下列工具获取信息。需要事实或实时数据时主动调用工具，不要编造。",
    "用中文简洁总结工具结果；需要多步时先列表再取详情；联网搜索请注明来源要点。",
    "当前可用工具包：",
  ];

  for (const packId of activePacks) {
    const pack = getPackMeta(packId);
    lines.push(`- ${pack.label}：${pack.description} 示例：「${pack.examples[0]}」`);
  }

  return lines.join("\n");
}
