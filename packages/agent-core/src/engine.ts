import type { LanguageModel } from "ai";
import { ActivityLogStore } from "./activity-log-store.ts";
import { AiUsageLogStore } from "./ai-usage-log.ts";
import { ChatConfigStore } from "./chat-config.ts";
import { closeClientTools } from "./client-tools.ts";
import { acquireDataDirectoryLock, type DataDirectoryLock } from "./data-directory-lock.ts";
import { EventHub } from "./events.ts";
import { ImageGenerationStore } from "./image-generation-store.ts";
import { JobRegistry } from "./job-registry.ts";
import { McpRuntime } from "./mcp-runtime.ts";
import { MemoryStore } from "./memory-store.ts";
import { PlanStore } from "./plan-store.ts";
import type { ServerModelConfig } from "./protocol.ts";
import { type ModelStreamTimeout, RunRegistry } from "./run-registry.ts";
import { SessionStore } from "./store.ts";
import { WorkspaceStore } from "./workspace-store.ts";

export type AgentCoreOptions = {
  dataDir: string;
  acquireLock?: boolean;
  createLanguageModel?: (model: ServerModelConfig) => LanguageModel;
  modelStreamTimeout?: ModelStreamTimeout;
};

export type AgentCore = {
  dataDir: string;
  store: SessionStore;
  events: EventHub;
  runs: RunRegistry;
  jobs: JobRegistry;
  chatConfig: ChatConfigStore;
  memory: MemoryStore;
  plans: PlanStore;
  workspaces: WorkspaceStore;
  mcp: McpRuntime;
  activityLogs: ActivityLogStore;
  aiUsageLogs: AiUsageLogStore;
  imageGeneration: ImageGenerationStore;
  shutdown: () => Promise<void>;
};

export async function createAgentCore(options: AgentCoreOptions): Promise<AgentCore> {
  const lock: DataDirectoryLock | undefined =
    (options.acquireLock ?? true) ? await acquireDataDirectoryLock(options.dataDir) : undefined;

  try {
    const store = new SessionStore(options.dataDir);
    await store.init();
    const events = new EventHub();
    const jobs = new JobRegistry(options.dataDir, events);
    await jobs.initialize();
    const chatConfig = new ChatConfigStore(options.dataDir);
    await chatConfig.init();
    const memory = new MemoryStore(options.dataDir);
    await memory.init();
    const plans = new PlanStore(options.dataDir);
    const activityLogs = new ActivityLogStore(options.dataDir);
    await activityLogs.init();
    const aiUsageLogs = new AiUsageLogStore(options.dataDir);
    await aiUsageLogs.init();
    const imageGeneration = new ImageGenerationStore(options.dataDir);
    await imageGeneration.init();
    const workspaces = new WorkspaceStore(options.dataDir);
    await workspaces.init();
    await workspaces.ensureDefault();
    const mcp = new McpRuntime();
    const runs = new RunRegistry(
      store,
      events,
      chatConfig,
      plans,
      aiUsageLogs,
      activityLogs,
      (id) => workspaces.get(id)?.path,
      options.createLanguageModel,
      options.modelStreamTimeout,
      jobs,
    );
    await runs.initialize();

    return {
      dataDir: options.dataDir,
      store,
      events,
      runs,
      jobs,
      chatConfig,
      memory,
      plans,
      workspaces,
      mcp,
      activityLogs,
      aiUsageLogs,
      imageGeneration,
      shutdown: async () => {
        await runs.shutdown();
        await jobs.shutdown();
        await mcp.close();
        closeClientTools();
        await lock?.release();
      },
    };
  } catch (error) {
    await lock?.release();
    throw error;
  }
}
