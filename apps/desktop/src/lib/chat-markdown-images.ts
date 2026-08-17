import { assetUrl } from "@/lib/platform";

const IMAGE_EXT = /\.(avif|bmp|gif|jpe?g|png|svg|webp)$/i;

function stripUrlSuffix(value: string) {
  const hash = value.indexOf("#");
  const withoutHash = hash >= 0 ? value.slice(0, hash) : value;
  const query = withoutHash.indexOf("?");
  return query >= 0 ? withoutHash.slice(0, query) : withoutHash;
}

function hasImageExtension(value: string) {
  return IMAGE_EXT.test(stripUrlSuffix(value));
}

function decodePath(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function pathFromFileUrl(value: string) {
  try {
    const url = new URL(value);
    if (url.protocol !== "file:") return null;
    let pathname = decodePath(url.pathname);
    if (/^\/[A-Za-z]:[\\/]/.test(pathname)) pathname = pathname.slice(1);
    return pathname;
  } catch {
    return null;
  }
}

function isUnixFilesystemImagePath(value: string) {
  if (!value.startsWith("/") || !hasImageExtension(value)) return false;
  return (
    value.startsWith("/Users/") ||
    value.startsWith("/home/") ||
    value.startsWith("/var/") ||
    value.startsWith("/private/") ||
    value.startsWith("/tmp/") ||
    value.startsWith("/opt/") ||
    value.includes("/.chatdesk/")
  );
}

function isWindowsFilesystemImagePath(value: string) {
  return (/^[A-Za-z]:[\\/]/.test(value) || value.startsWith("\\\\")) && hasImageExtension(value);
}

export function localFilesystemPathFromImageSrc(src: string): string | null {
  const value = src.trim();
  if (!value) return null;
  if (/^(https?:|data:|blob:|asset:|ipc:)/i.test(value)) return null;

  if (/^file:/i.test(value)) {
    return pathFromFileUrl(value);
  }

  if (isWindowsFilesystemImagePath(value) || isUnixFilesystemImagePath(value)) {
    return decodePath(stripUrlSuffix(value));
  }

  return null;
}

export function isLocalFilesystemImageSrc(src: string) {
  return localFilesystemPathFromImageSrc(src) !== null;
}

export function resolveMarkdownImageSrc(src: string) {
  const path = localFilesystemPathFromImageSrc(src);
  if (!path) return src.trim();
  return assetUrl(path);
}
