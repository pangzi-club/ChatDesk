import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { generateText } from "ai";
import type { AssistantMessageEvent } from "@/lib/assistant";
import { type DataerSite, fetchAllSites, fetchSiteReport, loadDataerApiKey } from "@/lib/dataer";
import { loadModels, type ModelConfig } from "@/lib/models";
import { appendSystemLog } from "@/lib/system-log";

const TRIGGER = "niumadiruan";
const handledMessageIds = new Set<string>();

type TrafficData = {
  site: DataerSite;
  views: number;
  visitors: number;
  bounces: number;
  bounceRate: number;
};

export async function respondToTrafficTrigger(
  event: AssistantMessageEvent,
  send: (conversationId: string, text: string) => Promise<unknown>,
) {
  const { message, conversation } = event;
  if (message.direction !== "inbound" || !message.text.toLowerCase().includes(TRIGGER)) return;
  if (handledMessageIds.has(message.id)) return;
  handledMessageIds.add(message.id);
  const startedAt = Date.now();
  await writeLog("info", `收到 ${TRIGGER} 请求（会话 ${conversation.id}）`);

  try {
    await send(conversation.id, "已收到 niumadiruan 请求，正在查询今日流量数据，请稍候。");
    await writeLog("info", "已发送处理中反馈");
    const queryStartedAt = Date.now();
    const traffic = await loadTodayTraffic();
    await writeLog("info", `今日流量数据查询完成（${Date.now() - queryStartedAt}ms）`);
    const summaryStartedAt = Date.now();
    const summary = await summarizeTraffic(traffic);
    await writeLog("info", `AI 总结完成（${Date.now() - summaryStartedAt}ms）`);
    await send(conversation.id, summary);
    await writeLog("success", `niumadiruan 自动回复完成（${Date.now() - startedAt}ms）`);
  } catch (error) {
    handledMessageIds.delete(message.id);
    const detail = error instanceof Error ? error.message : String(error);
    await writeLog("error", `niumadiruan 自动回复失败（${Date.now() - startedAt}ms）`, detail);
    await send(conversation.id, `查询 niumadiruan 今日访问数据失败：${detail}`);
  }
}

async function writeLog(level: "info" | "success" | "error", message: string, details?: string) {
  await appendSystemLog({ level, source: "飞书助理", message, details }).catch(() => {
    // Logging must not interrupt the assistant response.
  });
}

async function loadTodayTraffic(): Promise<TrafficData | null> {
  const apiKey = (await loadDataerApiKey()).trim();
  if (!apiKey) throw new Error("尚未配置 DATAER_API_KEY");
  const sites = await fetchAllSites(apiKey);
  const site = sites.find((item) => {
    const haystack = [item.name, item.siteId, item.ref, ...item.domains].join(" ").toLowerCase();
    return haystack.includes(TRIGGER);
  });
  if (!site) return null;
  const report = await fetchSiteReport(apiKey, site.ref, "today");
  return { site, ...report.stats };
}

async function summarizeTraffic(traffic: TrafficData | null): Promise<string> {
  if (!traffic) return "今天的流量分析中没有找到 niumadiruan 站点。";

  const facts = [
    `站点：${traffic.site.name}`,
    `域名：${traffic.site.domains.join(", ") || "-"}`,
    `浏览量：${traffic.views}`,
    `访客数：${traffic.visitors}`,
    `跳出次数：${traffic.bounces}`,
    `跳出率：${(traffic.bounceRate).toFixed(2)}%`,
  ].join("\n");
  const models = await loadModels();
  const model = models.find((item) => item.isDefault) ?? models[0];
  if (!model || model.baseUrl.startsWith("local://")) {
    return `niumadiruan 今日访问数据（${new Date().toLocaleDateString("zh-CN")}）：\n${facts}`;
  }

  const result = await generateText({
    model: createOpenAiCompatibleModel(model),
    system:
      "你是流量分析助理。请用简洁中文总结给定的今日访问数据，保留关键数字，并给出一句有依据的观察。不要编造数据。",
    prompt: facts,
    temperature: 0.2,
  });
  return result.text.trim() || facts;
}

function createOpenAiCompatibleModel(config: ModelConfig) {
  return {
    specificationVersion: "v4" as const,
    provider: config.provider,
    modelId: config.name,
    supportedUrls: {},
    async doGenerate(options: {
      prompt: unknown;
      maxOutputTokens?: number;
      temperature?: number;
      abortSignal?: AbortSignal;
    }) {
      const messages = promptToMessages(options.prompt);
      const response = await resolveFetch()(config.baseUrl, {
        method: "POST",
        headers: { Authorization: `Bearer ${config.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: resolveModelId(config),
          messages,
          stream: false,
          temperature: options.temperature ?? 0.2,
          max_tokens: options.maxOutputTokens ?? 800,
        }),
        signal: options.abortSignal,
      });
      if (!response.ok) throw new Error(`模型请求失败（${response.status}）`);
      const payload = (await response.json()) as {
        choices?: Array<{ message?: { content?: unknown } }>;
      };
      const text = payload.choices?.[0]?.message?.content;
      if (typeof text !== "string") throw new Error("模型未返回文本");
      return {
        content: [{ type: "text" as const, text }],
        finishReason: "stop" as const,
        usage: {
          inputTokens: {
            total: undefined,
            noCache: undefined,
            cacheRead: undefined,
            cacheWrite: undefined,
          },
          outputTokens: { total: undefined, text: undefined, reasoning: undefined },
        },
        warnings: [],
      };
    },
    async doStream() {
      throw new Error("streaming is not used for traffic summaries");
    },
  } as never;
}

function resolveFetch(): typeof fetch {
  return ("__TAURI_INTERNALS__" in window ? tauriFetch : window.fetch.bind(window)) as typeof fetch;
}

function promptToMessages(prompt: unknown) {
  if (!Array.isArray(prompt)) return [];
  return prompt.map((message) => {
    const item = message as {
      role?: unknown;
      content?: unknown;
    };
    const content =
      typeof item.content === "string"
        ? item.content
        : Array.isArray(item.content)
          ? item.content
              .filter(
                (part): part is { type?: unknown; text?: unknown } =>
                  typeof part === "object" && part !== null,
              )
              .filter((part) => part.type === "text")
              .map((part) => (typeof part.text === "string" ? part.text : ""))
              .join("")
          : "";
    return { role: typeof item.role === "string" ? item.role : "user", content };
  });
}

function resolveModelId(model: ModelConfig) {
  if (model.provider !== "深度求索 / DeepSeek") return model.name;
  const legacyNames: Record<string, string> = {
    "DeepSeek-V4 Flash": "deepseek-v4-flash",
    "DeepSeek-V4 Pro": "deepseek-v4-pro",
    "deepseek-chat": "deepseek-v4-flash",
    "deepseek-reasoner": "deepseek-v4-flash",
  };
  return legacyNames[model.name] ?? model.name;
}
