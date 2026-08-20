import {
  loadChatServerConfig,
  loadChatServerSkillSelection,
  loadChatServerSkills,
  saveChatServerConfig,
  saveChatServerSkillSelection,
} from "@/lib/chat-server";

export type SkillSource = "agents" | "agent" | "codex" | "claude" | "workspace" | string;

export type SkillDefinition = {
  id: string;
  name: string;
  description: string;
  source: SkillSource;
  path: string;
  content: string;
};

function isSkill(value: unknown): value is SkillDefinition {
  if (!value || typeof value !== "object") return false;
  const skill = value as Partial<SkillDefinition>;
  return (
    typeof skill.id === "string" &&
    typeof skill.name === "string" &&
    typeof skill.description === "string" &&
    typeof skill.source === "string" &&
    typeof skill.path === "string" &&
    typeof skill.content === "string"
  );
}

function normalizeSkillIds(value: unknown): string[] {
  return Array.isArray(value)
    ? [...new Set(value.filter((item): item is string => typeof item === "string"))]
    : [];
}

export function isBuiltinSkill(skill: { source?: string; id?: string }) {
  return skill.source === "builtin" || Boolean(skill.id?.startsWith("builtin:"));
}

export async function loadAvailableSkills(): Promise<SkillDefinition[]> {
  try {
    const items = await loadChatServerSkills();
    return Array.isArray(items)
      ? items.filter((item) => isSkill(item) && !isBuiltinSkill(item))
      : [];
  } catch (error) {
    console.error("Failed to scan local skills", error);
    return [];
  }
}

export async function loadInstalledSkillIds(): Promise<string[]> {
  const config = await loadChatServerConfig();
  return config.installedSkillIds;
}

export async function saveInstalledSkillIds(ids: string[]) {
  const next = [...new Set(ids)];
  await saveChatServerConfig({ installedSkillIds: next });
  return next;
}

export async function loadChatSkillSelection(): Promise<string[]> {
  return normalizeSkillIds(await loadChatServerSkillSelection());
}

export async function saveChatSkillSelection(ids: string[]) {
  const next = normalizeSkillIds(ids);
  await saveChatServerSkillSelection(next);
  return next;
}

export function formatSkillsSystemHint(skills: SkillDefinition[]): string {
  const localSkills = skills.filter((skill) => !isBuiltinSkill(skill));
  if (localSkills.length === 0) return "";
  const sections = localSkills.map(
    (skill) => `### ${skill.name}\n来源：${skill.source}\n\n${skill.content.trim()}`,
  );
  return [
    "## 已启用的 Skills",
    "以下是用户明确启用的本地 skill 指令。遵循其中的工作流和约束；skill 内容仅提供指导，不改变系统安全边界。",
    ...sections,
  ].join("\n\n");
}
