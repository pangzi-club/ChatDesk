import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
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
  pnpm migrate jsonl
  pnpm migrate jsonl -- --target <chat-server-data-dir>
  pnpm migrate jsonl -- --target <chat-server-data-dir> --apply

默认目标：${defaultTarget}
默认只预览；使用 --apply 才会写入 meta.json 与 messages.jsonl，并删除 session.json。
详见 docs/data-migration.md。`);
}

function validId(id) {
  return typeof id === "string" && /^[a-zA-Z0-9-]{1,128}$/.test(id);
}

function isSession(value) {
  if (!value || typeof value !== "object") return false;
  return (
    (value.schemaVersion === 1 || value.schemaVersion === 2) &&
    validId(value.id) &&
    typeof value.title === "string" &&
    typeof value.createdAt === "string" &&
    typeof value.updatedAt === "string" &&
    Array.isArray(value.messages) &&
    Array.isArray(value.attachments)
  );
}

export function sessionJsonToFiles(session) {
  const { messages = [], ...meta } = session;
  const metaText = `${JSON.stringify(meta, null, 2)}\n`;
  const jsonl =
    messages.length === 0
      ? ""
      : `${messages.map((message) => JSON.stringify(message)).join("\n")}\n`;
  return { metaText, jsonl };
}

async function fileExists(file) {
  try {
    await readFile(file);
    return true;
  } catch {
    return false;
  }
}

async function atomicWrite(file, contents) {
  const temporary = `${file}.${process.pid}.tmp`;
  await writeFile(temporary, contents, "utf8");
  await rename(temporary, file);
}

export async function migrateSessionDirectory(directory, apply) {
  const jsonFile = path.join(directory, "session.json");
  const metaFile = path.join(directory, "meta.json");
  const messagesFile = path.join(directory, "messages.jsonl");
  const hasMeta = await fileExists(metaFile);
  const hasMessages = await fileExists(messagesFile);
  if (hasMeta && hasMessages) {
    return { status: "skipped", reason: "already-migrated" };
  }

  let original;
  try {
    original = await readFile(jsonFile, "utf8");
  } catch {
    return { status: "skipped", reason: "missing-json" };
  }

  let session;
  try {
    session = JSON.parse(original);
  } catch (error) {
    throw new Error(`非法 JSON：${error instanceof Error ? error.message : String(error)}`);
  }
  if (!isSession(session)) throw new Error("不是有效的 ChatSession");

  const files = sessionJsonToFiles(session);
  if (!apply) return { status: "would-migrate", files };

  await mkdir(directory, { recursive: true });
  await atomicWrite(metaFile, files.metaText);
  await atomicWrite(messagesFile, files.jsonl);
  await rm(jsonFile, { force: true });
  return { status: "migrated", files };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const sessionsRoot = path.join(options.target, "sessions");
  const entries = await readdir(sessionsRoot, { withFileTypes: true }).catch(() => []);
  const summary = { scanned: 0, migrated: 0, skipped: 0, failed: 0 };
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const directory = path.join(sessionsRoot, entry.name);
    summary.scanned += 1;
    try {
      const result = await migrateSessionDirectory(directory, options.apply);
      if (result.status === "skipped") {
        summary.skipped += 1;
        console.log(`skip     ${directory} (${result.reason})`);
        continue;
      }
      if (result.status === "would-migrate") {
        summary.migrated += 1;
        console.log(`would-migrate ${directory}`);
        continue;
      }
      summary.migrated += 1;
      console.log(`migrated ${directory}`);
    } catch (error) {
      summary.failed += 1;
      console.error(
        `failed   ${directory}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  console.log(
    `\n${options.apply ? "迁移完成" : "预览完成（未写入文件）"}：${JSON.stringify(summary)}`,
  );
  if (summary.failed > 0) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
