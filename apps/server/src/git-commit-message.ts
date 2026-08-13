const COMMIT_TYPES = "feat|fix|docs|refactor|test|chore|build|ci|perf";
const COMMIT_TYPE_PATTERN = new RegExp(`^(${COMMIT_TYPES})(?:\\([^)]*\\))?:\\s*(.*)$`, "i");

export function normalizeGeneratedCommitMessage(value: string) {
  const firstLine = value
    .trim()
    .replace(/^```(?:text|textile|commit)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .split(/\r?\n/, 1)[0]
    ?.trim()
    .replace(/^['"]|['"]$/g, "")
    .trim();
  const match = firstLine.match(COMMIT_TYPE_PATTERN);
  if (match) {
    const body = match[2].trim();
    if (body && /[A-Za-z]/.test(body)) return `${match[1].toLowerCase()}: ${body}`;
  }
  const body = firstLine.replace(/^[^A-Za-z]+/, "").trim();
  return body && /[A-Za-z]/.test(body) ? `chore: ${body}` : "chore: update workspace changes";
}
