import { lookup } from "node:dns/promises";
import { type ToolSet, tool } from "ai";
import { z } from "zod";

const MAX_FETCH_OUTPUT = 200_000;
const MAX_REDIRECTS = 5;

function isPrivateIpv4(address: string) {
  const octets = address.split(".").map(Number);
  if (
    octets.length !== 4 ||
    octets.some((value) => !Number.isInteger(value) || value < 0 || value > 255)
  ) {
    return false;
  }
  const [first, second] = octets;
  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168)
  );
}

function isPrivateIpv6(address: string) {
  const normalized = address.toLowerCase();
  return (
    normalized === "::1" ||
    normalized === "::" ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    normalized.startsWith("fe8") ||
    normalized.startsWith("fe9") ||
    normalized.startsWith("fea") ||
    normalized.startsWith("feb")
  );
}

async function validateFetchTarget(url: URL) {
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("web_fetch 只支持 HTTP(S) URL");
  }
  const hostname = url.hostname.toLowerCase();
  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    isPrivateIpv4(hostname) ||
    isPrivateIpv6(hostname)
  ) {
    throw new Error("web_fetch 不允许访问本机或内网地址");
  }
  const addresses = await lookup(hostname, { all: true, verbatim: true });
  if (addresses.some(({ address }) => isPrivateIpv4(address) || isPrivateIpv6(address))) {
    throw new Error("web_fetch 不允许访问解析到本机或内网的地址");
  }
}

function decodeHtmlEntities(value: string) {
  return value
    .replaceAll("&nbsp;", " ")
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([\da-f]+);/gi, (_, code: string) =>
      String.fromCodePoint(Number.parseInt(code, 16)),
    );
}

function extractHtmlText(value: string) {
  return decodeHtmlEntities(
    value
      .replace(/<\s*(script|style|noscript|template)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, " ")
      .replace(/<\s*br\s*\/?>/gi, "\n")
      .replace(/<\s*\/\s*(p|div|section|article|li|h[1-6]|tr)\s*>/gi, "\n")
      .replace(/<[^>]*>/g, " "),
  )
    .replace(/[ \t]+/g, " ")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function fetchText(
  url: URL,
  signal: AbortSignal,
  redirectCount = 0,
): Promise<{ url: string; content: string; truncated: boolean }> {
  if (redirectCount > MAX_REDIRECTS) throw new Error("web_fetch 重定向次数过多");
  await validateFetchTarget(url);
  const response = await fetch(url, {
    redirect: "manual",
    headers: { Accept: "text/plain, text/html, application/json" },
    signal,
  });
  if (response.status >= 300 && response.status < 400) {
    const location = response.headers.get("location");
    if (!location) throw new Error(`web_fetch 重定向缺少 Location（HTTP ${response.status}）`);
    return fetchText(new URL(location, url), signal, redirectCount + 1);
  }
  if (!response.ok) throw new Error(`web_fetch 请求失败（HTTP ${response.status}）`);
  const raw = await response.text();
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  const content = contentType.includes("text/html") ? extractHtmlText(raw) : raw;
  return {
    url: url.toString(),
    content: content.slice(0, MAX_FETCH_OUTPUT),
    truncated: content.length > MAX_FETCH_OUTPUT,
  };
}

export function createWebTools(): ToolSet {
  return {
    web_fetch: tool({
      description:
        "获取指定 HTTP(S) URL 的正文文本。自动清理 HTML 标签；读取后在最终回答中将该 URL 作为 Markdown 链接引用。禁止访问 localhost、私网和本机地址。",
      inputSchema: z.object({ url: z.string().url() }),
      execute: async ({ url }, { abortSignal }) => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 30_000);
        const onAbort = () => controller.abort(abortSignal?.reason);
        abortSignal?.addEventListener("abort", onAbort, { once: true });
        try {
          return await fetchText(new URL(url), controller.signal);
        } finally {
          clearTimeout(timer);
          abortSignal?.removeEventListener("abort", onAbort);
        }
      },
    }),
  };
}
