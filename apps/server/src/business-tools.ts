import {
  generateImageWithApiKey,
  IMAGE_ASPECT_RATIOS,
  IMAGE_RESOLUTIONS,
  type ImageAspectRatio,
  type ImageResolution,
} from "@chatdesk/shared";
import { type ToolSet, tool } from "ai";
import { z } from "zod";
import { createConversationTools } from "./conversation-tools.ts";
import type { SessionStore } from "./store.ts";

const ASPECT_RATIO_SCHEMA = z.enum(IMAGE_ASPECT_RATIOS);
const RESOLUTION_SCHEMA = z.enum(IMAGE_RESOLUTIONS);

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

export function createBusinessTools(
  apiKeys: Record<string, string>,
  sessions?: SessionStore,
): ToolSet {
  const kieKey = apiKeys.kie ?? "";
  return {
    ...(sessions ? createConversationTools(sessions) : {}),
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
          const result = await generateImageWithApiKey(
            kieKey,
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
