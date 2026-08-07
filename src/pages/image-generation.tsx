import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { BookImage, Check, Copy, Download, Image, Library, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import {
  type ImageGenerationRecord,
  loadImageGenerationLibrary,
  saveImageGenerationRecord,
} from "@/lib/image-generation-library";
import {
  IMAGE_GENERATION_TEMPLATES,
  type ImageGenerationTemplate,
} from "@/lib/image-generation-templates";
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

async function saveImageFile(url: string, filename: string) {
  if ("__TAURI_INTERNALS__" in window) {
    const blob = await downloadGeneratedImage(url);
    const bytes = Array.from(new Uint8Array(await blob.arrayBuffer()));
    return invoke<boolean>("save_image_file", { bytes, fileName: filename });
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
    const blob = await downloadGeneratedImage(url);
    const writable = await handle.createWritable();
    await writable.write(blob);
    await writable.close();
  } else {
    const blob = await downloadGeneratedImage(url);
    const objectUrl = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = objectUrl;
    anchor.download = filename;
    anchor.click();
    URL.revokeObjectURL(objectUrl);
  }
  return true;
}

function ImageGenerationPage() {
  const [prompt, setPrompt] = useState("");
  const [model, setModel] = useState<ImageModel>(IMAGE_MODELS[0].value);
  const [aspectRatio, setAspectRatio] = useState<ImageAspectRatio>("auto");
  const [resolution, setResolution] = useState<ImageResolution>("1K");
  const [progress, setProgress] = useState(0);
  const [downloadNotice, setDownloadNotice] = useState("");
  const [libraryNotice, setLibraryNotice] = useState("");
  const [templateOpen, setTemplateOpen] = useState(false);
  const queryClient = useQueryClient();
  const libraryQuery = useQuery({
    queryKey: ["image-generation-library"],
    queryFn: loadImageGenerationLibrary,
  });
  const mutation = useMutation({
    mutationFn: (input: {
      model: ImageModel;
      prompt: string;
      aspect_ratio: ImageAspectRatio;
      resolution: ImageResolution;
    }) => generateImage(input),
    onMutate: (variables) => {
      setProgress(0);
      setDownloadNotice("");
      void appendSystemLog({
        level: "info",
        source: "图片生成",
        message: "图片生成任务已开始",
        details: `模型 ${variables.model}，分辨率 ${variables.resolution}，比例 ${variables.aspect_ratio}`,
      });
    },
    onSuccess: (result, variables) => {
      setProgress(100);
      const record: ImageGenerationRecord = {
        id: `${result.taskId}-${Date.now()}`,
        createdAt: new Date().toISOString(),
        taskId: result.taskId,
        urls: result.urls,
        prompt: variables.prompt,
        model: variables.model,
        aspectRatio: variables.aspect_ratio,
        resolution: variables.resolution,
      };
      void saveImageGenerationRecord(record)
        .then(() => queryClient.invalidateQueries({ queryKey: ["image-generation-library"] }))
        .catch(() => setLibraryNotice("生成成功，但照片库保存失败。"));
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
    mutation.mutate({ model, prompt: prompt.trim(), aspect_ratio: aspectRatio, resolution });
  }

  function selectTemplate(template: ImageGenerationTemplate) {
    setPrompt(template.prompt);
    setTemplateOpen(false);
  }

  async function downloadImage(url: string, index: number) {
    setDownloadNotice("");
    try {
      const filename = `m-dashboard-image-${index + 1}.png`;
      if (await saveImageFile(url, filename)) setDownloadNotice("图片已保存。");
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
          <div className="mb-5 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Image className="size-4 text-muted-foreground" />
              <h2 className="font-medium text-sm">生成参数</h2>
            </div>
            <Button onClick={() => setTemplateOpen(true)} size="sm" type="button" variant="outline">
              <Library className="size-4" />
              模板库
            </Button>
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

      <section className="border-t pt-7">
        <div className="flex items-end justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <BookImage className="size-4 text-muted-foreground" />
              <h2 className="font-semibold text-lg">照片库</h2>
            </div>
            <p className="mt-1 text-muted-foreground text-sm">最近生成的图片和对应参数</p>
          </div>
          {libraryQuery.data?.length ? (
            <span className="text-muted-foreground text-xs">{libraryQuery.data.length} 条记录</span>
          ) : null}
        </div>
        {libraryNotice ? <p className="mt-3 text-destructive text-sm">{libraryNotice}</p> : null}
        {libraryQuery.isLoading ? (
          <LibrarySkeleton />
        ) : libraryQuery.isError ? (
          <div className="mt-5 border border-destructive/40 bg-destructive/10 p-5 text-destructive text-sm">
            照片库暂时无法读取，请刷新页面重试。
          </div>
        ) : libraryQuery.data?.length ? (
          <div className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {libraryQuery.data.map((record) => (
              <PhotoRecordCard key={record.id} record={record} />
            ))}
          </div>
        ) : (
          <div className="mt-5 border border-dashed p-10 text-center text-muted-foreground">
            <BookImage className="mx-auto mb-3 size-8 opacity-40" />
            <p className="font-medium text-sm">还没有生成记录</p>
            <p className="mt-1 text-xs">完成第一次创作后，图片会保存在这里</p>
          </div>
        )}
      </section>

      <Dialog onOpenChange={setTemplateOpen} open={templateOpen}>
        <DialogContent className="max-h-[min(820px,calc(100vh-2rem))] max-w-5xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>模板库</DialogTitle>
            <DialogDescription>选择一个样例，把它的 Prompt 带入生成器。</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 sm:grid-cols-2">
            {IMAGE_GENERATION_TEMPLATES.map((template) => (
              <button
                className="group overflow-hidden rounded-lg border bg-card text-left transition-colors hover:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                key={template.id}
                onClick={() => selectTemplate(template)}
                type="button"
              >
                <img
                  alt={template.name}
                  className="aspect-[4/3] w-full object-cover"
                  src={template.image}
                />
                <div className="p-4">
                  <p className="font-medium text-sm">{template.name}</p>
                  <p className="mt-1 text-muted-foreground text-xs">{template.description}</p>
                  <p className="mt-3 line-clamp-3 text-muted-foreground text-xs leading-5">
                    {template.prompt}
                  </p>
                </div>
              </button>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function PhotoRecordCard({ record }: { record: ImageGenerationRecord }) {
  const [failedUrls, setFailedUrls] = useState<string[]>([]);
  const [copied, setCopied] = useState(false);
  const [actionNotice, setActionNotice] = useState("");
  const date = new Date(record.createdAt);

  async function copyPrompt() {
    setActionNotice("");
    try {
      await navigator.clipboard.writeText(record.prompt);
      setCopied(true);
    } catch {
      setActionNotice("提示词复制失败，请重试。");
    }
  }

  async function saveLibraryImage(url: string, index: number) {
    setActionNotice("");
    try {
      const filename = `m-dashboard-${record.taskId}-${index + 1}.png`;
      if (await saveImageFile(url, filename)) setActionNotice("图片已保存。");
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setActionNotice(error instanceof Error ? error.message : "图片保存失败，请重试。");
    }
  }

  return (
    <article className="overflow-hidden rounded-lg border bg-card">
      <div className="grid grid-cols-2 gap-px bg-border">
        {record.urls.map((url) =>
          failedUrls.includes(url) ? (
            <div
              className="flex aspect-square items-center justify-center bg-muted p-4 text-center text-muted-foreground text-xs"
              key={url}
            >
              图片已失效
            </div>
          ) : (
            <div className="flex aspect-square items-center justify-center bg-muted/40" key={url}>
              <img
                alt="生成照片"
                className="mx-auto max-h-full max-w-full object-contain"
                onError={() => setFailedUrls((current) => [...current, url])}
                src={url}
              />
            </div>
          ),
        )}
      </div>
      <div className="space-y-3 p-4">
        <p className="line-clamp-3 text-sm leading-5" title={record.prompt}>
          {record.prompt}
        </p>
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-muted-foreground text-xs">
          <span>{record.model.replace("gpt-image-2-text-to-image", "GPT Image 2")}</span>
          <span>{record.aspectRatio}</span>
          <span>{record.resolution}</span>
        </div>
        <div className="flex items-center justify-between text-muted-foreground text-xs">
          <span>{date.toLocaleString()}</span>
          <span className="max-w-[10rem] truncate" title={record.taskId}>
            {record.taskId}
          </span>
        </div>
        <div className="flex flex-wrap gap-2 border-t pt-3">
          <Button onClick={() => void copyPrompt()} size="sm" type="button" variant="outline">
            {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
            {copied ? "已复制" : "复制提示词"}
          </Button>
          {record.urls.map((url, index) => (
            <Button
              disabled={failedUrls.includes(url)}
              key={url}
              onClick={() => void saveLibraryImage(url, index)}
              size="sm"
              type="button"
              variant="outline"
            >
              <Download className="size-4" />
              {record.urls.length > 1 ? `另存图片 ${index + 1}` : "图片另存为"}
            </Button>
          ))}
        </div>
        {actionNotice ? <p className="text-muted-foreground text-xs">{actionNotice}</p> : null}
      </div>
    </article>
  );
}

function LibrarySkeleton() {
  return (
    <div className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {["one", "two", "three"].map((id) => (
        <div className="overflow-hidden rounded-lg border" key={id}>
          <div className="aspect-square animate-pulse bg-muted-foreground/10" />
          <div className="space-y-3 p-4">
            <div className="h-4 animate-pulse rounded bg-muted-foreground/10" />
            <div className="h-3 w-2/3 animate-pulse rounded bg-muted-foreground/10" />
          </div>
        </div>
      ))}
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
