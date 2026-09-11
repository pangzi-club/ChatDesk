import { DEVELOPMENT_TOOL_NAMES, type DevelopmentToolName } from "@chatdesk/shared";

const NOT_FOUND_PATTERNS = [
  (name: string) => new RegExp(`command not found:\\s*${name}(?:\\s|$)`, "i"),
  (name: string) => new RegExp(`(?:^|[\\s:])${name}:\\s*(?:command )?not found(?:\\s|$)`, "i"),
  (name: string) => new RegExp(`unknown command:\\s*${name}(?:\\s|$)`, "i"),
];

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function detectMissingDevelopmentTools(output: unknown): DevelopmentToolName[] {
  if (!output || typeof output !== "object") return [];
  const out = (output as { out?: unknown }).out;
  if (typeof out !== "string" || !out.trim()) return [];

  return DEVELOPMENT_TOOL_NAMES.filter((name) => {
    const escapedName = escapeRegExp(name);
    return NOT_FOUND_PATTERNS.some((pattern) => pattern(escapedName).test(out));
  });
}
