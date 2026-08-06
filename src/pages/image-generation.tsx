import { useMutation } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { Download, Image, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  downloadGeneratedImage,
  generateImage,
  IMAGE_MODELS,
  type ImageAspectRatio,
  type ImageModel,
  type ImageResolution,
  KieApiError,
} from "@/lib/image-generation";
import { appendSystemLog } from "@/lib/system-log";

const ASPECT_RATIOS: ImageAspectRatio[] = [
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
];

function ImageGenerationPage() {
  const [prompt, setPrompt] = useState("");
  const [model, setModel] = useState<ImageModel>(IMAGE_MODELS[0].value);
  const [aspectRatio, setAspectRatio] = useState<ImageAspectRatio>("auto");
  const [resolution, setResolution] = useState<ImageResolution>("1K");
  const [progress, setProgress] = useState(0);
  const [downloadNotice, setDownloadNotice] = useState("");
  const mutation = useMutation({
    mutationFn: () =>
      generateImage({ model, prompt: prompt.trim(), aspect_ratio: aspectRatio, resolution }),
    onMutate: () => {
      setProgress(0);
      setDownloadNotice("");
      void appendSystemLog({
        level: "info",
        source: "图片生成",
        message: "图片生成任务已开始",
        details: `模型 ${model}，分辨率 ${resolution}，比例 ${aspectRatio}`,
      });
    },
    onSuccess: (result) => {
      setProgress(100);
      void appendSystemLog({
        level: "success",
        source: "图片生成",
        message: "图片生成任务已完成",
        details: `taskId ${result.taskId}，生成 ${result.urls.length} 张图片`,
      });
    },
    onError: (error) => {
      void appendSystemLog({
        level: "error",
        source: "图片生成",
        message: "图片生成任务失败",
        details: error instanceof Error ? error.message : String(error),
      });
    },
  });
  const imageUrls = mutation.data?.urls ?? [];

  useEffect(() => {
    if (!mutation.isPending) return;
    const startedAt = Date.now();
    const timer = window.setInterval(() => {
      const elapsed = Date.now() - startedAt;
      // Approximate a two-minute generation and leave room for the API to finish.
      setProgress(Math.min(95, Math.round((elapsed / 120_000) * 95)));
    }, 500);
    return () => window.clearInterval(timer);
  }, [mutation.isPending]);

  function submit() {
    if (!prompt.trim() || mutation.isPending) return;
    mutation.mutate();
  }

  async function downloadImage(url: string, index: number) {
    setDownloadNotice("");
    try {
      const blob = await downloadGeneratedImage(url);
      const filename = `m-dashboard-image-${index + 1}.png`;
      if ("__TAURI_INTERNALS__" in window) {
        const bytes = Array.from(new Uint8Array(await blob.arrayBuffer()));
        const saved = await invoke<boolean>("save_image_file", { bytes, fileName: filename });
        if (saved) setDownloadNotice("图片已保存。");
        return;
      }
      const picker = (
        window as Window & {
          showSaveFilePicker?: (options?: {
            suggestedName?: string;
            types?: Array<{ description: string; accept: Record<string, string[]> }>;
          }) => Promise<{
            createWritable: () => Promise<{
              write: (data: Blob) => Promise<void>;
              close: () => Promise<void>;
            }>;
          }>;
        }
      ).showSaveFilePicker;
      if (picker) {
        const handle = await picker({
          suggestedName: filename,
          types: [{ description: "PNG image", accept: { "image/png": [".png"] } }],
        });
        const writable = await handle.createWritable();
        await writable.write(blob);
        await writable.close();
      } else {
        const objectUrl = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = objectUrl;
        anchor.download = filename;
        anchor.click();
        URL.revokeObjectURL(objectUrl);
      }
      setDownloadNotice("图片已保存。");
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setDownloadNotice(error instanceof Error ? error.message : "图片保存失败，请重试。");
    }
  }

  return (
    <div className="flex w-full flex-1 flex-col gap-7 px-6 pt-14 pb-10 sm:px-10 lg:px-16">
      <header>
        <p className="font-medium text-muted-foreground text-sm">Creative tools</p>
        <h1 className="mt-2 flex items-center gap-2 font-semibold text-3xl tracking-normal">
          <Sparkles className="size-7" />
          图片生成
        </h1>
        <p className="mt-2 max-w-2xl text-muted-foreground text-sm leading-6">
          使用 GPT Image 2 将文字描述转换为图片。
        </p>
      </header>

      {!mutation.isPending && mutation.isError ? (
        <section className="rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-destructive text-sm">
          {mutation.error instanceof KieApiError
            ? mutation.error.message
            : "生成失败，请稍后重试。"}
          {!mutation.error ||
          (mutation.error instanceof KieApiError && mutation.error.message.includes("设置")) ? (
            <Link className="ml-2 underline underline-offset-4" to="/settings/keys">
              前往设置
            </Link>
          ) : null}
        </section>
      ) : null}

      <section className="grid gap-0 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <div className="bg-card p-5">
          <div className="mb-5 flex items-center gap-2">
            <Image className="size-4 text-muted-foreground" />
            <h2 className="font-medium text-sm">生成参数</h2>
          </div>
          <label className="block font-medium text-sm" htmlFor="image-prompt">
            Prompt
          </label>
          <Textarea
            className="mt-2 min-h-36 resize-y"
            id="image-prompt"
            maxLength={20_000}
            onChange={(event) => setPrompt(event.target.value)}
            placeholder="描述你想生成的图片..."
            value={prompt}
          />
          <p className="mt-1 text-right text-muted-foreground text-xs">
            {prompt.length.toLocaleString()} / 20,000
          </p>
          <div className="mt-5">
            <div className="border-border border-b pb-4">
              <label className="font-medium text-sm" htmlFor="image-model">
                Model
              </label>
              <Select onValueChange={(value) => setModel(value as ImageModel)} value={model}>
                <SelectTrigger className="mt-2 w-full" id="image-model">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {IMAGE_MODELS.map((item) => (
                    <SelectItem key={item.value} value={item.value}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-4 pt-4 sm:grid-cols-2">
              <div>
                <label className="font-medium text-sm" htmlFor="aspect-ratio">
                  Aspect ratio
                </label>
                <Select
                  onValueChange={(value) => setAspectRatio(value as ImageAspectRatio)}
                  value={aspectRatio}
                >
                  <SelectTrigger className="mt-2 w-full" id="aspect-ratio">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ASPECT_RATIOS.map((value) => (
                      <SelectItem key={value} value={value}>
                        {value}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="font-medium text-sm" htmlFor="resolution">
                  Resolution
                </label>
                <Select
                  onValueChange={(value) => setResolution(value as ImageResolution)}
                  value={resolution}
                >
                  <SelectTrigger className="mt-2 w-full" id="resolution">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="1K">1K</SelectItem>
                    <SelectItem value="2K">2K</SelectItem>
                    <SelectItem value="4K">4K</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
          <Button
            className="mt-6 w-full"
            disabled={!prompt.trim() || mutation.isPending}
            onClick={submit}
            type="button"
          >
            <Sparkles className="size-4" />
            {mutation.isPending ? "生成中..." : "生成图片"}
          </Button>
        </div>

        <div className="min-h-[420px] bg-card p-5 lg:border-l">
          {mutation.isPending ? (
            <ImageResultSkeleton progress={progress} />
          ) : imageUrls.length > 0 ? (
            <div className="flex h-full min-h-[380px] flex-col items-center justify-center gap-5">
              {imageUrls.map((url, index) => (
                <div className="flex w-full flex-col items-center gap-3" key={url}>
                  <img
                    alt="生成结果"
                    className="max-h-[460px] max-w-full rounded-md border border-border object-contain"
                    src={url}
                  />
                  <Button
                    onClick={() => void downloadImage(url, index)}
                    type="button"
                    variant="outline"
                  >
                    <Download className="size-4" />
                    下载图片
                  </Button>
                </div>
              ))}
              {downloadNotice ? (
                <p className="text-muted-foreground text-xs">{downloadNotice}</p>
              ) : null}
            </div>
          ) : (
            <div className="flex h-full min-h-[380px] flex-col items-center justify-center text-center text-muted-foreground">
              <Image className="mb-3 size-9 opacity-40" />
              <p className="font-medium text-sm">生成结果会显示在这里</p>
              <p className="mt-1 text-xs">填写 Prompt 后开始创作</p>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

function ImageResultSkeleton({ progress }: { progress: number }) {
  return (
    <div className="flex h-full min-h-[380px] flex-col items-center justify-center">
      <div className="aspect-square w-full max-w-[520px] animate-pulse rounded-lg bg-muted-foreground/10" />
      <div className="mt-5 w-full max-w-[520px]">
        <div className="flex items-center justify-between text-muted-foreground text-xs">
          <span>正在生成图片</span>
          <span>{progress}%</span>
        </div>
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-primary transition-[width] duration-500"
            style={{ width: `${progress}%` }}
          />
        </div>
        <p className="mt-2 text-center text-muted-foreground text-xs">
          通常需要约 2 分钟，请耐心等待
        </p>
      </div>
    </div>
  );
}

export { ImageGenerationPage };
