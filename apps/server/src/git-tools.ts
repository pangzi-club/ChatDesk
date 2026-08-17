export type ChatGitInput =
  | { action: "status" }
  | { action: "create_branch"; branch: string }
  | { action: "commit"; message: string };

const MAX_BRANCH_NAME_LENGTH = 255;
const MAX_COMMIT_MESSAGE_LENGTH = 2_000;

function shellQuote(value: string) {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function requireBranchName(value: string) {
  const branch = value.trim();
  if (!branch) throw new Error("分支名称不能为空");
  if (branch.length > MAX_BRANCH_NAME_LENGTH) throw new Error("分支名称过长");
  if (/\p{Cc}/u.test(branch)) throw new Error("分支名称不能包含控制字符");
  return branch;
}

function requireCommitMessage(value: string) {
  const message = value.trim();
  if (!message) throw new Error("提交信息不能为空");
  if (message.length > MAX_COMMIT_MESSAGE_LENGTH) throw new Error("提交信息过长");
  return message;
}

export function buildGitToolCommand(input: ChatGitInput) {
  if (input.action === "status") return "git status --short --branch";

  if (input.action === "create_branch") {
    const branch = requireBranchName(input.branch);
    return `git check-ref-format --branch ${shellQuote(branch)} >/dev/null && git switch --create ${shellQuote(branch)}`;
  }

  const message = requireCommitMessage(input.message);
  return `git add -A && git -c core.hooksPath=/dev/null commit -m ${shellQuote(message)} && git rev-parse HEAD`;
}

export function normalizeGitToolInput(value: unknown): ChatGitInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Git 工具参数无效");
  }
  const input = value as Record<string, unknown>;
  if (input.action === "status") return { action: "status" };
  if (input.action === "create_branch" && typeof input.branch === "string") {
    return { action: "create_branch", branch: input.branch };
  }
  if (input.action === "commit" && typeof input.message === "string") {
    return { action: "commit", message: input.message };
  }
  throw new Error("Git 工具需要 status、create_branch 或 commit 参数");
}

export function isGitMutation(input: unknown) {
  return normalizeGitAction(input) !== "status";
}

function normalizeGitAction(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as { action?: unknown }).action
    : undefined;
}
