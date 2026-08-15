import { resolveContextCompactionThreshold, resolveModelContextWindow } from "@chatdesk/shared";
import { Gauge } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Progress } from "@/components/ui/progress";

type ChatContextPopoverProps = {
  inputContext?: number;
  inputTokens?: number;
  isEstimated?: boolean;
  isGenerating: boolean;
  modelName?: string;
};

function formatContextCount(value: number | undefined) {
  if (value === undefined) return "暂无测量";
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toLocaleString("zh-CN", { maximumFractionDigits: 1 })}M`;
  }
  if (value >= 1_000) {
    return `${(value / 1_000).toLocaleString("zh-CN", { maximumFractionDigits: 1 })}K`;
  }
  return value.toLocaleString("zh-CN");
}

function formatExactContextCount(value: number | undefined) {
  return value === undefined ? "暂无测量" : `${value.toLocaleString("zh-CN")} tokens`;
}

export function ChatContextPopover({
  inputContext,
  inputTokens,
  isEstimated = false,
  isGenerating,
  modelName,
}: ChatContextPopoverProps) {
  const contextWindow = resolveModelContextWindow(inputContext);
  const compactionThreshold = resolveContextCompactionThreshold(inputContext);
  const usesDefaultWindow =
    inputContext === undefined || !Number.isFinite(inputContext) || inputContext <= 0;
  const usagePercent =
    inputTokens === undefined
      ? undefined
      : Math.min(100, Math.max(0, (inputTokens / contextWindow) * 100));
  const title = `当前上下文：${formatContextCount(inputTokens)} / ${formatContextCount(contextWindow)} · 自动压缩阈值 ${formatContextCount(compactionThreshold)}`;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          aria-label="查看当前上下文"
          className="chat-tool-button !size-7"
          size="icon"
          title={title}
          type="button"
          variant="ghost"
        >
          <Gauge className="size-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 p-0" side="top" sideOffset={8}>
        <div className="border-border border-b px-4 py-3">
          <div className="flex items-center justify-between gap-3">
            <span className="font-medium text-sm">当前上下文</span>
            <span className="font-mono text-muted-foreground text-xs">
              {usagePercent === undefined ? "暂无测量" : `${Math.round(usagePercent)}%`}
            </span>
          </div>
          <Progress className="mt-3" value={usagePercent ?? 0} />
        </div>
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2.5 px-4 py-3 text-xs">
          <dt className="text-muted-foreground">当前输入</dt>
          <dd className="truncate text-right font-mono">
            {formatExactContextCount(inputTokens)}
            {inputTokens !== undefined && isEstimated ? "（估算）" : ""}
          </dd>
          <dt className="text-muted-foreground">模型窗口</dt>
          <dd className="truncate text-right font-mono">
            {formatExactContextCount(contextWindow)}
            {usesDefaultWindow ? "（默认）" : ""}
          </dd>
          <dt className="text-muted-foreground">自动压缩</dt>
          <dd className="truncate text-right font-mono">
            {formatExactContextCount(compactionThreshold)}
          </dd>
          <dt className="text-muted-foreground">模型</dt>
          <dd className="truncate text-right" title={modelName}>
            {modelName ?? "未配置模型"}
          </dd>
        </dl>
        <p className="border-border border-t px-4 py-2.5 text-muted-foreground text-[11px] leading-4">
          {isGenerating
            ? "本轮仍在生成，完成后更新实际输入用量。"
            : inputTokens === undefined
              ? "完成一次模型请求后显示实际输入用量。"
              : isEstimated
                ? "压缩后估算值；下一次模型请求完成后更新为实际用量。"
                : "输入用量来自最近一次已完成的模型请求。"}
        </p>
      </PopoverContent>
    </Popover>
  );
}
