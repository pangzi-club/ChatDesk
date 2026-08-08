import { type ToolSet, tool } from "ai";
import { z } from "zod";

export const CHAT_BROWSER_TOOL_DISPLAY_NAMES: Record<string, string> = {
  browser_open: "Browser · 打开页面",
  browser_screenshot: "Browser · 截图",
  browser_click: "Browser · 点击",
  browser_eval: "Browser · 页面脚本",
  browser_close: "Browser · 关闭会话",
};

export function createChatBrowserTools(): ToolSet {
  return {
    browser_open: tool({
      description: "在隔离的 Headless Chromium session 中打开 HTTP(S) 页面。",
      inputSchema: z.object({
        url: z.string().url(),
        sessionId: z.string().min(1).optional(),
        timeoutMs: z.number().int().min(100).max(60_000).optional(),
      }),
    }),
    browser_screenshot: tool({
      description: "截取当前浏览器页面。",
      inputSchema: z.object({ sessionId: z.string().min(1), fullPage: z.boolean().optional() }),
    }),
    browser_click: tool({
      description: "按 CSS selector 点击当前浏览器页面元素。",
      inputSchema: z.object({
        sessionId: z.string().min(1),
        selector: z.string().min(1).max(2_000),
        button: z.enum(["left", "middle", "right"]).optional(),
        clickCount: z.number().int().min(1).max(3).optional(),
        timeoutMs: z.number().int().min(100).max(60_000).optional(),
      }),
    }),
    browser_eval: tool({
      description: "在当前浏览器页面执行 JavaScript。",
      inputSchema: z.object({
        sessionId: z.string().min(1),
        expression: z.string().min(1).max(20_000),
        timeoutMs: z.number().int().min(100).max(60_000).optional(),
      }),
    }),
    browser_close: tool({
      description: "关闭一个浏览器 session。",
      inputSchema: z.object({ sessionId: z.string().min(1) }),
    }),
  };
}
