const STATIC_ORIGINS = new Set([
  "null",
  "tauri://localhost",
  "http://tauri.localhost",
  "https://tauri.localhost",
  "chatdesk://localhost",
]);

export function isAllowedChatServerCorsOrigin(origin: string) {
  if (!origin) return false;
  if (STATIC_ORIGINS.has(origin)) return true;
  try {
    const url = new URL(origin);
    const loopback =
      url.hostname === "localhost" ||
      url.hostname === "127.0.0.1" ||
      url.hostname === "[::1]" ||
      url.hostname === "::1";
    return (url.protocol === "http:" || url.protocol === "https:") && loopback;
  } catch {
    return false;
  }
}

export function chatServerCorsOrigin(origin: string) {
  return isAllowedChatServerCorsOrigin(origin) ? origin : null;
}
