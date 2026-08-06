import { useQueries } from "@tanstack/react-query";
import { Link } from "react-router-dom";

import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  CHAT_TOOL_PACKS,
  type ChatToolPackId,
  type ChatToolsSettings as ChatToolsSettingsValue,
} from "@/lib/chat-tools";
import { loadCommitApiKey } from "@/lib/commit";
import { loadDataerApiKey } from "@/lib/dataer";
import { loadKieApiKey } from "@/lib/image-generation";
import { loadLookerApiKey } from "@/lib/looker";

type ChatToolsSettingsProps = {
  settings: ChatToolsSettingsValue;
  onSettingsChange: (settings: ChatToolsSettingsValue) => void;
  modelSupportsTools?: boolean;
  modelResponsive?: boolean;
  idPrefix?: string;
};

async function loadPackHasKey(pack: ChatToolPackId): Promise<boolean> {
  if (pack === "analytics") return Boolean((await loadDataerApiKey()).trim());
  if (pack === "commit") return Boolean((await loadCommitApiKey()).trim());
  if (pack === "looker") return Boolean((await loadLookerApiKey()).trim());
  if (pack === "image_generation") return Boolean((await loadKieApiKey()).trim());
  return true;
}

export function ChatToolsSettings({
  settings,
  onSettingsChange,
  modelSupportsTools = true,
  modelResponsive,
  idPrefix = "chat-tools",
}: ChatToolsSettingsProps) {
  const keyQueries = useQueries({
    queries: CHAT_TOOL_PACKS.map((pack) => ({
      queryKey: ["chat-tool-pack-key", pack.id],
      queryFn: () => loadPackHasKey(pack.id),
    })),
  });

  function handleToggle(id: ChatToolPackId, enabled: boolean) {
    onSettingsChange({ ...settings, [id]: enabled });
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-muted-foreground text-sm leading-6">
        启用后直接在 Chat 里用自然语言提问即可，模型会自动调用对应工具。
      </p>

      {!modelSupportsTools ? (
        <p className="rounded-md border border-border bg-accent/40 px-3 py-2 text-muted-foreground text-xs">
          当前所选模型未开启「支持 Tools」。即使打开下方开关，也不会向模型注册这些工具。请到{" "}
          <Link className="underline underline-offset-2" to="/settings/models">
            模型设置
          </Link>{" "}
          中开启。
        </p>
      ) : null}

      <div className="divide-y divide-border rounded-lg border border-border">
        {CHAT_TOOL_PACKS.map((pack, index) => {
          const hasKey = !pack.keyLabel || keyQueries[index]?.data === true;
          const switchId = `${idPrefix}-${pack.id}`;
          const needsResponsive = pack.requiresResponsive === true;
          return (
            <div className="space-y-3 px-4 py-4" key={pack.id}>
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 space-y-1">
                  <Label className="font-medium text-sm" htmlFor={switchId}>
                    {pack.label}
                  </Label>
                  <p className="text-muted-foreground text-xs leading-5">{pack.description}</p>
                </div>
                <Switch
                  aria-label={`启用 ${pack.label}`}
                  checked={settings[pack.id]}
                  id={switchId}
                  onCheckedChange={(checked) => handleToggle(pack.id, checked === true)}
                />
              </div>

              {settings[pack.id] && pack.keyLabel && !hasKey ? (
                <p className="text-amber-700 text-xs dark:text-amber-300">
                  未配置 {pack.keyLabel}，当前不会对模型启用。请先到{" "}
                  <Link
                    className="underline underline-offset-2"
                    to={pack.keysPath ?? "/settings/keys"}
                  >
                    API Keys
                  </Link>{" "}
                  配置。
                </p>
              ) : null}

              {settings[pack.id] && needsResponsive ? (
                modelResponsive === false ? (
                  <p className="text-amber-700 text-xs dark:text-amber-300">
                    需要模型开启 Responses API，当前不会对模型启用。请到{" "}
                    <Link className="underline underline-offset-2" to="/settings/models">
                      模型设置
                    </Link>{" "}
                    中打开「Responses」。
                  </p>
                ) : (
                  <p className="text-muted-foreground text-xs">
                    仅在模型开启 Responses API 时注册（OpenAI 兼容内置工具）。
                  </p>
                )
              ) : null}

              <div className="space-y-1.5">
                <p className="text-muted-foreground text-[11px] uppercase tracking-wide">
                  试试这样问
                </p>
                <ul className="space-y-1">
                  {pack.examples.map((example) => (
                    <li
                      className="rounded-md bg-accent/50 px-2.5 py-1.5 text-foreground/80 text-xs"
                      key={example}
                    >
                      「{example}」
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
