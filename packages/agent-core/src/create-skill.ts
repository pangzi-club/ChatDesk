import { lstat, mkdir, realpath, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { tool } from "ai";
import { z } from "zod";

export const CREATE_SKILL_TOOL_NAME = "create_skill";

const inputSchema = z.object({
  name: z
    .string()
    .max(64)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  description: z
    .string()
    .trim()
    .min(1)
    .max(2000)
    .refine((value) => !/[\r\n]/.test(value)),
  body: z.string().trim().min(1).max(100_000).describe("Markdown 正文，不包含 frontmatter"),
});

export async function createLocalSkill(input: z.infer<typeof inputSchema>, homeDir = os.homedir()) {
  const { name, description, body } = inputSchema.parse(input);
  const content = `---\nname: ${name}\ndescription: ${JSON.stringify(description)}\n---\n\n${body}\n`;
  const home = await realpath(homeDir);
  let root = home;
  // Reject redirected parents before granting this narrowly scoped write capability.
  for (const component of [".agents", "skills"]) {
    root = path.join(root, component);
    await mkdir(root).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "EEXIST") throw error;
    });
    const metadata = await lstat(root);
    if (metadata.isSymbolicLink() || !metadata.isDirectory() || (await realpath(root)) !== root) {
      throw new Error("Skill 目录必须是真实目录，不能使用符号链接");
    }
  }
  const directory = path.join(root, name);
  await mkdir(directory).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "EEXIST") throw new Error(`Skill 已存在，未覆盖：${name}`);
    throw error;
  });
  const file = path.join(directory, "SKILL.md");
  await writeFile(file, content, { encoding: "utf8", flag: "wx" });
  return {
    id: `agents:${name}`,
    name,
    path: file,
    bytes: Buffer.byteLength(content),
    created: true,
  };
}

export function createSkillTool(options: { homeDir?: string } = {}) {
  return tool({
    description:
      "创建本机 Skill。用户同意创建后使用；固定写入 ~/.agents/skills/<name>/SKILL.md，自动生成 frontmatter。同名目录报错，不覆盖。仅支持创建。",
    inputSchema,
    execute: async (input) => createLocalSkill(input, options.homeDir),
  });
}
