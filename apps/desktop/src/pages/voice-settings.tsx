import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Mic } from "lucide-react";
import { useEffect, useState } from "react";
import { Switch } from "@/components/ui/switch";
import {
  DEFAULT_VOICE_SETTINGS,
  loadVoiceSettings,
  saveVoiceSettings,
  type VoiceSettings,
} from "@/lib/voice-settings";

export function VoiceSettingsPage() {
  const client = useQueryClient();
  const settingsQuery = useQuery({ queryKey: ["voice-settings"], queryFn: loadVoiceSettings });
  const [settings, setSettings] = useState<VoiceSettings>(DEFAULT_VOICE_SETTINGS);

  useEffect(() => {
    if (settingsQuery.data) setSettings(settingsQuery.data);
  }, [settingsQuery.data]);

  const update = (enabled: boolean) => {
    const next = { enabled };
    setSettings(next);
    void saveVoiceSettings(next).then(() => {
      void client.invalidateQueries({ queryKey: ["voice-settings"] });
    });
  };

  return (
    <>
      <header className="mb-8">
        <p className="font-medium text-muted-foreground text-xs uppercase tracking-[0.16em]">
          Voice
        </p>
        <h1 className="mt-2 font-semibold text-3xl tracking-tight">语音</h1>
        <p className="mt-2 max-w-xl text-muted-foreground text-sm leading-6">
          通过语音 API 识别 Chat 输入。
        </p>
      </header>
      <section className="overflow-hidden rounded-lg border border-border bg-card">
        <div className="border-border border-b px-5 py-4">
          <h2 className="font-medium text-sm">语音输入</h2>
          <p className="mt-1 text-muted-foreground text-xs">启用后可在 Chat 输入框中使用麦克风。</p>
        </div>
        <div className="flex items-center justify-between gap-4 px-5 py-5">
          <div className="flex items-center gap-3">
            <Mic className="size-4 text-muted-foreground" />
            <div>
              <p className="font-medium text-sm">启用语音输入</p>
              <p className="mt-1 text-muted-foreground text-xs">
                识别服务由 ChatDesk 的语音 API 配置负责。
              </p>
            </div>
          </div>
          <Switch checked={settings.enabled} onCheckedChange={update} />
        </div>
      </section>
    </>
  );
}
