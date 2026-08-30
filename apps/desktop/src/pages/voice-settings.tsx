import type { WhisperModelId, WhisperModelStatus } from "@chatdesk/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Download, Mic, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  getVoiceBridge,
  loadVoiceSettings,
  saveVoiceSettings,
  type VoiceSettings,
} from "@/lib/voice-settings";

const models: Array<{ id: WhisperModelId; label: string; size: string; description: string }> = [
  {
    id: "large-v3-turbo",
    label: "Large V3 Turbo",
    size: "1.6 GB",
    description: "快速且准确，推荐选择",
  },
  { id: "tiny", label: "Tiny", size: "75 MB", description: "最快，准确度较低" },
  { id: "tiny.en", label: "Tiny (English)", size: "75 MB", description: "仅支持英语" },
  { id: "base", label: "Base", size: "142 MB", description: "平衡速度与准确度" },
  { id: "small", label: "Small", size: "466 MB", description: "更高准确度" },
  { id: "medium", label: "Medium", size: "1.5 GB", description: "高准确度，资源占用较高" },
];
const languages = [
  ["auto", "自动检测"],
  ["zh", "中文"],
  ["en", "English"],
  ["ja", "日本語"],
  ["ko", "한국어"],
];

export function VoiceSettingsPage() {
  const bridge = getVoiceBridge();
  const client = useQueryClient();
  const [settings, setSettings] = useState<VoiceSettings | null>(null);
  const [progress, setProgress] = useState<Record<string, number>>({});
  const [error, setError] = useState("");
  const settingsQuery = useQuery({ queryKey: ["voice-settings"], queryFn: loadVoiceSettings });
  const modelsQuery = useQuery({
    queryKey: ["whisper-models"],
    queryFn: () =>
      bridge?.whisperListModels?.() ??
      Promise.resolve({ directory: "~/.chatdesk/whisper", models: [] }),
    enabled: Boolean(bridge),
  });
  useEffect(() => {
    if (settingsQuery.data) setSettings(settingsQuery.data);
  }, [settingsQuery.data]);
  useEffect(() => {
    if (!bridge?.subscribe) return;
    let active = true;
    let unsubscribe: (() => void) | undefined;
    void bridge
      .subscribe("whisper-download-progress", (payload) => {
        if (!active || !payload || typeof payload !== "object") return;
        const item = payload as { id?: unknown; bytesDownloaded?: unknown };
        if (typeof item.id === "string" && typeof item.bytesDownloaded === "number") {
          setProgress((current) => ({
            ...current,
            [item.id as string]: item.bytesDownloaded as number,
          }));
        }
      })
      .then((dispose) => {
        if (active) unsubscribe = dispose;
        else dispose();
      });
    return () => {
      active = false;
      unsubscribe?.();
    };
  }, [bridge]);
  const downloadMutation = useMutation({
    mutationFn: async (id: WhisperModelId) => {
      if (!bridge?.whisperDownloadModel) throw new Error("仅支持 Electron 桌面版");
      return bridge.whisperDownloadModel(id);
    },
    onSuccess: () => client.invalidateQueries({ queryKey: ["whisper-models"] }),
    onError: (reason) => {
      const message = reason instanceof Error ? reason.message : "模型下载失败";
      if (!message.includes("已取消")) setError(message);
    },
  });
  const cancelMutation = useMutation({
    mutationFn: async (id: WhisperModelId) => {
      if (!bridge?.whisperCancelDownload) throw new Error("当前版本不支持取消下载");
      return bridge.whisperCancelDownload(id);
    },
    onError: (reason) => setError(reason instanceof Error ? reason.message : "取消下载失败"),
  });
  const deleteMutation = useMutation({
    mutationFn: async (id: WhisperModelId) => {
      if (!bridge?.whisperDeleteModel) throw new Error("仅支持 Electron 桌面版");
      return bridge.whisperDeleteModel(id);
    },
    onSuccess: () => client.invalidateQueries({ queryKey: ["whisper-models"] }),
    onError: (reason) => setError(reason instanceof Error ? reason.message : "模型删除失败"),
  });
  if (!settings) return <div className="text-muted-foreground text-sm">正在加载设置...</div>;
  const installed = (modelsQuery.data?.models ?? []) as WhisperModelStatus[];
  const update = (next: VoiceSettings) => {
    setSettings(next);
    setError("");
    void saveVoiceSettings(next);
  };
  return (
    <>
      <header className="mb-8">
        <p className="font-medium text-muted-foreground text-xs uppercase tracking-[0.16em]">
          Voice
        </p>
        <h1 className="mt-2 font-semibold text-3xl tracking-tight">语音</h1>
        <p className="mt-2 max-w-xl text-muted-foreground text-sm leading-6">
          使用本地 Whisper 模型启用语音转文字输入。
        </p>
      </header>
      <section className="mb-5 overflow-hidden rounded-lg border border-border bg-card">
        <div className="border-border border-b px-5 py-4">
          <h2 className="font-medium text-sm">语音输入</h2>
          <p className="mt-1 text-muted-foreground text-xs">音频只在本机处理，不会上传到云端。</p>
        </div>
        <div className="flex items-center justify-between gap-4 px-5 py-5">
          <div>
            <p className="font-medium text-sm">启用语音输入</p>
            <p className="mt-1 text-muted-foreground text-xs">
              启用后可在 Chat 输入框中使用麦克风。
            </p>
          </div>
          <Switch
            checked={settings.enabled}
            onCheckedChange={(enabled) => update({ ...settings, enabled })}
          />
        </div>
      </section>
      <section className="mb-5 overflow-hidden rounded-lg border border-border bg-card">
        <div className="border-border border-b px-5 py-4">
          <h2 className="font-medium text-sm">模型设置</h2>
        </div>
        <div className="space-y-4 px-5 py-5">
          <div className="text-sm font-medium">
            当前模型
            <Select
              aria-label="当前模型"
              value={settings.modelId}
              onValueChange={(modelId) =>
                update({ ...settings, modelId: modelId as VoiceSettings["modelId"] })
              }
            >
              <SelectTrigger className="mt-2">
                <SelectValue placeholder="请选择已安装模型" />
              </SelectTrigger>
              <SelectContent>
                {installed
                  .filter((item) => item.installed)
                  .map((item) => (
                    <SelectItem key={item.id} value={item.id}>
                      {models.find((model) => model.id === item.id)?.label ?? item.id}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>
          <div className="text-sm font-medium">
            识别语言
            <Select
              aria-label="识别语言"
              value={settings.language}
              onValueChange={(language) => update({ ...settings, language })}
            >
              <SelectTrigger className="mt-2">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {languages.map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </section>
      <section className="overflow-hidden rounded-lg border border-border bg-card">
        <div className="border-border border-b px-5 py-4">
          <h2 className="font-medium text-sm">可用模型</h2>
          <p className="mt-1 text-muted-foreground text-xs">
            模型保存在 {modelsQuery.data?.directory ?? "~/.chatdesk/whisper"}。
          </p>
          <p className="mt-1 text-muted-foreground text-xs">
            首次使用前下载模型；下载过程中可以取消，未完成的文件会自动清理。
          </p>
        </div>
        <div className="divide-y divide-border">
          {models.map((model) => {
            const state = installed.find((item) => item.id === model.id);
            const busy = downloadMutation.isPending && downloadMutation.variables === model.id;
            return (
              <div className="flex items-center gap-4 px-5 py-4" key={model.id}>
                <Mic className="size-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-sm">
                    {model.label}{" "}
                    <span className="font-normal text-muted-foreground text-xs">
                      ({model.size})
                    </span>
                    {model.id === "large-v3-turbo" ? (
                      <Badge className="ml-2" variant="secondary">
                        推荐
                      </Badge>
                    ) : null}
                  </p>
                  <p className="mt-1 text-muted-foreground text-xs">{model.description}</p>
                  {busy ? (
                    <p className="mt-1 text-primary text-xs">
                      正在下载（可取消）{" "}
                      {progress[model.id] || state?.bytesDownloaded
                        ? `${Math.round((progress[model.id] ?? state?.bytesDownloaded ?? 0) / 1024 / 1024)} MB`
                        : "..."}
                    </p>
                  ) : null}
                </div>
                {state?.installed ? (
                  <>
                    <Badge variant="outline">
                      <Check className="mr-1 size-3" />
                      已安装
                    </Badge>
                    <Button
                      aria-label={`删除 ${model.label}`}
                      onClick={() => deleteMutation.mutate(model.id)}
                      size="icon"
                      title="删除模型"
                      variant="ghost"
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </>
                ) : (
                  <div className="flex items-center gap-2">
                    {busy ? (
                      <Button
                        aria-label={`取消下载 ${model.label}`}
                        disabled={cancelMutation.isPending}
                        onClick={() => {
                          setError("");
                          cancelMutation.mutate(model.id);
                        }}
                        size="sm"
                        title="取消下载"
                        variant="outline"
                      >
                        取消
                      </Button>
                    ) : (
                      <Button
                        disabled={!bridge}
                        onClick={() => {
                          setError("");
                          downloadMutation.mutate(model.id);
                        }}
                        size="sm"
                      >
                        <Download className="mr-1 size-4" />
                        下载
                      </Button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>
      {error ? <p className="mt-4 text-destructive text-xs">{error}</p> : null}
      {!bridge ? (
        <p className="mt-4 text-amber-600 text-xs">
          语音模型下载和本地转写仅支持 Electron 桌面版。
        </p>
      ) : null}
    </>
  );
}
