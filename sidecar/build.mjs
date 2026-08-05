import { chmod, copyFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const target = process.env.TAURI_ENV_TARGET_TRIPLE ?? "x86_64-apple-darwin";
const output = resolve(root, "src-tauri", "binaries", `assistant-sidecar-${target}`);
await mkdir(dirname(output), { recursive: true });
await copyFile(resolve(root, "sidecar", "index.mjs"), output);
await chmod(output, 0o755);
console.log(`Prepared sidecar entrypoint at ${output}`);
