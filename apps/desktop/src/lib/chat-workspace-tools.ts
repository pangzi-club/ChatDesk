import { type ToolSet, tool } from "ai";
import { z } from "zod";

export type ChatWorkspaceToolContext = { getCwd: () => string };

export const CHAT_WORKSPACE_TOOL_DISPLAY_NAMES: Record<string, string> = {
  list_dir: "列出目录",
  search_files: "搜索文件",
  read_file: "读取文件",
  write_file: "写入文件",
  edit_file: "编辑文件",
  apply_patch: "应用补丁",
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
    | "apply_patch"
    | "terminal"
    | "all" = "all",
): ToolSet {
  const tools: ToolSet = {
    list_dir: tool({
      description: "列出 workspace 内的文件与子目录。",
      inputSchema: z.object({
        path: z.string().optional(),
        offset: z.number().int().min(0).optional(),
        limit: z.number().int().min(1).max(500).optional(),
      }),
    }),
    search_files: tool({
      description:
        "按文件 glob 或内容关键词/正则搜索文件；pattern 对应 glob，query 对应 grep 内容模式，include 可限制文件类型，regex=true 时 query 使用 ripgrep 正则。",
      inputSchema: z.object({
        path: z.string().optional(),
        pattern: z.string().optional().describe("文件 glob，例如 **/*.ts 或 package*.json"),
        query: z.string().optional().describe("要查找的不区分大小写文本关键词"),
        include: z.string().optional().describe("内容搜索的文件 glob，例如 *.ts"),
        regex: z.boolean().optional().describe("将 query 作为 ripgrep 正则表达式"),
        maxResults: z.number().int().min(1).max(500).optional(),
      }),
    }),
    read_file: tool({
      description: "读取 workspace 内的 UTF-8 文本文件，支持 path/file_path、行范围和 view_range。",
      inputSchema: z.object({
        path: z.string().min(1).optional(),
        file_path: z.string().min(1).optional(),
        startLine: z.number().int().positive().optional(),
        endLine: z.number().int().positive().optional(),
        offset: z.number().int().positive().optional(),
        limit: z.number().int().positive().optional(),
        view_range: z.array(z.number().int()).length(2).optional(),
      }),
    }),
    write_file: tool({
      description:
        "创建或覆盖 workspace 内的 UTF-8 文本文件，支持 path/file_path 和 content/file_text。",
      inputSchema: z.object({
        path: z.string().min(1).optional(),
        file_path: z.string().min(1).optional(),
        content: z.string().optional(),
        file_text: z.string().optional(),
      }),
    }),
    edit_file: tool({
      description:
        "对 workspace 文件做精确替换或按行插入，支持 DeepSeek 风格字段；默认要求唯一匹配。",
      inputSchema: z.object({
        path: z.string().min(1).optional(),
        file_path: z.string().min(1).optional(),
        oldText: z.string().min(1).optional(),
        newText: z.string().optional(),
        old_string: z.string().min(1).optional(),
        new_string: z.string().optional(),
        new_str: z.string().optional(),
        replace_all: z.boolean().optional(),
        insert_line: z.number().int().min(0).optional(),
      }),
    }),
    apply_patch: tool({
      description: "使用 unified diff 原子修改一个或多个 workspace 文件。",
      inputSchema: z.object({
        patch: z
          .string()
          .min(1)
          .max(256 * 1024),
      }),
    }),
    bash: tool({
      description:
        "在 workspace 中执行 Bash 命令。每次调用检查退出码；长任务使用 run_in_background，工作目录使用 workdir/cwd。优先使用 search_files 搜索源码。",
      inputSchema: z.object({
        command: z.string().min(1),
        description: z.string().min(1).optional(),
        timeoutMs: z.number().int().min(0).max(120_000).optional(),
        workdir: z.string().optional(),
        cwd: z.string().optional(),
        run_in_background: z.boolean().optional(),
        block_until: z.number().int().min(0).max(120_000).optional(),
      }),
    }),
  };
  if (pack === "all") return tools;
  const names =
    pack === "terminal" ? ["bash"] : pack === "edit_file" ? ["edit_file", "apply_patch"] : [pack];
  return Object.fromEntries(names.map((name) => [name, tools[name]]));
}
