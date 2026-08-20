export type ComposerMentionTrigger = {
  start: number;
  query: string;
};

const MENTION_TRIGGER_PATTERN = /(?:^|\s)@([^\s]*)$/;

export function findActiveMentionTrigger(
  text: string,
  caret: number,
): ComposerMentionTrigger | null {
  const clampedCaret = Math.max(0, Math.min(caret, text.length));
  const match = MENTION_TRIGGER_PATTERN.exec(text.slice(0, clampedCaret));
  if (!match) return null;
  return { start: clampedCaret - match[1].length - 1, query: match[1] };
}

export function applyMentionSelection(
  text: string,
  caret: number,
  path: string,
  kind: "dir" | "file",
) {
  const trigger = findActiveMentionTrigger(text, caret);
  if (!trigger) return null;
  const suffix = kind === "dir" ? "/" : " ";
  const replacement = `@${path}${suffix}`;
  const nextText = `${text.slice(0, trigger.start)}${replacement}${text.slice(caret)}`;
  return {
    text: nextText,
    caret: trigger.start + replacement.length,
    keepOpen: kind === "dir",
  };
}
