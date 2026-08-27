import { Box, Text } from "ink";
import { createElement as h } from "react";
import { MarkdownView } from "./markdown.ts";
import type { CliToolActivity } from "./turn-events.ts";

export type CliChatMessage = {
  role: "user" | "assistant";
  text: string;
  tools?: CliToolActivity[];
  pending?: boolean;
};

function ToolActivity(props: { tool: CliToolActivity }) {
  const { tool } = props;
  const marker =
    tool.status === "completed"
      ? "✓"
      : tool.status === "error"
        ? "×"
        : tool.status === "approval"
          ? "!"
          : "•";
  const color =
    tool.status === "completed"
      ? "green"
      : tool.status === "error"
        ? "red"
        : tool.status === "approval"
          ? "yellow"
          : "cyan";
  return h(
    Text,
    { color },
    `${marker} ${tool.name}`,
    tool.detail ? h(Text, { dimColor: true }, ` · ${tool.detail}`) : null,
    tool.error ? h(Text, { color: "red" }, ` · ${tool.error}`) : null,
  );
}

export function MessageList(props: { messages: CliChatMessage[] }) {
  return h(
    Box,
    { flexDirection: "column" },
    ...props.messages.map((message, index) =>
      h(
        Box,
        {
          key: `${message.role}-${index}`,
          flexDirection: "column",
          marginBottom: 1,
        },
        message.role === "user"
          ? h(Text, { bold: true, color: "green" }, "› 你")
          : h(Text, { bold: true, color: "cyan" }, message.pending ? "● ChatDesk" : "ChatDesk"),
        ...(message.tools ?? []).map((tool) => h(ToolActivity, { key: tool.id, tool })),
        message.role === "assistant"
          ? message.text
            ? h(MarkdownView, { source: message.text })
            : null
          : h(Text, null, message.text),
      ),
    ),
  );
}
