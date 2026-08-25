import { LoaderCircle, Sparkles } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type ChatTitleDialogProps = {
  open: boolean;
  title: string;
  canGenerate: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (title: string) => Promise<void>;
  onGenerate: () => Promise<void>;
};

export function ChatTitleDialog({
  open,
  title,
  canGenerate,
  onOpenChange,
  onSave,
  onGenerate,
}: ChatTitleDialogProps) {
  const [draft, setDraft] = useState(title);
  const [pendingAction, setPendingAction] = useState<"save" | "generate" | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    setDraft(title);
    setError("");
  }, [open, title]);

  const pending = pendingAction !== null;
  const normalizedDraft = draft.trim();

  async function run(action: "save" | "generate", callback: () => Promise<void>) {
    if (pending) return;
    setError("");
    setPendingAction(action);
    try {
      await callback();
      onOpenChange(false);
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : String(actionError));
    } finally {
      setPendingAction(null);
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!normalizedDraft) {
      setError("请输入标题");
      return;
    }
    void run("save", () => onSave(normalizedDraft));
  }

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !pending && onOpenChange(nextOpen)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>编辑对话标题</DialogTitle>
          <DialogDescription>输入一个标题，或根据当前对话自动生成。</DialogDescription>
        </DialogHeader>
        <form className="grid gap-4" onSubmit={handleSubmit}>
          <div className="grid gap-2">
            <Label htmlFor="chat-title-input">标题</Label>
            <Input
              autoFocus
              disabled={pending}
              id="chat-title-input"
              maxLength={120}
              onChange={(event) => setDraft(event.target.value)}
              value={draft}
            />
            {error ? <p className="text-destructive text-sm">{error}</p> : null}
          </div>
          <DialogFooter>
            <Button
              disabled={!canGenerate || pending}
              onClick={() => void run("generate", onGenerate)}
              type="button"
              variant="outline"
            >
              {pendingAction === "generate" ? (
                <LoaderCircle className="animate-spin" />
              ) : (
                <Sparkles />
              )}
              {pendingAction === "generate" ? "生成中..." : "自动生成"}
            </Button>
            <Button disabled={!normalizedDraft || pending} type="submit">
              {pendingAction === "save" ? <LoaderCircle className="animate-spin" /> : null}
              {pendingAction === "save" ? "保存中..." : "保存"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
