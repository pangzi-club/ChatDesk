import type { SystemPromptSnapshot } from "@chatdesk/shared";
import { useQuery } from "@tanstack/react-query";
import type { UIMessage } from "ai";
import { AlertCircle } from "lucide-react";
import { useMemo, useRef } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  CONTEXT_DETAIL_CATEGORIES,
  type ContextDetailCategory,
  createChatContextAnalyzer,
} from "@/lib/chat-context-detail";
import { loadChatServerSystemPromptPreview } from "@/lib/chat-server";
import type { ContextDetailPromptInput } from "@/lib/context-detail-events";

type ChatContextDetailProps = {
  messages: UIMessage[];
  promptInput: ContextDetailPromptInput;
  sessionId: string;
  systemPrompt?: SystemPromptSnapshot;
};

function formatTokens(value: number) {
  return `${value.toLocaleString("zh-CN")} tokens`;
}

function categoryLabel(category: ContextDetailCategory) {
  return CONTEXT_DETAIL_CATEGORIES.find((item) => item.category === category)?.label ?? category;
}

export function ChatContextDetail({
  messages,
  promptInput,
  sessionId,
  systemPrompt,
}: ChatContextDetailProps) {
  const analyzerRef = useRef<{
    sessionId: string;
    analyze: ReturnType<typeof createChatContextAnalyzer>;
  } | null>(null);
  if (!analyzerRef.current || analyzerRef.current.sessionId !== sessionId) {
    analyzerRef.current = { sessionId, analyze: createChatContextAnalyzer() };
  }
  const analyzeContext = analyzerRef.current.analyze;
  const promptKey = JSON.stringify(promptInput);
  const promptQuery = useQuery({
    queryKey: ["chat-context-detail-prompt", sessionId, promptKey, systemPrompt?.text],
    queryFn: () => systemPrompt ?? loadChatServerSystemPromptPreview(sessionId, promptInput),
  });
  const analysis = useMemo(
    () => analyzeContext(promptQuery.data?.text, messages),
    [analyzeContext, messages, promptQuery.data?.text],
  );

  if (promptQuery.isPending) {
    return (
      <div aria-label="正在加载上下文详情" className="chat-context-detail" role="status">
        <div className="chat-context-detail-heading-skeleton" />
        <div className="chat-context-detail-bar-skeleton" />
        <div className="chat-context-detail-legend-skeleton">
          <span />
          <span />
          <span />
          <span />
        </div>
      </div>
    );
  }

  return (
    <div className="chat-context-detail">
      <header className="chat-context-detail-heading">
        <div>
          <h2>当前上下文</h2>
          <p>按发送顺序估算</p>
        </div>
        <strong>{formatTokens(analysis.totalEstimatedTokens)}</strong>
      </header>

      {promptQuery.isError ? (
        <div className="chat-context-detail-notice" role="alert">
          <AlertCircle className="size-3.5" />
          <span>System Prompt 加载失败，当前仅统计会话消息。</span>
        </div>
      ) : null}

      {analysis.segments.length > 0 ? (
        <>
          <fieldset
            aria-label={`上下文组成，共估算 ${formatTokens(analysis.totalEstimatedTokens)}`}
            className="chat-context-detail-bar"
          >
            {analysis.segments.map((segment) => {
              const label = categoryLabel(segment.category);
              const percentLabel = `${segment.percent.toFixed(segment.percent < 1 ? 1 : 0)}%`;
              return (
                <Tooltip key={segment.id} delayDuration={120}>
                  <TooltipTrigger asChild>
                    <button
                      aria-label={`${label}，估算 ${formatTokens(segment.estimatedTokens)}，占 ${percentLabel}`}
                      className={`chat-context-detail-segment is-${segment.category}`}
                      style={{ flexGrow: segment.estimatedTokens }}
                      type="button"
                    />
                  </TooltipTrigger>
                  <TooltipContent className="max-w-64" side="bottom" sideOffset={8}>
                    <div className="chat-context-detail-tooltip">
                      <span>
                        {label} · {formatTokens(segment.estimatedTokens)} · {percentLabel}
                      </span>
                      <p>{segment.preview}</p>
                    </div>
                  </TooltipContent>
                </Tooltip>
              );
            })}
          </fieldset>

          <ul aria-label="上下文类型图例" className="chat-context-detail-legend">
            {analysis.summaries.map((summary) => (
              <li className="chat-context-detail-legend-item" key={summary.category}>
                <span
                  aria-hidden="true"
                  className={`chat-context-detail-swatch is-${summary.category}`}
                />
                <span>{categoryLabel(summary.category)}</span>
                <strong>{summary.estimatedTokens.toLocaleString("zh-CN")}</strong>
                <small>{Math.round(summary.percent)}%</small>
              </li>
            ))}
          </ul>

          <p className="chat-context-detail-footnote">
            Token 数量按内容长度估算，可能与模型提供商的实际计数不同。
          </p>
        </>
      ) : (
        <div className="chat-context-detail-empty">
          <p>暂无可估算的上下文</p>
          <span>发送消息或启用 System Prompt 后将在这里显示组成。</span>
        </div>
      )}
    </div>
  );
}
