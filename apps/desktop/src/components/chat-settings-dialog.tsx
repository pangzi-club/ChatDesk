import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import type { ChatDisplaySettings, ChatLayout } from "@/lib/chat-settings";

type ChatSettingsDialogProps = {
  open: boolean;
  settings: ChatDisplaySettings;
  onOpenChange: (open: boolean) => void;
  onSettingsChange: (settings: ChatDisplaySettings) => void;
};

const layouts: Array<{ value: ChatLayout; label: string; description: string }> = [
  { value: "standard", label: "标准工作台", description: "平衡的消息阅读与工具操作。" },
  { value: "cute", label: "可爱模式", description: "柔和、圆润、轻量的聊天体验。" },
  { value: "geek", label: "Geek 文本", description: "等宽字体和高密度文本工作流。" },
];

export function ChatSettingsDialog({
  open,
  settings,
  onOpenChange,
  onSettingsChange,
}: ChatSettingsDialogProps) {
  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Chat 布局</DialogTitle>
          <DialogDescription>切换 Chat 主界面的组合方式，设置会自动保存。</DialogDescription>
        </DialogHeader>
        <RadioGroup
          className="divide-y divide-border rounded-md border border-border"
          onValueChange={(value) => onSettingsChange({ layout: value as ChatLayout })}
          value={settings.layout}
        >
          {layouts.map((item) => (
            <div className="flex items-center gap-3 px-3 py-3" key={item.value}>
              <RadioGroupItem id={`chat-layout-dialog-${item.value}`} value={item.value} />
              <Label
                className="min-w-0 cursor-pointer"
                htmlFor={`chat-layout-dialog-${item.value}`}
              >
                <span className="block font-medium text-sm">{item.label}</span>
                <span className="mt-0.5 block text-muted-foreground text-xs">
                  {item.description}
                </span>
              </Label>
            </div>
          ))}
        </RadioGroup>
      </DialogContent>
    </Dialog>
  );
}
