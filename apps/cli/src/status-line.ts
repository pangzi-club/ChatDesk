import { Box, Text } from "ink";
import Spinner from "ink-spinner";
import { createElement as h } from "react";

export type StatusKind = "idle" | "running" | "error";

export function StatusLine(props: { status: StatusKind; error?: string }) {
  if (props.status === "running") {
    return h(Box, null, h(Text, { color: "cyan" }, h(Spinner, { type: "dots" }), " 正在回答…"));
  }
  if (props.error) {
    return h(Text, { color: "red" }, props.error);
  }
  return h(
    Text,
    { dimColor: true },
    "输入消息后回车发送。:q / :quit / :exit 或 Ctrl-C / Ctrl-D 退出。",
  );
}
