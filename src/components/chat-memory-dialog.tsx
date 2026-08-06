import { ChatMemorySettings } from "@/components/chat-memory-settings";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { ChatMemoryStore } from "@/lib/chat-memory";

type ChatMemoryDialogProps = {
  open: boolean;
  store: ChatMemoryStore;
  onOpenChange: (open: boolean) => void;
  onStoreChange: (store: ChatMemoryStore) => void;
};

export function ChatMemoryDialog({
  open,
  store,
  onOpenChange,
  onStoreChange,
}: ChatMemoryDialogProps) {
  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="flex max-h-[85vh] flex-col gap-0 overflow-hidden sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>长期记忆</DialogTitle>
          <DialogDescription>
            全局共享的用户记忆，开启后会自动抽取并在后续对话中使用。
          </DialogDescription>
        </DialogHeader>

        <div className="mt-4 flex min-h-0 flex-1 flex-col gap-4 overflow-hidden">
          <ChatMemorySettings store={store} onStoreChange={onStoreChange} />
        </div>
      </DialogContent>
    </Dialog>
  );
}
