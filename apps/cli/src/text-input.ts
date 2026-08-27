import { Box, Text } from "ink";
import InkTextInput from "ink-text-input";
import { createElement as h } from "react";

export function TextInput(props: {
  value: string;
  disabled?: boolean;
  onChange: (value: string) => void;
  onSubmit: (value: string) => void;
}) {
  return h(
    Box,
    null,
    h(Text, { color: "green" }, "> "),
    h(InkTextInput, {
      value: props.value,
      focus: !props.disabled,
      showCursor: !props.disabled,
      placeholder: props.disabled ? "" : "发送消息",
      onChange: props.disabled ? () => undefined : props.onChange,
      onSubmit: props.disabled ? () => undefined : props.onSubmit,
    }),
  );
}
