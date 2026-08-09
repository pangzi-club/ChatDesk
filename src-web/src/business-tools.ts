import { tool, type ToolSet } from "ai";
import { z } from "zod";

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
  const kieKey = apiKeys.kie || "";
  return {
    image_generation: tool({
      description: "创建图片生成任务。",
      inputSchema: z.object({ prompt: z.string().min(1), aspect_ratio: z.string().optional(), resolution: z.string().optional() }),
      execute: ({ prompt, aspect_ratio, resolution }) => requestJson("https://api.kie.ai/api/v1/jobs/createTask", { method: "POST", headers: { Authorization: `Bearer ${kieKey}`, "Content-Type": "application/json" }, body: JSON.stringify({ model: "gpt-image-2-text-to-image", input: { prompt, aspect_ratio: aspect_ratio ?? "auto", resolution: resolution ?? "1K" } }) }),
    }),
  };
}
