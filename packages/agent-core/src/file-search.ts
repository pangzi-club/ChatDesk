import { execFile } from "node:child_process";
import { type Dirent, realpathSync } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const MAX_FILE_BYTES = 512 * 1024;
export const MAX_SEARCH_RESULTS = 100;
const MAX_SEARCH_OUTPUT_BYTES = 32 * 1024 * 1024;
const MAX_SEARCH_RESULT_BYTES = 64 * 1024;
const SKIPPED_DIRECTORIES = new Set([".git", "node_modules", "target", "dist"]);
const execFileAsync = promisify(execFile);

export type FileSearchOptions = {
  pattern?: string;
  query?: string;
  include?: string;
  regex?: boolean;
  maxResults?: number;
};

export type FileSearchResult = {
  query?: string;
  pattern?: string;
  matches: string[];
  contentMatches?: Array<{
    path: string;
    line: number;
    column: number;
    preview: string;
  }>;
  truncated: boolean;
  engine: "ripgrep" | "builtin";
};

export type WorkspacePathSuggestion = {
  path: string;
  kind: "dir" | "file";
};

export type WorkspacePathSuggestionResult = {
  suggestions: WorkspacePathSuggestion[];
  truncated: boolean;
};

function boundSearchResult(result: FileSearchResult): FileSearchResult {
  const next = {
    ...result,
    matches: [...result.matches],
    ...(result.contentMatches ? { contentMatches: [...result.contentMatches] } : {}),
  };
  while (
    Buffer.byteLength(JSON.stringify(next)) > MAX_SEARCH_RESULT_BYTES &&
    (next.contentMatches?.length || next.matches.length)
  ) {
    if ((next.contentMatches?.length ?? 0) >= next.matches.length) next.contentMatches?.pop();
    else next.matches.pop();
    next.truncated = true;
  }
  if (next.contentMatches) {
    const visiblePaths = new Set(next.contentMatches.map((item) => item.path));
    next.matches = next.matches.filter((item) => visiblePaths.has(item));
  }
  return next;
}

function displayPath(root: string, target: string) {
  const relative = path.relative(root, target);
  return relative && !relative.startsWith("..") && !path.isAbsolute(relative) ? relative : target;
}

function normalizeDisplayPath(root: string, value: string) {
  return displayPath(root, path.resolve(root, value)).split(path.sep).join("/");
}

function globRegex(pattern: string) {
  let source = "^";
  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index];
    if (character === "*") {
      if (pattern[index + 1] === "*") {
        index += 1;
        if (pattern[index + 1] === "/") {
          index += 1;
          source += "(?:.*/)?";
        } else {
          source += ".*";
        }
      } else {
        source += "[^/]*";
      }
      continue;
    }
    if (character === "?") {
      source += "[^/]";
      continue;
    }
    source += /[\\^$+.()|{}[\]]/.test(character) ? `\\${character}` : character;
  }
  return new RegExp(`${source}$`, "i");
}

function matchesPattern(root: string, target: string, pattern: string | undefined) {
  if (!pattern) return true;
  const normalizedPattern = pattern.replaceAll("\\", "/");
  const candidate = normalizedPattern.includes("/")
    ? displayPath(root, target).split(path.sep).join("/")
    : path.basename(target);
  return globRegex(normalizedPattern).test(candidate);
}

function matchesAnyPattern(root: string, target: string, patterns: Array<string | undefined>) {
  return patterns.filter(Boolean).every((pattern) => matchesPattern(root, target, pattern));
}

async function executeRipgrep(root: string, args: string[]) {
  try {
    return (
      await execFileAsync("rg", args, {
        cwd: root,
        timeout: 30_000,
        maxBuffer: MAX_SEARCH_OUTPUT_BYTES,
      })
    ).stdout;
  } catch (error) {
    const failure = error as { code?: unknown; stdout?: string };
    if (failure.code === 1 || failure.code === "1") return failure.stdout ?? "";
    return undefined;
  }
}

async function runRipgrep(root: string, start: string, options: FileSearchOptions) {
  const query = options.query?.trim();
  const pattern = options.pattern?.trim();
  const relativeStart = path.relative(root, start);
  const searchPath = relativeStart && !relativeStart.startsWith("..") ? relativeStart : start;
  const commonArgs = [
    "--hidden",
    "--no-messages",
    "--glob",
    "!.git/**",
    "--glob",
    "!node_modules/**",
    "--glob",
    "!target/**",
    "--glob",
    "!dist/**",
    ...(pattern ? ["--iglob", pattern] : []),
    ...(options.include ? ["--iglob", options.include] : []),
  ];
  const args = query
    ? [
        "--json",
        "--ignore-case",
        ...(options.regex ? [] : ["--fixed-strings"]),
        "--max-count",
        "1",
        "--max-filesize",
        String(MAX_FILE_BYTES),
        ...commonArgs,
        "--",
        query,
        searchPath || ".",
      ]
    : ["--files", "--null", ...commonArgs, "--", searchPath || "."];
  const stdout = await executeRipgrep(root, args);
  if (stdout === undefined) return undefined;

  if (!query) {
    return stdout
      .split("\0")
      .filter(Boolean)
      .map((file) => normalizeDisplayPath(root, file));
  }

  const contentMatches: NonNullable<FileSearchResult["contentMatches"]> = [];
  for (const line of stdout.split(/\r?\n/)) {
    if (!line) continue;
    try {
      const event = JSON.parse(line) as {
        type?: string;
        data?: {
          path?: { text?: string };
          lines?: { text?: string };
          line_number?: number;
          submatches?: Array<{ start?: number }>;
        };
      };
      if (event.type !== "match" || !event.data?.path?.text) continue;
      contentMatches.push({
        path: normalizeDisplayPath(root, event.data.path.text),
        line: event.data.line_number ?? 1,
        column: (event.data.submatches?.[0]?.start ?? 0) + 1,
        preview: (event.data.lines?.text ?? "").trimEnd().slice(0, 500),
      });
    } catch {
      // Ignore malformed diagnostics while preserving valid results.
    }
  }
  return contentMatches;
}

async function listGitFiles(root: string, start: string): Promise<string[] | null> {
  try {
    const { stdout: topLevelOutput } = await execFileAsync(
      "git",
      ["-C", root, "rev-parse", "--show-toplevel"],
      { cwd: root, timeout: 3_000, maxBuffer: 1024 * 1024 },
    );
    const gitRoot = realpathSync(topLevelOutput.trim());
    const relativeStart = path.relative(gitRoot, start) || ".";
    const { stdout } = await execFileAsync(
      "git",
      [
        "-C",
        gitRoot,
        "ls-files",
        "--cached",
        "--others",
        "--exclude-standard",
        "-z",
        "--",
        relativeStart,
      ],
      { cwd: gitRoot, timeout: 10_000, maxBuffer: MAX_SEARCH_OUTPUT_BYTES },
    );
    return stdout
      .split("\0")
      .filter(Boolean)
      .map((file) => path.resolve(gitRoot, file))
      .filter(
        (file) =>
          (file === root || file.startsWith(`${root}${path.sep}`)) &&
          (start === root || file === start || file.startsWith(`${start}${path.sep}`)),
      );
  } catch {
    return null;
  }
}

async function builtinSearch(root: string, start: string, options: FileSearchOptions) {
  const query = options.query?.trim().toLowerCase();
  const contentMatches: NonNullable<FileSearchResult["contentMatches"]> = [];
  const candidates: string[] = [];
  const startMetadata = await stat(start);
  if (startMetadata.isFile()) {
    candidates.push(start);
  } else {
    const gitFiles = await listGitFiles(root, start);
    if (gitFiles !== null) {
      candidates.push(...gitFiles);
    } else {
      const visit = async (directory: string): Promise<void> => {
        let entries: Dirent[];
        try {
          entries = await readdir(directory, { withFileTypes: true });
        } catch {
          return;
        }
        for (const entry of entries) {
          const target = path.join(directory, entry.name);
          if (entry.isDirectory()) {
            if (!SKIPPED_DIRECTORIES.has(entry.name)) await visit(target);
          } else if (entry.isFile()) {
            candidates.push(target);
          }
        }
      };
      await visit(start);
    }
  }

  const matches: string[] = [];
  for (const target of candidates) {
    if (!matchesAnyPattern(root, target, [options.pattern?.trim(), options.include?.trim()]))
      continue;
    try {
      const metadata = await stat(target);
      if (!metadata.isFile() || metadata.size > MAX_FILE_BYTES) continue;
      if (query) {
        const content = await readFile(target);
        if (content.includes(0)) continue;
        const lines = content.toString("utf8").split(/\r?\n/);
        const matcher = options.regex ? new RegExp(options.query ?? "", "i") : undefined;
        const lineIndex = lines.findIndex((line) =>
          matcher ? matcher.test(line) : line.toLowerCase().includes(query),
        );
        if (lineIndex < 0) continue;
        const preview = lines[lineIndex].slice(0, 500);
        contentMatches.push({
          path: displayPath(root, target).split(path.sep).join("/"),
          line: lineIndex + 1,
          column: preview.toLowerCase().indexOf(query) + 1,
          preview,
        });
      }
      matches.push(displayPath(root, target).split(path.sep).join("/"));
    } catch {
      // A single unreadable or concurrently deleted file must not fail the search.
    }
  }
  return { matches, contentMatches };
}

export async function searchWorkspaceFiles(
  root: string,
  start: string,
  options: FileSearchOptions,
): Promise<FileSearchResult> {
  const canonicalRoot = realpathSync(root);
  const canonicalStart = realpathSync(start);
  const limit = Math.min(Math.max(options.maxResults ?? 100, 1), MAX_SEARCH_RESULTS);
  const hasQuery = Boolean(options.query?.trim());
  const ripgrep = await runRipgrep(canonicalRoot, canonicalStart, options);
  if (ripgrep) {
    const contentMatches = hasQuery
      ? (ripgrep as NonNullable<FileSearchResult["contentMatches"]>)
      : undefined;
    contentMatches?.sort(
      (left, right) =>
        left.path.localeCompare(right.path) || left.line - right.line || left.column - right.column,
    );
    const allMatches = contentMatches
      ? [...new Set(contentMatches.map((item) => item.path))]
      : (ripgrep as string[]).sort((left, right) => left.localeCompare(right));
    return boundSearchResult({
      query: options.query?.trim() || undefined,
      pattern: options.pattern?.trim() || undefined,
      matches: allMatches.slice(0, limit),
      ...(contentMatches ? { contentMatches: contentMatches.slice(0, limit) } : {}),
      truncated: allMatches.length > limit,
      engine: "ripgrep",
    });
  }

  const fallback = await builtinSearch(canonicalRoot, canonicalStart, options);
  fallback.matches.sort((left, right) => left.localeCompare(right));
  fallback.contentMatches.sort(
    (left, right) =>
      left.path.localeCompare(right.path) || left.line - right.line || left.column - right.column,
  );
  return boundSearchResult({
    query: options.query?.trim() || undefined,
    pattern: options.pattern?.trim() || undefined,
    matches: fallback.matches.slice(0, limit),
    ...(hasQuery ? { contentMatches: fallback.contentMatches.slice(0, limit) } : {}),
    truncated: fallback.matches.length > limit,
    engine: "builtin",
  });
}

async function listVisibleFiles(root: string): Promise<string[]> {
  const ripgrep = await runRipgrep(root, root, {});
  if (ripgrep) return ripgrep as string[];
  const gitFiles = await listGitFiles(root, root);
  if (gitFiles) return gitFiles.map((file) => normalizeDisplayPath(root, file));

  const files: string[] = [];
  const visit = async (directory: string): Promise<void> => {
    let entries: Dirent[];
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (!SKIPPED_DIRECTORIES.has(entry.name)) await visit(target);
      } else if (entry.isFile()) {
        files.push(normalizeDisplayPath(root, target));
      }
    }
  };
  await visit(root);
  return files;
}

export async function suggestWorkspacePaths(
  root: string,
  query: string,
  maxResults = 20,
): Promise<WorkspacePathSuggestionResult> {
  const canonicalRoot = realpathSync(root);
  const normalizedQuery = query.trim().replaceAll("\\", "/").replace(/^\.\//, "").toLowerCase();
  const files = await listVisibleFiles(canonicalRoot);
  const suggestions = new Map<string, WorkspacePathSuggestion>();
  for (const file of files) {
    const normalizedFile = file.toLowerCase();
    const basename = normalizedFile.slice(normalizedFile.lastIndexOf("/") + 1);
    if (!normalizedFile.startsWith(normalizedQuery) && !basename.startsWith(normalizedQuery))
      continue;
    suggestions.set(file, { path: file, kind: "file" });
    const segments = file.split("/");
    for (let index = 1; index < segments.length; index += 1) {
      const directory = segments.slice(0, index).join("/");
      const directoryName = directory.slice(directory.lastIndexOf("/") + 1).toLowerCase();
      if (
        directory.toLowerCase().startsWith(normalizedQuery) ||
        directoryName.startsWith(normalizedQuery)
      ) {
        suggestions.set(directory, { path: directory, kind: "dir" });
      }
    }
  }
  const sorted = [...suggestions.values()].sort(
    (left, right) =>
      Number(left.kind === "dir") - Number(right.kind === "dir") ||
      left.path.localeCompare(right.path),
  );
  const limit = Math.min(Math.max(maxResults, 1), 20);
  return { suggestions: sorted.slice(0, limit), truncated: sorted.length > limit };
}
