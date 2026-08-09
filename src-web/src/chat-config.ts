import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { SandboxMode } from "./protocol.ts";

export type ChatServerConfigData = {
  models: unknown[];
  chatTools: Record<string, boolean>;
  sandboxMode: SandboxMode;
  mcpServers: unknown[];
  installedSkillIds: string[];
  selectedSkillIds: string[];
  apiKeys: Record<string, string>;
};

const DEFAULT_CONFIG: ChatServerConfigData = {
  models: [],
  chatTools: {},
  sandboxMode: "ask",
  mcpServers: [],
  installedSkillIds: [],
  selectedSkillIds: [],
  apiKeys: {},
};

function normalize(value: unknown): ChatServerConfigData {
  if (!value || typeof value !== "object") return structuredClone(DEFAULT_CONFIG);
  const record = value as Record<string, unknown>;
  return {
    models: Array.isArray(record.models) ? record.models : [],
    chatTools:
      record.chatTools && typeof record.chatTools === "object"
        ? (record.chatTools as Record<string, boolean>)
        : {},
    sandboxMode:
      record.sandboxMode === "auto" || record.sandboxMode === "full" ? record.sandboxMode : "ask",
    mcpServers: Array.isArray(record.mcpServers) ? record.mcpServers : [],
    installedSkillIds: Array.isArray(record.installedSkillIds)
      ? record.installedSkillIds.filter((item): item is string => typeof item === "string")
      : [],
    selectedSkillIds: Array.isArray(record.selectedSkillIds)
      ? record.selectedSkillIds.filter((item): item is string => typeof item === "string")
      : [],
    apiKeys:
      record.apiKeys && typeof record.apiKeys === "object"
        ? Object.fromEntries(
            Object.entries(record.apiKeys).filter(([, item]) => typeof item === "string"),
          )
        : {},
  };
}

async function readJson(pathname: string, fallback: unknown) {
  try {
    return JSON.parse(await readFile(pathname, "utf8")) as unknown;
  } catch {
    return fallback;
  }
}

export class ChatConfigStore {
  private value: ChatServerConfigData = structuredClone(DEFAULT_CONFIG);
  private readonly file: string;

  constructor(dataDir: string) {
    this.file = path.join(dataDir, "settings.json");
  }

  async init(legacyFile?: string) {
    await mkdir(path.dirname(this.file), { recursive: true });
    const current = await readJson(this.file, null);
    if (current) {
      this.value = normalize(current);
      return;
    }
    const legacy = await readJson(legacyFile || "", null);
    if (legacy && typeof legacy === "object") {
      const value = legacy as Record<string, unknown>;
      this.value = normalize({
        models: value.models,
        chatTools: value.chatTools,
        mcpServers: value.mcpServers,
        installedSkillIds: value.skills,
        selectedSkillIds: value.chatSkills,
        apiKeys: {
          dataer: value.dataerApiKey,
          commit: value.commitApiKey,
          looker: value.lookerApiKey,
          kie: value.kieApiKey,
        },
      });
      await this.update(this.value);
      return;
    }
    this.value = structuredClone(DEFAULT_CONFIG);
  }

  get() {
    return structuredClone(this.value);
  }

  async update(value: unknown) {
    const next = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
    this.value = normalize({
      ...this.value,
      ...next,
      apiKeys: { ...this.value.apiKeys, ...(next.apiKeys as Record<string, string> | undefined) },
      chatTools: { ...this.value.chatTools, ...(next.chatTools as Record<string, boolean> | undefined) },
    });
    const temporary = `${this.file}.tmp`;
    await writeFile(temporary, JSON.stringify(this.value, null, 2));
    await rename(temporary, this.file);
    return this.get();
  }
}
