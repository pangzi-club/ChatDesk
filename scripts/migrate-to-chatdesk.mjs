import { existsSync } from "node:fs";
import { copyFile, mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const defaultTarget = path.join(os.homedir(), ".chatdesk");
const legacyAppData = path.join(
  os.homedir(),
  "Library",
  "Application Support",
  "org.bohao.mdashboard",
);

function parseArgs(argv) {
  const options = { apply: false, sources: [], target: defaultTarget };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--apply") {
      options.apply = true;
    } else if (argument === "--source") {
      const source = argv[++index];
      if (!source) throw new Error("--source 需要路径");
      options.sources.push(path.resolve(source));
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
  pnpm migrate:chatdesk
  pnpm migrate:chatdesk -- --apply
  pnpm migrate:chatdesk -- --source <旧目录> [--source <旧目录>]
  pnpm migrate:chatdesk -- --target <目标目录> --apply

默认目标：${defaultTarget}
默认只预览；使用 --apply 才会复制文件。`);
}

function addSource(sources, source) {
  if (!sources.includes(source) && existsSync(source)) sources.push(source);
}

function defaultSources() {
  const sources = [];
  addSource(sources, path.join(projectRoot, ".data", "chat-server"));
  addSource(sources, legacyAppData);
  const configured = process.env.M_DASHBOARD_LEGACY_CHAT_DIR?.trim();
  if (configured) addSource(sources, path.resolve(configured));
  return sources;
}

async function collectFiles(source, targetRoot) {
  const sourceName = path.basename(source);
  const sourceParentName = path.basename(path.dirname(source));
  const mappings = [];

  if (sourceName === "chat-server") {
    await walk(source, source, path.join(targetRoot, "chat-server"), mappings);
  } else if (sourceName === "chat-archive") {
    await collectArchiveDirectory(source, targetRoot, mappings);
  } else if (sourceName === "chat") {
    await collectChatDirectory(source, targetRoot, mappings);
  } else if (
    sourceParentName === "Application Support" ||
    source === legacyAppData ||
    ["chat", "chat-server", "chat-archive"].some((directory) =>
      existsSync(path.join(source, directory)),
    )
  ) {
    for (const fileName of ["settings.json", "bookmarks.json", "system-logs.json"]) {
      await addIfFile(path.join(source, fileName), path.join(targetRoot, fileName), mappings);
    }
    for (const directory of ["chat", "chat-server", "chat-archive"]) {
      const child = path.join(source, directory);
      if (!existsSync(child)) continue;
      if (directory === "chat-archive") {
        await collectArchiveDirectory(child, targetRoot, mappings);
      } else if (directory === "chat-server") {
        await walk(child, child, path.join(targetRoot, "chat-server"), mappings);
      } else {
        await collectChatDirectory(child, targetRoot, mappings);
      }
    }
  } else {
    await walk(source, source, path.join(targetRoot, "chat-server"), mappings);
  }

  return mappings;
}

async function collectChatDirectory(source, targetRoot, mappings) {
  await addIfFile(
    path.join(source, "memory.json"),
    path.join(targetRoot, "chat-server", "memory.json"),
    mappings,
  );
  const sessions = path.join(source, "sessions");
  if (existsSync(sessions)) {
    await walk(sessions, sessions, path.join(targetRoot, "chat-server", "sessions"), mappings);
    return;
  }
  const entries = await readdir(source, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name === "attachments") continue;
    const directory = path.join(source, entry.name);
    await walk(
      directory,
      directory,
      path.join(targetRoot, "chat-server", "sessions", entry.name),
      mappings,
    );
  }
}

async function collectArchiveDirectory(source, targetRoot, mappings) {
  const archiveRoot = path.join(targetRoot, "chat-server", "archive");
  const sessions = path.join(source, "sessions");
  if (existsSync(sessions)) {
    await walk(sessions, sessions, path.join(archiveRoot, "sessions"), mappings);
    return;
  }
  const entries = await readdir(source, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      if (entry.isFile() && entry.name === "index.json") {
        mappings.push({
          source: path.join(source, entry.name),
          target: path.join(archiveRoot, entry.name),
        });
      }
      continue;
    }
    const directory = path.join(source, entry.name);
    await walk(directory, directory, path.join(archiveRoot, "sessions", entry.name), mappings);
  }
}

async function addIfFile(source, target, mappings) {
  try {
    const metadata = await stat(source);
    if (metadata.isFile()) mappings.push({ source, target });
  } catch {
    // Missing legacy files are expected.
  }
}

async function walk(directory, root, targetRoot, mappings) {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const source = path.join(directory, entry.name);
    const relative = path.relative(root, source);
    const target = path.join(targetRoot, relative);
    if (entry.isDirectory()) {
      await walk(source, root, targetRoot, mappings);
    } else if (entry.isFile()) {
      mappings.push({ source, target });
    }
  }
}

async function sameFile(left, right) {
  try {
    const [leftBytes, rightBytes] = await Promise.all([readFile(left), readFile(right)]);
    return leftBytes.equals(rightBytes);
  } catch {
    return false;
  }
}

async function planCopy(mapping, apply) {
  const targetExists = existsSync(mapping.target);
  if (!targetExists) {
    if (apply) {
      await mkdir(path.dirname(mapping.target), { recursive: true });
      await copyFile(mapping.source, mapping.target);
      return "copied";
    }
    return "would-copy";
  }
  if (await sameFile(mapping.source, mapping.target)) return "skipped";
  return "conflict";
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const sources = options.sources.length > 0 ? options.sources : defaultSources();
  if (sources.length === 0) {
    console.log("未发现可迁移的旧数据目录。");
    return;
  }

  const mappings = [];
  for (const source of sources) {
    try {
      mappings.push(...(await collectFiles(source, options.target)));
    } catch (error) {
      console.error(
        `读取旧目录失败：${source}\n${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  const summary = { copied: 0, "would-copy": 0, skipped: 0, conflict: 0, failed: 0 };
  for (const mapping of mappings) {
    try {
      const result = await planCopy(mapping, options.apply);
      summary[result] += 1;
      console.log(`${result.padEnd(8)} ${mapping.source} -> ${mapping.target}`);
    } catch (error) {
      summary.failed += 1;
      console.error(
        `failed   ${mapping.source}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  if (options.apply && summary.failed === 0) {
    await mkdir(options.target, { recursive: true });
    await migrateLegacySettingsKeys(options.target, summary);
    await writeFile(
      path.join(options.target, ".migration-v1.json"),
      JSON.stringify(
        {
          version: 1,
          sources,
          target: options.target,
          migratedAt: new Date().toISOString(),
          summary,
        },
        null,
        2,
      ),
    );
  }

  console.log(
    `\n${options.apply ? "迁移完成" : "预览完成（未写入文件）"}：${JSON.stringify(summary)}`,
  );
  if (summary.conflict > 0) {
    console.log("目标目录已有不同内容的文件，已跳过冲突；脚本不会覆盖目标数据。");
  }
}

async function migrateLegacySettingsKeys(targetRoot, summary) {
  const settingsPath = path.join(targetRoot, "settings.json");
  const logsPath = path.join(targetRoot, "system-logs.json");
  if (existsSync(logsPath)) return;
  try {
    const settings = JSON.parse(await readFile(settingsPath, "utf8"));
    if (!Array.isArray(settings["system-logs"])) return;
    await writeFile(logsPath, JSON.stringify(settings["system-logs"], null, 2));
    delete settings["system-logs"];
    await writeFile(settingsPath, JSON.stringify(settings, null, 2));
    summary.copied += 1;
  } catch {
    // The key is optional and malformed legacy settings should remain untouched.
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
