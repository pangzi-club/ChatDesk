import { resolveContextCompactionThreshold, resolveModelContextWindow } from "@chatdesk/shared";
import { useQuery } from "@tanstack/react-query";
import { Check, Clipboard, Copy, LoaderCircle } from "lucide-react";
import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { SystemPromptPreview } from "@/lib/chat-server";
import type { TokenUsage } from "@/lib/chat-usage";
import type { ModelConfig } from "@/lib/models";

type ChatContextDialogProps = {
  open: boolean;
  model: ModelConfig | undefined;
  messageCount: number;
  latestUsage: TokenUsage | undefined;
  isGenerating: boolean;
  sessionId: string;
  promptKey: string;
  loadPrompt: () => Promise<SystemPromptPreview>;
  onOpenChange: (open: boolean) => void;
};

function formatTokenCount(value: number | undefined) {
  return value === undefined ? "暂无测量" : `${value.toLocaleString("zh-CN")} tokens`;
}

function formatContextLimit(value: number | undefined) {
  if (value === undefined) return "未配置";
  if (value >= 1_000_000) return `${(value / 1_000_000).toLocaleString("zh-CN")}M`;
  if (value >= 1_000) return `${(value / 1_000).toLocaleString("zh-CN")}K`;
  return value.toLocaleString("zh-CN");
}

export function ChatContextDialog({
  open,
  model,
  messageCount,
  latestUsage,
  isGenerating,
  sessionId,
  promptKey,
  loadPrompt,
  onOpenChange,
}: ChatContextDialogProps) {
  const [tab, setTab] = useState("usage");
  const [copied, setCopied] = useState(false);
  const usedTokens = latestUsage?.inputTokens;
  const configuredContextLimit = model?.inputContext;
  const contextLimit = resolveModelContextWindow(configuredContextLimit);
  const compactionThreshold = resolveContextCompactionThreshold(configuredContextLimit);
  const usesDefaultContextLimit =
    configuredContextLimit === undefined ||
    !Number.isFinite(configuredContextLimit) ||
    configuredContextLimit <= 0;
  const usagePercent =
    usedTokens !== undefined && contextLimit
      ? Math.min(100, Math.max(0, (usedTokens / contextLimit) * 100))
      : undefined;
  const promptQuery = useQuery<SystemPromptPreview>({
    queryKey: ["chat-system-prompt", sessionId, promptKey],
    queryFn: loadPrompt,
    enabled: open && tab === "prompt",
    staleTime: 0,
  });

  async function copyPrompt() {
    const text = promptQuery.data?.text;
    if (!text) return;
    await navigator.clipboard.writeText(text);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="flex max-h-[85vh] flex-col gap-0 overflow-hidden sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>上下文</DialogTitle>
          <DialogDescription>
            查看最近一次上下文用量，或预览当前将发送给模型的 system prompt。
          </DialogDescription>
        </DialogHeader>
        <Tabs className="mt-4 min-h-0" onValueChange={setTab} value={tab}>
          <TabsList className="w-full">
            <TabsTrigger value="usage">上下文用量</TabsTrigger>
            <TabsTrigger value="prompt">System Prompt</TabsTrigger>
          </TabsList>
          <TabsContent className="min-h-0 overflow-y-auto pr-1" value="usage">
            <div className="space-y-5">
              <section className="rounded-md border border-border p-4">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="font-medium text-sm">当前使用</span>
                  <span className="font-mono text-muted-foreground text-xs">
                    {formatTokenCount(usedTokens)}
                  </span>
                </div>
                <div className="mt-3">
                  {usagePercent !== undefined ? (
                    <Progress aria-label="上下文窗口使用比例" value={usagePercent} />
                  ) : (
                    <div className="h-2 rounded-full bg-primary/15" />
                  )}
                </div>
                <div className="mt-2 flex items-center justify-between gap-3 text-muted-foreground text-xs">
                  <span>
                    模型窗口 {formatContextLimit(contextLimit)}
                    {usesDefaultContextLimit ? "（默认）" : ""}
                  </span>
                  <span>
                    {usagePercent === undefined ? "无法计算比例" : `${Math.round(usagePercent)}%`}
                  </span>
                </div>
              </section>
              <dl className="grid grid-cols-2 gap-x-5 gap-y-4 text-sm">
                <div>
                  <dt className="text-muted-foreground text-xs">模型</dt>
                  <dd className="mt-1 truncate font-medium" title={model?.name}>
                    {model?.name ?? "未配置模型"}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground text-xs">对话消息</dt>
                  <dd className="mt-1 font-medium">{messageCount.toLocaleString("zh-CN")} 条</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground text-xs">最近一次输出</dt>
                  <dd className="mt-1 font-mono text-xs">
                    {formatTokenCount(latestUsage?.outputTokens)}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground text-xs">缓存读取</dt>
                  <dd className="mt-1 font-mono text-xs">
                    {formatTokenCount(latestUsage?.cacheReadTokens)}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground text-xs">自动压缩阈值</dt>
                  <dd className="mt-1 font-mono text-xs">
                    {formatContextLimit(compactionThreshold)}
                  </dd>
                </div>
              </dl>
              <p className="border-border border-t pt-4 text-muted-foreground text-xs leading-5">
                {isGenerating
                  ? "本轮仍在生成，模型返回用量后会更新。"
                  : usedTokens === undefined
                    ? "完成一次模型请求后，这里会显示实际测得的上下文用量。"
                    : "当前用量以最近一次已完成请求的输入 tokens 为准，包含系统提示、工具定义和对话历史。"}
              </p>
              <p className="-mt-3 text-muted-foreground text-xs leading-5">
                {usesDefaultContextLimit
                  ? "当前模型未声明输入上限，ChatDesk 按默认 128K 窗口计算；该值不是供应商声明。"
                  : "自动压缩阈值由模型窗口计算，达到阈值后会清理旧推理与工具结果。"}
              </p>
            </div>
          </TabsContent>
          <TabsContent className="min-h-0 overflow-y-auto pr-1" value="prompt">
            <div className="space-y-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="font-medium text-sm">当前 system prompt</p>
                  <p className="text-muted-foreground text-xs">
                    {promptQuery.data?.cwd
                      ? `Workspace：${promptQuery.data.cwd}`
                      : "未选择 workspace"}
                  </p>
                </div>
                <button
                  className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs hover:bg-muted disabled:opacity-50"
                  disabled={!promptQuery.data?.text}
                  onClick={() => void copyPrompt()}
                  type="button"
                >
                  {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                  {copied ? "已复制" : "复制完整 prompt"}
                </button>
              </div>
              {promptQuery.isPending ? (
                <div className="flex min-h-48 items-center justify-center rounded-md border border-border text-muted-foreground text-sm">
                  <LoaderCircle className="mr-2 size-4 animate-spin" />
                  正在加载 system prompt
                </div>
              ) : promptQuery.isError ? (
                <div className="rounded-md border border-destructive/40 bg-destructive/5 p-4 text-destructive text-sm">
                  无法加载 system prompt：
                  {promptQuery.error instanceof Error ? promptQuery.error.message : "未知错误"}
                </div>
              ) : (
                <>
                  <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-md border border-border bg-muted/30 p-3 font-mono text-xs leading-5">
                    {promptQuery.data?.text || "当前没有启用的 system context。"}
                  </pre>
                  <div className="space-y-2">
                    {promptQuery.data?.sections.map((section) => (
                      <details className="rounded-md border border-border" key={section.id}>
                        <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-sm">
                          <Clipboard className="size-3.5 text-muted-foreground" />
                          <span className="font-medium">{section.label}</span>
                          <span className="text-muted-foreground text-xs">
                            {section.included ? "已注入" : "未启用"}
                          </span>
                        </summary>
                        {section.included ? (
                          <div className="border-border border-t px-3 py-2">
                            {section.path ? (
                              <p className="mb-2 break-all font-mono text-[11px] text-muted-foreground">
                                {section.path}
                              </p>
                            ) : null}
                            <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words font-mono text-xs leading-5">
                              {section.content}
                            </pre>
                          </div>
                        ) : null}
                      </details>
                    ))}
                  </div>
                </>
              )}
            </div>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
