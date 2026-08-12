export function normalizeWorkspacePath(value: string) {
  const normalized = value.trim().replace(/\\/g, "/").replace(/\/+$/, "");
  return normalized || "/";
}
