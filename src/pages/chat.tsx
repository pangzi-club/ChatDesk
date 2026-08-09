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
import {
  ArrowUp,
  Bot,
  Brain,
  Check,
  ChevronDown,
  CircleStop,
  Copy,
  FilePlus2,
  FolderGit2,
  History,
  Mic,
  MoreHorizontal,
  Paperclip,
  Plus,
  RefreshCw,
  Settings,
  Settings2,
  ShieldCheck,
  Sparkles,
  Trash2,
  User,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";

import { ChatMemoryDialog } from "@/components/chat-memory-dialog";
import { ChatSettingsDialog } from "@/components/chat-settings-dialog";
import { ChatSkillsPicker } from "@/components/chat-skills-picker";
import { ChatToolCallGroup } from "@/components/chat-tool-call-card";
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
  CHAT_SANDBOX_MODE_LABELS,
  type ChatSandboxMode,
  DEFAULT_CHAT_SANDBOX_MODE,
  loadChatSandboxMode,
  normalizeChatSandboxMode,
  saveChatSandboxMode,
} from "@/lib/chat-sandbox";
import {
  chatServerHeaders,
  chatServerUrl,
  ensureChatServerSession,
  initializeChatServer,
  loadChatServerConfig,
  loadChatServerPort,
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
import { resolveActiveTools, resolveAvailablePacks } from "@/lib/chat-tool-defs";
import {
  type ChatToolPackId,
  type ChatToolsSettings,
  DEFAULT_CHAT_TOOLS,
  getPackMeta,
  loadChatToolsSettings,
  saveChatToolsSettings,
} from "@/lib/chat-tools";
import { formatTokenUsage, getMessageUsage } from "@/lib/chat-usage";
import { loadMcpServers, saveMcpServers } from "@/lib/mcp";
import { loadModels, type ModelConfig } from "@/lib/models";
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
  return messages.map((message, index) => (index === existingIndex ? assistant : message));
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
  const { data: workspaceProjects = [], isLoading: isWorkspacesLoading } = useQuery({
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
  const [sessionId, setSessionId] = useState(createSessionId);
  const [sessionTitle, setSessionTitle] = useState("新对话");
  const [workspaceKey, setWorkspaceKey] = useState("");
  const [sessionCwd, setSessionCwd] = useState("");
  const skillsSelectionInitializedRef = useRef(false);
  const sessionCreatedAtRef = useRef(new Date().toISOString());
  const sessionAttachmentsRef = useRef<ChatAttachment[]>([]);
  const suppressSaveRef = useRef(false);
  const pendingSessionRef = useRef<ChatSession | null>(null);
  const workspaceSelectionInitializedRef = useRef(false);
  const sandboxModeInitializedRef = useRef(false);
  const savedFingerprintRef = useRef("");
  const extractedFingerprintRef = useRef("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const isComposingRef = useRef(false);
  const [sessionToDelete, setSessionToDelete] = useState<ChatIndexItem | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [memoryOpen, setMemoryOpen] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [skillsOpen, setSkillsOpen] = useState(false);
  const [selectedSkillIds, setSelectedSkillIds] = useState<string[]>([]);
  const [sandboxMode, setSandboxMode] = useState<ChatSandboxMode>(DEFAULT_CHAT_SANDBOX_MODE);
  const [chatDisplay, setChatDisplay] = useState<ChatDisplaySettings>(DEFAULT_CHAT_DISPLAY);
  const [availablePacks, setAvailablePacks] = useState<ChatToolPackId[]>([]);
  const generationStartedAtRef = useRef<number | null>(null);
  const [generationElapsedSeconds, setGenerationElapsedSeconds] = useState(0);
  const workspaceRef = useRef("");
  const sandboxModeRef = useRef<ChatSandboxMode>(DEFAULT_CHAT_SANDBOX_MODE);
  const selectedCwd =
    workspaceProjects.find((project) => project.id === workspaceKey)?.path ?? sessionCwd;
  workspaceRef.current = selectedCwd;
  sandboxModeRef.current = sandboxMode;
  const selectedModel = models.find((model) => model.id === selectedModelId) ?? models[0];
  const selectedModelRef = useRef(selectedModel);
  selectedModelRef.current = selectedModel;
  const selectedMcpIds = useMemo(
    () => mcpServers.filter((server) => server.enabledByDefault).map((server) => server.id),
    [mcpServers],
  );
  const transport = useMemo(
    () =>
      createModelTransport(
        sessionId,
        selectedModel,
        () => memoryRef.current,
        () => toolsRef.current,
        () => workspaceRef.current,
        () => workspaceKey,
        () => sandboxModeRef.current,
        () => skillsRef.current.filter((skill) => selectedSkillIds.includes(skill.id)),
      ),
    [selectedModel, selectedSkillIds, sessionId, workspaceKey],
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
      setSessionId(nextSessionId);
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.set("sessionId", nextSessionId);
          next.delete("workspaceId");
          next.delete("workspaceCwd");
          return next;
        },
        { replace: true },
      );
      workspaceSelectionInitializedRef.current = true;
      setWorkspaceKey(nextWorkspaceId);
      setSessionCwd(nextWorkspaceCwd);
      const installed = new Set(installedSkillIds);
      setSelectedSkillIds(savedChatSkillIds.filter((id) => installed.has(id)));
      sessionCreatedAtRef.current = new Date().toISOString();
      sessionAttachmentsRef.current = [];
      pendingSessionRef.current = null;
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
  const hasAssistantMessage =
    lastMessage?.role === "assistant" &&
    (messageText(lastMessage).trim().length > 0 || messageHasToolParts(lastMessage));
  useEffect(() => {
    let active = true;
    void resolveAvailablePacks(
      chatTools,
      selectedModel
        ? { supportsTools: selectedModel.supportsTools, responsive: selectedModel.responsive }
        : undefined,
      () => selectedCwd,
    ).then((packs) => {
      if (active) setAvailablePacks(packs);
    });
    return () => {
      active = false;
    };
  }, [chatTools, selectedCwd, selectedModel]);

  useEffect(() => {
    if (models.length > 0 && !models.some((model) => model.id === selectedModelId)) {
      setSelectedModelId(models.find((model) => model.isDefault)?.id ?? models[0].id);
    }
  }, [models, selectedModelId]);

  useEffect(() => {
    if (isChatHistoryLoading) return;
    let active = true;

    if (requestedSessionId) {
      if (requestedSessionId === sessionId) {
        return;
      }
      void loadChatSession(requestedSessionId).then((session) => {
        if (!active) return;
        if (!session) {
          startNewSession();
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
  }, [isChatHistoryLoading, requestedSessionId, sessionId, startNewSession]);

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
    setMessages(mergeLiveDraft(session.messages, liveDraftsRef.current.get(session.id)));
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
        const materialized = await materializeGeneratedImages(
          sessionId,
          messages,
          sessionAttachmentsRef.current,
        );
        sessionAttachmentsRef.current = materialized.attachments;
        await saveChatSession({
          schemaVersion: 2,
          id: sessionId,
          title,
          createdAt: sessionCreatedAtRef.current,
          updatedAt: now,
          modelId: selectedModel?.id,
          workspaceId: workspaceKey || undefined,
          cwd: selectedCwd || undefined,
          sandboxMode,
          mcpServerIds: selectedMcpIds,
          skillIds: selectedSkillIds,
          messages: materialized.messages,
          attachments: materialized.attachments,
        });
        if (materialized.changed) {
          suppressSaveRef.current = true;
          setMessages(materialized.messages);
        }
        void queryClient.invalidateQueries({ queryKey: ["chat-index"] });
        if (extractedFingerprintRef.current === fingerprint) return;
        extractedFingerprintRef.current = fingerprint;
        const lastUser = [...messages].reverse().find((message) => message.role === "user");
        scheduleMemoryUpdateFromTurn({
          model: selectedModel,
          sessionId,
          userText: lastUser ? messageText(lastUser) : "",
          assistantText: messageText(lastMessage),
          workspacePath: selectedCwd,
          toolNames: lastMessage.parts
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
    selectedMcpIds,
    sandboxMode,
    selectedSkillIds,
    sessionId,
    status,
    setMessages,
    workspaceKey,
  ]);

  // Scroll when a message arrives or the local response indicator changes.
  // biome-ignore lint/correctness/useExhaustiveDependencies: these values intentionally trigger the scroll effect.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
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
      data-chat-font-size={chatDisplay.fontSize}
      data-chat-spacing={chatDisplay.spacing}
    >
      <header className="chat-header">
        <div className="chat-brand">
          <div className="chat-brand-mark">
            <Sparkles className="size-4" />
          </div>
          <div>
            <p className="chat-kicker">Workspace assistant</p>
            <h1>{sessionTitle}</h1>
          </div>
        </div>
        <div className="chat-header-actions">
          <Button
            aria-label="新建对话"
            className="chat-icon-button"
            size="icon"
            variant="ghost"
            type="button"
            onClick={() => startNewSession()}
          >
            <Plus className="size-4" />
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
                <MoreHorizontal className="size-4" />
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
            aria-label="长期记忆"
            className="chat-icon-button"
            size="icon"
            variant="ghost"
            type="button"
            onClick={() => setMemoryOpen(true)}
          >
            <Brain className="size-4" />
          </Button>
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
          <div className="chat-context-row">
            <span className="chat-status-dot" />
            <span>{selectedModel?.provider ?? "未配置模型"}</span>
            <span className="chat-context-rule" />
            <span className="truncate" title={selectedCwd || undefined}>
              {selectedCwd ? pathBasename(selectedCwd) : "未选择 Workspace"}
            </span>
            <span className="chat-access-badge">{CHAT_SANDBOX_MODE_LABELS[sandboxMode]}</span>
          </div>
          {messages.length === 0 ? (
            <div className="chat-tools-hint">
              {!isModelsLoading && models.length === 0 ? (
                <p>
                  尚未配置模型。请先到 <Link to="/settings/models">模型设置</Link> 添加 API。
                </p>
              ) : selectedModel && !selectedModel.supportsTools ? (
                <p>
                  当前模型未开启「支持 Tools」。可在 <Link to="/settings/models">模型设置</Link>{" "}
                  中开启，或更换模型。
                </p>
              ) : availablePacks.length > 0 ? (
                <p>
                  已启用：
                  {availablePacks.map((id) => getPackMeta(id).label).join(" · ")}
                  。用自然语言提问即可自动调用工具。
                </p>
              ) : (
                <p>
                  尚未启用可用 Tools。
                  <button type="button" onClick={() => setToolsOpen(true)}>
                    选择 Tools
                  </button>
                  {" · "}
                  <Link to="/settings/tools">设置页</Link>
                </p>
              )}
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
        {error && <p className="chat-error">{error.message}</p>}
        <div className="chat-composer">
          <textarea
            aria-label="输入消息"
            autoCapitalize="none"
            autoCorrect="off"
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
                className="chat-tool-button"
                size="icon"
                type="button"
                variant="ghost"
              >
                <Paperclip className="size-4" />
              </Button>
              <Button
                aria-label="添加文件"
                className="chat-tool-button hidden sm:inline-flex"
                size="icon"
                type="button"
                variant="ghost"
              >
                <FilePlus2 className="size-4" />
              </Button>
              <div className="chat-workspace-picker" title={selectedCwd || "未选择 Workspace"}>
                <FolderGit2 className="size-3.5" />
                <select
                  aria-label="选择 Workspace"
                  disabled={isWorkspacesLoading || Boolean(selectedCwd) || messages.length > 0}
                  value={workspaceKey}
                  onChange={(event) => {
                    const nextKey = event.target.value;
                    const project = workspaceProjects.find((item) => item.id === nextKey);
                    setWorkspaceKey(nextKey);
                    setSessionCwd(project?.path ?? "");
                  }}
                >
                  <option value="">无 Workspace</option>
                  {workspaceKey &&
                  !workspaceProjects.some((project) => project.id === workspaceKey) ? (
                    <option value={workspaceKey}>{pathBasename(sessionCwd)}（已移除）</option>
                  ) : null}
                  {workspaceProjects.map((project) => (
                    <option key={project.id} value={project.id}>
                      {pathBasename(project.path)}
                    </option>
                  ))}
                </select>
                <ChevronDown className="size-3.5" />
              </div>
              <div className="chat-sandbox-picker" title="Sandbox permissions">
                <ShieldCheck className="size-3.5" />
                <select
                  aria-label="Sandbox permissions"
                  value={sandboxMode}
                  onChange={(event) =>
                    updateSandboxMode(normalizeChatSandboxMode(event.target.value))
                  }
                >
                  {Object.entries(CHAT_SANDBOX_MODE_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
                <ChevronDown className="size-3.5" />
              </div>
              <div className="chat-model-picker">
                <Settings2 className="size-3.5" />
                <select
                  aria-label="选择模型"
                  disabled={isModelsLoading || models.length === 0}
                  value={selectedModel?.id ?? ""}
                  onChange={(event) => setSelectedModelId(event.target.value)}
                >
                  {models.length === 0 ? <option value="">未配置模型</option> : null}
                  {models.map((model) => (
                    <option key={model.id} value={model.id}>
                      {formatModelLabel(model)}
                    </option>
                  ))}
                </select>
                <ChevronDown className="size-3.5" />
              </div>
              <ChatToolsPicker
                open={toolsOpen}
                settings={chatTools}
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
                className="chat-tool-button hidden sm:inline-flex"
                size="icon"
                type="button"
                variant="ghost"
              >
                <Mic className="size-4" />
              </Button>
              <Button
                aria-label={isGenerating ? "停止生成" : "发送消息"}
                className="chat-send-button"
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
      <ChatMemoryDialog
        onOpenChange={setMemoryOpen}
        onStoreChange={updateChatMemory}
        open={memoryOpen}
        store={chatMemory}
      />
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
  const toolParts = message.parts.filter(isToolUIPart);
  const pendingApprovalParts = toolParts.filter((part) => part.state === "approval-requested");
  if (!isUser && !text.trim() && toolParts.length === 0) return null;
  const usage = showTokenUsage && !isUser ? getMessageUsage(message) : undefined;
  const usageLabel = usage ? formatTokenUsage(usage) : null;
  const toolLimitReached = Boolean(
    !isUser && (message.metadata as { toolLimitReached?: boolean } | undefined)?.toolLimitReached,
  );

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
          <strong>{isUser ? "你" : "m-dashboard"}</strong>
          <span>{isUser ? "刚刚" : isStreaming ? "生成中" : "已完成"}</span>
        </div>
        {!isUser && toolParts.length > 0 ? (
          <div className="chat-tool-calls">
            <ChatToolCallGroup
              calls={toolParts.map((part) => ({
                id: part.toolCallId,
                toolName: getToolName(part),
                state: part.state,
                input: part.input,
                output: "output" in part ? part.output : undefined,
                errorText: "errorText" in part ? part.errorText : undefined,
                preliminary: "preliminary" in part ? Boolean(part.preliminary) : false,
              }))}
            />
          </div>
        ) : null}
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
        {text.trim() ? (
          <div className="chat-message-text">
            <Streamdown isAnimating={!isUser && isStreaming} plugins={{ code }}>
              {text}
            </Streamdown>
          </div>
        ) : null}
        {toolLimitReached ? (
          <p className="mt-2 text-amber-600 text-xs dark:text-amber-300">
            已达到工具调用上限（20 轮），如需继续请发送一条新消息。
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

function formatModelLabel(model: ModelConfig) {
  return model.responsive ? `${model.name} · Responses` : model.name;
}

function createModelTransport(
  sessionId: string,
  model: ModelConfig | undefined,
  getMemory: () => ChatMemoryStore,
  getToolsSettings: () => ChatToolsSettings,
  getCwd: () => string,
  getWorkspaceId: () => string,
  getSandboxMode: () => ChatSandboxMode,
  getSkills: () => SkillDefinition[],
): ChatTransport<UIMessage> {
  return new DefaultChatTransport<UIMessage>({
    api: `${chatServerUrl()}/v1/sessions/${sessionId}/runs`,
    headers: async () => {
      await initializeChatServer();
      return chatServerHeaders();
    },
    prepareSendMessagesRequest: async ({ messages }) => {
      await initializeChatServer();
      if (!model || model.baseUrl.startsWith("local://")) {
        throw new Error("请先在设置中配置一个真实的模型 API。");
      }
      const memory = getMemory();
      const memorySystem =
        memory.enabled && memory.items.length > 0 ? formatMemoryForInject(memory.items) : "";
      const cwd = getCwd().trim();
      const workspaceId = getWorkspaceId().trim();
      const sandboxMode = getSandboxMode();
      await ensureChatServerSession(sessionId, {
        cwd: cwd || undefined,
        workspaceId: workspaceId || undefined,
      });
      const skillsHint = formatSkillsSystemHint(getSkills());
      const activeTools = await resolveActiveTools(getToolsSettings(), model, getCwd);
      const toolsHint = activeTools.toolNames.length
        ? `当前已启用工具：${activeTools.toolNames.join(", ")}`
        : "当前未启用工具。";
      const workspaceHint = cwd
        ? `当前 workspace：${cwd}\n本地文件工具以此目录为根。`
        : "当前未选择 workspace。";
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
          system: [workspaceHint, toolsHint, skillsHint].filter(Boolean).join("\n\n"),
          memory: memorySystem,
          cwd: cwd || undefined,
          workspaceId: workspaceId || undefined,
          sandboxMode,
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
