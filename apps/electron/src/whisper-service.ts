import { mkdir, open, rename, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type {
  WhisperModelId,
  WhisperModelStatus,
  WhisperTranscriptionResult,
} from "@chatdesk/shared";

export type WhisperModelDefinition = {
  id: WhisperModelId;
  label: string;
  description: string;
  size: string;
  repository: string;
  files: string[];
};

const MODEL_FILES = [
  "added_tokens.json",
  "config.json",
  "generation_config.json",
  "merges.txt",
  "normalizer.json",
  "preprocessor_config.json",
  "special_tokens_map.json",
  "tokenizer.json",
  "tokenizer_config.json",
  "vocab.json",
  "onnx/encoder_model_quantized.onnx",
  "onnx/decoder_model_merged_quantized.onnx",
] as const;

export const WHISPER_MODELS: WhisperModelDefinition[] = [
  ["tiny", "Tiny", "最快，准确度较低", "75 MB"],
  ["tiny.en", "Tiny (English)", "仅支持英语", "75 MB"],
  ["base", "Base", "平衡速度与准确度", "142 MB"],
  ["small", "Small", "更高准确度", "466 MB"],
  ["medium", "Medium", "高准确度，资源占用较高", "1.5 GB"],
  ["large-v3-turbo", "Large V3 Turbo", "快速且准确，推荐选择", "1.6 GB"],
].map(([id, label, description, size]) => ({
  id: id as WhisperModelId,
  label,
  description,
  size,
  repository:
    id === "large-v3-turbo" ? "onnx-community/whisper-large-v3-turbo" : `Xenova/whisper-${id}`,
  files: [...MODEL_FILES],
}));

const MODEL_IDS = new Set(WHISPER_MODELS.map((model) => model.id));
const activeDownloads = new Map<WhisperModelId, AbortController>();

export function whisperModelDirectory() {
  return path.join(os.homedir(), ".chatdesk", "whisper");
}

function definition(modelId: WhisperModelId) {
  if (!MODEL_IDS.has(modelId)) throw new Error("不支持的 Whisper 模型");
  return WHISPER_MODELS.find((model) => model.id === modelId)!;
}

function modelDirectory(modelId: WhisperModelId) {
  return path.join(whisperModelDirectory(), modelId);
}

export async function listWhisperModels(): Promise<{ directory: string; models: WhisperModelStatus[] }> {
  await mkdir(whisperModelDirectory(), { recursive: true, mode: 0o700 });
  const models = await Promise.all(
    WHISPER_MODELS.map(async (model) => {
      const directory = modelDirectory(model.id);
      const marker = path.join(directory, ".complete");
      let installed = false;
      try {
        await stat(marker);
        installed = true;
      } catch {
        // Missing marker means an incomplete or absent model.
      }
      return { id: model.id, installed, downloading: false, bytesDownloaded: 0 };
    }),
  );
  return { directory: whisperModelDirectory(), models };
}

export async function downloadWhisperModel(
  modelId: WhisperModelId,
  onProgress?: (status: WhisperModelStatus) => void,
) {
  const model = definition(modelId);
  activeDownloads.get(modelId)?.abort();
  const controller = new AbortController();
  activeDownloads.set(modelId, controller);
  const target = modelDirectory(modelId);
  const temporary = `${target}.partial`;
  await rm(temporary, { recursive: true, force: true });
  await mkdir(temporary, { recursive: true, mode: 0o700 });
  let downloaded = 0;
  try {
    for (const file of model.files) {
      const url = `https://huggingface.co/${model.repository}/resolve/main/${file}?download=true`;
      const response = await fetch(url, {
        headers: {
          Accept: "application/octet-stream",
          "User-Agent": "ChatDesk/0.6 Whisper model downloader",
        },
        signal: controller.signal,
      });
      if (!response.ok || !response.body) {
        const detail = response.status === 401 ? "模型源要求认证，或当前代理拒绝了匿名下载" : `HTTP ${response.status}`;
        throw new Error(`模型文件下载失败：${file}（${detail}）`);
      }
      const reader = response.body.getReader();
      const destination = path.join(temporary, file);
      await mkdir(path.dirname(destination), { recursive: true });
      const output = await open(destination, "w", 0o600);
      let fileBytes = 0;
      try {
        while (true) {
          const next = await reader.read();
          if (next.done) break;
          await output.write(next.value);
          fileBytes += next.value.byteLength;
          onProgress?.({ id: modelId, installed: false, downloading: true, bytesDownloaded: downloaded + fileBytes });
        }
      } finally {
        await output.close();
      }
      downloaded += fileBytes;
      onProgress?.({ id: modelId, installed: false, downloading: true, bytesDownloaded: downloaded });
    }
    await writeFile(path.join(temporary, ".complete"), "ok\n", { mode: 0o600 });
    await rm(target, { recursive: true, force: true });
    await rename(temporary, target);
    return { id: modelId, installed: true, downloading: false, bytesDownloaded: downloaded };
  } catch (error) {
    await rm(temporary, { recursive: true, force: true });
    if (controller.signal.aborted) throw new Error("已取消模型下载");
    throw error;
  } finally {
    if (activeDownloads.get(modelId) === controller) activeDownloads.delete(modelId);
  }
}

export async function cancelWhisperDownload(modelId: WhisperModelId) {
  definition(modelId);
  activeDownloads.get(modelId)?.abort();
}

export async function deleteWhisperModel(modelId: WhisperModelId) {
  definition(modelId);
  await rm(modelDirectory(modelId), { recursive: true, force: true });
}

export async function transcribeWhisper(input: {
  modelId: WhisperModelId;
  language: string;
  samples: number[];
  sampleRate: number;
}): Promise<WhisperTranscriptionResult> {
  const model = definition(input.modelId);
  const available = await listWhisperModels();
  if (!available.models.find((item) => item.id === input.modelId)?.installed) {
    throw new Error("请先下载并安装所选 Whisper 模型");
  }
  if (!input.samples.length || input.samples.length > input.sampleRate * 300) {
    throw new Error("音频长度无效");
  }
  try {
    const dynamicImport = Function("specifier", "return import(specifier)") as (
      specifier: string,
    ) => Promise<{ pipeline: (task: string, model: string, options?: Record<string, unknown>) => Promise<unknown> }>;
    const { pipeline } = await dynamicImport("@huggingface/transformers");
    const transcriber = (await pipeline("automatic-speech-recognition", modelDirectory(input.modelId), {
      local_files_only: true,
    })) as (audio: Float32Array, options: Record<string, unknown>) => Promise<{ text?: string }>;
    const result = await transcriber(Float32Array.from(input.samples), {
      sampling_rate: input.sampleRate,
      ...(input.language === "auto" ? {} : { language: input.language }),
    });
    return { text: result.text?.trim() ?? "", modelId: input.modelId };
  } catch (error) {
    if (error instanceof Error && error.message.includes("Cannot find package")) {
      throw new Error("未安装 @huggingface/transformers，无法执行本地转写");
    }
    throw error;
  }
}
