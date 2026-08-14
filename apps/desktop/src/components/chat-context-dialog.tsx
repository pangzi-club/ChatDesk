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
import type { SystemPromptPreview } from "@/lib/chat-server";

type ChatContextDialogProps = {
  open: boolean;
  sessionId: string;
  promptKey: string;
  loadPrompt: () => Promise<SystemPromptPreview>;
  onOpenChange: (open: boolean) => void;
};

export function ChatContextDialog({
  open,
  sessionId,
  promptKey,
  loadPrompt,
  onOpenChange,
}: ChatContextDialogProps) {
  const [copied, setCopied] = useState(false);
  const promptQuery = useQuery<SystemPromptPreview>({
    queryKey: ["chat-system-prompt", sessionId, promptKey],
    queryFn: loadPrompt,
    enabled: open,
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
          <DialogTitle>System Prompt</DialogTitle>
          <DialogDescription>查看当前发送给模型的 System Prompt 及其来源。</DialogDescription>
        </DialogHeader>
        <div className="mt-4 min-h-0 space-y-4 overflow-y-auto pr-1">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="font-medium text-sm">当前 System Prompt</p>
              <p className="text-muted-foreground text-xs">
                {promptQuery.data?.cwd ? `Workspace：${promptQuery.data.cwd}` : "未选择 workspace"}
              </p>
            </div>
            <button
              className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs hover:bg-muted disabled:opacity-50"
              disabled={!promptQuery.data?.text}
              onClick={() => void copyPrompt()}
              type="button"
            >
              {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
              {copied ? "已复制" : "复制完整 Prompt"}
            </button>
          </div>
          {promptQuery.isPending ? (
            <div className="flex min-h-48 items-center justify-center rounded-md border border-border text-muted-foreground text-sm">
              <LoaderCircle className="mr-2 size-4 animate-spin" />
              正在加载 System Prompt
            </div>
          ) : promptQuery.isError ? (
            <div className="rounded-md border border-destructive/40 bg-destructive/5 p-4 text-destructive text-sm">
              无法加载 System Prompt：
              {promptQuery.error instanceof Error ? promptQuery.error.message : "未知错误"}
            </div>
          ) : (
            <>
              <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-md border border-border bg-muted/30 p-3 font-mono text-xs leading-5">
                {promptQuery.data?.text || "当前没有启用的 System Prompt。"}
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
      </DialogContent>
    </Dialog>
  );
}
