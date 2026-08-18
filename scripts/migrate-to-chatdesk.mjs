import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { copyFile, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
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
  const options = { apply: false, rollback: false, sources: [], target: defaultTarget };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--apply") {
      options.apply = true;
    } else if (argument === "--rollback") {
      options.rollback = true;
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
  pnpm migrate chatdesk
  pnpm migrate chatdesk -- --apply
  pnpm migrate chatdesk -- --source <旧目录> [--source <旧目录>]
  pnpm migrate chatdesk -- --target <目标目录> --apply
  pnpm migrate chatdesk -- --target <目标目录> --rollback

默认目标：${defaultTarget}
默认只预览；使用 --apply 才会复制文件。
--rollback 只撤销最近一次由本脚本记录的迁移。
详见 docs/data-migration.md。`);
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

async function planCopy(mapping, apply, beforeCopy) {
  const targetExists = existsSync(mapping.target);
  if (!targetExists) {
    if (apply) {
      await beforeCopy(mapping);
      await mkdir(path.dirname(mapping.target), { recursive: true });
      await copyFile(mapping.source, mapping.target);
      return "copied";
    }
    return "would-copy";
  }
  if (await sameFile(mapping.source, mapping.target)) return "skipped";
  return "conflict";
}

function resolveManifestPath(targetRoot, relativePath) {
  if (typeof relativePath !== "string" || relativePath.length === 0) {
    throw new Error("迁移记录包含无效路径");
  }
  const root = path.resolve(targetRoot);
  const resolved = path.resolve(root, relativePath);
  if (resolved === root || !resolved.startsWith(`${root}${path.sep}`)) {
    throw new Error(`迁移记录路径越界：${relativePath}`);
  }
  return resolved;
}

function relativeTargetPath(targetRoot, targetPath) {
  const relativePath = path.relative(path.resolve(targetRoot), path.resolve(targetPath));
  resolveManifestPath(targetRoot, relativePath);
  return relativePath;
}

async function fileSha256(filePath) {
  return createHash("sha256")
    .update(await readFile(filePath))
    .digest("hex");
}

async function readMigrationManifest(manifestPath) {
  try {
    return JSON.parse(await readFile(manifestPath, "utf8"));
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error(`迁移记录格式错误：${manifestPath}`);
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

function validateRollbackManifest(manifest, targetRoot) {
  const validCreatedFiles = manifest?.createdFiles?.every(
    (file) =>
      typeof file?.path === "string" &&
      typeof file.sha256 === "string" &&
      /^[a-f0-9]{64}$/.test(file.sha256),
  );
  const validBackups = manifest?.backups?.every(
    (backup) =>
      typeof backup?.target === "string" &&
      typeof backup.backup === "string" &&
      typeof backup.sha256 === "string" &&
      /^[a-f0-9]{64}$/.test(backup.sha256),
  );
  if (
    manifest?.version !== 1 ||
    !["in-progress", "applied"].includes(manifest.status) ||
    !Array.isArray(manifest.createdFiles) ||
    !Array.isArray(manifest.backups) ||
    !validCreatedFiles ||
    !validBackups
  ) {
    throw new Error("迁移记录不包含可回滚信息，未修改目标数据");
  }
  if (path.resolve(manifest.target) !== path.resolve(targetRoot)) {
    throw new Error(`迁移记录目标不匹配：${manifest.target}`);
  }
}

async function rollbackMigration(targetRoot) {
  const manifestPath = path.join(targetRoot, ".migration-v1.json");
  const manifest = await readMigrationManifest(manifestPath);
  if (!manifest) throw new Error(`没有可回滚的迁移记录：${manifestPath}`);
  validateRollbackManifest(manifest, targetRoot);

  for (const file of manifest.createdFiles) {
    const target = resolveManifestPath(targetRoot, file.path);
    if (existsSync(target) && (await fileSha256(target)) !== file.sha256) {
      throw new Error(`迁移后文件已被修改，回滚已停止：${target}`);
    }
  }
  for (const backup of manifest.backups) {
    const source = resolveManifestPath(targetRoot, backup.backup);
    if (!existsSync(source) || (await fileSha256(source)) !== backup.sha256) {
      throw new Error(`迁移备份缺失或已被修改，回滚已停止：${source}`);
    }
  }

  for (const file of [...manifest.createdFiles].reverse()) {
    await rm(resolveManifestPath(targetRoot, file.path), { force: true });
  }
  for (const backup of manifest.backups) {
    const target = resolveManifestPath(targetRoot, backup.target);
    const source = resolveManifestPath(targetRoot, backup.backup);
    await mkdir(path.dirname(target), { recursive: true });
    await copyFile(source, target);
  }
  if (manifest.backupDirectory) {
    await rm(resolveManifestPath(targetRoot, manifest.backupDirectory), {
      recursive: true,
      force: true,
    });
  }
  await rm(manifestPath, { force: true });
  console.log(`已回滚迁移：${targetRoot}`);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.rollback) {
    if (options.apply || options.sources.length > 0) {
      throw new Error("--rollback 不能与 --apply 或 --source 同时使用");
    }
    await rollbackMigration(options.target);
    return;
  }

  const manifestPath = path.join(options.target, ".migration-v1.json");
  const existingManifest = await readMigrationManifest(manifestPath);
  if (options.apply && existingManifest) {
    validateRollbackManifest(existingManifest, options.target);
    if (existingManifest.status === "in-progress") {
      throw new Error(`上次迁移未完成，请先执行 --rollback：${manifestPath}`);
    }
    console.log(`迁移已经应用；如需重新执行，请先使用 --rollback：${manifestPath}`);
    return;
  }

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
  const backupDirectory = `.migration-v1-backup-${randomUUID()}`;
  const manifest = {
    version: 1,
    status: "in-progress",
    sources,
    target: options.target,
    migratedAt: new Date().toISOString(),
    createdFiles: [],
    backups: [],
    backupDirectory,
    summary,
  };
  const writeManifest = async () => {
    await mkdir(options.target, { recursive: true });
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  };

  if (options.apply) await writeManifest();
  for (const mapping of mappings) {
    try {
      const result = await planCopy(mapping, options.apply, async (copyMapping) => {
        const relativePath = relativeTargetPath(options.target, copyMapping.target);
        if (!manifest.createdFiles.some((file) => file.path === relativePath)) {
          manifest.createdFiles.push({
            path: relativePath,
            sha256: await fileSha256(copyMapping.source),
          });
          await writeManifest();
        }
      });
      summary[result] += 1;
      if (options.apply) await writeManifest();
      console.log(`${result.padEnd(8)} ${mapping.source} -> ${mapping.target}`);
    } catch (error) {
      summary.failed += 1;
      if (options.apply) await writeManifest();
      console.error(
        `failed   ${mapping.source}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  if (options.apply && summary.failed === 0) {
    await migrateLegacySettingsKeys(options.target, summary, manifest, writeManifest);
    manifest.status = "applied";
    await writeManifest();
  }

  console.log(
    `\n${options.apply ? "迁移完成" : "预览完成（未写入文件）"}：${JSON.stringify(summary)}`,
  );
  if (summary.conflict > 0) {
    console.log("目标目录已有不同内容的文件，已跳过冲突；脚本不会覆盖目标数据。");
  }
  if (options.apply && summary.failed > 0) {
    throw new Error(`迁移未完成；修复问题后先使用 --rollback：${manifestPath}`);
  }
}

async function migrateLegacySettingsKeys(targetRoot, summary, manifest, writeManifest) {
  const settingsPath = path.join(targetRoot, "settings.json");
  const logsPath = path.join(targetRoot, "system-logs.json");
  if (existsSync(logsPath)) return;
  let settings;
  try {
    settings = JSON.parse(await readFile(settingsPath, "utf8"));
  } catch {
    // The key is optional and malformed legacy settings should remain untouched.
    return;
  }
  if (!Array.isArray(settings["system-logs"])) return;

  const settingsRelative = relativeTargetPath(targetRoot, settingsPath);
  const createdSettings = manifest.createdFiles.find((file) => file.path === settingsRelative);
  if (!createdSettings) {
    const backupPath = path.join(targetRoot, manifest.backupDirectory, "settings.json");
    await mkdir(path.dirname(backupPath), { recursive: true });
    await copyFile(settingsPath, backupPath);
    manifest.backups.push({
      target: settingsRelative,
      backup: relativeTargetPath(targetRoot, backupPath),
      sha256: await fileSha256(backupPath),
    });
    await writeManifest();
  }

  const logsRelative = relativeTargetPath(targetRoot, logsPath);
  const logsContents = `${JSON.stringify(settings["system-logs"], null, 2)}\n`;
  if (!manifest.createdFiles.some((file) => file.path === logsRelative)) {
    manifest.createdFiles.push({
      path: logsRelative,
      sha256: createHash("sha256").update(logsContents).digest("hex"),
    });
    await writeManifest();
  }
  await writeFile(logsPath, logsContents);
  delete settings["system-logs"];
  await writeFile(settingsPath, `${JSON.stringify(settings, null, 2)}\n`);
  if (createdSettings) {
    createdSettings.sha256 = await fileSha256(settingsPath);
    await writeManifest();
  }
  summary.copied += 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
