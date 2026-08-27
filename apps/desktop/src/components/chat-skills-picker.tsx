import { ChevronDown, Sparkles } from "lucide-react";
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
import { isBuiltinSkill, type SkillDefinition } from "@/lib/skills";

type ChatSkillsPickerProps = {
  disabled?: boolean;
  skills: SkillDefinition[];
  selectedSkillIds: string[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelectionChange: (ids: string[]) => void;
};

export function ChatSkillsPicker({
  disabled = false,
  skills,
  selectedSkillIds,
  open,
  onOpenChange,
  onSelectionChange,
}: ChatSkillsPickerProps) {
  const selected = new Set(selectedSkillIds);
  const visibleSkills = skills.filter((skill) => !isBuiltinSkill(skill));

  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange}>
      <DropdownMenuTrigger asChild>
        <button
          aria-label="选择 Skills"
          disabled={disabled}
          className="chat-tools-picker !h-7 !gap-1.5 !px-2 !text-[11px]"
          type="button"
        >
          <Sparkles className="size-3.5" />
          <span className="chat-picker-value !text-[11px]">
            {visibleSkills.length > 0
              ? `Skills ${selectedSkillIds.length}/${visibleSkills.length}`
              : "Skills"}
          </span>
          <ChevronDown className="size-3.5" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="chat-tools-menu chat-skills-menu"
        side="top"
        sideOffset={8}
      >
        <DropdownMenuLabel className="!text-[11px]">本次对话使用的 Skills</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <div className="chat-tools-menu-list">
          {visibleSkills.length > 0 ? (
            visibleSkills.map((skill) => {
              const switchId = `chat-skill-picker-${skill.id}`;
              return (
                <label
                  className="chat-tools-menu-row !text-[11px]"
                  htmlFor={switchId}
                  key={skill.id}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{skill.name}</span>
                    <span
                      className="block truncate text-muted-foreground text-[11px]"
                      title={skill.description || skill.source}
                    >
                      {skill.description || skill.source}
                    </span>
                  </span>
                  <Switch
                    aria-label={`启用 ${skill.name}`}
                    checked={selected.has(skill.id)}
                    id={switchId}
                    size="sm"
                    onCheckedChange={(checked) =>
                      onSelectionChange(
                        checked
                          ? [...selectedSkillIds, skill.id]
                          : selectedSkillIds.filter((id) => id !== skill.id),
                      )
                    }
                  />
                </label>
              );
            })
          ) : (
            <p className="px-3 py-5 text-center text-muted-foreground text-xs">
              没有可用来自 ~/.agents/skills 的 Skill
            </p>
          )}
        </div>
        <DropdownMenuSeparator />
        <div className="chat-tools-menu-footer">
          <Button asChild className="h-auto px-2 py-1.5 text-xs" size="sm" variant="ghost">
            <Link to="/settings/skills" onClick={() => onOpenChange(false)}>
              管理 Skills
            </Link>
          </Button>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
