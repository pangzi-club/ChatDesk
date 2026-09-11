import { isAbsolute, normalize, resolve, sep } from "node:path";

export const IPC_CHANNEL = "chatdesk:invoke";
export const IPC_EVENT_PREFIX = "chatdesk:event:";

const USER_STORE_FILES = new Set(["settings.json", "bookmarks.json"]);
const COMPUTER_USE_PERMISSION_TARGETS = new Set(["accessibility", "screenRecording"]);

export function validateUserStoreFile(fileName: unknown): "settings.json" | "bookmarks.json" {
  if (typeof fileName !== "string" || !USER_STORE_FILES.has(fileName)) {
    throw new Error("不允许访问该用户数据文件");
  }
  return fileName as "settings.json" | "bookmarks.json";
}

export function validateComputerUsePermissionTarget(
  value: unknown,
): "accessibility" | "screenRecording" | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string" || !COMPUTER_USE_PERMISSION_TARGETS.has(value)) {
    throw new Error("权限设置目标无效");
  }
  return value as "accessibility" | "screenRecording";
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

const MAX_PLUGIN_DIRECTORIES = 32;
const MAX_PLUGIN_DIRECTORY_LENGTH = 1024;

export function validatePluginDirectory(value: unknown): string {
  if (typeof value !== "string" || !isAbsolute(value)) {
    throw new Error("插件目录必须是绝对路径");
  }
  if (value.length > MAX_PLUGIN_DIRECTORY_LENGTH) throw new Error("插件目录路径过长");
  return normalize(resolve(value));
}

export function validatePluginDirectoryList(value: unknown): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new Error("插件目录列表必须是数组");
  if (value.length > MAX_PLUGIN_DIRECTORIES) throw new Error("插件目录数量超出限制");
  const directories = value.map((item) => validatePluginDirectory(item));
  return [...new Set(directories)];
}
