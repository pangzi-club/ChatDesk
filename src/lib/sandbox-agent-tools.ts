import { createOpenAI } from "@ai-sdk/openai";
import { invoke } from "@tauri-apps/api/core";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import {
  type ChatTransport,
  convertToModelMessages,
  stepCountIs,
  streamText,
  type ToolSet,
  tool,
  toUIMessageStream,
  type UIMessage,
} from "ai";
import { z } from "zod";

import type { ModelConfig } from "@/lib/models";
import type { SandboxWriteGate } from "@/lib/sandbox-write-gate";

export type SandboxAgentMode = "sandbox" | "full";

export const SANDBOX_TOOL_DISPLAY_NAMES: Record<string, string> = {
  list_dir: "Sandbox · 列出目录",
  read_file: "Sandbox · 读取文件",
  write_file: "Sandbox · 写入文件",
};

export type WorkspaceListDirResult = {
  path: string;
  entries: Array<{ name: string; path: string; kind: string }>;
};

export type WorkspaceReadFileResult = {
  path: string;
  content: string;
};

export type WorkspaceWriteFileResult = {
  path: string;
  bytesWritten: number;
};

type GetCwd = () => string;
type GetMode = () => SandboxAgentMode;

function toolError(message: string) {
  return { error: message };
}

async function withToolError<T>(run: () => Promise<T>): Promise<T | { error: string }> {
  try {
    return await run();
  } catch (error) {
    return toolError(error instanceof Error ? error.message : String(error));
  }
}

export function createSandboxAgentTools(
  getCwd: GetCwd,
  getMode: GetMode,
  writeGate: SandboxWriteGate,
): ToolSet {
  return {
    list_dir: tool({
      description: "列出工作区内某个相对路径下的文件与子目录。path 默认为当前工作区根目录。",
      inputSchema: z.object({
        path: z
          .string()
          .optional()
          .describe("相对工作区的目录路径，例如 src 或 .；默认为工作区根目录"),
      }),
      execute: async ({ path }) =>
        withToolError(async () => {
          const cwd = getCwd().trim();
          if (!cwd) throw new Error("尚未选择工作目录");
          return invoke<WorkspaceListDirResult>("workspace_list_dir", {
            cwd,
            path: path?.trim() ? path.trim() : null,
          });
        }),
    }),
    read_file: tool({
      description: "读取工作区内某个相对路径的文本文件内容。",
      inputSchema: z.object({
        path: z.string().describe("相对工作区的文件路径，例如 README.md 或 src/main.ts"),
      }),
      execute: async ({ path }) =>
        withToolError(async () => {
          const cwd = getCwd().trim();
          if (!cwd) throw new Error("尚未选择工作目录");
          return invoke<WorkspaceReadFileResult>("workspace_read_file", {
            cwd,
            path: path.trim(),
          });
        }),
    }),
    write_file: tool({
      description:
        "在工作区内创建或覆盖写入文本文件。path 为相对路径；会自动创建缺失的父目录。沙箱模式下需要用户批准后才会真正写入。",
      inputSchema: z.object({
        path: z.string().describe("相对工作区的文件路径，例如 notes/hello.txt"),
        content: z.string().describe("要写入的完整文件内容"),
      }),
      execute: async ({ path, content }) =>
        withToolError(async () => {
          const cwd = getCwd().trim();
          if (!cwd) throw new Error("尚未选择工作目录");
          const trimmedPath = path.trim();
          if (getMode() === "sandbox") {
            const approved = await writeGate.waitForApproval(trimmedPath, content);
            if (!approved) {
              return toolError("用户拒绝了此次文件写入");
            }
          }
          return invoke<WorkspaceWriteFileResult>("workspace_write_file", {
            cwd,
            path: trimmedPath,
            content,
          });
        }),
    }),
  };
}

const SYSTEM_PROMPT = `你是 Workspace Sandbox Agent。用户已选定一个本地工作目录。
你只能通过工具在该工作目录内列出目录、读取文件、写入文件。
规则：
- 所有路径必须是相对工作区的相对路径，不要使用绝对路径或试图访问工作区外的文件。
- 修改文件前先用 list_dir / read_file 了解现状；写入时给出完整内容。
- 用简洁中文回复，说明你做了什么。`;

export function createSandboxAgentTransport(options: {
  getModel: () => ModelConfig | undefined;
  getCwd: GetCwd;
  getMode: GetMode;
  writeGate: SandboxWriteGate;
}): ChatTransport<UIMessage> {
  const { getModel, getCwd, getMode, writeGate } = options;

  return {
    async sendMessages({ messages, abortSignal }) {
      const model = getModel();
      if (!model || model.baseUrl.startsWith("local://")) {
        throw new Error("请先在设置中配置一个真实的模型 API。");
      }
      if (!model.supportsTools) {
        throw new Error("当前模型未开启「支持 Tools」，请在模型设置中开启或更换模型。");
      }
      const cwd = getCwd().trim();
      if (!cwd) {
        throw new Error("请先选择工作目录。");
      }

      const tools = createSandboxAgentTools(getCwd, getMode, writeGate);
      const mode = getMode();
      const provider = createOpenAI({
        apiKey: model.apiKey,
        baseURL: resolveOpenAICompatibleBaseURL(model.baseUrl),
        fetch: resolveFetch(),
      });
      const modelMessages = await convertToModelMessages(messages);
      const languageModel = model.responsive
        ? provider.responses(resolveModelId(model))
        : provider.chat(resolveModelId(model));

      const systemPrompt = `${SYSTEM_PROMPT}\n当前工作目录：${cwd}\n访问模式：${mode === "sandbox" ? "沙箱（写入需用户批准）" : "完全访问（写入直接执行）"}`;

      const result = streamText({
        model: languageModel,
        messages: modelMessages,
        tools,
        stopWhen: stepCountIs(8),
        ...(model.responsive ? { instructions: systemPrompt } : { system: systemPrompt }),
        abortSignal,
      });

      return toUIMessageStream({
        stream: result.stream,
        onError: (streamError) => {
          console.error("Sandbox agent stream failed", streamError);
          if (streamError instanceof Error && streamError.message.trim()) {
            return streamError.message;
          }
          return String(streamError);
        },
      });
    },
    async reconnectToStream() {
      return null;
    },
  };
}

function resolveOpenAICompatibleBaseURL(baseUrl: string): string {
  return baseUrl
    .trim()
    .replace(/\/+$/, "")
    .replace(/\/chat\/completions$/i, "")
    .replace(/\/responses$/i, "");
}

function resolveModelId(model: ModelConfig): string {
  if (model.provider !== "深度求索 / DeepSeek") return model.name;
  const legacyNames: Record<string, string> = {
    "DeepSeek-V4 Flash": "deepseek-v4-flash",
    "DeepSeek-V4 Pro": "deepseek-v4-pro",
    "deepseek-chat": "deepseek-v4-flash",
    "deepseek-reasoner": "deepseek-v4-flash",
  };
  return legacyNames[model.name] ?? model.name;
}

function resolveFetch(): typeof fetch {
  return ("__TAURI_INTERNALS__" in window ? tauriFetch : window.fetch.bind(window)) as typeof fetch;
}
