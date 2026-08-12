import { existsSync, realpathSync } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

const MAX_FILE_BYTES = 512 * 1024;
const MAX_SEARCH_RESULTS = 500;
const SKIPPED_DIRECTORIES = new Set([".git", "target", "dist"]);

type Request = {
  operation: "list_dir" | "read_file" | "search_files";
  workspace: string;
  path?: string;
  pattern?: string;
  query?: string;
  maxResults?: number;
  readablePaths?: string[];
};

function canonicalize(target: string) {
  const missing: string[] = [];
  let existing = target;
  while (!existsSync(existing)) {
    const parent = path.dirname(existing);
    if (parent === existing) break;
    missing.unshift(path.basename(existing));
    existing = parent;
  }
  return path.resolve(realpathSync(existing), ...missing);
}

function targetPath(request: Request) {
  const root = realpathSync(request.workspace);
  const value = request.path?.trim() || ".";
  return { root, target: canonicalize(path.isAbsolute(value) ? value : path.resolve(root, value)) };
}

function displayPath(root: string, target: string) {
  const relative = path.relative(root, target);
  return relative && !relative.startsWith("..") && !path.isAbsolute(relative) ? relative : target;
}

async function listDirectory(request: Request) {
  const { root, target } = targetPath(request);
  const entries = await readdir(target, { withFileTypes: true });
  return {
    path: displayPath(root, target),
    entries: entries
      .filter((entry) => !SKIPPED_DIRECTORIES.has(entry.name))
      .map((entry) => ({
        name: entry.name,
        path: displayPath(root, path.join(target, entry.name)),
        kind: entry.isDirectory() ? "dir" : entry.isFile() ? "file" : "other",
      }))
      .sort((a, b) => a.path.localeCompare(b.path)),
  };
}

async function readTextFile(request: Request) {
  const { root, target } = targetPath(request);
  const metadata = await stat(target);
  if (!metadata.isFile()) throw new Error("路径不是文件");
  if (metadata.size > MAX_FILE_BYTES) throw new Error("文件超过 512 KB，未读取");
  return { path: displayPath(root, target), content: await readFile(target, "utf8") };
}

async function searchFiles(request: Request) {
  const { root, target: start } = targetPath(request);
  const limit = Math.min(Math.max(request.maxResults ?? 100, 1), MAX_SEARCH_RESULTS);
  const pattern = request.pattern?.trim();
  const needle = request.query?.trim().toLowerCase();
  const matches: string[] = [];
  const matchesName = (file: string) =>
    !pattern ||
    new RegExp(`^${pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$$`, "i").test(
      path.basename(file),
    );
  const visit = async (directory: string): Promise<void> => {
    if (matches.length >= limit) return;
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (matches.length >= limit) return;
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (!SKIPPED_DIRECTORIES.has(entry.name)) await visit(target);
        continue;
      }
      if (!entry.isFile() || !matchesName(target)) continue;
      const metadata = await stat(target);
      if (metadata.size > MAX_FILE_BYTES) continue;
      if (needle && !(await readFile(target, "utf8")).toLowerCase().includes(needle)) continue;
      matches.push(displayPath(root, target));
    }
  };
  await visit(start);
  return { query: needle || undefined, pattern, matches, truncated: matches.length >= limit };
}

async function main() {
  const input = await new Promise<string>((resolve, reject) => {
    let value = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => (value += chunk));
    process.stdin.once("end", () => resolve(value));
    process.stdin.once("error", reject);
  });
  const request = JSON.parse(input) as Request;
  const result =
    request.operation === "list_dir"
      ? await listDirectory(request)
      : request.operation === "read_file"
        ? await readTextFile(request)
        : await searchFiles(request);
  process.stdout.write(JSON.stringify({ ok: true, result }));
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  const blocked = /(?:operation not permitted|sandbox|deny|permission denied)/i.test(message);
  process.stdout.write(JSON.stringify({ ok: false, blocked, error: message }));
  process.exitCode = 1;
});
