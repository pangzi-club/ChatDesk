import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const preloadPath = path.join(repositoryRoot, "apps/electron/dist/preload.cjs");
const preload = await readFile(preloadPath, "utf8");
const relativeRequire = /require\(["']\.\.?\//;

if (relativeRequire.test(preload)) {
  throw new Error(
    "Electron sandboxed preload must be self-contained and cannot require relative modules",
  );
}

console.log("Verified sandboxed Electron preload is self-contained");
