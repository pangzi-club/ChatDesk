import { existsSync } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MAX_SKILL_FILE_BYTES = 512 * 1024;

export const BUILTIN_SKILL_SOURCE = "builtin";

export type ServerSkill = {
  id: string;
  name: string;
  description: string;
  source: string;
  path: string;
  content: string;
};

export type BuiltinSkillsResolveOptions = {
  env?: NodeJS.ProcessEnv;
  argv1?: string;
  cwd?: string;
  exists?: (file: string) => boolean;
  sourceDir?: string | undefined;
  homeDir?: string;
};

function chatServerSourceDir(): string | undefined {
  try {
    const url = import.meta.url;
    if (typeof url === "string" && url.length > 0) {
      return path.dirname(fileURLToPath(url));
    }
  } catch {
    // Empty import.meta in the CJS sidecar bundle.
  }
  return undefined;
}

function uniquePaths(values: Array<string | undefined>) {
  const seen = new Set<string>();
  const paths: string[] = [];
  for (const value of values) {
    if (!value?.trim()) continue;
    const resolved = path.resolve(value.trim());
    if (seen.has(resolved)) continue;
    seen.add(resolved);
    paths.push(resolved);
  }
  return paths;
}

export function resolveBuiltinSkillsRoot(options: BuiltinSkillsResolveOptions = {}) {
  const env = options.env ?? process.env;
  const argv1 = options.argv1 ?? process.argv[1];
  const cwd = options.cwd ?? process.cwd();
  const exists = options.exists ?? existsSync;
  const sourceDir = options.sourceDir === undefined ? chatServerSourceDir() : options.sourceDir;
  const candidates = uniquePaths([
    env.CHATDESK_BUILTIN_SKILLS_DIR,
    argv1 ? path.join(path.dirname(argv1), "skills") : undefined,
    sourceDir ? path.resolve(sourceDir, "../skills") : undefined,
    path.resolve(cwd, "apps/server/skills"),
    path.resolve(cwd, "skills"),
  ]);
  return candidates.find((candidate) => exists(candidate));
}

function parseSkill(file: string, source: string): Promise<ServerSkill | null> {
  return Promise.all([stat(file), readFile(file, "utf8")])
    .then(([metadata, content]) => {
      if (!metadata.isFile() || metadata.size > MAX_SKILL_FILE_BYTES) return null;
      const directory = path.basename(path.dirname(file));
      let name = directory;
      let description = "";
      let frontmatter = false;
      for (const line of content.split(/\r?\n/).slice(0, 80)) {
        const trimmed = line.trim();
        if (trimmed === "---") {
          frontmatter = !frontmatter;
        } else if (frontmatter && trimmed.startsWith("name:")) {
          name =
            trimmed
              .slice(5)
              .trim()
              .replace(/^['"]|['"]$/g, "") || name;
        } else if (frontmatter && trimmed.startsWith("description:")) {
          description = trimmed
            .slice(12)
            .trim()
            .replace(/^['"]|['"]$/g, "");
        } else if (!frontmatter && name === directory && trimmed.startsWith("#")) {
          name = trimmed.replace(/^#+/, "").trim() || name;
        }
      }
      if (!description)
        description =
          content
            .split(/\r?\n/)
            .find((line) => line.trim() && !line.trim().startsWith("#"))
            ?.trim()
            .slice(0, 180) ?? "";
      return {
        id: `${source}:${directory.toLowerCase()}`,
        name,
        description,
        source,
        path: file,
        content,
      };
    })
    .catch(() => null);
}

async function skillFiles(root: string) {
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(root, entry.name, "SKILL.md"));
}

async function scanSkillRoot(source: string, root: string | undefined) {
  if (!root) return [];
  const files = await skillFiles(root);
  const values = await Promise.all(files.map((file) => parseSkill(file, source)));
  return values.filter((item): item is ServerSkill => Boolean(item));
}

function sortSkills(skills: ServerSkill[]) {
  return [...skills].sort((a, b) => a.name.localeCompare(b.name));
}

export async function scanBuiltinSkills(options: BuiltinSkillsResolveOptions = {}) {
  return sortSkills(await scanSkillRoot(BUILTIN_SKILL_SOURCE, resolveBuiltinSkillsRoot(options)));
}

export async function readBuiltinSkillFile(
  skillId: string,
  relativePath = "SKILL.md",
  options: BuiltinSkillsResolveOptions = {},
) {
  const prefix = `${BUILTIN_SKILL_SOURCE}:`;
  if (!skillId.startsWith(prefix)) {
    throw new Error("只能读取内置 skill");
  }
  const directory = skillId.slice(prefix.length).trim();
  if (
    !directory ||
    directory.includes("/") ||
    directory.includes("\\") ||
    directory === "." ||
    directory === ".."
  ) {
    throw new Error("无效的 skill id");
  }
  const root = resolveBuiltinSkillsRoot(options);
  if (!root) throw new Error("未找到内置 skill 目录");
  const requested = relativePath.trim() || "SKILL.md";
  if (path.isAbsolute(requested)) throw new Error("skill 文件路径必须是相对路径");
  const skillRoot = path.resolve(root, directory);
  const target = path.resolve(skillRoot, requested);
  if (target !== skillRoot && !target.startsWith(`${skillRoot}${path.sep}`)) {
    throw new Error("skill 文件必须位于该 skill 目录内");
  }
  const metadata = await stat(target).catch(() => null);
  if (!metadata?.isFile()) throw new Error("未找到 skill 文件");
  if (metadata.size > MAX_SKILL_FILE_BYTES) throw new Error("skill 文件过大");
  return {
    id: skillId,
    path: requested.split(path.sep).join("/"),
    content: await readFile(target, "utf8"),
  };
}

export async function scanSkills(options: BuiltinSkillsResolveOptions = {}) {
  const home = options.homeDir ?? os.homedir();
  const builtin = await scanBuiltinSkills(options);
  const local = await scanSkillRoot("agents", path.join(home, ".agents/skills"));
  return [...builtin, ...sortSkills(local)];
}
