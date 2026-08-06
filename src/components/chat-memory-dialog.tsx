import { Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import type { ChatMemoryItem, ChatMemoryStore } from "@/lib/chat-memory";

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
  const [draft, setDraft] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingContent, setEditingContent] = useState("");
  const [itemToDelete, setItemToDelete] = useState<ChatMemoryItem | null>(null);

  function updateStore(next: ChatMemoryStore) {
    onStoreChange(next);
  }

  function handleEnabledChange(enabled: boolean) {
    updateStore({ ...store, enabled });
  }

  function handleAdd() {
    const content = draft.trim();
    if (!content) return;
    const now = new Date().toISOString();
    updateStore({
      ...store,
      items: [
        {
          id: crypto.randomUUID(),
          content,
          createdAt: now,
          updatedAt: now,
        },
        ...store.items,
      ],
    });
    setDraft("");
  }

  function startEdit(item: ChatMemoryItem) {
    setEditingId(item.id);
    setEditingContent(item.content);
  }

  function saveEdit() {
    if (!editingId) return;
    const content = editingContent.trim();
    if (!content) return;
    const now = new Date().toISOString();
    updateStore({
      ...store,
      items: store.items.map((item) =>
        item.id === editingId ? { ...item, content, updatedAt: now } : item,
      ),
    });
    setEditingId(null);
    setEditingContent("");
  }

  function confirmDelete() {
    if (!itemToDelete) return;
    updateStore({
      ...store,
      items: store.items.filter((item) => item.id !== itemToDelete.id),
    });
    if (editingId === itemToDelete.id) {
      setEditingId(null);
      setEditingContent("");
    }
    setItemToDelete(null);
  }

  return (
    <>
      <Dialog onOpenChange={onOpenChange} open={open}>
        <DialogContent className="flex max-h-[85vh] flex-col gap-0 overflow-hidden sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>长期记忆</DialogTitle>
            <DialogDescription>
              全局共享的用户记忆，开启后会自动抽取并在后续对话中使用。
            </DialogDescription>
          </DialogHeader>

          <div className="mt-4 flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2.5">
            <div className="space-y-0.5">
              <Label className="font-medium text-sm" htmlFor="chat-memory-enabled">
                启用记忆
              </Label>
              <p className="text-muted-foreground text-xs">
                关闭后不再注入与自动抽取，已有记忆仍可查看管理
              </p>
            </div>
            <Switch
              checked={store.enabled}
              id="chat-memory-enabled"
              onCheckedChange={handleEnabledChange}
            />
          </div>

          <div className="mt-4 space-y-2">
            <Label className="font-medium text-sm" htmlFor="chat-memory-draft">
              添加记忆
            </Label>
            <div className="flex gap-2">
              <Textarea
                id="chat-memory-draft"
                placeholder="例如：用户偏好简洁中文回复"
                rows={2}
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
              />
              <Button
                aria-label="添加记忆"
                className="shrink-0 self-end"
                disabled={!draft.trim()}
                size="icon"
                type="button"
                onClick={handleAdd}
              >
                <Plus className="size-4" />
              </Button>
            </div>
          </div>

          <div className="mt-4 flex min-h-0 flex-1 flex-col gap-2">
            <div className="flex items-center justify-between">
              <Label className="font-medium text-sm">当前记忆</Label>
              <span className="text-muted-foreground text-xs">{store.items.length} 条</span>
            </div>
            <div className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
              {store.items.length === 0 && (
                <p className="rounded-md border border-border border-dashed px-3 py-8 text-center text-muted-foreground text-sm">
                  暂无记忆。开启后对话中会自动抽取，也可手动添加。
                </p>
              )}
              {store.items.map((item) => (
                <div className="rounded-md border border-border px-3 py-2.5" key={item.id}>
                  {editingId === item.id ? (
                    <div className="space-y-2">
                      <Textarea
                        rows={3}
                        value={editingContent}
                        onChange={(event) => setEditingContent(event.target.value)}
                      />
                      <div className="flex justify-end gap-2">
                        <Button
                          size="sm"
                          type="button"
                          variant="ghost"
                          onClick={() => {
                            setEditingId(null);
                            setEditingContent("");
                          }}
                        >
                          取消
                        </Button>
                        <Button
                          disabled={!editingContent.trim()}
                          size="sm"
                          type="button"
                          onClick={saveEdit}
                        >
                          保存
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <p className="min-w-0 flex-1 text-sm leading-relaxed">{item.content}</p>
                      <div className="flex shrink-0 gap-1">
                        <Button
                          aria-label="编辑记忆"
                          size="icon"
                          type="button"
                          variant="ghost"
                          onClick={() => startEdit(item)}
                        >
                          <Pencil className="size-3.5" />
                        </Button>
                        <Button
                          aria-label="删除记忆"
                          size="icon"
                          type="button"
                          variant="ghost"
                          onClick={() => setItemToDelete(item)}
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={itemToDelete !== null}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) setItemToDelete(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除这条记忆？</AlertDialogTitle>
            <AlertDialogDescription>
              确定要删除“{itemToDelete?.content ?? "这条记忆"}”吗？删除后无法恢复。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={confirmDelete}>
              删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
