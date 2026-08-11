export const KIE_API_BASE_URL = "https://api.kie.ai";

export const IMAGE_ASPECT_RATIOS = [
  "auto",
  "1:1",
  "3:2",
  "2:3",
  "4:3",
  "3:4",
  "16:9",
  "9:16",
  "2:1",
  "1:2",
  "3:1",
  "1:3",
  "21:9",
  "9:21",
  "5:4",
  "4:5",
] as const;

export const IMAGE_RESOLUTIONS = ["1K", "2K", "4K"] as const;

export type ImageAspectRatio = (typeof IMAGE_ASPECT_RATIOS)[number];
export type ImageResolution = (typeof IMAGE_RESOLUTIONS)[number];
export type ImageModel = "gpt-image-2-text-to-image";

export interface ImageGenerationInput {
  model: ImageModel;
  prompt: string;
  aspect_ratio: ImageAspectRatio;
  resolution: ImageResolution;
}

export type GenerateImageResult = {
  taskId: string;
  urls: string[];
};

export class KieApiError extends Error {
  readonly status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.status = status;
    this.name = "KieApiError";
  }
}

interface KieEnvelope<T> {
  code: number;
  msg?: string;
  data: T;
}

interface TaskRecord {
  taskId: string;
  state: "waiting" | "success" | "fail" | string;
  resultJson?: string | null;
  failMsg?: string | null;
}

function mergeAbortSignals(...signals: Array<AbortSignal | undefined>): AbortSignal | undefined {
  const active = signals.filter((signal): signal is AbortSignal => Boolean(signal));
  if (active.length === 0) return undefined;
  if (active.length === 1) return active[0];
  if (typeof AbortSignal.any === "function") return AbortSignal.any(active);
  const controller = new AbortController();
  for (const signal of active) {
    if (signal.aborted) {
      controller.abort(signal.reason);
      break;
    }
    signal.addEventListener("abort", () => controller.abort(signal.reason), { once: true });
  }
  return controller.signal;
}

async function sleep(ms: number, abortSignal?: AbortSignal) {
  if (!abortSignal) {
    await new Promise<void>((resolve) => setTimeout(resolve, ms));
    return;
  }
  if (abortSignal.aborted) throw abortSignal.reason ?? new Error("请求已取消");
  await new Promise<void>((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortSignal.reason ?? new Error("请求已取消"));
    };
    const timer = setTimeout(() => {
      abortSignal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    abortSignal.addEventListener("abort", onAbort, { once: true });
  });
}

function isEnvelope(value: unknown): value is KieEnvelope<unknown> {
  return typeof value === "object" && value !== null && "code" in value && "data" in value;
}

async function request<T>(
  apiKey: string,
  input: RequestInit,
  requestPath: string,
  fetchImpl: typeof fetch,
  abortSignal?: AbortSignal,
): Promise<T> {
  let response: Response;
  try {
    response = await fetchImpl(new URL(requestPath, KIE_API_BASE_URL), {
      ...input,
      headers: {
        accept: "application/json",
        Authorization: `Bearer ${apiKey}`,
        ...input.headers,
      },
      signal: mergeAbortSignals(AbortSignal.timeout(30_000), abortSignal),
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new KieApiError(`无法连接到 KIE API（${detail}）`);
  }

  const text = await response.text();
  let body: unknown;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    throw new KieApiError("KIE API 返回了非 JSON 响应", response.status);
  }
  if (!response.ok || !isEnvelope(body) || body.code !== 200) {
    const message = isEnvelope(body) ? body.msg : `请求失败（HTTP ${response.status}）`;
    throw new KieApiError(message || "KIE API 请求失败", response.status);
  }
  return body.data as T;
}

export async function generateImageWithApiKey(
  apiKey: string,
  input: ImageGenerationInput,
  options?: { abortSignal?: AbortSignal; fetchImpl?: typeof fetch },
): Promise<GenerateImageResult> {
  const normalizedKey = apiKey.trim();
  if (!normalizedKey) throw new KieApiError("请先在设置中配置 KIE_API_KEY。");
  const fetchImpl = options?.fetchImpl ?? fetch;
  const abortSignal = options?.abortSignal;
  const task = await request<{ taskId: string }>(
    normalizedKey,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: input.model, input }),
    },
    "/api/v1/jobs/createTask",
    fetchImpl,
    abortSignal,
  );
  if (!task.taskId) throw new KieApiError("KIE API 未返回 taskId。");

  for (let attempt = 0; attempt < 90; attempt += 1) {
    const record = await request<TaskRecord>(
      normalizedKey,
      { method: "GET" },
      `/api/v1/jobs/recordInfo?taskId=${encodeURIComponent(task.taskId)}`,
      fetchImpl,
      abortSignal,
    );
    if (record.state === "success") {
      try {
        const parsed = JSON.parse(record.resultJson ?? "{}");
        const urls = Array.isArray(parsed.resultUrls) ? parsed.resultUrls : [];
        if (urls.every((url: unknown) => typeof url === "string") && urls.length > 0) {
          return { taskId: task.taskId, urls: urls as string[] };
        }
      } catch {
        // Fall through to a stable error for malformed successful responses.
      }
      throw new KieApiError("任务已完成，但未返回图片地址。");
    }
    if (record.state === "fail") throw new KieApiError(record.failMsg || "图片生成失败。");
    await sleep(5_000, abortSignal);
  }
  throw new KieApiError("图片生成超时，请稍后重试。");
}
