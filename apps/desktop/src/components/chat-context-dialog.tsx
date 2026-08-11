import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import type { TokenUsage } from "@/lib/chat-usage";
import type { ModelConfig } from "@/lib/models";

type ChatContextDialogProps = {
  open: boolean;
  model: ModelConfig | undefined;
  messageCount: number;
  latestUsage: TokenUsage | undefined;
  isGenerating: boolean;
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
  onOpenChange,
}: ChatContextDialogProps) {
  const usedTokens = latestUsage?.inputTokens;
  const contextLimit = model?.inputContext;
  const usagePercent =
    usedTokens !== undefined && contextLimit
      ? Math.min(100, Math.max(0, (usedTokens / contextLimit) * 100))
      : undefined;

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>上下文用量</DialogTitle>
          <DialogDescription>
            显示最近一次模型请求测得的输入上下文，以及当前模型的窗口上限。
          </DialogDescription>
        </DialogHeader>

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
              <span>模型窗口 {formatContextLimit(contextLimit)}</span>
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
          </dl>

          <p className="border-border border-t pt-4 text-muted-foreground text-xs leading-5">
            {isGenerating
              ? "本轮仍在生成，模型返回用量后会更新。"
              : usedTokens === undefined
                ? "完成一次模型请求后，这里会显示实际测得的上下文用量。"
                : "当前用量以最近一次已完成请求的输入 tokens 为准，包含系统提示、工具定义和对话历史。"}
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
