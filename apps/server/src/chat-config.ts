import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ChatServerConfigData } from "@chatdesk/shared";

export type { ChatServerConfigData } from "@chatdesk/shared";

const DEFAULT_CONFIG: ChatServerConfigData = {
  models: [],
  chatTools: {},
  sandboxMode: "ask",
  sandboxReadablePaths: [],
  approvalReviewerModelId: undefined,
  mcpServers: [],
  installedSkillIds: [],
  selectedSkillIds: [],
  apiKeys: {},
};

function normalize(value: unknown): ChatServerConfigData {
  if (!value || typeof value !== "object") return structuredClone(DEFAULT_CONFIG);
  const record = value as Record<string, unknown>;
  const models = Array.isArray(record.models) ? record.models : [];
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
    chatTools:
      record.chatTools && typeof record.chatTools === "object"
        ? (record.chatTools as Record<string, boolean>)
        : {},
    sandboxMode:
      record.sandboxMode === "auto" || record.sandboxMode === "full" ? record.sandboxMode : "ask",
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
    approvalReviewerModelId: reviewerModelExists ? configuredReviewerModelId : undefined,
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
