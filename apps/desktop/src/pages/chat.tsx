import { useChat } from "@ai-sdk/react";
import {
  type ChatContextCompaction,
  type ChatContextUsage,
  type ChatPlanMode,
  type ChatPlanSummary,
  type ChatRunProgress,
  type ChatRunSummary,
  type ChatSessionKind,
  type ChatSessionSource,
  CREATE_TASK_TOOL_NAME,
  DEFAULT_WORKSPACE_ID,
  DEFAULT_WORKSPACE_NAME,
  MAX_AGENT_STEPS,
  PLAN_USER_INPUT_TOOL_NAME,
  type PlanUserInputResponse,
  parsePlanUserInputRequest,
  parsePlanUserInputResponse,
  type RunStartInput,
  resolveSessionTitle,
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
  Brain,
  Bug,
  ChartColumn,
  Check,
  ChevronDown,
  ChevronUp,
  CircleAlert,
  Clock3,
  Copy,
  Download,
  ExternalLink,
  FileText,
  Folder,
  GitBranch,
  Hammer,
  Laptop,
  List,
  LoaderCircle,
  MessageSquarePlus,
  Mic,
  MoreHorizontal,
  PanelRight,
  Paperclip,
  Play,
  RefreshCw,
  SearchCode,
  Settings,
  Settings2,
  ShieldCheck,
  Sparkles,
  Square,
  Upload,
  Wrench,
  X,
} from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, Outlet, useLocation, useNavigate } from "react-router-dom";
import { ChatAttachmentChips } from "@/components/chat-attachment-chips";
import { ChatCommandPopup } from "@/components/chat-command-popup";
import { ChatComposerInput, type ChatComposerInputHandle } from "@/components/chat-composer-input";
import { ChatContextDialog } from "@/components/chat-context-dialog";
import { ChatContextPopover } from "@/components/chat-context-popover";
import {
  ChatConversationMenuItems,
  copyChatConversationId,
} from "@/components/chat-conversation-menu-items";
import { ChatGitSummary } from "@/components/chat-git-summary";
import { ChatMarkdown } from "@/components/chat-markdown";
import { ChatMessageNav } from "@/components/chat-message-nav";
import { ChatPathSuggestionPopup } from "@/components/chat-path-suggestion-popup";
import { ChatPlanQuestionnaire } from "@/components/chat-plan-questionnaire";
import { ChatSkillsPicker } from "@/components/chat-skills-picker";
import { ChatTaskList } from "@/components/chat-task-call";
import { ChatTitleDialog } from "@/components/chat-title-dialog";
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
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
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
import { materializeBrowserScreenshots } from "@/lib/chat-browser-screenshots";
import {
  type ChatCommand,
  filterChatCommands,
  findActiveCommandTrigger,
} from "@/lib/chat-commands";
import { applyMentionSelection, findActiveMentionTrigger } from "@/lib/chat-composer-mentions";
import { appendComposerSelection, readWindowSelectionText } from "@/lib/chat-composer-selection";
import { resolveComposerEnterAction } from "@/lib/chat-composer-submit";
import {
  canFormatChatConversationMarkdown,
  copyChatConversationMarkdown,
} from "@/lib/chat-conversation-markdown";
import { materializeGeneratedImages } from "@/lib/chat-image-generation";
import {
  appendLiveDraftText,
  CHAT_STREAM_UPDATE_THROTTLE_MS,
  createLiveDraftRenderBatcher,
  mergeLiveDraft,
} from "@/lib/chat-live-draft";
import { DEFAULT_CHAT_MEMORY, formatMemoryForInject, loadChatMemory } from "@/lib/chat-memory";
import { isWorkspaceMemoryExcludedTool, scheduleMemoryUpdateFromTurn } from "@/lib/chat-memory-ops";
import {
  type ChatFilePart,
  type ChatSourcePart,
  type ChatToolPart,
  getChatMessageBlocks,
} from "@/lib/chat-message-blocks";
import {
  previewCollapsedChatUserMessage,
  shouldCollapseChatUserMessage,
} from "@/lib/chat-message-collapse";
import { createUserMessageNavItemsSelector } from "@/lib/chat-message-nav";
import {
  findLatestPlanWriteAnchor,
  findLatestPlanWriteContent,
  isPlanExecutionReady,
  lastAssistantMessageHasCompletedPlanInput,
  latestAssistantHasPlanWrite,
} from "@/lib/chat-plan-state";
import { chatNewPath, chatRouteKey, chatSessionPath, parseChatLocation } from "@/lib/chat-routes";
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
  appendServerActivityLog,
  type ChatServerSession,
  chatServerFetch,
  chatServerHeaders,
  chatServerUrl,
  createChatPlan,
  ensureChatServerSession,
  forkChatServerSession,
  importDeveloperEnvironment,
  initializeChatServer,
  loadChatPlan,
  loadChatPlans,
  loadChatServerConfig,
  loadChatServerPort,
  loadChatServerSystemPromptPreview,
  loadDeveloperEnvironment,
  loadServerWorkspaceGit,
  loadServerWorkspacePathSuggestions,
  regenerateChatSessionTitle,
  saveChatServerConfig,
  stopChatServerRun,
  subscribeChatServerEvents,
  updateChatPlanMode,
  updateChatSessionTitle,
} from "@/lib/chat-server";
import {
  type ChatDisplaySettings,
  DEFAULT_CHAT_DISPLAY,
  loadChatDisplaySettings,
} from "@/lib/chat-settings";
import {
  type ChatAttachment,
  type ChatSession,
  createSessionId,
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
  isRecoverableChatTransportError,
  serializeChatTransportError,
} from "@/lib/chat-transport-diagnostics";
import {
  formatElapsedDuration,
  formatMessageRunDuration,
  formatTokenUsage,
  getMessageContextUsage,
  getMessageRunErrorLabel,
  getMessageRunStateLabel,
  getMessageUsage,
} from "@/lib/chat-usage";
import { openContextDetail, updateContextDetail } from "@/lib/context-detail-events";
import { getDesktopBridge } from "@/lib/desktop-bridge";
import { detectMissingDevelopmentTools } from "@/lib/developer-environment";
import { DEFAULT_DEVELOPER_SETTINGS, loadDeveloperSettings } from "@/lib/developer-settings";
import { openFileViewer } from "@/lib/file-viewer-events";
import {
  loadGeneralSettings,
  notifyChatCompletion,
  saveGeneralSettings,
} from "@/lib/general-settings";
import { openImagePreview } from "@/lib/image-preview-events";
import { loadMcpServers, saveMcpServers } from "@/lib/mcp";
import { formatModelLabel, loadModels, type ModelConfig, sortModelsByName } from "@/lib/models";
import {
  openPlanViewer,
  subscribePlanExecutionRequested,
  updatePlanViewer,
} from "@/lib/plan-viewer-events";
import { openExternal } from "@/lib/platform";
import { openSideChat } from "@/lib/side-chat-events";
import {
  filterAllowedSkills,
  formatSkillsSystemHint,
  loadAvailableSkills,
  loadDisabledSkillIds,
  type SkillDefinition,
} from "@/lib/skills";
import {
  defaultTaskCwd,
  isDefaultWorkspaceId,
  resolveDefaultSessionCwd,
} from "@/lib/workspace-path";
import { loadWorkspaceProjects, workspaceGitQueryKey } from "@/lib/workspaces";

const EMPTY_STRING_ARRAY: string[] = [];
const CONTEXT_DETAIL_STREAM_UPDATE_THROTTLE_MS = 500;
type PlanTransitionState = "idle" | "entering" | "exiting";
type QueuedComposerMessage = {
  id: string;
  sessionId: string;
  text: string;
  pending: PendingAttachment[];
};
type ChatPlanAttachment = {
  fileName: string;
  isGenerating: boolean;
  onOpen: () => void;
  toolCallId: string;
};
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
  const location = useLocation();
  const navigate = useNavigate();
  const chatRoute = useMemo(
    () => parseChatLocation(location.pathname, location.search),
    [location.pathname, location.search],
  );
  const resetChatDraft = Boolean(
    (location.state as { resetChatDraft?: boolean } | null)?.resetChatDraft,
  );
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
  const { data: availableSkills = [], isPending: isSkillsPending } = useQuery({
    queryKey: ["skills-available"],
    queryFn: loadAvailableSkills,
  });
  const disabledSkillsQuery = useQuery({
    queryKey: ["skills-disabled"],
    queryFn: loadDisabledSkillIds,
  });
  const chatSandboxModeQuery = useQuery({
    queryKey: ["chat-sandbox-mode"],
    queryFn: loadChatSandboxMode,
  });
  const developerEnvironmentQuery = useQuery({
    queryKey: ["developer-environment"],
    queryFn: () => loadDeveloperEnvironment(),
  });
  const { data: developerSettings = DEFAULT_DEVELOPER_SETTINGS } = useQuery({
    queryKey: ["developer-settings"],
    queryFn: loadDeveloperSettings,
  });
  const disabledSkillIds = disabledSkillsQuery.data ?? EMPTY_STRING_ARRAY;
  const allowedSkills = useMemo(
    () => filterAllowedSkills(availableSkills, disabledSkillIds),
    [availableSkills, disabledSkillIds],
  );
  const allowedSkillIds = useMemo(() => allowedSkills.map((skill) => skill.id), [allowedSkills]);
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
  const [selectionToolbar, setSelectionToolbar] = useState<{ left: number; top: number } | null>(
    null,
  );
  const [queuedMessages, setQueuedMessages] = useState<QueuedComposerMessage[]>([]);
  const queuedMessagesRef = useRef<QueuedComposerMessage[]>([]);
  queuedMessagesRef.current = queuedMessages;
  const [followUpPending, setFollowUpPending] = useState(false);
  const [stopPending, setStopPending] = useState(false);
  const [planMode, setPlanMode] = useState<ChatPlanMode>("apply");
  const [activePlanId, setActivePlanId] = useState<string | undefined>();
  const [activePlanHasContent, setActivePlanHasContent] = useState(false);
  const [plans, setPlans] = useState<ChatPlanSummary[]>([]);
  const [planTransition, setPlanTransition] = useState<PlanTransitionState>("idle");
  const [planModeError, setPlanModeError] = useState("");
  const [attachmentError, setAttachmentError] = useState("");
  const [titleDialogOpen, setTitleDialogOpen] = useState(false);
  const [forkError, setForkError] = useState("");
  const [forkingMessageId, setForkingMessageId] = useState<string | null>(null);
  const [isRenamingTitle, setIsRenamingTitle] = useState(false);
  const inputRef = useRef<ChatComposerInputHandle>(null);
  const selectedSnippetRef = useRef("");
  const selectionToolbarTimerRef = useRef<number | null>(null);
  const [composerPlain, setComposerPlain] = useState("");
  const [commandCaret, setCommandCaret] = useState(0);
  const [commandIndex, setCommandIndex] = useState(0);
  const [commandDismissed, setCommandDismissed] = useState(false);
  const [mentionIndex, setMentionIndex] = useState(0);
  const [mentionDismissed, setMentionDismissed] = useState(false);
  const [sessionId, setSessionId] = useState(() =>
    chatRoute.kind === "session" ? chatRoute.sessionId : createSessionId(),
  );
  const [sessionTitle, setSessionTitle] = useState("新对话");
  const sessionTitleRef = useRef(sessionTitle);
  sessionTitleRef.current = sessionTitle;
  const [sessionKind, setSessionKind] = useState<ChatSessionKind>("chat");
  const sessionKindRef = useRef(sessionKind);
  sessionKindRef.current = sessionKind;
  const [sessionSource, setSessionSource] = useState<ChatSessionSource | undefined>();
  const isReadOnly = sessionSource === "feishu";
  const lastSyncedIndexTitleRef = useRef<{ sessionId: string; title: string } | null>(null);
  const [workspaceKey, setWorkspaceKey] = useState(() =>
    chatRoute.kind === "new" ? chatRoute.workspaceId : "",
  );
  const [sessionCwd, setSessionCwd] = useState(() =>
    chatRoute.kind === "new" ? chatRoute.workspaceCwd : "",
  );
  const [isHydratingSession, setIsHydratingSession] = useState(() => chatRoute.kind === "session");
  const [sessionHydrateGeneration, setSessionHydrateGeneration] = useState(0);
  const appliedRouteKeyRef = useRef(chatRoute.kind === "new" ? chatRouteKey(chatRoute) : "");
  const loadingSessionIdRef = useRef<string | null>(null);
  const handledResetKeyRef = useRef<string | null>(null);
  const sessionSkillOverrideRef = useRef(false);
  const sessionCreatedAtRef = useRef(new Date().toISOString());
  const sessionAttachmentsRef = useRef<ChatAttachment[]>([]);
  const [pendingAttachments, setPendingAttachments] = useState<PendingAttachment[]>([]);
  const pendingAttachmentsRef = useRef<PendingAttachment[]>([]);
  pendingAttachmentsRef.current = pendingAttachments;
  const sendPreparedMessageRef = useRef<
    (
      text: string,
      pending: PendingAttachment[],
      options?: { clearComposer?: boolean },
    ) => Promise<void>
  >(async () => {});
  const queueDispatchInFlightRef = useRef(false);
  const followUpInFlightRef = useRef(false);
  const stopInFlightRef = useRef(false);
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
  const [conversationCopiedKind, setConversationCopiedKind] = useState<"id" | "markdown" | null>(
    null,
  );
  const [conversationMenuOpen, setConversationMenuOpen] = useState(false);
  const conversationMenuCloseTimerRef = useRef<number | null>(null);
  const [gitCommitOpen, setGitCommitOpen] = useState(false);
  const [contextOpen, setContextOpen] = useState(false);
  const [toolLogOpen, setToolLogOpen] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [skillsOpen, setSkillsOpen] = useState(false);
  const [environmentImportOpen, setEnvironmentImportOpen] = useState(false);
  const [dismissedEnvironmentGuide, setDismissedEnvironmentGuide] = useState("");
  const [selectedSkillIds, setSelectedSkillIds] = useState<string[]>([]);
  const [sandboxMode, setSandboxMode] = useState<ChatSandboxMode>(DEFAULT_CHAT_SANDBOX_MODE);
  const [chatDisplay, setChatDisplay] = useState<ChatDisplaySettings>(DEFAULT_CHAT_DISPLAY);
  const workspaceRef = useRef("");
  const sandboxModeRef = useRef<ChatSandboxMode>(DEFAULT_CHAT_SANDBOX_MODE);
  const planModeRef = useRef<ChatPlanMode>("apply");
  const activePlanIdRef = useRef<string | undefined>(undefined);
  const planCreationRequestRef = useRef(0);
  const planTransitionRef = useRef<PlanTransitionState>("idle");
  const confirmPlanExecutionRef = useRef<() => void>(() => {});
  const selectedCwd = isDefaultWorkspaceId(workspaceKey)
    ? resolveDefaultSessionCwd(
        workspaceProjects.find((project) => project.id === DEFAULT_WORKSPACE_ID)?.path,
        sessionId,
        sessionCwd,
      )
    : (workspaceProjects.find((project) => project.id === workspaceKey)?.path ?? sessionCwd);
  const workspaceLabel = isDefaultWorkspaceId(workspaceKey)
    ? DEFAULT_WORKSPACE_NAME
    : selectedCwd
      ? pathBasename(selectedCwd)
      : DEFAULT_WORKSPACE_NAME;
  workspaceRef.current = selectedCwd;
  sandboxModeRef.current = sandboxMode;
  planModeRef.current = planMode;
  activePlanIdRef.current = activePlanId;
  planTransitionRef.current = planTransition;
  const selectedModel = models.find((model) => model.id === selectedModelId) ?? models[0];
  const selectedModelRef = useRef(selectedModel);
  selectedModelRef.current = selectedModel;
  const mockLongResponseRef = useRef(developerSettings.mockLongResponse);
  mockLongResponseRef.current = developerSettings.mockLongResponse;
  const activePlan = plans.find((plan) => plan.id === activePlanId);

  useEffect(() => {
    return () => {
      if (conversationMenuCloseTimerRef.current !== null) {
        window.clearTimeout(conversationMenuCloseTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!isDefaultWorkspaceId(workspaceKey)) return;
    const next = resolveDefaultSessionCwd(
      workspaceProjects.find((project) => project.id === DEFAULT_WORKSPACE_ID)?.path,
      sessionId,
      sessionCwd,
    );
    if (next && next !== sessionCwd) setSessionCwd(next);
  }, [sessionCwd, sessionId, workspaceKey, workspaceProjects]);

  const getPromptInput = useCallback(async () => {
    const memory = memoryRef.current;
    const cwd = workspaceRef.current.trim();
    const workspaceId = isDefaultWorkspaceId(workspaceKey)
      ? DEFAULT_WORKSPACE_ID
      : workspaceKey.trim();
    const allowed = new Set(allowedSkillIds);
    const skills = skillsRef.current.filter(
      (skill) => selectedSkillIds.includes(skill.id) && allowed.has(skill.id),
    );
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
  }, [allowedSkillIds, selectedSkillIds, workspaceKey]);
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
  const activeSessionRef = useRef(sessionId);
  activeSessionRef.current = sessionId;
  const attachedStreamSessionRef = useRef<string | null>(null);
  const liveDraftsRef = useRef(new Map<string, UIMessage>());
  const transportStartedAtRef = useRef<number | null>(null);
  const transport = useMemo(
    () =>
      createModelTransport(
        sessionId,
        selectedModel,
        () => toolsRef.current,
        () => sandboxModeRef.current,
        () =>
          skillsRef.current.filter(
            (skill) => selectedSkillIds.includes(skill.id) && allowedSkillIds.includes(skill.id),
          ),
        () => selectedMcpIds,
        () => planModeRef.current,
        () => activePlanIdRef.current,
        () => sessionTitleRef.current,
        () => mockLongResponseRef.current,
        getPromptInput,
      ),
    [allowedSkillIds, getPromptInput, selectedMcpIds, selectedModel, selectedSkillIds, sessionId],
  );
  const {
    addToolApprovalResponse,
    addToolOutput,
    clearError,
    error,
    messages,
    sendMessage,
    setMessages,
    status,
    stop,
  } = useChat({
    id: sessionId,
    transport,
    throttle: CHAT_STREAM_UPDATE_THROTTLE_MS,
    sendAutomaticallyWhen: ({ messages }) =>
      lastAssistantMessageIsCompleteWithApprovalResponses({ messages }) ||
      lastAssistantMessageHasCompletedPlanInput(messages),
    onError: (chatError) => {
      attachedStreamSessionRef.current = null;
      if (isRecoverableChatTransportError(chatError)) {
        const startedAt = transportStartedAtRef.current;
        void appendServerActivityLog({
          level: "error",
          source: "Chat Transport Diagnostic",
          message: "聊天响应流读取失败",
          details: JSON.stringify({
            sessionId,
            elapsedMs: startedAt === null ? undefined : Date.now() - startedAt,
            online: navigator.onLine,
            visibilityState: document.visibilityState,
            error: serializeChatTransportError(chatError),
          }),
        }).catch((logError) => console.error("Failed to persist chat transport error", logError));
      }
      console.error("Chat request failed", chatError);
    },
  });
  const liveDraftRenderBatcher = useMemo(
    () =>
      createLiveDraftRenderBatcher((eventSessionId) => {
        if (
          activeSessionRef.current !== eventSessionId ||
          attachedStreamSessionRef.current === eventSessionId
        ) {
          return;
        }
        const draft = liveDraftsRef.current.get(eventSessionId);
        if (draft) setMessages((current) => mergeLiveDraft(current, draft));
      }, CHAT_STREAM_UPDATE_THROTTLE_MS),
    [setMessages],
  );
  const openContextDetailPanel = useCallback(async () => {
    const promptInput = await getPromptInput();
    openContextDetail({
      sessionId,
      messages,
      promptInput,
      ...(systemPromptRef.current ? { systemPrompt: systemPromptRef.current } : {}),
    });
  }, [getPromptInput, messages, sessionId]);

  useEffect(() => {
    void promptKey;
    let active = true;
    void getPromptInput().then((promptInput) => {
      if (!active) return;
      updateContextDetail({
        sessionId,
        promptInput,
        ...(systemPromptRef.current ? { systemPrompt: systemPromptRef.current } : {}),
      });
    });
    return () => {
      active = false;
    };
  }, [getPromptInput, promptKey, sessionId]);
  const [serverSessionStatuses, setServerSessionStatuses] = useState<
    Record<string, ChatServerSession["status"]>
  >({});
  const [serverRunSummaries, setServerRunSummaries] = useState<Record<string, ChatRunSummary>>({});
  const serverSessionStatus = serverSessionStatuses[sessionId];
  const localRunActive = status === "submitted" || status === "streaming";
  const serverRunActive =
    serverSessionStatus === "submitted" || serverSessionStatus === "streaming";
  const effectiveStatus = localRunActive ? status : (serverSessionStatus ?? status);
  const recoverableTransportError = isRecoverableChatTransportError(error);
  useEffect(() => {
    if (!recoverableTransportError) return;
    let active = true;
    attachedStreamSessionRef.current = null;
    void loadChatSession(sessionId)
      .then((session) => {
        if (!active || activeSessionRef.current !== sessionId || !session) return;
        const lastAssistant = [...session.messages]
          .reverse()
          .find((message) => message.role === "assistant");
        if (lastAssistant) liveDraftsRef.current.set(sessionId, lastAssistant);
        setMessages(mergeLiveDraft(session.messages, liveDraftsRef.current.get(sessionId)));
        clearError();
      })
      .catch((loadError) => console.error("Failed to recover chat after stream error", loadError));
    return () => {
      active = false;
    };
  }, [clearError, recoverableTransportError, sessionId, setMessages]);

  useEffect(() => {
    if (!localRunActive && !serverRunActive) transportStartedAtRef.current = null;
  }, [localRunActive, serverRunActive]);
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
  const [contextCompaction, setContextCompaction] = useState<ChatContextCompaction | null>(null);
  const [liveContextUsage, setLiveContextUsage] = useState<ChatContextUsage | null>(null);
  const [runProgress, setRunProgress] = useState<ChatRunProgress | null>(null);
  const [runStartedAtBySession, setRunStartedAtBySession] = useState<Record<string, string>>({});
  const [generationElapsedSeconds, setGenerationElapsedSeconds] = useState(0);

  const startNewSession = useCallback(
    (nextWorkspaceId = "", nextWorkspaceCwd = "", options?: { skipNavigate?: boolean }) => {
      const nextSessionId = createSessionId();
      const isDefault = isDefaultWorkspaceId(nextWorkspaceId);
      const normalizedWorkspaceId = isDefault ? "" : nextWorkspaceId;
      const nextCwd = isDefault
        ? defaultTaskCwd(workspaceProjects, nextSessionId)
        : nextWorkspaceCwd;
      const nextPath = chatNewPath({
        workspaceId: normalizedWorkspaceId,
        workspaceCwd: isDefault ? "" : nextCwd,
      });
      appliedRouteKeyRef.current = chatRouteKey({
        kind: "new",
        workspaceId: normalizedWorkspaceId,
        workspaceCwd: isDefault ? "" : nextCwd,
      });
      loadingSessionIdRef.current = null;
      setIsHydratingSession(false);
      setSessionId(nextSessionId);
      if (!options?.skipNavigate) {
        const currentPath = `${location.pathname}${location.search}`;
        if (currentPath !== nextPath) {
          navigate(nextPath, { replace: true });
        }
      }
      workspaceSelectionInitializedRef.current = true;
      setWorkspaceKey(isDefault ? DEFAULT_WORKSPACE_ID : normalizedWorkspaceId);
      setSessionCwd(nextCwd);
      sessionSkillOverrideRef.current = false;
      setSelectedSkillIds(allowedSkillIds);
      sessionCreatedAtRef.current = new Date().toISOString();
      sessionAttachmentsRef.current = [];
      planCreationRequestRef.current += 1;
      planTransitionRef.current = "idle";
      planModeRef.current = "apply";
      activePlanIdRef.current = undefined;
      setPlanMode("apply");
      setActivePlanId(undefined);
      setActivePlanHasContent(false);
      setPlans([]);
      setPlanTransition("idle");
      setPlanModeError("");
      setForkError("");
      setForkingMessageId(null);
      setIsRenamingTitle(false);
      for (const item of pendingAttachmentsRef.current) {
        if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
      }
      setPendingAttachments([]);
      pendingAttachmentsRef.current = [];
      for (const message of queuedMessagesRef.current) {
        for (const item of message.pending) {
          if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
        }
      }
      setQueuedMessages([]);
      setFollowUpPending(false);
      setStopPending(false);
      followUpInFlightRef.current = false;
      stopInFlightRef.current = false;
      pendingSessionRef.current = null;
      systemPromptRef.current = undefined;
      setSessionTitle("新对话");
      setSessionKind("chat");
      setSessionSource(undefined);
      setSandboxMode(sandboxModeRef.current);
      savedFingerprintRef.current = "";
      extractedFingerprintRef.current = "";
      suppressSaveRef.current = false;
      setMessages([]);
      setInput("");
    },
    [allowedSkillIds, location.pathname, location.search, navigate, setMessages, workspaceProjects],
  );

  const promoteDraftSession = useCallback(() => {
    if (chatRoute.kind === "session" && chatRoute.sessionId === sessionId) return;
    appliedRouteKeyRef.current = chatRouteKey({ kind: "session", sessionId });
    navigate(chatSessionPath(sessionId), { replace: true });
  }, [chatRoute, navigate, sessionId]);

  function selectWorkspace(nextWorkspaceValue: string) {
    const isDefault = isDefaultWorkspaceId(nextWorkspaceValue);
    const nextWorkspaceId = isDefault ? DEFAULT_WORKSPACE_ID : nextWorkspaceValue;
    const nextWorkspaceCwd = isDefault
      ? defaultTaskCwd(workspaceProjects, sessionId)
      : (workspaceProjects.find((project) => project.id === nextWorkspaceId)?.path ?? "");
    workspaceSelectionInitializedRef.current = true;
    setWorkspaceKey(nextWorkspaceId);
    setSessionCwd(nextWorkspaceCwd);
    if (chatRoute.kind === "new") {
      appliedRouteKeyRef.current = chatRouteKey({
        kind: "new",
        workspaceId: isDefault ? "" : nextWorkspaceId,
        workspaceCwd: isDefault ? "" : nextWorkspaceCwd,
      });
      navigate(
        chatNewPath({
          workspaceId: isDefault ? "" : nextWorkspaceId,
          workspaceCwd: isDefault ? "" : nextWorkspaceCwd,
        }),
        { replace: true },
      );
    }
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
      if (sessionToDetach) {
        liveDraftRenderBatcher.cancel(sessionToDetach);
        stop();
      }
    };
  }, [liveDraftRenderBatcher, sessionId, stop]);

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
          setServerRunSummaries(
            Object.fromEntries(
              sessions.flatMap((session) =>
                session.lastRunSummary ? [[session.id, session.lastRunSummary]] : [],
              ),
            ),
          );
          setRunStartedAtBySession(
            Object.fromEntries(
              sessions.flatMap((session) =>
                session.runStartedAt ? [[session.id, session.runStartedAt]] : [],
              ),
            ),
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
            liveDraftRenderBatcher.schedule(eventSessionId);
          }
        },
        onMessageUpdated: ({ sessionId: eventSessionId, message }) => {
          liveDraftRenderBatcher.cancel(eventSessionId);
          if (message) liveDraftsRef.current.set(eventSessionId, message);
          if (activeSessionRef.current === eventSessionId && message) {
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
          const startedAt = nextProgress?.startedAt;
          if (startedAt) {
            setRunStartedAtBySession((current) => ({
              ...current,
              [eventSessionId]: startedAt,
            }));
          }
          if (activeSessionRef.current === eventSessionId && nextProgress) {
            setRunProgress(nextProgress);
          }
        },
        onRunFinished: ({ sessionId: eventSessionId, runSummary }) => {
          liveDraftRenderBatcher.flush(eventSessionId);
          if (activeSessionRef.current === eventSessionId) {
            attachedStreamSessionRef.current = null;
          }
          setRunStartedAtBySession((current) => {
            const next = { ...current };
            delete next[eventSessionId];
            return next;
          });
          setServerRunSummaries((current) => ({
            ...current,
            [eventSessionId]: runSummary,
          }));
          if (runSummary.outcome === "completed") {
            void loadGeneralSettings().then((settings) => {
              if (settings.notifyOnChatCompletion && getDesktopBridge()?.runtime === "electron") {
                void notifyChatCompletion(
                  activeSessionRef.current === eventSessionId
                    ? sessionTitleRef.current
                    : "有一个对话已完成",
                  settings.notifyOnlyWhenWindowUnfocused,
                ).then((shown) => {
                  if (shown) return;
                  void saveGeneralSettings({
                    ...settings,
                    notifyOnChatCompletion: false,
                    notificationPermissionVerified: false,
                  });
                });
              }
            });
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
      liveDraftRenderBatcher.cancelAll();
    };
  }, [liveDraftRenderBatcher, setMessages]);

  useEffect(() => {
    void loadChatDisplaySettings().then(setChatDisplay);
  }, []);

  useEffect(() => {
    const handleDisplaySettingsChange = (event: Event) => {
      const settings = (event as CustomEvent<ChatDisplaySettings>).detail;
      if (settings) setChatDisplay(settings);
    };
    window.addEventListener("chat-display-settings-change", handleDisplaySettingsChange);
    return () =>
      window.removeEventListener("chat-display-settings-change", handleDisplaySettingsChange);
  }, []);

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
    const allowed = new Set(allowedSkillIds);
    const next = [...new Set(ids)].filter((id) => allowed.has(id));
    sessionSkillOverrideRef.current = true;
    setSelectedSkillIds(next);
  };

  useEffect(() => {
    if (isSkillsPending || disabledSkillsQuery.isPending) return;
    if (!sessionSkillOverrideRef.current) {
      setSelectedSkillIds(allowedSkillIds);
      return;
    }
    const allowed = new Set(allowedSkillIds);
    setSelectedSkillIds((current) => current.filter((id) => allowed.has(id)));
  }, [allowedSkillIds, disabledSkillsQuery.isPending, isSkillsPending]);

  const isGenerating =
    serverRunActive || (localRunActive && attachedStreamSessionRef.current === sessionId);
  const pendingContextDetailRef = useRef({ sessionId, messages });
  const contextDetailTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastContextDetailSyncAtRef = useRef(0);
  const contextDetailSessionRef = useRef(sessionId);
  useEffect(() => {
    return () => {
      if (contextDetailTimerRef.current !== null) {
        clearTimeout(contextDetailTimerRef.current);
        contextDetailTimerRef.current = null;
      }
    };
  }, []);
  useEffect(() => {
    if (contextDetailSessionRef.current !== sessionId) {
      if (contextDetailTimerRef.current !== null) {
        clearTimeout(contextDetailTimerRef.current);
        contextDetailTimerRef.current = null;
      }
      contextDetailSessionRef.current = sessionId;
      lastContextDetailSyncAtRef.current = 0;
    }
    pendingContextDetailRef.current = { sessionId, messages };
    const syncContextDetail = () => {
      contextDetailTimerRef.current = null;
      const pending = pendingContextDetailRef.current;
      if (pending.sessionId !== activeSessionRef.current) return;
      lastContextDetailSyncAtRef.current = Date.now();
      updateContextDetail({
        sessionId: pending.sessionId,
        messages: pending.messages,
        ...(systemPromptRef.current ? { systemPrompt: systemPromptRef.current } : {}),
      });
    };

    if (!isGenerating) {
      if (contextDetailTimerRef.current !== null) {
        clearTimeout(contextDetailTimerRef.current);
        contextDetailTimerRef.current = null;
      }
      syncContextDetail();
      return;
    }

    const elapsed = Date.now() - lastContextDetailSyncAtRef.current;
    if (elapsed >= CONTEXT_DETAIL_STREAM_UPDATE_THROTTLE_MS) {
      syncContextDetail();
    } else if (contextDetailTimerRef.current === null) {
      contextDetailTimerRef.current = setTimeout(
        syncContextDetail,
        CONTEXT_DETAIL_STREAM_UPDATE_THROTTLE_MS - elapsed,
      );
    }
  }, [isGenerating, messages, sessionId]);
  const runStartedAt = runStartedAtBySession[sessionId];
  const workspaceGitQuery = useQuery({
    queryKey: workspaceGitQueryKey(workspaceKey, selectedCwd),
    queryFn: () => loadServerWorkspaceGit(workspaceKey, selectedCwd),
    enabled: Boolean(workspaceKey) && (!isDefaultWorkspaceId(workspaceKey) || Boolean(selectedCwd)),
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
    if (!isGenerating || !runStartedAt) {
      setGenerationElapsedSeconds(0);
      return;
    }

    const updateElapsed = () => {
      const started = Date.parse(runStartedAt);
      if (!Number.isFinite(started)) {
        setGenerationElapsedSeconds(0);
        return;
      }
      setGenerationElapsedSeconds(Math.max(0, Math.floor((Date.now() - started) / 1000)));
    };
    updateElapsed();
    const intervalId = window.setInterval(updateElapsed, 1000);
    return () => window.clearInterval(intervalId);
  }, [isGenerating, runStartedAt]);

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
  const generationElapsedLabel = formatElapsedDuration(generationElapsedSeconds);
  const generationBaseDetail =
    runProgress?.phase === "compacting"
      ? "正在保存目标、约束、事实和下一步"
      : runProgress?.phase === "finalizing"
        ? "工具已关闭，等待最终交接"
        : contextCompaction
          ? "已生成检查点，继续执行"
          : generationElapsedSeconds >= 10
            ? "响应较慢，仍在等待中"
            : "";
  const generationMetricDetail = [
    runProgress?.planWritten ? "正式计划已写入" : "",
    runProgress?.duplicateToolCallCount
      ? `重复只读调用 ${runProgress.duplicateToolCallCount} 次`
      : "",
  ]
    .filter(Boolean)
    .join(" · ");
  const generationDetail = [generationBaseDetail, generationMetricDetail]
    .filter(Boolean)
    .join(" · ");
  const lastMessage = messages[messages.length - 1];
  const livePlanDraft = useMemo(() => findLatestPlanWriteContent(messages), [messages]);
  const latestPlanWriteAnchor = useMemo(() => findLatestPlanWriteAnchor(messages), [messages]);
  const planWriteObserved = useMemo(() => latestAssistantHasPlanWrite(messages), [messages]);
  const planReady = Boolean(
    activePlan &&
      isPlanExecutionReady(planMode, activePlanHasContent, serverRunSummaries[sessionId]),
  );
  const canExecutePlan =
    planReady &&
    planTransition === "idle" &&
    !isGenerating &&
    Boolean(selectedModel) &&
    !input.trim() &&
    pendingAttachments.length === 0;
  const showPlanStartAction = canExecutePlan;
  const showPlanAttachment = Boolean(
    activePlan &&
      latestPlanWriteAnchor &&
      (activePlanHasContent || (planMode === "plan" && isGenerating && planWriteObserved)),
  );
  const openActivePlan = useCallback(() => {
    if (!activePlan) return;
    if (livePlanDraft !== undefined) {
      openPlanViewer({
        sessionId,
        planId: activePlan.id,
        fileName: activePlan.fileName,
        content: livePlanDraft,
        canExecute: canExecutePlan,
      });
      return;
    }
    void loadChatPlan(sessionId, activePlan.id)
      .then((plan) =>
        openPlanViewer({
          sessionId,
          planId: plan.id,
          fileName: plan.fileName,
          content: plan.content,
          canExecute: canExecutePlan,
        }),
      )
      .catch((error) => console.error("Failed to open chat plan", error));
  }, [activePlan, canExecutePlan, livePlanDraft, sessionId]);

  useEffect(() => {
    if (!activePlan) return;
    updatePlanViewer({
      sessionId,
      planId: activePlan.id,
      fileName: activePlan.fileName,
      ...(livePlanDraft === undefined ? {} : { content: livePlanDraft }),
      canExecute: canExecutePlan,
    });
  }, [activePlan, canExecutePlan, livePlanDraft, sessionId]);
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
    const routeKey = chatRouteKey(chatRoute);
    if (chatRoute.kind === "new") {
      if (resetChatDraft) {
        if (handledResetKeyRef.current === location.key) return;
        handledResetKeyRef.current = location.key;
        startNewSession(chatRoute.workspaceId, chatRoute.workspaceCwd, { skipNavigate: true });
        return;
      }
      if (appliedRouteKeyRef.current === routeKey) return;
      startNewSession(chatRoute.workspaceId, chatRoute.workspaceCwd, { skipNavigate: true });
      return;
    }
    if (appliedRouteKeyRef.current === routeKey && chatRoute.sessionId === sessionId) return;
    if (loadingSessionIdRef.current === chatRoute.sessionId) return;
    let active = true;
    loadingSessionIdRef.current = chatRoute.sessionId;
    setIsHydratingSession(true);
    void loadChatSession(chatRoute.sessionId).then((session) => {
      if (!active) return;
      loadingSessionIdRef.current = null;
      if (!session) {
        startNewSession(workspaceKey, sessionCwd);
        return;
      }
      appliedRouteKeyRef.current = routeKey;
      savedFingerprintRef.current = "";
      extractedFingerprintRef.current = "";
      pendingSessionRef.current = session;
      setSessionId(session.id);
      setSessionHydrateGeneration((current) => current + 1);
    });
    return () => {
      active = false;
      if (loadingSessionIdRef.current === chatRoute.sessionId) {
        loadingSessionIdRef.current = null;
      }
    };
  }, [
    chatRoute,
    isChatHistoryLoading,
    resetChatDraft,
    sessionCwd,
    sessionId,
    startNewSession,
    workspaceKey,
    location.key,
  ]);

  useEffect(() => {
    const session = pendingSessionRef.current;
    if (!session || session.id !== sessionId || isSkillsPending || disabledSkillsQuery.isPending)
      return;
    void sessionHydrateGeneration;
    pendingSessionRef.current = null;
    workspaceSelectionInitializedRef.current = true;
    suppressSaveRef.current = true;
    setSessionTitle(session.title);
    setSessionKind(session.kind === "task" ? "task" : "chat");
    setSessionSource(
      session.source === "cli" || session.source === "feishu" ? session.source : undefined,
    );
    setIsRenamingTitle(false);
    setWorkspaceKey(session.workspaceId ?? (session.cwd ? "" : DEFAULT_WORKSPACE_ID));
    setSessionCwd(
      isDefaultWorkspaceId(session.workspaceId)
        ? resolveDefaultSessionCwd(
            workspaceProjects.find((project) => project.id === DEFAULT_WORKSPACE_ID)?.path,
            session.id,
            session.cwd,
          )
        : (session.cwd ?? ""),
    );
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
    const allowed = new Set(allowedSkillIds);
    sessionSkillOverrideRef.current = Array.isArray(session.skillIds);
    const sessionSkillIds = session.skillIds;
    setSelectedSkillIds(
      sessionSkillIds ? sessionSkillIds.filter((id) => allowed.has(id)) : allowedSkillIds,
    );
    setPlanMode(session.planMode ?? "apply");
    setActivePlanId(session.activePlanId);
    setActivePlanHasContent(false);
    setPlans(session.plans ?? []);
    planTransitionRef.current = "idle";
    setPlanTransition("idle");
    setPlanModeError("");
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
    setIsHydratingSession(false);
  }, [
    allowedSkillIds,
    disabledSkillsQuery.isPending,
    isSkillsPending,
    sessionHydrateGeneration,
    sessionId,
    setMessages,
    workspaceProjects,
  ]);

  const indexTitle = chatIndex.find((item) => item.id === sessionId)?.title;
  useEffect(() => {
    if (!indexTitle) return;
    const previous = lastSyncedIndexTitleRef.current;
    if (!previous || previous.sessionId !== sessionId) {
      lastSyncedIndexTitleRef.current = { sessionId, title: indexTitle };
      return;
    }
    if (previous.title === indexTitle) return;
    lastSyncedIndexTitleRef.current = { sessionId, title: indexTitle };
    setSessionTitle(indexTitle);
  }, [indexTitle, sessionId]);

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
    const title = resolveSessionTitle(sessionTitleRef.current, messages);
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
        const screenshots = materializeBrowserScreenshots(
          materialized.messages,
          materialized.attachments,
        );
        sessionAttachmentsRef.current = screenshots.attachments;
        if (materialized.changed || screenshots.changed) {
          await saveChatSession({
            ...canonicalSession,
            title: resolveSessionTitle(canonicalSession.title, materialized.messages),
            updatedAt: now,
            messages: materialized.messages,
            attachments: screenshots.attachments,
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
      const errors: string[] = [];
      for (const file of files) {
        const error = validateAttachment(file, current.length + accepted.length);
        if (error) {
          errors.push(error);
          continue;
        }
        accepted.push(createPendingAttachment(file));
      }
      setAttachmentError(errors[0] ?? "");
      if (accepted.length === 0) return;
      const next = [...current, ...accepted];
      setPendingAttachments(next);
      pendingAttachmentsRef.current = next;
      const sessionIdValue = sessionId;
      try {
        await initializeChatServer();
        await ensureChatServerSession(sessionIdValue, {
          cwd: selectedCwd || undefined,
          workspaceId: isDefaultWorkspaceId(workspaceKey)
            ? DEFAULT_WORKSPACE_ID
            : workspaceKey || undefined,
        });
        promoteDraftSession();
      } catch (error) {
        console.error("Failed to ensure chat server session for attachment upload", error);
      }
      for (const pending of accepted) {
        uploadPendingAttachment(sessionIdValue, pending)
          .then(({ attachment, file, previewUrl }) => {
            setPendingAttachments((prev) => {
              if (!prev.some((item) => item.localId === pending.localId)) {
                if (previewUrl) URL.revokeObjectURL(previewUrl);
                return prev;
              }
              return prev.map((item) =>
                item.localId === pending.localId
                  ? {
                      ...item,
                      file,
                      fileName: attachment.fileName ?? item.fileName,
                      mediaType: attachment.mediaType,
                      size: attachment.size ?? item.size,
                      kind: attachment.kind,
                      previewUrl,
                      status: "ready" as const,
                      attachmentId: attachment.id,
                      path: attachment.path,
                    }
                  : item,
              );
            });
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
    [promoteDraftSession, sessionId, selectedCwd, workspaceKey],
  );

  const removePendingAttachment = useCallback((localId: string) => {
    setPendingAttachments((prev) => {
      const target = prev.find((item) => item.localId === localId);
      if (target?.previewUrl) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((item) => item.localId !== localId);
    });
  }, []);

  function handleDragEnter(event: React.DragEvent<HTMLDivElement>) {
    if (sessionKindRef.current === "task" || isReadOnly) return;
    if (!event.dataTransfer.types.includes("Files")) return;
    event.preventDefault();
    dragCounterRef.current += 1;
    setIsDragOver(true);
  }

  function handleDragOver(event: React.DragEvent<HTMLDivElement>) {
    if (sessionKindRef.current === "task" || isReadOnly) return;
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
    if (sessionKindRef.current === "task" || isReadOnly) return;
    if (!event.dataTransfer.types.includes("Files")) return;
    event.preventDefault();
    dragCounterRef.current = 0;
    setIsDragOver(false);
    if (event.dataTransfer.files.length > 0) {
      void addFiles(event.dataTransfer.files);
    }
  }

  async function enterPlanMode() {
    if (sessionKindRef.current === "task" || isReadOnly) return false;
    if (isGenerating || planTransitionRef.current !== "idle") return false;
    const requestId = ++planCreationRequestRef.current;
    const targetSessionId = sessionId;
    planTransitionRef.current = "entering";
    setPlanTransition("entering");
    setPlanModeError("");
    try {
      await initializeChatServer();
      await ensureChatServerSession(targetSessionId, {
        cwd: selectedCwd || undefined,
        workspaceId: isDefaultWorkspaceId(workspaceKey)
          ? DEFAULT_WORKSPACE_ID
          : workspaceKey || undefined,
      });
      promoteDraftSession();
      const plan = await createChatPlan(targetSessionId);
      const summary: ChatPlanSummary = {
        id: plan.id,
        fileName: plan.fileName,
        createdAt: plan.createdAt,
        updatedAt: plan.updatedAt,
      };
      if (
        planCreationRequestRef.current !== requestId ||
        activeSessionRef.current !== targetSessionId
      ) {
        void updateChatPlanMode(targetSessionId, "apply", plan.id).catch((planError) =>
          console.error("Failed to close stale plan mode", planError),
        );
        return false;
      }
      setPlans((current) => [summary, ...current.filter((item) => item.id !== summary.id)]);
      void queryClient.invalidateQueries({ queryKey: ["chat-plans", targetSessionId] });
      planModeRef.current = "plan";
      activePlanIdRef.current = plan.id;
      setPlanMode("plan");
      setActivePlanId(plan.id);
      setActivePlanHasContent(false);
      return true;
    } catch (planError) {
      if (planCreationRequestRef.current !== requestId) return false;
      setPlanModeError(
        planError instanceof Error ? planError.message : "进入计划模式失败，请重试。",
      );
      console.error("Failed to enter plan mode", planError);
      return false;
    } finally {
      if (planCreationRequestRef.current === requestId) {
        planTransitionRef.current = "idle";
        setPlanTransition("idle");
      }
    }
  }

  async function exitPlanMode() {
    if (planTransitionRef.current !== "idle" || isGenerating) return;
    const requestId = ++planCreationRequestRef.current;
    planTransitionRef.current = "exiting";
    setPlanTransition("exiting");
    setPlanModeError("");
    try {
      await updateChatPlanMode(sessionId, "apply", activePlanIdRef.current);
      if (planCreationRequestRef.current !== requestId) return;
      planModeRef.current = "apply";
      setPlanMode("apply");
    } catch (planError) {
      if (planCreationRequestRef.current !== requestId) return;
      setPlanModeError(
        planError instanceof Error ? planError.message : "退出计划模式失败，请重试。",
      );
      console.error("Failed to exit plan mode", planError);
    } finally {
      if (planCreationRequestRef.current === requestId) {
        planTransitionRef.current = "idle";
        setPlanTransition("idle");
      }
    }
  }

  function isPlanConfirmation(text: string) {
    return /^(开始执行|确认执行|按计划执行|开始实施|执行计划|apply)$/i.test(text.trim());
  }

  async function sendPreparedMessage(
    text: string,
    pending: PendingAttachment[],
    options: { clearComposer?: boolean } = {},
  ) {
    if (sessionKindRef.current === "task" || isReadOnly) return;
    if (!text && pending.length === 0) return;
    const clearComposer = options.clearComposer ?? true;
    promoteDraftSession();
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
    if (clearComposer) {
      setPendingAttachments([]);
      pendingAttachmentsRef.current = [];
      setInput("");
    }
    setContextCompaction(null);
    setPlanModeError("");
    setAttachmentError("");
    shouldFollowScrollRef.current = true;
    liveDraftsRef.current.delete(sessionId);
    attachedStreamSessionRef.current = sessionId;
    transportStartedAtRef.current = Date.now();
    if (filesToSend.length > 0) {
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
      return;
    }
    await sendMessage({ text });
  }
  sendPreparedMessageRef.current = sendPreparedMessage;

  function queuePreparedMessage(text: string, pending: PendingAttachment[]) {
    if (isReadOnly || (!text && pending.length === 0) || !isGenerating) return;
    promoteDraftSession();
    const nextMessages = [
      ...queuedMessagesRef.current,
      { id: crypto.randomUUID(), sessionId, text, pending },
    ];
    queuedMessagesRef.current = nextMessages;
    setQueuedMessages(nextMessages);
    setInput("");
    setPendingAttachments([]);
    pendingAttachmentsRef.current = [];
    setContextCompaction(null);
    setPlanModeError("");
    setAttachmentError("");
  }

  function cancelQueuedMessage(messageId: string) {
    const target = queuedMessagesRef.current.find((message) => message.id === messageId);
    for (const item of target?.pending ?? []) {
      if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
    }
    const nextMessages = queuedMessagesRef.current.filter((message) => message.id !== messageId);
    queuedMessagesRef.current = nextMessages;
    setQueuedMessages(nextMessages);
  }

  async function sendFollowUpMessage() {
    const text = input.trim();
    const pending = pendingAttachmentsRef.current;
    const hasUploading = pending.some((item) => item.status === "uploading");
    if (
      (!text && pending.length === 0) ||
      hasUploading ||
      !isGenerating ||
      followUpInFlightRef.current ||
      planTransitionRef.current !== "idle"
    ) {
      return;
    }
    followUpInFlightRef.current = true;
    setFollowUpPending(true);
    try {
      if (!(await stopCurrentRun())) return;
      if (activeSessionRef.current !== sessionId) return;
      await sendPreparedMessage(text, pending);
    } catch (error) {
      console.error("Failed to send chat follow-up", error);
    } finally {
      followUpInFlightRef.current = false;
      setFollowUpPending(false);
    }
  }

  useEffect(() => {
    if (
      isGenerating ||
      !queuedMessages.some((message) => message.sessionId === sessionId) ||
      queueDispatchInFlightRef.current ||
      followUpInFlightRef.current ||
      stopPending ||
      planTransition !== "idle"
    ) {
      return;
    }
    const targetSessionId = sessionId;
    queueDispatchInFlightRef.current = true;
    void (async () => {
      try {
        while (
          !isGenerating &&
          activeSessionRef.current === targetSessionId &&
          planTransitionRef.current === "idle" &&
          !followUpInFlightRef.current &&
          !stopInFlightRef.current
        ) {
          const next = queuedMessagesRef.current.find(
            (message) => message.sessionId === targetSessionId,
          );
          if (!next) break;
          const remaining = queuedMessagesRef.current.filter((message) => message.id !== next.id);
          queuedMessagesRef.current = remaining;
          setQueuedMessages(remaining);
          await sendPreparedMessageRef.current(next.text, next.pending, {
            clearComposer: false,
          });
        }
      } finally {
        queueDispatchInFlightRef.current = false;
      }
    })();
  }, [isGenerating, planTransition, queuedMessages, sessionId, stopPending]);

  useEffect(() => {
    setQueuedMessages((current) => {
      const stale = current.filter((message) => message.sessionId !== sessionId);
      if (stale.length === 0) return current;
      for (const message of stale) {
        for (const item of message.pending) {
          if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
        }
      }
      const nextMessages = current.filter((message) => message.sessionId === sessionId);
      queuedMessagesRef.current = nextMessages;
      return nextMessages;
    });
  }, [sessionId]);

  function confirmPlanExecution() {
    if (planModeRef.current !== "plan") return;
    if (isGenerating || planTransitionRef.current !== "idle") return;
    if (!planReady || !activePlanIdRef.current) {
      setPlanModeError("正式计划尚未写入，请等待计划生成结束后再执行。");
      return;
    }
    if (!selectedModelRef.current) {
      setPlanModeError("请先配置并选择一个模型。");
      return;
    }
    if (input.trim()) {
      setPlanModeError("执行计划前请先发送或清空 Composer 中的补充说明。");
      return;
    }
    if (pendingAttachmentsRef.current.length > 0) {
      setPlanModeError("执行计划前请先发送或移除待处理附件。");
      return;
    }
    planModeRef.current = "apply";
    setPlanMode("apply");
    void sendPreparedMessage("确认开始执行当前计划，请按计划修改代码并完成必要验证。", []);
  }
  confirmPlanExecutionRef.current = confirmPlanExecution;

  useEffect(() => {
    return subscribePlanExecutionRequested((request) => {
      if (request.sessionId !== sessionId || request.planId !== activePlanIdRef.current) return;
      confirmPlanExecutionRef.current();
    });
  }, [sessionId]);

  function addSelectionToComposer() {
    if (isReadOnly) return;
    const snippet = selectedSnippetRef.current;
    if (!snippet) return;
    setSelectionToolbar(null);
    setInput((current) => appendComposerSelection(current, snippet));
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  function addSelectionToSideChat() {
    const snippet = selectedSnippetRef.current;
    if (!snippet) return;
    setSelectionToolbar(null);
    openSideChat({ draft: snippet });
  }

  async function copySelection() {
    const snippet = selectedSnippetRef.current;
    if (!snippet || !navigator.clipboard) return;
    try {
      await navigator.clipboard.writeText(snippet);
    } catch (error) {
      console.error("Failed to copy selected chat text", error);
    }
  }

  function captureTranscriptSelection(event: React.MouseEvent) {
    const text = readWindowSelectionText();
    selectedSnippetRef.current = text;
    if (!text) {
      event.preventDefault();
      event.stopPropagation();
    }
  }

  useEffect(() => {
    function updateSelectionToolbar() {
      const selection = window.getSelection();
      const text = selection?.toString().trim() ?? "";
      const range = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
      const stage = scrollRef.current;
      if (!text || !range || !stage?.contains(range.commonAncestorContainer)) {
        if (selectionToolbarTimerRef.current !== null) {
          window.clearTimeout(selectionToolbarTimerRef.current);
          selectionToolbarTimerRef.current = null;
        }
        selectedSnippetRef.current = "";
        setSelectionToolbar(null);
        return;
      }
      const rect = range.getBoundingClientRect();
      if (!rect.width && !rect.height) {
        setSelectionToolbar(null);
        return;
      }
      selectedSnippetRef.current = text;
      if (selectionToolbarTimerRef.current !== null) {
        window.clearTimeout(selectionToolbarTimerRef.current);
      }
      selectionToolbarTimerRef.current = window.setTimeout(() => {
        selectionToolbarTimerRef.current = null;
        const currentSelection = window.getSelection();
        if (currentSelection?.toString().trim() !== selectedSnippetRef.current) return;
        setSelectionToolbar({
          left: Math.min(Math.max(rect.left + rect.width / 2, 156), window.innerWidth - 156),
          top: Math.max(rect.top - 42, 8),
        });
      }, 1000);
    }

    document.addEventListener("selectionchange", updateSelectionToolbar);
    window.addEventListener("resize", updateSelectionToolbar);
    scrollRef.current?.addEventListener("scroll", updateSelectionToolbar);
    return () => {
      document.removeEventListener("selectionchange", updateSelectionToolbar);
      window.removeEventListener("resize", updateSelectionToolbar);
      scrollRef.current?.removeEventListener("scroll", updateSelectionToolbar);
      if (selectionToolbarTimerRef.current !== null) {
        window.clearTimeout(selectionToolbarTimerRef.current);
      }
    };
  }, []);

  function submitMessage() {
    if (sessionKindRef.current === "task" || isReadOnly) return;
    const text = input.trim();
    const pending = pendingAttachmentsRef.current;
    const hasUploading = pending.some((item) => item.status === "uploading");
    if (isGenerating || hasUploading || planTransitionRef.current !== "idle") return;
    if (text === "/plan") {
      setInput("");
      setCommandCaret(0);
      setCommandDismissed(true);
      void enterPlanMode();
      return;
    }
    if (text.startsWith("/plan ")) {
      const remaining = text.slice("/plan ".length).trim();
      setInput("");
      setCommandCaret(0);
      setCommandDismissed(true);
      void enterPlanMode().then((entered) => {
        if (entered) {
          void sendPreparedMessage(remaining, pending);
          return;
        }
        setInput(remaining);
        setCommandCaret(remaining.length);
        requestAnimationFrame(() => inputRef.current?.focus());
      });
      return;
    }
    if (planModeRef.current === "plan" && isPlanConfirmation(text)) {
      confirmPlanExecution();
      return;
    }
    void sendPreparedMessage(text, pending);
  }

  async function stopCurrentRun() {
    if (stopInFlightRef.current) return false;
    const targetSessionId = sessionId;
    stopInFlightRef.current = true;
    setStopPending(true);
    try {
      await stop();
      await stopChatServerRun(targetSessionId);
      const canonicalSession = await loadChatSession(targetSessionId);
      if (canonicalSession && activeSessionRef.current === targetSessionId) {
        liveDraftsRef.current.delete(targetSessionId);
        setMessages(canonicalSession.messages);
      }
      return true;
    } finally {
      stopInFlightRef.current = false;
      setStopPending(false);
    }
  }

  function stopCurrentRunFromButton() {
    void stopCurrentRun().catch((error) => {
      console.error("Failed to stop Chat Server run", error);
    });
  }

  const respondToApproval = useCallback(
    (id: string, approved: boolean) => {
      if (sessionKindRef.current === "task") return;
      void addToolApprovalResponse({
        id,
        approved,
        reason: approved ? undefined : "用户拒绝了此次操作",
      });
    },
    [addToolApprovalResponse],
  );

  const respondToPlanUserInput = useCallback(
    async (toolCallId: string, output: PlanUserInputResponse) => {
      if (planModeRef.current !== "plan" || planTransitionRef.current !== "idle") {
        throw new Error("计划模式已关闭");
      }
      await addToolOutput({
        tool: PLAN_USER_INPUT_TOOL_NAME,
        toolCallId,
        output,
      });
    },
    [addToolOutput],
  );

  async function copyConversationId() {
    const copied = await copyChatConversationId(sessionId);
    setConversationCopiedKind(copied ? "id" : null);
    if (copied) {
      window.setTimeout(
        () => setConversationCopiedKind((current) => (current === "id" ? null : current)),
        1500,
      );
    }
  }

  async function copyConversationMarkdown() {
    const copied = await copyChatConversationMarkdown({
      title: sessionTitleRef.current,
      messages,
    });
    setConversationCopiedKind(copied ? "markdown" : null);
    if (copied) {
      window.setTimeout(
        () => setConversationCopiedKind((current) => (current === "markdown" ? null : current)),
        1500,
      );
    }
  }

  async function forkConversation(messageId: string) {
    if (sessionKindRef.current === "task" || isGenerating || forkingMessageId) return;
    setForkError("");
    setForkingMessageId(messageId);
    try {
      const forked = await forkChatServerSession(sessionId, { messageId });
      await queryClient.invalidateQueries({ queryKey: ["chat-index"] });
      navigate(chatSessionPath(forked.id));
    } catch (error) {
      setForkError(error instanceof Error ? error.message : "创建对话分支失败，请重试。");
    } finally {
      setForkingMessageId(null);
    }
  }

  const canCopyConversationMarkdown = canFormatChatConversationMarkdown(messages);

  const canEditConversationTitle = !isGenerating && !isRenamingTitle;
  const canRegenerateConversationTitle =
    canEditConversationTitle &&
    messages.some((message) => message.role === "user" && messageText(message).trim());

  function openTitleDialog() {
    if (!canEditConversationTitle) return;
    setConversationMenuOpen(false);
    setTitleDialogOpen(true);
  }

  async function regenerateConversationTitle() {
    if (!canRegenerateConversationTitle) {
      return;
    }
    setIsRenamingTitle(true);
    try {
      const result = await regenerateChatSessionTitle(sessionId);
      if (activeSessionRef.current !== sessionId) return;
      setSessionTitle(result.title);
      void queryClient.invalidateQueries({ queryKey: ["chat-index"] });
    } catch (renameError) {
      if (activeSessionRef.current !== sessionId) return;
      throw renameError;
    } finally {
      if (activeSessionRef.current === sessionId) setIsRenamingTitle(false);
    }
  }

  async function saveConversationTitle(title: string) {
    const result = await updateChatSessionTitle(sessionId, title);
    if (activeSessionRef.current !== sessionId) return;
    setSessionTitle(result.title);
    void queryClient.invalidateQueries({ queryKey: ["chat-index"] });
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

  const commandTrigger = useMemo(
    () => findActiveCommandTrigger(composerPlain, commandCaret),
    [composerPlain, commandCaret],
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
  const mentionTrigger = useMemo(
    () => findActiveMentionTrigger(composerPlain, commandCaret),
    [composerPlain, commandCaret],
  );
  const mentionQuery = mentionTrigger?.query ?? "";
  const [debouncedMentionQuery, setDebouncedMentionQuery] = useState("");
  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedMentionQuery(mentionQuery), 500);
    return () => window.clearTimeout(timer);
  }, [mentionQuery]);
  const mentionQueryResult = useQuery({
    queryKey: ["workspace-path-suggestions", workspaceKey, selectedCwd, debouncedMentionQuery],
    queryFn: ({ signal }) =>
      loadServerWorkspacePathSuggestions(
        workspaceKey,
        debouncedMentionQuery,
        selectedCwd,
        20,
        signal,
      ),
    enabled: Boolean(
      mentionTrigger && debouncedMentionQuery.length >= 2 && workspaceKey && selectedCwd,
    ),
    staleTime: 10_000,
    retry: false,
  });
  const mentionSuggestions = mentionQueryResult.data?.suggestions ?? [];
  const mentionPopupOpen =
    !commandPopupOpen &&
    Boolean(mentionTrigger) &&
    debouncedMentionQuery.length >= 2 &&
    !mentionDismissed &&
    (mentionQueryResult.isPending || mentionSuggestions.length > 0);
  const activeMention = mentionPopupOpen
    ? mentionSuggestions[Math.min(mentionIndex, mentionSuggestions.length - 1)]
    : undefined;

  // biome-ignore lint/correctness/useExhaustiveDependencies: 查询串变化时需要重置 popup 选中与关闭状态
  useEffect(() => {
    setCommandIndex(0);
    setCommandDismissed(false);
  }, [commandQuery]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: mention 查询串变化时需要重置 popup 选中与关闭状态
  useEffect(() => {
    setMentionIndex(0);
    setMentionDismissed(false);
  }, [mentionQuery]);

  function applyChatMention(suggestion: NonNullable<typeof activeMention>) {
    const result = applyMentionSelection(
      composerPlain,
      commandCaret,
      suggestion.path,
      suggestion.kind,
    );
    if (!result) return;
    const trigger = findActiveMentionTrigger(composerPlain, commandCaret);
    if (!trigger) return;
    setMentionDismissed(!result.keepOpen);
    const suffix = suggestion.kind === "dir" ? "/" : " ";
    inputRef.current?.replaceRange(trigger.start, commandCaret, `@${suggestion.path}${suffix}`);
  }

  function applyChatCommand(command: ChatCommand) {
    const trigger = findActiveCommandTrigger(composerPlain, commandCaret);
    if (!trigger) return;
    if (command.name === "/plan") {
      inputRef.current?.replaceRange(trigger.start, commandCaret, "");
      setCommandDismissed(true);
      void enterPlanMode();
      return;
    }
    setCommandDismissed(true);
    inputRef.current?.replaceRange(trigger.start, commandCaret, `${command.name} `);
  }

  function handleComposerKeyDown(event: KeyboardEvent) {
    if (commandPopupOpen && !event.isComposing && event.keyCode !== 229) {
      if (
        (event.key === "ArrowDown" || event.key === "ArrowUp") &&
        !event.altKey &&
        !event.metaKey &&
        !event.ctrlKey
      ) {
        event.preventDefault();
        const count = commandMatches.length;
        setCommandIndex((current) =>
          event.key === "ArrowDown" ? (current + 1) % count : (current - 1 + count) % count,
        );
        return true;
      }
      if ((event.key === "Enter" || event.key === "Tab") && activeCommand) {
        event.preventDefault();
        applyChatCommand(activeCommand);
        return true;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        setCommandDismissed(true);
        return true;
      }
    }
    if (mentionPopupOpen && !event.isComposing && event.keyCode !== 229) {
      if (
        (event.key === "ArrowDown" || event.key === "ArrowUp") &&
        !event.altKey &&
        !event.metaKey &&
        !event.ctrlKey
      ) {
        event.preventDefault();
        setMentionIndex((current) => {
          const count = mentionSuggestions.length;
          if (!count) return 0;
          return event.key === "ArrowDown" ? (current + 1) % count : (current - 1 + count) % count;
        });
        return true;
      }
      if ((event.key === "Enter" || event.key === "Tab") && activeMention) {
        event.preventDefault();
        applyChatMention(activeMention);
        return true;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        setMentionDismissed(true);
        return true;
      }
    }
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing && event.keyCode !== 229) {
      event.preventDefault();
      const action = resolveComposerEnterAction({ isGenerating, metaKey: event.metaKey });
      if (action === "follow-up") {
        void sendFollowUpMessage();
        return true;
      }
      if (action === "queue") {
        queuePreparedMessage(input.trim(), pendingAttachmentsRef.current);
        return true;
      }
      submitMessage();
      return true;
    }
    return false;
  }

  const showHydrateSkeleton =
    chatRoute.kind === "session" && (isHydratingSession || chatRoute.sessionId !== sessionId);
  const showEmptyState = !showHydrateSkeleton && messages.length === 0;
  const selectUserMessageNavItems = useMemo(() => createUserMessageNavItemsSelector(), []);
  const userMessageNavItems = showHydrateSkeleton ? [] : selectUserMessageNavItems(messages);
  const jumpToUserMessage = useCallback((_id: string) => {
    shouldFollowScrollRef.current = false;
  }, []);

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: drag-and-drop file upload zone; keyboard users use the attach button
    <div
      className="chat-page"
      data-chat-empty={showEmptyState ? "true" : "false"}
      data-chat-font-size={chatDisplay.fontSize}
      data-chat-spacing={chatDisplay.spacing}
      data-chat-body-font={chatDisplay.bodyFont}
      data-chat-code-font={chatDisplay.codeFont}
      data-chat-math-font={chatDisplay.mathFont}
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
              {sessionKind === "task" ? <span className="chat-session-kind">任务</span> : null}
              {sessionSource === "cli" ? <span className="chat-session-kind">CLI</span> : null}
              {sessionSource === "feishu" ? <span className="chat-session-kind">飞书</span> : null}
              {isRenamingTitle ? (
                <LoaderCircle
                  aria-hidden="true"
                  className="ml-1 size-3.5 shrink-0 animate-spin text-muted-foreground"
                />
              ) : null}
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
                    className="chat-title-action ml-1"
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
                  <ChatConversationMenuItems
                    Item={DropdownMenuItem}
                    canCopyAsMarkdown={canCopyConversationMarkdown}
                    canRegenerateTitle={canEditConversationTitle}
                    conversationIdCopied={conversationCopiedKind === "id"}
                    conversationMarkdownCopied={conversationCopiedKind === "markdown"}
                    onCopyAsMarkdown={() => void copyConversationMarkdown()}
                    onCopyConversationId={() => void copyConversationId()}
                    onRegenerateTitle={openTitleDialog}
                  />
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </div>
        <div className="chat-header-actions">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                aria-label="打开 Chat 工具菜单"
                className="chat-header-action-secondary chat-icon-button"
                size="icon"
                title="打开 Chat 工具菜单"
                type="button"
                variant="ghost"
              >
                <List className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="chat-select-menu" sideOffset={8}>
              <DropdownMenuItem onSelect={() => setContextOpen(true)}>
                <FileText className="size-3.5" />
                查看 System Prompt
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => void openContextDetailPanel()}>
                <ChartColumn className="size-3.5" />
                上下文详情
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setToolLogOpen(true)}>
                <Wrench className="size-3.5" />
                Tool 记录
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={
                  !workspaceKey ||
                  !(
                    (workspaceGitQuery.data?.summary?.filesChanged ?? 0) > 0 ||
                    (workspaceGitQuery.data?.summary?.ahead ?? 0) > 0
                  )
                }
                onSelect={() => setGitCommitOpen(true)}
              >
                <Upload className="size-3.5" />
                提交或推送
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      {selectionToolbar ? (
        <div
          className="chat-selection-toolbar"
          style={{ left: selectionToolbar.left, top: selectionToolbar.top }}
        >
          <Button
            aria-label="添加选中文本到对话"
            onClick={addSelectionToComposer}
            onMouseDown={(event) => event.preventDefault()}
            size="sm"
            type="button"
            variant="ghost"
          >
            <MessageSquarePlus className="size-3.5" />
            添加到对话
          </Button>
          <Button
            aria-label="添加选中文本到侧边聊天"
            onClick={addSelectionToSideChat}
            onMouseDown={(event) => event.preventDefault()}
            size="sm"
            type="button"
            variant="ghost"
          >
            <PanelRight className="size-3.5" />
            添加到侧边聊天
          </Button>
        </div>
      ) : null}
      <div className="chat-stage-shell">
        <ContextMenu>
          <ContextMenuTrigger asChild onContextMenu={captureTranscriptSelection}>
            <div className="chat-stage" ref={scrollRef}>
              <div className="chat-content">
                {showHydrateSkeleton ? (
                  <div aria-busy="true" className="chat-transcript-skeleton" role="status">
                    <span className="sr-only">正在加载对话</span>
                    <div className="chat-transcript-skeleton-line is-wide" />
                    <div className="chat-transcript-skeleton-line" />
                    <div className="chat-transcript-skeleton-line is-wide" />
                    <div className="chat-transcript-skeleton-line is-short" />
                    <div className="chat-transcript-skeleton-line" />
                    <div className="chat-transcript-skeleton-line is-short" />
                  </div>
                ) : null}
                {!showHydrateSkeleton && showEmptyState ? (
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
                {showHydrateSkeleton
                  ? null
                  : messages.map((message) => (
                      <MessageBubble
                        key={message.id}
                        message={message}
                        approvalsEnabled={sessionKind !== "task"}
                        onApprovalResponse={respondToApproval}
                        onFork={sessionKind === "chat" ? forkConversation : undefined}
                        forkDisabled={isGenerating || Boolean(forkingMessageId)}
                        forkInFlight={forkingMessageId === message.id}
                        onPlanUserInputResponse={respondToPlanUserInput}
                        planInputEnabled={planMode === "plan" && planTransition === "idle"}
                        planAttachment={
                          showPlanAttachment &&
                          activePlan &&
                          latestPlanWriteAnchor?.messageId === message.id
                            ? {
                                fileName: activePlan.fileName,
                                isGenerating: isGenerating && planMode === "plan",
                                onOpen: openActivePlan,
                                toolCallId: latestPlanWriteAnchor.toolCallId,
                              }
                            : undefined
                        }
                        generationStatus={
                          isGenerating &&
                          message.role === "assistant" &&
                          message.id === lastMessage?.id
                            ? {
                                detail: generationDetail,
                                elapsedLabel: generationElapsedLabel,
                                phase: generationPhase,
                              }
                            : undefined
                        }
                        isStreaming={
                          effectiveStatus === "streaming" && message.id === lastMessage?.id
                        }
                        showTokenUsage={chatDisplay.showTokenUsage}
                        cwd={selectedCwd}
                        workspaceId={workspaceKey || undefined}
                      />
                    ))}
                {developerEnvironmentQuery.data &&
                unavailableDetectedTools.length > 0 &&
                environmentGuideKey !== dismissedEnvironmentGuide ? (
                  <div
                    aria-live="polite"
                    className="flex flex-col gap-3 border-border border-y bg-muted/35 px-4 py-3 sm:flex-row sm:items-center"
                  >
                    <CircleAlert className="size-4 shrink-0 text-primary" />
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-sm">本地开发工具尚未接入</p>
                      <p className="mt-0.5 text-muted-foreground text-xs">
                        终端找不到 {unavailableDetectedTools.join("、")}。导入后可重新运行当前任务。
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <Button
                        onClick={() => setEnvironmentImportOpen(true)}
                        size="sm"
                        type="button"
                      >
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
                    <div className="chat-message-body">
                      <div className="chat-message-meta">
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
          </ContextMenuTrigger>
          <ContextMenuContent onCloseAutoFocus={(event) => event.preventDefault()}>
            <ContextMenuItem onSelect={() => void copySelection()}>
              <Copy className="size-4" />
              复制
            </ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>
        {userMessageNavItems.length > 0 ? (
          <ChatMessageNav
            items={userMessageNavItems}
            onJump={jumpToUserMessage}
            scrollRef={scrollRef}
          />
        ) : null}
      </div>

      <div className="chat-composer-wrap">
        <div className="chat-composer-float-stack">
          {queuedMessages.length > 0 ? (
            <div aria-live="polite" className="chat-queue-float" role="status">
              {queuedMessages.map((message, index) => (
                <div className="chat-queue-float-row" key={message.id}>
                  <span className="chat-queue-float-index">{index + 1}</span>
                  <Clock3 aria-hidden="true" className="size-3.5" />
                  <span className="chat-queue-float-text">
                    {message.text || `${message.pending.length} 个附件`}
                  </span>
                  <button
                    aria-label={`取消排队消息 ${index + 1}`}
                    className="chat-queue-float-cancel"
                    onClick={() => cancelQueuedMessage(message.id)}
                    title="取消排队消息"
                    type="button"
                  >
                    <X className="size-3" />
                  </button>
                </div>
              ))}
            </div>
          ) : null}
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
            {showPlanStartAction ? (
              <Button
                aria-label="执行计划"
                className="chat-plan-start-float"
                onClick={confirmPlanExecution}
                title="执行当前计划"
                type="button"
              >
                <Play aria-hidden="true" className="size-3.5 fill-current" />
                执行计划
              </Button>
            ) : null}
          </div>
        </div>
        {error || planModeError || attachmentError || forkError ? (
          <p className="chat-error" role="alert">
            {planModeError ||
              attachmentError ||
              forkError ||
              (recoverableTransportError
                ? serverRunActive
                  ? "响应连接已中断，正在从后台任务恢复…"
                  : "与 Chat Server 的连接已中断，请稍后重试。"
                : error?.message)}
          </p>
        ) : null}
        <div className="chat-workspace-bar">
          {showEmptyState ? (
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
                    <span className="chat-workspace-option-label">{DEFAULT_WORKSPACE_NAME}</span>
                  </DropdownMenuRadioItem>
                  {workspaceProjects
                    .filter((project) => project.id !== DEFAULT_WORKSPACE_ID)
                    .map((project) => (
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
        {sessionKind === "task" ? (
          <div className="chat-task-status" role="status">
            <p>后台任务，仅可查看进度</p>
            {isGenerating ? (
              <Button
                disabled={stopPending}
                onClick={stopCurrentRunFromButton}
                size="sm"
                type="button"
                variant="ghost"
              >
                {stopPending ? (
                  <LoaderCircle className="size-3.5 animate-spin" />
                ) : (
                  <Square className="size-3.5 fill-current" />
                )}
                停止
              </Button>
            ) : null}
          </div>
        ) : (
          <div className="chat-composer">
            {isReadOnly ? (
              <div className="px-3 py-2 text-[12px] text-muted-foreground" role="status">
                飞书会话由飞书消息驱动，仅支持查看和回复。
              </div>
            ) : null}
            <input
              aria-hidden="true"
              className="chat-file-input"
              multiple
              onChange={(event) => {
                if (isReadOnly) return;
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
            {mentionPopupOpen && (
              <ChatPathSuggestionPopup
                activeIndex={Math.min(mentionIndex, Math.max(mentionSuggestions.length - 1, 0))}
                isLoading={mentionQueryResult.isPending}
                onHover={setMentionIndex}
                onSelect={applyChatMention}
                suggestions={mentionSuggestions}
              />
            )}
            <ChatComposerInput
              ariaControls={mentionPopupOpen ? "chat-path-suggestion-popup" : "chat-command-popup"}
              ariaExpanded={commandPopupOpen || mentionPopupOpen}
              disabled={isReadOnly || planTransition !== "idle" || followUpPending || stopPending}
              onBlur={() => setCommandDismissed(true)}
              onChange={(next) => {
                setInput(next.markdown);
                setComposerPlain(next.plain);
                setCommandCaret(next.caret);
                if (next.fromEdit) setMentionDismissed(false);
              }}
              onKeyDown={handleComposerKeyDown}
              onPasteFiles={(files) => {
                void addFiles(files);
              }}
              placeholder="问问你的工作空间..."
              ref={inputRef}
              value={input}
            />
            <div className="chat-composer-footer">
              <div className="chat-composer-tools">
                <Button
                  aria-label="添加附件"
                  className="chat-tool-button !size-7"
                  disabled={isReadOnly || planTransition !== "idle"}
                  onClick={() => fileInputRef.current?.click()}
                  size="icon"
                  title="添加附件"
                  type="button"
                  variant="ghost"
                >
                  <Paperclip className="size-4" />
                </Button>
                {planTransition === "entering" ? (
                  <span aria-label="正在进入计划模式" className="chat-plan-mode-chip" role="status">
                    <LoaderCircle aria-hidden="true" className="size-3 animate-spin" />
                    <span>正在进入计划模式</span>
                  </span>
                ) : planMode === "plan" ? (
                  <span aria-label="计划模式" className="chat-plan-mode-chip" role="status">
                    {planTransition === "exiting" ? (
                      <LoaderCircle aria-hidden="true" className="size-3 animate-spin" />
                    ) : null}
                    <span>{planTransition === "exiting" ? "正在退出计划模式" : "计划模式"}</span>
                    {planTransition === "idle" ? (
                      <button
                        aria-label={isGenerating ? "请先停止生成再退出计划模式" : "退出计划模式"}
                        className="chat-plan-mode-exit"
                        disabled={isGenerating}
                        onClick={() => void exitPlanMode()}
                        title={isGenerating ? "请先停止生成" : "退出计划模式"}
                        type="button"
                      >
                        <X className="size-3" />
                      </button>
                    ) : null}
                  </span>
                ) : null}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      aria-label="Sandbox permissions"
                      className="chat-sandbox-picker !h-7 !gap-1.5 !px-2 !text-[11px]"
                      disabled={isReadOnly}
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
                      disabled={isReadOnly || isModelsLoading || models.length === 0}
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
                  disabled={isReadOnly}
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
                  disabled={isReadOnly}
                  open={skillsOpen}
                  onOpenChange={setSkillsOpen}
                  onSelectionChange={updateSkillSelection}
                  selectedSkillIds={selectedSkillIds}
                  skills={allowedSkills}
                />
                {configuredModels?.length === 0 && (
                  <Link className="chat-settings-link" to="/settings/models">
                    配置模型
                  </Link>
                )}
              </div>
              <div className="chat-composer-actions">
                <ChatContextPopover
                  cacheReadTokens={currentContextUsage?.cacheReadTokens}
                  inputContext={selectedModel?.inputContext}
                  inputTokens={currentContextUsage?.inputTokens}
                  isEstimated={currentContextUsage?.source === "estimate"}
                  isGenerating={isGenerating}
                  modelName={selectedModel?.name}
                />
                {!isReadOnly ? (
                  <Button
                    aria-label="语音输入"
                    className="chat-tool-button !size-7 hidden sm:inline-flex"
                    size="icon"
                    type="button"
                    variant="ghost"
                  >
                    <Mic className="size-4" />
                  </Button>
                ) : null}
                <Button
                  aria-label={stopPending ? "正在停止" : isGenerating ? "停止生成" : "发送消息"}
                  className="chat-send-button !size-9 !rounded-[10px]"
                  disabled={
                    isReadOnly ||
                    stopPending ||
                    (((!input.trim() && !pendingAttachments.some((a) => a.status === "ready")) ||
                      (!selectedModel && !developerSettings.mockLongResponse) ||
                      pendingAttachments.some((a) => a.status === "uploading") ||
                      planTransition !== "idle") &&
                      !isGenerating)
                  }
                  onClick={isGenerating ? stopCurrentRunFromButton : submitMessage}
                  size="icon"
                  title={stopPending ? "正在停止" : isGenerating ? "停止生成" : "发送消息"}
                  type="button"
                >
                  {stopPending ? (
                    <LoaderCircle className="size-4 animate-spin" />
                  ) : isGenerating ? (
                    <Square className="size-4 fill-current" />
                  ) : (
                    <ArrowUp className="size-4" />
                  )}
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
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
        cwd={selectedCwd}
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
      <ChatToolLogDialog messages={messages} onOpenChange={setToolLogOpen} open={toolLogOpen} />
      <ChatTitleDialog
        canGenerate={canRegenerateConversationTitle}
        onGenerate={regenerateConversationTitle}
        onOpenChange={setTitleDialogOpen}
        onSave={saveConversationTitle}
        open={titleDialogOpen}
        title={sessionTitle}
      />
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
      <Outlet />
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
  approvalsEnabled = true,
  onApprovalResponse,
  onFork,
  forkDisabled = false,
  forkInFlight = false,
  onPlanUserInputResponse,
  planInputEnabled,
  planAttachment,
  cwd,
  workspaceId,
}: {
  message: UIMessage;
  isStreaming: boolean;
  generationStatus?: ChatGenerationStatusProps;
  showTokenUsage: boolean;
  approvalsEnabled?: boolean;
  onApprovalResponse: (id: string, approved: boolean) => void;
  onFork?: (messageId: string) => void;
  forkDisabled?: boolean;
  forkInFlight?: boolean;
  onPlanUserInputResponse: (toolCallId: string, output: PlanUserInputResponse) => Promise<void>;
  planInputEnabled: boolean;
  planAttachment?: ChatPlanAttachment;
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
  const durationLabel = formatMessageRunDuration(message);
  const statusLabel = [
    contextCompaction && completionLabel === "已完成"
      ? `${completionLabel} · 已生成检查点${contextCompaction.count > 1 ? ` ${contextCompaction.count} 次` : ""}`
      : completionLabel,
    durationLabel,
  ]
    .filter(Boolean)
    .join(" · ");
  const runErrorLabel = getMessageRunErrorLabel(message);
  const shouldCollapse = isUser && shouldCollapseChatUserMessage(text);
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
    <div
      className={`chat-message ${isUser ? "user-message" : "assistant-message"}`}
      data-message-id={message.id}
    >
      <div className="chat-message-body">
        {!isUser ? (
          <div className="chat-message-meta">
            {generationStatus ? (
              <ChatGenerationStatus {...generationStatus} />
            ) : (
              <span
                title={
                  contextCompaction ? formatContextCompactionTitle(contextCompaction) : undefined
                }
              >
                {statusLabel}
              </span>
            )}
          </div>
        ) : null}
        <div className="chat-message-parts">
          {messageBlocks.map((block, blockIndex) => {
            if (block.kind === "tasks") {
              return <ChatTaskList key={block.key} parts={block.parts} />;
            }
            if (block.kind === "tools") {
              const questionnaires = block.parts.flatMap((part) => {
                if (getToolName(part) !== PLAN_USER_INPUT_TOOL_NAME || !("input" in part))
                  return [];
                const request = parsePlanUserInputRequest(part.input);
                if (!request) return [];
                const response =
                  part.state === "output-available" && "output" in part
                    ? parsePlanUserInputResponse(part.output)
                    : undefined;
                if (part.state === "output-available" && !response) return [];
                if (
                  !["input-streaming", "input-available", "output-available"].includes(part.state)
                )
                  return [];
                return [{ part, request, response }];
              });
              const questionnaireCallIds = new Set(
                questionnaires.map(({ part }) => part.toolCallId),
              );
              const visibleParts = block.parts.filter(
                (part) =>
                  getToolName(part) !== TODO_TOOL_NAME &&
                  getToolName(part) !== CREATE_TASK_TOOL_NAME &&
                  !questionnaireCallIds.has(part.toolCallId),
              );
              const containsPlanAttachment = Boolean(
                planAttachment &&
                  block.parts.some((part) => part.toolCallId === planAttachment.toolCallId),
              );
              if (
                visibleParts.length === 0 &&
                questionnaires.length === 0 &&
                !containsPlanAttachment
              )
                return null;
              return (
                <div className="chat-message-tool-block" key={block.key}>
                  {visibleParts.length > 0 ? (
                    <div className="chat-tool-calls">
                      <ChatToolCallGroup
                        active={
                          isStreaming &&
                          blockIndex === messageBlocks.length - 1 &&
                          questionnaires.length === 0
                        }
                        calls={visibleParts.map(toChatToolCall)}
                        cwd={cwd}
                        workspaceId={workspaceId}
                      />
                    </div>
                  ) : null}
                  {questionnaires.map(({ part, request, response }) => (
                    <ChatPlanQuestionnaire
                      disabled={part.state !== "input-available" || !planInputEnabled}
                      disabledReason={
                        !planInputEnabled
                          ? "计划模式已退出，回答已停用"
                          : part.state !== "input-available"
                            ? "问题正在准备中"
                            : undefined
                      }
                      key={part.toolCallId}
                      onSubmit={(output) => onPlanUserInputResponse(part.toolCallId, output)}
                      request={request}
                      response={response ?? undefined}
                    />
                  ))}
                  {containsPlanAttachment && planAttachment ? (
                    <div className="chat-plan-indicator">
                      <Button
                        aria-label={`打开 ${planAttachment.fileName}`}
                        className="chat-plan-indicator-button"
                        onClick={planAttachment.onOpen}
                        size="sm"
                        type="button"
                        variant="outline"
                      >
                        <FileText className="size-3.5" />
                        <span>{planAttachment.fileName}</span>
                        {planAttachment.isGenerating ? (
                          <LoaderCircle aria-hidden="true" className="size-3 animate-spin" />
                        ) : null}
                      </Button>
                    </div>
                  ) : null}
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
            const collapsed = collapseBlock && !expanded;
            return (
              <div
                className={`chat-message-text-wrap ${collapsed ? "is-collapsed" : ""}`}
                key={block.key}
              >
                <div className="chat-message-text">
                  {collapsed ? (
                    <div className="chat-user-message-preview">
                      {previewCollapsedChatUserMessage(block.text)}
                    </div>
                  ) : (
                    <ChatMarkdown isAnimating={!isUser && isStreaming}>{block.text}</ChatMarkdown>
                  )}
                  {collapsed ? <div className="chat-message-fade" /> : null}
                </div>
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
        {approvalsEnabled && pendingApprovalParts.length > 0 ? (
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
            {!isUser && onFork ? (
              <Button
                aria-label={forkInFlight ? "正在创建对话分支" : "从此回复 Fork 对话"}
                disabled={forkDisabled}
                onClick={() => onFork(message.id)}
                size="icon"
                title="从此回复 Fork 对话"
                type="button"
                variant="ghost"
              >
                {forkInFlight ? (
                  <LoaderCircle className="size-3.5 animate-spin" />
                ) : (
                  <GitBranch className="size-3.5" />
                )}
              </Button>
            ) : null}
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
  getTitle: () => string,
  getMockLongResponse: () => boolean,
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
      const mockLongResponse = getMockLongResponse();
      if (!mockLongResponse && (!model || model.baseUrl.startsWith("local://"))) {
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
      if (!mockLongResponse && model) {
        const serverConfig = await loadChatServerConfig();
        const models = [
          ...serverConfig.models.filter(
            (item) =>
              !item || typeof item !== "object" || (item as { id?: unknown }).id !== model.id,
          ),
          { ...model, apiKey: undefined },
        ];
        await saveChatServerConfig({
          models,
          chatTools: getToolsSettings(),
          apiKeys: { ...serverConfig.apiKeys, [model.id]: model.apiKey },
        });
      }
      return {
        body: {
          messages,
          modelId: model?.id,
          mockLongResponse,
          ...promptInput,
          sandboxMode,
          planMode,
          planId,
          mcpServerIds: getMcpServerIds(),
          skillIds: getSkills().map((skill) => skill.id),
          toolNames: activeTools.toolNames,
          title: getTitle(),
        },
        api: `${chatServerUrl()}/v1/sessions/${sessionId}/runs`,
        headers: chatServerHeaders(),
      };
    },
  });
}

export { ChatPage };
