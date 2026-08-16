import { mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_WORKSPACE_ID = "default";
const DEFAULT_WORKSPACE_NAME = "Default Workspace";

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
  pnpm migrate default-workspace
  pnpm migrate default-workspace -- --target <chat-server-data-dir>
  pnpm migrate default-workspace -- --target <chat-server-data-dir> --apply

默认目标：${defaultTarget}
默认只预览；使用 --apply 才会为无 cwd 的 Default 会话创建 ~/.chatdesk/tasks/<sessionId> 并写回 meta.json。
详见 docs/data-migration.md。`);
}

function validId(id) {
  return typeof id === "string" && /^[a-zA-Z0-9-]{1,128}$/.test(id);
}

function isEmpty(value) {
  return value == null || (typeof value === "string" && !value.trim());
}

export function isDefaultSessionMeta(meta) {
  if (!meta || typeof meta !== "object") return false;
  return isEmpty(meta.workspaceId) && isEmpty(meta.cwd);
}

export function defaultTasksRoot(dataDir) {
  const resolved = path.resolve(dataDir);
  return path.basename(resolved) === "chat-server"
    ? path.join(path.dirname(resolved), "tasks")
    : path.join(resolved, "tasks");
}

export function taskCwdFor(tasksRoot, sessionId) {
  return path.resolve(path.join(tasksRoot, sessionId));
}

async function fileExists(file) {
  try {
    await readFile(file);
    return true;
  } catch {
    return false;
  }
}

async function readJson(file, fallback) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch {
    return fallback;
  }
}

async function atomicWrite(file, contents) {
  const temporary = `${file}.${process.pid}.tmp`;
  await writeFile(temporary, contents, "utf8");
  await rename(temporary, file);
}

export async function ensureDefaultWorkspace(dataDir, apply) {
  const tasksRoot = defaultTasksRoot(dataDir);
  const file = path.join(dataDir, "workspaces.json");
  const parsed = await readJson(file, []);
  const workspaces = Array.isArray(parsed) ? parsed : [];
  const existing = workspaces.find((item) => item && item.id === DEFAULT_WORKSPACE_ID);
  const workspace = existing ?? {
    id: DEFAULT_WORKSPACE_ID,
    path: tasksRoot,
    name: DEFAULT_WORKSPACE_NAME,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  if (!apply) return { workspace, created: !existing, tasksRoot: workspace.path };
  await mkdir(workspace.path, { recursive: true });
  if (!existing) {
    await mkdir(path.dirname(file), { recursive: true });
    await atomicWrite(file, `${JSON.stringify([workspace, ...workspaces], null, 2)}\n`);
  }
  return { workspace, created: !existing, tasksRoot: workspace.path };
}

export async function migrateDefaultSession(directory, tasksRoot, apply) {
  const metaFile = path.join(directory, "meta.json");
  if (!(await fileExists(metaFile))) {
    return { status: "skipped", reason: "missing-meta" };
  }
  let meta;
  try {
    meta = JSON.parse(await readFile(metaFile, "utf8"));
  } catch (error) {
    throw new Error(`非法 JSON：${error instanceof Error ? error.message : String(error)}`);
  }
  if (!meta || typeof meta !== "object" || !validId(meta.id)) {
    throw new Error("不是有效的会话 meta");
  }
  if (!isDefaultSessionMeta(meta)) {
    return { status: "skipped", reason: "not-default" };
  }
  const cwd = taskCwdFor(tasksRoot, meta.id);
  const next = {
    ...meta,
    workspaceId: DEFAULT_WORKSPACE_ID,
    cwd,
    updatedAt: new Date().toISOString(),
  };
  if (!apply) return { status: "would-migrate", cwd };
  await mkdir(cwd, { recursive: true });
  await atomicWrite(metaFile, `${JSON.stringify(next, null, 2)}\n`);
  return { status: "migrated", cwd };
}

export async function migrateDefaultWorkspace(target, apply) {
  const dataDir = path.resolve(target);
  const sessionsRoot = path.join(dataDir, "sessions");
  const { workspace } = await ensureDefaultWorkspace(dataDir, apply);
  const entries = await readdir(sessionsRoot, { withFileTypes: true }).catch(() => []);
  const summary = { scanned: 0, migrated: 0, skipped: 0, failed: 0 };
  const results = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !validId(entry.name)) continue;
    const directory = path.join(sessionsRoot, entry.name);
    summary.scanned += 1;
    try {
      const result = await migrateDefaultSession(directory, workspace.path, apply);
      results.push({ directory, ...result });
      if (result.status === "skipped") {
        summary.skipped += 1;
        continue;
      }
      summary.migrated += 1;
    } catch (error) {
      summary.failed += 1;
      results.push({
        directory,
        status: "failed",
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return { workspace, summary, results };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const { summary, results } = await migrateDefaultWorkspace(options.target, options.apply);
  for (const result of results) {
    if (result.status === "skipped") {
      console.log(`skip     ${result.directory} (${result.reason})`);
      continue;
    }
    if (result.status === "failed") {
      console.error(`failed   ${result.directory}: ${result.reason}`);
      continue;
    }
    console.log(
      `${result.status === "would-migrate" ? "would-migrate" : "migrated"} ${result.directory}`,
    );
  }
  console.log(
    `\n${options.apply ? "迁移完成" : "预览完成（未写入文件）"}：${JSON.stringify(summary)}`,
  );
  if (summary.failed > 0) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
