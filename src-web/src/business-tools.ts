import { tool, type ToolSet } from "ai";
import { z } from "zod";

const interval = z.enum(["today", "yesterday", "7d", "30d", "90d"]);

async function requestJson(url: string, init: RequestInit = {}) {
  const response = await fetch(url, { ...init, signal: init.signal ?? AbortSignal.timeout(15_000) });
  const text = await response.text();
  let payload: unknown;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    throw new Error(`API 返回了非 JSON 响应 (${response.status})`);
  }
  if (!response.ok) throw new Error(`API 请求失败 (${response.status})`);
  return payload;
}

export function createBusinessTools(apiKeys: Record<string, string>): ToolSet {
  const dataerKey = apiKeys.dataer || "";
  const commitKey = apiKeys.commit || "";
  const lookerKey = apiKeys.looker || "";
  const kieKey = apiKeys.kie || "";
  return {
    list_analytics_sites: tool({
      description: "列出全部 Analytics 站点。",
      inputSchema: z.object({}),
      execute: () => requestJson("https://tandataer.com/api/mcp/analytics/sites?limit=50", { headers: { "x-api-key": dataerKey } }),
    }),
    get_site_analytics: tool({
      description: "查询单个 Analytics 站点报表。",
      inputSchema: z.object({ siteRef: z.string(), interval }),
      execute: ({ siteRef, interval: selected }) => requestJson(`https://tandataer.com/api/mcp/analytics/sites/${encodeURIComponent(siteRef)}?interval=${selected}&trend_metric=views`, { headers: { "x-api-key": dataerKey } }),
    }),
    get_all_sites_analytics: tool({
      description: "汇总全部 Analytics 站点。",
      inputSchema: z.object({ interval }),
      execute: ({ interval: selected }) => requestJson(`https://tandataer.com/api/mcp/analytics/sites?limit=50&interval=${selected}`, { headers: { "x-api-key": dataerKey } }),
    }),
    get_commit_overview: tool({
      description: "获取提交活跃度概览。",
      inputSchema: z.object({}),
      execute: () => requestJson("https://commit-summary.bj050323.workers.dev/api/v1/overview", { headers: { "x-api-key": commitKey } }),
    }),
    list_recent_commits: tool({
      description: "列出最近提交。",
      inputSchema: z.object({ pageSize: z.number().int().min(1).max(50).optional() }),
      execute: ({ pageSize }) => requestJson(`https://commit-summary.bj050323.workers.dev/api/v1/commits?page=1&pageSize=${pageSize ?? 20}`, { headers: { "x-api-key": commitKey } }),
    }),
    list_monitors: tool({
      description: "列出 Looker 监控。",
      inputSchema: z.object({}),
      execute: () => requestJson("https://pointyarrow.net/api/mcp/monitors", { headers: { "x-api-key": lookerKey } }),
    }),
    read_monitor: tool({
      description: "读取 Looker 监控详情。",
      inputSchema: z.object({ ref: z.string() }),
      execute: ({ ref }) => requestJson(`https://pointyarrow.net/api/mcp/monitors/${encodeURIComponent(ref)}`, { headers: { "x-api-key": lookerKey } }),
    }),
    image_generation: tool({
      description: "创建图片生成任务。",
      inputSchema: z.object({ prompt: z.string().min(1), aspect_ratio: z.string().optional(), resolution: z.string().optional() }),
      execute: ({ prompt, aspect_ratio, resolution }) => requestJson("https://api.kie.ai/api/v1/jobs/createTask", { method: "POST", headers: { Authorization: `Bearer ${kieKey}`, "Content-Type": "application/json" }, body: JSON.stringify({ model: "gpt-image-2-text-to-image", input: { prompt, aspect_ratio: aspect_ratio ?? "auto", resolution: resolution ?? "1K" } }) }),
    }),
  };
}

