import { getDesktopBridge } from "@/lib/desktop-bridge";

export function desktopFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const bridge = getDesktopBridge();
  if (!bridge) return window.fetch(input, init);

  const request = input instanceof Request ? input : null;
  const url = request?.url ?? String(input);
  const method = init.method ?? request?.method ?? "GET";
  const headers = new Headers(init.headers ?? request?.headers);
  const body = serializeBody(init.body);
  const operation = bridge
    .httpRequest({
      url,
      method,
      headers: [...headers.entries()],
      ...(body === undefined ? {} : { body }),
    })
    .then(
      (response) =>
        new Response(Uint8Array.from(response.body), {
          status: response.status,
          statusText: response.statusText,
          headers: response.headers,
        }),
    );
  return raceAbort(operation, init.signal);
}

function serializeBody(body: BodyInit | null | undefined) {
  if (body == null) return undefined;
  if (typeof body === "string") return body;
  if (body instanceof URLSearchParams) return body.toString();
  throw new Error("桌面 HTTP bridge 目前只接受文本请求体");
}

function raceAbort<T>(operation: Promise<T>, signal?: AbortSignal | null): Promise<T> {
  if (!signal) return operation;
  if (signal.aborted)
    return Promise.reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
    signal.addEventListener("abort", abort, { once: true });
    void operation.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}
