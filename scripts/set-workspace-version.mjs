import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const skippedDirectoryNames = new Set([".cache", ".data", ".git", "dist", "node_modules"]);
const versionPattern = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;

export function isWorkspaceVersion(value) {
  return typeof value === "string" && versionPattern.test(value);
}

export function printHelp() {
  console.log(`用法：
  pnpm version:set -- <version>
  pnpm version:set -- <version> --dry-run

把 workspace 内所有 package.json 的 version 改成同一值。忽略 apps/tauri，也不改
Tauri 的 tauri.conf.json / Cargo.toml。

示例：
  pnpm version:set -- 0.5.0
  pnpm version:set -- 0.5.0 --dry-run`);
}

export function parseArgs(argv) {
  const options = { dryRun: false, help: false, version: undefined };
  for (const argument of argv) {
    if (argument === "--help" || argument === "-h") {
      options.help = true;
      continue;
    }
    if (argument === "--dry-run") {
      options.dryRun = true;
      continue;
    }
    if (argument.startsWith("-")) {
      throw new Error(`未知参数：${argument}`);
    }
    if (options.version) {
      throw new Error(`多余参数：${argument}`);
    }
    options.version = argument;
  }
  return options;
}

export function shouldSkipManifest(relativePath) {
  const normalized = relativePath.split(path.sep).join("/");
  return normalized === "apps/tauri/package.json" || normalized.startsWith("apps/tauri/");
}

export function applyPackageVersion(source, version) {
  const manifest = JSON.parse(source);
  if (typeof manifest.version !== "string") {
    throw new Error("package.json 缺少 version 字段");
  }
  const previous = manifest.version;
  if (previous === version) {
    return { previous, source, changed: false };
  }

  let replaced = false;
  const next = source.replace(
    /^(\s*"version"\s*:\s*")([^"]*)(")/m,
    (_match, prefix, _current, suffix) => {
      replaced = true;
      return `${prefix}${version}${suffix}`;
    },
  );
  if (!replaced) {
    throw new Error("无法更新 package.json 的 version 字段");
  }
  return { previous, source: next, changed: true };
}

async function listWorkspacePackageDirs(root, directoryName) {
  const directory = path.join(root, directoryName);
  try {
    const entries = await readdir(directory, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory() && !skippedDirectoryNames.has(entry.name))
      .map((entry) => path.join(directory, entry.name));
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

async function hasPackageManifest(directory) {
  try {
    return (await stat(path.join(directory, "package.json"))).isFile();
  } catch {
    return false;
  }
}

export async function findPackageManifests(root) {
  const packageDirs = [
    root,
    ...(await listWorkspacePackageDirs(root, "apps")),
    ...(await listWorkspacePackageDirs(root, "packages")),
  ];
  const manifests = [];
  for (const directory of packageDirs) {
    if (!(await hasPackageManifest(directory))) continue;
    const file = path.join(directory, "package.json");
    if (shouldSkipManifest(path.relative(root, file))) continue;
    manifests.push(file);
  }
  return manifests.sort((left, right) => left.localeCompare(right));
}

export async function setWorkspaceVersions(root, version, { dryRun = false } = {}) {
  if (!isWorkspaceVersion(version)) {
    throw new Error(`无效版本：${version}`);
  }

  const manifests = await findPackageManifests(root);
  const results = [];
  for (const file of manifests) {
    const original = await readFile(file, "utf8");
    const updated = applyPackageVersion(original, version);
    if (updated.changed && !dryRun) {
      await writeFile(file, updated.source);
    }
    results.push({
      file,
      relativePath: path.relative(root, file),
      previous: updated.previous,
      changed: updated.changed,
    });
  }
  return results;
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) {
    printHelp();
    return 0;
  }
  if (!options.version) {
    printHelp();
    return 1;
  }

  const results = await setWorkspaceVersions(repositoryRoot, options.version, {
    dryRun: options.dryRun,
  });
  for (const result of results) {
    const status = result.changed ? (options.dryRun ? "would-update" : "updated") : "unchanged";
    const suffix = result.changed
      ? ` ${result.previous} -> ${options.version}`
      : ` ${result.previous}`;
    console.log(`${status.padEnd(13)} ${result.relativePath}${suffix}`);
  }

  const changed = results.filter((result) => result.changed).length;
  console.log(
    `\n${options.dryRun ? "预览完成（未写入文件）" : "已更新"}：${changed}/${results.length} 个 package.json（已忽略 apps/tauri）`,
  );
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = await main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
