import { existsSync, statSync } from "node:fs";
import { extname, join, normalize, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

export const RENDERER_SCHEME = "chatdesk";
export const RENDERER_ORIGIN = `${RENDERER_SCHEME}://localhost`;

export function rendererLoadUrl() {
  return `${RENDERER_ORIGIN}/`;
}

export function isChatServerProxyPath(pathname: string) {
  return pathname === "/health" || pathname === "/v1" || pathname.startsWith("/v1/");
}

export function chatServerProxyUrl(requestUrl: string, port: number) {
  const url = new URL(requestUrl);
  if (
    url.protocol !== `${RENDERER_SCHEME}:` ||
    url.hostname !== "localhost" ||
    !isChatServerProxyPath(url.pathname)
  ) {
    throw new Error("不是 Chat Server 代理请求");
  }
  return `http://127.0.0.1:${port}${url.pathname}${url.search}`;
}

export function isRendererNavigation(url: string, entry: string) {
  try {
    const target = new URL(entry);
    const candidate = new URL(url);
    return candidate.protocol === target.protocol && candidate.host === target.host;
  } catch {
    return url === entry;
  }
}

export function resolveRendererFile(rendererRoot: string, requestUrl: string) {
  const url = new URL(requestUrl);
  if (url.protocol !== `${RENDERER_SCHEME}:` || url.hostname !== "localhost") {
    throw new Error("不是 renderer 协议请求");
  }
  let pathname = decodeURIComponent(url.pathname);
  if (!pathname || pathname === "/") pathname = "/index.html";
  const relative = pathname.replace(/^\/+/, "");
  const root = normalize(resolve(rendererRoot));
  const candidate = normalize(resolve(root, relative));
  if (candidate !== root && !candidate.startsWith(`${root}${sep}`)) {
    throw new Error("renderer 路径超出允许范围");
  }
  if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  if (extname(pathname)) throw new Error("renderer 资源不存在");
  return join(root, "index.html");
}

export function rendererFileUrl(filePath: string) {
  return pathToFileURL(filePath).toString();
}
