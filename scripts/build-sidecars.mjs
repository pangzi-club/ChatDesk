import { spawn } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const desktopRoot = path.join(root, "apps/desktop");
const tauriRoot = path.join(desktopRoot, "src-tauri");
const binariesDir = path.join(tauriRoot, "binaries");
const resourcesDir = path.join(tauriRoot, "resources");
const browserPath = path.join(resourcesDir, "playwright-browsers");
const serverCacheDir = path.join(root, "apps/server/.cache");
const serverBundlePath = path.join(serverCacheDir, "chat-server.cjs");
const sandboxBundlePath = path.join(serverCacheDir, "chat-server-sandbox.cjs");
const pkgCachePath = process.env.PKG_CACHE_PATH || path.join(root, ".cache/pkg");
const localBinExtension = process.platform === "win32" ? ".cmd" : "";
const localBinDir = path.join(desktopRoot, "node_modules/.bin");

const targetTriple = process.env.TAURI_TARGET_TRIPLE || (await readTargetTriple());
const pkgTarget = toPkgTarget(targetTriple);
const extension = process.platform === "win32" ? ".exe" : "";

assertTool("playwright");
assertTool("pkg");
assertTool("esbuild");

await mkdir(binariesDir, { recursive: true });
await mkdir(resourcesDir, { recursive: true });
await mkdir(browserPath, { recursive: true });
await mkdir(serverCacheDir, { recursive: true });
await mkdir(pkgCachePath, { recursive: true });

if (process.env.M_DASHBOARD_SKIP_BROWSER_DOWNLOAD !== "1") {
  await runTool("playwright", ["install", "chromium", "--only-shell"], {
    PLAYWRIGHT_BROWSERS_PATH: browserPath,
  });
}

await runTool("esbuild", [
  "apps/server/src/server.ts",
  "--bundle",
  "--platform=node",
  "--format=cjs",
  "--target=node22",
  "--external:sharp",
  `--outfile=${serverBundlePath}`,
]);

await runTool("esbuild", [
  "apps/server/src/sandbox-file-entry.ts",
  "--bundle",
  "--platform=node",
  "--format=cjs",
  "--target=node22",
  `--outfile=${sandboxBundlePath}`,
]);

await runTool(
  "pkg",
  [
    serverBundlePath,
    "--target",
    pkgTarget,
    "--fallback-to-source",
    "--public-packages",
    "undici,sharp",
    "--output",
    path.join(binariesDir, `chat-server-${targetTriple}${extension}`),
  ],
  { PKG_CACHE_PATH: pkgCachePath },
);

await runTool(
  "pkg",
  [
    sandboxBundlePath,
    "--target",
    pkgTarget,
    "--fallback-to-source",
    "--output",
    path.join(binariesDir, `chat-server-sandbox-${targetTriple}${extension}`),
  ],
  { PKG_CACHE_PATH: pkgCachePath },
);

await runTool(
  "pkg",
  [
    "apps/desktop/src-tauri/src/sidecar/browser-worker.mjs",
    "--target",
    pkgTarget,
    "--fallback-to-source",
    "--output",
    path.join(resourcesDir, `browser-worker${extension}`),
  ],
  {
    PLAYWRIGHT_BROWSERS_PATH: browserPath,
    PKG_CACHE_PATH: pkgCachePath,
  },
);

console.log(`Built sidecars for ${targetTriple} (${pkgTarget})`);
await copySharpNative();

async function copySharpNative() {
  const requireFromServer = createRequire(path.join(root, "apps/server/package.json"));
  let sharpEntry;
  try {
    sharpEntry = realpathSync(requireFromServer.resolve("sharp"));
  } catch (error) {
    throw new Error(
      `Cannot resolve sharp for sidecar packaging: ${error instanceof Error ? error.message : error}`,
    );
  }
  let nodeModulesDir = path.dirname(sharpEntry);
  while (path.basename(nodeModulesDir) !== "node_modules") {
    const parent = path.dirname(nodeModulesDir);
    if (parent === nodeModulesDir) {
      throw new Error(`Cannot locate sharp node_modules from ${sharpEntry}`);
    }
    nodeModulesDir = parent;
  }
  const destRoot = path.join(resourcesDir, "sharp-node-modules");
  const destModules = path.join(destRoot, "node_modules");
  await rm(destRoot, { recursive: true, force: true });
  await mkdir(destRoot, { recursive: true });
  await writeFile(
    path.join(destRoot, "package.json"),
    `${JSON.stringify({ name: "chatdesk-sharp-runtime", private: true }, null, 2)}\n`,
  );
  await cp(nodeModulesDir, destModules, { recursive: true, dereference: true });
  await writeFile(path.join(destRoot, ".keep"), "");
  const verify = createRequire(path.join(destRoot, "package.json"));
  verify("sharp");
  console.log("Verified packaged sharp native module");
}

async function readTargetTriple() {
  return (await execFile("rustc", ["--print", "host-tuple"])).trim();
}

function toPkgTarget(triple) {
  const targets = {
    "x86_64-apple-darwin": "node22-macos-x64",
    "aarch64-apple-darwin": "node22-macos-arm64",
    "x86_64-pc-windows-msvc": "node22-win-x64",
    "aarch64-pc-windows-msvc": "node22-win-arm64",
    "x86_64-unknown-linux-gnu": "node22-linux-x64",
    "aarch64-unknown-linux-gnu": "node22-linux-arm64",
  };
  const target = targets[triple];
  if (!target) throw new Error(`Unsupported sidecar target triple: ${triple}`);
  return target;
}

function assertTool(name) {
  const binary = path.join(localBinDir, `${name}${localBinExtension}`);
  if (!existsSync(binary)) {
    throw new Error(
      `Missing ${name} executable. Install workspace dependencies before building sidecars.`,
    );
  }
}

function execFile(command, args) {
  const result = spawn(command, args, { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "";
  let stderr = "";
  result.stdout.on("data", (chunk) => (stdout += chunk));
  result.stderr.on("data", (chunk) => (stderr += chunk));
  return new Promise((resolve, reject) => {
    result.once("error", reject);
    result.once("exit", (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(`${command} exited with ${code}: ${stderr || stdout}`));
    });
  });
}

async function run(command, args, env) {
  const result = await execFileWithEnv(command, args, env);
  if (result.trim()) console.log(result.trim());
}

async function runTool(name, args, env) {
  const binary = path.join(localBinDir, `${name}${localBinExtension}`);
  assertTool(name);
  if (process.platform === "win32") {
    await run("pnpm.cmd", ["exec", name, ...args], env);
  } else {
    await run(binary, args, env);
  }
}

function execFileWithEnv(command, args, extraEnv) {
  const child = spawn(command, args, {
    cwd: root,
    env: { ...process.env, ...extraEnv },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => {
    stdout += chunk;
    process.stdout.write(chunk);
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
    process.stderr.write(chunk);
  });
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(`${command} exited with ${code}: ${stderr || stdout}`));
    });
  });
}
