import { invoke } from "@tauri-apps/api/core";
import { type ToolSet, tool } from "ai";
import { z } from "zod";

export type ChatWorkspaceToolContext = {
  getCwd: () => string;
};

type ShellResult = { code: number; out: string };

const MAX_OUTPUT_LENGTH = 50_000;

function withWorkspace(context: ChatWorkspaceToolContext) {
  return context.getCwd().trim() || null;
}

function withFileRequest(context: ChatWorkspaceToolContext, path?: string) {
  const cwd = context.getCwd().trim();
  const value = path?.trim() ?? "";
  if (cwd) return { cwd, path: value };
  if (!value.startsWith("/")) {
    throw new Error("未选择 workspace 时，文件工具必须使用绝对路径");
  }
  return { cwd: "/", path: value };
}

function limitOutput(out: string) {
  if (out.length <= MAX_OUTPUT_LENGTH) return { out, truncated: false };
  return {
    out: `${out.slice(0, MAX_OUTPUT_LENGTH)}\n…输出已截断（最多 ${MAX_OUTPUT_LENGTH} 个字符）`,
    truncated: true,
  };
}

async function safe<T>(run: () => Promise<T>) {
  try {
    return await run();
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

export const CHAT_WORKSPACE_TOOL_DISPLAY_NAMES: Record<string, string> = {
  list_dir: "本地开发 · 列出目录",
  search_files: "本地开发 · 搜索文件",
  read_file: "本地开发 · 读取文件",
  write_file: "本地开发 · 写入文件",
  edit_file: "本地开发 · 编辑文件",
  bash: "终端 · Bash",
};

export function createChatWorkspaceTools(
  context: ChatWorkspaceToolContext,
  pack:
    | "list_dir"
    | "search_files"
    | "read_file"
    | "write_file"
    | "edit_file"
    | "terminal"
    | "all" = "all",
): ToolSet {
  const tools: ToolSet = {
    list_dir: tool({
      description: "列出 workspace 内的文件与子目录；未选择 workspace 时请传绝对路径。",
      inputSchema: z.object({ path: z.string().optional().describe("相对目录路径，默认为根目录") }),
      execute: async ({ path }) =>
        safe(async () => {
          const request = withFileRequest(context, path || "/");
          return invoke("workspace_list_dir", {
            cwd: request.cwd,
            path: request.path,
          });
        }),
    }),
    search_files: tool({
      description: "按文件名模式和文本内容搜索文件；未选择 workspace 时请传绝对目录路径。",
      inputSchema: z.object({
        path: z.string().optional().describe("搜索起始目录，默认为根目录"),
        pattern: z.string().optional().describe("文件名模式，例如 *.ts"),
        query: z.string().optional().describe("要在文本文件中查找的内容"),
        maxResults: z.number().int().min(1).max(500).optional(),
      }),
      execute: async ({ path, pattern, query, maxResults }) =>
        safe(async () => {
          const request = withFileRequest(context, path);
          return invoke("workspace_search_files", {
            cwd: request.cwd,
            path: request.path,
            pattern: pattern?.trim() || null,
            query: query?.trim() || null,
            maxResults: maxResults ?? 100,
          });
        }),
    }),
    read_file: tool({
      description: "读取文本文件内容；未选择 workspace 时请传绝对文件路径。",
      inputSchema: z.object({ path: z.string().min(1).describe("相对文件路径") }),
      execute: async ({ path }) =>
        safe(async () => {
          const request = withFileRequest(context, path);
          return invoke("workspace_read_file", request);
        }),
    }),
    write_file: tool({
      description: "创建或完整覆盖文本文件；未选择 workspace 时请传绝对文件路径。",
      inputSchema: z.object({
        path: z.string().min(1).describe("相对文件路径"),
        content: z.string().describe("完整文件内容"),
      }),
      execute: async ({ path, content }) =>
        safe(async () => {
          const request = withFileRequest(context, path);
          return invoke("workspace_write_file", { ...request, content });
        }),
    }),
    edit_file: tool({
      description: "使用唯一匹配的 oldText 替换为 newText；未选择 workspace 时请传绝对路径。",
      inputSchema: z.object({
        path: z.string().min(1).describe("相对文件路径"),
        oldText: z.string().min(1).describe("要替换的原文，必须只匹配一次"),
        newText: z.string().describe("替换后的文本"),
      }),
      execute: async ({ path, oldText, newText }) =>
        safe(async () => {
          const request = withFileRequest(context, path);
          return invoke("workspace_edit_file", { ...request, oldText, newText });
        }),
    }),
    bash: tool({
      description:
        "在 workspace 中执行 Bash 命令；未选择时使用默认执行目录。完全访问模式下命令可能影响外部环境。",
      inputSchema: z.object({ command: z.string().min(1).describe("要执行的 Shell 命令") }),
      execute: async ({ command }) =>
        safe(async () => {
          const result = await invoke<ShellResult>("run_shell_command", {
            command,
            cwd: withWorkspace(context),
            mode: "full",
            permissions: { network: true },
            timeoutSeconds: 120,
          });
          return { code: result.code, ...limitOutput(result.out) };
        }),
    }),
  };
  if (pack === "all") return tools;
  const names = pack === "terminal" ? ["bash"] : [pack];
  return Object.fromEntries(names.map((name) => [name, tools[name]]));
}
