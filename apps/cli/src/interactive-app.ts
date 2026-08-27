import { Box, Text, useApp, useInput } from "ink";
import { createElement as h, useEffect, useRef, useState } from "react";
import type { CliTurnResult } from "./cli-session.ts";
import { type CliChatMessage, MessageList } from "./message-list.ts";
import { type StatusKind, StatusLine } from "./status-line.ts";
import { TextInput } from "./text-input.ts";
import type { CliRunProgress, CliTurnEvent } from "./turn-events.ts";

export const EXIT_COMMANDS = new Set([":q", ":quit", ":exit"]);

export function isExitCommand(text: string) {
  return EXIT_COMMANDS.has(text.trim().toLowerCase());
}

export type InteractiveAppProps = {
  submit: (
    prompt: string,
    signal: AbortSignal,
    onEvent?: (event: CliTurnEvent) => void,
  ) => Promise<CliTurnResult>;
  stop?: () => Promise<void> | void;
  onExit?: () => void;
  modelLabel?: string;
  cwd?: string;
};

export function InteractiveApp(props: InteractiveAppProps) {
  const { exit } = useApp();
  const [messages, setMessages] = useState<CliChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [status, setStatus] = useState<StatusKind>("idle");
  const [error, setError] = useState<string | undefined>();
  const [progress, setProgress] = useState<CliRunProgress | undefined>();
  const abortRef = useRef<AbortController | null>(null);
  const draftRef = useRef<CliChatMessage | null>(null);
  const exitingRef = useRef(false);

  const close = () => {
    if (exitingRef.current) return;
    exitingRef.current = true;
    abortRef.current?.abort();
    props.onExit?.();
    void Promise.resolve(props.stop?.()).finally(() => {
      exit();
    });
  };

  useInput((value, key) => {
    if (key.ctrl && value === "d") close();
    if (key.ctrl && value === "c" && status === "running") {
      abortRef.current?.abort();
      void Promise.resolve(props.stop?.());
      setMessages((current) =>
        current.map((message, index) =>
          index === current.length - 1 && message.role === "assistant"
            ? { ...message, pending: false }
            : message,
        ),
      );
      setProgress((current) => ({
        phase: "stopping",
        stepCount: current?.stepCount ?? 0,
        toolCallCount: current?.toolCallCount ?? 0,
      }));
    }
  });

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  const handleSubmit = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) return;
    if (isExitCommand(trimmed)) {
      close();
      return;
    }
    if (status === "running" || exitingRef.current) return;
    setInput("");
    setError(undefined);
    draftRef.current = { role: "assistant", text: "", tools: [], pending: true };
    setMessages((current) => [
      ...current,
      { role: "user", text: trimmed },
      draftRef.current as CliChatMessage,
    ]);
    setStatus("running");
    setProgress(undefined);
    const controller = new AbortController();
    abortRef.current = controller;
    void props
      .submit(trimmed, controller.signal, (event) => {
        if (controller.signal.aborted || exitingRef.current) return;
        if (event.type === "progress") setProgress(event.progress);
        if (event.type === "event-error") setError(event.message);
        if (event.type === "text-delta" || event.type === "snapshot") {
          const currentDraft = draftRef.current ?? {
            role: "assistant" as const,
            text: "",
            tools: [],
            pending: true,
          };
          draftRef.current =
            event.type === "text-delta"
              ? { ...currentDraft, text: currentDraft.text + event.delta }
              : { ...currentDraft, text: event.text, tools: event.tools };
          setMessages((current) =>
            current.map((message, index) => {
              if (index !== current.length - 1 || message.role !== "assistant") return message;
              return draftRef.current as CliChatMessage;
            }),
          );
        }
      })
      .then((result) => {
        if (controller.signal.aborted || exitingRef.current) return;
        const finalDraft = {
          ...(draftRef.current ?? { role: "assistant" as const, text: "", tools: [] }),
          text: result.text || draftRef.current?.text || "",
          pending: false,
        };
        draftRef.current = finalDraft;
        setMessages((current) =>
          current.map((message, index) =>
            index === current.length - 1 && message.role === "assistant" ? finalDraft : message,
          ),
        );
        if (result.aborted) {
          setError("运行已停止");
          return;
        }
        if (
          (!finalDraft.text && !finalDraft.tools?.length) ||
          result.summary?.outcome === "error" ||
          result.summary?.outcome === "stopped"
        ) {
          setError(
            result.summary?.stopReason
              ? `运行失败：${result.summary.stopReason}`
              : result.text
                ? "本轮未完整结束，可以继续输入。"
                : "模型没有返回内容",
          );
        }
      })
      .catch((caught: unknown) => {
        if (controller.signal.aborted || exitingRef.current) return;
        setError(caught instanceof Error ? caught.message : String(caught));
      })
      .finally(() => {
        if (abortRef.current === controller) abortRef.current = null;
        if (!exitingRef.current) {
          if (controller.signal.aborted) setError("运行已停止");
          setStatus("idle");
        }
      });
  };

  return h(
    Box,
    { flexDirection: "column" },
    h(
      Box,
      {
        justifyContent: "space-between",
        borderStyle: "single",
        borderLeft: false,
        borderRight: false,
      },
      h(Text, { bold: true, color: "cyan" }, "ChatDesk"),
      h(
        Text,
        { dimColor: true, wrap: "truncate-end" },
        [props.modelLabel, props.cwd].filter(Boolean).join(" · "),
      ),
    ),
    h(MessageList, { messages }),
    h(StatusLine, { status, error, progress }),
    h(TextInput, {
      value: input,
      disabled: status === "running",
      onChange: setInput,
      onSubmit: handleSubmit,
    }),
  );
}
