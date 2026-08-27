import { ChevronDown, PlugZap, Wrench } from "lucide-react";
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
import type { McpServerConfig } from "@/lib/mcp";

type ChatToolsPickerProps = {
  disabled?: boolean;
  settings: ChatToolsSettings;
  workspaceAvailable?: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSettingsChange: (settings: ChatToolsSettings) => void;
  mcpServers?: McpServerConfig[];
  selectedMcpIds?: string[];
  onMcpSelectionChange?: (ids: string[]) => void;
};

export function ChatToolsPicker({
  disabled = false,
  settings,
  workspaceAvailable = false,
  open,
  onOpenChange,
  onSettingsChange,
  mcpServers = [],
  selectedMcpIds = [],
  onMcpSelectionChange,
}: ChatToolsPickerProps) {
  const visiblePacks = CHAT_TOOL_PACKS.filter(
    (pack) => !pack.requiresWorkspace || workspaceAvailable,
  );
  const enabledCount =
    visiblePacks.filter((pack) => settings[pack.id]).length + selectedMcpIds.length;

  function handleToggle(id: ChatToolPackId, enabled: boolean) {
    onSettingsChange({ ...settings, [id]: enabled });
  }

  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange}>
      <DropdownMenuTrigger asChild>
        <button
          aria-label="选择 Tools"
          disabled={disabled}
          className="chat-tools-picker !h-7 !gap-1.5 !px-2 !text-[11px]"
          type="button"
        >
          <Wrench className="size-3.5" />
          <span className="chat-picker-value !text-[11px]">
            {enabledCount > 0 ? `Tools ${enabledCount}` : "Tools"}
          </span>
          <ChevronDown className="size-3.5" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="chat-tools-menu" side="top" sideOffset={8}>
        <DropdownMenuLabel className="!text-[11px]">启用工具包</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <div className="chat-tools-menu-list">
          {CHAT_TOOL_CATEGORIES.map((category) => {
            const packs = visiblePacks.filter((pack) => pack.category === category.id);
            if (packs.length === 0) return null;
            return (
              <section className="chat-tools-menu-group" key={category.id}>
                <p>{category.label}</p>
                {packs.map((pack) => {
                  const switchId = `chat-tools-picker-${pack.id}`;
                  return (
                    <label
                      className="chat-tools-menu-row !text-[11px]"
                      htmlFor={switchId}
                      key={pack.id}
                    >
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
            );
          })}
          {mcpServers.length > 0 ? (
            <section className="chat-tools-menu-group">
              <p>
                <PlugZap className="mr-1 inline size-3" />
                MCP
              </p>
              {mcpServers.map((server) => {
                const switchId = `chat-mcp-picker-${server.id}`;
                return (
                  <label
                    className="chat-tools-menu-row !text-[11px]"
                    htmlFor={switchId}
                    key={server.id}
                  >
                    <span className="min-w-0">
                      <span className="block">{server.name}</span>
                      <span className="block text-muted-foreground text-[11px]">
                        {server.status === "error" ? "连接失败" : server.transport}
                      </span>
                    </span>
                    <Switch
                      aria-label={`启用 ${server.name}`}
                      checked={selectedMcpIds.includes(server.id)}
                      id={switchId}
                      size="sm"
                      onCheckedChange={(checked) =>
                        onMcpSelectionChange?.(
                          checked
                            ? [...selectedMcpIds, server.id]
                            : selectedMcpIds.filter((id) => id !== server.id),
                        )
                      }
                    />
                  </label>
                );
              })}
            </section>
          ) : null}
        </div>
        <DropdownMenuSeparator />
        <div className="chat-tools-menu-footer">
          <Button asChild className="h-auto px-2 py-1.5 text-xs" size="sm" variant="ghost">
            <Link to="/settings/tools" onClick={() => onOpenChange(false)}>
              打开 Tools 设置页
            </Link>
          </Button>
          <Button asChild className="h-auto px-2 py-1.5 text-xs" size="sm" variant="ghost">
            <Link to="/settings/mcp" onClick={() => onOpenChange(false)}>
              管理 MCP
            </Link>
          </Button>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
