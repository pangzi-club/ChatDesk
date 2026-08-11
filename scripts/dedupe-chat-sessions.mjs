import { copyFile, readdir, readFile, rename, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const defaultTarget = path.resolve(
  process.env.CHAT_SERVER_DATA_DIR || path.join(os.homedir(), ".chatdesk", "chat-server"),
);

function parseArgs(argv) {
  const options = { apply: false, target: defaultTarget };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--apply") {
      options.apply = true;
    } else if (argument === "--target") {
      const target = argv[++index];
      if (!target) throw new Error("--target 需要路径");
      options.target = path.resolve(target);
    } else if (argument === "--help" || argument === "-h") {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`未知参数：${argument}`);
    }
  }
  return options;
}

function printHelp() {
  console.log(`用法：
  pnpm chat:sessions:dedupe
  pnpm chat:sessions:dedupe -- --target <chat-server-data-dir>
  pnpm chat:sessions:dedupe -- --target <chat-server-data-dir> --apply

默认目标：${defaultTarget}
默认只预览；使用 --apply 才会写入，并为变更的 session.json 保留 .before-dedupe 备份。`);
}

function isUnstableId(id) {
  return !id?.trim() || id.startsWith("legacy-message-");
}

function messageFingerprint(message) {
  const text = Array.isArray(message.parts)
    ? message.parts
        .filter((part) => part && typeof part === "object" && part.type === "text")
        .map((part) => part.text || "")
        .join("")
    : "";
  if (text) return `${message.role}:${text}`;
  const copy = structuredClone(message);
  delete copy.id;
  return JSON.stringify(copy);
}

function mergeDuplicateMessages(left, right) {
  const leftStable = !isUnstableId(left.id);
  const rightStable = !isUnstableId(right.id);
  const preferred = rightStable && !leftStable ? right : left;
  const richer = (right.parts?.length || 0) > (left.parts?.length || 0) ? right : left;
  const merged = {
    ...preferred,
    parts: richer.parts?.length ? richer.parts : preferred.parts,
    metadata: preferred.metadata ?? richer.metadata,
  };
  if (merged.metadata === undefined) delete merged.metadata;
  return merged;
}

export function dedupeSessionMessages(messages) {
  if (!Array.isArray(messages)) return { messages, removed: 0, assigned: 0 };
  const result = [];
  let removed = 0;
  let assigned = 0;

  for (const source of messages) {
    if (!source || typeof source !== "object" || Array.isArray(source)) {
      result.push(source);
      continue;
    }
    const message = structuredClone(source);
    const originalId = typeof message.id === "string" ? message.id : "";

    const previous = result.at(-1);
    const duplicate =
      message.role === "assistant" &&
      previous?.role === "assistant" &&
      messageFingerprint(previous) === messageFingerprint(message) &&
      (isUnstableId(originalId) || isUnstableId(previous.id));
    if (duplicate) {
      result[result.length - 1] = mergeDuplicateMessages(previous, message);
      removed += 1;
      continue;
    }
    result.push(message);
  }

  const usedIds = new Set();
  for (let index = 0; index < result.length; index += 1) {
    const message = result[index];
    if (!isUnstableId(message.id)) {
      usedIds.add(message.id);
      continue;
    }
    let nextId = `legacy-message-${index}`;
    while (usedIds.has(nextId)) nextId = `${nextId}-duplicate`;
    message.id = nextId;
    usedIds.add(nextId);
    assigned += 1;
  }

  return { messages: result, removed, assigned };
}

async function processSession(file, apply) {
  const original = await readFile(file, "utf8");
  let session;
  try {
    session = JSON.parse(original);
  } catch {
    return { changed: false, removed: 0, assigned: 0, skipped: true };
  }
  const result = dedupeSessionMessages(session.messages);
  const changed = result.removed > 0 || result.assigned > 0;
  if (!changed || !apply) return { ...result, changed, skipped: false };

  const backup = `${file}.before-dedupe`;
  try {
    await copyFile(file, backup);
  } catch {
    // A prior backup is sufficient for repeated runs.
  }
  const next = `${file}.${process.pid}.tmp`;
  await writeFile(next, JSON.stringify({ ...session, messages: result.messages }, null, 2));
  await rename(next, file);
  return { ...result, changed: true, skipped: false };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const sessionsRoot = path.join(options.target, "sessions");
  const entries = await readdir(sessionsRoot, { withFileTypes: true }).catch(() => []);
  const summary = { scanned: 0, changed: 0, removed: 0, assigned: 0, skipped: 0, failed: 0 };
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const file = path.join(sessionsRoot, entry.name, "session.json");
    summary.scanned += 1;
    try {
      const result = await processSession(file, options.apply);
      if (result.skipped) {
        summary.skipped += 1;
        console.log(`skip     ${file}`);
        continue;
      }
      if (result.changed) summary.changed += 1;
      summary.removed += result.removed;
      summary.assigned += result.assigned;
      if (result.changed) {
        console.log(
          `${options.apply ? "fixed" : "would-fix"} ${file} removed=${result.removed} assigned=${result.assigned}`,
        );
      }
    } catch (error) {
      summary.failed += 1;
      console.error(`failed   ${file}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  console.log(
    `\n${options.apply ? "清理完成" : "预览完成（未写入文件）"}：${JSON.stringify(summary)}`,
  );
  if (summary.failed > 0) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
