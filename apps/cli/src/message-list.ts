import { Box, Text } from "ink";
import { createElement as h } from "react";
import { MarkdownView } from "./markdown.ts";

export type CliChatMessage = {
  role: "user" | "assistant";
  text: string;
};

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
        h(
          Text,
          { bold: true, color: message.role === "user" ? "green" : "cyan" },
          message.role === "user" ? "你" : "助手",
        ),
        message.role === "assistant"
          ? h(MarkdownView, { source: message.text })
          : h(Text, null, message.text),
      ),
    ),
  );
}
