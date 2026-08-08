import readline from "node:readline";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";

const sessions = new Map();
const MAX_OUTPUT = 50_000;
const DEFAULT_TIMEOUT = 15_000;
const tempDir = path.join(os.tmpdir(), "m-dashboard-browser");
await mkdir(tempDir, { recursive: true });

function result(request, payload) {
  process.stdout.write(`${JSON.stringify({ id: request.id, ...payload })}\n`);
}

function fail(request, code, message) { result(request, { ok: false, code, message }); }
function cleanValue(value) {
  const text = JSON.stringify(value ?? null);
  return text.length > MAX_OUTPUT ? { value: `${text.slice(0, MAX_OUTPUT)}...`, truncated: true } : { value, truncated: false };
}
function timeout(value) { return Math.min(Math.max(Number(value) || DEFAULT_TIMEOUT, 100), 60_000); }

async function handle(request) {
  const params = request.params ?? {};
  if (request.method === "open") {
    let url;
    try {
      url = new URL(String(params.url ?? ""));
    } catch {
      return fail(request, "invalid_url", "URL 格式无效");
    }
    if (!/^https?:$/.test(url.protocol)) return fail(request, "invalid_url", "仅支持 HTTP(S) URL");
    const sessionId = params.sessionId || randomUUID();
    let session = sessions.get(sessionId);
    if (!session) {
      if (!globalThis.browser) globalThis.browser = await chromium.launch({ headless: true });
      const context = await globalThis.browser.newContext();
      const page = await context.newPage();
      session = { context, page, createdAt: Date.now() };
      sessions.set(sessionId, session);
    }
    await session.page.goto(url.href, { waitUntil: "domcontentloaded", timeout: timeout(params.timeoutMs) });
    result(request, { ok: true, sessionId, data: { url: session.page.url(), title: await session.page.title() } });
    return;
  }
  const session = sessions.get(String(params.sessionId));
  const sessionId = String(params.sessionId);
  if (!session) {
    if (request.method === "close") {
      return result(request, { ok: true, sessionId, data: { closed: false } });
    }
    return fail(request, "unknown_session", "浏览器 session 不存在或已关闭");
  }
  if (request.method === "screenshot") {
    const filename = path.join(tempDir, `${sessionId}-${Date.now()}.png`);
    await session.page.screenshot({ path: filename, fullPage: params.fullPage === true });
    const viewport = session.page.viewportSize();
    result(request, { ok: true, sessionId, data: { path: filename, mimeType: "image/png", width: viewport?.width ?? null, height: viewport?.height ?? null } });
  } else if (request.method === "click") {
    await session.page.locator(String(params.selector)).click({ button: params.button || "left", clickCount: params.clickCount || 1, timeout: timeout(params.timeoutMs) });
    result(request, { ok: true, sessionId, data: { url: session.page.url(), title: await session.page.title() } });
  } else if (request.method === "eval") {
    const expression = String(params.expression ?? "");
    if (/document\.cookie|localStorage|sessionStorage|authorization/i.test(expression)) {
      return fail(request, "sensitive_output_blocked", "禁止读取或返回页面凭据存储内容");
    }
    const value = await Promise.race([
      session.page.evaluate(expression),
      new Promise((_, reject) => setTimeout(() => reject(new Error("页面脚本执行超时")), timeout(params.timeoutMs))),
    ]);
    result(request, { ok: true, sessionId, data: cleanValue(value) });
  } else if (request.method === "close") {
    await session.context.close();
    sessions.delete(sessionId);
    result(request, { ok: true, sessionId, data: { closed: true } });
  } else {
    fail(request, "unknown_method", `未知浏览器方法：${request.method}`);
  }
}

const rl = readline.createInterface({ input: process.stdin });
rl.on("line", async (line) => {
  let request;
  try { request = JSON.parse(line); await handle(request); }
  catch (error) { fail(request ?? { id: null }, "browser_error", error instanceof Error ? error.message : String(error)); }
});
