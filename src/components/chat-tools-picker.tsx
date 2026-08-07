import { ChevronDown, Wrench } from "lucide-react";
import { Link } from "react-router-dom";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Switch } from "@/components/ui/switch";
import {
  CHAT_TOOL_CATEGORIES,
  CHAT_TOOL_PACKS,
  type ChatToolPackId,
  type ChatToolsSettings,
} from "@/lib/chat-tools";

type ChatToolsPickerProps = {
  settings: ChatToolsSettings;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSettingsChange: (settings: ChatToolsSettings) => void;
};

export function ChatToolsPicker({
  settings,
  open,
  onOpenChange,
  onSettingsChange,
}: ChatToolsPickerProps) {
  const enabledCount = CHAT_TOOL_PACKS.filter((pack) => settings[pack.id]).length;

  function handleToggle(id: ChatToolPackId, enabled: boolean) {
    onSettingsChange({ ...settings, [id]: enabled });
  }

  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange}>
      <DropdownMenuTrigger asChild>
        <button aria-label="选择 Tools" className="chat-tools-picker" type="button">
          <Wrench className="size-3.5" />
          <span>{enabledCount > 0 ? `Tools ${enabledCount}` : "Tools"}</span>
          <ChevronDown className="size-3.5" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="chat-tools-menu" sideOffset={8}>
        <DropdownMenuLabel>启用工具包</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <div className="chat-tools-menu-list">
          {CHAT_TOOL_CATEGORIES.map((category) => (
            <section className="chat-tools-menu-group" key={category.id}>
              <p>{category.label}</p>
              {CHAT_TOOL_PACKS.filter((pack) => pack.category === category.id).map((pack) => {
                const switchId = `chat-tools-picker-${pack.id}`;
                return (
                  <label className="chat-tools-menu-row" htmlFor={switchId} key={pack.id}>
                    <span className="min-w-0">
                      <span className="block">{pack.label}</span>
                    </span>
                    <Switch
                      aria-label={`启用 ${pack.label}`}
                      checked={settings[pack.id]}
                      id={switchId}
                      size="sm"
                      onCheckedChange={(checked) => handleToggle(pack.id, checked === true)}
                    />
                  </label>
                );
              })}
            </section>
          ))}
        </div>
        <DropdownMenuSeparator />
        <div className="chat-tools-menu-footer">
          <Button asChild className="h-auto px-2 py-1.5 text-xs" size="sm" variant="ghost">
            <Link to="/settings/tools" onClick={() => onOpenChange(false)}>
              打开 Tools 设置页
            </Link>
          </Button>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
