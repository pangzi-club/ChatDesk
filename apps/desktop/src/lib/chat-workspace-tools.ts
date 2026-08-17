import { type ToolSet, tool } from "ai";
import { z } from "zod";

export type ChatWorkspaceToolContext = { getCwd: () => string };

export const CHAT_WORKSPACE_TOOL_DISPLAY_NAMES: Record<string, string> = {
  list_dir: "列出目录",
  search_files: "搜索文件",
  read_file: "读取文件",
  write_file: "写入文件",
  edit_file: "编辑文件",
  git: "Git",
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
    | "git"
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
        "按 glob 文件名模式或文本关键词搜索文件；pattern 支持 **/*.ts，query 不区分大小写并返回首个命中行，Git workspace 遵循 .gitignore。",
      inputSchema: z.object({
        path: z.string().optional(),
        pattern: z.string().optional().describe("文件 glob，例如 **/*.ts 或 package*.json"),
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
    git: tool({
      description:
        "执行受控的本地 Git 操作：查看 status、创建当前 workspace 内的新分支或提交当前 workspace 的改动。不执行 push、pull 或其他远端操作。",
      inputSchema: z.object({
        action: z.enum(["status", "create_branch", "commit"]),
        branch: z.string().optional(),
        message: z.string().optional(),
      }),
    }),
    bash: tool({
      description:
        "在 workspace 中执行 Bash 命令。优先使用 search_files 搜索源码；若当前没有该工具，可使用 rg 并遵循 .gitignore，避免扫描 node_modules、.git、dist 或 target。Bash 也适合运行测试、构建、Git 状态等命令。",
      inputSchema: z.object({ command: z.string().min(1) }),
    }),
  };
  if (pack === "all") return tools;
  const names = pack === "terminal" ? ["bash"] : [pack];
  return Object.fromEntries(names.map((name) => [name, tools[name]]));
}
