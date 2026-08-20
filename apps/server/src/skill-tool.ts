import { tool } from "ai";
import { z } from "zod";
import {
  type BuiltinSkillsResolveOptions,
  readBuiltinSkillFile,
  type ServerSkill,
  scanBuiltinSkills,
} from "./skills-store.ts";

export const SKILL_TOOL_NAME = "read_skill";

export function formatBuiltinSkillsCatalog(skills: ServerSkill[]) {
  if (skills.length === 0) return "";
  const entries = skills.map(
    (skill) => `- **${skill.name}** (\`${skill.id}\`): ${skill.description.trim()}`,
  );
  return [
    "## ChatDesk 内置 Skills",
    "这些 skill 的正文不会自动进入上下文。当用户问题匹配某条 description 时，先调用 read_skill 读取其 SKILL.md，需要细节再读取 SKILL.md 中列出的 references。不要凭记忆回答 ChatDesk 产品用法。",
    ...entries,
  ].join("\n\n");
}

export async function loadBuiltinSkillsCatalog(options: BuiltinSkillsResolveOptions = {}) {
  return formatBuiltinSkillsCatalog(await scanBuiltinSkills(options));
}

export function createReadSkillTool(options: BuiltinSkillsResolveOptions = {}) {
  return tool({
    description: [
      "读取 ChatDesk 内置 skill 文件。",
      "skillId 使用内置目录中的 id，例如 builtin:chatdesk-doc。",
      "默认读取 SKILL.md；path 可指向该 skill 目录内的相对文件，例如 references/settings.md。",
      "用户询问如何使用 ChatDesk、设置在哪或某项功能怎么配时，必须先读对应 skill 再作答。",
    ].join(""),
    inputSchema: z.object({
      skillId: z.string().min(1).max(200).describe("内置 skill id，例如 builtin:chatdesk-doc"),
      path: z.string().max(200).optional().describe("skill 目录内的相对路径，默认 SKILL.md"),
    }),
    execute: async ({ skillId, path: relativePath }) => {
      return readBuiltinSkillFile(skillId, relativePath, options);
    },
  });
}
