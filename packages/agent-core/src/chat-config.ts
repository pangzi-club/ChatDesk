import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  type AgentConfig,
  type ChatServerConfigData,
  type ChatToolPackId,
  normalizeAgentAvatar,
} from "@chatdesk/shared";
import { isDeveloperToolDirectory } from "./developer-environment.ts";

export type { ChatServerConfigData } from "@chatdesk/shared";

const DEFAULT_CONFIG: ChatServerConfigData = {
  models: [],
  agents: [],
  chatTools: {},
  sandboxMode: "full",
  sandboxReadablePaths: [],
  developerToolPaths: [],
  approvalReviewerModelId: undefined,
  mcpServers: [],
  installedSkillIds: [],
  selectedSkillIds: [],
  disabledSkillIds: [],
  apiKeys: {},
};

function normalize(value: unknown): ChatServerConfigData {
  if (!value || typeof value !== "object") return structuredClone(DEFAULT_CONFIG);
  const record = value as Record<string, unknown>;
  const models = Array.isArray(record.models) ? record.models : [];
  const agents = normalizeAgents(record.agents);
  const configuredReviewerModelId =
    typeof record.approvalReviewerModelId === "string" && record.approvalReviewerModelId.trim()
      ? record.approvalReviewerModelId.trim()
      : undefined;
  const reviewerModelExists = configuredReviewerModelId
    ? models.some(
        (item) =>
          item &&
          typeof item === "object" &&
          (item as { id?: unknown }).id === configuredReviewerModelId,
      )
    : false;
  return {
    models,
    agents,
    chatTools:
      record.chatTools && typeof record.chatTools === "object"
        ? (record.chatTools as Record<string, boolean>)
        : {},
    sandboxMode:
      record.sandboxMode === "ask" || record.sandboxMode === "auto" || record.sandboxMode === "full"
        ? record.sandboxMode
        : "full",
    sandboxReadablePaths: Array.isArray(record.sandboxReadablePaths)
      ? [
          ...new Set(
            record.sandboxReadablePaths
              .filter(
                (item): item is string => typeof item === "string" && path.isAbsolute(item.trim()),
              )
              .map((item) => item.trim()),
          ),
        ].slice(0, 100)
      : [],
    developerToolPaths: Array.isArray(record.developerToolPaths)
      ? [
          ...new Set(
            record.developerToolPaths
              .filter(
                (item): item is string =>
                  typeof item === "string" && isDeveloperToolDirectory(item.trim()),
              )
              .map((item) => path.normalize(item.trim())),
          ),
        ].slice(0, 50)
      : [],
    approvalReviewerModelId: reviewerModelExists ? configuredReviewerModelId : undefined,
    mcpServers: Array.isArray(record.mcpServers) ? record.mcpServers : [],
    installedSkillIds: Array.isArray(record.installedSkillIds)
      ? record.installedSkillIds.filter((item): item is string => typeof item === "string")
      : [],
    selectedSkillIds: Array.isArray(record.selectedSkillIds)
      ? record.selectedSkillIds.filter((item): item is string => typeof item === "string")
      : [],
    disabledSkillIds: Array.isArray(record.disabledSkillIds)
      ? [
          ...new Set(
            record.disabledSkillIds.filter((item): item is string => typeof item === "string"),
          ),
        ]
      : [],
    apiKeys:
      record.apiKeys && typeof record.apiKeys === "object"
        ? Object.fromEntries(
            Object.entries(record.apiKeys).filter(([, item]) => typeof item === "string"),
          )
        : {},
  };
}

const AGENT_TOOL_IDS = new Set<ChatToolPackId>([
  "list_dir",
  "search_files",
  "read_file",
  "write_file",
  "edit_file",
  "terminal",
  "web_search",
  "image_generation",
  "browser",
  "conversation_history",
]);

function normalizeAgents(value: unknown): AgentConfig[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item): AgentConfig | null => {
      if (!item || typeof item !== "object") return null;
      const record = item as Record<string, unknown>;
      const stringField = (key: string, max: number) =>
        typeof record[key] === "string" ? record[key].trim().slice(0, max) : "";
      const id = stringField("id", 128);
      const name = stringField("name", 120);
      const modelId = stringField("modelId", 128);
      if (!id || !name || !modelId) return null;
      const ids = (key: string, max: number) =>
        Array.isArray(record[key])
          ? [
              ...new Set(
                record[key]
                  .filter((v): v is string => typeof v === "string" && Boolean(v.trim()))
                  .map((v) => v.trim().slice(0, 128)),
              ),
            ].slice(0, max)
          : [];
      return {
        id,
        name,
        avatar: normalizeAgentAvatar(record.avatar),
        modelId,
        systemPrompt: stringField("systemPrompt", 20_000),
        toolPackIds: ids("toolPackIds", 50).filter((v): v is ChatToolPackId =>
          AGENT_TOOL_IDS.has(v as ChatToolPackId),
        ),
        mcpServerIds: ids("mcpServerIds", 100),
        skillIds: ids("skillIds", 100),
        createdAt: stringField("createdAt", 64),
        updatedAt: stringField("updatedAt", 64),
      };
    })
    .filter((item): item is AgentConfig => Boolean(item));
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

  async init() {
    await mkdir(path.dirname(this.file), { recursive: true });
    const current = await readJson(this.file, null);
    if (current) {
      this.value = normalize(current);
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
      chatTools: {
        ...this.value.chatTools,
        ...(next.chatTools as Record<string, boolean> | undefined),
      },
    });
    const temporary = `${this.file}.tmp`;
    await writeFile(temporary, JSON.stringify(this.value, null, 2));
    await rename(temporary, this.file);
    return this.get();
  }
}
