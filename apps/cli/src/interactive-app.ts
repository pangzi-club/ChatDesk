import { Box, useApp, useInput } from "ink";
import { createElement as h, useEffect, useRef, useState } from "react";
import type { CliTurnResult } from "./cli-session.ts";
import { type CliChatMessage, MessageList } from "./message-list.ts";
import { type StatusKind, StatusLine } from "./status-line.ts";
import { TextInput } from "./text-input.ts";

export const EXIT_COMMANDS = new Set([":q", ":quit", ":exit"]);

export function isExitCommand(text: string) {
  return EXIT_COMMANDS.has(text.trim().toLowerCase());
}

export type InteractiveAppProps = {
  submit: (prompt: string, signal: AbortSignal) => Promise<CliTurnResult>;
  stop?: () => Promise<void> | void;
  onExit?: () => void;
};

export function InteractiveApp(props: InteractiveAppProps) {
  const { exit } = useApp();
  const [messages, setMessages] = useState<CliChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [status, setStatus] = useState<StatusKind>("idle");
  const [error, setError] = useState<string | undefined>();
  const abortRef = useRef<AbortController | null>(null);
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
    if (key.ctrl && (value === "c" || value === "d")) close();
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
    setMessages((current) => [...current, { role: "user", text: trimmed }]);
    setStatus("running");
    const controller = new AbortController();
    abortRef.current = controller;
    void props
      .submit(trimmed, controller.signal)
      .then((result) => {
        if (controller.signal.aborted || exitingRef.current) return;
        if (result.text) {
          setMessages((current) => [...current, { role: "assistant", text: result.text }]);
        }
        if (result.aborted) {
          setError("运行已停止");
          return;
        }
        if (
          !result.text ||
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
        if (!exitingRef.current) setStatus("idle");
      });
  };

  return h(
    Box,
    { flexDirection: "column" },
    h(MessageList, { messages }),
    h(StatusLine, { status, error }),
    h(TextInput, {
      value: input,
      disabled: status === "running",
      onChange: setInput,
      onSubmit: handleSubmit,
    }),
  );
}
