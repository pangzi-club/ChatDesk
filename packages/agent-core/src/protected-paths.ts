import { existsSync, realpathSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const HOME_PROTECTED_PATHS = [
  ".ssh",
  ".gnupg",
  ".aws",
  ".azure",
  ".kube",
  ".docker",
  ".config/gcloud",
  ".config/gh",
  ".config/glab",
  ".local/share/keyrings",
  "Library/Keychains",
  ".netrc",
  ".npmrc",
  ".pypirc",
  ".git-credentials",
  ".terraform.d/credentials.tfrc.json",
  ".config/containers/auth.json",
] as const;

const WRITE_PROTECTED_COMPONENTS = new Set([".git", ".agents", ".codex"]);

export type ProtectedPathOperation = "read" | "write";

export class ProtectedPathError extends Error {
  readonly code = "protected_path" as const;
  readonly operation: ProtectedPathOperation;
  readonly rule: string;

  constructor(operation: ProtectedPathOperation, rule: string, message?: string) {
    super(message ?? `文件工具禁止${operation === "read" ? "读取" : "修改"}受保护路径：${rule}`);
    this.name = "ProtectedPathError";
    this.operation = operation;
    this.rule = rule;
  }
}

type ProtectedRoot = {
  comparablePath: string;
  label: string;
};

function canonicalize(target: string) {
  const missing: string[] = [];
  let existing = path.resolve(target);
  while (!existsSync(existing)) {
    const parent = path.dirname(existing);
    if (parent === existing) break;
    missing.unshift(path.basename(existing));
    existing = parent;
  }
  return path.resolve(realpathSync(existing), ...missing);
}

function comparable(target: string) {
  return path.normalize(path.resolve(target)).toLowerCase();
}

function isWithin(candidate: string, root: string) {
  return candidate === root || candidate.startsWith(`${root}${path.sep}`);
}

function pathCandidates(target: string) {
  const lexical = path.resolve(target);
  const candidates = [lexical];
  try {
    const canonical = canonicalize(lexical);
    if (comparable(canonical) !== comparable(lexical)) candidates.push(canonical);
  } catch {
    // The lexical path is still checked if its existing ancestor cannot be resolved.
  }
  return candidates;
}

function homeRoots(homeDirectory: string) {
  const roots = [path.resolve(homeDirectory)];
  try {
    const canonical = canonicalize(homeDirectory);
    if (comparable(canonical) !== comparable(homeDirectory)) roots.push(canonical);
  } catch {
    // os.homedir() normally exists; retain the lexical root if it cannot be resolved.
  }
  return roots;
}

function protectedHomeRoots(homeDirectory: string) {
  const roots: ProtectedRoot[] = [];
  const add = (protectedPath: string, label: string) => {
    const comparablePath = comparable(protectedPath);
    if (roots.some((item) => item.comparablePath === comparablePath)) return;
    roots.push({ comparablePath, label });
  };
  for (const homeRoot of homeRoots(homeDirectory)) {
    for (const relativePath of HOME_PROTECTED_PATHS) {
      const protectedPath = path.resolve(homeRoot, relativePath);
      const label = `~/${relativePath.split(path.sep).join("/")}`;
      add(protectedPath, label);
      try {
        add(canonicalize(protectedPath), label);
      } catch {
        // Non-existent protected paths are still covered by their lexical path.
      }
    }
  }
  return roots;
}

function matchProtectedRoot(target: string, roots: ProtectedRoot[]) {
  for (const candidate of pathCandidates(target)) {
    const comparableCandidate = comparable(candidate);
    const match = roots.find((root) => isWithin(comparableCandidate, root.comparablePath));
    if (match) return match;
  }
  return undefined;
}

function matchWriteProtectedComponent(target: string) {
  for (const candidate of pathCandidates(target)) {
    const component = path
      .normalize(candidate)
      .split(path.sep)
      .find((value) => WRITE_PROTECTED_COMPONENTS.has(value.toLowerCase()));
    if (component) return component.toLowerCase();
  }
  return undefined;
}

export function createProtectedPathPolicy(homeDirectory = os.homedir()) {
  const readRoots = protectedHomeRoots(homeDirectory);

  const readRule = (target: string) => matchProtectedRoot(target, readRoots)?.label;
  const writeRule = (target: string) => readRule(target) ?? matchWriteProtectedComponent(target);

  return {
    assertReadable(target: string) {
      const rule = readRule(target);
      if (rule) throw new ProtectedPathError("read", rule);
    },
    assertWritable(target: string) {
      const rule = writeRule(target);
      if (rule) throw new ProtectedPathError("write", rule);
    },
    isReadable(target: string) {
      return readRule(target) === undefined;
    },
    hasProtectedReadDescendant(target: string) {
      return pathCandidates(target).some((candidate) => {
        const comparableCandidate = comparable(candidate);
        return readRoots.some((root) => isWithin(root.comparablePath, comparableCandidate));
      });
    },
  };
}

export type ProtectedPathPolicy = ReturnType<typeof createProtectedPathPolicy>;

export const protectedPathPolicy = createProtectedPathPolicy();
