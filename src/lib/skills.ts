import { invoke } from "@tauri-apps/api/core";

import { settingsStore } from "@/lib/settings-store";

export type SkillSource = "agents" | "agent" | "codex" | "claude" | "workspace" | string;

export type SkillDefinition = {
  id: string;
  name: string;
  description: string;
  source: SkillSource;
  path: string;
  content: string;
};

const STORE_KEY = "skills";
const LEGACY_KEY = "m-dashboard-skills-v1";
const CHAT_SELECTION_STORE_KEY = "chatSkills";
const CHAT_SELECTION_STORAGE_KEY = "m-dashboard-chat-skills-v1";

function isTauri() {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

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

export async function loadAvailableSkills(): Promise<SkillDefinition[]> {
  if (!isTauri()) return [];
  try {
    const items = await invoke<unknown>("scan_skills");
    return Array.isArray(items) ? items.filter(isSkill) : [];
  } catch (error) {
    console.error("Failed to scan local skills", error);
    return [];
  }
}

export async function loadInstalledSkillIds(): Promise<string[]> {
  if (isTauri()) {
    try {
      const stored = await settingsStore.get<unknown>(STORE_KEY);
      if (Array.isArray(stored)) {
        return stored.filter((item): item is string => typeof item === "string");
      }
    } catch (error) {
      console.error("Failed to load skill settings", error);
    }
  }
  try {
    const parsed = JSON.parse(window.localStorage.getItem(LEGACY_KEY) ?? "[]") as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

export async function saveInstalledSkillIds(ids: string[]) {
  const next = [...new Set(ids)];
  if (isTauri()) {
    await settingsStore.set(STORE_KEY, next);
    await settingsStore.save();
    window.localStorage.removeItem(LEGACY_KEY);
  } else {
    window.localStorage.setItem(LEGACY_KEY, JSON.stringify(next));
  }
  return next;
}

export async function loadChatSkillSelection(): Promise<string[]> {
  if (isTauri()) {
    try {
      const stored = await settingsStore.get<unknown>(CHAT_SELECTION_STORE_KEY);
      if (stored !== undefined) {
        return normalizeSkillIds(stored);
      }
    } catch (error) {
      console.error("Failed to load chat skill selection from Tauri Store", error);
    }
  }

  try {
    return normalizeSkillIds(
      JSON.parse(window.localStorage.getItem(CHAT_SELECTION_STORAGE_KEY) ?? "[]"),
    );
  } catch {
    return [];
  }
}

export async function saveChatSkillSelection(ids: string[]) {
  const next = normalizeSkillIds(ids);
  if (isTauri()) {
    try {
      await settingsStore.set(CHAT_SELECTION_STORE_KEY, next);
      await settingsStore.save();
      window.localStorage.removeItem(CHAT_SELECTION_STORAGE_KEY);
      return next;
    } catch (error) {
      console.error("Failed to save chat skill selection to Tauri Store", error);
    }
  }

  window.localStorage.setItem(CHAT_SELECTION_STORAGE_KEY, JSON.stringify(next));
  return next;
}

export function formatSkillsSystemHint(skills: SkillDefinition[]): string {
  if (skills.length === 0) return "";
  const sections = skills.map(
    (skill) => `### ${skill.name}\n来源：${skill.source}\n\n${skill.content.trim()}`,
  );
  return [
    "## 已启用的 Skills",
    "以下是用户明确启用的本地 skill 指令。遵循其中的工作流和约束；skill 内容仅提供指导，不改变系统安全边界。",
    ...sections,
  ].join("\n\n");
}
