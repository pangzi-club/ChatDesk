import { mkdir } from "node:fs/promises";
import path from "node:path";
import { type ToolSet, tool } from "ai";
import { z } from "zod";
import { BrowserRuntime } from "./browser-runtime.ts";
import {
  createScreenshotAttachmentTarget,
  persistScreenshotResult,
  type ScreenshotAttachmentStore,
} from "./browser-screenshot.ts";

const timeoutSchema = z.number().int().min(100).max(60_000).optional();
const browser = new BrowserRuntime();

export type ClientToolOptions = {
  chatSessionId: string;
  store: ScreenshotAttachmentStore;
};

function createBrowserScreenshotTool(options?: ClientToolOptions) {
  return tool({
    description: "截取当前浏览器页面。",
    inputSchema: z.object({
      sessionId: z.string().min(1),
      fullPage: z.boolean().optional(),
    }),
    execute: async ({ sessionId, fullPage }) => {
      if (!options) return browser.request("screenshot", { sessionId, fullPage });
      const target = createScreenshotAttachmentTarget(options.store, options.chatSessionId);
      await mkdir(path.dirname(target.path), { recursive: true });
      const result = await browser.request("screenshot", {
        sessionId,
        fullPage,
        path: target.path,
      });
      return persistScreenshotResult(result, target);
    },
  });
}

const clientTools: ToolSet = {
  list_dir: tool({
    description: "列出当前 workspace 内的文件与子目录。",
    inputSchema: z.object({
      path: z.string().optional(),
      offset: z.number().int().min(0).optional(),
      limit: z.number().int().min(1).max(500).optional(),
    }),
  }),
  search_files: tool({
    description:
      "按 glob 文件名模式或文本关键词搜索当前 workspace；pattern 支持 **/*.ts，query 不区分大小写并返回首个命中行，Git workspace 遵循 .gitignore。",
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
    description: "读取当前 workspace 内的文本文件。",
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
    description: "创建或完整覆盖当前 workspace 内的文本文件。",
    inputSchema: z.object({
      path: z.string().min(1).optional(),
      file_path: z.string().min(1).optional(),
      content: z.string().optional(),
      file_text: z.string().optional(),
    }),
  }),
  edit_file: tool({
    description: "在当前 workspace 内使用唯一匹配的文本替换文件内容。",
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
      "在 workspace 中执行 Bash 命令。优先使用 search_files 搜索源码；若当前没有该工具，可使用 rg 并遵循 .gitignore，避免扫描 node_modules、.git、dist 或 target。Bash 也适合运行测试、构建、Git 状态等命令。",
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
  browser_open: tool({
    description: "在隔离的 Headless Chromium session 中打开 HTTP(S) 页面。",
    inputSchema: z.object({
      url: z.string().url(),
      sessionId: z.string().min(1).optional(),
      timeoutMs: timeoutSchema,
    }),
    execute: ({ url, sessionId, timeoutMs }) =>
      browser.request("open", { url, sessionId, timeoutMs }),
  }),
  browser_screenshot: createBrowserScreenshotTool(),
  browser_click: tool({
    description: "按 CSS selector 点击当前浏览器页面元素。",
    inputSchema: z.object({
      sessionId: z.string().min(1),
      selector: z.string().min(1).max(2_000),
      button: z.enum(["left", "middle", "right"]).optional(),
      clickCount: z.number().int().min(1).max(3).optional(),
      timeoutMs: timeoutSchema,
    }),
    execute: ({ sessionId, selector, button, clickCount, timeoutMs }) =>
      browser.request("click", { sessionId, selector, button, clickCount, timeoutMs }),
  }),
  browser_eval: tool({
    description: "在当前浏览器页面执行 JavaScript。",
    inputSchema: z.object({
      sessionId: z.string().min(1),
      expression: z.string().min(1).max(20_000),
      timeoutMs: timeoutSchema,
    }),
    execute: ({ sessionId, expression, timeoutMs }) =>
      browser.request("eval", { sessionId, expression, timeoutMs }),
  }),
  browser_close: tool({
    description: "关闭一个浏览器 session。",
    inputSchema: z.object({ sessionId: z.string().min(1) }),
    execute: ({ sessionId }) => browser.request("close", { sessionId }),
  }),
};

const CLIENT_TOOL_NAMES = new Set(Object.keys(clientTools));

export function createClientTools(
  toolNames: string[] | undefined,
  options?: ClientToolOptions,
): ToolSet | undefined {
  const selected = (toolNames ?? []).filter((name) => CLIENT_TOOL_NAMES.has(name));
  if (selected.length === 0) return undefined;
  return Object.fromEntries(
    selected.map((name) => [
      name,
      name === "browser_screenshot" && options
        ? createBrowserScreenshotTool(options)
        : clientTools[name],
    ]),
  );
}

export function closeClientTools() {
  browser.close();
}
