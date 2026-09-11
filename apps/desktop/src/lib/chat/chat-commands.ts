export type ChatCommand = {
  name: string;
  description: string;
};

export const CHAT_COMMANDS: ChatCommand[] = [
  { name: "/plan", description: "进入计划模式" },
  { name: "/test", description: "测试命令" },
];

// 命令必须由行首或空白字符引导，"/" 后到光标位置不能包含空白。
const COMMAND_TRIGGER_PATTERN = /(?:^|\s)\/(\S*)$/;

export type ChatCommandTrigger = {
  /** "/" 在全文中的字符下标 */
  start: number;
  /** "/" 之后、光标之前的查询串 */
  query: string;
};

/**
 * 在光标前的文本中查找活跃的斜杠命令触发段。
 * 返回 "/" 的位置和查询串；未触发时返回 null。
 */
export function findActiveCommandTrigger(text: string, caret: number): ChatCommandTrigger | null {
  const clampedCaret = Math.max(0, Math.min(caret, text.length));
  const beforeCaret = text.slice(0, clampedCaret);
  const match = COMMAND_TRIGGER_PATTERN.exec(beforeCaret);
  if (!match) return null;
  return {
    start: clampedCaret - match[1].length - 1,
    query: match[1],
  };
}

/** 便捷封装：只返回查询串。 */
export function findActiveCommandQuery(text: string, caret: number): string | null {
  return findActiveCommandTrigger(text, caret)?.query ?? null;
}

/** 按前缀过滤命令；空查询返回全部命令。 */
export function filterChatCommands(query: string): ChatCommand[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return [...CHAT_COMMANDS];
  const target = normalized.startsWith("/") ? normalized : `/${normalized}`;
  return CHAT_COMMANDS.filter((command) => command.name.toLowerCase().startsWith(target));
}
