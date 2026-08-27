import { Box, Text } from "ink";
import Spinner from "ink-spinner";
import { createElement as h } from "react";
import type { CliRunProgress } from "./turn-events.ts";

export type StatusKind = "idle" | "running" | "error";

export function StatusLine(props: {
  status: StatusKind;
  error?: string;
  progress?: CliRunProgress;
}) {
  if (props.status === "running") {
    const detail =
      props.progress?.phase === "stopping"
        ? "正在停止"
        : props.progress
          ? `步骤 ${props.progress.stepCount} · 工具 ${props.progress.toolCallCount}`
          : "正在思考";
    return h(
      Box,
      null,
      h(Text, { color: "cyan" }, h(Spinner, { type: "dots" }), ` ${detail}`),
      h(Text, { dimColor: true }, "  Ctrl-C 停止"),
    );
  }
  if (props.error) {
    return h(Text, { color: "red" }, props.error);
  }
  return h(Text, { dimColor: true }, "Enter 发送 · Ctrl-D 或 :q 退出");
}
