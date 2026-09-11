/** Narrow an unknown value to a plain record (arrays included, matching prior guards). */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

/** Like {@link isRecord}, but returns `null` instead of a boolean for inline guards. */
export function asRecord(value: unknown): Record<string, unknown> | null {
  return isRecord(value) ? value : null;
}

/** Trimmed string value, or an empty string for anything that is not a string. */
export function cleanString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

/** Last path segment of a POSIX or Windows path. */
export function fileNameFromPath(path: string) {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}

/** Guess an image media type from a file path or URL extension. */
export function guessImageMediaType(path: string): string | undefined {
  const lower = path.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".gif")) return "image/gif";
  if (lower.endsWith(".webp")) return "image/webp";
  return undefined;
}
