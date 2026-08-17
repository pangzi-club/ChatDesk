import { openai } from "@ai-sdk/openai";
import { type ToolSet, tool } from "ai";
import { z } from "zod";
import { CHAT_BROWSER_TOOL_DISPLAY_NAMES, createChatBrowserTools } from "@/lib/browser-tools";
import {
  CHAT_TOOL_PACKS,
  type ChatToolPackId,
  type ChatToolsSettings,
  getPackMeta,
} from "@/lib/chat-tools";
import {
  CHAT_WORKSPACE_TOOL_DISPLAY_NAMES,
  createChatWorkspaceTools,
} from "@/lib/chat-workspace-tools";
import {
  generateImage,
  IMAGE_ASPECT_RATIOS,
  IMAGE_RESOLUTIONS,
  type ImageAspectRatio,
  type ImageResolution,
  loadKieApiKey,
} from "@/lib/image-generation";
import type { ModelConfig } from "@/lib/models";

const ASPECT_RATIO_SCHEMA = z.enum(IMAGE_ASPECT_RATIOS);
const RESOLUTION_SCHEMA = z.enum(IMAGE_RESOLUTIONS);

const PACK_API_KEY_LOADERS: Partial<Record<ChatToolPackId, () => Promise<string>>> = {
  image_generation: loadKieApiKey,
};

export const CHAT_TOOL_DISPLAY_NAMES: Record<string, string> = {
  ...CHAT_WORKSPACE_TOOL_DISPLAY_NAMES,
  ...CHAT_BROWSER_TOOL_DISPLAY_NAMES,
  web_search: "Web Search · 联网搜索",
  image_generation: "Image Generation · 图片生成",
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

async function loadPackApiKey(pack: ChatToolPackId): Promise<string> {
  const loader = PACK_API_KEY_LOADERS[pack];
  return loader ? (await loader()).trim() : "";
}

function createPackTools(pack: ChatToolPackId): ToolSet {
  if (pack === "image_generation") return createImageGenerationTools();
  if (pack === "browser") return createChatBrowserTools();
  return {};
}

function createWebSearchTools(): ToolSet {
  // Provider-executed tools are accepted by streamText, but ToolSet's
  // intersection with Pick<..., 'execute' | ...> is too strict for them.
  return {
    web_search: openai.tools.webSearch({}) as unknown as ToolSet[string],
  };
}

function createImageGenerationTools(): ToolSet {
  return {
    image_generation: tool({
      description:
        "根据文字描述生成图片。会创建 KIE 生图任务并等待完成后返回图片 URL；适合插画、海报、场景图等。",
      inputSchema: z.object({
        prompt: z.string().min(1).describe("图片描述，尽量具体"),
        aspect_ratio: ASPECT_RATIO_SCHEMA.optional().describe("宽高比，默认 auto"),
        resolution: RESOLUTION_SCHEMA.optional().describe("分辨率，默认 1K"),
      }),
      execute: async ({ prompt, aspect_ratio, resolution }, { abortSignal }) =>
        withToolError(async () => {
          const result = await generateImage(
            {
              model: "gpt-image-2-text-to-image",
              prompt,
              aspect_ratio: (aspect_ratio ?? "auto") as ImageAspectRatio,
              resolution: (resolution ?? "1K") as ImageResolution,
            },
            { abortSignal },
          );
          return {
            taskId: result.taskId,
            urls: result.urls,
            url: result.urls[0],
          };
        }),
    }),
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

async function isPackAvailable(
  pack: (typeof CHAT_TOOL_PACKS)[number],
  model: Pick<ModelConfig, "supportsTools" | "responsive"> | undefined,
  getCwd?: () => string,
) {
  if (!model?.supportsTools) return false;
  if (pack.requiresWorkspace && !getCwd?.().trim()) return false;
  const apiKey = pack.keyLabel ? await loadPackApiKey(pack.id) : "";
  return canActivatePack(pack, model, apiKey);
}

/** 按启用 ∩ API Key / Responses ∩ 模型能力，动态组装当前可用 tools。 */
export async function resolveActiveTools(
  enabled: ChatToolsSettings,
  model: ModelConfig | undefined,
  getCwd?: () => string,
): Promise<ResolveActiveToolsResult> {
  if (!model?.supportsTools) {
    return { tools: {}, activePacks: [], toolNames: [] };
  }

  const tools: ToolSet = {};
  const activePacks: ChatToolPackId[] = [];

  for (const pack of CHAT_TOOL_PACKS) {
    if (!enabled[pack.id]) continue;
    if (!(await isPackAvailable(pack, model, getCwd))) continue;
    if (
      pack.id === "list_dir" ||
      pack.id === "search_files" ||
      pack.id === "read_file" ||
      pack.id === "write_file" ||
      pack.id === "edit_file" ||
      pack.id === "git" ||
      pack.id === "terminal"
    ) {
      if (!getCwd) continue;
      Object.assign(tools, createChatWorkspaceTools({ getCwd }, pack.id));
    } else if (pack.id === "web_search") {
      Object.assign(tools, createWebSearchTools());
    } else {
      Object.assign(tools, createPackTools(pack.id));
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
  getCwd?: () => string,
): Promise<ChatToolPackId[]> {
  if (!model?.supportsTools) return [];
  const available: ChatToolPackId[] = [];
  for (const pack of CHAT_TOOL_PACKS) {
    if (!enabled[pack.id]) continue;
    if (await isPackAvailable(pack, model, getCwd)) available.push(pack.id);
  }
  return available;
}

export function formatToolsSystemHint(activePacks: ChatToolPackId[]): string {
  if (activePacks.length === 0) return "";

  const lines = [
    "你可以使用下列工具获取信息。需要事实或实时数据时主动调用工具，不要编造。",
    "用中文简洁总结工具结果；需要多步时先列表再取详情；联网搜索请注明来源要点；图片生成需等待任务完成，完成后简要说明画面。",
    "当前可用工具包：",
  ];

  for (const packId of activePacks) {
    const pack = getPackMeta(packId);
    lines.push(`- ${pack.label}：${pack.description} 示例：「${pack.examples[0]}」`);
  }

  return lines.join("\n");
}
