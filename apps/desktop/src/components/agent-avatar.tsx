import {
  AGENT_AVATAR_EMOJIS,
  AGENT_AVATAR_IMAGE_MAX_BYTES,
  encodeAgentAvatarEmoji,
  encodeAgentAvatarImage,
  encodeAgentAvatarText,
  parseAgentAvatar,
} from "@chatdesk/shared";
import { Bot, ImagePlus, Trash2, Upload } from "lucide-react";
import type * as React from "react";
import { type ChangeEvent, useEffect, useRef, useState } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

const IMAGE_SIZE = 256;

async function imageDataUrl(file: File) {
  if (!file.type.startsWith("image/")) throw new Error("请选择图片文件。");
  const sourceUrl = URL.createObjectURL(file);
  try {
    const image = new Image();
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("无法读取这张图片。"));
      image.src = sourceUrl;
    });
    const canvas = document.createElement("canvas");
    canvas.width = IMAGE_SIZE;
    canvas.height = IMAGE_SIZE;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("当前环境不支持图片处理。");
    const scale = Math.max(IMAGE_SIZE / image.width, IMAGE_SIZE / image.height);
    const width = image.width * scale;
    const height = image.height * scale;
    context.drawImage(image, (IMAGE_SIZE - width) / 2, (IMAGE_SIZE - height) / 2, width, height);
    for (const quality of [0.86, 0.72, 0.58, 0.45]) {
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/webp", quality),
      );
      if (!blob) continue;
      if (blob.size > AGENT_AVATAR_IMAGE_MAX_BYTES) continue;
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () =>
          typeof reader.result === "string" ? resolve(reader.result) : reject();
        reader.onerror = () => reject(new Error("无法读取处理后的图片。"));
        reader.readAsDataURL(blob);
      });
      const value = encodeAgentAvatarImage(dataUrl);
      if (value) return value;
    }
    throw new Error("图片压缩后仍超过 200 KB，请选择更简单的图片。");
  } finally {
    URL.revokeObjectURL(sourceUrl);
  }
}

export function AgentAvatar({
  value,
  fallback,
  className,
  fallbackClassName,
  ...props
}: {
  value?: string;
  fallback?: React.ReactNode;
  className?: string;
  fallbackClassName?: string;
} & Omit<React.ComponentProps<typeof Avatar>, "className">) {
  const avatar = parseAgentAvatar(value);
  return (
    <Avatar className={className} {...props}>
      {avatar.type === "image" ? <AvatarImage alt="" src={avatar.src} /> : null}
      <AvatarFallback className={fallbackClassName}>
        {avatar.type === "text" ? avatar.text : null}
        {avatar.type === "emoji" ? avatar.emoji : null}
        {avatar.type === "default"
          ? fallback || <Bot className="size-4 text-muted-foreground" />
          : null}
      </AvatarFallback>
    </Avatar>
  );
}

export function AgentAvatarPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);
  const avatar = parseAgentAvatar(draft);
  const inputRef = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState(
    avatar.type === "image" ? "image" : avatar.type === "text" ? "text" : "emoji",
  );
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) setDraft(value);
  }, [open, value]);

  function openPicker() {
    const next = parseAgentAvatar(value);
    setDraft(value);
    setMode(next.type === "image" ? "image" : next.type === "text" ? "text" : "emoji");
    setError("");
    setOpen(true);
  }

  async function upload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setError("");
    try {
      setDraft(await imageDataUrl(file));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "图片处理失败，请重试。");
    }
  }

  return (
    <>
      <Button
        aria-label="更改头像"
        className="flex h-auto min-h-16 w-full min-w-0 items-center justify-start gap-3 rounded-md border border-input bg-background px-3 py-8 text-left shadow-xs hover:bg-accent/40"
        onClick={openPicker}
        type="button"
        variant="ghost"
      >
        <AgentAvatar className="size-8 shrink-0" fallbackClassName="text-base" value={value} />
        <span className="min-w-0 truncate">
          <span className="block truncate text-sm font-medium">更改头像</span>
          <span className="mt-0.5 block truncate text-muted-foreground text-xs">
            图片、文字或 Emoji
          </span>
        </span>
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-sm" showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>选择头像</DialogTitle>
            <DialogDescription>选择后点击应用以更新 Agent 头像。</DialogDescription>
          </DialogHeader>
          <div className="flex items-center gap-3 border-border border-y py-4">
            <AgentAvatar className="size-16" fallbackClassName="text-xl" value={draft} />
            <div className="min-w-0">
              <p className="font-medium text-sm">头像预览</p>
              <p className="mt-1 text-muted-foreground text-xs">图片会自动裁切并压缩。</p>
            </div>
          </div>
          <Tabs onValueChange={setMode} value={mode}>
            <TabsList className="w-full" variant="line">
              <TabsTrigger value="image">图片</TabsTrigger>
              <TabsTrigger value="text">文字</TabsTrigger>
              <TabsTrigger value="emoji">Emoji</TabsTrigger>
            </TabsList>
            <TabsContent className="pt-3" value="image">
              <input
                accept="image/*"
                className="sr-only"
                onChange={(event) => void upload(event)}
                ref={inputRef}
                type="file"
              />
              <div className="flex items-center gap-2">
                <Button
                  onClick={() => inputRef.current?.click()}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  <Upload /> 上传图片
                </Button>
                {avatar.type === "image" ? (
                  <Button
                    aria-label="移除图片头像"
                    onClick={() => setDraft("")}
                    size="icon"
                    title="移除图片头像"
                    type="button"
                    variant="ghost"
                  >
                    <Trash2 className="size-4" />
                  </Button>
                ) : (
                  <ImagePlus className="size-4 text-muted-foreground" />
                )}
              </div>
            </TabsContent>
            <TabsContent className="pt-3" value="text">
              <Input
                aria-label="文字头像"
                maxLength={2}
                onChange={(event) =>
                  setDraft(
                    encodeAgentAvatarText(Array.from(event.target.value).slice(0, 2).join("")),
                  )
                }
                placeholder="最多 2 个字符"
                value={avatar.type === "text" ? avatar.text : ""}
              />
            </TabsContent>
            <TabsContent className="pt-3" value="emoji">
              <div className="grid grid-cols-5 gap-1.5">
                {AGENT_AVATAR_EMOJIS.map((emoji) => {
                  const selected = avatar.type === "emoji" && avatar.emoji === emoji;
                  return (
                    <Button
                      aria-label={`选择 ${emoji} 头像`}
                      aria-pressed={selected}
                      className={cn("text-lg", selected && "bg-accent text-foreground")}
                      key={emoji}
                      onClick={() => setDraft(encodeAgentAvatarEmoji(emoji))}
                      size="icon"
                      type="button"
                      variant="ghost"
                    >
                      {emoji}
                    </Button>
                  );
                })}
              </div>
            </TabsContent>
          </Tabs>
          {error ? <p className="text-destructive text-xs">{error}</p> : null}
          <DialogFooter>
            <Button onClick={() => setOpen(false)} type="button" variant="outline">
              取消
            </Button>
            <Button
              onClick={() => {
                onChange(draft);
                setOpen(false);
              }}
              type="button"
            >
              应用头像
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
