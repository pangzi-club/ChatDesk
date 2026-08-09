import { type ToolSet, tool } from "ai";
import { z } from "zod";

export type ChatWorkspaceToolContext = { getCwd: () => string };

export const CHAT_WORKSPACE_TOOL_DISPLAY_NAMES: Record<string, string> = {
  list_dir: "本地开发 · 列出目录",
  search_files: "本地开发 · 搜索文件",
  read_file: "本地开发 · 读取文件",
  write_file: "本地开发 · 写入文件",
  edit_file: "本地开发 · 编辑文件",
  bash: "终端 · Bash",
};

export function createChatWorkspaceTools(
  _context: ChatWorkspaceToolContext,
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
      description: "列出 workspace 内的文件与子目录。",
      inputSchema: z.object({ path: z.string().optional() }),
    }),
    search_files: tool({
      description:
        "按文件名模式或文本关键词搜索文件；query 支持不区分大小写的关键词匹配，Git workspace 遵循 .gitignore。",
      inputSchema: z.object({
        path: z.string().optional(),
        pattern: z.string().optional(),
        query: z.string().optional().describe("要查找的不区分大小写文本关键词"),
        maxResults: z.number().int().min(1).max(500).optional(),
      }),
    }),
    read_file: tool({
      description: "读取 workspace 内的文本文件。",
      inputSchema: z.object({ path: z.string().min(1) }),
    }),
    write_file: tool({
      description: "创建或覆盖 workspace 内的文本文件。",
      inputSchema: z.object({ path: z.string().min(1), content: z.string() }),
    }),
    edit_file: tool({
      description: "将 workspace 文件中唯一匹配的文本替换为新内容。",
      inputSchema: z.object({
        path: z.string().min(1),
        oldText: z.string().min(1),
        newText: z.string(),
      }),
    }),
    bash: tool({
      description:
        "在 workspace 中执行 Bash 命令。源码或文件名搜索必须使用 search_files；不要用 grep/find/rg 递归扫描 workspace，尤其不要扫描 node_modules、.git、dist 或 target。Bash 适合运行测试、构建、Git 状态等命令。",
      inputSchema: z.object({ command: z.string().min(1) }),
    }),
  };
  if (pack === "all") return tools;
  const names = pack === "terminal" ? ["bash"] : [pack];
  return Object.fromEntries(names.map((name) => [name, tools[name]]));
}
