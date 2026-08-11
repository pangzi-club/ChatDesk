import { readdir, readFile, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const MAX_SKILL_FILE_BYTES = 512 * 1024;

export type ServerSkill = {
  id: string;
  name: string;
  description: string;
  source: string;
  path: string;
  content: string;
};

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

export async function scanSkills() {
  const home = os.homedir();
  const cwd = process.cwd();
  const roots = [
    ["agents", path.join(home, ".agents/skills")],
    ["agent", path.join(home, ".agent/skills")],
    ["codex", path.join(home, ".codex/skills")],
    ["claude", path.join(home, ".claude/skills")],
    ["workspace-agents", path.join(cwd, ".agents/skills")],
    ["workspace-agent", path.join(cwd, ".agent/skills")],
    ["workspace-codex", path.join(cwd, ".codex/skills")],
    ["workspace-claude", path.join(cwd, ".claude/skills")],
  ] as const;
  const values: Array<ServerSkill | null> = [];
  for (const [source, root] of roots) {
    const files = await skillFiles(root);
    values.push(...(await Promise.all(files.map((file) => parseSkill(file, source)))));
  }
  const seen = new Set<string>();
  return values
    .filter((item): item is ServerSkill => {
      if (!item || seen.has(item.path)) return false;
      seen.add(item.path);
      return true;
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}
