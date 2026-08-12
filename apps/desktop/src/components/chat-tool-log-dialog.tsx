import { getToolName, isToolUIPart, type UIMessage } from "ai";
import { Wrench } from "lucide-react";

import { ChatToolCallCard, type ChatToolCallCardProps } from "@/components/chat-tool-call-card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type ChatToolLogDialogProps = {
  open: boolean;
  messages: UIMessage[];
  onOpenChange: (open: boolean) => void;
};

type ChatToolPart = Extract<UIMessage["parts"][number], { toolCallId: string }>;

function toChatToolCall(part: ChatToolPart) {
  return {
    id: part.toolCallId,
    toolName: getToolName(part),
    state: part.state,
    input: part.input,
    output: "output" in part ? part.output : undefined,
    errorText: "errorText" in part ? part.errorText : undefined,
    approval: "approval" in part ? part.approval : undefined,
    preliminary: "preliminary" in part ? Boolean(part.preliminary) : false,
  } satisfies ChatToolCallCardProps;
}

export function ChatToolLogDialog({ open, messages, onOpenChange }: ChatToolLogDialogProps) {
  const calls = messages.flatMap((message) =>
    message.parts.filter(isToolUIPart).map((part) => ({
      call: toChatToolCall(part),
      key: `${message.id}-${part.toolCallId}`,
    })),
  );

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="flex h-[50vh] flex-col gap-0 overflow-hidden sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Tool 记录</DialogTitle>
          <DialogDescription>
            当前对话中的全部工具调用，包括普通执行、审批、Reviewer 处理和失败记录。
          </DialogDescription>
        </DialogHeader>
        <div className="mt-4 min-h-0 flex-1 overflow-y-auto pr-1">
          {calls.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-12 text-muted-foreground">
              <Wrench className="size-5" />
              <p className="text-xs">暂无 Tool 记录。</p>
            </div>
          ) : (
            <div className="chat-tool-log-list">
              {calls.map(({ call, key }) => (
                <article className="chat-tool-log-card" key={key}>
                  <ChatToolCallCard {...call} />
                </article>
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
