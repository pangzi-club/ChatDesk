import { useChat } from "@ai-sdk/react";
import { code } from "@streamdown/code";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  type ChatTransport,
  DefaultChatTransport,
  getToolName,
  isToolUIPart,
  lastAssistantMessageIsCompleteWithApprovalResponses,
  type UIMessage,
} from "ai";
import { Streamdown } from "streamdown";
import "streamdown/styles.css";
import type { RunStartInput, SystemPromptSnapshot } from "@chatdesk/shared";
import {
  ArrowUp,
  Bot,
  Brain,
  Bug,
  Check,
  ChevronDown,
  ChevronUp,
  CircleStop,
  Copy,
  FilePlus2,
  Folder,
  Gauge,
  GitBranch,
  GitCommitHorizontal,
  Hammer,
  History,
  Laptop,
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
  User,
  Wrench,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ChatContextDialog } from "@/components/chat-context-dialog";
import { ChatMemoryDialog } from "@/components/chat-memory-dialog";
import { ChatSettingsDialog } from "@/components/chat-settings-dialog";
import { ChatSkillsPicker } from "@/components/chat-skills-picker";
import { type ChatToolCallCardProps, ChatToolCallGroup } from "@/components/chat-tool-call-card";
import { ChatToolLogDialog } from "@/components/chat-tool-log-dialog";
import { ChatToolsPicker } from "@/components/chat-tools-picker";
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
import { materializeGeneratedImages } from "@/lib/chat-image-generation";
import {
  type ChatMemoryStore,
  DEFAULT_CHAT_MEMORY,
  formatMemoryForInject,
  loadChatMemory,
  saveChatMemory,
} from "@/lib/chat-memory";
import { isWorkspaceMemoryExcludedTool, scheduleMemoryUpdateFromTurn } from "@/lib/chat-memory-ops";
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
  chatServerFetch,
  chatServerHeaders,
  chatServerUrl,
  ensureChatServerSession,
  initializeChatServer,
  loadChatServerConfig,
  loadChatServerPort,
  loadChatServerSystemPromptPreview,
  loadServerWorkspaceGit,
  saveChatServerConfig,
  stopChatServerRun,
  subscribeChatServerEvents,
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
import { formatTokenUsage, getMessageUsage } from "@/lib/chat-usage";
import { openFileViewer } from "@/lib/file-viewer-events";
import { loadMcpServers, saveMcpServers } from "@/lib/mcp";
import { formatModelLabel, loadModels, type ModelConfig } from "@/lib/models";
import {
  formatSkillsSystemHint,
  loadAvailableSkills,
  loadChatSkillSelection,
  loadInstalledSkillIds,
  type SkillDefinition,
  saveChatSkillSelection,
} from "@/lib/skills";
import { loadWorkspaceProjects } from "@/lib/workspaces";

const EMPTY_STRING_ARRAY: string[] = [];
const DEFAULT_WORKSPACE_LABEL = "Default Workspace";
const CHAT_MESSAGE_COLLAPSE_CHAR_LIMIT = 1200;
const CHAT_MESSAGE_COLLAPSE_LINE_LIMIT = 18;

type ChatToolPart = Extract<UIMessage["parts"][number], { toolCallId: string }>;
type ChatMessageBlock =
  | { kind: "text"; key: string; text: string }
  | { kind: "tools"; key: string; parts: ChatToolPart[] };

const EMPTY_CHAT_ACTIONS = [
  {
    label: "探索并理解代码",
    prompt: "请帮我探索并理解这个代码库。",
    icon: SearchCode,
    accent: "blue",
  },
  {
    label: "构建新功能、应用或工具",
    prompt: "请帮我构建一个新功能、应用或工具。",
    icon: Hammer,
    accent: "violet",
  },
  {
    label: "审查代码并提出修改建议",
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

type LiveDraft = {
  runId: string;
  text: string;
};

function mergeLiveDraft(messages: UIMessage[], draft: LiveDraft | undefined) {
  if (!draft?.runId || !draft.text) return messages;
  const assistant: UIMessage = {
    id: draft.runId,
    role: "assistant",
    parts: [{ type: "text", text: draft.text }],
  };
  const existingIndex = messages.findIndex((message) => message.id === draft.runId);
  if (existingIndex < 0) return [...messages, assistant];
  return messages.map((message, index) =>
    index === existingIndex
      ? {
          ...message,
          parts: [...message.parts.filter((part) => part.type !== "text"), ...assistant.parts],
        }
      : message,
  );
}

function scrollChatToBottom(element: HTMLDivElement, behavior: ScrollBehavior) {
  if (behavior === "auto") {
    const previousBehavior = element.style.scrollBehavior;
    element.style.scrollBehavior = "auto";
    element.scrollTop = element.scrollHeight;
    element.style.scrollBehavior = previousBehavior;
    return;
  }
  element.scrollTo({ top: element.scrollHeight, behavior });
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
  const [selectedModelId, setSelectedModelId] = useState("");
  const [input, setInput] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);
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
  const suppressSaveRef = useRef(false);
  const pendingSessionRef = useRef<ChatSession | null>(null);
  const systemPromptRef = useRef<SystemPromptSnapshot | undefined>(undefined);
  const workspaceSelectionInitializedRef = useRef(false);
  const sandboxModeInitializedRef = useRef(false);
  const savedFingerprintRef = useRef("");
  const extractedFingerprintRef = useRef("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const skipSmoothScrollRef = useRef(false);
  const isComposingRef = useRef(false);
  const [sessionToDelete, setSessionToDelete] = useState<ChatIndexItem | null>(null);
  const [conversationIdCopied, setConversationIdCopied] = useState(false);
  const [conversationMenuOpen, setConversationMenuOpen] = useState(false);
  const conversationMenuCloseTimerRef = useRef<number | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [contextOpen, setContextOpen] = useState(false);
  const [memoryOpen, setMemoryOpen] = useState(false);
  const [toolLogOpen, setToolLogOpen] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [skillsOpen, setSkillsOpen] = useState(false);
  const [selectedSkillIds, setSelectedSkillIds] = useState<string[]>([]);
  const [sandboxMode, setSandboxMode] = useState<ChatSandboxMode>(DEFAULT_CHAT_SANDBOX_MODE);
  const [chatDisplay, setChatDisplay] = useState<ChatDisplaySettings>(DEFAULT_CHAT_DISPLAY);
  const generationStartedAtRef = useRef<number | null>(null);
  const [generationElapsedSeconds, setGenerationElapsedSeconds] = useState(0);
  const workspaceRef = useRef("");
  const sandboxModeRef = useRef<ChatSandboxMode>(DEFAULT_CHAT_SANDBOX_MODE);
  const selectedCwd =
    workspaceProjects.find((project) => project.id === workspaceKey)?.path ?? sessionCwd;
  const workspaceLabel = selectedCwd ? pathBasename(selectedCwd) : DEFAULT_WORKSPACE_LABEL;
  workspaceRef.current = selectedCwd;
  sandboxModeRef.current = sandboxMode;
  const selectedModel = models.find((model) => model.id === selectedModelId) ?? models[0];
  const selectedModelRef = useRef(selectedModel);
  selectedModelRef.current = selectedModel;

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
        getPromptInput,
      ),
    [getPromptInput, selectedMcpIds, selectedModel, selectedSkillIds, sessionId],
  );
  const { addToolApprovalResponse, messages, setMessages, sendMessage, stop, status, error } =
    useChat({
      id: sessionId,
      transport,
      sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithApprovalResponses,
      onError: (chatError) => {
        console.error("Chat request failed", chatError);
      },
    });
  const activeSessionRef = useRef(sessionId);
  activeSessionRef.current = sessionId;
  const chatStatusRef = useRef(status);
  chatStatusRef.current = status;
  const attachedStreamSessionRef = useRef<string | null>(null);
  const liveDraftsRef = useRef(new Map<string, LiveDraft>());

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
  }, [sessionId]);

  useEffect(() => {
    // Stop consuming the previous browser stream when switching chats. The server run remains
    // active; its SSE deltas are retained so the response can be rendered when we return.
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
        onDelta: ({ sessionId: eventSessionId, runId, delta }) => {
          const current = liveDraftsRef.current.get(eventSessionId) ?? {
            runId: runId ?? `run-${eventSessionId}`,
            text: "",
          };
          current.text += delta;
          if (runId) current.runId = runId;
          liveDraftsRef.current.set(eventSessionId, current);

          if (
            activeSessionRef.current === eventSessionId &&
            attachedStreamSessionRef.current !== eventSessionId &&
            chatStatusRef.current !== "submitted" &&
            chatStatusRef.current !== "streaming"
          ) {
            setMessages((messages) => mergeLiveDraft(messages, current));
          }
        },
        onMessageUpdated: ({ sessionId: eventSessionId, message }) => {
          const draft = liveDraftsRef.current.get(eventSessionId);
          liveDraftsRef.current.delete(eventSessionId);
          if (
            activeSessionRef.current === eventSessionId &&
            attachedStreamSessionRef.current !== eventSessionId &&
            message
          ) {
            setMessages((messages) => {
              const withoutDraft = messages.filter(
                (item) => item.id !== draft?.runId && item.id !== message.id,
              );
              return [...withoutDraft, message];
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

  const isGenerating = status === "submitted" || status === "streaming";
  const workspaceGitQuery = useQuery({
    queryKey: ["chat-workspace-git", workspaceKey],
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

  const generationPhase = status === "submitted" ? "正在等待模型响应" : "正在生成回答";
  const generationElapsedLabel = formatGenerationElapsed(generationElapsedSeconds);
  const generationDetail = generationElapsedSeconds >= 10 ? "响应较慢，仍在等待中" : "";
  const lastMessage = messages[messages.length - 1];
  const latestContextUsage = useMemo(() => {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const usage = getMessageUsage(messages[index]);
      if (usage?.inputTokens !== undefined) return usage;
    }
    return undefined;
  }, [messages]);
  const hasAssistantMessage =
    lastMessage?.role === "assistant" &&
    (messageText(lastMessage).trim().length > 0 || messageHasToolParts(lastMessage));
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
    if (lastSessionMessage?.role === "assistant") {
      const draftText = messageText(lastSessionMessage);
      if (lastSessionMessage.id && draftText) {
        liveDraftsRef.current.set(session.id, {
          runId: lastSessionMessage.id,
          text: draftText,
        });
      }
    }
    skipSmoothScrollRef.current = true;
    setMessages(mergeLiveDraft(session.messages, liveDraftsRef.current.get(session.id)));
    requestAnimationFrame(() => {
      if (activeSessionRef.current !== session.id) {
        skipSmoothScrollRef.current = false;
        return;
      }
      const scrollElement = scrollRef.current;
      if (scrollElement) scrollChatToBottom(scrollElement, "auto");
    });
    if (session.modelId) setSelectedModelId(session.modelId);
    const sessionSkillIds = session.skillIds ?? savedChatSkillIds;
    setSelectedSkillIds(sessionSkillIds.filter((id) => installedSkillIds.includes(id)));
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
    if (status !== "ready" || messages.length === 0) return;
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
  }, [messages, queryClient, selectedCwd, selectedModel, sessionId, status, setMessages]);

  // Scroll when a message arrives or the local response indicator changes.
  // biome-ignore lint/correctness/useExhaustiveDependencies: these values intentionally trigger the scroll effect.
  useEffect(() => {
    const scrollElement = scrollRef.current;
    if (!scrollElement) return;
    if (skipSmoothScrollRef.current) {
      skipSmoothScrollRef.current = false;
      scrollChatToBottom(scrollElement, "auto");
      return;
    }
    scrollChatToBottom(scrollElement, "smooth");
  }, [messages.length, isGenerating]);

  function submitMessage() {
    const text = input.trim();
    if (!text || isGenerating) return;
    setInput("");
    liveDraftsRef.current.delete(sessionId);
    attachedStreamSessionRef.current = sessionId;
    void sendMessage({ text });
  }

  function stopCurrentRun() {
    stop();
    void stopChatServerRun(sessionId).catch((error) => {
      console.error("Failed to stop Chat Server run", error);
    });
  }

  function respondToApproval(id: string, approved: boolean) {
    void addToolApprovalResponse({
      id,
      approved,
      reason: approved ? undefined : "用户拒绝了此次操作",
    });
  }

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

  function handleKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
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
    <div
      className="chat-page"
      data-chat-empty={messages.length === 0 ? "true" : "false"}
      data-chat-font-size={chatDisplay.fontSize}
      data-chat-spacing={chatDisplay.spacing}
    >
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
                      <Check className="size-4 text-emerald-500" />
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
            aria-label="查看上下文用量"
            className="chat-icon-button"
            onClick={() => setContextOpen(true)}
            size="icon"
            title="查看当前上下文用量"
            type="button"
            variant="ghost"
          >
            <Gauge className="size-4" />
          </Button>
          <Button
            aria-label="Tool 记录"
            className="chat-icon-button"
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
            className="chat-icon-button"
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
              isStreaming={status === "streaming" && message.id === lastMessage?.id}
              showTokenUsage={chatDisplay.showTokenUsage}
            />
          ))}
          {isGenerating && !hasAssistantMessage && (
            <div className="chat-message assistant-message">
              <div className="chat-avatar assistant-avatar">
                <Bot className="size-4" />
              </div>
              <div className="chat-message-body">
                <div className="chat-thinking">
                  <span />
                  <span />
                  <span />
                </div>
              </div>
            </div>
          )}
          {isGenerating ? (
            <div
              aria-live="polite"
              className="chat-generation-status chat-generation-status-in-message"
              role="status"
            >
              <span aria-hidden="true" className="chat-generation-status-dot" />
              <span className="chat-generation-status-label">{generationPhase}</span>
              <span className="chat-generation-status-elapsed">
                已等待 {generationElapsedLabel}
              </span>
              <span className="chat-generation-status-detail">{generationDetail}</span>
            </div>
          ) : null}
        </div>
      </div>

      <div className="chat-composer-wrap">
        {workspaceGitQuery.data?.summary &&
        workspaceGitQuery.data.isRepository &&
        workspaceGitQuery.data.summary.filesChanged > 0 ? (
          <button
            className="chat-git-summary-float"
            onClick={async () => {
              const result = await workspaceGitQuery.refetch();
              const firstFile = result.data?.summary?.files[0];
              openFileViewer({
                mode: "diff",
                path: firstFile?.path ?? "",
                workspaceId: workspaceKey,
                cwd: selectedCwd,
              });
            }}
            type="button"
          >
            <GitCommitHorizontal className="size-3.5" />
            <span className="chat-git-summary-branch">
              {workspaceGitQuery.data.summary.branch ?? "HEAD"}
            </span>
            <span className="chat-git-summary-add">
              +{workspaceGitQuery.data.summary.insertions}
            </span>
            <span className="chat-git-summary-delete">
              -{workspaceGitQuery.data.summary.deletions}
            </span>
            <span className="chat-git-summary-files">
              · {workspaceGitQuery.data.summary.filesChanged} 个文件已修改
            </span>
          </button>
        ) : null}
        {error && <p className="chat-error">{error.message}</p>}
        <div className="chat-workspace-bar">
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
          <textarea
            aria-label="输入消息"
            autoCapitalize="none"
            autoCorrect="off"
            ref={inputRef}
            spellCheck={false}
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onCompositionStart={() => {
              isComposingRef.current = true;
            }}
            onCompositionEnd={() => {
              isComposingRef.current = false;
            }}
            onKeyDown={handleKeyDown}
            placeholder="问问你的工作空间..."
            rows={2}
          />
          <div className="chat-composer-footer">
            <div className="chat-composer-tools">
              <Button
                aria-label="添加附件"
                className="chat-tool-button !size-7"
                size="icon"
                type="button"
                variant="ghost"
              >
                <Paperclip className="size-4" />
              </Button>
              <Button
                aria-label="添加文件"
                className="chat-tool-button !size-7 hidden sm:inline-flex"
                size="icon"
                type="button"
                variant="ghost"
              >
                <FilePlus2 className="size-4" />
              </Button>
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
                      models.map((model) => (
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
                disabled={(!input.trim() || !selectedModel) && !isGenerating}
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
      <ChatContextDialog
        isGenerating={isGenerating}
        latestUsage={latestContextUsage}
        messageCount={messages.length}
        model={selectedModel}
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

function getChatMessageBlocks(message: UIMessage): ChatMessageBlock[] {
  const blocks: ChatMessageBlock[] = [];
  let toolParts: ChatToolPart[] = [];

  function flushToolParts() {
    if (toolParts.length === 0) return;
    blocks.push({ kind: "tools", key: `tools-${blocks.length}`, parts: toolParts });
    toolParts = [];
  }

  message.parts.forEach((part, index) => {
    if (isToolUIPart(part)) {
      toolParts.push(part);
      return;
    }
    if (part.type === "text" && part.text.trim()) {
      flushToolParts();
      const previous = blocks[blocks.length - 1];
      if (previous?.kind === "text") {
        previous.text += part.text;
      } else {
        blocks.push({ kind: "text", key: `text-${index}`, text: part.text });
      }
    }
  });
  flushToolParts();
  return blocks;
}

function MessageBubble({
  message,
  isStreaming,
  showTokenUsage,
  onApprovalResponse,
}: {
  message: UIMessage;
  isStreaming: boolean;
  showTokenUsage: boolean;
  onApprovalResponse: (id: string, approved: boolean) => void;
}) {
  const text = messageText(message);
  const isUser = message.role === "user";
  const [copied, setCopied] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const toolParts = message.parts.filter(isToolUIPart);
  const messageBlocks = getChatMessageBlocks(message);
  const pendingApprovalParts = toolParts.filter((part) => part.state === "approval-requested");
  if (!isUser && !text.trim() && toolParts.length === 0) return null;
  const usage = showTokenUsage && !isUser ? getMessageUsage(message) : undefined;
  const usageLabel = usage ? formatTokenUsage(usage) : null;
  const toolLimitReached = Boolean(
    !isUser && (message.metadata as { toolLimitReached?: boolean } | undefined)?.toolLimitReached,
  );
  const shouldCollapse =
    isUser &&
    (text.length > CHAT_MESSAGE_COLLAPSE_CHAR_LIMIT ||
      text.split("\n").length > CHAT_MESSAGE_COLLAPSE_LINE_LIMIT);

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
          <span>{isUser ? "刚刚" : isStreaming ? "生成中" : "已完成"}</span>
        </div>
        <div className="chat-message-parts">
          {messageBlocks.map((block) => {
            if (block.kind === "tools") {
              return (
                <div className="chat-tool-calls" key={block.key}>
                  <ChatToolCallGroup calls={block.parts.map(toChatToolCall)} />
                </div>
              );
            }
            const collapseBlock = isUser && shouldCollapse;
            return (
              <div
                className={`chat-message-text-wrap ${collapseBlock && !expanded ? "is-collapsed" : ""}`}
                key={block.key}
              >
                <div className="chat-message-text">
                  <Streamdown isAnimating={!isUser && isStreaming} plugins={{ code }}>
                    {block.text}
                  </Streamdown>
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
          <p className="mt-2 text-amber-600 text-xs dark:text-amber-300">
            已达到执行轮数上限（30 轮），如需继续请发送一条新消息。
          </p>
        ) : null}
        {(!isUser || text.trim()) && (
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
            {!isUser && (
              <>
                <Button aria-label="重新生成" size="icon" type="button" variant="ghost">
                  <RefreshCw className="size-3.5" />
                </Button>
                {usageLabel && <span className="chat-message-usage">{usageLabel}</span>}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

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
