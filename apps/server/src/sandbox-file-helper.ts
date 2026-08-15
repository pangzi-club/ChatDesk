import { existsSync, realpathSync } from "node:fs";
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { readTextFileRange } from "./file-read.ts";
import { searchWorkspaceFiles } from "./file-search.ts";

const SKIPPED_DIRECTORIES = new Set([".git", "node_modules", "target", "dist"]);

type Request =
  | {
      operation: "list_dir";
      workspace: string;
      path?: string;
      readablePaths?: string[];
    }
  | {
      operation: "read_file";
      workspace: string;
      path: string;
      startLine?: number;
      endLine?: number;
      readablePaths?: string[];
    }
  | {
      operation: "search_files";
      workspace: string;
      path?: string;
      pattern?: string;
      query?: string;
      maxResults?: number;
      readablePaths?: string[];
      developerToolPaths?: string[];
    }
  | {
      operation: "write_file";
      workspace: string;
      path: string;
      content: string;
      allowOutside?: boolean;
    }
  | {
      operation: "edit_file";
      workspace: string;
      path: string;
      oldText: string;
      newText: string;
      allowOutside?: boolean;
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

function writeTargetPath(request: Extract<Request, { operation: "write_file" | "edit_file" }>) {
  const { root, target } = targetPath(request);
  if (!request.allowOutside && target !== root && !target.startsWith(`${root}${path.sep}`)) {
    throw new Error("写入路径必须位于 workspace 内");
  }
  return { root, target };
}

async function listDirectory(request: Extract<Request, { operation: "list_dir" }>) {
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

async function readTextFile(request: Extract<Request, { operation: "read_file" }>) {
  const { root, target } = targetPath(request);
  return readTextFileRange(target, displayPath(root, target), request);
}

async function searchFiles(request: Extract<Request, { operation: "search_files" }>) {
  const { root, target: start } = targetPath(request);
  return searchWorkspaceFiles(root, start, request);
}

async function writeTextFile(request: Extract<Request, { operation: "write_file" }>) {
  const { root, target } = writeTargetPath(request);
  await writeFile(target, request.content, "utf8");
  return { path: displayPath(root, target), bytes: Buffer.byteLength(request.content) };
}

async function editTextFile(request: Extract<Request, { operation: "edit_file" }>) {
  const { root, target } = writeTargetPath(request);
  const content = await readFile(target, "utf8");
  const count = content.split(request.oldText).length - 1;
  if (count !== 1) {
    throw new Error(count === 0 ? "未找到要替换的文本" : "oldText 必须只匹配一次");
  }
  await writeFile(target, content.replace(request.oldText, request.newText), "utf8");
  return { path: displayPath(root, target), changed: true };
}

export async function runSandboxFileHelper() {
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
        : request.operation === "search_files"
          ? await searchFiles(request)
          : request.operation === "write_file"
            ? await writeTextFile(request)
            : await editTextFile(request);
  process.stdout.write(JSON.stringify({ ok: true, result }));
}
