const ALLOWED_METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE"]);
const BLOCKED_REQUEST_HEADERS = new Set(["connection", "content-length", "cookie", "host", "proxy-authorization"]);
const MAX_REQUEST_BYTES = 5 * 1024 * 1024;
const MAX_RESPONSE_BYTES = 50 * 1024 * 1024;
const MAX_REDIRECTS = 5;

export type DesktopHttpRequest = {
  url: unknown;
  method: unknown;
  headers: unknown;
  body?: unknown;
};

export type DesktopHttpResponse = {
  status: number;
  statusText: string;
  headers: Array<[string, string]>;
  body: number[];
};

export async function performHttpRequest(
  input: DesktopHttpRequest,
  fetchImpl: typeof fetch = fetch,
): Promise<DesktopHttpResponse> {
  const method = validateMethod(input.method);
  const headers = validateHeaders(input.headers);
  const body = validateBody(input.body);
  let url = validateHttpUrl(input.url);

  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
    const response = await fetchImpl(url, {
      method,
      headers,
      ...(body === undefined ? {} : { body }),
      redirect: "manual",
      signal: AbortSignal.timeout(30_000),
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) return serializeResponse(response);
      if (redirects === MAX_REDIRECTS) throw new Error("HTTP 重定向次数过多");
      url = validateHttpUrl(new URL(location, url).toString());
      continue;
    }
    return serializeResponse(response);
  }
  throw new Error("HTTP 请求失败");
}

export function validateHttpUrl(value: unknown) {
  if (typeof value !== "string") throw new Error("HTTP URL 必须是字符串");
  const url = new URL(value);
  const loopback = url.hostname === "127.0.0.1" || url.hostname === "localhost" || url.hostname === "[::1]";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) {
    throw new Error("只允许 HTTPS 或 loopback HTTP 请求");
  }
  if (url.username || url.password) throw new Error("HTTP URL 不允许包含凭据");
  return url.toString();
}

function validateMethod(value: unknown) {
  const method = typeof value === "string" ? value.toUpperCase() : "GET";
  if (!ALLOWED_METHODS.has(method)) throw new Error(`不允许使用 HTTP ${method}`);
  return method;
}

function validateHeaders(value: unknown) {
  if (!Array.isArray(value)) throw new Error("HTTP headers 格式无效");
  if (value.length > 100) throw new Error("HTTP headers 数量过多");
  const headers = new Headers();
  for (const entry of value) {
    if (!Array.isArray(entry) || entry.length !== 2 || typeof entry[0] !== "string" || typeof entry[1] !== "string") {
      throw new Error("HTTP header 格式无效");
    }
    if (BLOCKED_REQUEST_HEADERS.has(entry[0].toLowerCase())) throw new Error(`不允许设置 HTTP header：${entry[0]}`);
    headers.append(entry[0], entry[1]);
  }
  return headers;
}

function validateBody(value: unknown) {
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw new Error("HTTP 请求体必须是字符串");
  if (Buffer.byteLength(value) > MAX_REQUEST_BYTES) throw new Error("HTTP 请求体过大");
  return value;
}

async function serializeResponse(response: Response): Promise<DesktopHttpResponse> {
  const declaredLength = Number(response.headers.get("content-length") ?? 0);
  if (declaredLength > MAX_RESPONSE_BYTES) throw new Error("HTTP 响应体过大");
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > MAX_RESPONSE_BYTES) throw new Error("HTTP 响应体过大");
  return {
    status: response.status,
    statusText: response.statusText,
    headers: [...response.headers.entries()].filter(([name]) => name.toLowerCase() !== "set-cookie"),
    body: [...bytes],
  };
}
