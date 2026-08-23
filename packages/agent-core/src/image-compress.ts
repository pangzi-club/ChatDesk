import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;
export const MAX_CHAT_IMAGE_EDGE = 1280;
export const CHAT_IMAGE_WEBP_QUALITY = 60;
export const TARGET_CHAT_IMAGE_MAX_BYTES = 256 * 1024;
export const SKIP_CHAT_IMAGE_MAX_BYTES = TARGET_CHAT_IMAGE_MAX_BYTES;
export const CHAT_IMAGE_EDGE_STEPS = [MAX_CHAT_IMAGE_EDGE, 1024, 768] as const;
export const CHAT_IMAGE_QUALITY_STEPS = [CHAT_IMAGE_WEBP_QUALITY, 40, 28] as const;

const SKIPPABLE_FORMATS = new Set(["jpeg", "jpg", "png", "webp"]);
const ANIMATED_OR_VECTOR_FORMATS = new Set(["gif", "svg", "magick"]);

export type CompressedChatImage = {
  bytes: Buffer;
  mediaType?: string;
  width?: number;
  height?: number;
  changed: boolean;
};

type SharpCtor = typeof import("sharp").default;

let sharpLoader: Promise<SharpCtor> | undefined;

function asSharpCtor(mod: unknown): SharpCtor {
  if (typeof mod === "function") return mod as SharpCtor;
  if (mod && typeof mod === "object" && "default" in mod) {
    const ctor = (mod as { default: unknown }).default;
    if (typeof ctor === "function") return ctor as SharpCtor;
  }
  throw new Error("sharp module is not callable");
}

function sharpRequireRoots() {
  const packaged = process.env.CHAT_SERVER_SHARP_PATH?.trim();
  const roots = [...(packaged ? [packaged] : [])];
  try {
    const url = import.meta.url;
    if (typeof url === "string" && url.length > 0) {
      roots.push(path.join(path.dirname(fileURLToPath(url)), ".."));
    }
  } catch {
    // Empty import.meta in the CJS sidecar bundle.
  }
  roots.push(path.join(process.cwd(), "packages/agent-core"), process.cwd());
  return roots;
}

export async function loadSharp(): Promise<SharpCtor> {
  sharpLoader ??= (async () => {
    const specifier = "sharp";
    let lastError: unknown;
    for (const root of sharpRequireRoots()) {
      try {
        return asSharpCtor(createRequire(path.join(root, "package.json"))(specifier));
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError instanceof Error ? lastError : new Error("sharp is not available");
  })();
  return sharpLoader;
}

function mediaTypeForFormat(format: string | undefined) {
  if (format === "jpeg" || format === "jpg") return "image/jpeg";
  if (format === "png") return "image/png";
  if (format === "webp") return "image/webp";
  if (format === "gif") return "image/gif";
  if (format === "avif") return "image/avif";
  if (format === "heif" || format === "heic") return "image/heic";
  if (format === "tiff" || format === "tif") return "image/tiff";
  return undefined;
}

function extensionForMediaType(mediaType: string) {
  if (mediaType === "image/jpeg") return "jpg";
  if (mediaType === "image/png") return "png";
  if (mediaType === "image/webp") return "webp";
  if (mediaType === "image/gif") return "gif";
  return undefined;
}

export function replaceImageFileName(fileName: string, mediaType: string) {
  const extension = extensionForMediaType(mediaType);
  if (!extension) return fileName;
  if (/\.[a-z0-9]+$/i.test(fileName)) return fileName.replace(/\.[a-z0-9]+$/i, `.${extension}`);
  return `${fileName}.${extension}`;
}

function unchanged(
  bytes: Buffer,
  mediaType?: string,
  width?: number,
  height?: number,
): CompressedChatImage {
  return {
    bytes,
    ...(mediaType ? { mediaType } : {}),
    ...(width ? { width } : {}),
    ...(height ? { height } : {}),
    changed: false,
  };
}

export async function compressChatImage(input: Uint8Array): Promise<CompressedChatImage> {
  const source = Buffer.from(input);
  let sharp: SharpCtor;
  try {
    sharp = await loadSharp();
  } catch {
    return unchanged(source);
  }

  try {
    const image = sharp(source, { failOn: "none" }).rotate();
    const meta = await image.metadata();
    const format = meta.format;
    const width = meta.width ?? 0;
    const height = meta.height ?? 0;
    const mediaType = mediaTypeForFormat(format);
    if (!format || ANIMATED_OR_VECTOR_FORMATS.has(format) || (meta.pages ?? 1) > 1) {
      return unchanged(source, mediaType, width || undefined, height || undefined);
    }

    const needsResize = width > MAX_CHAT_IMAGE_EDGE || height > MAX_CHAT_IMAGE_EDGE;
    const alreadySmall =
      !needsResize &&
      width > 0 &&
      height > 0 &&
      source.byteLength <= SKIP_CHAT_IMAGE_MAX_BYTES &&
      SKIPPABLE_FORMATS.has(format);
    if (alreadySmall) {
      return unchanged(source, mediaType, width, height);
    }

    let best: Buffer | undefined;
    for (const edge of CHAT_IMAGE_EDGE_STEPS) {
      for (const quality of CHAT_IMAGE_QUALITY_STEPS) {
        const encoded = await image
          .clone()
          .resize({
            width: edge,
            height: edge,
            fit: "inside",
            withoutEnlargement: true,
          })
          .webp({ quality, effort: 4, smartSubsample: true })
          .toBuffer();
        if (!best || encoded.byteLength < best.byteLength) best = encoded;
        if (encoded.byteLength <= TARGET_CHAT_IMAGE_MAX_BYTES) {
          best = encoded;
          break;
        }
      }
      if (best && best.byteLength <= TARGET_CHAT_IMAGE_MAX_BYTES) break;
    }

    if (!best) return unchanged(source, mediaType, width || undefined, height || undefined);
    if (!needsResize && best.byteLength >= source.byteLength) {
      return unchanged(source, mediaType, width || undefined, height || undefined);
    }

    const output = await sharp(best).metadata();
    return {
      bytes: best,
      mediaType: "image/webp",
      width: output.width,
      height: output.height,
      changed: true,
    };
  } catch {
    return unchanged(source);
  }
}
