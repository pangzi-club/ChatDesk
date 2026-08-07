import { invoke } from "@tauri-apps/api/core";
import { type ToolSet, tool } from "ai";
import { z } from "zod";

const timeoutSchema = z.number().int().min(100).max(60_000).optional();

type BrowserResult<T> =
  | { ok: true; sessionId: string; data: T }
  | { ok: false; code: string; message: string };

async function call<T>(command: string, args: Record<string, unknown>) {
  try {
    return await invoke<BrowserResult<T>>(command, args);
  } catch (error) {
    return {
      ok: false,
      code: "bridge_error",
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

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
      description:
        "在隔离的 Headless Chromium session 中打开 HTTP(S) 页面并返回页面信息。不会继承用户现有登录态。",
      inputSchema: z.object({
        url: z.string().url().describe("要打开的 HTTP(S) URL"),
        sessionId: z
          .string()
          .min(1)
          .optional()
          .describe("已有浏览器 session ID；省略则创建新 session"),
        timeoutMs: timeoutSchema.describe("导航超时时间，默认 15000ms"),
      }),
      execute: async ({ url, sessionId, timeoutMs }) =>
        call("browser_open", { url, sessionId: sessionId ?? null, timeoutMs: timeoutMs ?? 15_000 }),
    }),
    browser_screenshot: tool({
      description: "截取当前浏览器页面并返回临时文件路径。",
      inputSchema: z.object({
        sessionId: z.string().min(1),
        fullPage: z.boolean().optional().describe("是否截取完整页面"),
      }),
      execute: async ({ sessionId, fullPage }) =>
        call("browser_screenshot", { sessionId, fullPage: fullPage ?? false }),
    }),
    browser_click: tool({
      description:
        "按 CSS selector 点击当前页面元素。selector 必须由页面结构推断，不支持任意坐标点击。",
      inputSchema: z.object({
        sessionId: z.string().min(1),
        selector: z.string().min(1).max(2_000),
        button: z.enum(["left", "middle", "right"]).optional(),
        clickCount: z.number().int().min(1).max(3).optional(),
        timeoutMs: timeoutSchema,
      }),
      execute: async ({ sessionId, selector, button, clickCount, timeoutMs }) =>
        call("browser_click", {
          sessionId,
          selector,
          button: button ?? "left",
          clickCount: clickCount ?? 1,
          timeoutMs: timeoutMs ?? 15_000,
        }),
    }),
    browser_eval: tool({
      description:
        "在当前页面执行 JavaScript。只能访问页面上下文，不能访问 Node、文件系统或应用 API；不要返回 cookie、storage 或 Authorization 数据。",
      inputSchema: z.object({
        sessionId: z.string().min(1),
        expression: z.string().min(1).max(20_000),
        timeoutMs: timeoutSchema,
      }),
      execute: async ({ sessionId, expression, timeoutMs }) =>
        call("browser_eval", { sessionId, expression, timeoutMs: timeoutMs ?? 15_000 }),
    }),
    browser_close: tool({
      description: "关闭并销毁一个隔离浏览器 session；重复关闭是安全的。",
      inputSchema: z.object({ sessionId: z.string().min(1) }),
      execute: async ({ sessionId }) => call("browser_close", { sessionId }),
    }),
  };
}
