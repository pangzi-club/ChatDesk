import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import type { ChatDisplaySettings, ChatFontSize, ChatSpacing } from "@/lib/chat-settings";

const fontSizeOptions: Array<{ value: ChatFontSize; label: string }> = [
  { value: "large", label: "大" },
  { value: "default", label: "默认" },
  { value: "small", label: "小" },
];

const spacingOptions: Array<{ value: ChatSpacing; label: string }> = [
  { value: "loose", label: "宽松" },
  { value: "default", label: "默认" },
  { value: "compact", label: "紧密" },
];

type ChatSettingsDialogProps = {
  open: boolean;
  settings: ChatDisplaySettings;
  onOpenChange: (open: boolean) => void;
  onSettingsChange: (settings: ChatDisplaySettings) => void;
};

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
          <DialogTitle>Chat 显示设置</DialogTitle>
          <DialogDescription>调整消息字体大小与页面间距，设置会自动保存。</DialogDescription>
        </DialogHeader>
        <div className="space-y-6">
          <section className="space-y-3">
            <Label className="font-medium text-sm">字体大小</Label>
            <RadioGroup
              className="grid grid-cols-3 gap-2"
              onValueChange={(value) =>
                onSettingsChange({ ...settings, fontSize: value as ChatFontSize })
              }
              value={settings.fontSize}
            >
              {fontSizeOptions.map((option) => (
                <div key={option.value}>
                  <RadioGroupItem
                    className="peer sr-only"
                    id={`chat-font-size-${option.value}`}
                    value={option.value}
                  />
                  <Label
                    className="flex cursor-pointer items-center justify-center rounded-md border border-border px-3 py-2 text-sm transition-colors peer-data-[state=checked]:border-primary peer-data-[state=checked]:bg-primary/10 peer-data-[state=checked]:text-primary"
                    htmlFor={`chat-font-size-${option.value}`}
                  >
                    {option.label}
                  </Label>
                </div>
              ))}
            </RadioGroup>
          </section>
          <section className="space-y-3">
            <Label className="font-medium text-sm">间距</Label>
            <RadioGroup
              className="grid grid-cols-3 gap-2"
              onValueChange={(value) =>
                onSettingsChange({ ...settings, spacing: value as ChatSpacing })
              }
              value={settings.spacing}
            >
              {spacingOptions.map((option) => (
                <div key={option.value}>
                  <RadioGroupItem
                    className="peer sr-only"
                    id={`chat-spacing-${option.value}`}
                    value={option.value}
                  />
                  <Label
                    className="flex cursor-pointer items-center justify-center rounded-md border border-border px-3 py-2 text-sm transition-colors peer-data-[state=checked]:border-primary peer-data-[state=checked]:bg-primary/10 peer-data-[state=checked]:text-primary"
                    htmlFor={`chat-spacing-${option.value}`}
                  >
                    {option.label}
                  </Label>
                </div>
              ))}
            </RadioGroup>
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}
