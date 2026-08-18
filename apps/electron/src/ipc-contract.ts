import { isAbsolute, normalize, resolve, sep } from "node:path";

export const IPC_CHANNEL = "chatdesk:invoke";
export const IPC_EVENT_PREFIX = "chatdesk:event:";

const USER_STORE_FILES = new Set(["settings.json", "bookmarks.json"]);

export function validateUserStoreFile(fileName: unknown): "settings.json" | "bookmarks.json" {
  if (typeof fileName !== "string" || !USER_STORE_FILES.has(fileName)) {
    throw new Error("不允许访问该用户数据文件");
  }
  return fileName as "settings.json" | "bookmarks.json";
}

export function validateExternalUrl(value: unknown): string {
  if (typeof value !== "string") throw new Error("外链必须是字符串");
  const url = new URL(value);
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("只允许打开 HTTP(S) 外链");
  }
  return url.toString();
}

export function validateAssetPath(assetPath: unknown, allowedRoots: readonly string[]): string {
  if (typeof assetPath !== "string" || !isAbsolute(assetPath)) {
    throw new Error("资源路径必须是绝对路径");
  }
  const candidate = normalize(resolve(assetPath));
  const insideRoot = allowedRoots.some((root) => {
    const normalizedRoot = normalize(resolve(root));
    return candidate === normalizedRoot || candidate.startsWith(`${normalizedRoot}${sep}`);
  });
  if (!insideRoot) throw new Error("资源路径不在允许范围内");
  return candidate;
}
