import { spawn } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
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
const browserWorkerBundlePath = path.join(serverCacheDir, "browser-worker.cjs");
const browserWorkerBidiShim = path.join(tauriRoot, "src/sidecar/playwright-bidi-shim.mjs");
const browserWorkerFseventsShim = path.join(tauriRoot, "src/sidecar/playwright-fsevents-shim.mjs");
const serverBundlePath = path.join(serverCacheDir, "chat-server.cjs");
const sandboxBundlePath = path.join(serverCacheDir, "chat-server-sandbox.cjs");
const pkgCachePath = process.env.PKG_CACHE_PATH || path.join(root, ".cache/pkg");
const localBinExtension = process.platform === "win32" ? ".cmd" : "";
const localBinDir = path.join(desktopRoot, "node_modules/.bin");

const hostTriple = await readTargetTriple();
const targetTriple = process.env.TAURI_TARGET_TRIPLE || hostTriple;
const pkgTarget = toPkgTarget(targetTriple);
const browserWorkerSeaTarget = toPkgTarget(targetTriple, "node22.20.0");
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

await prepareBrowserWorkerBundle();

// CJS empties import.meta. browser-runtime.ts must not call fileURLToPath at
// load time; packaged paths come from CHAT_SERVER_BROWSER_WORKER / PLAYWRIGHT_*.
await runTool("esbuild", [
  "apps/server/src/server.ts",
  "--bundle",
  "--platform=node",
  "--format=cjs",
  "--target=node22",
  "--log-override:empty-import-meta=silent",
  `--outfile=${serverBundlePath}`,
]);

const serverBundle = await readFile(serverBundlePath, "utf8");
if (/\brequire\(["']sharp["']\)/.test(serverBundle) || /\bfrom ["']sharp["']/.test(serverBundle)) {
  throw new Error("chat-server bundle must not statically require sharp");
}

await writeFile(
  path.join(serverCacheDir, "package.json"),
  `${JSON.stringify(
    {
      name: "chatdesk-chat-server-bundle",
      private: true,
    },
    null,
    2,
  )}\n`,
);

await copySharpNative();

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
    "undici",
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
    browserWorkerBundlePath,
    "--sea",
    "--target",
    browserWorkerSeaTarget,
    "--output",
    path.join(resourcesDir, `browser-worker${extension}`),
  ],
  {
    PLAYWRIGHT_BROWSERS_PATH: browserPath,
    PKG_CACHE_PATH: pkgCachePath,
  },
);

console.log(`Built sidecars for ${targetTriple} (${pkgTarget})`);

async function prepareBrowserWorkerBundle() {
  const requireFromDesktop = createRequire(path.join(desktopRoot, "package.json"));
  const { build } = requireFromDesktop("esbuild");
  const playwrightCorePackage = realpathSync(
    requireFromDesktop.resolve("playwright-core/package.json"),
  );
  const playwrightCoreRoot = path.dirname(playwrightCorePackage);
  const playwrightCoreBundle = path.join(playwrightCoreRoot, "lib/coreBundle.js");
  const browsersJson = realpathSync(path.join(playwrightCoreRoot, "browsers.json"));
  const [packageMetadata, browserMetadata] = await Promise.all([
    readJson(playwrightCorePackage),
    readJson(browsersJson),
  ]);
  await build({
    absWorkingDir: root,
    alias: {
      "chromium-bidi/lib/cjs/bidiMapper/BidiMapper": browserWorkerBidiShim,
      "chromium-bidi/lib/cjs/cdp/CdpConnection": browserWorkerBidiShim,
      fsevents: browserWorkerFseventsShim,
    },
    bundle: true,
    entryPoints: ["apps/desktop/src-tauri/src/sidecar/browser-worker.mjs"],
    format: "cjs",
    logLevel: "info",
    outfile: browserWorkerBundlePath,
    platform: "node",
    plugins: [
      {
        name: "playwright-sea-metadata",
        setup(context) {
          context.onLoad({ filter: /coreBundle\.js$/ }, async (args) => {
            if (realpathSync(args.path) !== playwrightCoreBundle) return undefined;
            let contents = await readFile(args.path, "utf8");
            contents = replaceOnce(
              contents,
              'require(import_path9.default.join(packageRoot, "package.json"))',
              `(${JSON.stringify(packageMetadata)})`,
            );
            contents = replaceOnce(
              contents,
              'require(import_path20.default.join(packageRoot, "browsers.json"))',
              `(${JSON.stringify(browserMetadata)})`,
            );
            return { contents, loader: "js" };
          });
        },
      },
    ],
    target: "node22",
  });
}

async function readJson(filename) {
  return JSON.parse(await readFile(filename, "utf8"));
}

function replaceOnce(contents, search, replacement) {
  const index = contents.indexOf(search);
  if (index === -1) {
    throw new Error(`Unable to patch Playwright bundle expression: ${search}`);
  }
  if (contents.indexOf(search, index + search.length) !== -1) {
    throw new Error(`Playwright bundle expression is not unique: ${search}`);
  }
  return `${contents.slice(0, index)}${replacement}${contents.slice(index + search.length)}`;
}

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

function toPkgTarget(triple, nodeRange = "node22") {
  const targets = {
    "x86_64-apple-darwin": `${nodeRange}-macos-x64`,
    "aarch64-apple-darwin": `${nodeRange}-macos-arm64`,
    "x86_64-pc-windows-msvc": `${nodeRange}-win-x64`,
    "aarch64-pc-windows-msvc": `${nodeRange}-win-arm64`,
    "x86_64-unknown-linux-gnu": `${nodeRange}-linux-x64`,
    "aarch64-unknown-linux-gnu": `${nodeRange}-linux-arm64`,
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
