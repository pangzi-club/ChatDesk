import { spawn } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { chmod, cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const NODE_RUNTIME_VERSION = "v22.20.0";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const desktopRoot = path.join(root, "apps/desktop");
const tauriRoot = path.join(root, "apps/tauri/src-tauri");
const binariesDir = path.join(tauriRoot, "binaries");
const resourcesDir = path.join(tauriRoot, "resources");
const runtimeRoot = path.join(resourcesDir, "node-runtime");
const runtimeWorkersDir = path.join(runtimeRoot, "workers");
const runtimeModulesDir = path.join(runtimeRoot, "node_modules");
const browserPath = path.join(resourcesDir, "playwright-browsers");
const browserWorkerSource = path.join(tauriRoot, "src/sidecar/browser-worker.mjs");
const serverBundlePath = path.join(runtimeWorkersDir, "chat-server.cjs");
const sandboxBundlePath = path.join(runtimeWorkersDir, "chat-server-sandbox.cjs");
const browserWorkerPath = path.join(runtimeWorkersDir, "browser-worker.mjs");
const localBinExtension = process.platform === "win32" ? ".cmd" : "";
const localBinDir = path.join(desktopRoot, "node_modules/.bin");

const hostTriple = process.env.DESKTOP_HOST_TRIPLE || platformTargetTriple();
const targetTriple = process.env.DESKTOP_TARGET_TRIPLE || hostTriple;
const extension = process.platform === "win32" ? ".exe" : "";
const nodeRuntimePath = path.join(binariesDir, `node-runtime-${targetTriple}${extension}`);

assertNativeTarget(hostTriple, targetTriple);
assertNodeRuntimeVersion();
assertTool("playwright");
assertTool("esbuild");

await rm(runtimeRoot, { recursive: true, force: true });
await rm(nodeRuntimePath, { force: true });
await Promise.all([
  rm(path.join(resourcesDir, "browser-worker"), { force: true }),
  rm(path.join(resourcesDir, "browser-worker.exe"), { force: true }),
  rm(path.join(resourcesDir, "sharp-node-modules"), { recursive: true, force: true }),
  rm(path.join(binariesDir, `chat-server-${targetTriple}${extension}`), { force: true }),
  rm(path.join(binariesDir, `chat-server-sandbox-${targetTriple}${extension}`), { force: true }),
]);
await Promise.all([
  mkdir(binariesDir, { recursive: true }),
  mkdir(runtimeWorkersDir, { recursive: true }),
  mkdir(runtimeModulesDir, { recursive: true }),
  mkdir(path.join(runtimeRoot, "licenses"), { recursive: true }),
  mkdir(browserPath, { recursive: true }),
]);

await copyNodeRuntime();
await writeFile(
  path.join(runtimeRoot, "package.json"),
  `${JSON.stringify({ name: "chatdesk-node-runtime", private: true, type: "module" }, null, 2)}\n`,
);
await cp(browserWorkerSource, browserWorkerPath);

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
  "--log-override:empty-import-meta=silent",
  `--outfile=${serverBundlePath}`,
]);

const serverBundle = await readFile(serverBundlePath, "utf8");
if (/\brequire\(["']sharp["']\)/.test(serverBundle) || /\bfrom ["']sharp["']/.test(serverBundle)) {
  throw new Error("chat-server bundle must not statically require sharp");
}

await runTool("esbuild", [
  "apps/server/src/sandbox-file-entry.ts",
  "--bundle",
  "--platform=node",
  "--format=cjs",
  "--target=node22",
  `--outfile=${sandboxBundlePath}`,
]);

const copiedPackages = new Map();
await copyRuntimeDependency("playwright", createRequire(path.join(desktopRoot, "package.json")));
await copyRuntimeDependency("sharp", createRequire(path.join(root, "apps/server/package.json")));
await verifyRuntimeDependencies();

console.log(`Built shared Node runtime for ${targetTriple} (${process.version})`);

async function copyNodeRuntime() {
  const executable = realpathSync(process.execPath);
  await cp(executable, nodeRuntimePath);
  if (process.platform !== "win32") await chmod(nodeRuntimePath, 0o755);
  const license = findNodeLicense(executable);
  await cp(license, path.join(runtimeRoot, "licenses/node-LICENSE"));
}

function findNodeLicense(executable) {
  const executableDir = path.dirname(executable);
  const candidates = [
    path.join(executableDir, "LICENSE"),
    path.resolve(executableDir, "../LICENSE"),
    path.resolve(executableDir, "../../LICENSE"),
  ];
  const license = candidates.find((candidate) => existsSync(candidate));
  if (!license) {
    throw new Error(`Cannot locate the Node.js LICENSE next to ${executable}`);
  }
  return license;
}

async function copyRuntimeDependency(name, requireFrom, optional = false, issuerRoot) {
  let packageRoot;
  try {
    packageRoot = findPackageRoot(realpathSync(requireFrom.resolve(name)));
  } catch (error) {
    packageRoot = issuerRoot ? findInstalledDependency(issuerRoot, name) : undefined;
    if (!packageRoot) {
      if (optional) return;
      throw new Error(
        `Cannot resolve runtime dependency ${name}: ${error instanceof Error ? error.message : error}`,
      );
    }
  }

  const packageJsonPath = path.join(packageRoot, "package.json");
  const metadata = JSON.parse(await readFile(packageJsonPath, "utf8"));
  const packageName = metadata.name || name;
  const version = metadata.version || "unknown";
  const copiedVersion = copiedPackages.get(packageName);
  if (copiedVersion) {
    if (copiedVersion !== version) {
      throw new Error(
        `Runtime dependency version conflict for ${packageName}: ${copiedVersion} and ${version}`,
      );
    }
    return;
  }
  copiedPackages.set(packageName, version);

  const destination = path.join(runtimeModulesDir, ...packageName.split("/"));
  await mkdir(path.dirname(destination), { recursive: true });
  await cp(packageRoot, destination, {
    recursive: true,
    dereference: true,
    filter(source) {
      return source === packageRoot || path.basename(source) !== "node_modules";
    },
  });

  const dependencyRequire = createRequire(packageJsonPath);
  for (const dependency of Object.keys(metadata.dependencies || {})) {
    await copyRuntimeDependency(dependency, dependencyRequire, false, packageRoot);
  }
  for (const dependency of Object.keys(metadata.optionalDependencies || {})) {
    await copyRuntimeDependency(dependency, dependencyRequire, true, packageRoot);
  }
}

function findInstalledDependency(issuerRoot, name) {
  let current = issuerRoot;
  const parts = name.split("/");
  while (true) {
    const candidates = [
      path.join(current, "node_modules", ...parts),
      ...(path.basename(current) === "node_modules" ? [path.join(current, ...parts)] : []),
    ];
    const installed = candidates.find((candidate) =>
      existsSync(path.join(candidate, "package.json")),
    );
    if (installed) return realpathSync(installed);
    const parent = path.dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

function findPackageRoot(entry) {
  let current = path.dirname(entry);
  while (true) {
    if (existsSync(path.join(current, "package.json"))) return current;
    const parent = path.dirname(current);
    if (parent === current) throw new Error(`Cannot find package root for ${entry}`);
    current = parent;
  }
}

async function verifyRuntimeDependencies() {
  await run(nodeRuntimePath, ["-e", 'require("playwright"); require("sharp")'], undefined, {
    cwd: runtimeRoot,
  });
  console.log(
    `Verified runtime dependencies: ${[...copiedPackages.entries()]
      .map(([name, version]) => `${name}@${version}`)
      .join(", ")}`,
  );
}

function platformTargetTriple() {
  if (process.platform === "darwin") {
    return process.arch === "arm64" ? "aarch64-apple-darwin" : "x86_64-apple-darwin";
  }
  if (process.platform === "win32") {
    return process.arch === "arm64" ? "aarch64-pc-windows-msvc" : "x86_64-pc-windows-msvc";
  }
  if (process.platform === "linux") {
    return process.arch === "arm64" ? "aarch64-unknown-linux-gnu" : "x86_64-unknown-linux-gnu";
  }
  throw new Error(`Unsupported desktop target: ${process.platform}/${process.arch}`);
}

function assertNativeTarget(host, target) {
  if (host !== target) {
    throw new Error(
      `Shared Node runtime builds must be native: host is ${host}, requested target is ${target}`,
    );
  }
}

function assertNodeRuntimeVersion() {
  if (process.version !== NODE_RUNTIME_VERSION) {
    throw new Error(
      `Shared Node runtime requires ${NODE_RUNTIME_VERSION}, current process is ${process.version}`,
    );
  }
}

function assertTool(name) {
  const binary = path.join(localBinDir, `${name}${localBinExtension}`);
  if (!existsSync(binary)) {
    throw new Error(
      `Missing ${name} executable. Install workspace dependencies before building sidecars.`,
    );
  }
}

async function run(command, args, env, options = {}) {
  const result = await execFileWithEnv(command, args, env, options);
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

function execFileWithEnv(command, args, extraEnv, options = {}) {
  const child = spawn(command, args, {
    cwd: options.cwd || root,
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
