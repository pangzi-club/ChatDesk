import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { accessSync, constants, existsSync, readdirSync } from "node:fs";
import { chmod, copyFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The npm SDK ships the native dylib/addon but never the `cua-driver`
 * executable, so every runtime (packaged app, `pnpm dev`, CI packaging) has to
 * stage the same signed binary into `apps/desktop/assets/binaries`.
 *
 * This module is the single source of truth for that step: it resolves a local
 * installation first and can fall back to the pinned GitHub release, verifying
 * the archive against the digest published in the release `checksums.txt`.
 */

export const CUA_DRIVER_VERSION = "0.24.0";

const releaseBaseUrl = `https://github.com/trycua/cua/releases/download/cua-driver-rs-v${CUA_DRIVER_VERSION}`;

const assets = {
  "darwin-arm64": {
    name: `cua-driver-rs-${CUA_DRIVER_VERSION}-darwin-arm64.tar.gz`,
    sha256: "fd0cf565db831ad34d44a3c2321439575e02a6ce3ca97d04f267db1da7883685",
  },
  "darwin-x64": {
    name: `cua-driver-rs-${CUA_DRIVER_VERSION}-darwin-x86_64.tar.gz`,
    sha256: "66db9b244c12e0f416212ca3421afb7cda6b1b927fb6536943919bb7eff5e10b",
  },
  "linux-arm64": {
    name: `cua-driver-rs-${CUA_DRIVER_VERSION}-linux-arm64.tar.gz`,
    sha256: "6d7969715e6be6e1d635fc0017040825d132142c8503130b1ce08fb6ee71c8c9",
  },
  "linux-x64": {
    name: `cua-driver-rs-${CUA_DRIVER_VERSION}-linux-x86_64.tar.gz`,
    sha256: "e313e4072bde730f16466b90388c7602954ff25714bf73f701d7218eeb7747d2",
  },
  "win32-arm64": {
    name: `cua-driver-rs-${CUA_DRIVER_VERSION}-windows-arm64.zip`,
    sha256: "7e593f774ea17fbaf758f4af82cff500418e1cbf6e62400ac27122a963fd20dc",
  },
  "win32-x64": {
    name: `cua-driver-rs-${CUA_DRIVER_VERSION}-windows-x86_64.zip`,
    sha256: "1c7197908b13325083337acdd66db7b65df246f65e2b91e2974a079d0773e596",
  },
};

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function cuaDriverExecutableName(platform = process.platform) {
  return platform === "win32" ? "cua-driver.exe" : "cua-driver";
}

export function cuaDriverTargetPath(platform = process.platform) {
  return path.join(
    repositoryRoot,
    "apps/desktop/assets/binaries",
    cuaDriverExecutableName(platform),
  );
}

export function cuaDriverAsset(platform = process.platform, arch = process.arch) {
  const asset = assets[`${platform}-${arch}`];
  if (!asset) return null;
  return { ...asset, url: `${releaseBaseUrl}/${asset.name}` };
}

/** Candidate paths for an already installed driver, in priority order. */
export function cuaDriverLocalCandidates({
  platform = process.platform,
  home = os.homedir(),
  env = process.env,
  target = cuaDriverTargetPath(platform),
} = {}) {
  return [
    env.CHATDESK_CUA_DRIVER,
    env.CUA_DRIVER_BINARY,
    target,
    platform === "darwin" ? "/Applications/CuaDriver.app/Contents/MacOS/cua-driver" : undefined,
    path.join(home, ".local", "bin", cuaDriverExecutableName(platform)),
  ].filter((value) => typeof value === "string" && value.length > 0);
}

export function resolveLocalCuaDriver(options = {}) {
  const candidates = [...cuaDriverLocalCandidates(options)];
  if (options.probePath ?? true) {
    const fromPath = whichCuaDriver();
    if (fromPath) candidates.push(fromPath);
  }
  return candidates.find(isExecutable) ?? null;
}

/**
 * Resolve a usable driver path: a local installation (or an already staged
 * binary) wins; otherwise the pinned release is downloaded when `download` is
 * enabled. Returns `null` when nothing can be resolved.
 */
export async function resolveCuaDriver({ download = false, ...options } = {}) {
  const local = resolveLocalCuaDriver(options);
  if (local) return local;
  if (!download) return null;
  return downloadCuaDriver(options);
}

/** Download, checksum-verify, extract, and install the pinned driver release. */
export async function downloadCuaDriver({
  platform = process.platform,
  arch = process.arch,
  target = cuaDriverTargetPath(platform),
  fetchImpl = fetch,
  log = console.log,
} = {}) {
  const asset = cuaDriverAsset(platform, arch);
  if (!asset) {
    throw new Error(
      `没有为 ${platform}-${arch} 固定 Cua Driver 发行包，请用 CHATDESK_CUA_DRIVER 指定本地驱动`,
    );
  }
  log(`Downloading Cua Driver ${CUA_DRIVER_VERSION} (${platform}-${arch})`);
  const response = await fetchImpl(asset.url);
  if (!response.ok) {
    throw new Error(`下载 Cua Driver 失败：HTTP ${response.status} ${asset.url}`);
  }
  const archive = Buffer.from(await response.arrayBuffer());
  const digest = createHash("sha256").update(archive).digest("hex");
  if (digest !== asset.sha256) {
    throw new Error(`Cua Driver 校验失败：期望 SHA-256 ${asset.sha256}，实际 ${digest}`);
  }

  const work = await mkdtemp(path.join(os.tmpdir(), "cua-driver-"));
  try {
    const archivePath = path.join(work, asset.name);
    await writeFile(archivePath, archive);
    const extractedRoot = path.join(work, "extracted");
    await mkdir(extractedRoot, { recursive: true });
    extractArchive(archivePath, extractedRoot);
    const source = findCuaDriverBinary(extractedRoot, cuaDriverExecutableName(platform));
    if (!source) {
      throw new Error(`Cua Driver 归档 ${asset.name} 中没有找到可执行文件`);
    }
    await mkdir(path.dirname(target), { recursive: true });
    await copyFile(source, target);
    await chmod(target, 0o755);
    return target;
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

/**
 * Copy the resolved driver into `apps/desktop/assets/binaries` so the packaged
 * app ships it. A missing driver is a warning, not a build failure.
 */
export async function stageCuaDriver({ download = false, log = console.log, ...options } = {}) {
  const platform = options.platform ?? process.platform;
  const target = options.target ?? cuaDriverTargetPath(platform);
  let source;
  try {
    source = await resolveCuaDriver({ download, log, ...options, target });
  } catch (error) {
    log(`Cua Driver binary not staged: ${error instanceof Error ? error.message : error}`);
    return null;
  }
  if (!source) {
    log("Cua Driver binary not staged; set CHATDESK_CUA_DRIVER when building a packaged app.");
    return null;
  }
  if (path.resolve(source) !== path.resolve(target)) {
    await mkdir(path.dirname(target), { recursive: true });
    await copyFile(source, target);
  }
  if (platform !== "win32") await chmod(target, 0o755);
  log(`Staged Cua Driver binary: ${target}`);
  return target;
}

function whichCuaDriver() {
  try {
    return execFileSync("which", ["cua-driver"], { encoding: "utf8" }).trim() || null;
  } catch {
    return null;
  }
}

function isExecutable(candidate) {
  if (!existsSync(candidate)) return false;
  try {
    accessSync(candidate, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function extractArchive(archive, destination) {
  const result = spawnSync("tar", ["xf", archive, "-C", destination], { stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`解压 ${path.basename(archive)} 失败（tar 退出码 ${result.status}）`);
  }
}

/** Find the shallowest `cua-driver` outside any bundled `.app` directory. */
export function findCuaDriverBinary(root, name) {
  let level = [root];
  while (level.length > 0) {
    const next = [];
    for (const directory of level) {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const entryPath = path.join(directory, entry.name);
        if (entry.isDirectory()) {
          if (!entry.name.endsWith(".app")) next.push(entryPath);
        } else if (entry.name === name) {
          return entryPath;
        }
      }
    }
    level = next;
  }
  return null;
}
