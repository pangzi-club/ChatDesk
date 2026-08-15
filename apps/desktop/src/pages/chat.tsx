import { useChat } from "@ai-sdk/react";
import {
  type ChatContextCompaction,
  type ChatContextUsage,
  type ChatPlanMode,
  type ChatPlanSummary,
  type ChatRunProgress,
  MAX_AGENT_STEPS,
  type RunStartInput,
  type SystemPromptSnapshot,
  TODO_TOOL_NAME,
} from "@chatdesk/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  type ChatTransport,
  DefaultChatTransport,
  type FileUIPart,
  getToolName,
  isToolUIPart,
  lastAssistantMessageIsCompleteWithApprovalResponses,
  type UIMessage,
} from "ai";
import {
  ArrowUp,
  Bot,
  Brain,
  Bug,
  Check,
  ChevronDown,
  ChevronUp,
  CircleAlert,
  CircleStop,
  Copy,
  Download,
  ExternalLink,
  FileText,
  Folder,
  GitBranch,
  Hammer,
  History,
  Laptop,
  LoaderCircle,
  Mic,
  MoreHorizontal,
  Paperclip,
  Plus,
  RefreshCw,
  SearchCode,
  Settings,
  Settings2,
  ShieldCheck,
  Sparkles,
  Trash2,
  Upload,
  User,
  Wrench,
  X,
} from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ChatAttachmentChips } from "@/components/chat-attachment-chips";
import { ChatCommandPopup } from "@/components/chat-command-popup";
import { ChatContextDialog } from "@/components/chat-context-dialog";
import { ChatContextPopover } from "@/components/chat-context-popover";
import { ChatGitSummary } from "@/components/chat-git-summary";
import { ChatMarkdown } from "@/components/chat-markdown";
import { ChatMemoryDialog } from "@/components/chat-memory-dialog";
import { ChatSettingsDialog } from "@/components/chat-settings-dialog";
import { ChatSkillsPicker } from "@/components/chat-skills-picker";
import { ChatTodoPanel } from "@/components/chat-todo-panel";
import { type ChatToolCallCardProps, ChatToolCallGroup } from "@/components/chat-tool-call-card";
import { ChatToolLogDialog } from "@/components/chat-tool-log-dialog";
import { ChatToolsPicker } from "@/components/chat-tools-picker";
import { GitCommitDialog } from "@/components/git-commit-dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  createPendingAttachment,
  mergeChatAttachments,
  type PendingAttachment,
  uploadPendingAttachment,
  validateAttachment,
} from "@/lib/chat-attachments";
import {
  type ChatCommand,
  filterChatCommands,
  findActiveCommandTrigger,
} from "@/lib/chat-commands";
import { materializeGeneratedImages } from "@/lib/chat-image-generation";
import { appendLiveDraftText, mergeLiveDraft } from "@/lib/chat-live-draft";
import {
  type ChatMemoryStore,
  DEFAULT_CHAT_MEMORY,
  formatMemoryForInject,
  loadChatMemory,
  saveChatMemory,
} from "@/lib/chat-memory";
import { isWorkspaceMemoryExcludedTool, scheduleMemoryUpdateFromTurn } from "@/lib/chat-memory-ops";
import {
  type ChatFilePart,
  type ChatSourcePart,
  type ChatToolPart,
  getChatMessageBlocks,
} from "@/lib/chat-message-blocks";
import {
  CHAT_SANDBOX_MODE_DESCRIPTIONS,
  CHAT_SANDBOX_MODE_LABELS,
  type ChatSandboxMode,
  DEFAULT_CHAT_SANDBOX_MODE,
  loadChatSandboxMode,
  normalizeChatSandboxMode,
  saveChatSandboxMode,
} from "@/lib/chat-sandbox";
import {
  type ChatServerSession,
  chatServerFetch,
  chatServerHeaders,
  chatServerUrl,
  createChatPlan,
  ensureChatServerSession,
  importDeveloperEnvironment,
  initializeChatServer,
  loadChatPlan,
  loadChatPlans,
  loadChatServerConfig,
  loadChatServerPort,
  loadChatServerSystemPromptPreview,
  loadDeveloperEnvironment,
  loadServerWorkspaceGit,
  saveChatServerConfig,
  stopChatServerRun,
  subscribeChatServerEvents,
  updateChatPlanMode,
} from "@/lib/chat-server";
import {
  type ChatDisplaySettings,
  DEFAULT_CHAT_DISPLAY,
  loadChatDisplaySettings,
  saveChatDisplaySettings,
} from "@/lib/chat-settings";
import {
  type ChatAttachment,
  type ChatIndexItem,
  type ChatSession,
  createSessionId,
  deleteChatSession,
  deriveChatTitle,
  loadChatIndex,
  loadChatSession,
  saveChatSession,
} from "@/lib/chat-store";
import { resolveActiveTools } from "@/lib/chat-tool-defs";
import {
  type ChatToolsSettings,
  DEFAULT_CHAT_TOOLS,
  loadChatToolsSettings,
  saveChatToolsSettings,
} from "@/lib/chat-tools";
import {
  formatTokenUsage,
  getMessageContextUsage,
  getMessageRunErrorLabel,
  getMessageRunStateLabel,
  getMessageUsage,
} from "@/lib/chat-usage";
import { detectMissingDevelopmentTools } from "@/lib/developer-environment";
import { openFileViewer } from "@/lib/file-viewer-events";
import { openImagePreview } from "@/lib/image-preview-events";
import { loadMcpServers, saveMcpServers } from "@/lib/mcp";
import { formatModelLabel, loadModels, type ModelConfig, sortModelsByName } from "@/lib/models";
import { openPlanViewer, updatePlanViewer } from "@/lib/plan-viewer-events";
import { openExternal } from "@/lib/platform";
import {
  formatSkillsSystemHint,
  loadAvailableSkills,
  loadChatSkillSelection,
  loadInstalledSkillIds,
  type SkillDefinition,
  saveChatSkillSelection,
} from "@/lib/skills";
import { loadWorkspaceProjects, workspaceGitQueryKey } from "@/lib/workspaces";

const EMPTY_STRING_ARRAY: string[] = [];
const DEFAULT_WORKSPACE_LABEL = "Default Workspace";
const CHAT_MESSAGE_COLLAPSE_CHAR_LIMIT = 1200;
const CHAT_MESSAGE_COLLAPSE_LINE_LIMIT = 18;
const CHAT_STREAM_UPDATE_THROTTLE_MS = 50;
const EMPTY_CHAT_ACTIONS = [
  {
    label: "探索并理解代码",
    prompt: "请帮我探索并理解这个代码库。",
    icon: SearchCode,
    accent: "blue",
  },
  {
    label: "构建新功能、应用",
    prompt: "请帮我构建一个新功能、应用或工具。",
    icon: Hammer,
    accent: "violet",
  },
  {
    label: "审查代码并修改建议",
    prompt: "请审查这份代码并提出修改建议。",
    icon: RefreshCw,
    accent: "green",
  },
  {
    label: "修复问题和失败",
    prompt: "请帮我定位并修复这个问题。",
    icon: Bug,
    accent: "orange",
  },
] as const;

function scrollChatToBottom(element: HTMLDivElement) {
  const previousBehavior = element.style.scrollBehavior;
  element.style.scrollBehavior = "auto";
  element.scrollTop = element.scrollHeight;
  element.style.scrollBehavior = previousBehavior;
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function ChatPage() {
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedSessionId = searchParams.get("sessionId");
  const requestedWorkspaceId = searchParams.get("workspaceId");
  const requestedWorkspaceCwd = searchParams.get("workspaceCwd") ?? "";
  const { data: chatIndex = [], isLoading: isChatHistoryLoading } = useQuery({
    queryKey: ["chat-index"],
    queryFn: loadChatIndex,
  });
  const { data: configuredModels, isLoading: isModelsLoading } = useQuery({
    queryKey: ["models"],
    queryFn: loadModels,
  });
  const { data: chatMemory = DEFAULT_CHAT_MEMORY } = useQuery({
    queryKey: ["chat-memory"],
    queryFn: loadChatMemory,
  });
  const { data: chatTools = DEFAULT_CHAT_TOOLS } = useQuery({
    queryKey: ["chat-tools"],
    queryFn: loadChatToolsSettings,
  });
  const { data: mcpServers = [] } = useQuery({
    queryKey: ["mcp-servers"],
    queryFn: loadMcpServers,
  });
  const { data: availableSkills = [] } = useQuery({
    queryKey: ["skills-available"],
    queryFn: loadAvailableSkills,
  });
  const installedSkillsQuery = useQuery({
    queryKey: ["skills-installed"],
    queryFn: loadInstalledSkillIds,
  });
  const chatSkillSelectionQuery = useQuery({
    queryKey: ["chat-skills-selected"],
    queryFn: loadChatSkillSelection,
  });
  const chatSandboxModeQuery = useQuery({
    queryKey: ["chat-sandbox-mode"],
    queryFn: loadChatSandboxMode,
  });
  const developerEnvironmentQuery = useQuery({
    queryKey: ["developer-environment"],
    queryFn: () => loadDeveloperEnvironment(),
  });
  const installedSkillIds = installedSkillsQuery.data ?? EMPTY_STRING_ARRAY;
  const savedChatSkillIds = chatSkillSelectionQuery.data ?? EMPTY_STRING_ARRAY;
  const { data: workspaceProjects = [] } = useQuery({
    queryKey: ["workspace-projects"],
    queryFn: loadWorkspaceProjects,
  });
  const memoryRef = useRef(chatMemory);
  memoryRef.current = chatMemory;
  const toolsRef = useRef(chatTools);
  toolsRef.current = chatTools;
  const skillsRef = useRef<SkillDefinition[]>(availableSkills);
  skillsRef.current = availableSkills;
  const models = configuredModels ?? [];
  const sortedModels = sortModelsByName(models);
  const [selectedModelId, setSelectedModelId] = useState("");
  const [input, setInput] = useState("");
  const [planMode, setPlanMode] = useState<ChatPlanMode>("apply");
  const [activePlanId, setActivePlanId] = useState<string | undefined>();
  const [activePlanHasContent, setActivePlanHasContent] = useState(false);
  const [plans, setPlans] = useState<ChatPlanSummary[]>([]);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [commandCaret, setCommandCaret] = useState(0);
  const [commandIndex, setCommandIndex] = useState(0);
  const [commandDismissed, setCommandDismissed] = useState(false);
  const [sessionId, setSessionId] = useState(createSessionId);
  const [sessionTitle, setSessionTitle] = useState("新对话");
  const [workspaceKey, setWorkspaceKey] = useState("");
  const [sessionCwd, setSessionCwd] = useState("");
  const localSessionTransitionRef = useRef<{
    nextSessionId: string;
    previousSessionId: string;
  } | null>(null);
  const skillsSelectionInitializedRef = useRef(false);
  const sessionCreatedAtRef = useRef(new Date().toISOString());
  const sessionAttachmentsRef = useRef<ChatAttachment[]>([]);
  const [pendingAttachments, setPendingAttachments] = useState<PendingAttachment[]>([]);
  const pendingAttachmentsRef = useRef<PendingAttachment[]>([]);
  pendingAttachmentsRef.current = pendingAttachments;
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const dragCounterRef = useRef(0);
  const suppressSaveRef = useRef(false);
  const pendingSessionRef = useRef<ChatSession | null>(null);
  const systemPromptRef = useRef<SystemPromptSnapshot | undefined>(undefined);
  const workspaceSelectionInitializedRef = useRef(false);
  const sandboxModeInitializedRef = useRef(false);
  const savedFingerprintRef = useRef("");
  const extractedFingerprintRef = useRef("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const shouldFollowScrollRef = useRef(true);
  const isComposingRef = useRef(false);
  const [sessionToDelete, setSessionToDelete] = useState<ChatIndexItem | null>(null);
  const [conversationIdCopied, setConversationIdCopied] = useState(false);
  const [conversationMenuOpen, setConversationMenuOpen] = useState(false);
  const conversationMenuCloseTimerRef = useRef<number | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [gitCommitOpen, setGitCommitOpen] = useState(false);
  const [contextOpen, setContextOpen] = useState(false);
  const [memoryOpen, setMemoryOpen] = useState(false);
  const [toolLogOpen, setToolLogOpen] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [skillsOpen, setSkillsOpen] = useState(false);
  const [environmentImportOpen, setEnvironmentImportOpen] = useState(false);
  const [dismissedEnvironmentGuide, setDismissedEnvironmentGuide] = useState("");
  const [selectedSkillIds, setSelectedSkillIds] = useState<string[]>([]);
  const [sandboxMode, setSandboxMode] = useState<ChatSandboxMode>(DEFAULT_CHAT_SANDBOX_MODE);
  const [chatDisplay, setChatDisplay] = useState<ChatDisplaySettings>(DEFAULT_CHAT_DISPLAY);
  const generationStartedAtRef = useRef<number | null>(null);
  const [generationElapsedSeconds, setGenerationElapsedSeconds] = useState(0);
  const workspaceRef = useRef("");
  const sandboxModeRef = useRef<ChatSandboxMode>(DEFAULT_CHAT_SANDBOX_MODE);
  const planModeRef = useRef<ChatPlanMode>("apply");
  const activePlanIdRef = useRef<string | undefined>(undefined);
  const planCreationRequestRef = useRef(0);
  const selectedCwd =
    workspaceProjects.find((project) => project.id === workspaceKey)?.path ?? sessionCwd;
  const workspaceLabel = selectedCwd ? pathBasename(selectedCwd) : DEFAULT_WORKSPACE_LABEL;
  workspaceRef.current = selectedCwd;
  sandboxModeRef.current = sandboxMode;
  planModeRef.current = planMode;
  activePlanIdRef.current = activePlanId;
  const selectedModel = models.find((model) => model.id === selectedModelId) ?? models[0];
  const selectedModelRef = useRef(selectedModel);
  selectedModelRef.current = selectedModel;
  const activePlan = plans.find((plan) => plan.id === activePlanId);

  useEffect(() => {
    return () => {
      if (conversationMenuCloseTimerRef.current !== null) {
        window.clearTimeout(conversationMenuCloseTimerRef.current);
      }
    };
  }, []);

  const getPromptInput = useCallback(async () => {
    const memory = memoryRef.current;
    const cwd = workspaceRef.current.trim();
    const workspaceId = workspaceKey.trim();
    const skills = skillsRef.current.filter((skill) => selectedSkillIds.includes(skill.id));
    const activeTools = await resolveActiveTools(
      toolsRef.current,
      selectedModelRef.current,
      () => cwd,
    );
    const system = [
      activeTools.toolNames.length
        ? `当前已启用工具：${activeTools.toolNames.join(", ")}`
        : "当前未启用工具。",
      formatSkillsSystemHint(skills),
    ]
      .filter(Boolean)
      .join("\n\n");
    return {
      system,
      memory: memory.enabled && memory.items.length > 0 ? formatMemoryForInject(memory.items) : "",
      cwd: cwd || undefined,
      workspaceId: workspaceId || undefined,
      toolNames: activeTools.toolNames,
    } satisfies Pick<RunStartInput, "system" | "memory" | "cwd" | "workspaceId" | "toolNames">;
  }, [selectedSkillIds, workspaceKey]);
  const promptKey = [
    selectedCwd,
    workspaceKey,
    selectedModel?.id ?? "",
    selectedSkillIds.join(","),
    JSON.stringify(chatMemory),
    JSON.stringify(chatTools),
  ].join("|");
  const selectedMcpIds = useMemo(
    () => mcpServers.filter((server) => server.enabledByDefault).map((server) => server.id),
    [mcpServers],
  );
  const transport = useMemo(
    () =>
      createModelTransport(
        sessionId,
        selectedModel,
        () => toolsRef.current,
        () => sandboxModeRef.current,
        () => skillsRef.current.filter((skill) => selectedSkillIds.includes(skill.id)),
        () => selectedMcpIds,
        () => planModeRef.current,
        () => activePlanIdRef.current,
        getPromptInput,
      ),
    [getPromptInput, selectedMcpIds, selectedModel, selectedSkillIds, sessionId],
  );
  const { addToolApprovalResponse, error, messages, sendMessage, setMessages, status, stop } =
    useChat({
      id: sessionId,
      transport,
      throttle: CHAT_STREAM_UPDATE_THROTTLE_MS,
      sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithApprovalResponses,
      onError: (chatError) => {
        console.error("Chat request failed", chatError);
      },
    });
  const [serverSessionStatuses, setServerSessionStatuses] = useState<
    Record<string, ChatServerSession["status"]>
  >({});
  const serverSessionStatus = serverSessionStatuses[sessionId];
  const localRunActive = status === "submitted" || status === "streaming";
  const serverRunActive =
    serverSessionStatus === "submitted" || serverSessionStatus === "streaming";
  const effectiveStatus = localRunActive ? status : (serverSessionStatus ?? status);
  const detectedMissingTools = useMemo(() => {
    for (let messageIndex = messages.length - 1; messageIndex >= 0; messageIndex -= 1) {
      const message = messages[messageIndex];
      for (let partIndex = message.parts.length - 1; partIndex >= 0; partIndex -= 1) {
        const part = message.parts[partIndex];
        if (!isToolUIPart(part) || getToolName(part) !== "bash" || !("output" in part)) continue;
        const missing = detectMissingDevelopmentTools(part.output);
        if (missing.length > 0) return missing;
      }
    }
    return [];
  }, [messages]);
  const unavailableDetectedTools = detectedMissingTools.filter((name) => {
    const tool = developerEnvironmentQuery.data?.tools.find((item) => item.name === name);
    return tool?.available !== true;
  });
  const environmentGuideKey = `${sessionId}:${unavailableDetectedTools.join(",")}`;
  const environmentImportMutation = useMutation({
    mutationFn: async () => {
      const imported = await importDeveloperEnvironment();
      const config = await loadChatServerConfig();
      const paths = [...new Set([...(config.developerToolPaths ?? []), ...imported.paths])];
      return saveChatServerConfig({ developerToolPaths: paths });
    },
    onSuccess: async (saved) => {
      queryClient.setQueryData(["chat-server-chat-config"], saved);
      await queryClient.invalidateQueries({ queryKey: ["developer-environment"] });
      setEnvironmentImportOpen(false);
    },
  });
  const activeSessionRef = useRef(sessionId);
  activeSessionRef.current = sessionId;
  const attachedStreamSessionRef = useRef<string | null>(null);
  const liveDraftsRef = useRef(new Map<string, UIMessage>());
  const [contextCompaction, setContextCompaction] = useState<ChatContextCompaction | null>(null);
  const [liveContextUsage, setLiveContextUsage] = useState<ChatContextUsage | null>(null);
  const [runProgress, setRunProgress] = useState<ChatRunProgress | null>(null);

  const startNewSession = useCallback(
    (nextWorkspaceId = "", nextWorkspaceCwd = "") => {
      const nextSessionId = createSessionId();
      const normalizedWorkspaceId = nextWorkspaceId === "default" ? "" : nextWorkspaceId;
      localSessionTransitionRef.current = {
        nextSessionId,
        previousSessionId: activeSessionRef.current,
      };
      setSessionId(nextSessionId);
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.set("sessionId", nextSessionId);
          if (normalizedWorkspaceId) {
            next.set("workspaceId", normalizedWorkspaceId);
          } else {
            next.delete("workspaceId");
          }
          if (nextWorkspaceCwd) {
            next.set("workspaceCwd", nextWorkspaceCwd);
          } else {
            next.delete("workspaceCwd");
          }
          return next;
        },
        { replace: true },
      );
      workspaceSelectionInitializedRef.current = true;
      setWorkspaceKey(normalizedWorkspaceId);
      setSessionCwd(nextWorkspaceCwd);
      const installed = new Set(installedSkillIds);
      setSelectedSkillIds(savedChatSkillIds.filter((id) => installed.has(id)));
      sessionCreatedAtRef.current = new Date().toISOString();
      sessionAttachmentsRef.current = [];
      setPlanMode("apply");
      setActivePlanId(undefined);
      setActivePlanHasContent(false);
      setPlans([]);
      for (const item of pendingAttachmentsRef.current) {
        if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
      }
      setPendingAttachments([]);
      pendingAttachmentsRef.current = [];
      pendingSessionRef.current = null;
      systemPromptRef.current = undefined;
      setSessionTitle("新对话");
      setSandboxMode(sandboxModeRef.current);
      savedFingerprintRef.current = "";
      extractedFingerprintRef.current = "";
      suppressSaveRef.current = false;
      setMessages([]);
      setInput("");
    },
    [installedSkillIds, savedChatSkillIds, setMessages, setSearchParams],
  );

  function selectWorkspace(nextWorkspaceValue: string) {
    const nextWorkspaceId = nextWorkspaceValue === "default" ? "" : nextWorkspaceValue;
    const nextWorkspace = workspaceProjects.find((project) => project.id === nextWorkspaceId);
    const nextWorkspaceCwd = nextWorkspace?.path ?? "";
    workspaceSelectionInitializedRef.current = true;
    setWorkspaceKey(nextWorkspaceId);
    setSessionCwd(nextWorkspaceCwd);
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (nextWorkspaceId) next.set("workspaceId", nextWorkspaceId);
        else next.delete("workspaceId");
        if (nextWorkspaceCwd) next.set("workspaceCwd", nextWorkspaceCwd);
        else next.delete("workspaceCwd");
        return next;
      },
      { replace: true },
    );
  }

  useEffect(() => {
    if (sessionId) attachedStreamSessionRef.current = null;
    setContextCompaction(null);
    setLiveContextUsage(null);
    setRunProgress(null);
  }, [sessionId]);

  useEffect(() => {
    if (status === "submitted") {
      setContextCompaction(null);
      setRunProgress(null);
    }
  }, [status]);

  useEffect(() => {
    // Stop consuming the previous browser stream when switching chats. The server run remains
    // active; its full message snapshots and text deltas restore the response when we return.
    const sessionToDetach = sessionId;
    return () => {
      if (sessionToDetach) stop();
    };
  }, [sessionId, stop]);

  useEffect(() => {
    let active = true;
    let cleanup: (() => void) | undefined;
    void loadChatServerPort().then((port) => {
      if (!active) return;
      cleanup = subscribeChatServerEvents(port, {
        onSnapshot: (sessions) => {
          setServerSessionStatuses(
            Object.fromEntries(sessions.map((session) => [session.id, session.status])),
          );
        },
        onStatus: ({ sessionId: eventSessionId, status: eventStatus }) => {
          setServerSessionStatuses((current) => ({
            ...current,
            [eventSessionId]: eventStatus,
          }));
        },
        onDelta: ({ sessionId: eventSessionId, runId, messageId, delta }) => {
          const next = appendLiveDraftText(
            liveDraftsRef.current.get(eventSessionId),
            messageId ?? runId ?? `run-${eventSessionId}`,
            delta,
          );
          liveDraftsRef.current.set(eventSessionId, next);

          if (
            activeSessionRef.current === eventSessionId &&
            attachedStreamSessionRef.current !== eventSessionId
          ) {
            setMessages((messages) => mergeLiveDraft(messages, next));
          }
        },
        onMessageUpdated: ({ sessionId: eventSessionId, message }) => {
          if (message) liveDraftsRef.current.set(eventSessionId, message);
          if (
            activeSessionRef.current === eventSessionId &&
            attachedStreamSessionRef.current !== eventSessionId &&
            message
          ) {
            setMessages((messages) => mergeLiveDraft(messages, message));
          }
        },
        onContextCompacted: ({ sessionId: eventSessionId, contextCompaction }) => {
          if (activeSessionRef.current === eventSessionId) {
            setContextCompaction(contextCompaction);
            setLiveContextUsage({
              inputTokens: contextCompaction.estimatedTokensAfter,
              source: "estimate",
              stepNumber: contextCompaction.stepNumber,
            });
          }
        },
        onContextUsage: ({ sessionId: eventSessionId, contextUsage }) => {
          if (activeSessionRef.current === eventSessionId) {
            setLiveContextUsage(contextUsage);
          }
        },
        onRunProgress: ({ sessionId: eventSessionId, runProgress: nextProgress }) => {
          if (activeSessionRef.current === eventSessionId && nextProgress) {
            setRunProgress(nextProgress);
          }
        },
        onPlanUpdated: ({
          sessionId: eventSessionId,
          planId,
          planFileName,
          planContent,
          planUpdatedAt,
        }) => {
          if (activeSessionRef.current !== eventSessionId || !planId) return;
          setPlans((current) =>
            current.map((plan) =>
              plan.id === planId
                ? {
                    ...plan,
                    fileName: planFileName ?? plan.fileName,
                    updatedAt: planUpdatedAt ?? plan.updatedAt,
                  }
                : plan,
            ),
          );
          if (planContent !== undefined) {
            if (activePlanIdRef.current === planId) {
              setActivePlanHasContent(Boolean(planContent.trim()));
            }
            updatePlanViewer({
              sessionId: eventSessionId,
              planId,
              fileName: planFileName ?? `plan-${planId}.md`,
              content: planContent,
            });
          }
        },
      });
    });
    return () => {
      active = false;
      cleanup?.();
    };
  }, [setMessages]);

  useEffect(() => {
    void loadChatDisplaySettings().then(setChatDisplay);
  }, []);

  const updateChatDisplay = (next: ChatDisplaySettings) => {
    setChatDisplay(next);
    void saveChatDisplaySettings(next);
  };

  const updateChatMemory = (next: ChatMemoryStore) => {
    queryClient.setQueryData(["chat-memory"], next);
    void saveChatMemory(next).catch((error) => console.error("Failed to save chat memory", error));
  };

  const updateChatTools = (next: ChatToolsSettings) => {
    queryClient.setQueryData(["chat-tools"], next);
    void saveChatToolsSettings(next).catch((error) =>
      console.error("Failed to save chat tools settings", error),
    );
  };

  const updateSandboxMode = (next: ChatSandboxMode) => {
    const normalized = normalizeChatSandboxMode(next);
    sandboxModeInitializedRef.current = true;
    setSandboxMode(normalized);
    queryClient.setQueryData(["chat-sandbox-mode"], normalized);
    void saveChatSandboxMode(normalized).catch((error) =>
      console.error("Failed to save global chat sandbox mode", error),
    );
  };

  const updateMcpSelection = (ids: string[]) => {
    const selected = new Set(ids);
    const next = mcpServers.map((server) => ({
      ...server,
      enabledByDefault: selected.has(server.id),
    }));
    queryClient.setQueryData(["mcp-servers"], next);
    void saveMcpServers(next).catch((error) => console.error("Failed to save MCP settings", error));
  };

  const updateSkillSelection = (ids: string[]) => {
    const installed = new Set(installedSkillIds);
    const next = [...new Set(ids)].filter((id) => installed.has(id));
    setSelectedSkillIds(next);
    queryClient.setQueryData(["chat-skills-selected"], next);
    void saveChatSkillSelection(next).catch((error) =>
      console.error("Failed to save chat skill selection", error),
    );
  };

  useEffect(() => {
    if (
      skillsSelectionInitializedRef.current ||
      installedSkillsQuery.isPending ||
      chatSkillSelectionQuery.isPending
    )
      return;
    const installed = new Set(installedSkillIds);
    setSelectedSkillIds(savedChatSkillIds.filter((id) => installed.has(id)));
    skillsSelectionInitializedRef.current = true;
  }, [
    chatSkillSelectionQuery.isPending,
    installedSkillIds,
    installedSkillsQuery.isPending,
    savedChatSkillIds,
  ]);

  const isGenerating = localRunActive || serverRunActive;
  const workspaceGitQuery = useQuery({
    queryKey: workspaceGitQueryKey(workspaceKey),
    queryFn: () => loadServerWorkspaceGit(workspaceKey),
    enabled: Boolean(workspaceKey),
    refetchInterval: isGenerating ? 15_000 : false,
    staleTime: 0,
    refetchOnWindowFocus: true,
  });
  const wasGeneratingRef = useRef(false);
  useEffect(() => {
    if (wasGeneratingRef.current && !isGenerating && workspaceKey) {
      void workspaceGitQuery.refetch();
    }
    wasGeneratingRef.current = isGenerating;
  }, [isGenerating, workspaceGitQuery.refetch, workspaceKey]);
  useEffect(() => {
    if (!workspaceKey) return;
    const refreshGitStatus = () => {
      if (document.visibilityState === "hidden") return;
      void workspaceGitQuery.refetch();
    };
    window.addEventListener("focus", refreshGitStatus);
    document.addEventListener("visibilitychange", refreshGitStatus);
    return () => {
      window.removeEventListener("focus", refreshGitStatus);
      document.removeEventListener("visibilitychange", refreshGitStatus);
    };
  }, [workspaceGitQuery.refetch, workspaceKey]);
  useEffect(() => {
    if (!isGenerating) {
      generationStartedAtRef.current = null;
      setGenerationElapsedSeconds(0);
      return;
    }

    generationStartedAtRef.current ??= Date.now();
    const updateElapsed = () => {
      const startedAt = generationStartedAtRef.current;
      if (startedAt !== null) {
        setGenerationElapsedSeconds(Math.floor((Date.now() - startedAt) / 1000));
      }
    };
    updateElapsed();
    const intervalId = window.setInterval(updateElapsed, 1000);
    return () => window.clearInterval(intervalId);
  }, [isGenerating]);

  const generationPhase =
    runProgress?.phase === "compacting"
      ? "正在生成检查点"
      : runProgress?.phase === "finalizing"
        ? "正在收尾"
        : runProgress?.planMode === "plan"
          ? "正在制定计划"
          : contextCompaction
            ? "正在生成检查点"
            : effectiveStatus === "submitted"
              ? "等待中"
              : "生成中";
  const generationElapsedLabel = formatGenerationElapsed(generationElapsedSeconds);
  const generationDetail =
    runProgress?.phase === "compacting"
      ? "正在保存目标、约束、事实和下一步"
      : runProgress?.phase === "finalizing"
        ? "工具已关闭，等待最终交接"
        : contextCompaction
          ? "已生成检查点，继续执行"
          : generationElapsedSeconds >= 10
            ? "响应较慢，仍在等待中"
            : "";
  const lastMessage = messages[messages.length - 1];
  const latestPersistedContextUsage = useMemo(() => {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const usage = getMessageContextUsage(messages[index]);
      if (usage) return usage;
    }
    return undefined;
  }, [messages]);
  const currentContextUsage = liveContextUsage ?? latestPersistedContextUsage;
  const hasAssistantMessage =
    lastMessage?.role === "assistant" && getChatMessageBlocks(lastMessage).length > 0;
  useEffect(() => {
    if (models.length > 0 && !models.some((model) => model.id === selectedModelId)) {
      setSelectedModelId(models.find((model) => model.isDefault)?.id ?? models[0].id);
    }
  }, [models, selectedModelId]);

  useEffect(() => {
    if (isChatHistoryLoading) return;
    let active = true;

    if (requestedSessionId) {
      const localTransition = localSessionTransitionRef.current;
      if (localTransition) {
        const isNewUrl = requestedSessionId === localTransition.nextSessionId;
        const isOldUrlWithNewState =
          requestedSessionId === localTransition.previousSessionId &&
          sessionId === localTransition.nextSessionId;
        if (isNewUrl || isOldUrlWithNewState) {
          if (isNewUrl && sessionId === localTransition.nextSessionId) {
            localSessionTransitionRef.current = null;
          }
          return;
        }
        if (sessionId === localTransition.nextSessionId) {
          localSessionTransitionRef.current = null;
        }
      }
      if (requestedSessionId === sessionId) {
        return;
      }
      void loadChatSession(requestedSessionId).then((session) => {
        if (!active) return;
        if (!session) {
          startNewSession(
            requestedWorkspaceId === "default" ? "" : (requestedWorkspaceId ?? ""),
            requestedWorkspaceCwd,
          );
          return;
        }
        savedFingerprintRef.current = "";
        extractedFingerprintRef.current = "";
        pendingSessionRef.current = session;
        setSessionId(session.id);
      });
      return () => {
        active = false;
      };
    }
    return () => {
      active = false;
    };
  }, [
    isChatHistoryLoading,
    requestedSessionId,
    requestedWorkspaceCwd,
    requestedWorkspaceId,
    sessionId,
    startNewSession,
  ]);

  useEffect(() => {
    if (isChatHistoryLoading || requestedSessionId || requestedWorkspaceId === null) return;
    startNewSession(
      requestedWorkspaceId === "default" ? "" : requestedWorkspaceId,
      requestedWorkspaceId === "default" ? "" : requestedWorkspaceCwd,
    );
  }, [
    isChatHistoryLoading,
    requestedSessionId,
    requestedWorkspaceCwd,
    requestedWorkspaceId,
    startNewSession,
  ]);

  useEffect(() => {
    if (
      isChatHistoryLoading ||
      requestedSessionId ||
      requestedWorkspaceId !== null ||
      searchParams.get("sessionId") === sessionId
    )
      return;
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.set("sessionId", sessionId);
        return next;
      },
      { replace: true },
    );
  }, [
    isChatHistoryLoading,
    requestedSessionId,
    requestedWorkspaceId,
    searchParams,
    sessionId,
    setSearchParams,
  ]);

  useEffect(() => {
    const session = pendingSessionRef.current;
    if (
      !session ||
      session.id !== sessionId ||
      installedSkillsQuery.isPending ||
      chatSkillSelectionQuery.isPending
    )
      return;
    pendingSessionRef.current = null;
    workspaceSelectionInitializedRef.current = true;
    suppressSaveRef.current = true;
    setSessionTitle(session.title);
    setWorkspaceKey(session.workspaceId ?? "");
    setSessionCwd(session.cwd ?? "");
    systemPromptRef.current = session.systemPrompt;
    sessionCreatedAtRef.current = session.createdAt;
    sessionAttachmentsRef.current = session.attachments;
    const lastSessionMessage = session.messages[session.messages.length - 1];
    if (
      lastSessionMessage?.role === "assistant" &&
      lastSessionMessage.id &&
      !liveDraftsRef.current.has(session.id)
    ) {
      liveDraftsRef.current.set(session.id, lastSessionMessage);
    }
    shouldFollowScrollRef.current = true;
    setMessages(mergeLiveDraft(session.messages, liveDraftsRef.current.get(session.id)));
    requestAnimationFrame(() => {
      if (activeSessionRef.current !== session.id) return;
      const scrollElement = scrollRef.current;
      if (scrollElement) scrollChatToBottom(scrollElement);
    });
    if (session.modelId) setSelectedModelId(session.modelId);
    const sessionSkillIds = session.skillIds ?? savedChatSkillIds;
    setSelectedSkillIds(sessionSkillIds.filter((id) => installedSkillIds.includes(id)));
    setPlanMode(session.planMode ?? "apply");
    setActivePlanId(session.activePlanId);
    setActivePlanHasContent(false);
    setPlans(session.plans ?? []);
    void loadChatPlans(session.id)
      .then((nextPlans) => {
        if (activeSessionRef.current === session.id) setPlans(nextPlans);
      })
      .catch((error) => console.error("Failed to load chat plans", error));
    if (session.activePlanId) {
      const restoredPlanId = session.activePlanId;
      void loadChatPlan(session.id, restoredPlanId)
        .then((plan) => {
          if (
            activeSessionRef.current === session.id &&
            activePlanIdRef.current === restoredPlanId
          ) {
            setActivePlanHasContent(Boolean(plan.content.trim()));
          }
        })
        .catch((error) => console.error("Failed to load active chat plan", error));
    }
  }, [
    chatSkillSelectionQuery.isPending,
    installedSkillIds,
    installedSkillsQuery.isPending,
    savedChatSkillIds,
    sessionId,
    setMessages,
  ]);

  useEffect(() => {
    if (sandboxModeInitializedRef.current || chatSandboxModeQuery.isPending) return;
    setSandboxMode(normalizeChatSandboxMode(chatSandboxModeQuery.data));
    sandboxModeInitializedRef.current = true;
  }, [chatSandboxModeQuery.data, chatSandboxModeQuery.isPending]);

  useEffect(() => {
    if (
      status !== "ready" ||
      serverRunActive ||
      serverSessionStatus === "error" ||
      messages.length === 0
    )
      return;
    if (suppressSaveRef.current) {
      suppressSaveRef.current = false;
      return;
    }
    const lastMessage = messages[messages.length - 1];
    if (
      lastMessage?.role !== "assistant" ||
      (!messageText(lastMessage).trim() && !messageHasToolParts(lastMessage))
    ) {
      return;
    }
    const usage = getMessageUsage(lastMessage);
    const usageKey = usage
      ? `${usage.inputTokens ?? ""}:${usage.outputTokens ?? ""}:${usage.totalTokens ?? ""}`
      : "";
    const fingerprint = `${sessionId}:${messages.length}:${lastMessage.id}:${messageText(lastMessage)}:${usageKey}`;
    if (savedFingerprintRef.current === fingerprint) return;
    savedFingerprintRef.current = fingerprint;
    const now = new Date().toISOString();
    const title = deriveChatTitle(messages);
    setSessionTitle(title);
    void (async () => {
      try {
        const canonicalSession = await waitForCanonicalSession(sessionId, messageText(lastMessage));
        if (!canonicalSession) throw new Error("Chat Server 未返回 canonical 会话");
        const canonicalMessages = canonicalSession.messages;
        systemPromptRef.current = canonicalSession.systemPrompt;
        sessionAttachmentsRef.current = canonicalSession.attachments;
        const materialized = await materializeGeneratedImages(
          sessionId,
          canonicalMessages,
          canonicalSession.attachments,
        );
        sessionAttachmentsRef.current = materialized.attachments;
        if (materialized.changed) {
          await saveChatSession({
            ...canonicalSession,
            title: deriveChatTitle(materialized.messages),
            updatedAt: now,
            messages: materialized.messages,
            attachments: materialized.attachments,
          });
          suppressSaveRef.current = true;
          setMessages(materialized.messages);
        } else if (
          messages.length !== canonicalMessages.length ||
          messages.some((message, index) => message.id !== canonicalMessages[index]?.id)
        ) {
          suppressSaveRef.current = true;
          setMessages(canonicalMessages);
        }
        void queryClient.invalidateQueries({ queryKey: ["chat-index"] });
        if (extractedFingerprintRef.current === fingerprint) return;
        extractedFingerprintRef.current = fingerprint;
        const lastUser = [...canonicalMessages]
          .reverse()
          .find((message) => message.role === "user");
        const canonicalLastMessage = [...canonicalMessages]
          .reverse()
          .find((message) => message.role === "assistant");
        scheduleMemoryUpdateFromTurn({
          model: selectedModel,
          sessionId,
          userText: lastUser ? messageText(lastUser) : "",
          assistantText: canonicalLastMessage ? messageText(canonicalLastMessage) : "",
          workspacePath: selectedCwd,
          toolNames: (canonicalLastMessage?.parts ?? [])
            .filter(isToolUIPart)
            .map((part) => getToolName(part))
            .filter(isWorkspaceMemoryExcludedTool),
          onStoreChange: (store) => {
            queryClient.setQueryData(["chat-memory"], store);
          },
        });
      } catch (saveError) {
        console.error("Failed to save chat session", saveError);
      }
    })();
  }, [
    messages,
    queryClient,
    selectedCwd,
    selectedModel,
    serverRunActive,
    serverSessionStatus,
    sessionId,
    status,
    setMessages,
  ]);

  useEffect(() => {
    const scrollElement = scrollRef.current;
    if (!scrollElement) return;

    const updateFollowState = () => {
      const distanceFromBottom =
        scrollElement.scrollHeight - scrollElement.scrollTop - scrollElement.clientHeight;
      shouldFollowScrollRef.current = distanceFromBottom <= 72;
    };
    let scrollFrame: number | null = null;
    const followContentGrowth = () => {
      if (!shouldFollowScrollRef.current || scrollFrame !== null) return;
      scrollFrame = requestAnimationFrame(() => {
        scrollFrame = null;
        if (shouldFollowScrollRef.current) scrollChatToBottom(scrollElement);
      });
    };
    const resizeObserver = new ResizeObserver(followContentGrowth);
    const content = scrollElement.firstElementChild;
    if (content) resizeObserver.observe(content);
    scrollElement.addEventListener("scroll", updateFollowState, { passive: true });
    followContentGrowth();

    return () => {
      if (scrollFrame !== null) cancelAnimationFrame(scrollFrame);
      resizeObserver.disconnect();
      scrollElement.removeEventListener("scroll", updateFollowState);
    };
  }, []);

  const addFiles = useCallback(
    async (fileList: FileList | File[]) => {
      const files = Array.from(fileList);
      if (files.length === 0) return;
      const current = pendingAttachmentsRef.current;
      const accepted: PendingAttachment[] = [];
      for (const file of files) {
        const error = validateAttachment(file, current.length + accepted.length);
        if (error) {
          console.warn(error);
          continue;
        }
        accepted.push(createPendingAttachment(file));
      }
      if (accepted.length === 0) return;
      const next = [...current, ...accepted];
      setPendingAttachments(next);
      pendingAttachmentsRef.current = next;
      const sessionIdValue = sessionId;
      try {
        await initializeChatServer();
        await ensureChatServerSession(sessionIdValue, {
          cwd: selectedCwd || undefined,
          workspaceId: workspaceKey || undefined,
        });
      } catch (error) {
        console.error("Failed to ensure chat server session for attachment upload", error);
      }
      for (const pending of accepted) {
        uploadPendingAttachment(sessionIdValue, pending)
          .then((attachment) => {
            setPendingAttachments((prev) =>
              prev.map((item) =>
                item.localId === pending.localId
                  ? {
                      ...item,
                      status: "ready" as const,
                      attachmentId: attachment.id,
                      path: attachment.path,
                    }
                  : item,
              ),
            );
          })
          .catch((error) => {
            console.error("Failed to upload attachment", pending.fileName, error);
            setPendingAttachments((prev) =>
              prev.map((item) =>
                item.localId === pending.localId
                  ? { ...item, status: "error" as const, error: "上传失败" }
                  : item,
              ),
            );
          });
      }
    },
    [sessionId, selectedCwd, workspaceKey],
  );

  const removePendingAttachment = useCallback((localId: string) => {
    setPendingAttachments((prev) => {
      const target = prev.find((item) => item.localId === localId);
      if (target?.previewUrl) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((item) => item.localId !== localId);
    });
  }, []);

  function handleDragEnter(event: React.DragEvent<HTMLDivElement>) {
    if (!event.dataTransfer.types.includes("Files")) return;
    event.preventDefault();
    dragCounterRef.current += 1;
    setIsDragOver(true);
  }

  function handleDragOver(event: React.DragEvent<HTMLDivElement>) {
    if (!event.dataTransfer.types.includes("Files")) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  }

  function handleDragLeave(event: React.DragEvent<HTMLDivElement>) {
    if (!event.dataTransfer.types.includes("Files")) return;
    event.preventDefault();
    dragCounterRef.current -= 1;
    if (dragCounterRef.current <= 0) {
      dragCounterRef.current = 0;
      setIsDragOver(false);
    }
  }

  function handleDrop(event: React.DragEvent<HTMLDivElement>) {
    if (!event.dataTransfer.types.includes("Files")) return;
    event.preventDefault();
    dragCounterRef.current = 0;
    setIsDragOver(false);
    if (event.dataTransfer.files.length > 0) {
      void addFiles(event.dataTransfer.files);
    }
  }

  async function enterPlanMode() {
    if (isGenerating) return;
    const requestId = ++planCreationRequestRef.current;
    const previousMode = planModeRef.current;
    const previousPlanId = activePlanIdRef.current;
    const previousHasContent = activePlanHasContent;
    planModeRef.current = "plan";
    activePlanIdRef.current = undefined;
    setPlanMode("plan");
    setActivePlanId(undefined);
    setActivePlanHasContent(false);
    try {
      await initializeChatServer();
      await ensureChatServerSession(sessionId, {
        cwd: selectedCwd || undefined,
        workspaceId: workspaceKey || undefined,
      });
      const plan = await createChatPlan(sessionId);
      const summary: ChatPlanSummary = {
        id: plan.id,
        fileName: plan.fileName,
        createdAt: plan.createdAt,
        updatedAt: plan.updatedAt,
      };
      setPlans((current) => [summary, ...current.filter((item) => item.id !== summary.id)]);
      void queryClient.invalidateQueries({ queryKey: ["chat-plans", sessionId] });
      if (planCreationRequestRef.current !== requestId) {
        if ((planModeRef.current as ChatPlanMode) === "apply") {
          void updateChatPlanMode(sessionId, "apply", plan.id).catch((planError) =>
            console.error("Failed to keep plan mode closed", planError),
          );
        }
        return;
      }
      activePlanIdRef.current = plan.id;
      setActivePlanId(plan.id);
      setActivePlanHasContent(false);
      if (planModeRef.current !== "plan") {
        void updateChatPlanMode(sessionId, "apply", plan.id).catch((planError) =>
          console.error("Failed to keep plan mode closed", planError),
        );
      }
    } catch (planError) {
      if (planCreationRequestRef.current !== requestId) return;
      planModeRef.current = previousMode;
      activePlanIdRef.current = previousPlanId;
      setPlanMode(previousMode);
      setActivePlanId(previousPlanId);
      setActivePlanHasContent(previousHasContent);
      console.error("Failed to enter plan mode", planError);
    }
  }

  function exitPlanMode() {
    planCreationRequestRef.current += 1;
    planModeRef.current = "apply";
    setPlanMode("apply");
    void updateChatPlanMode(sessionId, "apply", activePlanIdRef.current).catch((planError) =>
      console.error("Failed to exit plan mode", planError),
    );
  }

  function isPlanConfirmation(text: string) {
    return /^(开始执行|确认执行|按计划执行|开始实施|执行计划|apply)$/i.test(text.trim());
  }

  function confirmPlanExecution() {
    if (!activePlanIdRef.current || isGenerating) return;
    planModeRef.current = "apply";
    setPlanMode("apply");
    setInput("");
    sendMessage({ text: "确认开始执行当前计划，请按计划修改代码并完成必要验证。" });
  }

  function submitMessage() {
    const text = input.trim();
    const pending = pendingAttachmentsRef.current;
    const hasUploading = pending.some((item) => item.status === "uploading");
    if (isGenerating || hasUploading) return;
    if (text === "/plan") {
      setInput("");
      setCommandCaret(0);
      setCommandDismissed(true);
      void enterPlanMode();
      return;
    }
    if (text.startsWith("/plan ")) {
      const remaining = text.slice("/plan ".length);
      setInput(remaining);
      setCommandCaret(remaining.length);
      setCommandDismissed(true);
      void enterPlanMode();
      return;
    }
    if (planModeRef.current === "plan" && isPlanConfirmation(text)) {
      confirmPlanExecution();
      return;
    }
    if (!text && pending.length === 0) return;
    const readyPending = pending.filter((item) => item.status === "ready");
    if (readyPending.length > 0) {
      const chatAttachments: ChatAttachment[] = readyPending.map((item) => ({
        id: item.attachmentId ?? "",
        kind: item.kind,
        mediaType: item.mediaType,
        fileName: item.fileName,
        size: item.size,
        path: item.path ?? "",
        source: "upload",
        createdAt: new Date().toISOString(),
      }));
      sessionAttachmentsRef.current = mergeChatAttachments(
        sessionAttachmentsRef.current,
        chatAttachments,
      );
    }
    const filesToSend = readyPending.map((item) => item.file);
    for (const item of pending) {
      if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
    }
    setPendingAttachments([]);
    pendingAttachmentsRef.current = [];
    setInput("");
    setContextCompaction(null);
    shouldFollowScrollRef.current = true;
    liveDraftsRef.current.delete(sessionId);
    attachedStreamSessionRef.current = sessionId;
    if (filesToSend.length > 0) {
      void (async () => {
        const files: FileUIPart[] = [];
        for (const file of filesToSend) {
          try {
            const dataUrl = await fileToDataUrl(file);
            files.push({
              type: "file",
              mediaType: file.type || "application/octet-stream",
              filename: file.name,
              url: dataUrl,
            });
          } catch (error) {
            console.error("Failed to convert file to data URL", file.name, error);
          }
        }
        if (text) {
          await sendMessage({ text, files });
        } else {
          await sendMessage({ files });
        }
      })();
    } else {
      void sendMessage({ text });
    }
  }

  function stopCurrentRun() {
    stop();
    void stopChatServerRun(sessionId).catch((error) => {
      console.error("Failed to stop Chat Server run", error);
    });
  }

  const respondToApproval = useCallback(
    (id: string, approved: boolean) => {
      void addToolApprovalResponse({
        id,
        approved,
        reason: approved ? undefined : "用户拒绝了此次操作",
      });
    },
    [addToolApprovalResponse],
  );

  function openSession(item: ChatIndexItem) {
    if (item.id === sessionId) return;
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.set("sessionId", item.id);
        next.delete("workspaceId");
        next.delete("workspaceCwd");
        return next;
      },
      { replace: true },
    );
  }

  async function copyConversationId() {
    if (!navigator.clipboard) return;
    try {
      await navigator.clipboard.writeText(sessionId);
      setConversationIdCopied(true);
      window.setTimeout(() => setConversationIdCopied(false), 1500);
    } catch {
      setConversationIdCopied(false);
    }
  }

  function keepConversationMenuOpen() {
    if (conversationMenuCloseTimerRef.current !== null) {
      window.clearTimeout(conversationMenuCloseTimerRef.current);
      conversationMenuCloseTimerRef.current = null;
    }
    setConversationMenuOpen(true);
  }

  function scheduleConversationMenuClose() {
    if (conversationMenuCloseTimerRef.current !== null) {
      window.clearTimeout(conversationMenuCloseTimerRef.current);
    }
    conversationMenuCloseTimerRef.current = window.setTimeout(() => {
      conversationMenuCloseTimerRef.current = null;
      setConversationMenuOpen(false);
    }, 140);
  }

  async function confirmRemoveSession() {
    const item = sessionToDelete;
    if (!item) return;
    try {
      await deleteChatSession(item.id);
      await queryClient.invalidateQueries({ queryKey: ["chat-index"] });
      if (item.id === sessionId) startNewSession();
    } catch (deleteError) {
      console.error("Failed to delete chat session", deleteError);
    } finally {
      setSessionToDelete(null);
    }
  }

  const commandTrigger = useMemo(
    () => findActiveCommandTrigger(input, commandCaret),
    [input, commandCaret],
  );
  const commandQuery = commandTrigger?.query ?? "";
  const commandMatches = useMemo(
    () => (commandTrigger ? filterChatCommands(commandTrigger.query) : []),
    [commandTrigger],
  );
  const commandPopupOpen =
    Boolean(commandTrigger) && commandMatches.length > 0 && !commandDismissed;
  const activeCommand = commandPopupOpen
    ? commandMatches[Math.min(commandIndex, commandMatches.length - 1)]
    : undefined;

  // biome-ignore lint/correctness/useExhaustiveDependencies: 查询串变化时需要重置 popup 选中与关闭状态
  useEffect(() => {
    setCommandIndex(0);
    setCommandDismissed(false);
  }, [commandQuery]);

  function applyChatCommand(command: ChatCommand) {
    const trigger = findActiveCommandTrigger(input, commandCaret);
    if (!trigger) return;
    if (command.name === "/plan") {
      const remaining = `${input.slice(0, trigger.start)}${input.slice(commandCaret)}`;
      setInput(remaining);
      setCommandCaret(Math.min(trigger.start, remaining.length));
      setCommandDismissed(true);
      void enterPlanMode();
      return;
    }
    const caret = trigger.start + command.name.length + 1;
    setInput(`${input.slice(0, trigger.start)}${command.name} ${input.slice(commandCaret)}`);
    setCommandCaret(caret);
    setCommandDismissed(true);
    requestAnimationFrame(() => {
      const textarea = inputRef.current;
      if (!textarea) return;
      textarea.focus();
      textarea.setSelectionRange(caret, caret);
    });
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (
      commandPopupOpen &&
      !event.nativeEvent.isComposing &&
      event.keyCode !== 229 &&
      !isComposingRef.current
    ) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const count = commandMatches.length;
        setCommandIndex((current) =>
          event.key === "ArrowDown" ? (current + 1) % count : (current - 1 + count) % count,
        );
        return;
      }
      if ((event.key === "Enter" || event.key === "Tab") && activeCommand) {
        event.preventDefault();
        applyChatCommand(activeCommand);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        setCommandDismissed(true);
        return;
      }
    }
    if (
      event.key === "Enter" &&
      !event.shiftKey &&
      !event.nativeEvent.isComposing &&
      event.keyCode !== 229 &&
      !isComposingRef.current
    ) {
      event.preventDefault();
      submitMessage();
    }
  }

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: drag-and-drop file upload zone; keyboard users use the attach button
    <div
      className="chat-page"
      data-chat-empty={messages.length === 0 ? "true" : "false"}
      data-chat-font-size={chatDisplay.fontSize}
      data-chat-spacing={chatDisplay.spacing}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {isDragOver && (
        <div className="chat-drag-overlay">
          <div className="chat-drag-overlay-card">
            <Upload className="size-7" />
            <p>松开以上传文件</p>
          </div>
        </div>
      )}
      <header className="chat-header">
        <div className="chat-brand">
          <div className="chat-brand-mark">
            <Sparkles className="size-4" />
          </div>
          <div className="chat-brand-title">
            <p className="chat-kicker">Workspace assistant</p>
            <div className="chat-brand-title-row">
              <h1>{sessionTitle}</h1>
              <DropdownMenu
                modal={false}
                open={conversationMenuOpen}
                onOpenChange={(open) => {
                  if (open) keepConversationMenuOpen();
                  else scheduleConversationMenuClose();
                }}
              >
                <DropdownMenuTrigger asChild>
                  <Button
                    aria-label="对话操作"
                    className="chat-title-action"
                    size="icon"
                    title="对话操作"
                    type="button"
                    variant="ghost"
                    onPointerEnter={keepConversationMenuOpen}
                    onPointerLeave={scheduleConversationMenuClose}
                  >
                    <MoreHorizontal className="size-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="start"
                  onPointerEnter={keepConversationMenuOpen}
                  onPointerLeave={scheduleConversationMenuClose}
                  sideOffset={6}
                >
                  <DropdownMenuItem onSelect={() => void copyConversationId()}>
                    {conversationIdCopied ? (
                      <Check className="size-4 text-primary" />
                    ) : (
                      <Copy className="size-4" />
                    )}
                    {conversationIdCopied ? "已复制对话 ID" : "复制对话 ID"}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </div>
        <div className="chat-header-actions">
          <Button
            aria-label="新建对话"
            className="chat-icon-button"
            size="icon"
            variant="ghost"
            type="button"
            onClick={() => startNewSession(workspaceKey, selectedCwd)}
          >
            <Plus className="size-4" />
          </Button>
          <Button
            aria-label="查看 System Prompt"
            className="chat-header-action-secondary chat-icon-button"
            onClick={() => setContextOpen(true)}
            size="icon"
            title="查看 System Prompt"
            type="button"
            variant="ghost"
          >
            <FileText className="size-4" />
          </Button>
          <Button
            aria-label="Tool 记录"
            className="chat-header-action-secondary chat-icon-button"
            size="icon"
            title="查看当前对话的 Tool 记录"
            variant="ghost"
            type="button"
            onClick={() => setToolLogOpen(true)}
          >
            <Wrench className="size-4" />
          </Button>
          <Button
            aria-label="长期记忆"
            className="chat-header-action-secondary chat-icon-button"
            size="icon"
            variant="ghost"
            type="button"
            onClick={() => setMemoryOpen(true)}
          >
            <Brain className="size-4" />
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                aria-label="提交或推送 Git 改动"
                className="chat-header-action-secondary chat-icon-button"
                disabled={
                  !workspaceKey ||
                  !(
                    (workspaceGitQuery.data?.summary?.filesChanged ?? 0) > 0 ||
                    (workspaceGitQuery.data?.summary?.ahead ?? 0) > 0
                  )
                }
                size="icon"
                title="提交或推送 Git 改动"
                type="button"
                variant="ghost"
              >
                <Upload className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="chat-select-menu" sideOffset={8}>
              <DropdownMenuItem onSelect={() => setGitCommitOpen(true)}>
                <Upload className="size-3.5" />
                提交或推送
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                aria-label="更多选项"
                className="chat-icon-button"
                size="icon"
                variant="ghost"
                type="button"
              >
                <History className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="chat-history-menu" sideOffset={8}>
              <DropdownMenuLabel>
                <span className="chat-history-menu-label">
                  <History className="size-3.5" />
                  历史对话
                </span>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              {isChatHistoryLoading && <DropdownMenuItem disabled>加载中...</DropdownMenuItem>}
              {!isChatHistoryLoading && chatIndex.length === 0 && (
                <DropdownMenuItem disabled>暂无历史对话</DropdownMenuItem>
              )}
              {chatIndex.map((item) => (
                <div className="chat-history-menu-item" key={item.id}>
                  <button
                    className="chat-history-menu-open"
                    type="button"
                    onClick={() => openSession(item)}
                  >
                    <span className="min-w-0">
                      <span className="chat-history-menu-title block">{item.title}</span>
                      {item.cwd ? (
                        <span className="block truncate text-[10px] text-muted-foreground">
                          {pathBasename(item.cwd)}
                        </span>
                      ) : null}
                    </span>
                    <span className="chat-history-menu-count">{item.messageCount}</span>
                  </button>
                  <span className="chat-history-menu-actions">
                    <button
                      aria-label={`删除${item.title}`}
                      className="chat-history-menu-delete"
                      title="删除对话"
                      type="button"
                      onClick={() => setSessionToDelete(item)}
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </span>
                </div>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <Button
            aria-label="显示设置"
            className="chat-icon-button"
            size="icon"
            variant="ghost"
            type="button"
            onClick={() => setSettingsOpen(true)}
          >
            <Settings className="size-4" />
          </Button>
        </div>
      </header>

      <div className="chat-stage" ref={scrollRef}>
        <div className="chat-content">
          {messages.length > 0 ? (
            <div className="chat-context-row">
              <span className="chat-status-dot" />
              <span>{selectedModel?.provider ?? "未配置模型"}</span>
              <span className="chat-context-rule" />
              <span className="truncate" title={selectedCwd || undefined}>
                {selectedCwd ? pathBasename(selectedCwd) : DEFAULT_WORKSPACE_LABEL}
              </span>
              <span
                className="chat-access-badge"
                title={CHAT_SANDBOX_MODE_DESCRIPTIONS[sandboxMode]}
              >
                {CHAT_SANDBOX_MODE_LABELS[sandboxMode]}
              </span>
            </div>
          ) : null}
          {messages.length === 0 ? (
            <div className="chat-empty-state">
              <div aria-hidden="true" className="chat-empty-mark">
                <Sparkles className="size-8" strokeWidth={1.6} />
              </div>
              <h2>要在 {workspaceLabel} 内开发什么？</h2>
              <div className="chat-suggestion-grid">
                {EMPTY_CHAT_ACTIONS.map((action) => {
                  const Icon = action.icon;
                  return (
                    <button
                      className={`chat-suggestion-card is-${action.accent}`}
                      key={action.label}
                      onClick={() => {
                        setInput(action.prompt);
                        requestAnimationFrame(() => inputRef.current?.focus());
                      }}
                      type="button"
                    >
                      <Icon aria-hidden="true" className="size-[18px]" strokeWidth={1.8} />
                      <span>{action.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}
          {messages.map((message) => (
            <MessageBubble
              key={message.id}
              message={message}
              onApprovalResponse={respondToApproval}
              generationStatus={
                isGenerating && message.role === "assistant" && message.id === lastMessage?.id
                  ? {
                      detail: generationDetail,
                      elapsedLabel: generationElapsedLabel,
                      phase: generationPhase,
                    }
                  : undefined
              }
              isStreaming={effectiveStatus === "streaming" && message.id === lastMessage?.id}
              showTokenUsage={chatDisplay.showTokenUsage}
              cwd={selectedCwd}
              workspaceId={workspaceKey || undefined}
            />
          ))}
          {activePlan && activePlanHasContent ? (
            <div className="chat-plan-indicator">
              <Button
                aria-label={`打开 ${activePlan.fileName}`}
                className="chat-plan-indicator-button"
                onClick={() => {
                  void loadChatPlan(sessionId, activePlan.id)
                    .then((plan) =>
                      openPlanViewer({
                        sessionId,
                        planId: plan.id,
                        fileName: plan.fileName,
                        content: plan.content,
                      }),
                    )
                    .catch((error) => console.error("Failed to open chat plan", error));
                }}
                size="sm"
                type="button"
                variant="outline"
              >
                <FileText className="size-3.5" />
                {activePlan.fileName}
              </Button>
            </div>
          ) : null}
          {developerEnvironmentQuery.data &&
          unavailableDetectedTools.length > 0 &&
          environmentGuideKey !== dismissedEnvironmentGuide ? (
            <div
              aria-live="polite"
              className="mx-11 flex flex-col gap-3 border-border border-y bg-muted/35 px-4 py-3 sm:flex-row sm:items-center"
            >
              <CircleAlert className="size-4 shrink-0 text-primary" />
              <div className="min-w-0 flex-1">
                <p className="font-medium text-sm">本地开发工具尚未接入</p>
                <p className="mt-0.5 text-muted-foreground text-xs">
                  终端找不到 {unavailableDetectedTools.join("、")}。导入后可重新运行当前任务。
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <Button onClick={() => setEnvironmentImportOpen(true)} size="sm" type="button">
                  <Download className="size-3.5" /> 导入本机工具
                </Button>
                <Button asChild size="sm" type="button" variant="ghost">
                  <Link to="/settings/environment">
                    <Settings className="size-3.5" /> 环境设置
                  </Link>
                </Button>
                <Button
                  aria-label="关闭环境提示"
                  onClick={() => setDismissedEnvironmentGuide(environmentGuideKey)}
                  size="icon"
                  title="关闭"
                  type="button"
                  variant="ghost"
                >
                  <X className="size-3.5" />
                </Button>
              </div>
            </div>
          ) : null}
          {isGenerating && !hasAssistantMessage && (
            <div className="chat-message assistant-message">
              <div className="chat-avatar assistant-avatar">
                <Bot className="size-4" />
              </div>
              <div className="chat-message-body">
                <div className="chat-message-meta">
                  <strong>ChatDesk</strong>
                  <ChatGenerationStatus
                    detail={generationDetail}
                    elapsedLabel={generationElapsedLabel}
                    phase={generationPhase}
                  />
                </div>
                <div className="chat-thinking">
                  <span />
                  <span />
                  <span />
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="chat-composer-wrap">
        <div className="chat-composer-floats">
          {workspaceGitQuery.data?.summary &&
          workspaceGitQuery.data.isRepository &&
          workspaceGitQuery.data.summary.filesChanged > 0 ? (
            <ChatGitSummary
              summary={workspaceGitQuery.data.summary}
              onOpenDiff={async () => {
                const result = await workspaceGitQuery.refetch();
                const firstFile = result.data?.summary?.files[0];
                if (firstFile) {
                  openFileViewer({
                    mode: "diff",
                    path: firstFile.path,
                    workspaceId: workspaceKey,
                    cwd: selectedCwd,
                  });
                }
              }}
            />
          ) : null}
          <ChatTodoPanel messages={messages} />
          {planMode === "plan" && activePlan && activePlanHasContent ? (
            <Button
              aria-label="开始计划"
              className="chat-plan-apply-button"
              disabled={isGenerating}
              onClick={confirmPlanExecution}
              size="sm"
              type="button"
            >
              <ArrowUp className="size-3.5" />
              开始计划
            </Button>
          ) : null}
        </div>
        {error && <p className="chat-error">{error.message}</p>}
        <div className="chat-workspace-bar">
          {messages.length === 0 ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  aria-label="选择工作区"
                  className="chat-workspace-picker"
                  title="选择工作区"
                  type="button"
                >
                  <Folder aria-hidden="true" className="size-3.5" />
                  <span>{workspaceLabel}</span>
                  <ChevronDown aria-hidden="true" className="size-3.5" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="start"
                className="chat-select-menu chat-workspace-select-menu"
                side="top"
                sideOffset={8}
              >
                <DropdownMenuLabel>工作区</DropdownMenuLabel>
                <DropdownMenuRadioGroup
                  value={workspaceKey || "default"}
                  onValueChange={selectWorkspace}
                >
                  <DropdownMenuRadioItem value="default">
                    <span className="chat-workspace-option-label">{DEFAULT_WORKSPACE_LABEL}</span>
                  </DropdownMenuRadioItem>
                  {workspaceProjects.map((project) => (
                    <DropdownMenuRadioItem key={project.id} value={project.id}>
                      <span className="chat-workspace-option-label">
                        {pathBasename(project.path)}
                      </span>
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
          <span>
            <Laptop aria-hidden="true" className="size-3.5" />
            本地
          </span>
          <span>
            <GitBranch aria-hidden="true" className="size-3.5" />
            main
          </span>
        </div>
        <div className="chat-composer">
          <input
            aria-hidden="true"
            className="chat-file-input"
            multiple
            onChange={(event) => {
              if (event.target.files && event.target.files.length > 0) {
                void addFiles(event.target.files);
              }
              event.target.value = "";
            }}
            ref={fileInputRef}
            tabIndex={-1}
            type="file"
          />
          <ChatAttachmentChips
            attachments={pendingAttachments}
            onPreview={(attachment) => {
              if (!attachment.previewUrl) return;
              openImagePreview({
                url: attachment.previewUrl,
                filename: attachment.fileName,
                mediaType: attachment.mediaType,
              });
            }}
            onRemove={removePendingAttachment}
          />
          {commandPopupOpen && (
            <ChatCommandPopup
              activeIndex={Math.min(commandIndex, commandMatches.length - 1)}
              commands={commandMatches}
              onHover={setCommandIndex}
              onSelect={applyChatCommand}
            />
          )}
          <textarea
            aria-autocomplete="list"
            aria-controls="chat-command-popup"
            aria-expanded={commandPopupOpen}
            aria-label="输入消息"
            autoCapitalize="none"
            autoCorrect="off"
            ref={inputRef}
            role="combobox"
            spellCheck={false}
            value={input}
            onChange={(event) => {
              setInput(event.target.value);
              setCommandCaret(event.target.selectionStart ?? event.target.value.length);
            }}
            onClick={(event) => setCommandCaret(event.currentTarget.selectionStart ?? 0)}
            onKeyUp={(event) => setCommandCaret(event.currentTarget.selectionStart ?? 0)}
            onBlur={() => setCommandDismissed(true)}
            onCompositionStart={() => {
              isComposingRef.current = true;
            }}
            onCompositionEnd={() => {
              isComposingRef.current = false;
            }}
            onKeyDown={handleKeyDown}
            onPaste={(event) => {
              const files = Array.from(event.clipboardData.files);
              if (files.length > 0) {
                event.preventDefault();
                void addFiles(files);
              }
            }}
            placeholder="问问你的工作空间..."
            rows={2}
          />
          <div className="chat-composer-footer">
            <div className="chat-composer-tools">
              <Button
                aria-label="添加附件"
                className="chat-tool-button !size-7"
                onClick={() => fileInputRef.current?.click()}
                size="icon"
                type="button"
                variant="ghost"
              >
                <Paperclip className="size-4" />
              </Button>
              {planMode === "plan" ? (
                <span aria-label="Plan mode" className="chat-plan-mode-chip" role="status">
                  <span>Plan mode</span>
                  <button
                    aria-label="退出 Plan mode"
                    className="chat-plan-mode-exit"
                    onClick={exitPlanMode}
                    title="退出 Plan mode"
                    type="button"
                  >
                    <X className="size-3" />
                  </button>
                </span>
              ) : null}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    aria-label="Sandbox permissions"
                    className="chat-sandbox-picker !h-7 !gap-1.5 !px-2 !text-[11px]"
                    title="Sandbox permissions"
                    type="button"
                  >
                    <ShieldCheck className="size-3.5" />
                    <span className="chat-picker-value !text-[11px]">
                      {CHAT_SANDBOX_MODE_LABELS[sandboxMode]}
                    </span>
                    <ChevronDown className="size-3.5" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="start"
                  className="chat-select-menu !text-[11px]"
                  side="top"
                  sideOffset={8}
                >
                  <DropdownMenuRadioGroup
                    value={sandboxMode}
                    onValueChange={(value) => updateSandboxMode(normalizeChatSandboxMode(value))}
                  >
                    {Object.entries(CHAT_SANDBOX_MODE_LABELS).map(([value, label]) => (
                      <DropdownMenuRadioItem
                        className="!py-1 !text-[11px]"
                        key={value}
                        value={value}
                      >
                        <span className="flex min-w-0 flex-col gap-0.5">
                          <span>{label}</span>
                          <span
                            className={`font-normal text-[10px] leading-4 ${
                              value === "full" ? "text-destructive" : "text-muted-foreground"
                            }`}
                          >
                            {CHAT_SANDBOX_MODE_DESCRIPTIONS[value as ChatSandboxMode]}
                          </span>
                        </span>
                      </DropdownMenuRadioItem>
                    ))}
                  </DropdownMenuRadioGroup>
                </DropdownMenuContent>
              </DropdownMenu>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    aria-label="选择模型"
                    className="chat-model-picker !h-7 !gap-1.5 !px-2 !text-[11px]"
                    disabled={isModelsLoading || models.length === 0}
                    type="button"
                  >
                    <Settings2 className="size-3.5" />
                    <span className="chat-picker-value !text-[11px]">
                      {selectedModel ? formatModelLabel(selectedModel) : "未配置模型"}
                    </span>
                    <ChevronDown className="size-3.5" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="start"
                  className="chat-select-menu !text-[11px]"
                  side="top"
                  sideOffset={8}
                >
                  <DropdownMenuRadioGroup
                    value={selectedModel?.id ?? ""}
                    onValueChange={setSelectedModelId}
                  >
                    {models.length === 0 ? (
                      <DropdownMenuItem className="!py-1 !text-[11px]" disabled>
                        未配置模型
                      </DropdownMenuItem>
                    ) : (
                      sortedModels.map((model) => (
                        <DropdownMenuRadioItem
                          className="!py-1 !text-[11px]"
                          key={model.id}
                          value={model.id}
                        >
                          {formatModelLabel(model)}
                        </DropdownMenuRadioItem>
                      ))
                    )}
                  </DropdownMenuRadioGroup>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem asChild className="!py-1 !text-[11px]">
                    <Link to="/settings/models">前往模型设置</Link>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <ChatToolsPicker
                open={toolsOpen}
                settings={chatTools}
                workspaceAvailable={Boolean(selectedCwd.trim())}
                onOpenChange={setToolsOpen}
                onSettingsChange={updateChatTools}
                mcpServers={mcpServers}
                selectedMcpIds={selectedMcpIds}
                onMcpSelectionChange={updateMcpSelection}
              />
              <ChatSkillsPicker
                open={skillsOpen}
                onOpenChange={setSkillsOpen}
                onSelectionChange={updateSkillSelection}
                selectedSkillIds={selectedSkillIds}
                skills={availableSkills.filter((skill) => installedSkillIds.includes(skill.id))}
              />
              {configuredModels?.length === 0 && (
                <Link className="chat-settings-link" to="/settings/models">
                  配置模型
                </Link>
              )}
            </div>
            <div className="chat-composer-actions">
              <ChatContextPopover
                inputContext={selectedModel?.inputContext}
                inputTokens={currentContextUsage?.inputTokens}
                isEstimated={currentContextUsage?.source === "estimate"}
                isGenerating={isGenerating}
                modelName={selectedModel?.name}
              />
              <Button
                aria-label="语音输入"
                className="chat-tool-button !size-7 hidden sm:inline-flex"
                size="icon"
                type="button"
                variant="ghost"
              >
                <Mic className="size-4" />
              </Button>
              <Button
                aria-label={isGenerating ? "停止生成" : "发送消息"}
                className="chat-send-button !size-9 !rounded-[10px]"
                disabled={
                  ((!input.trim() && !pendingAttachments.some((a) => a.status === "ready")) ||
                    !selectedModel ||
                    pendingAttachments.some((a) => a.status === "uploading")) &&
                  !isGenerating
                }
                onClick={isGenerating ? stopCurrentRun : submitMessage}
                size="icon"
                type="button"
              >
                {isGenerating ? <CircleStop className="size-4" /> : <ArrowUp className="size-4" />}
              </Button>
            </div>
          </div>
        </div>
        <p className="chat-disclaimer">AI 生成的内容可能存在偏差，请核实重要信息。</p>
      </div>
      <ChatSettingsDialog
        onOpenChange={setSettingsOpen}
        onSettingsChange={updateChatDisplay}
        open={settingsOpen}
        settings={chatDisplay}
      />
      <GitCommitDialog
        branch={workspaceGitQuery.data?.summary?.branch}
        hasChanges={Boolean(workspaceGitQuery.data?.summary?.filesChanged)}
        canPush={Boolean(workspaceGitQuery.data?.summary?.ahead)}
        insertions={workspaceGitQuery.data?.summary?.insertions ?? 0}
        deletions={workspaceGitQuery.data?.summary?.deletions ?? 0}
        filesChanged={workspaceGitQuery.data?.summary?.filesChanged ?? 0}
        onOpenChange={setGitCommitOpen}
        onSuccess={() => void workspaceGitQuery.refetch()}
        open={gitCommitOpen}
        workspaceId={workspaceKey}
      />
      <ChatContextDialog
        promptKey={promptKey}
        loadPrompt={async () =>
          systemPromptRef.current ??
          (await loadChatServerSystemPromptPreview(sessionId, await getPromptInput()))
        }
        sessionId={sessionId}
        onOpenChange={setContextOpen}
        open={contextOpen}
      />
      <ChatMemoryDialog
        onOpenChange={setMemoryOpen}
        onStoreChange={updateChatMemory}
        open={memoryOpen}
        store={chatMemory}
      />
      <ChatToolLogDialog messages={messages} onOpenChange={setToolLogOpen} open={toolLogOpen} />
      <AlertDialog
        open={sessionToDelete !== null}
        onOpenChange={(open) => {
          if (!open) setSessionToDelete(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除历史对话？</AlertDialogTitle>
            <AlertDialogDescription>
              确定要删除“{sessionToDelete?.title ?? "这条对话"}”吗？删除后无法恢复。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => void confirmRemoveSession()}>
              删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog
        onOpenChange={(open) => {
          if (open) environmentImportMutation.reset();
          setEnvironmentImportOpen(open);
        }}
        open={environmentImportOpen}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>导入本机开发工具？</AlertDialogTitle>
            <AlertDialogDescription>
              ChatDesk 会启动一次当前登录
              Shell，并执行其启动配置。只解析白名单内开发工具的绝对路径；不会保存其他环境变量、Token
              或 API Key。
            </AlertDialogDescription>
          </AlertDialogHeader>
          {environmentImportMutation.isError ? (
            <p className="text-destructive text-sm" role="alert">
              {environmentImportMutation.error instanceof Error
                ? environmentImportMutation.error.message
                : "开发工具导入失败。"}
            </p>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={environmentImportMutation.isPending}>
              取消
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={environmentImportMutation.isPending}
              onClick={(event) => {
                event.preventDefault();
                environmentImportMutation.mutate();
              }}
            >
              {environmentImportMutation.isPending ? (
                <LoaderCircle className="size-4 animate-spin" />
              ) : (
                <Download className="size-4" />
              )}
              确认导入
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function pathBasename(path: string) {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}

function toChatToolCall(part: ChatToolPart): ChatToolCallCardProps {
  return {
    id: part.toolCallId,
    toolName: getToolName(part),
    state: part.state,
    input: part.input,
    output: "output" in part ? part.output : undefined,
    errorText: "errorText" in part ? part.errorText : undefined,
    approval: "approval" in part ? part.approval : undefined,
    preliminary: "preliminary" in part ? Boolean(part.preliminary) : false,
  };
}

function sourceLabel(part: ChatSourcePart) {
  if (part.type === "source-document") return part.title;
  if (part.title?.trim()) return part.title;
  try {
    return new URL(part.url).hostname;
  } catch {
    return part.url;
  }
}

function handleExternalResource(event: React.MouseEvent<HTMLAnchorElement>, url: string) {
  if (!/^https?:\/\//i.test(url)) return;
  event.preventDefault();
  void openExternal(url);
}

function ChatMessageReasoning({ isStreaming, text }: { isStreaming: boolean; text: string }) {
  const [open, setOpen] = useState(isStreaming);
  useEffect(() => {
    if (isStreaming) setOpen(true);
  }, [isStreaming]);

  return (
    <div className={`chat-message-reasoning ${open ? "is-open" : ""}`}>
      <button
        aria-expanded={open}
        className="chat-message-reasoning-toggle"
        onClick={() => setOpen((value) => !value)}
        type="button"
      >
        <Brain aria-hidden="true" className="size-3.5" />
        推理摘要
        <ChevronDown aria-hidden="true" className="chat-message-reasoning-chevron size-3.5" />
      </button>
      {open ? (
        <div className="chat-message-reasoning-text">
          <ChatMarkdown isAnimating={isStreaming}>{text}</ChatMarkdown>
        </div>
      ) : null}
    </div>
  );
}

function ChatMessageSources({ parts }: { parts: ChatSourcePart[] }) {
  return (
    <div className="chat-message-sources">
      <p>来源</p>
      <ul>
        {parts.map((part) => (
          <li key={part.sourceId}>
            {part.type === "source-url" ? (
              <a
                className="chat-message-source is-link"
                href={part.url}
                onClick={(event) => handleExternalResource(event, part.url)}
                rel="noreferrer"
                target="_blank"
                title={part.url}
              >
                <span className="chat-message-source-label">{sourceLabel(part)}</span>
                <ExternalLink aria-hidden="true" className="size-3" />
              </a>
            ) : (
              <span className="chat-message-source" title={part.filename}>
                <span className="chat-message-source-label">{sourceLabel(part)}</span>
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function ChatMessageFiles({ parts }: { parts: ChatFilePart[] }) {
  return (
    <div className="chat-message-files">
      {parts.map((part, index) => {
        const label = "filename" in part && part.filename ? part.filename : `文件 ${index + 1}`;
        const key = `${part.type}-${part.url}-${index}`;
        if (part.mediaType.startsWith("image/")) {
          return (
            <button
              className="chat-message-image"
              key={key}
              onClick={() =>
                openImagePreview({
                  url: part.url,
                  filename: "filename" in part ? part.filename : undefined,
                  mediaType: part.mediaType,
                })
              }
              title={label}
              type="button"
            >
              <img alt={label} loading="lazy" src={part.url} />
            </button>
          );
        }
        return (
          <a
            className="chat-message-file"
            href={part.url}
            key={key}
            onClick={(event) => handleExternalResource(event, part.url)}
            rel="noreferrer"
            target="_blank"
          >
            <FileText aria-hidden="true" className="size-4" />
            <span>{label}</span>
            <ExternalLink aria-hidden="true" className="size-3" />
          </a>
        );
      })}
    </div>
  );
}

type ChatGenerationStatusProps = {
  detail: string;
  elapsedLabel: string;
  phase: string;
};

function ChatGenerationStatus({ detail, elapsedLabel, phase }: ChatGenerationStatusProps) {
  return (
    <span
      aria-live="polite"
      className="chat-generation-status"
      role="status"
      title={detail || undefined}
    >
      <span aria-hidden="true" className="chat-generation-status-dot" />
      <span className="chat-generation-status-label">{phase}</span>
      <span className="chat-generation-status-elapsed">已等待 {elapsedLabel}</span>
      {detail ? <span className="chat-generation-status-detail">{detail}</span> : null}
    </span>
  );
}

const MessageBubble = memo(function MessageBubble({
  message,
  isStreaming,
  generationStatus,
  showTokenUsage,
  onApprovalResponse,
  cwd,
  workspaceId,
}: {
  message: UIMessage;
  isStreaming: boolean;
  generationStatus?: ChatGenerationStatusProps;
  showTokenUsage: boolean;
  onApprovalResponse: (id: string, approved: boolean) => void;
  cwd: string;
  workspaceId?: string;
}) {
  const text = messageText(message);
  const isUser = message.role === "user";
  const [copied, setCopied] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const toolParts = message.parts.filter(isToolUIPart);
  const messageBlocks = getChatMessageBlocks(message);
  const pendingApprovalParts = toolParts.filter((part) => part.state === "approval-requested");
  if (!isUser && messageBlocks.length === 0) return null;
  const usage = showTokenUsage && !isUser ? getMessageUsage(message) : undefined;
  const usageLabel = usage ? formatTokenUsage(usage) : null;
  const toolLimitReached = Boolean(
    !isUser && (message.metadata as { toolLimitReached?: boolean } | undefined)?.toolLimitReached,
  );
  const contextCompaction = !isUser
    ? (message.metadata as { contextCompaction?: ChatContextCompaction } | undefined)
        ?.contextCompaction
    : undefined;
  const completionLabel = getMessageRunStateLabel(message) ?? "已完成";
  const runErrorLabel = getMessageRunErrorLabel(message);
  const shouldCollapse =
    isUser &&
    (text.length > CHAT_MESSAGE_COLLAPSE_CHAR_LIMIT ||
      text.split("\n").length > CHAT_MESSAGE_COLLAPSE_LINE_LIMIT);
  const showMessageActions = !generationStatus && (!isUser || Boolean(text.trim()));

  async function copyMessage() {
    if (!text.trim() || !navigator.clipboard) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className={`chat-message ${isUser ? "user-message" : "assistant-message"}`}>
      <div className={`chat-avatar ${isUser ? "user-avatar" : "assistant-avatar"}`}>
        {isUser ? <User className="size-4" /> : <Bot className="size-4" />}
      </div>
      <div className="chat-message-body">
        <div className="chat-message-meta">
          <strong>{isUser ? "你" : "ChatDesk"}</strong>
          {!isUser ? (
            generationStatus ? (
              <ChatGenerationStatus {...generationStatus} />
            ) : (
              <span
                title={
                  contextCompaction ? formatContextCompactionTitle(contextCompaction) : undefined
                }
              >
                {contextCompaction && completionLabel === "已完成"
                  ? `${completionLabel} · 已生成检查点${contextCompaction.count > 1 ? ` ${contextCompaction.count} 次` : ""}`
                  : completionLabel}
              </span>
            )
          ) : null}
        </div>
        <div className="chat-message-parts">
          {messageBlocks.map((block) => {
            if (block.kind === "tools") {
              const visibleParts = block.parts.filter(
                (part) => getToolName(part) !== TODO_TOOL_NAME,
              );
              if (visibleParts.length === 0) return null;
              return (
                <div className="chat-tool-calls" key={block.key}>
                  <ChatToolCallGroup
                    calls={visibleParts.map(toChatToolCall)}
                    cwd={cwd}
                    workspaceId={workspaceId}
                  />
                </div>
              );
            }
            if (block.kind === "reasoning") {
              return (
                <ChatMessageReasoning isStreaming={isStreaming} key={block.key} text={block.text} />
              );
            }
            if (block.kind === "sources") {
              return <ChatMessageSources key={block.key} parts={block.parts} />;
            }
            if (block.kind === "files") {
              return <ChatMessageFiles key={block.key} parts={block.parts} />;
            }
            const collapseBlock = isUser && shouldCollapse;
            return (
              <div
                className={`chat-message-text-wrap ${collapseBlock && !expanded ? "is-collapsed" : ""}`}
                key={block.key}
              >
                <div className="chat-message-text">
                  <ChatMarkdown isAnimating={!isUser && isStreaming}>{block.text}</ChatMarkdown>
                </div>
                {collapseBlock && !expanded ? <div className="chat-message-fade" /> : null}
                {collapseBlock ? (
                  <Button
                    aria-expanded={expanded}
                    className="chat-message-expand"
                    onClick={() => setExpanded((value) => !value)}
                    size="sm"
                    type="button"
                    variant="ghost"
                  >
                    {expanded ? (
                      <>
                        <ChevronUp className="size-3.5" /> 收起
                      </>
                    ) : (
                      <>
                        <ChevronDown className="size-3.5" /> 展开全文
                      </>
                    )}
                  </Button>
                ) : null}
              </div>
            );
          })}
        </div>
        {pendingApprovalParts.length > 0 ? (
          <fieldset className="chat-approval-strip">
            <legend className="sr-only">工具审批</legend>
            <div className="chat-approval-strip-copy">
              <strong>Approval required</strong>
              <span>此操作将修改工作区或执行终端命令。</span>
            </div>
            <div className="chat-approval-strip-actions">
              {pendingApprovalParts.map((part) => (
                <span className="chat-approval-strip-item" key={part.approval.id}>
                  <code>{getToolName(part)}</code>
                  <Button
                    size="sm"
                    type="button"
                    variant="ghost"
                    onClick={() => onApprovalResponse(part.approval.id, false)}
                  >
                    Deny
                  </Button>
                  <Button
                    size="sm"
                    type="button"
                    onClick={() => onApprovalResponse(part.approval.id, true)}
                  >
                    Approve
                  </Button>
                </span>
              ))}
            </div>
          </fieldset>
        ) : null}
        {toolLimitReached ? (
          <p className="mt-2 text-primary text-xs">
            已达到执行轮数上限（{MAX_AGENT_STEPS} 轮），如需继续请发送一条新消息。
          </p>
        ) : null}
        {runErrorLabel ? <p className="mt-2 text-destructive text-xs">{runErrorLabel}</p> : null}
        {showMessageActions ? (
          <div className="chat-message-actions">
            <Button
              aria-label={copied ? "已复制" : isUser ? "复制消息" : "复制回复"}
              disabled={!text.trim()}
              onClick={() => void copyMessage()}
              size="icon"
              type="button"
              variant="ghost"
            >
              {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
            </Button>
            {!isUser && usageLabel ? (
              <span className="chat-message-usage">{usageLabel}</span>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
});

function messageText(message: UIMessage) {
  return message.parts
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n");
}

function formatGenerationElapsed(seconds: number) {
  if (seconds < 60) return `${seconds} 秒`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return remainingSeconds > 0 ? `${minutes} 分 ${remainingSeconds} 秒` : `${minutes} 分`;
}

function formatContextCompactionTitle(compaction: ChatContextCompaction) {
  return `估算上下文 ${compaction.estimatedTokensBefore.toLocaleString("zh-CN")} → ${compaction.estimatedTokensAfter.toLocaleString("zh-CN")} tokens`;
}

function messageHasToolParts(message: UIMessage) {
  return message.parts.some(isToolUIPart);
}

async function waitForCanonicalSession(sessionId: string, expectedAssistantText: string) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const session = await loadChatSession(sessionId);
    if (!session) return null;
    const lastAssistant = [...session.messages]
      .reverse()
      .find((message) => message.role === "assistant");
    if (
      !expectedAssistantText ||
      (lastAssistant && messageText(lastAssistant) === expectedAssistantText)
    ) {
      return session;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return loadChatSession(sessionId);
}

function createModelTransport(
  sessionId: string,
  model: ModelConfig | undefined,
  getToolsSettings: () => ChatToolsSettings,
  getSandboxMode: () => ChatSandboxMode,
  getSkills: () => SkillDefinition[],
  getMcpServerIds: () => string[],
  getPlanMode: () => ChatPlanMode,
  getPlanId: () => string | undefined,
  getPromptInput: () => Promise<
    Pick<RunStartInput, "system" | "memory" | "cwd" | "workspaceId" | "toolNames">
  >,
): ChatTransport<UIMessage> {
  return new DefaultChatTransport<UIMessage>({
    api: `${chatServerUrl()}/v1/sessions/${sessionId}/runs`,
    fetch: (input, init) => chatServerFetch(input, init),
    headers: async () => {
      await initializeChatServer();
      return chatServerHeaders();
    },
    prepareSendMessagesRequest: async ({ messages }) => {
      await initializeChatServer();
      if (!model || model.baseUrl.startsWith("local://")) {
        throw new Error("请先在设置中配置一个真实的模型 API。");
      }
      const promptInput = await getPromptInput();
      const cwd = promptInput.cwd;
      const workspaceId = promptInput.workspaceId;
      const sandboxMode = getSandboxMode();
      const planMode = getPlanMode();
      const planId = getPlanId();
      await ensureChatServerSession(sessionId, {
        cwd: cwd || undefined,
        workspaceId: workspaceId || undefined,
      });
      const activeTools = { toolNames: promptInput.toolNames ?? [] };
      const serverConfig = await loadChatServerConfig();
      const models = [
        ...serverConfig.models.filter(
          (item) => !item || typeof item !== "object" || (item as { id?: unknown }).id !== model.id,
        ),
        { ...model, apiKey: undefined },
      ];
      await saveChatServerConfig({
        models,
        chatTools: getToolsSettings(),
        apiKeys: { ...serverConfig.apiKeys, [model.id]: model.apiKey },
        selectedSkillIds: getSkills().map((skill) => skill.id),
      });
      return {
        body: {
          messages,
          modelId: model.id,
          ...promptInput,
          sandboxMode,
          planMode,
          planId,
          mcpServerIds: getMcpServerIds(),
          skillIds: getSkills().map((skill) => skill.id),
          toolNames: activeTools.toolNames,
          title: undefined,
        },
        api: `${chatServerUrl()}/v1/sessions/${sessionId}/runs`,
        headers: chatServerHeaders(),
      };
    },
  });
}

export { ChatPage };
